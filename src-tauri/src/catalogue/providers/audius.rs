//! Audius: the one provider here that hands over music rather than facts about music.
//!
//! Its catalogue is public and its API needs no key — only an app name, so the service can see who
//! is calling. Artists upload their own work and agree it may be streamed, and the API says so per
//! track: `is_streamable`, and `access.stream` for anything gated behind a token or a purchase. A
//! track that fails either test is left out entirely rather than shown with a Play button that
//! would lie.
use crate::catalogue::net::Lane;
use crate::catalogue::{ArtworkRef, CatalogueTrack, ExternalIds, MetadataProvider, PlaybackKind, PlaybackSource, ProviderResult};
use crate::catalogue::playback::PlaybackType;
use serde_json::Value;
use std::sync::Arc;

pub const ID: &str = "audius";
const BASE: &str = "https://api.audius.co/v1";
const APP: &str = "FEEDBACK";

pub struct Audius {
    lane: Arc<Lane>,
}

impl Audius {
    pub fn new(lane: Arc<Lane>) -> Self {
        Self { lane }
    }
}

/// The stream URL for a track id. Audius redirects it to whichever node holds the audio.
pub fn stream_url(id: &str) -> String {
    format!("{BASE}/tracks/{id}/stream?app_name={APP}")
}

/// One Audius track → a FEEDBACK row, or nothing at all when it may not be streamed.
pub fn from_json(v: &Value) -> Option<CatalogueTrack> {
    let id = v.get("id").and_then(Value::as_str)?.to_string();
    let title = v.get("title").and_then(Value::as_str)?.trim().to_string();
    if title.is_empty() {
        return None;
    }
    let streamable = v.get("is_streamable").and_then(Value::as_bool).unwrap_or(true);
    let granted = v.get("access").and_then(|a| a.get("stream")).and_then(Value::as_bool).unwrap_or(true);
    let deleted = v.get("is_delete").and_then(Value::as_bool).unwrap_or(false);
    if !streamable || !granted || deleted {
        return None;
    }
    let artist = v.get("user").and_then(|u| u.get("name")).and_then(Value::as_str).unwrap_or("Unknown artist").trim().to_string();
    let artwork = v
        .get("artwork")
        .and_then(|a| a.get("480x480").or_else(|| a.get("150x150")))
        .and_then(Value::as_str)
        .map(str::to_string);
    let mut ids = ExternalIds { isrcs: v.get("isrc").and_then(Value::as_str).map(|i| vec![i.to_string()]).unwrap_or_default(), ..Default::default() };
    ids.other.insert(ID.to_string(), id.clone());

    Some(CatalogueTrack {
        canonical_id: format!("audius:{id}"),
        title,
        artist,
        album: None,
        duration_ms: v.get("duration").and_then(Value::as_i64).map(|s| s * 1000),
        track_no: None,
        disc_no: None,
        release_date: v.get("release_date").and_then(Value::as_str).map(str::to_string),
        release_kind: None,
        ids,
        tags: v.get("genre").and_then(Value::as_str).filter(|g| !g.is_empty()).map(|g| vec![g.to_string()]).unwrap_or_default(),
        artwork: ArtworkRef { hash: None, remote: artwork },
        sources: vec![PlaybackSource {
            kind: PlaybackKind::LegalRemoteStream,
            provider: ID.into(),
            track_id: None,
            url: Some(stream_url(&id)),
            mime: Some("audio/mpeg".into()),
        }],
        metadata_sources: vec![ID.to_string()],
        local_track_id: None,
        playback_type: PlaybackType::Full,
    })
}

impl MetadataProvider for Audius {
    fn id(&self) -> &'static str {
        ID
    }

    fn search_tracks(&self, query: &str, limit: usize) -> ProviderResult<Vec<CatalogueTrack>> {
        let url = format!("{BASE}/tracks/search?query={}&limit={}&app_name={APP}", urlencoding::encode(query.trim()), limit.clamp(1, 50));
        let body = self.lane.get_json(&url)?;
        Ok(body.get("data").and_then(Value::as_array).map(|rows| rows.iter().filter_map(from_json).collect()).unwrap_or_default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_streamable_track_becomes_a_playable_row() {
        let row = from_json(&serde_json::json!({
            "id": "ng9rl", "title": "lofi type beat", "duration": 334,
            "is_streamable": true, "access": { "stream": true, "download": true },
            "user": { "name": "[bsdu]" }, "artwork": { "480x480": "https://example.test/a.jpg" }, "genre": "Lo-Fi"
        }))
        .expect("a streamable track is a row");
        assert_eq!(row.playback_type, PlaybackType::Full);
        assert_eq!(row.duration_ms, Some(334_000));
        assert_eq!(row.sources[0].url.as_deref(), Some("https://api.audius.co/v1/tracks/ng9rl/stream?app_name=FEEDBACK"));
        assert_eq!(row.ids.other.get("audius").map(String::as_str), Some("ng9rl"));
    }

    #[test]
    fn a_gated_or_unstreamable_track_is_left_out_entirely() {
        let gated = serde_json::json!({ "id": "a", "title": "Gated", "user": { "name": "x" }, "access": { "stream": false } });
        let off = serde_json::json!({ "id": "b", "title": "Not streamable", "user": { "name": "x" }, "is_streamable": false });
        let gone = serde_json::json!({ "id": "c", "title": "Deleted", "user": { "name": "x" }, "is_delete": true });
        assert!(from_json(&gated).is_none());
        assert!(from_json(&off).is_none());
        assert!(from_json(&gone).is_none());
    }
}
