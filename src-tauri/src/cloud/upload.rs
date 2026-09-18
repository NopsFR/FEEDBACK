//! Putting the user's own audio into their private cloud, so it plays anywhere.
//!
//! Content-addressed: the same file imported twice is one object and one row. The upload streams
//! from disk rather than being read into memory, and the object path always starts with the user's
//! id, which is what the storage policy checks.
use super::{auth, classify, CloudError, CloudResult, BASE_URL, BUCKET, PUBLISHABLE_KEY};
use crate::database::Db;
use serde::Serialize;
use std::path::Path;
use std::time::Duration;

#[derive(Debug, Default, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UploadSummary {
    pub uploaded: usize,
    /// Already in the cloud, byte for byte.
    pub skipped: usize,
    pub failed: usize,
    pub bytes: u64,
}

pub fn hash_file(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = blake3::Hasher::new();
    std::io::copy(&mut file, &mut hasher)?;
    Ok(hasher.finalize().to_hex().to_string())
}

pub fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "m4a" | "mp4" | "aac" => "audio/mp4",
        "ogg" | "oga" => "audio/ogg",
        "opus" => "audio/opus",
        "wav" => "audio/wav",
        "aiff" | "aif" => "audio/aiff",
        _ => "application/octet-stream",
    }
}

/// `<user id>/<hash>.<ext>` — the first segment is what row-level security checks.
pub fn object_path(user_id: &str, hash: &str, path: &Path) -> String {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("bin").to_ascii_lowercase();
    let ext: String = ext.chars().filter(|c| c.is_ascii_alphanumeric()).take(8).collect();
    format!("{user_id}/{hash}.{}", if ext.is_empty() { "bin".to_string() } else { ext })
}

/// Stream one file into storage. Returns the object path; an object that already exists is left
/// alone, because the hash means the bytes are identical.
pub fn put_object(db: &Db, path: &Path) -> CloudResult<(String, String, u64)> {
    let session = auth::current(db)?;
    let meta = std::fs::metadata(path).map_err(|e| CloudError::Rejected(format!("Couldn't read that file: {e}")))?;
    let hash = hash_file(path).map_err(|e| CloudError::Rejected(format!("Couldn't read that file: {e}")))?;
    let object = object_path(&session.user_id, &hash, path);
    let file = std::fs::File::open(path).map_err(|e| CloudError::Rejected(format!("Couldn't read that file: {e}")))?;

    let response = ureq::post(&format!("{BASE_URL}/storage/v1/object/{BUCKET}/{object}"))
        .set("apikey", PUBLISHABLE_KEY)
        .set("Authorization", &format!("Bearer {}", session.access_token))
        .set("Content-Type", mime_for(path))
        .set("x-upsert", "true")
        .timeout(Duration::from_secs(600))
        .send(file);

    match response {
        Ok(_) => Ok((hash, object, meta.len())),
        Err(ureq::Error::Status(409, _)) => Ok((hash, object, meta.len())), // already there, same bytes
        Err(e) => Err(classify(e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn object_paths_are_owned_and_content_addressed() {
        let path = Path::new("/music/song.FLAC");
        assert_eq!(object_path("user-1", "abc123", path), "user-1/abc123.flac");
        // No traversal or surprises from odd extensions.
        assert_eq!(object_path("user-1", "abc", Path::new("/music/song.we..ird")), "user-1/abc.ird");
        assert_eq!(object_path("user-1", "abc", Path::new("/music/song")), "user-1/abc.bin");
    }

    #[test]
    fn identical_files_hash_the_same_and_different_ones_dont() {
        let dir = std::env::temp_dir().join(format!("feedback-upload-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a.mp3");
        let b = dir.join("b.mp3");
        let c = dir.join("c.mp3");
        std::fs::write(&a, b"same bytes").unwrap();
        std::fs::write(&b, b"same bytes").unwrap();
        std::fs::write(&c, b"other bytes").unwrap();
        assert_eq!(hash_file(&a).unwrap(), hash_file(&b).unwrap());
        assert_ne!(hash_file(&a).unwrap(), hash_file(&c).unwrap());
        assert_eq!(mime_for(&a), "audio/mpeg");
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// Upload the audio for tracks the user chose (or the whole library), attach each object to its
/// cloud track row, and remember locally that it is up there.
///
/// Nothing is deleted and nothing is overwritten: an object whose hash already exists is reused,
/// and a failure on one file does not stop the rest.
pub fn upload_tracks(db: &Db, track_ids: &[i64], mut progress: impl FnMut(usize, usize, &str)) -> CloudResult<UploadSummary> {
    use super::sync;
    let session = auth::current(db)?;
    let mut summary = UploadSummary::default();
    let mapping = sync::cloud_for_local(db).unwrap_or_default();
    let total = track_ids.len();

    for (index, track_id) in track_ids.iter().enumerate() {
        let Ok(Some(path)) = db.with(|c| crate::library::mutate::track_path(c, *track_id)) else {
            summary.failed += 1;
            continue;
        };
        let path = std::path::PathBuf::from(path);
        progress(index + 1, total, path.file_name().and_then(|n| n.to_str()).unwrap_or(""));

        let already: Option<String> = db.with(|c| {
            use rusqlite::OptionalExtension;
            c.query_row("SELECT object_path FROM cloud_track WHERE track_id = ?1 AND object_path IS NOT NULL", [*track_id], |r| r.get(0)).optional()
        }).unwrap_or(None);
        if already.is_some() {
            summary.skipped += 1;
            continue;
        }

        let (hash, object, bytes) = match put_object(db, &path) {
            Ok(v) => v,
            Err(CloudError::SignedOut) => return Err(CloudError::SignedOut),
            Err(CloudError::Unreachable) => return Err(CloudError::Unreachable),
            Err(_) => {
                summary.failed += 1;
                continue;
            }
        };

        // Record the object, then point the track row at it. Both are the user's own rows.
        let upload = ureq::post(&format!("{BASE_URL}/rest/v1/uploads?on_conflict=user_id,content_hash"))
            .set("apikey", PUBLISHABLE_KEY)
            .set("Authorization", &format!("Bearer {}", session.access_token))
            .set("Content-Type", "application/json")
            .set("Prefer", "return=representation,resolution=merge-duplicates")
            .timeout(Duration::from_secs(30))
            .send_json(serde_json::json!([{
                "user_id": session.user_id,
                "content_hash": hash,
                "object_path": object,
                "bytes": bytes,
                "mime": mime_for(&path),
                "original_name": path.file_name().and_then(|n| n.to_str()).unwrap_or(""),
            }]))
            .map_err(classify)?
            .into_json::<serde_json::Value>()
            .unwrap_or(serde_json::Value::Null);
        let upload_id = upload.as_array().and_then(|a| a.first()).and_then(|r| r.get("id")).and_then(|v| v.as_str()).map(str::to_string);

        if let (Some(cloud_track), Some(upload_id)) = (mapping.get(track_id), upload_id) {
            let _ = ureq::request("PATCH", &format!("{BASE_URL}/rest/v1/tracks?id=eq.{cloud_track}"))
                .set("apikey", PUBLISHABLE_KEY)
                .set("Authorization", &format!("Bearer {}", session.access_token))
                .set("Content-Type", "application/json")
                .set("Prefer", "return=minimal")
                .timeout(Duration::from_secs(30))
                .send_json(serde_json::json!({ "upload_id": upload_id, "content_hash": hash }));
        }

        let _ = db.with(|c| {
            c.execute(
                "UPDATE cloud_track SET object_path = ?2, uploaded_at = ?3 WHERE track_id = ?1",
                rusqlite::params![track_id, object, crate::database::now_ms()],
            )?;
            Ok(())
        });
        summary.uploaded += 1;
        summary.bytes += bytes;
    }
    Ok(summary)
}

/// The object backing a local track, if its audio is in the cloud.
pub fn object_for(db: &Db, track_id: i64) -> Option<String> {
    db.with(|c| {
        use rusqlite::OptionalExtension;
        c.query_row("SELECT object_path FROM cloud_track WHERE track_id = ?1", [track_id], |r| r.get::<_, Option<String>>(0)).optional()
    })
    .ok()
    .flatten()
    .flatten()
}
