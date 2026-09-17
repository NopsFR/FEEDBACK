//! Safe tag editing: write to a temporary copy, verify it still parses, then atomically replace the original.
use lofty::config::WriteOptions;
use lofty::file::TaggedFileExt;
use lofty::prelude::{Accessor, ItemKey, TagExt};
use lofty::probe::Probe;
use lofty::tag::Tag;
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Deserialize, Default, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TagEdit {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_no: Option<u32>,
    pub disc_no: Option<u32>,
    pub year: Option<i32>,
    pub genre: Option<String>,
}

fn temp_path(path: &Path) -> PathBuf {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    path.with_file_name(format!(".{name}.feedback-edit"))
}

fn apply(tag: &mut Tag, e: &TagEdit) {
    let set = |v: &Option<String>| v.as_ref().map(|s| s.trim().to_string());
    if let Some(v) = set(&e.title) {
        if v.is_empty() { tag.remove_title() } else { tag.set_title(v) }
    }
    if let Some(v) = set(&e.artist) {
        if v.is_empty() { tag.remove_artist() } else { tag.set_artist(v) }
    }
    if let Some(v) = set(&e.album) {
        if v.is_empty() { tag.remove_album() } else { tag.set_album(v) }
    }
    if let Some(v) = set(&e.genre) {
        if v.is_empty() { tag.remove_genre() } else { tag.set_genre(v) }
    }
    if let Some(v) = set(&e.album_artist) {
        tag.remove_key(ItemKey::AlbumArtist);
        if !v.is_empty() {
            tag.insert_text(ItemKey::AlbumArtist, v);
        }
    }
    if let Some(n) = e.track_no {
        if n == 0 { tag.remove_track() } else { tag.set_track(n) }
    }
    if let Some(n) = e.disc_no {
        if n == 0 { tag.remove_disk() } else { tag.set_disk(n) }
    }
    if let Some(y) = e.year {
        tag.remove_key(ItemKey::Year);
        tag.remove_key(ItemKey::RecordingDate);
        if y > 0 {
            tag.insert_text(ItemKey::Year, y.to_string());
            tag.insert_text(ItemKey::RecordingDate, y.to_string());
        }
    }
}

pub fn write(path: &Path, edit: &TagEdit) -> Result<(), String> {
    let tmp = temp_path(path);
    std::fs::copy(path, &tmp).map_err(|e| format!("copy failed: {e}"))?;
    let result = (|| -> Result<(), String> {
        let mut tagged = Probe::open(&tmp).map_err(|e| e.to_string())?.guess_file_type().map_err(|e| e.to_string())?.read().map_err(|e| e.to_string())?;
        if tagged.primary_tag().is_none() {
            let tt = tagged.primary_tag_type();
            tagged.insert_tag(Tag::new(tt));
        }
        let tag = tagged.primary_tag_mut().ok_or("no writable tag for this format")?;
        apply(tag, edit);
        tag.save_to_path(&tmp, WriteOptions::default()).map_err(|e| e.to_string())?;
        // verify the edited copy still reads
        Probe::open(&tmp).map_err(|e| e.to_string())?.guess_file_type().map_err(|e| e.to_string())?.read().map_err(|e| format!("verification failed: {e}"))?;
        Ok(())
    })();
    match result {
        Ok(()) => std::fs::rename(&tmp, path).map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            format!("replace failed: {e}")
        }),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(e)
        }
    }
}
