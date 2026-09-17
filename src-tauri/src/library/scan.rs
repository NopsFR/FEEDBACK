//! Background library scanner. Incremental: unchanged files (size + mtime) are skipped.
use super::artwork::ArtCache;
use super::store::{self, FileFacts};
use crate::database::{now_ms, open_connection};
use crate::metadata::{lyrics, tags};
use rayon::prelude::*;
use rusqlite::params;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Clone, Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub phase: &'static str, // "walking" | "reading" | "finishing" | "done"
    pub done: usize,
    pub total: usize,
    pub added: usize,
    pub updated: usize,
    pub missing: usize,
    pub errors: usize,
}

struct Found {
    folder_id: i64,
    path: PathBuf,
    size: u64,
    mtime: i64,
}

fn mtime_of(md: &std::fs::Metadata) -> i64 {
    md.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

pub fn scan(
    db_path: &Path,
    art: &ArtCache,
    folders: &[(i64, String)],
    cancel: Arc<AtomicBool>,
    mut progress: impl FnMut(&ScanProgress),
) -> rusqlite::Result<ScanProgress> {
    let mut conn = open_connection(db_path)?;
    let mut p = ScanProgress { phase: "walking", ..Default::default() };
    progress(&p);

    // 1. walk
    let mut found: Vec<Found> = Vec::new();
    for (folder_id, root) in folders {
        let root_path = Path::new(root);
        let available = root_path.is_dir();
        conn.execute("UPDATE library_folder SET available = ?2 WHERE id = ?1", params![folder_id, available as i32])?;
        if !available {
            log::warn!(target: "LIBRARY", "folder unavailable: {root}");
            continue;
        }
        for entry in walkdir::WalkDir::new(root_path).follow_links(false).into_iter().filter_map(|e| e.ok()) {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            if !entry.file_type().is_file() || tags::kind_for(entry.path()).is_none() {
                continue;
            }
            let name = entry.file_name().to_string_lossy();
            if name.starts_with("._") {
                continue; // macOS resource forks
            }
            if let Ok(md) = entry.metadata() {
                found.push(Found { folder_id: *folder_id, path: entry.into_path(), size: md.len(), mtime: mtime_of(&md) });
            }
        }
    }
    p.total = found.len();
    progress(&p);

    // 2. diff against DB (only folders that were actually walked)
    let walked: Vec<i64> = folders.iter().filter(|(_, r)| Path::new(r).is_dir()).map(|(id, _)| *id).collect();
    let mut known: HashMap<String, (i64, u64, i64, bool)> = HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT id, path, file_size, mtime, missing, folder_id FROM track")?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(1)?, (r.get::<_, i64>(0)?, r.get::<_, i64>(2)? as u64, r.get::<_, i64>(3)?, r.get::<_, i64>(4)? != 0), r.get::<_, Option<i64>>(5)?))
        })?;
        for row in rows.flatten() {
            if row.2.map(|f| walked.contains(&f)).unwrap_or(true) {
                known.insert(row.0, row.1);
            }
        }
    }
    let mut todo: Vec<&Found> = Vec::new();
    let mut seen_ids: Vec<i64> = Vec::new();
    for f in &found {
        let key = f.path.to_string_lossy().to_string();
        match known.remove(&key) {
            Some((id, size, mtime, missing)) if size == f.size && mtime == f.mtime => {
                if missing {
                    seen_ids.push(id);
                }
                p.done += 1;
            }
            Some(_) => {
                p.updated += 1;
                todo.push(f);
            }
            None => {
                p.added += 1;
                todo.push(f);
            }
        }
    }
    if !seen_ids.is_empty() {
        let tx = conn.transaction()?;
        for id in &seen_ids {
            tx.execute("UPDATE track SET missing = 0 WHERE id = ?1", [id])?;
        }
        tx.commit()?;
    }
    p.phase = "reading";
    progress(&p);

    // 3. read tags in parallel, write in batches
    let mut folder_art: HashMap<PathBuf, Option<String>> = HashMap::new();
    for chunk in todo.chunks(48) {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let metas: Vec<(&Found, Result<tags::TrackMeta, String>)> = chunk.par_iter().map(|f| (*f, tags::read(&f.path))).collect();
        let tx = conn.transaction()?;
        for (f, meta) in metas {
            let kind = tags::kind_for(&f.path).unwrap_or(tags::MediaKind::Audio);
            let meta = match meta {
                Ok(m) => m,
                Err(e) => {
                    if kind == tags::MediaKind::Audio {
                        log::warn!(target: "IMPORT", "unreadable {}: {e}", f.path.display());
                        p.errors += 1;
                        p.done += 1;
                        continue;
                    }
                    tags::TrackMeta::default()
                }
            };
            let dir = f.path.parent().map(Path::to_path_buf).unwrap_or_default();
            let mut art_hash = meta.picture.as_ref().and_then(|(bytes, mime)| art.store(&tx, bytes, mime.as_deref()));
            if art_hash.is_none() {
                art_hash = folder_art.entry(dir.clone()).or_insert_with(|| art.from_folder(&tx, &dir)).clone();
            }
            let (file_track_no, file_title) = tags::title_from_filename(&f.path);
            let dir_album = dir.file_name().map(|s| s.to_string_lossy().to_string());
            let dir_artist = dir.parent().and_then(|d| d.file_name()).map(|s| s.to_string_lossy().to_string());
            let path_s = f.path.to_string_lossy().to_string();
            let filename = f.path.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            let facts = FileFacts {
                folder_id: f.folder_id,
                path: &path_s,
                filename: &filename,
                size: f.size,
                mtime: f.mtime,
                kind,
                artwork_hash: art_hash,
                has_lyrics: lyrics::sidecar_exists(&f.path),
                dir_album,
                dir_artist,
                file_title,
                file_track_no,
            };
            if let Err(e) = store::upsert_track(&tx, &facts, &meta) {
                log::error!(target: "DATABASE", "upsert failed for {path_s}: {e}");
                p.errors += 1;
            }
            p.done += 1;
        }
        tx.commit()?;
        progress(&p);
    }

    // 4. anything left in `known` wasn't found on disk
    p.phase = "finishing";
    progress(&p);
    let tx = conn.transaction()?;
    for (_, (id, _, _, missing)) in known.iter() {
        if !missing {
            tx.execute("UPDATE track SET missing = 1 WHERE id = ?1", [id])?;
            p.missing += 1;
        }
    }
    let now = now_ms();
    for id in &walked {
        tx.execute("UPDATE library_folder SET last_scan_at = ?2 WHERE id = ?1", params![id, now])?;
    }
    store::prune(&tx)?;
    tx.commit()?;
    let _ = conn.execute_batch("PRAGMA optimize;");
    p.phase = "done";
    progress(&p);
    log::info!(target: "LIBRARY", "scan complete: {:?}", p);
    Ok(p)
}
