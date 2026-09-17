//! Upserts for artists / albums / tracks + FTS maintenance.
use crate::database::now_ms;
use crate::metadata::tags::{MediaKind, TrackMeta};
use rusqlite::{params, Connection, OptionalExtension};

pub fn norm_key(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

pub fn sort_name(s: &str) -> String {
    let lower = s.trim().to_lowercase();
    lower.strip_prefix("the ").map(str::to_string).unwrap_or(lower)
}

pub fn artist_id(conn: &Connection, name: &str) -> rusqlite::Result<i64> {
    let key = norm_key(name);
    if let Some(id) = conn.query_row("SELECT id FROM artist WHERE name_key = ?1", [&key], |r| r.get(0)).optional()? {
        return Ok(id);
    }
    conn.execute("INSERT INTO artist(name, sort_name, name_key) VALUES (?1, ?2, ?3)", params![name.trim(), sort_name(name), key])?;
    Ok(conn.last_insert_rowid())
}

pub fn album_id(conn: &Connection, title: &str, album_artist: &str, album_artist_id: i64, year: Option<i32>, genre: Option<&str>, art: Option<&str>) -> rusqlite::Result<i64> {
    let key = format!("{}\u{1f}{}", norm_key(album_artist), norm_key(title));
    if let Some((id, cur_art, cur_year)) = conn
        .query_row("SELECT id, artwork_hash, year FROM album WHERE album_key = ?1", [&key], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, Option<i32>>(2)?)))
        .optional()?
    {
        if (cur_art.is_none() && art.is_some()) || (cur_year.is_none() && year.is_some()) {
            conn.execute(
                "UPDATE album SET artwork_hash = COALESCE(artwork_hash, ?2), year = COALESCE(year, ?3), genre = COALESCE(genre, ?4) WHERE id = ?1",
                params![id, art, year, genre],
            )?;
        }
        return Ok(id);
    }
    conn.execute(
        "INSERT INTO album(title, album_artist_id, year, genre, artwork_hash, album_key, added_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![title.trim(), album_artist_id, year, genre, art, key, now_ms()],
    )?;
    Ok(conn.last_insert_rowid())
}

pub struct FileFacts<'a> {
    pub folder_id: i64,
    pub path: &'a str,
    pub filename: &'a str,
    pub size: u64,
    pub mtime: i64,
    pub kind: MediaKind,
    pub artwork_hash: Option<String>,
    pub has_lyrics: bool,
    /// Folder-derived fallbacks: (album dir name, artist dir name)
    pub dir_album: Option<String>,
    pub dir_artist: Option<String>,
    pub file_title: String,
    pub file_track_no: Option<u32>,
}

pub fn upsert_track(conn: &Connection, f: &FileFacts, m: &TrackMeta) -> rusqlite::Result<i64> {
    let is_video = f.kind == MediaKind::Video;
    let mut title = m.title.clone().unwrap_or_else(|| f.file_title.clone());
    let mut artist = m.artist.clone();
    if is_video && artist.is_none() {
        // "Artist - Title.mp4"
        if let Some((a, t)) = f.file_title.split_once(" - ") {
            artist = Some(a.trim().to_string());
            if m.title.is_none() {
                title = t.trim().to_string();
            }
        }
    }
    let artist = artist.or_else(|| f.dir_artist.clone()).unwrap_or_else(|| "Unknown Artist".into());
    let album_artist = m.album_artist.clone().unwrap_or_else(|| artist.clone());
    let album_title = m.album.clone().or_else(|| f.dir_album.clone()).unwrap_or_else(|| "Unknown Album".into());

    let a_id = artist_id(conn, &artist)?;
    let (al_id, aa_id) = if is_video {
        (None, a_id)
    } else {
        let aa_id = artist_id(conn, &album_artist)?;
        (Some(album_id(conn, &album_title, &album_artist, aa_id, m.year, m.genre.as_deref(), f.artwork_hash.as_deref())?), aa_id)
    };
    let _ = aa_id;
    let kind = if is_video { "video" } else { "audio" };
    let now = now_ms();
    let existing: Option<i64> = conn.query_row("SELECT id FROM track WHERE path = ?1", [f.path], |r| r.get(0)).optional()?;
    let id = if let Some(id) = existing {
        conn.execute(
            "UPDATE track SET folder_id=?2, kind=?3, filename=?4, title=?5, artist_id=?6, artist_name=?7, album_id=?8, album_title=?9, album_artist_name=?10,
             track_no=?11, track_total=?12, disc_no=?13, disc_total=?14, year=?15, genre=?16, duration_ms=?17, codec=?18, bitrate=?19, sample_rate=?20,
             bit_depth=?21, channels=?22, file_size=?23, mtime=?24, artwork_hash=?25, has_lyrics=?26, rg_track_gain=?27, rg_album_gain=?28, missing=0
             WHERE id=?1",
            params![id, f.folder_id, kind, f.filename, title, a_id, artist, al_id, album_title, album_artist,
                m.track_no.or(f.file_track_no), m.track_total, m.disc_no, m.disc_total, m.year, m.genre, m.duration_ms as i64, m.codec, m.bitrate, m.sample_rate,
                m.bit_depth, m.channels, f.size as i64, f.mtime, f.artwork_hash, (f.has_lyrics || m.has_embedded_lyrics) as i32, m.rg_track_gain, m.rg_album_gain],
        )?;
        conn.execute("DELETE FROM track_fts WHERE rowid = ?1", [id])?;
        id
    } else {
        conn.execute(
            "INSERT INTO track(folder_id, kind, path, filename, title, artist_id, artist_name, album_id, album_title, album_artist_name, track_no, track_total,
             disc_no, disc_total, year, genre, duration_ms, codec, bitrate, sample_rate, bit_depth, channels, file_size, mtime, added_at, artwork_hash, has_lyrics,
             rg_track_gain, rg_album_gain)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29)",
            params![f.folder_id, kind, f.path, f.filename, title, a_id, artist, al_id, album_title, album_artist, m.track_no.or(f.file_track_no), m.track_total,
                m.disc_no, m.disc_total, m.year, m.genre, m.duration_ms as i64, m.codec, m.bitrate, m.sample_rate, m.bit_depth, m.channels, f.size as i64, f.mtime,
                now, f.artwork_hash, (f.has_lyrics || m.has_embedded_lyrics) as i32, m.rg_track_gain, m.rg_album_gain],
        )?;
        conn.last_insert_rowid()
    };
    conn.execute(
        "INSERT INTO track_fts(rowid, title, artist, album, album_artist, genre) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, title, artist, if is_video { "" } else { album_title.as_str() }, album_artist, m.genre.clone().unwrap_or_default()],
    )?;
    Ok(id)
}

/// Remove albums/artists that no longer have any present tracks.
pub fn prune(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "DELETE FROM album WHERE id NOT IN (SELECT DISTINCT album_id FROM track WHERE album_id IS NOT NULL);
         DELETE FROM artist WHERE id NOT IN (SELECT DISTINCT artist_id FROM track WHERE artist_id IS NOT NULL)
                             AND id NOT IN (SELECT DISTINCT album_artist_id FROM album WHERE album_artist_id IS NOT NULL);",
    )
}
