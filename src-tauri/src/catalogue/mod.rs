//! The catalogue: what FEEDBACK knows about music that isn't on this machine.
//!
//! Three rules hold this together.
//! 1. Metadata is not audio. A catalogue result carries identity, artwork and lyrics; it only becomes
//!    playable when a [`PlaybackSource`] says so, and the local library is the only source that needs no network.
//! 2. Providers are adapters behind traits. Nothing above this module knows which service answered.
//! 3. Every request goes through the scheduler in [`net`] and the cache in [`cache`], so a provider is
//!    asked politely, at most as often as its rules allow, and not at all when the answer is already here.
pub mod cache;
pub mod enrich;
pub mod net;
pub mod playback;
pub mod providers;
pub mod resolve;
pub mod search;

use serde::{Deserialize, Serialize};

/// Identifiers that let two results be recognised as the same thing.
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalIds {
    pub recording_mbid: Option<String>,
    pub release_mbid: Option<String>,
    pub release_group_mbid: Option<String>,
    pub artist_mbid: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub isrcs: Vec<String>,
    /// Ids from optional providers, keyed by provider id ("jamendo", "discogs", …).
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub other: std::collections::BTreeMap<String, String>,
}

impl ExternalIds {
    pub fn is_empty(&self) -> bool {
        self.recording_mbid.is_none() && self.release_mbid.is_none() && self.release_group_mbid.is_none() && self.artist_mbid.is_none() && self.isrcs.is_empty() && self.other.is_empty()
    }
    /// Fill in anything this copy is missing, without overwriting what it already has.
    pub fn merge_from(&mut self, other: &ExternalIds) {
        for (mine, theirs) in [
            (&mut self.recording_mbid, &other.recording_mbid),
            (&mut self.release_mbid, &other.release_mbid),
            (&mut self.release_group_mbid, &other.release_group_mbid),
            (&mut self.artist_mbid, &other.artist_mbid),
        ] {
            if mine.is_none() {
                mine.clone_from(theirs);
            }
        }
        for isrc in &other.isrcs {
            if !self.isrcs.contains(isrc) {
                self.isrcs.push(isrc.clone());
            }
        }
        for (k, v) in &other.other {
            self.other.entry(k.clone()).or_insert_with(|| v.clone());
        }
    }
}

/// Where a track could actually come from. `Local` is the only kind that works with no network.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackKind {
    LocalFile,
    LegalRemoteStream,
    ExternalLink,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSource {
    pub kind: PlaybackKind,
    pub provider: String,
    /// Local sources carry the library track id; remote ones carry a URL.
    pub track_id: Option<i64>,
    pub url: Option<String>,
    pub mime: Option<String>,
}

impl PlaybackSource {
    pub fn local(track_id: i64) -> Self {
        Self { kind: PlaybackKind::LocalFile, provider: "library".into(), track_id: Some(track_id), url: None, mime: None }
    }
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtworkRef {
    /// Already in FEEDBACK's own cache.
    pub hash: Option<String>,
    /// A thumbnail that can be fetched through the artwork provider.
    pub remote: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LyricsStatus {
    AvailableSynced,
    AvailablePlain,
    Instrumental,
    NotFound,
    ProviderError,
    Offline,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsResult {
    pub status: LyricsStatus,
    pub provider: Option<String>,
    pub plain: Option<String>,
    pub synced: Option<String>,
}

impl LyricsResult {
    pub fn none(status: LyricsStatus) -> Self {
        Self { status, provider: None, plain: None, synced: None }
    }
}

/// A track as the catalogue sees it: provider-independent, and honest about whether it can be played.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogueTrack {
    /// Stable within a result set: the strongest identifier available, or a hash of the metadata.
    pub canonical_id: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_ms: Option<i64>,
    pub track_no: Option<i64>,
    pub disc_no: Option<i64>,
    pub release_date: Option<String>,
    /// "Album", "Live", "Compilation", "Single"… as the provider classifies the release.
    pub release_kind: Option<String>,
    pub ids: ExternalIds,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    pub artwork: ArtworkRef,
    /// Empty means nothing can play it yet — the UI must not offer Play.
    #[serde(default)]
    pub sources: Vec<PlaybackSource>,
    /// Which providers contributed to this row, in the order they did.
    #[serde(default)]
    pub metadata_sources: Vec<String>,
    /// Set when this row is (also) a track in the user's own library.
    pub local_track_id: Option<i64>,
    /// What the player may offer for this row. Decided by the resolver, never by the metadata.
    #[serde(default = "playback::unavailable")]
    pub playback_type: playback::PlaybackType,
}

impl CatalogueTrack {
    pub fn playable(&self) -> bool {
        self.sources.iter().any(|s| s.kind != PlaybackKind::Unavailable)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogueArtist {
    pub canonical_id: String,
    pub name: String,
    pub sort_name: Option<String>,
    pub disambiguation: Option<String>,
    pub country: Option<String>,
    pub ids: ExternalIds,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    pub local_artist_id: Option<i64>,
    #[serde(default)]
    pub metadata_sources: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogueRelease {
    pub canonical_id: String,
    pub title: String,
    pub artist: String,
    pub date: Option<String>,
    pub country: Option<String>,
    pub label: Option<String>,
    pub format: Option<String>,
    pub track_count: Option<i64>,
    pub ids: ExternalIds,
    pub artwork: ArtworkRef,
    pub local_album_id: Option<i64>,
    #[serde(default)]
    pub metadata_sources: Vec<String>,
}

/// What went wrong, in terms the scheduler and the UI both understand.
#[derive(Debug, Clone, PartialEq)]
pub enum ProviderError {
    /// The provider asked us to wait; the scheduler holds off until then.
    RateLimited { retry_after: std::time::Duration },
    Unavailable(String),
    Offline,
    Malformed(String),
    NotFound,
    Disabled,
}

impl std::fmt::Display for ProviderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProviderError::RateLimited { .. } => write!(f, "The catalogue service asked FEEDBACK to slow down."),
            ProviderError::Unavailable(m) => write!(f, "{m}"),
            ProviderError::Offline => write!(f, "FEEDBACK couldn't reach the catalogue service."),
            ProviderError::Malformed(m) => write!(f, "The catalogue service sent something FEEDBACK couldn't read: {m}"),
            ProviderError::NotFound => write!(f, "Nothing is filed for that."),
            ProviderError::Disabled => write!(f, "That provider is switched off."),
        }
    }
}

pub type ProviderResult<T> = Result<T, ProviderError>;

/// What a metadata provider can be asked. A provider implements only what it really supports;
/// the default answers say "not my job" rather than inventing data.
pub trait MetadataProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn search_tracks(&self, _query: &str, _limit: usize) -> ProviderResult<Vec<CatalogueTrack>> {
        Ok(vec![])
    }
    fn search_releases(&self, _query: &str, _limit: usize) -> ProviderResult<Vec<CatalogueRelease>> {
        Ok(vec![])
    }
    fn search_artists(&self, _query: &str, _limit: usize) -> ProviderResult<Vec<CatalogueArtist>> {
        Ok(vec![])
    }
    /// Releases that look like a specific album the user already has.
    fn match_release(&self, _artist: &str, _album: &str, _limit: usize) -> ProviderResult<Vec<CatalogueRelease>> {
        Ok(vec![])
    }
}

pub trait ArtworkProvider: Send + Sync {
    fn id(&self) -> &'static str;
    /// `size` is 250, 500 or 1200; 0 means the original.
    fn artwork(&self, ids: &ExternalIds, size: u32) -> ProviderResult<Vec<u8>>;
}

#[derive(Debug, Clone)]
pub struct LyricsQuery {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_ms: Option<i64>,
}

pub trait LyricsProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn lyrics(&self, query: &LyricsQuery) -> ProviderResult<LyricsResult>;
}
