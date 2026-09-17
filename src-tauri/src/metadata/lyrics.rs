//! Lyrics: sidecar .lrc (synced) / .txt, or embedded tag. Parsed on the frontend; we return raw text + kind.
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lyrics {
    pub source: &'static str, // "lrc" | "txt" | "embedded"
    pub synced: bool,
    pub text: String,
}

fn looks_synced(text: &str) -> bool {
    text.lines().filter(|l| l.trim_start().starts_with('[') && l.contains(':') && l.contains(']')).take(3).count() >= 3
}

fn read_text(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    if bytes.len() > 512 * 1024 {
        return None;
    }
    Some(String::from_utf8_lossy(&bytes).trim_start_matches('\u{feff}').to_string())
}

pub fn sidecar_exists(path: &Path) -> bool {
    ["lrc", "txt"].iter().any(|e| path.with_extension(e).is_file())
}

pub fn find(path: &Path) -> Option<Lyrics> {
    if let Some(t) = read_text(&path.with_extension("lrc")) {
        return Some(Lyrics { source: "lrc", synced: looks_synced(&t), text: t });
    }
    if let Some(t) = read_text(&path.with_extension("txt")) {
        return Some(Lyrics { source: "txt", synced: looks_synced(&t), text: t });
    }
    super::tags::embedded_lyrics(path).map(|t| Lyrics { source: "embedded", synced: looks_synced(&t), text: t })
}
