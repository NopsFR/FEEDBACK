//! Direct downloads of media files the user is entitled to (e.g. a band's own MP3 link, a download URL they were
//! emailed after buying an album). Plain HTTP(S) file URLs only: no page scraping, no streaming-service ripping, no DRM.
use serde::Serialize;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub const MAX_BYTES: u64 = 4 * 1024 * 1024 * 1024;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub id: String,
    pub file_name: String,
    pub received: u64,
    pub total: Option<u64>,
    pub state: &'static str, // "downloading" | "done" | "error"
    pub message: Option<String>,
}

fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string();
    let cleaned = if cleaned.is_empty() { "download".to_string() } else { cleaned };
    cleaned.chars().take(160).collect()
}

struct Url {
    path: String,
}

fn parse(s: &str) -> Option<Url> {
    let (scheme, rest) = s.split_once("://")?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "https" && scheme != "http" {
        return None;
    }
    let host_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let host = &rest[..host_end];
    if host.is_empty() || host.contains(' ') {
        return None;
    }
    let path = rest[host_end..].split(['?', '#']).next().unwrap_or("").to_string();
    Some(Url { path })
}

fn filename_from(url: &Url, disposition: Option<&str>) -> String {
    if let Some(d) = disposition {
        for part in d.split(';') {
            let p = part.trim();
            if let Some(v) = p.strip_prefix("filename*=UTF-8''").or_else(|| p.strip_prefix("filename*=utf-8''")) {
                return sanitize(&percent_encoding::percent_decode_str(v).decode_utf8_lossy());
            }
            if let Some(v) = p.strip_prefix("filename=") {
                return sanitize(v.trim_matches('"'));
            }
        }
    }
    let last = url.path.rsplit('/').next().unwrap_or("");
    sanitize(&percent_encoding::percent_decode_str(last).decode_utf8_lossy())
}

pub fn validate_url(u: &str) -> Result<(), String> {
    parse(u.trim()).map(|_| ()).ok_or_else(|| "Use a direct http(s) link to an audio or video file.".into())
}

/// Blocking download into `dest_dir`. Returns the saved path.
pub fn download(url: &str, dest_dir: &Path, id: &str, mut progress: impl FnMut(Progress)) -> Result<PathBuf, String> {
    let parsed = parse(url.trim()).ok_or("Use a direct http(s) link to an audio or video file.")?;
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(15))
        .timeout_read(std::time::Duration::from_secs(60))
        .redirects(5)
        .user_agent("FEEDBACK/0.1 (personal music player)")
        .build();
    let resp = match agent.get(url.trim()).call() {
        Ok(r) => r,
        Err(ureq::Error::Status(code, _)) => return Err(format!("The server answered {code}. Check the link.")),
        Err(e) => return Err(format!("Couldn't connect: {e}")),
    };
    let ctype = resp.header("content-type").unwrap_or("").to_ascii_lowercase();
    let total = resp.header("content-length").and_then(|v| v.parse::<u64>().ok());
    if total.map(|t| t > MAX_BYTES).unwrap_or(false) {
        return Err("That file is larger than 4 GB.".into());
    }
    if ctype.starts_with("text/html") {
        return Err("That link is a web page, not a file. FEEDBACK only saves direct media files.".into());
    }
    let is_media_type = ctype.is_empty() || ctype.starts_with("audio/") || ctype.starts_with("video/") || ctype.starts_with("application/octet-stream") || ctype.starts_with("binary/");
    if !is_media_type {
        return Err(format!("Not an audio or video file ({ctype})."));
    }
    let mut name = filename_from(&parsed, resp.header("content-disposition"));
    if crate::metadata::tags::kind_for(Path::new(&name)).is_none() {
        let guessed = match ctype.split(';').next().unwrap_or("") {
            "audio/mpeg" => Some("mp3"),
            "audio/flac" | "audio/x-flac" => Some("flac"),
            "audio/wav" | "audio/x-wav" | "audio/wave" => Some("wav"),
            "audio/ogg" => Some("ogg"),
            "audio/opus" => Some("opus"),
            "audio/mp4" | "audio/x-m4a" | "audio/aac" => Some("m4a"),
            "video/mp4" => Some("mp4"),
            "video/webm" => Some("webm"),
            _ => None,
        };
        match guessed {
            Some(ext) => name = format!("{}.{ext}", name.trim_end_matches('.')),
            None => return Err("Couldn't tell what kind of file that is. Use a link that ends in .mp3, .flac, .m4a…".into()),
        }
    }
    std::fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    let mut dest = dest_dir.join(&name);
    if let (Ok(md), Some(t)) = (dest.metadata(), total) {
        if md.len() == t {
            return Err(format!("“{name}” is already in your imports."));
        }
    }
    if dest.exists() {
        let stem = dest.file_stem().and_then(|s| s.to_str()).unwrap_or("download").to_string();
        let ext = dest.extension().and_then(|s| s.to_str()).unwrap_or("").to_string();
        dest = (2..1000).map(|i| dest_dir.join(format!("{stem} ({i}).{ext}"))).find(|p| !p.exists()).ok_or("too many duplicates")?;
    }
    let part = dest_dir.join(format!(".{}.part", dest.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()));
    let mut file = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut reader = resp.into_reader().take(MAX_BYTES + 1);
    let mut buf = vec![0u8; 256 * 1024];
    let mut received: u64 = 0;
    let mut last = std::time::Instant::now();
    let file_name = dest.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    loop {
        let n = match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                let _ = std::fs::remove_file(&part);
                return Err(format!("Download interrupted: {e}"));
            }
        };
        received += n as u64;
        if received > MAX_BYTES {
            let _ = std::fs::remove_file(&part);
            return Err("That file is larger than 4 GB.".into());
        }
        if let Err(e) = file.write_all(&buf[..n]) {
            let _ = std::fs::remove_file(&part);
            return Err(format!("Couldn't write the file: {e}"));
        }
        if last.elapsed().as_millis() > 200 {
            last = std::time::Instant::now();
            progress(Progress { id: id.into(), file_name: file_name.clone(), received, total, state: "downloading", message: None });
        }
    }
    drop(file);
    if total.map(|t| received != t).unwrap_or(false) {
        let _ = std::fs::remove_file(&part);
        return Err("The download ended early.".into());
    }
    std::fs::rename(&part, &dest).map_err(|e| e.to_string())?;
    // Final check: audio must be readable, otherwise remove it again.
    if crate::metadata::tags::kind_for(&dest) == Some(crate::metadata::tags::MediaKind::Audio) && crate::metadata::tags::read(&dest).is_err() {
        let _ = std::fs::remove_file(&dest);
        return Err("The file downloaded, but it isn't a readable audio file.".into());
    }
    progress(Progress { id: id.into(), file_name, received, total: Some(received), state: "done", message: None });
    log::info!(target: "DOWNLOAD", "saved {} ({} bytes)", dest.display(), received);
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn urls_and_names() {
        assert!(validate_url("https://example.com/a.mp3").is_ok());
        assert!(validate_url("ftp://example.com/a.mp3").is_err());
        assert!(validate_url("file:///C:/x.mp3").is_err());
        let u = parse("https://x.org/music/My%20Song.flac?dl=1").unwrap();
        assert_eq!(filename_from(&u, None), "My Song.flac");
        assert_eq!(filename_from(&u, Some("attachment; filename=\"a/b:c.mp3\"")), "a_b_c.mp3");
        assert_eq!(sanitize("..\\..\\evil.mp3"), "_.._evil.mp3");
    }
}
