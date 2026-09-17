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
            let row = state.db.with(|c| {
                use rusqlite::OptionalExtension;
                c.query_row("SELECT path, codec, duration_ms FROM track WHERE id = ?1", [id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, i64>(2)?)))
                    .optional()
            });
            let Ok(Some((file_path, codec, duration_ms))) = row else { return plain(StatusCode::NOT_FOUND) };
            let range = req.headers().get(header::RANGE).and_then(|v| v.to_str().ok());
            if crate::transcode::needs_transcode(codec.as_deref()) {
                return serve_transcoded(&file_path, range, duration_ms);
            }
            serve_file(&file_path, range)
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

fn serve_transcoded(file_path: &str, range: Option<&str>, duration_ms: i64) -> Response<Vec<u8>> {
    const CHUNK: u64 = 2 * 1024 * 1024;
    let start = range
        .and_then(|r| r.strip_prefix("bytes="))
        .and_then(|r| r.split('-').next())
        .and_then(|a| a.parse::<u64>().ok())
        .unwrap_or(0);
    match crate::transcode::read_window(std::path::Path::new(file_path), start, CHUNK, duration_ms) {
        Ok(w) => {
            let end = w.start + w.bytes.len() as u64 - 1;
            Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, "audio/wav")
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_RANGE, format!("bytes {}-{}/{}", w.start, end, w.total))
                .header(header::CONTENT_LENGTH, w.bytes.len().to_string())
                .header("Access-Control-Allow-Origin", "*")
                .body(w.bytes)
                .unwrap()
        }
        Err(e) => {
            log::warn!(target: "PLAYER", "transcode failed for {file_path}: {e}");
            plain(StatusCode::UNSUPPORTED_MEDIA_TYPE)
        }
    }
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
