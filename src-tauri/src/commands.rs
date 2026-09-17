//! IPC surface. All commands are async so SQLite work never blocks the UI thread.
use crate::error::{AppError, AppResult};
use crate::library::{mutate, query, scan, watch};
use crate::state::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

type S<'a> = State<'a, AppState>;

#[tauri::command]
pub async fn app_info(app: AppHandle) -> AppResult<serde_json::Value> {
    Ok(serde_json::json!({
        "version": app.package_info().version.to_string(),
        "platform": std::env::consts::OS,
        "dataDir": app.path().app_data_dir().ok(),
    }))
}

#[tauri::command]
pub async fn library_overview(state: S<'_>) -> AppResult<query::Overview> {
    Ok(state.db.with(query::overview)?)
}

#[tauri::command]
pub async fn library_tracks(state: S<'_>, kind: Option<String>) -> AppResult<Vec<query::TrackRow>> {
    let kind = kind.unwrap_or_else(|| "audio".into());
    Ok(state.db.with(|c| query::all_tracks(c, &kind))?)
}

#[tauri::command]
pub async fn tracks_by_ids(state: S<'_>, ids: Vec<i64>) -> AppResult<Vec<query::TrackRow>> {
    Ok(state.db.with(|c| query::tracks_by_ids(c, &ids))?)
}

#[tauri::command]
pub async fn library_albums(state: S<'_>) -> AppResult<Vec<query::AlbumRow>> {
    Ok(state.db.with(query::all_albums)?)
}

#[tauri::command]
pub async fn library_artists(state: S<'_>) -> AppResult<Vec<query::ArtistRow>> {
    Ok(state.db.with(query::all_artists)?)
}

#[tauri::command]
pub async fn library_genres(state: S<'_>) -> AppResult<Vec<query::GenreRow>> {
    Ok(state.db.with(query::genres)?)
}

#[tauri::command]
pub async fn album_detail(state: S<'_>, id: i64) -> AppResult<query::AlbumDetail> {
    state.db.with(|c| query::album(c, id))?.ok_or(AppError::NotFound)
}

#[tauri::command]
pub async fn artist_detail(state: S<'_>, id: i64) -> AppResult<query::ArtistDetail> {
    state.db.with(|c| query::artist(c, id))?.ok_or(AppError::NotFound)
}

#[tauri::command]
pub async fn albums_by(state: S<'_>, genre: Option<String>, year: Option<i64>) -> AppResult<Vec<query::AlbumRow>> {
    Ok(state.db.with(|c| match (genre.as_deref(), year) {
        (Some(g), _) => query::albums_for_genre(c, g),
        (None, Some(y)) => query::albums_for_year(c, y),
        _ => query::all_albums(c),
    })?)
}

#[tauri::command]
pub async fn search(state: S<'_>, q: String) -> AppResult<query::SearchResult> {
    Ok(state.db.with(|c| query::search(c, &q))?)
}

#[tauri::command]
pub async fn home(state: S<'_>) -> AppResult<query::Home> {
    Ok(state.db.with(query::home)?)
}

#[tauri::command]
pub async fn smart_list(state: S<'_>, which: String, limit: Option<i64>) -> AppResult<Vec<query::TrackRow>> {
    let limit = limit.unwrap_or(200).clamp(1, 5000);
    Ok(state.db.with(|c| match which.as_str() {
        "favourites" => query::favourites(c),
        "history" => query::history(c, limit),
        "most-played" => query::most_played(c, limit),
        "recently-added" => query::recently_added_tracks(c, limit),
        _ => Ok(vec![]),
    })?)
}

// ---------- folders & scanning ----------
#[tauri::command]
pub async fn list_folders(state: S<'_>) -> AppResult<Vec<mutate::FolderRow>> {
    Ok(state.db.with(mutate::folders)?)
}

#[tauri::command]
pub async fn add_folder(app: AppHandle, state: S<'_>, path: String) -> AppResult<i64> {
    let p = PathBuf::from(&path);
    if !p.is_dir() {
        return Err(AppError::User("That folder doesn't exist or can't be opened.".into()));
    }
    let canonical = dunce_like(&p);
    let id = state.db.with(|c| mutate::add_folder(c, &canonical))?;
    restart_watcher(&app);
    start_scan_inner(&app);
    Ok(id)
}

/// Strip the Windows verbatim prefix so paths stay readable and stable.
fn dunce_like(p: &Path) -> String {
    let s = std::fs::canonicalize(p).map(|c| c.to_string_lossy().to_string()).unwrap_or_else(|_| p.to_string_lossy().to_string());
    s.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(s)
}

#[tauri::command]
pub async fn remove_folder(app: AppHandle, state: S<'_>, id: i64) -> AppResult<()> {
    state.db.with_mut(|c| mutate::remove_folder(c, id))?;
    restart_watcher(&app);
    let _ = app.emit("library-changed", ());
    Ok(())
}

#[tauri::command]
pub async fn rescan(app: AppHandle) -> AppResult<()> {
    start_scan_inner(&app);
    Ok(())
}

#[tauri::command]
pub async fn cancel_scan(state: S<'_>) -> AppResult<()> {
    state.scan.lock().cancel.store(true, Ordering::Relaxed);
    Ok(())
}

pub fn start_scan_inner(app: &AppHandle) {
    let state = app.state::<AppState>();
    {
        let mut ctl = state.scan.lock();
        if ctl.running {
            ctl.rerun = true;
            return;
        }
        ctl.running = true;
        ctl.cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
    }
    let app = app.clone();
    std::thread::Builder::new()
        .name("library-scan".into())
        .spawn(move || loop {
            let state = app.state::<AppState>();
            let folders: Vec<(i64, String)> = state.db.with(mutate::folders).map(|f| f.into_iter().map(|r| (r.id, r.path)).collect()).unwrap_or_default();
            let cancel = state.scan.lock().cancel.clone();
            let mut last_emit = std::time::Instant::now() - std::time::Duration::from_secs(1);
            let emitter = app.clone();
            let result = scan::scan(state.db.path(), &state.art, &folders, cancel, |p| {
                if p.phase != "reading" || last_emit.elapsed().as_millis() > 120 {
                    let _ = emitter.emit("scan-progress", p);
                    last_emit = std::time::Instant::now();
                }
            });
            if let Err(e) = result {
                log::error!(target: "LIBRARY", "scan failed: {e}");
                let _ = app.emit("scan-progress", scan::ScanProgress { phase: "done", errors: 1, ..Default::default() });
            }
            let _ = app.emit("library-changed", ());
            let mut ctl = state.scan.lock();
            if ctl.rerun {
                ctl.rerun = false;
                continue;
            }
            ctl.running = false;
            break;
        })
        .expect("spawn scan thread");
}

pub fn restart_watcher(app: &AppHandle) {
    let state = app.state::<AppState>();
    let paths: Vec<PathBuf> = state.db.with(mutate::folders).map(|f| f.into_iter().filter(|r| r.available).map(|r| PathBuf::from(r.path)).collect()).unwrap_or_default();
    let handle = app.clone();
    let w = if paths.is_empty() { None } else { watch::start(paths, move || start_scan_inner(&handle)) };
    *state.watcher.lock() = w;
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub copied: usize,
    pub skipped: usize,
    pub folders_added: usize,
    pub rejected: usize,
}

/// Dropped/picked items: folders become library folders; loose media files are copied into the FEEDBACK imports folder.
#[tauri::command]
pub async fn import_paths(app: AppHandle, state: S<'_>, paths: Vec<String>) -> AppResult<ImportResult> {
    let mut r = ImportResult { copied: 0, skipped: 0, folders_added: 0, rejected: 0 };
    let imports = state.imports_dir.clone();
    let mut needs_imports_folder = false;
    for p in paths {
        let path = PathBuf::from(&p);
        if path.is_dir() {
            state.db.with(|c| mutate::add_folder(c, &dunce_like(&path)))?;
            r.folders_added += 1;
        } else if path.is_file() && crate::metadata::tags::kind_for(&path).is_some() {
            std::fs::create_dir_all(&imports)?;
            let name = path.file_name().map(|n| n.to_owned()).unwrap_or_default();
            let dest = imports.join(&name);
            let same = dest.metadata().ok().zip(path.metadata().ok()).map(|(a, b)| a.len() == b.len()).unwrap_or(false);
            if same {
                r.skipped += 1;
                continue;
            }
            let dest = if dest.exists() { unique_name(&dest) } else { dest };
            std::fs::copy(&path, &dest)?;
            r.copied += 1;
            needs_imports_folder = true;
        } else {
            r.rejected += 1;
        }
    }
    if needs_imports_folder {
        state.db.with(|c| mutate::add_folder(c, &dunce_like(&imports)))?;
    }
    if r.copied + r.folders_added > 0 {
        restart_watcher(&app);
        start_scan_inner(&app);
    }
    Ok(r)
}

fn unique_name(p: &Path) -> PathBuf {
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("track");
    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("");
    (2..1000).map(|i| p.with_file_name(format!("{stem} ({i}).{ext}"))).find(|c| !c.exists()).unwrap_or_else(|| p.to_path_buf())
}

// ---------- user data ----------
#[tauri::command]
pub async fn set_favourite(state: S<'_>, track_id: i64, on: bool) -> AppResult<()> {
    Ok(state.db.with(|c| mutate::toggle_favourite(c, track_id, on))?)
}

#[tauri::command]
pub async fn record_play(state: S<'_>, track_id: i64, ms_played: i64, skipped: bool) -> AppResult<()> {
    Ok(state.db.with(|c| mutate::record_play(c, track_id, ms_played, skipped))?)
}

#[tauri::command]
pub async fn playlists(state: S<'_>) -> AppResult<Vec<query::PlaylistRow>> {
    Ok(state.db.with(query::playlists)?)
}

#[tauri::command]
pub async fn playlist_detail(state: S<'_>, id: i64) -> AppResult<query::PlaylistDetail> {
    state.db.with(|c| query::playlist(c, id))?.ok_or(AppError::NotFound)
}

#[tauri::command]
pub async fn playlist_create(state: S<'_>, name: String, track_ids: Option<Vec<i64>>) -> AppResult<i64> {
    let name = if name.trim().is_empty() { "Untitled playlist".to_string() } else { name };
    let id = state.db.with(|c| mutate::create_playlist(c, &name))?;
    if let Some(ids) = track_ids {
        state.db.with_mut(|c| mutate::add_to_playlist(c, id, &ids))?;
    }
    Ok(id)
}

#[tauri::command]
pub async fn playlist_rename(state: S<'_>, id: i64, name: String, description: Option<String>) -> AppResult<()> {
    if name.trim().is_empty() {
        return Err(AppError::User("A playlist needs a name.".into()));
    }
    Ok(state.db.with(|c| mutate::rename_playlist(c, id, &name, description.as_deref()))?)
}

#[tauri::command]
pub async fn playlist_delete(state: S<'_>, id: i64) -> AppResult<()> {
    Ok(state.db.with(|c| mutate::delete_playlist(c, id))?)
}

#[tauri::command]
pub async fn playlist_duplicate(state: S<'_>, id: i64) -> AppResult<i64> {
    Ok(state.db.with_mut(|c| mutate::duplicate_playlist(c, id))?)
}

#[tauri::command]
pub async fn playlist_add(state: S<'_>, id: i64, track_ids: Vec<i64>) -> AppResult<usize> {
    Ok(state.db.with_mut(|c| mutate::add_to_playlist(c, id, &track_ids))?)
}

#[tauri::command]
pub async fn playlist_remove(state: S<'_>, id: i64, entry_ids: Vec<i64>) -> AppResult<()> {
    Ok(state.db.with_mut(|c| mutate::remove_from_playlist(c, id, &entry_ids))?)
}

#[tauri::command]
pub async fn playlist_reorder(state: S<'_>, id: i64, entry_ids: Vec<i64>) -> AppResult<()> {
    Ok(state.db.with_mut(|c| mutate::reorder_playlist(c, id, &entry_ids))?)
}

#[tauri::command]
pub async fn get_settings(state: S<'_>) -> AppResult<serde_json::Map<String, serde_json::Value>> {
    Ok(state.db.with(mutate::settings)?)
}

#[tauri::command]
pub async fn set_setting(state: S<'_>, key: String, value: serde_json::Value) -> AppResult<()> {
    if key.len() > 64 {
        return Err(AppError::User("Invalid setting.".into()));
    }
    Ok(state.db.with(|c| mutate::set_setting(c, &key, &value))?)
}

#[tauri::command]
pub async fn track_file_path(state: S<'_>, id: i64) -> AppResult<String> {
    state.db.with(|c| mutate::track_path(c, id))?.ok_or(AppError::NotFound)
}

#[tauri::command]
pub async fn get_lyrics(state: S<'_>, id: i64) -> AppResult<Option<crate::metadata::lyrics::Lyrics>> {
    let path = state.db.with(|c| mutate::track_path(c, id))?.ok_or(AppError::NotFound)?;
    Ok(crate::metadata::lyrics::find(Path::new(&path)))
}

#[tauri::command]
pub async fn remove_tracks(app: AppHandle, state: S<'_>, ids: Vec<i64>) -> AppResult<()> {
    state.db.with_mut(|c| mutate::remove_tracks(c, &ids))?;
    let _ = app.emit("library-changed", ());
    Ok(())
}
