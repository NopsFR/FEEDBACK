use crate::database::Db;
use crate::library::artwork::ArtCache;
use crate::library::watch::FolderWatcher;
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

#[derive(Default)]
pub struct ScanControl {
    pub running: bool,
    pub rerun: bool,
    pub cancel: Arc<AtomicBool>,
}

pub struct AppState {
    pub db: Db,
    pub art: ArtCache,
    pub scan: Mutex<ScanControl>,
    pub watcher: Mutex<Option<FolderWatcher>>,
    pub imports_dir: PathBuf,
    pub lan: Mutex<Option<crate::sync::server::Running>>,
}
