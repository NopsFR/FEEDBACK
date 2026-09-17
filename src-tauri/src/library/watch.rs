//! Folder watching: debounced; any relevant change triggers an incremental rescan.
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::{Duration, Instant};

pub struct FolderWatcher {
    _watcher: RecommendedWatcher,
}

pub fn start(paths: Vec<PathBuf>, on_change: impl Fn() + Send + 'static) -> Option<FolderWatcher> {
    let (tx, rx) = mpsc::channel::<()>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            let relevant = ev.paths.iter().any(|p| crate::metadata::tags::kind_for(p).is_some() || p.extension().is_none());
            if relevant && !matches!(ev.kind, notify::EventKind::Access(_)) {
                let _ = tx.send(());
            }
        }
    })
    .ok()?;
    for p in &paths {
        if let Err(e) = watcher.watch(p, RecursiveMode::Recursive) {
            log::warn!(target: "LIBRARY", "cannot watch {}: {e}", p.display());
        }
    }
    std::thread::spawn(move || {
        // debounce: wait for 4s of quiet after the first event
        while rx.recv().is_ok() {
            let mut last = Instant::now();
            loop {
                match rx.recv_timeout(Duration::from_millis(500)) {
                    Ok(()) => last = Instant::now(),
                    Err(mpsc::RecvTimeoutError::Timeout) if last.elapsed() > Duration::from_secs(4) => break,
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            on_change();
        }
    });
    Some(FolderWatcher { _watcher: watcher })
}
