//! Deciding when two results are the same recording — and, just as importantly, when they aren't.
//!
//! Identifiers win when they exist. Otherwise a normalised title and artist must match *and* the
//! version markers must agree, because a live take, an acoustic version, a demo and a 2009 remaster
//! are different recordings even though their titles look alike.
use super::{CatalogueTrack, ExternalIds, PlaybackSource};

/// Version markers that make two otherwise identical titles different recordings.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Variant {
    pub live: bool,
    pub acoustic: bool,
    pub demo: bool,
    pub remix: bool,
    pub radio_edit: bool,
    pub instrumental: bool,
    pub remaster: bool,
    pub cover: bool,
}

impl Variant {
    pub fn is_plain(self) -> bool {
        self == Variant::default()
    }
}

/// Strip the things that are noise (case, punctuation, "feat." credits, explicit markers) while
/// keeping the things that are signal (which version this is).
pub fn normalise(text: &str) -> (String, Variant) {
    let lower = text.to_lowercase();
    let has = |needle: &str| lower.contains(needle);
    let words: Vec<&str> = lower.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect();
    let word = |w: &str| words.iter().any(|x| *x == w);
    let variant = Variant {
        live: has("live at") || has("live in") || has("(live") || has("- live") || has("[live"),
        acoustic: word("acoustic"),
        demo: word("demo"),
        remix: word("remix") || word("rmx") || word("flip") || word("bootleg"),
        radio_edit: has("radio edit"),
        instrumental: word("instrumental"),
        remaster: has("remaster"),
        cover: word("cover") || word("covered"),
    };

    let mut out = String::with_capacity(lower.len());
    let mut depth = 0i32;
    for ch in lower.chars() {
        match ch {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = (depth - 1).max(0),
            _ if depth > 0 => {}
            c if c.is_alphanumeric() => out.push(c),
            _ => out.push(' '),
        }
    }
    // Trailing credits and dash-suffixes ("- 2009 remaster") are noise once the variant is recorded.
    let words = out.split_whitespace().collect::<Vec<_>>();
    let mut kept: Vec<&str> = Vec::with_capacity(words.len());
    let mut skipping = false;
    for w in words {
        if matches!(w, "feat" | "featuring" | "ft" | "with") {
            skipping = true;
            continue;
        }
        if skipping {
            continue;
        }
        if matches!(w, "remaster" | "remastered" | "explicit" | "clean" | "version" | "edit" | "live" | "acoustic" | "demo" | "instrumental" | "mono" | "stereo") {
            continue;
        }
        kept.push(w);
    }
    (kept.join(" "), variant)
}

/// How sure FEEDBACK is that a remote result describes a particular local track.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Confidence {
    None,
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone)]
pub struct LocalFacts<'a> {
    pub title: &'a str,
    pub artist: &'a str,
    pub album: Option<&'a str>,
    pub duration_ms: Option<i64>,
    pub ids: &'a ExternalIds,
}

const DURATION_TOLERANCE_MS: i64 = 5_000;

fn same_ids(a: &ExternalIds, b: &ExternalIds) -> bool {
    if let (Some(x), Some(y)) = (&a.recording_mbid, &b.recording_mbid) {
        return x == y;
    }
    a.isrcs.iter().any(|i| b.isrcs.contains(i))
}

/// Never guesses upwards: a title-only match stays Low, whatever else lines up.
pub fn confidence(local: &LocalFacts, remote: &CatalogueTrack) -> Confidence {
    if same_ids(local.ids, &remote.ids) {
        return Confidence::High;
    }
    let (lt, lv) = normalise(local.title);
    let (rt, rv) = normalise(&remote.title);
    if lt.is_empty() || lt != rt || lv != rv {
        return Confidence::None;
    }
    let (la, _) = normalise(local.artist);
    let (ra, _) = normalise(&remote.artist);
    if la != ra {
        return Confidence::None;
    }
    let albums_match = match (local.album, remote.album.as_deref()) {
        (Some(a), Some(b)) => normalise(a).0 == normalise(b).0,
        _ => false,
    };
    let durations_match = match (local.duration_ms, remote.duration_ms) {
        (Some(a), Some(b)) => (a - b).abs() <= DURATION_TOLERANCE_MS,
        _ => false,
    };
    if albums_match && durations_match {
        Confidence::Medium
    } else {
        Confidence::Low
    }
}

/// Fold `other` into `into` without losing what either one knew: identifiers merge, playback
/// sources accumulate, and a local track's own title and artist are never replaced by a remote guess.
pub fn merge_into(into: &mut CatalogueTrack, other: CatalogueTrack) {
    into.ids.merge_from(&other.ids);
    if into.album.is_none() {
        into.album = other.album;
    }
    if into.duration_ms.is_none() {
        into.duration_ms = other.duration_ms;
    }
    if into.release_date.is_none() {
        into.release_date = other.release_date;
    }
    if into.track_no.is_none() {
        into.track_no = other.track_no;
    }
    if into.disc_no.is_none() {
        into.disc_no = other.disc_no;
    }
    if into.artwork.hash.is_none() {
        into.artwork.hash = other.artwork.hash;
    }
    if into.artwork.remote.is_none() {
        into.artwork.remote = other.artwork.remote;
    }
    if into.local_track_id.is_none() {
        into.local_track_id = other.local_track_id;
    }
    for tag in other.tags {
        if !into.tags.contains(&tag) {
            into.tags.push(tag);
        }
    }
    for source in other.sources {
        if !into.sources.iter().any(|s: &PlaybackSource| s.kind == source.kind && s.provider == source.provider && s.track_id == source.track_id && s.url == source.url) {
            into.sources.push(source);
        }
    }
    for provider in other.metadata_sources {
        if !into.metadata_sources.contains(&provider) {
            into.metadata_sources.push(provider);
        }
    }
}

/// Collapse duplicates across providers. Local rows come first so they keep their playback source
/// and their own metadata; remote rows fold into them when they clearly describe the same recording.
pub fn dedupe(tracks: Vec<CatalogueTrack>) -> Vec<CatalogueTrack> {
    let mut out: Vec<CatalogueTrack> = Vec::with_capacity(tracks.len());
    for track in tracks {
        let facts_ids = track.ids.clone();
        let position = out.iter().position(|existing| {
            if same_ids(&existing.ids, &facts_ids) {
                return true;
            }
            let (et, ev) = normalise(&existing.title);
            let (tt, tv) = normalise(&track.title);
            if et.is_empty() || et != tt || ev != tv {
                return false;
            }
            if normalise(&existing.artist).0 != normalise(&track.artist).0 {
                return false;
            }
            match (existing.duration_ms, track.duration_ms) {
                // Same title, same artist, same version, and lengths that disagree by more than a
                // few seconds: probably a different recording, so keep both.
                (Some(a), Some(b)) => (a - b).abs() <= DURATION_TOLERANCE_MS,
                _ => true,
            }
        });
        match position {
            Some(i) => merge_into(&mut out[i], track),
            None => out.push(track),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalogue::{ArtworkRef, PlaybackKind};

    fn track(title: &str, artist: &str, album: Option<&str>, ms: Option<i64>, mbid: Option<&str>) -> CatalogueTrack {
        CatalogueTrack {
            canonical_id: format!("t:{title}:{artist}"),
            title: title.into(),
            artist: artist.into(),
            album: album.map(str::to_string),
            duration_ms: ms,
            track_no: None,
            disc_no: None,
            release_date: None,
            release_kind: None,
            ids: ExternalIds { recording_mbid: mbid.map(str::to_string), ..Default::default() },
            tags: vec![],
            artwork: ArtworkRef::default(),
            sources: vec![],
            metadata_sources: vec!["test".into()],
            local_track_id: None,
            playback_type: crate::catalogue::playback::PlaybackType::Unavailable,
        }
    }

    #[test]
    fn normalisation_drops_noise_but_keeps_the_version() {
        assert_eq!(normalise("Creep (Explicit)").0, "creep");
        assert_eq!(normalise("Creep - 2009 Remaster").0, "creep 2009");
        assert_eq!(normalise("Ghost feat. Uffie").0, "ghost");
        assert!(normalise("Creep (Live at Glastonbury)").1.live);
        assert!(normalise("Creep - Acoustic Version").1.acoustic);
        assert!(normalise("Creep").1.is_plain());
    }

    #[test]
    fn different_versions_are_never_merged() {
        let merged = dedupe(vec![
            track("Creep", "Radiohead", Some("Pablo Honey"), Some(238_000), None),
            track("Creep (Live at the Astoria)", "Radiohead", None, Some(240_000), None),
            track("Creep - Acoustic", "Radiohead", None, Some(236_000), None),
        ]);
        assert_eq!(merged.len(), 3, "studio, live and acoustic are three recordings");
    }

    #[test]
    fn the_same_recording_from_two_providers_becomes_one_row() {
        let mut local = track("Creep", "Radiohead", Some("Pablo Honey"), Some(238_000), None);
        local.local_track_id = Some(7);
        local.sources = vec![PlaybackSource::local(7)];
        let mut remote = track("Creep", "Radiohead", Some("Pablo Honey"), Some(239_000), Some("mbid-1"));
        remote.tags = vec!["alternative rock".into()];
        remote.metadata_sources = vec!["musicbrainz".into()];

        let merged = dedupe(vec![local, remote]);
        assert_eq!(merged.len(), 1);
        let row = &merged[0];
        assert_eq!(row.local_track_id, Some(7), "the local track stays the one that plays");
        assert_eq!(row.sources[0].kind, PlaybackKind::LocalFile);
        assert_eq!(row.ids.recording_mbid.as_deref(), Some("mbid-1"), "identity comes from the provider");
        assert_eq!(row.tags, vec!["alternative rock"]);
        assert_eq!(row.metadata_sources, vec!["test", "musicbrainz"]);
    }

    #[test]
    fn identifiers_beat_titles_in_both_directions() {
        let a = track("Song", "Band", None, Some(200_000), Some("same"));
        let b = track("Completely Different Title", "Someone Else", None, Some(100_000), Some("same"));
        assert_eq!(dedupe(vec![a, b]).len(), 1, "a shared recording id settles it");

        let x = track("Song", "Band", None, Some(120_000), None);
        let y = track("Song", "Band", None, Some(400_000), None);
        assert_eq!(dedupe(vec![x, y]).len(), 2, "very different lengths mean different recordings");
    }

    #[test]
    fn confidence_never_overstates_a_weak_match() {
        let ids = ExternalIds { recording_mbid: Some("mbid-1".into()), ..Default::default() };
        let remote = track("Creep", "Radiohead", Some("Pablo Honey"), Some(238_500), Some("mbid-1"));
        assert_eq!(confidence(&LocalFacts { title: "Creep", artist: "Radiohead", album: None, duration_ms: None, ids: &ids }, &remote), Confidence::High);

        let empty = ExternalIds::default();
        assert_eq!(
            confidence(&LocalFacts { title: "Creep", artist: "Radiohead", album: Some("Pablo Honey"), duration_ms: Some(238_000), ids: &empty }, &remote),
            Confidence::Medium
        );
        assert_eq!(confidence(&LocalFacts { title: "Creep", artist: "Radiohead", album: None, duration_ms: None, ids: &empty }, &remote), Confidence::Low);
        assert_eq!(confidence(&LocalFacts { title: "Creep", artist: "Nirvana", album: None, duration_ms: None, ids: &empty }, &remote), Confidence::None);
        let live = track("Creep (Live at the Astoria)", "Radiohead", None, None, None);
        assert_eq!(confidence(&LocalFacts { title: "Creep", artist: "Radiohead", album: None, duration_ms: None, ids: &empty }, &live), Confidence::None);
    }
}
