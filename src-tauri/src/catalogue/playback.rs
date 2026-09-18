//! What each provider is allowed to give FEEDBACK, and how a catalogue row becomes something the
//! player can actually open.
//!
//! Every provider is classified once, here. A metadata provider can describe a recording in
//! perfect detail and still have no right to hand over the audio, so the classification — not the
//! richness of the metadata — decides what the UI may offer. The resolver then walks one fixed
//! order: a permitted full stream, else the user's own copy in their private cloud, else a
//! preview, else nothing. "Nothing" is a real answer and is shown as such; it is never a silent
//! failure and never an invented URL.
use super::{CatalogueTrack, PlaybackKind, PlaybackSource};
use crate::cloud::sync::match_key;
use crate::database::Db;
use serde::{Deserialize, Serialize};

/// What a provider may supply. Widening one of these is a licensing decision, not a code tidy-up.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProviderClass {
    /// Describes recordings. Never audio.
    MetadataOnly,
    /// Offers a short sample the provider publishes for that purpose.
    PreviewOnly,
    /// Grants playback of the complete recording.
    FullStream,
    /// The user's own files, held in their own private storage.
    UserCloud,
}

/// The classification of every provider FEEDBACK talks to. Unknown providers are metadata-only:
/// the safe assumption is that nobody has granted us audio.
pub fn class_of(provider: &str) -> ProviderClass {
    match provider {
        "library" | "cloud" => ProviderClass::UserCloud,
        "audius" | "jamendo" => ProviderClass::FullStream,
        "itunes" | "deezer" => ProviderClass::PreviewOnly,
        "musicbrainz" | "coverart" | "lrclib" | "listenbrainz" | "discogs" | "theaudiodb" => ProviderClass::MetadataOnly,
        _ => ProviderClass::MetadataOnly,
    }
}

/// What the player may do with a row. This is what the UI reads; it never infers from metadata.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackType {
    Full,
    UserCloud,
    Preview,
    Unavailable,
}

pub fn unavailable() -> PlaybackType {
    PlaybackType::Unavailable
}

/// The resolver's answer: what can be played, by what, and — when nothing can — why not.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolution {
    pub playback_type: PlaybackType,
    pub source: Option<PlaybackSource>,
    /// Shown to the user when there is nothing to play. Plain words, no provider jargon.
    pub reason: Option<String>,
}

impl Resolution {
    fn playable(playback_type: PlaybackType, source: PlaybackSource) -> Self {
        Self { playback_type, source: Some(source), reason: None }
    }
    fn nothing(reason: &str) -> Self {
        Self { playback_type: PlaybackType::Unavailable, source: None, reason: Some(reason.into()) }
    }
}

/// Does the user's private cloud hold their own copy of this recording?
///
/// Matched on the same key the sync uses, so a row that came back from a metadata provider still
/// finds the upload made from the user's own file.
fn own_copy(db: &Db, track: &CatalogueTrack) -> Option<PlaybackSource> {
    if let Some(id) = track.local_track_id {
        let path: Option<String> = db
            .with(|c| c.query_row("SELECT object_path FROM cloud_track WHERE track_id = ?1", [id], |r| r.get::<_, Option<String>>(0)))
            .ok()
            .flatten();
        if let Some(path) = path {
            return Some(PlaybackSource { kind: PlaybackKind::LegalRemoteStream, provider: "cloud".into(), track_id: Some(id), url: None, mime: Some(path) });
        }
    }
    let key = match_key(&track.artist, track.album.as_deref().unwrap_or(""), &track.title, track.duration_ms.unwrap_or(0));
    let found: Option<(i64, Option<String>)> = db
        .with(|c| c.query_row("SELECT track_id, object_path FROM cloud_track WHERE match_key = ?1", [&key], |r| Ok((r.get(0)?, r.get(1)?))))
        .ok();
    match found {
        Some((id, Some(path))) => Some(PlaybackSource { kind: PlaybackKind::LegalRemoteStream, provider: "cloud".into(), track_id: Some(id), url: None, mime: Some(path) }),
        _ => None,
    }
}

/// Track → permitted full stream → the user's own cloud copy → preview → clearly unavailable.
pub fn resolve(db: &Db, track: &CatalogueTrack) -> Resolution {
    // The file on this machine is the strongest answer there is.
    if let Some(local) = track.sources.iter().find(|s| s.kind == PlaybackKind::LocalFile) {
        return Resolution::playable(PlaybackType::Full, local.clone());
    }
    // A remote stream counts only if the provider that offered it is allowed to.
    if let Some(full) = track
        .sources
        .iter()
        .find(|s| s.kind == PlaybackKind::LegalRemoteStream && class_of(&s.provider) == ProviderClass::FullStream)
    {
        return Resolution::playable(PlaybackType::Full, full.clone());
    }
    if let Some(mine) = own_copy(db, track) {
        return Resolution::playable(PlaybackType::UserCloud, mine);
    }
    if let Some(preview) = track
        .sources
        .iter()
        .find(|s| s.kind == PlaybackKind::LegalRemoteStream && class_of(&s.provider) == ProviderClass::PreviewOnly)
    {
        return Resolution::playable(PlaybackType::Preview, preview.clone());
    }
    if track.sources.iter().any(|s| s.kind == PlaybackKind::ExternalLink) {
        return Resolution::nothing("Only listed elsewhere — open it at the provider, or add your own copy.");
    }
    Resolution::nothing("Nobody grants FEEDBACK the audio for this. Add your own copy and it plays everywhere.")
}

/// Stamp a result set so the UI knows, row by row, what it may offer.
pub fn classify_all(db: &Db, tracks: &mut [CatalogueTrack]) {
    for track in tracks.iter_mut() {
        let resolution = resolve(db, track);
        track.playback_type = resolution.playback_type;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalogue::ExternalIds;

    fn track(sources: Vec<PlaybackSource>) -> CatalogueTrack {
        CatalogueTrack {
            canonical_id: "x".into(),
            title: "Safe In Your Skin".into(),
            artist: "Title Fight".into(),
            album: Some("Shed".into()),
            duration_ms: Some(180_000),
            track_no: None,
            disc_no: None,
            release_date: None,
            release_kind: None,
            ids: ExternalIds::default(),
            tags: vec![],
            artwork: Default::default(),
            sources,
            metadata_sources: vec![],
            local_track_id: None,
            playback_type: PlaybackType::Unavailable,
        }
    }

    fn remote(provider: &str) -> PlaybackSource {
        PlaybackSource { kind: PlaybackKind::LegalRemoteStream, provider: provider.into(), track_id: None, url: Some("https://example.test/a.mp3".into()), mime: None }
    }

    #[test]
    fn a_metadata_provider_never_makes_a_row_playable() {
        let db = Db::open_in_memory().unwrap();
        // Even if a metadata provider somehow hands over a URL, it has no right to grant playback.
        let resolution = resolve(&db, &track(vec![remote("musicbrainz")]));
        assert_eq!(resolution.playback_type, PlaybackType::Unavailable);
        assert!(resolution.source.is_none());
        assert!(resolution.reason.is_some(), "the user is told why, never left guessing");
    }

    #[test]
    fn the_local_file_wins_over_everything_else() {
        let db = Db::open_in_memory().unwrap();
        let resolution = resolve(&db, &track(vec![remote("musicbrainz"), PlaybackSource::local(7)]));
        assert_eq!(resolution.playback_type, PlaybackType::Full);
        assert_eq!(resolution.source.unwrap().track_id, Some(7));
    }

    #[test]
    fn the_users_own_cloud_copy_beats_a_preview() {
        let db = Db::open_in_memory().unwrap();
        let key = match_key("Title Fight", "Shed", "Safe In Your Skin", 180_000);
        db.with_mut(|c| {
            c.execute("INSERT INTO library_folder(path, added_at) VALUES ('/music', 0)", [])?;
            c.execute(
                "INSERT INTO track(id, folder_id, path, filename, title, artist_name, album_title, album_artist_name, duration_ms, added_at)
                 VALUES (4, 1, '/music/skin.flac', 'skin.flac', 'Safe In Your Skin', 'Title Fight', 'Shed', 'Title Fight', 180000, 0)",
                [],
            )?;
            c.execute("INSERT INTO cloud_track (track_id, cloud_id, match_key, object_path, synced_at) VALUES (4, 'cloud-4', ?1, 'uid/hash.mp3', 0)", [&key]).map(|_| ())
        })
        .unwrap();
        let mut row = track(vec![]);
        row.sources.push(PlaybackSource { kind: PlaybackKind::LegalRemoteStream, provider: "itunes".into(), track_id: None, url: Some("https://example.test/p.m4a".into()), mime: None });
        let resolution = resolve(&db, &row);
        assert_eq!(resolution.playback_type, PlaybackType::UserCloud);
        assert_eq!(resolution.source.unwrap().track_id, Some(4));
    }

    #[test]
    fn an_unknown_provider_is_treated_as_metadata_only() {
        assert_eq!(class_of("some-new-api"), ProviderClass::MetadataOnly);
    }
}
