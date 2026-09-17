//! Optional, user-triggered catalogue lookups against free metadata services.
//!
//! Metadata only: MusicBrainz identifies a release, the Cover Art Archive supplies its sleeve image.
//! No audio is ever fetched here, nothing is sent unless the user asks for a specific album, and the
//! whole feature stays off until it is switched on in Settings. Requests are rate-limited to one per
//! second, as MusicBrainz asks.
use serde::Serialize;
use std::io::Read;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const AGENT: &str = concat!("FEEDBACK/", env!("CARGO_PKG_VERSION"), " ( personal local-first music library app )");
const MAX_ART_BYTES: usize = 12 * 1024 * 1024;
static LAST_CALL: Mutex<Option<Instant>> = Mutex::new(None);

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub mbid: String,
    pub title: String,
    pub artist: String,
    pub date: Option<String>,
    pub country: Option<String>,
    pub label: Option<String>,
    pub track_count: Option<i64>,
    pub format: Option<String>,
    /// Small preview, inlined as a data URL so the UI needs no extra network access.
    pub thumb: Option<String>,
}

/// One request per second, shared across every caller.
fn throttle() {
    let mut last = LAST_CALL.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(previous) = *last {
        let elapsed = previous.elapsed();
        if elapsed < Duration::from_millis(1100) {
            std::thread::sleep(Duration::from_millis(1100) - elapsed);
        }
    }
    *last = Some(Instant::now());
}

fn escape(term: &str) -> String {
    // Lucene-ish query syntax: keep words, drop the operators.
    term.chars().map(|c| if "+-&|!(){}[]^\"~*?:\\/".contains(c) { ' ' } else { c }).collect::<String>().trim().to_string()
}

fn text(value: &serde_json::Value) -> Option<String> {
    value.as_str().map(str::to_string).filter(|s| !s.is_empty())
}

/// Ask MusicBrainz which releases look like this album. Returns at most `limit` candidates.
pub fn search_release(artist: &str, album: &str, limit: usize) -> Result<Vec<Candidate>, String> {
    let album = escape(album);
    if album.is_empty() {
        return Err("This album has no title to look up.".into());
    }
    let artist = escape(artist);
    let query = if artist.is_empty() || artist.eq_ignore_ascii_case("various artists") {
        format!("release:\"{album}\"")
    } else {
        format!("release:\"{album}\" AND artist:\"{artist}\"")
    };
    let url = format!(
        "https://musicbrainz.org/ws/2/release/?query={}&fmt=json&limit={}",
        urlencoding::encode(&query),
        limit.clamp(1, 10)
    );
    throttle();
    let raw = ureq::get(&url)
        .set("User-Agent", AGENT)
        .set("Accept", "application/json")
        .timeout(Duration::from_secs(20))
        .call()
        .map_err(|e| friendly(&e))?
        .into_string()
        .map_err(|_| "MusicBrainz sent something FEEDBACK couldn't read.".to_string())?;
    let body: serde_json::Value = serde_json::from_str(&raw).map_err(|_| "MusicBrainz sent something FEEDBACK couldn't read.".to_string())?;

    let releases = body.get("releases").and_then(|r| r.as_array()).cloned().unwrap_or_default();
    Ok(releases
        .iter()
        .filter_map(|r| {
            Some(Candidate {
                mbid: text(r.get("id")?)?,
                title: text(r.get("title")?)?,
                artist: r
                    .get("artist-credit")
                    .and_then(|c| c.as_array())
                    .map(|credits| credits.iter().filter_map(|c| c.get("name").and_then(text)).collect::<Vec<_>>().join(", "))
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "Unknown artist".into()),
                date: r.get("date").and_then(text),
                country: r.get("country").and_then(text),
                label: r
                    .get("label-info")
                    .and_then(|l| l.as_array())
                    .and_then(|l| l.first())
                    .and_then(|l| l.get("label"))
                    .and_then(|l| l.get("name"))
                    .and_then(text),
                track_count: r.get("track-count").and_then(|v| v.as_i64()),
                format: r
                    .get("media")
                    .and_then(|m| m.as_array())
                    .and_then(|m| m.first())
                    .and_then(|m| m.get("format"))
                    .and_then(text),
                thumb: None,
            })
        })
        .collect())
}

/// Fetch a sleeve from the Cover Art Archive. `size` is 250, 500 or 1200 (full size when 0).
pub fn cover_art(mbid: &str, size: u32) -> Result<Vec<u8>, String> {
    if !mbid.chars().all(|c| c.is_ascii_hexdigit() || c == '-') || mbid.len() != 36 {
        return Err("That release id doesn't look right.".into());
    }
    let suffix = match size {
        250 => "front-250",
        500 => "front-500",
        1200 => "front-1200",
        _ => "front",
    };
    let url = format!("https://coverartarchive.org/release/{mbid}/{suffix}");
    let response = ureq::get(&url).set("User-Agent", AGENT).timeout(Duration::from_secs(30)).call().map_err(|e| friendly(&e))?;
    let mut reader = response.into_reader().take(MAX_ART_BYTES as u64 + 1);
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes).map_err(|_| "The artwork download was interrupted.".to_string())?;
    if bytes.len() > MAX_ART_BYTES {
        return Err("That artwork is unusually large; skipping it.".into());
    }
    if bytes.is_empty() {
        return Err("No artwork is filed for that release.".into());
    }
    Ok(bytes)
}

pub fn data_url(bytes: &[u8]) -> String {
    use base64::Engine;
    let kind = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) { "image/png" } else { "image/jpeg" };
    format!("data:{kind};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn friendly(error: &ureq::Error) -> String {
    match error {
        ureq::Error::Status(404, _) => "Nothing was filed for that release.".into(),
        ureq::Error::Status(503, _) => "The catalogue service is busy. Try again in a moment.".into(),
        ureq::Error::Status(code, _) => format!("The catalogue service answered with {code}."),
        ureq::Error::Transport(_) => "FEEDBACK couldn't reach the catalogue service.".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queries_are_sanitised_and_ids_validated() {
        assert_eq!(escape("Kid A\" OR release:*"), "Kid A  OR release");
        assert!(cover_art("not-a-real-id", 250).is_err());
        assert!(cover_art("../../etc/passwd", 250).is_err());
    }

    #[test]
    fn throttle_spaces_calls_out() {
        throttle();
        let start = Instant::now();
        throttle();
        assert!(start.elapsed() >= Duration::from_millis(1000));
    }

    /// Live check against the real services. Run on demand: `cargo test -- --ignored`.
    #[test]
    #[ignore = "network"]
    fn finds_a_well_known_release_and_its_sleeve() {
        let candidates = search_release("Radiohead", "Kid A", 5).unwrap();
        assert!(!candidates.is_empty(), "expected matches for a well-known album");
        assert!(candidates.iter().any(|c| c.title.to_lowercase().contains("kid a")));
        let art = candidates.iter().find_map(|c| cover_art(&c.mbid, 250).ok());
        assert!(art.is_some_and(|bytes| bytes.len() > 1000), "expected a sleeve from the Cover Art Archive");
    }

    #[test]
    fn data_urls_carry_the_image_type() {
        assert!(data_url(&[0x89, b'P', b'N', b'G', 0]).starts_with("data:image/png;base64,"));
        assert!(data_url(&[0xff, 0xd8, 0xff]).starts_with("data:image/jpeg;base64,"));
    }
}
