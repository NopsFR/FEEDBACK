//! MusicBrainz: who made what, and which release it came from.
//!
//! This is FEEDBACK's identity source — MBIDs and ISRCs come from here and everything else hangs off
//! them. The service is volunteer-run and asks for one request a second from a contactable client,
//! which the shared lane enforces; parsing is separated from fetching so the mapping is testable
//! without touching the network.
use crate::catalogue::net::Lane;
use crate::catalogue::{ArtworkRef, CatalogueArtist, CatalogueRelease, CatalogueTrack, ExternalIds, MetadataProvider, ProviderError, ProviderResult};
use serde_json::Value;
use std::sync::Arc;

pub const ID: &str = "musicbrainz";
const BASE: &str = "https://musicbrainz.org/ws/2";

pub struct MusicBrainz {
    lane: Arc<Lane>,
}

impl MusicBrainz {
    pub fn new(lane: Arc<Lane>) -> Self {
        Self { lane }
    }

    /// `dismax` is MusicBrainz's mode for queries a person typed: it weighs the words across fields
    /// instead of demanding Lucene syntax. Fielded queries (used for album matching) keep it off.
    fn query(&self, entity: &str, query: &str, limit: usize, dismax: bool) -> ProviderResult<Value> {
        let url = format!(
            "{BASE}/{entity}/?query={}&fmt=json&limit={}{}",
            urlencoding::encode(query),
            limit.clamp(1, 25),
            if dismax { "&dismax=true" } else { "" }
        );
        self.lane.get_json(&url)
    }
}

/// Lucene is the query language here, so strip the operators rather than escaping them: a user
/// typing `AC/DC` means a band, not a regex.
pub fn sanitise(term: &str) -> String {
    let cleaned: String = term.chars().map(|c| if "+-&|!(){}[]^\"~*?:\\/".contains(c) { ' ' } else { c }).collect();
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn text(v: Option<&Value>) -> Option<String> {
    v.and_then(Value::as_str).map(str::to_string).filter(|s| !s.is_empty())
}

fn credit(v: Option<&Value>) -> (String, Option<String>) {
    let Some(credits) = v.and_then(Value::as_array) else { return ("Unknown artist".into(), None) };
    let name = credits
        .iter()
        .map(|c| {
            let n = text(c.get("name")).or_else(|| text(c.get("artist").and_then(|a| a.get("name")))).unwrap_or_default();
            let join = text(c.get("joinphrase")).unwrap_or_default();
            format!("{n}{join}")
        })
        .collect::<String>();
    let mbid = credits.first().and_then(|c| text(c.get("artist").and_then(|a| a.get("id"))));
    (if name.trim().is_empty() { "Unknown artist".into() } else { name.trim().to_string() }, mbid)
}

/// A recording search result → a catalogue track. No playback source: MusicBrainz is metadata only.
pub fn recording_from_json(v: &Value) -> Option<CatalogueTrack> {
    let recording_mbid = text(v.get("id"))?;
    let title = text(v.get("title"))?;
    let (artist, artist_mbid) = credit(v.get("artist-credit"));
    let first_release = v.get("releases").and_then(Value::as_array).and_then(|r| r.first());
    let release_mbid = first_release.and_then(|r| text(r.get("id")));
    let release_group_mbid = first_release.and_then(|r| text(r.get("release-group").and_then(|g| g.get("id"))));
    let media = first_release.and_then(|r| r.get("media")).and_then(Value::as_array).and_then(|m| m.first());
    let track = media.and_then(|m| m.get("track")).and_then(Value::as_array).and_then(|t| t.first());
    let ids = ExternalIds {
        recording_mbid: Some(recording_mbid.clone()),
        release_mbid,
        release_group_mbid,
        artist_mbid,
        isrcs: v.get("isrcs").and_then(Value::as_array).map(|a| a.iter().filter_map(|i| i.as_str().map(str::to_string)).collect()).unwrap_or_default(),
        ..Default::default()
    };
    let group = first_release.and_then(|r| r.get("release-group"));
    let secondary = group.and_then(|g| g.get("secondary-types")).and_then(Value::as_array).and_then(|s| s.first()).and_then(Value::as_str);
    let release_kind = secondary.map(str::to_string).or_else(|| text(group.and_then(|g| g.get("primary-type"))));
    Some(CatalogueTrack {
        canonical_id: format!("mb:recording:{recording_mbid}"),
        title,
        artist,
        album: first_release.and_then(|r| text(r.get("title"))),
        duration_ms: v.get("length").and_then(Value::as_i64).filter(|ms| *ms > 0),
        track_no: track.and_then(|t| t.get("number")).and_then(|n| n.as_str().and_then(|s| s.parse().ok()).or_else(|| n.as_i64())),
        disc_no: media.and_then(|m| m.get("position")).and_then(Value::as_i64),
        release_date: text(v.get("first-release-date")).or_else(|| first_release.and_then(|r| text(r.get("date")))),
        release_kind,
        tags: v.get("tags").and_then(Value::as_array).map(|a| a.iter().filter_map(|t| text(t.get("name"))).collect()).unwrap_or_default(),
        artwork: ArtworkRef::default(),
        sources: vec![],
        metadata_sources: vec![ID.to_string()],
        local_track_id: None,
        ids,
    })
}

pub fn release_from_json(v: &Value) -> Option<CatalogueRelease> {
    let release_mbid = text(v.get("id"))?;
    let title = text(v.get("title"))?;
    let (artist, artist_mbid) = credit(v.get("artist-credit"));
    Some(CatalogueRelease {
        canonical_id: format!("mb:release:{release_mbid}"),
        title,
        artist,
        date: text(v.get("date")),
        country: text(v.get("country")),
        label: v.get("label-info").and_then(Value::as_array).and_then(|l| l.first()).and_then(|l| text(l.get("label").and_then(|x| x.get("name")))),
        format: v.get("media").and_then(Value::as_array).and_then(|m| m.first()).and_then(|m| text(m.get("format"))),
        track_count: v.get("track-count").and_then(Value::as_i64),
        artwork: ArtworkRef::default(),
        local_album_id: None,
        metadata_sources: vec![ID.to_string()],
        ids: ExternalIds {
            release_mbid: Some(release_mbid),
            release_group_mbid: text(v.get("release-group").and_then(|g| g.get("id"))),
            artist_mbid,
            ..Default::default()
        },
    })
}

pub fn artist_from_json(v: &Value) -> Option<CatalogueArtist> {
    let mbid = text(v.get("id"))?;
    let name = text(v.get("name"))?;
    Some(CatalogueArtist {
        canonical_id: format!("mb:artist:{mbid}"),
        name,
        sort_name: text(v.get("sort-name")),
        disambiguation: text(v.get("disambiguation")),
        country: text(v.get("country")),
        tags: v.get("tags").and_then(Value::as_array).map(|a| a.iter().filter_map(|t| text(t.get("name"))).collect()).unwrap_or_default(),
        local_artist_id: None,
        metadata_sources: vec![ID.to_string()],
        ids: ExternalIds { artist_mbid: Some(mbid), ..Default::default() },
    })
}

impl MetadataProvider for MusicBrainz {
    fn id(&self) -> &'static str {
        ID
    }

    fn search_tracks(&self, query: &str, limit: usize) -> ProviderResult<Vec<CatalogueTrack>> {
        let q = sanitise(query);
        if q.is_empty() {
            return Ok(vec![]);
        }
        let body = self.query("recording", &q, limit, true)?;
        Ok(body.get("recordings").and_then(Value::as_array).map(|rs| rs.iter().filter_map(recording_from_json).collect()).unwrap_or_default())
    }

    fn search_releases(&self, query: &str, limit: usize) -> ProviderResult<Vec<CatalogueRelease>> {
        let q = sanitise(query);
        if q.is_empty() {
            return Ok(vec![]);
        }
        let body = self.query("release", &q, limit, true)?;
        Ok(body.get("releases").and_then(Value::as_array).map(|rs| rs.iter().filter_map(release_from_json).collect()).unwrap_or_default())
    }

    fn search_artists(&self, query: &str, limit: usize) -> ProviderResult<Vec<CatalogueArtist>> {
        let q = sanitise(query);
        if q.is_empty() {
            return Ok(vec![]);
        }
        let body = self.query("artist", &q, limit, true)?;
        Ok(body.get("artists").and_then(Value::as_array).map(|rs| rs.iter().filter_map(artist_from_json).collect()).unwrap_or_default())
    }

    fn match_release(&self, artist: &str, album: &str, limit: usize) -> ProviderResult<Vec<CatalogueRelease>> {
        let album = sanitise(album);
        if album.is_empty() {
            return Err(ProviderError::Malformed("that album has no title to look up".into()));
        }
        let artist = sanitise(artist);
        let query = if artist.is_empty() || artist.eq_ignore_ascii_case("various artists") {
            format!("release:\"{album}\"")
        } else {
            format!("release:\"{album}\" AND artist:\"{artist}\"")
        };
        let body = self.query("release", &query, limit, false)?;
        Ok(body.get("releases").and_then(Value::as_array).map(|rs| rs.iter().filter_map(release_from_json).collect()).unwrap_or_default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Value {
        // Shape taken from a real /ws/2/recording search response, trimmed to what FEEDBACK reads.
        serde_json::json!({
            "recordings": [{
                "id": "b1a9c0e9-d987-4042-ae91-78d6a3267d69",
                "title": "Everything in Its Right Place",
                "length": 251000,
                "first-release-date": "2000-10-02",
                "isrcs": ["GBAYE0000988"],
                "artist-credit": [{ "name": "Radiohead", "joinphrase": "", "artist": { "id": "a74b1b7f-71a5-4011-9441-d0b5e4122711", "name": "Radiohead" } }],
                "releases": [{
                    "id": "0ac2f4d4-1234-4321-9f66-6b1a6f9e6d10",
                    "title": "Kid A",
                    "date": "2000-10-02",
                    "release-group": { "id": "b8048f24-c026-3398-b23a-b5e50716cbc7", "primary-type": "Album" },
                    "media": [{ "position": 1, "format": "CD", "track": [{ "number": "1" }] }]
                }],
                "tags": [{ "name": "electronic" }, { "name": "art rock" }]
            }]
        })
    }

    #[test]
    fn a_recording_becomes_a_catalogue_track_with_its_identifiers() {
        let track = recording_from_json(&fixture()["recordings"][0]).expect("parsed");
        assert_eq!(track.title, "Everything in Its Right Place");
        assert_eq!(track.artist, "Radiohead");
        assert_eq!(track.album.as_deref(), Some("Kid A"));
        assert_eq!(track.duration_ms, Some(251000));
        assert_eq!(track.track_no, Some(1));
        assert_eq!(track.ids.recording_mbid.as_deref(), Some("b1a9c0e9-d987-4042-ae91-78d6a3267d69"));
        assert_eq!(track.ids.release_group_mbid.as_deref(), Some("b8048f24-c026-3398-b23a-b5e50716cbc7"));
        assert_eq!(track.ids.isrcs, vec!["GBAYE0000988"]);
        assert_eq!(track.tags, vec!["electronic", "art rock"]);
        assert_eq!(track.release_kind.as_deref(), Some("Album"), "the kind of release is carried so ranking can prefer the studio album");
        assert!(!track.playable(), "a metadata result is never playable on its own");
        assert_eq!(track.metadata_sources, vec!["musicbrainz"]);
    }

    #[test]
    fn joined_credits_read_as_written() {
        let value = serde_json::json!({
            "id": "1", "title": "Ghost", "artist-credit": [
                { "name": "Justice", "joinphrase": " feat. ", "artist": { "id": "aaa", "name": "Justice" } },
                { "name": "Uffie", "joinphrase": "", "artist": { "id": "bbb", "name": "Uffie" } }
            ]
        });
        let track = recording_from_json(&value).unwrap();
        assert_eq!(track.artist, "Justice feat. Uffie");
        assert_eq!(track.ids.artist_mbid.as_deref(), Some("aaa"));
    }

    #[test]
    fn malformed_rows_are_skipped_rather_than_guessed_at() {
        assert!(recording_from_json(&serde_json::json!({ "title": "No id" })).is_none());
        assert!(recording_from_json(&serde_json::json!({ "id": "x" })).is_none());
        assert!(release_from_json(&serde_json::json!({})).is_none());
        assert!(artist_from_json(&serde_json::json!({ "id": "x" })).is_none());
    }

    #[test]
    fn queries_drop_lucene_operators() {
        assert_eq!(sanitise("AC/DC"), "AC DC");
        assert_eq!(sanitise("Kid A\" OR release:*"), "Kid A OR release");
        assert_eq!(sanitise("   "), "");
    }
}
