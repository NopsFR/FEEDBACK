//! Writes that originate from the UI: folders, playlists, favourites, plays, settings.
use crate::database::now_ms;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderRow {
    pub id: i64,
    pub path: String,
    pub added_at: i64,
    pub last_scan_at: Option<i64>,
    pub available: bool,
    pub track_count: i64,
}

pub fn folders(conn: &Connection) -> rusqlite::Result<Vec<FolderRow>> {
    let mut stmt = conn.prepare_cached(
        "SELECT f.id, f.path, f.added_at, f.last_scan_at, f.available, (SELECT COUNT(*) FROM track t WHERE t.folder_id = f.id AND t.missing = 0) FROM library_folder f ORDER BY f.path",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(FolderRow { id: r.get(0)?, path: r.get(1)?, added_at: r.get(2)?, last_scan_at: r.get(3)?, available: r.get::<_, i64>(4)? != 0, track_count: r.get(5)? })
    })?;
    rows.collect()
}

pub fn add_folder(conn: &Connection, path: &str) -> rusqlite::Result<i64> {
    if let Some(id) = conn.query_row("SELECT id FROM library_folder WHERE path = ?1", [path], |r| r.get(0)).optional()? {
        return Ok(id);
    }
    conn.execute("INSERT INTO library_folder(path, added_at) VALUES (?1, ?2)", params![path, now_ms()])?;
    Ok(conn.last_insert_rowid())
}

pub fn remove_folder(conn: &mut Connection, id: i64) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM track_fts WHERE rowid IN (SELECT id FROM track WHERE folder_id = ?1)", [id])?;
    tx.execute("DELETE FROM track WHERE folder_id = ?1", [id])?;
    tx.execute("DELETE FROM library_folder WHERE id = ?1", [id])?;
    super::store::prune(&tx)?;
    tx.commit()
}

pub fn toggle_favourite(conn: &Connection, track_id: i64, on: bool) -> rusqlite::Result<()> {
    if on {
        conn.execute("INSERT OR IGNORE INTO favourite(track_id, created_at) VALUES (?1, ?2)", params![track_id, now_ms()])?;
    } else {
        conn.execute("DELETE FROM favourite WHERE track_id = ?1", [track_id])?;
    }
    Ok(())
}

/// Called when a track finished or was listened to past the play threshold; `skipped` for early skips.
pub fn record_play(conn: &Connection, track_id: i64, ms_played: i64, skipped: bool) -> rusqlite::Result<()> {
    let now = now_ms();
    if skipped {
        conn.execute(
            "INSERT INTO play_stats(track_id, skip_count) VALUES (?1, 1) ON CONFLICT(track_id) DO UPDATE SET skip_count = skip_count + 1",
            [track_id],
        )?;
        return Ok(());
    }
    conn.execute("INSERT INTO play_history(track_id, played_at, ms_played) VALUES (?1, ?2, ?3)", params![track_id, now, ms_played])?;
    conn.execute(
        "INSERT INTO play_stats(track_id, play_count, last_played_at) VALUES (?1, 1, ?2)
         ON CONFLICT(track_id) DO UPDATE SET play_count = play_count + 1, last_played_at = excluded.last_played_at",
        params![track_id, now],
    )?;
    Ok(())
}

pub fn create_playlist(conn: &Connection, name: &str) -> rusqlite::Result<i64> {
    let now = now_ms();
    conn.execute("INSERT INTO playlist(name, created_at, updated_at) VALUES (?1, ?2, ?2)", params![name.trim(), now])?;
    Ok(conn.last_insert_rowid())
}

pub fn rename_playlist(conn: &Connection, id: i64, name: &str, description: Option<&str>) -> rusqlite::Result<()> {
    conn.execute("UPDATE playlist SET name = ?2, description = ?3, updated_at = ?4 WHERE id = ?1", params![id, name.trim(), description, now_ms()])?;
    Ok(())
}

pub fn delete_playlist(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM playlist WHERE id = ?1", [id])?;
    Ok(())
}

pub fn duplicate_playlist(conn: &mut Connection, id: i64) -> rusqlite::Result<i64> {
    let tx = conn.transaction()?;
    let name: String = tx.query_row("SELECT name FROM playlist WHERE id = ?1", [id], |r| r.get(0))?;
    let now = now_ms();
    tx.execute("INSERT INTO playlist(name, description, created_at, updated_at) SELECT ?2, description, ?3, ?3 FROM playlist WHERE id = ?1", params![id, format!("{name} (copy)"), now])?;
    let new_id = tx.last_insert_rowid();
    tx.execute("INSERT INTO playlist_track(playlist_id, track_id, position, added_at) SELECT ?2, track_id, position, ?3 FROM playlist_track WHERE playlist_id = ?1", params![id, new_id, now])?;
    tx.commit()?;
    Ok(new_id)
}

pub fn add_to_playlist(conn: &mut Connection, id: i64, track_ids: &[i64]) -> rusqlite::Result<usize> {
    let tx = conn.transaction()?;
    let mut pos: f64 = tx.query_row("SELECT COALESCE(MAX(position), 0) FROM playlist_track WHERE playlist_id = ?1", [id], |r| r.get(0))?;
    let now = now_ms();
    for t in track_ids {
        pos += 1.0;
        tx.execute("INSERT INTO playlist_track(playlist_id, track_id, position, added_at) VALUES (?1, ?2, ?3, ?4)", params![id, t, pos, now])?;
    }
    tx.execute("UPDATE playlist SET updated_at = ?2 WHERE id = ?1", params![id, now])?;
    tx.commit()?;
    Ok(track_ids.len())
}

pub fn remove_from_playlist(conn: &mut Connection, id: i64, entry_ids: &[i64]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    for e in entry_ids {
        tx.execute("DELETE FROM playlist_track WHERE id = ?1 AND playlist_id = ?2", params![e, id])?;
    }
    tx.execute("UPDATE playlist SET updated_at = ?2 WHERE id = ?1", params![id, now_ms()])?;
    tx.commit()
}

/// Rewrite positions to match the given entry order (entries not listed keep their relative order at the end).
pub fn reorder_playlist(conn: &mut Connection, id: i64, ordered_entry_ids: &[i64]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    let mut all: Vec<i64> = {
        let mut stmt = tx.prepare("SELECT id FROM playlist_track WHERE playlist_id = ?1 ORDER BY position")?;
        let rows = stmt.query_map([id], |r| r.get(0))?;
        rows.collect::<rusqlite::Result<Vec<i64>>>()?
    };
    all.retain(|e| !ordered_entry_ids.contains(e));
    let final_order: Vec<i64> = ordered_entry_ids.iter().copied().chain(all).collect();
    for (i, e) in final_order.iter().enumerate() {
        tx.execute("UPDATE playlist_track SET position = ?3 WHERE id = ?1 AND playlist_id = ?2", params![e, id, (i + 1) as f64])?;
    }
    tx.execute("UPDATE playlist SET updated_at = ?2 WHERE id = ?1", params![id, now_ms()])?;
    tx.commit()
}

pub fn settings(conn: &Connection) -> rusqlite::Result<serde_json::Map<String, serde_json::Value>> {
    let mut stmt = conn.prepare_cached("SELECT key, value FROM setting")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let mut map = serde_json::Map::new();
    for (k, v) in rows.flatten() {
        map.insert(k, serde_json::from_str(&v).unwrap_or(serde_json::Value::String(v)));
    }
    Ok(map)
}

pub fn set_setting(conn: &Connection, key: &str, value: &serde_json::Value) -> rusqlite::Result<()> {
    conn.execute("INSERT INTO setting(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![key, value.to_string()])?;
    Ok(())
}

pub fn track_path(conn: &Connection, id: i64) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT path FROM track WHERE id = ?1", [id], |r| r.get(0)).optional()
}

pub fn remove_tracks(conn: &mut Connection, ids: &[i64]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    for id in ids {
        tx.execute("DELETE FROM track_fts WHERE rowid = ?1", [id])?;
        tx.execute("DELETE FROM track WHERE id = ?1", [id])?;
    }
    super::store::prune(&tx)?;
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Db;

    fn seed(conn: &Connection) -> i64 {
        conn.execute("INSERT INTO track(path, filename, title, artist_name, album_title, album_artist_name, added_at) VALUES ('/a.mp3','a.mp3','A','X','Y','X',0)", []).unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn playlist_flow() {
        let db = Db::open_in_memory().unwrap();
        db.with_mut(|c| {
            let t1 = seed(c);
            c.execute("INSERT INTO track(path, filename, title, artist_name, album_title, album_artist_name, added_at) VALUES ('/b.mp3','b.mp3','B','X','Y','X',0)", [])?;
            let t2 = c.last_insert_rowid();
            let p = create_playlist(c, "Night drive")?;
            add_to_playlist(c, p, &[t1, t2, t1])?;
            let d = crate::library::query::playlist(c, p)?.unwrap();
            assert_eq!(d.entries.len(), 3);
            let ids: Vec<i64> = d.entries.iter().map(|e| e.entry_id).collect();
            reorder_playlist(c, p, &[ids[2], ids[0]])?;
            let d = crate::library::query::playlist(c, p)?.unwrap();
            assert_eq!(d.entries.iter().map(|e| e.entry_id).collect::<Vec<_>>(), vec![ids[2], ids[0], ids[1]]);
            remove_from_playlist(c, p, &[ids[0]])?;
            let dup = duplicate_playlist(c, p)?;
            assert_eq!(crate::library::query::playlist(c, dup)?.unwrap().entries.len(), 2);
            record_play(c, t1, 1000, false)?;
            record_play(c, t1, 1000, false)?;
            let n: i64 = c.query_row("SELECT play_count FROM play_stats WHERE track_id = ?1", [t1], |r| r.get(0))?;
            assert_eq!(n, 2);
            Ok(())
        })
        .unwrap();
    }
}
