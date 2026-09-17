//! `fbmedia` protocol. Serves library media by track id and cached artwork by hash — never arbitrary paths.
//!   /track/<id>            audio/video bytes with HTTP Range support
//!   /art/<hash>/<160|480|0> artwork thumbnail (0 = original)
use crate::library::artwork::ArtCache;
use crate::state::AppState;
use std::io::{Read, Seek, SeekFrom};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::Manager;

const MAX_CHUNK: u64 = 4 * 1024 * 1024;

fn mime_for(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "aac" => "audio/aac",
        "m4a" | "alac" => "audio/mp4",
        "ogg" | "oga" => "audio/ogg",
        "opus" => "audio/ogg; codecs=opus",
        "aif" | "aiff" => "audio/aiff",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "mov" => "video/quicktime",
        _ => "application/octet-stream",
    }
}

fn plain(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder().status(status).header("Access-Control-Allow-Origin", "*").body(Vec::new()).unwrap()
}

fn parse_range(h: &str, len: u64) -> Option<(u64, u64)> {
    let spec = h.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    if a.is_empty() {
        let suffix: u64 = b.parse().ok()?;
        let start = len.saturating_sub(suffix);
        return Some((start, len - 1));
    }
    let start: u64 = a.parse().ok()?;
    let end: u64 = if b.is_empty() { len - 1 } else { b.parse::<u64>().ok()?.min(len - 1) };
    if start > end || start >= len {
        return None;
    }
    Some((start, end))
}

pub fn handle<R: tauri::Runtime>(app: &tauri::AppHandle<R>, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let path = req.uri().path().trim_start_matches('/').to_string();
    let parts: Vec<&str> = path.split('/').collect();
    let state = app.state::<AppState>();
    match parts.as_slice() {
        ["track", id] => {
            let Ok(id) = id.parse::<i64>() else { return plain(StatusCode::BAD_REQUEST) };
            let file_path = match state.db.with(|c| crate::library::mutate::track_path(c, id)) {
                Ok(Some(p)) => p,
                _ => return plain(StatusCode::NOT_FOUND),
            };
            serve_file(&file_path, req.headers().get(header::RANGE).and_then(|v| v.to_str().ok()))
        }
        ["art", hash, size] => serve_art(&state.art, hash, size),
        _ => plain(StatusCode::NOT_FOUND),
    }
}

fn serve_file(file_path: &str, range: Option<&str>) -> Response<Vec<u8>> {
    let mut f = match std::fs::File::open(file_path) {
        Ok(f) => f,
        Err(e) => {
            log::warn!(target: "PLAYER", "cannot open media {file_path}: {e}");
            return plain(StatusCode::NOT_FOUND);
        }
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    if len == 0 {
        return plain(StatusCode::NO_CONTENT);
    }
    let mime = mime_for(file_path);
    let (start, end, partial) = match range.and_then(|r| parse_range(r, len)) {
        Some((s, e)) => (s, e.min(s + MAX_CHUNK - 1), true),
        None if range.is_some() => {
            return Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{len}"))
                .header("Access-Control-Allow-Origin", "*")
                .body(Vec::new())
                .unwrap()
        }
        None => (0, (len - 1).min(MAX_CHUNK - 1), len > MAX_CHUNK),
    };
    let n = (end - start + 1) as usize;
    let mut buf = vec![0u8; n];
    if f.seek(SeekFrom::Start(start)).is_err() || f.read_exact(&mut buf).is_err() {
        return plain(StatusCode::INTERNAL_SERVER_ERROR);
    }
    let mut b = Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, n.to_string())
        .header("Access-Control-Allow-Origin", "*")
        .header(header::CACHE_CONTROL, "no-cache");
    if partial {
        b = b.status(StatusCode::PARTIAL_CONTENT).header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"));
    } else {
        b = b.status(StatusCode::OK);
    }
    b.body(buf).unwrap()
}

fn serve_art(art: &ArtCache, hash: &str, size: &str) -> Response<Vec<u8>> {
    if hash.len() != 32 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return plain(StatusCode::BAD_REQUEST);
    }
    let size: u32 = size.parse().unwrap_or(480);
    let path = if size == 0 { art.original_path(hash) } else { art.thumb_path(hash, if size <= 160 { 160 } else { 480 }) };
    match std::fs::read(&path) {
        Ok(bytes) => Response::builder()
            .header(header::CONTENT_TYPE, if size == 0 { "image/*" } else { "image/jpeg" })
            .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
            .header("Access-Control-Allow-Origin", "*")
            .body(bytes)
            .unwrap(),
        Err(_) => plain(StatusCode::NOT_FOUND),
    }
}

#[cfg(test)]
mod tests {
    use super::parse_range;
    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-", 100), Some((0, 99)));
        assert_eq!(parse_range("bytes=10-19", 100), Some((10, 19)));
        assert_eq!(parse_range("bytes=-10", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=150-", 100), None);
        assert_eq!(parse_range("bytes=90-500", 100), Some((90, 99)));
    }
}
