//! The search orchestrator: local library first, catalogue providers after, one list at the end.
//!
//! Local results are instant and playable, so they lead. Remote providers are consulted through the
//! cache and the scheduler, folded in by [`resolve`], and ranked by how well they answer the query —
//! a fuzzy match from a remote index never outranks the album sitting on this disk.
use super::{cache, providers::Lanes, resolve, CatalogueArtist, CatalogueRelease, CatalogueTrack, ExternalIds, MetadataProvider, PlaybackSource, ProviderError};
use crate::database::Db;
use crate::library::query;
use serde::Serialize;
use std::time::Instant;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Scope {
    /// Only what's on this machine — always available, even with no network.
    Local,
    /// Local plus the catalogue.
    Everywhere,
}

/// What each provider did for one query. This is what the developer panel shows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTiming {
    pub provider: String,
    pub results: usize,
    pub ms: u64,
    pub cache: &'static str,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchDebug {
    pub query: String,
    pub providers: Vec<ProviderTiming>,
    pub incoming: usize,
    pub unique: usize,
    pub duplicates_removed: usize,
    pub total_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub tracks: Vec<CatalogueTrack>,
    pub releases: Vec<CatalogueRelease>,
    pub artists: Vec<CatalogueArtist>,
    /// True when at least one remote provider answered, so the UI can say "catalogue offline".
    pub remote_answered: bool,
    pub debug: SearchDebug,
}

/// A local library row as a catalogue track: identity unknown, but definitely playable.
pub fn from_local(track: &query::TrackRow) -> CatalogueTrack {
    CatalogueTrack {
        canonical_id: format!("local:{}", track.id),
        title: track.title.clone(),
        artist: track.artist.clone(),
        album: Some(track.album.clone()).filter(|a| !a.is_empty()),
        duration_ms: Some(track.duration_ms),
        track_no: track.track_no,
        disc_no: track.disc_no,
        release_date: track.year.map(|y| y.to_string()),
        release_kind: None,
        ids: ExternalIds::default(),
        tags: track.genre.clone().into_iter().collect(),
        artwork: super::ArtworkRef { hash: track.art.clone(), remote: None },
        sources: vec![PlaybackSource::local(track.id)],
        metadata_sources: vec!["library".into()],
        local_track_id: Some(track.id),
        playback_type: crate::catalogue::playback::PlaybackType::Unavailable,
    }
}

/// How well a result answers what was typed.
///
/// The hard case is user-uploaded covers and remixes: "Paramore - Decode (Cover)" contains every
/// word of "paramore decode" in its *title*, so naive word matching floats it above the real thing.
/// So a query word counts for the artist it names, not for a title that merely mentions it, and
/// versions nobody asked for are pushed down.
fn score(track: &CatalogueTrack, query: &str) -> f64 {
    let (q, query_variant) = resolve::normalise(query);
    let (title, title_variant) = resolve::normalise(&track.title);
    let (artist, _) = resolve::normalise(&track.artist);
    let mut score = 0.0;

    // People type "artist title" as often as either alone. Work out which words name the artist,
    // and judge the title against what's left — otherwise a re-upload whose *title* repeats the
    // band name scores an "exact title match" the real recording can never reach.
    let artist_words: Vec<&str> = artist.split_whitespace().collect();
    let title_words: Vec<&str> = title.split_whitespace().collect();
    let album_words: Vec<String> = track.album.as_deref().map(|a| resolve::normalise(a).0.split_whitespace().map(str::to_string).collect()).unwrap_or_default();
    let query_words: Vec<&str> = q.split_whitespace().collect();
    let naming_artist: Vec<&str> = query_words.iter().copied().filter(|w| artist_words.contains(w)).collect();
    let rest: Vec<&str> = query_words.iter().copied().filter(|w| !naming_artist.contains(w)).collect();
    let target = if naming_artist.is_empty() { q.clone() } else { rest.join(" ") };

    if !target.is_empty() {
        if title == target {
            score += 6.0;
        } else if title.starts_with(&target) {
            score += 3.5;
        } else if title.contains(&target) {
            score += 2.0;
        }
    }
    if artist == q {
        score += 5.0;
    }
    score += 2.5 * naming_artist.len() as f64;
    for word in &rest {
        if title_words.contains(word) {
            score += 0.5;
        } else if album_words.iter().any(|a| a == word) {
            score += 0.4;
        }
    }

    // "Artist - Title (Cover)" is how re-uploads are named; the artist belongs in the artist field.
    if let Some((prefix, _)) = track.title.split_once(" - ") {
        let (prefix, _) = resolve::normalise(prefix);
        if !prefix.is_empty() && q.split_whitespace().any(|w| prefix.split_whitespace().any(|p| p == w)) && !artist_words.iter().any(|a| prefix.split_whitespace().any(|p| p == *a)) {
            score -= 3.0;
        }
    }

    // A version nobody asked for goes below the one they probably meant.
    if title_variant.remix && !query_variant.remix {
        score -= 2.5;
    }
    if title_variant.cover && !query_variant.cover {
        score -= 2.5;
    }
    if title_variant.live && !query_variant.live {
        score -= 1.5;
    }
    if title_variant.acoustic && !query_variant.acoustic {
        score -= 1.0;
    }
    if title_variant.demo && !query_variant.demo {
        score -= 1.0;
    }

    if track.playable() {
        score += 2.5; // something you can actually hear beats something you can only read about
    }
    if track.local_track_id.is_some() {
        score += 1.0;
    }
    if !track.ids.is_empty() {
        score += 0.75; // a result with canonical identity is worth more than a loose one
    }
    score += 0.25 * track.metadata_sources.len() as f64;
    if track.album.is_some() {
        score += 0.25;
    }

    // The studio release is what most people mean; live sets, bootlegs and compilations still show,
    // just not ahead of it.
    match track.release_kind.as_deref() {
        Some("Album") | Some("EP") | Some("Single") => score += 1.2,
        Some("Live") | Some("Bootleg") => score -= 2.0,
        Some("Compilation") | Some("Remix") | Some("DJ-mix") | Some("Mixtape/Street") => score -= 1.2,
        _ => {}
    }
    if track.tags.iter().any(|t| t.eq_ignore_ascii_case("karaoke") || t.eq_ignore_ascii_case("tribute")) {
        score -= 2.0;
    }
    score
}

pub struct Orchestrator<'a> {
    pub db: &'a Db,
    pub lanes: &'a Lanes,
    pub providers: Vec<&'a dyn MetadataProvider>,
    /// Optional: fills in sleeves for the release cards. Search still works without it.
    pub artwork: Option<&'a dyn super::ArtworkProvider>,
}

impl Orchestrator<'_> {
    /// Run one query. Remote failures degrade the result; they never fail the search.
    pub fn search(&self, query: &str, scope: Scope, limit: usize) -> Outcome {
        let started = Instant::now();
        let query = query.trim();
        let mut timings = Vec::new();
        let mut tracks = Vec::new();
        let mut releases: Vec<CatalogueRelease> = Vec::new();
        let mut artists: Vec<CatalogueArtist> = Vec::new();
        let mut remote_answered = false;

        // Local first: it's fast, it's offline, and it's the only thing that can play.
        let local_started = Instant::now();
        let local = self.db.with(|c| query::search(c, query)).unwrap_or_default();
        timings.push(ProviderTiming { provider: "library".into(), results: local.tracks.len(), ms: local_started.elapsed().as_millis() as u64, cache: "local", error: None });
        tracks.extend(local.tracks.iter().map(from_local));

        let asked_remote = scope == Scope::Everywhere && !query.is_empty();
        if asked_remote {
            for provider in &self.providers {
                let started = Instant::now();
                let key = cache::key(provider.id(), cache::Kind::Search, query);
                if let Some(hit) = cache::get::<Vec<CatalogueTrack>>(self.db, &key) {
                    if hit.freshness == cache::Freshness::Fresh {
                        remote_answered = true;
                        timings.push(ProviderTiming { provider: provider.id().into(), results: hit.value.len(), ms: started.elapsed().as_millis() as u64, cache: "hit", error: None });
                        tracks.extend(hit.value);
                        continue;
                    }
                }
                cache::miss();
                match provider.search_tracks(query, limit) {
                    Ok(found) => {
                        remote_answered = true;
                        cache::put(self.db, &key, provider.id(), cache::Kind::Search, &found);
                        timings.push(ProviderTiming { provider: provider.id().into(), results: found.len(), ms: started.elapsed().as_millis() as u64, cache: "miss", error: None });
                        tracks.extend(found);
                    }
                    Err(e) => {
                        // Stale beats nothing: show what was cached and say the provider is unhappy.
                        let stale = cache::get::<Vec<CatalogueTrack>>(self.db, &key).map(|h| h.value).unwrap_or_default();
                        timings.push(ProviderTiming {
                            provider: provider.id().into(),
                            results: stale.len(),
                            ms: started.elapsed().as_millis() as u64,
                            cache: if stale.is_empty() { "miss" } else { "stale" },
                            error: Some(e.to_string()),
                        });
                        tracks.extend(stale);
                    }
                }
            }
        }

        let incoming = tracks.len();
        let mut tracks = resolve::dedupe(tracks);
        tracks.sort_by(|a, b| score(b, query).partial_cmp(&score(a, query)).unwrap_or(std::cmp::Ordering::Equal));
        tracks.truncate(limit.clamp(1, 200));
        let unique = tracks.len();

        if asked_remote {
            // Release cards and artists come from the ranked results: most of what a card needs is
            // already there, and every extra endpoint is another request against a tight budget.
            artists = artists_from(&tracks);
            releases = releases_from(&tracks);
            if releases.is_empty() && remote_answered {
                // An album-title query often finds no recordings; then the release endpoint earns its request.
                for provider in &self.providers {
                    let rkey = cache::key(provider.id(), cache::Kind::Release, query);
                    match cache::get::<Vec<CatalogueRelease>>(self.db, &rkey).filter(|h| h.freshness == cache::Freshness::Fresh) {
                        Some(hit) => releases.extend(hit.value),
                        None => {
                            cache::miss();
                            if let Ok(found) = provider.search_releases(query, 8) {
                                cache::put(self.db, &rkey, provider.id(), cache::Kind::Release, &found);
                                releases.extend(found);
                            }
                        }
                    }
                }
            }
        }

        let mut releases = dedupe_releases(releases, &local);
        self.attach_artwork(&mut releases);
        // Say plainly, row by row, what the player may offer. Metadata is not audio.
        super::playback::classify_all(self.db, &mut tracks);

        Outcome {
            releases,
            artists,
            remote_answered,
            debug: SearchDebug {
                query: query.to_string(),
                providers: timings,
                incoming,
                unique,
                duplicates_removed: incoming.saturating_sub(unique),
                total_ms: started.elapsed().as_millis() as u64,
            },
            tracks,
        }
    }
}

impl Orchestrator<'_> {
    /// Thumbnails for the first few release cards, cached for weeks and skipped when absent.
    fn attach_artwork(&self, releases: &mut [CatalogueRelease]) {
        let Some(provider) = self.artwork else { return };
        for release in releases.iter_mut().take(4) {
            if release.artwork.remote.is_some() || release.local_album_id.is_some() {
                continue;
            }
            let key = cache::key(provider.id(), cache::Kind::ArtworkRef, &release.canonical_id);
            match cache::get::<Option<String>>(self.db, &key).filter(|h| h.freshness == cache::Freshness::Fresh) {
                Some(hit) => release.artwork.remote = hit.value,
                None => {
                    cache::miss();
                    let thumb = provider.artwork(&release.ids, 250).ok().map(|bytes| super::providers::coverart::data_url(&bytes));
                    cache::put(self.db, &key, provider.id(), cache::Kind::ArtworkRef, &thumb);
                    if thumb.is_some() {
                        release.metadata_sources.push(provider.id().to_string());
                    }
                    release.artwork.remote = thumb;
                }
            }
        }
    }
}

/// Mark remote releases the user already owns, and drop repeats from several providers.
fn dedupe_releases(releases: Vec<CatalogueRelease>, local: &query::SearchResult) -> Vec<CatalogueRelease> {
    let mut out: Vec<CatalogueRelease> = Vec::new();
    for mut release in releases {
        if let Some(album) = local.albums.iter().find(|a| resolve::normalise(&a.title).0 == resolve::normalise(&release.title).0 && resolve::normalise(&a.artist).0 == resolve::normalise(&release.artist).0) {
            release.local_album_id = Some(album.id);
        }
        let same = out.iter().any(|r| {
            r.ids.release_mbid.is_some() && r.ids.release_mbid == release.ids.release_mbid
                || (resolve::normalise(&r.title).0 == resolve::normalise(&release.title).0 && resolve::normalise(&r.artist).0 == resolve::normalise(&release.artist).0 && r.date == release.date)
        });
        if !same {
            out.push(release);
        }
    }
    out.truncate(12);
    out
}

/// Releases implied by the recordings already in hand — the album a result came from, with the
/// identity needed to fetch its sleeve later.
fn releases_from(tracks: &[CatalogueTrack]) -> Vec<CatalogueRelease> {
    let mut out: Vec<CatalogueRelease> = Vec::new();
    for track in tracks.iter().filter(|t| t.local_track_id.is_none()) {
        let (Some(album), Some(release_mbid)) = (track.album.clone(), track.ids.release_mbid.clone()) else { continue };
        if out.iter().any(|r| r.ids.release_mbid.as_deref() == Some(release_mbid.as_str())) {
            continue;
        }
        out.push(CatalogueRelease {
            canonical_id: format!("mb:release:{release_mbid}"),
            title: album,
            artist: track.artist.clone(),
            date: track.release_date.clone(),
            country: None,
            label: None,
            format: None,
            track_count: None,
            ids: track.ids.clone(),
            artwork: super::ArtworkRef::default(),
            local_album_id: None,
            metadata_sources: track.metadata_sources.clone(),
        });
        if out.len() == 8 {
            break;
        }
    }
    out
}

/// Artists implied by the results already in hand — no extra request for something the credits say.
fn artists_from(tracks: &[CatalogueTrack]) -> Vec<CatalogueArtist> {
    let mut out: Vec<CatalogueArtist> = Vec::new();
    for track in tracks.iter().filter(|t| t.local_track_id.is_none()) {
        let Some(mbid) = track.ids.artist_mbid.clone() else { continue };
        if out.iter().any(|a| a.ids.artist_mbid.as_deref() == Some(mbid.as_str())) {
            continue;
        }
        out.push(CatalogueArtist {
            canonical_id: format!("mb:artist:{mbid}"),
            name: track.artist.clone(),
            sort_name: None,
            disambiguation: None,
            country: None,
            ids: ExternalIds { artist_mbid: Some(mbid), ..Default::default() },
            tags: vec![],
            local_artist_id: None,
            metadata_sources: track.metadata_sources.clone(),
        });
        if out.len() == 8 {
            break;
        }
    }
    out
}

fn describe(error: &ProviderError) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalogue::{ArtworkRef, ProviderResult};

    struct Fake {
        id: &'static str,
        tracks: Vec<CatalogueTrack>,
        fail: Option<ProviderError>,
    }

    impl MetadataProvider for Fake {
        fn id(&self) -> &'static str {
            self.id
        }
        fn search_tracks(&self, _q: &str, _limit: usize) -> ProviderResult<Vec<CatalogueTrack>> {
            match &self.fail {
                Some(e) => Err(e.clone()),
                None => Ok(self.tracks.clone()),
            }
        }
    }

    fn remote(title: &str, artist: &str, mbid: &str) -> CatalogueTrack {
        CatalogueTrack {
            canonical_id: format!("mb:recording:{mbid}"),
            title: title.into(),
            artist: artist.into(),
            album: Some("Pablo Honey".into()),
            duration_ms: Some(238_000),
            track_no: None,
            disc_no: None,
            release_date: None,
            release_kind: None,
            ids: ExternalIds { recording_mbid: Some(mbid.into()), ..Default::default() },
            tags: vec![],
            artwork: ArtworkRef::default(),
            sources: vec![],
            metadata_sources: vec!["fake".into()],
            local_track_id: None,
            playback_type: crate::catalogue::playback::PlaybackType::Unavailable,
        }
    }

    fn db_with_track() -> Db {
        let db = Db::open_in_memory().unwrap();
        db.with_mut(|c| {
            c.execute("INSERT INTO library_folder(path, added_at) VALUES ('/music', 0)", [])?;
            c.execute(
                "INSERT INTO track(id, folder_id, path, filename, title, artist_name, album_title, album_artist_name, duration_ms, added_at)
                 VALUES (1, 1, '/music/creep.flac', 'creep.flac', 'Creep', 'Radiohead', 'Pablo Honey', 'Radiohead', 238000, 0)",
                [],
            )?;
            c.execute("INSERT INTO track_fts(rowid, title, artist, album, album_artist, genre) VALUES (1, 'Creep', 'Radiohead', 'Pablo Honey', 'Radiohead', '')", [])?;
            Ok(())
        })
        .unwrap();
        db
    }

    #[test]
    fn local_and_remote_become_one_playable_row() {
        let db = db_with_track();
        let lanes = Lanes::new();
        let fake = Fake { id: "fake", tracks: vec![remote("Creep", "Radiohead", "mbid-1")], fail: None };
        let orchestrator = Orchestrator { db: &db, lanes: &lanes, providers: vec![&fake], artwork: None };
        let outcome = orchestrator.search("creep", Scope::Everywhere, 20);

        assert_eq!(outcome.tracks.len(), 1, "the same recording from two sources is one result");
        let row = &outcome.tracks[0];
        assert_eq!(row.local_track_id, Some(1));
        assert!(row.playable(), "the local file still plays it");
        assert_eq!(row.ids.recording_mbid.as_deref(), Some("mbid-1"), "and it gained canonical identity");
        assert_eq!(outcome.debug.incoming, 2);
        assert_eq!(outcome.debug.duplicates_removed, 1);
        assert!(outcome.remote_answered);
    }

    #[test]
    fn a_local_only_search_never_touches_a_provider() {
        let db = db_with_track();
        let lanes = Lanes::new();
        let fake = Fake { id: "fake", tracks: vec![remote("Creep", "Radiohead", "mbid-1")], fail: Some(ProviderError::Offline) };
        let orchestrator = Orchestrator { db: &db, lanes: &lanes, providers: vec![&fake], artwork: None };
        let outcome = orchestrator.search("creep", Scope::Local, 20);
        assert_eq!(outcome.tracks.len(), 1);
        assert!(!outcome.remote_answered);
        assert_eq!(outcome.debug.providers.len(), 1, "only the library was asked");
    }

    #[test]
    fn a_failing_provider_degrades_the_search_instead_of_breaking_it() {
        let db = db_with_track();
        let lanes = Lanes::new();
        let fake = Fake { id: "fake", tracks: vec![], fail: Some(ProviderError::Offline) };
        let orchestrator = Orchestrator { db: &db, lanes: &lanes, providers: vec![&fake], artwork: None };
        let outcome = orchestrator.search("creep", Scope::Everywhere, 20);
        assert_eq!(outcome.tracks.len(), 1, "the local library still answers");
        assert!(!outcome.remote_answered);
        assert!(outcome.debug.providers.iter().any(|p| p.error.is_some()), "the failure is reported, not hidden");
    }

    #[test]
    fn a_second_search_is_served_from_the_cache() {
        let db = db_with_track();
        let lanes = Lanes::new();
        let fake = Fake { id: "fake", tracks: vec![remote("Creep", "Radiohead", "mbid-1")], fail: None };
        let orchestrator = Orchestrator { db: &db, lanes: &lanes, providers: vec![&fake], artwork: None };
        orchestrator.search("creep", Scope::Everywhere, 20);
        let again = orchestrator.search("creep", Scope::Everywhere, 20);
        assert_eq!(again.debug.providers.iter().find(|p| p.provider == "fake").unwrap().cache, "hit");
    }

    #[test]
    fn stale_cache_is_shown_when_a_provider_stops_answering() {
        let db = db_with_track();
        let lanes = Lanes::new();
        let good = Fake { id: "fake", tracks: vec![remote("Creep", "Radiohead", "mbid-1")], fail: None };
        Orchestrator { db: &db, lanes: &lanes, providers: vec![&good], artwork: None }.search("creep", Scope::Everywhere, 20);
        db.with(|c| c.execute("UPDATE cat_cache SET expires_at = 1", []).map(|_| ())).unwrap();

        let broken = Fake { id: "fake", tracks: vec![], fail: Some(ProviderError::Offline) };
        let outcome = Orchestrator { db: &db, lanes: &lanes, providers: vec![&broken], artwork: None }.search("creep", Scope::Everywhere, 20);
        let timing = outcome.debug.providers.iter().find(|p| p.provider == "fake").unwrap();
        assert_eq!(timing.cache, "stale");
        assert_eq!(outcome.tracks[0].ids.recording_mbid.as_deref(), Some("mbid-1"), "what was cached is still useful");
    }

    #[test]
    fn the_real_recording_beats_covers_and_re_uploads() {
        let db = Db::open_in_memory().unwrap();
        let lanes = Lanes::new();
        let mut cover = remote("Paramore - Decode (Cover)", "Dani Skylar", "mb-cover");
        cover.album = Some("Paramore - Decode (Cover) by Dani Skylar".into());
        cover.release_kind = Some("Single".into());
        let mut remix = remote("Paramore - Decode (KEIFERGR33N Remix)", "KEIFERGR33N", "mb-remix");
        remix.album = Some("Broken Hearts".into());
        remix.release_kind = Some("Album".into());
        let mut real = remote("Decode", "Paramore", "mb-real");
        real.album = Some("Twilight: Music From the Original Motion Picture Soundtrack".into());
        real.release_kind = Some("Soundtrack".into());

        let fake = Fake { id: "fake", tracks: vec![cover, remix, real], fail: None };
        let outcome = Orchestrator { db: &db, lanes: &lanes, providers: vec![&fake], artwork: None }.search("paramore decode", Scope::Everywhere, 20);
        assert_eq!(outcome.tracks[0].artist, "Paramore", "the band that made it comes first, not a re-upload that names them in its title");
    }

    #[test]
    fn a_playable_local_result_outranks_a_loose_remote_match() {
        let db = db_with_track();
        let lanes = Lanes::new();
        let noise = Fake { id: "fake", tracks: vec![remote("Creepin' Around", "Someone Else", "mbid-9")], fail: None };
        let orchestrator = Orchestrator { db: &db, lanes: &lanes, providers: vec![&noise], artwork: None };
        let outcome = orchestrator.search("creep", Scope::Everywhere, 20);
        assert_eq!(outcome.tracks.len(), 2);
        assert_eq!(outcome.tracks[0].local_track_id, Some(1), "the track you own comes first");
    }
}
