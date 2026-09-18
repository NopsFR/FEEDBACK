//! LRCLIB: crowd-sourced lyrics, plain and time-synced.
//!
//! Matching is on track, artist, album and duration, which is what makes the answer trustworthy —
//! the same title by the same artist can be a different recording, and a length that disagrees is
//! the clearest sign of it. An exact match is tried first; a looser search only fills in when the
//! exact one has nothing, and only when a candidate's length is close.
use crate::catalogue::net::Lane;
use crate::catalogue::{LyricsProvider, LyricsQuery, LyricsResult, LyricsStatus, ProviderError, ProviderResult};
use serde_json::Value;
use std::sync::Arc;

pub const ID: &str = "lrclib";
const BASE: &str = "https://lrclib.net/api";
/// A match closer than this is the same recording as far as lyrics timing is concerned.
const DURATION_TOLERANCE_SECS: f64 = 4.0;

pub struct Lrclib {
    lane: Arc<Lane>,
}

impl Lrclib {
    pub fn new(lane: Arc<Lane>) -> Self {
        Self { lane }
    }
}

/// One LRCLIB record → FEEDBACK's result, including the case where a track is simply instrumental.
pub fn from_json(v: &Value) -> Option<LyricsResult> {
    if v.get("instrumental").and_then(Value::as_bool).unwrap_or(false) {
        return Some(LyricsResult { status: LyricsStatus::Instrumental, provider: Some(ID.into()), plain: None, synced: None });
    }
    let synced = v.get("syncedLyrics").and_then(Value::as_str).map(str::to_string).filter(|s| !s.trim().is_empty());
    let plain = v.get("plainLyrics").and_then(Value::as_str).map(str::to_string).filter(|s| !s.trim().is_empty());
    match (&synced, &plain) {
        (None, None) => None,
        (Some(_), _) => Some(LyricsResult { status: LyricsStatus::AvailableSynced, provider: Some(ID.into()), plain, synced }),
        (None, Some(_)) => Some(LyricsResult { status: LyricsStatus::AvailablePlain, provider: Some(ID.into()), plain, synced: None }),
    }
}

/// From a search response, the record whose length is closest to ours — and close enough to be it.
pub fn best_match(results: &[Value], duration_ms: Option<i64>) -> Option<&Value> {
    let wanted = duration_ms.map(|ms| ms as f64 / 1000.0);
    let mut best: Option<(&Value, f64)> = None;
    for candidate in results {
        let has_lyrics = candidate.get("syncedLyrics").and_then(Value::as_str).is_some_and(|s| !s.trim().is_empty())
            || candidate.get("plainLyrics").and_then(Value::as_str).is_some_and(|s| !s.trim().is_empty())
            || candidate.get("instrumental").and_then(Value::as_bool).unwrap_or(false);
        if !has_lyrics {
            continue;
        }
        let Some(wanted) = wanted else {
            // With no length to compare, take the first usable record rather than guessing.
            return Some(candidate);
        };
        let Some(length) = candidate.get("duration").and_then(Value::as_f64) else { continue };
        let delta = (length - wanted).abs();
        if delta <= DURATION_TOLERANCE_SECS && best.as_ref().is_none_or(|(_, b)| delta < *b) {
            best = Some((candidate, delta));
        }
    }
    best.map(|(c, _)| c)
}

impl LyricsProvider for Lrclib {
    fn id(&self) -> &'static str {
        ID
    }

    fn lyrics(&self, query: &LyricsQuery) -> ProviderResult<LyricsResult> {
        if query.title.trim().is_empty() || query.artist.trim().is_empty() {
            return Ok(LyricsResult::none(LyricsStatus::NotFound));
        }
        let mut url = format!(
            "{BASE}/get?artist_name={}&track_name={}",
            urlencoding::encode(query.artist.trim()),
            urlencoding::encode(query.title.trim())
        );
        if let Some(album) = query.album.as_deref().filter(|a| !a.trim().is_empty()) {
            url.push_str(&format!("&album_name={}", urlencoding::encode(album.trim())));
        }
        if let Some(ms) = query.duration_ms {
            url.push_str(&format!("&duration={}", ms / 1000));
        }

        match self.lane.get_json(&url) {
            Ok(body) => Ok(from_json(&body).unwrap_or_else(|| LyricsResult::none(LyricsStatus::NotFound))),
            // No exact record: try the looser search before giving up.
            Err(ProviderError::NotFound) => {
                let search = format!(
                    "{BASE}/search?track_name={}&artist_name={}",
                    urlencoding::encode(query.title.trim()),
                    urlencoding::encode(query.artist.trim())
                );
                let body = match self.lane.get_json(&search) {
                    Ok(body) => body,
                    Err(ProviderError::NotFound) => return Ok(LyricsResult::none(LyricsStatus::NotFound)),
                    Err(e) => return Err(e),
                };
                let results = body.as_array().cloned().unwrap_or_default();
                Ok(best_match(&results, query.duration_ms).and_then(from_json).unwrap_or_else(|| LyricsResult::none(LyricsStatus::NotFound)))
            }
            Err(e) => Err(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn synced_lyrics_win_over_plain() {
        let v = serde_json::json!({ "plainLyrics": "line one\nline two", "syncedLyrics": "[00:12.00] line one", "instrumental": false });
        let result = from_json(&v).unwrap();
        assert_eq!(result.status, LyricsStatus::AvailableSynced);
        assert!(result.synced.is_some() && result.plain.is_some());
        assert_eq!(result.provider.as_deref(), Some("lrclib"));
    }

    #[test]
    fn plain_only_and_instrumental_are_distinct_answers() {
        let plain = from_json(&serde_json::json!({ "plainLyrics": "words", "syncedLyrics": null })).unwrap();
        assert_eq!(plain.status, LyricsStatus::AvailablePlain);

        let instrumental = from_json(&serde_json::json!({ "instrumental": true, "plainLyrics": null })).unwrap();
        assert_eq!(instrumental.status, LyricsStatus::Instrumental);
        assert!(instrumental.plain.is_none(), "an instrumental has no words to show");

        assert!(from_json(&serde_json::json!({ "plainLyrics": "   ", "syncedLyrics": "" })).is_none(), "empty strings are not lyrics");
    }

    #[test]
    fn a_search_match_must_agree_on_length() {
        let results = vec![
            serde_json::json!({ "trackName": "Creep", "duration": 180.0, "plainLyrics": "wrong recording" }),
            serde_json::json!({ "trackName": "Creep", "duration": 238.0, "syncedLyrics": "[00:01.00] right one" }),
        ];
        let best = best_match(&results, Some(239_000)).expect("a close enough match");
        assert_eq!(best["syncedLyrics"], "[00:01.00] right one");
        assert!(best_match(&results, Some(400_000)).is_none(), "nothing close enough is no match at all");
        assert!(best_match(&[], Some(238_000)).is_none());
    }

    #[test]
    fn records_without_lyrics_are_not_matches() {
        let results = vec![serde_json::json!({ "duration": 238.0, "plainLyrics": null, "syncedLyrics": null })];
        assert!(best_match(&results, Some(238_000)).is_none());
    }
}
