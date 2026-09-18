//! Attaching canonical identity to the files you already have.
//!
//! Enrichment only ever *adds* identifiers. It never rewrites a title, an artist or a tag, because
//! the user may have fixed those by hand and a provider's idea of a track is not more authoritative
//! than theirs. Each link records how sure FEEDBACK was, so a weak guess can be told from a certain
//! match later — and weak guesses are not stored at all.
use super::resolve::{self, Confidence};
use super::{CatalogueTrack, ExternalIds};
use crate::database::{now_ms, Db};
use crate::library::query;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Default, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LinkSummary {
    pub linked: usize,
    pub high: usize,
    pub medium: usize,
    /// Tracks FEEDBACK wasn't sure enough about to link.
    pub unmatched: usize,
}

fn score(local: &query::TrackRow, remote: &CatalogueTrack) -> Confidence {
    // Position on the disc plus a matching length is as close to certain as metadata gets.
    let same_position = local.track_no.is_some() && local.track_no == remote.track_no && local.disc_no.unwrap_or(1) == remote.disc_no.unwrap_or(1);
    let close_length = remote.duration_ms.is_some_and(|ms| (ms - local.duration_ms).abs() <= 5_000);
    let same_title = resolve::normalise(&local.title) == resolve::normalise(&remote.title);
    match (same_position, close_length, same_title) {
        (true, true, _) | (_, true, true) => Confidence::High,
        (true, false, true) => Confidence::Medium,
        (_, _, true) => Confidence::Medium,
        _ => Confidence::None,
    }
}

/// Pair local tracks with the tracks of a release the user has confirmed, and store the ids.
pub fn link_album(db: &Db, album_id: i64, release: &[CatalogueTrack], source: &str) -> rusqlite::Result<LinkSummary> {
    let local = db.with(|c| query::album(c, album_id))?.map(|a| a.tracks).unwrap_or_default();
    let mut summary = LinkSummary::default();
    let mut taken = vec![false; release.len()];

    for track in &local {
        let best = release
            .iter()
            .enumerate()
            .filter(|(i, _)| !taken[*i])
            .map(|(i, candidate)| (i, candidate, score(track, candidate)))
            .filter(|(_, _, confidence)| *confidence >= Confidence::Medium)
            .max_by_key(|(_, _, confidence)| *confidence);

        match best {
            Some((index, candidate, confidence)) => {
                taken[index] = true;
                store(db, track.id, &candidate.ids, confidence, source)?;
                summary.linked += 1;
                if confidence == Confidence::High {
                    summary.high += 1;
                } else {
                    summary.medium += 1;
                }
            }
            None => summary.unmatched += 1,
        }
    }
    Ok(summary)
}

/// Write (or improve) one link. A stronger match may replace a weaker one; the reverse never happens.
pub fn store(db: &Db, track_id: i64, ids: &ExternalIds, confidence: Confidence, source: &str) -> rusqlite::Result<()> {
    let weight = match confidence {
        Confidence::High => 1.0,
        Confidence::Medium => 0.6,
        Confidence::Low => 0.3,
        Confidence::None => return Ok(()),
    };
    db.with(|c| {
        let existing: Option<f64> = c.query_row("SELECT confidence FROM cat_link WHERE track_id = ?1", [track_id], |r| r.get(0)).optional()?;
        if existing.is_some_and(|previous| previous > weight) {
            return Ok(());
        }
        c.execute(
            "INSERT INTO cat_link(track_id, recording_mbid, release_mbid, release_group_mbid, artist_mbid, isrc, confidence, source, linked_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
             ON CONFLICT(track_id) DO UPDATE SET recording_mbid=excluded.recording_mbid, release_mbid=excluded.release_mbid,
                 release_group_mbid=excluded.release_group_mbid, artist_mbid=excluded.artist_mbid, isrc=excluded.isrc,
                 confidence=excluded.confidence, source=excluded.source, linked_at=excluded.linked_at",
            params![
                track_id,
                ids.recording_mbid,
                ids.release_mbid,
                ids.release_group_mbid,
                ids.artist_mbid,
                ids.isrcs.first(),
                weight,
                source,
                now_ms()
            ],
        )?;
        Ok(())
    })
}

/// What FEEDBACK knows about a local track's identity, if anything.
pub fn ids_for(db: &Db, track_id: i64) -> rusqlite::Result<Option<(ExternalIds, f64)>> {
    db.with(|c| {
        c.query_row(
            "SELECT recording_mbid, release_mbid, release_group_mbid, artist_mbid, isrc, confidence FROM cat_link WHERE track_id = ?1",
            [track_id],
            |r| {
                let isrc: Option<String> = r.get(4)?;
                Ok((
                    ExternalIds {
                        recording_mbid: r.get(0)?,
                        release_mbid: r.get(1)?,
                        release_group_mbid: r.get(2)?,
                        artist_mbid: r.get(3)?,
                        isrcs: isrc.into_iter().collect(),
                        ..Default::default()
                    },
                    r.get(5)?,
                ))
            },
        )
        .optional()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalogue::ArtworkRef;

    fn remote(title: &str, track_no: i64, ms: i64, mbid: &str) -> CatalogueTrack {
        CatalogueTrack {
            canonical_id: format!("mb:recording:{mbid}"),
            title: title.into(),
            artist: "Hollow Arcade".into(),
            album: Some("Nightbus Hymns".into()),
            duration_ms: Some(ms),
            track_no: Some(track_no),
            disc_no: Some(1),
            release_date: None,
            release_kind: None,
            ids: ExternalIds { recording_mbid: Some(mbid.into()), release_mbid: Some("rel-1".into()), ..Default::default() },
            tags: vec![],
            artwork: ArtworkRef::default(),
            sources: vec![],
            metadata_sources: vec!["musicbrainz".into()],
            local_track_id: None,
        }
    }

    fn library() -> (Db, i64) {
        let db = Db::open_in_memory().unwrap();
        db.with_mut(|c| {
            c.execute("INSERT INTO library_folder(path, added_at) VALUES ('/music', 0)", [])?;
            c.execute("INSERT INTO artist(name, sort_name, name_key) VALUES ('Hollow Arcade', 'Hollow Arcade', 'hollow arcade')", [])?;
            c.execute("INSERT INTO album(title, album_artist_id, album_key, added_at) VALUES ('Nightbus Hymns', 1, 'hollow arcade|nightbus hymns', 0)", [])?;
            for (i, (title, ms)) in [("Last Stop Before Morning", 216_000i64), ("Coin Slot Heart", 180_000), ("Neon Tetra", 200_000)].iter().enumerate() {
                c.execute(
                    "INSERT INTO track(folder_id, album_id, artist_id, path, filename, title, artist_name, album_title, album_artist_name, track_no, disc_no, duration_ms, added_at)
                     VALUES (1, 1, 1, ?1, ?2, ?3, 'Hollow Arcade', 'Nightbus Hymns', 'Hollow Arcade', ?4, 1, ?5, 0)",
                    params![format!("/music/{i}.flac"), format!("{i}.flac"), title, (i + 1) as i64, ms],
                )?;
            }
            Ok(())
        })
        .unwrap();
        (db, 1)
    }

    #[test]
    fn a_confirmed_release_gives_every_track_its_identifiers() {
        let (db, album) = library();
        let release = vec![
            remote("Last Stop Before Morning", 1, 216_500, "rec-1"),
            remote("Coin Slot Heart", 2, 180_200, "rec-2"),
            remote("Neon Tetra", 3, 199_800, "rec-3"),
        ];
        let summary = link_album(&db, album, &release, "musicbrainz").unwrap();
        assert_eq!(summary, LinkSummary { linked: 3, high: 3, medium: 0, unmatched: 0 });
        let (ids, confidence) = ids_for(&db, 1).unwrap().expect("linked");
        assert_eq!(ids.recording_mbid.as_deref(), Some("rec-1"));
        assert_eq!(ids.release_mbid.as_deref(), Some("rel-1"));
        assert_eq!(confidence, 1.0);
    }

    #[test]
    fn a_track_the_release_doesnt_contain_is_left_alone() {
        let (db, album) = library();
        // A release with only two of the three recordings, and one with a very different length.
        let release = vec![remote("Last Stop Before Morning", 1, 216_500, "rec-1"), remote("Something Else", 9, 90_000, "rec-9")];
        let summary = link_album(&db, album, &release, "musicbrainz").unwrap();
        assert_eq!(summary.linked, 1);
        assert_eq!(summary.unmatched, 2, "FEEDBACK would rather link nothing than link the wrong thing");
        assert!(ids_for(&db, 2).unwrap().is_none());
    }

    #[test]
    fn a_stronger_match_replaces_a_weaker_one_but_not_the_other_way_round() {
        let (db, _) = library();
        let ids = ExternalIds { recording_mbid: Some("weak".into()), ..Default::default() };
        store(&db, 1, &ids, Confidence::Medium, "test").unwrap();
        let strong = ExternalIds { recording_mbid: Some("strong".into()), ..Default::default() };
        store(&db, 1, &strong, Confidence::High, "test").unwrap();
        assert_eq!(ids_for(&db, 1).unwrap().unwrap().0.recording_mbid.as_deref(), Some("strong"));

        let weaker = ExternalIds { recording_mbid: Some("weaker".into()), ..Default::default() };
        store(&db, 1, &weaker, Confidence::Low, "test").unwrap();
        assert_eq!(ids_for(&db, 1).unwrap().unwrap().0.recording_mbid.as_deref(), Some("strong"), "a guess never overwrites a certainty");
    }

    #[test]
    fn nothing_is_stored_for_a_match_that_isnt_one() {
        let (db, _) = library();
        store(&db, 1, &ExternalIds { recording_mbid: Some("x".into()), ..Default::default() }, Confidence::None, "test").unwrap();
        assert!(ids_for(&db, 1).unwrap().is_none());
    }
}
