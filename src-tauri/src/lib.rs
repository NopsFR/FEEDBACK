mod commands;
mod database;
mod downloads;
mod error;
mod library;
mod media;
mod metadata;
mod state;
mod sync;
mod transcode;

use state::{AppState, ScanControl};
use tauri::Manager;

pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }));
    }

    builder
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) { log::LevelFilter::Debug } else { log::LevelFilter::Info })
                .level_for("tao", log::LevelFilter::Warn)
                .level_for("notify", log::LevelFilter::Warn)
                .max_file_size(2_000_000)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: Some("feedback".into()) }),
                ])
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .register_asynchronous_uri_scheme_protocol("fbmedia", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || {
                let response = media::handle(&app, &request);
                responder.respond(response);
            });
        })
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let cache_dir = app.path().app_cache_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            std::fs::create_dir_all(&cache_dir)?;
            let db_path = data_dir.join("feedback.db");
            let db = database::Db::open(&db_path).map_err(|e| {
                log::error!(target: "DATABASE", "open/migrate failed: {e}");
                e
            })?;
            let imports_dir = app.path().audio_dir().unwrap_or_else(|_| data_dir.clone()).join("FEEDBACK Imports");
            log::info!(target: "LIBRARY", "database at {}", db_path.display());
            app.manage(AppState {
                db,
                art: library::artwork::ArtCache::new(cache_dir.join("art")),
                scan: parking_lot::Mutex::new(ScanControl::default()),
                watcher: parking_lot::Mutex::new(None),
                imports_dir,
                lan: parking_lot::Mutex::new(None),
            });
            let handle = app.handle().clone();
            // Watch folders + a quiet incremental rescan shortly after launch.
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(1500));
                commands::restart_watcher(&handle);
                commands::start_scan_inner(&handle);
                commands::lan_autostart(&handle);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::library_overview,
            commands::library_tracks,
            commands::tracks_by_ids,
            commands::library_albums,
            commands::library_artists,
            commands::library_genres,
            commands::album_detail,
            commands::artist_detail,
            commands::albums_by,
            commands::search,
            commands::home,
            commands::smart_list,
            commands::list_folders,
            commands::add_folder,
            commands::remove_folder,
            commands::rescan,
            commands::cancel_scan,
            commands::import_paths,
            commands::set_favourite,
            commands::record_play,
            commands::playlists,
            commands::playlist_detail,
            commands::playlist_create,
            commands::playlist_rename,
            commands::playlist_delete,
            commands::playlist_duplicate,
            commands::playlist_add,
            commands::playlist_remove,
            commands::playlist_reorder,
            commands::get_settings,
            commands::set_setting,
            commands::track_file_path,
            commands::get_lyrics,
            commands::remove_tracks,
            commands::lan_status,
            commands::edit_tracks,
            commands::set_album_art,
            commands::download_url,
            commands::lan_set_enabled,
            commands::lan_new_code,
            commands::lan_revoke,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FEEDBACK");
}
