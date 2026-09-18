//! Keeping an account's library in step across devices.
//!
//! The unit of identity is a *match key* — artist, album, title and length — so the same recording
//! lines up whether or not its audio was ever uploaded. Rows are upserted, never blindly replaced,
//! and a failure to reach the cloud leaves everything on this device exactly as it was.
use super::{auth, classify, CloudError, CloudResult, BASE_URL, PUBLISHABLE_KEY};
use crate::database::Db;
use crate::library::{mutate, query};
use rusqlite::params;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

#[derive(Debug, Default, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncSummary {
    pub tracks_pushed: usize,
    pub playlists_pushed: usize,
    pub favourites_pushed: usize,
    pub plays_pushed: usize,
    pub playlists_pulled: usize,
    pub favourites_pulled: usize,
}

/// What makes two files the same recording for sync purposes. Deliberately not the file hash: the
/// same album ripped twice should still be one entry in your account.
pub fn match_key(artist: &str, album: &str, title: &str, duration_ms: i64) -> String {
    let norm = |s: &str| s.trim().to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ");
    format!("{}|{}|{}|{}", norm(artist), norm(album), norm(title), duration_ms / 1000)
}

fn rest(path: &str) -> String {
    format!("{BASE_URL}/rest/v1/{path}")
}

fn send(db: &Db, method: &str, path: &str, body: Value, prefer: &str) -> CloudResult<Value> {
    let session = auth::current(db)?;
    let request = ureq::request(method, &rest(path))
        .set("apikey", PUBLISHABLE_KEY)
        .set("Authorization", &format!("Bearer {}", session.access_token))
        .set("Content-Type", "application/json")
        .set("Prefer", prefer)
        .timeout(Duration::from_secs(60));
    let response = if body.is_null() { request.call() } else { request.send_json(body) }.map_err(classify)?;
    let text = response.into_string().unwrap_or_default();
    if text.trim().is_empty() {
        return Ok(Value::Array(vec![]));
    }
    serde_json::from_str(&text).map_err(|_| CloudError::Rejected("That reply from your account made no sense.".into()))
}

fn get(db: &Db, path: &str) -> CloudResult<Value> {
    send(db, "GET", path, Value::Null, "count=none")
}

fn upsert(db: &Db, table: &str, on_conflict: &str, rows: Value) -> CloudResult<Value> {
    send(db, "POST", &format!("{table}?on_conflict={on_conflict}"), rows, "return=representation,resolution=merge-duplicates")
}

/// Local ↔ cloud track ids, so playlists and favourites can be expressed in either world.
fn remember_mapping(db: &Db, local_id: i64, cloud_id: &str, key: &str) -> rusqlite::Result<()> {
    db.with(|c| {
        c.execute(
            "INSERT INTO cloud_track(track_id, cloud_id, match_key, synced_at) VALUES (?1,?2,?3,?4)
             ON CONFLICT(track_id) DO UPDATE SET cloud_id=excluded.cloud_id, match_key=excluded.match_key, synced_at=excluded.synced_at",
            params![local_id, cloud_id, key, crate::database::now_ms()],
        )?;
        Ok(())
    })
}

pub fn local_for_cloud(db: &Db) -> rusqlite::Result<HashMap<String, i64>> {
    db.with(|c| {
        let mut stmt = c.prepare("SELECT cloud_id, track_id FROM cloud_track")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        rows.collect()
    })
}

pub fn cloud_for_local(db: &Db) -> rusqlite::Result<HashMap<i64, String>> {
    db.with(|c| {
        let mut stmt = c.prepare("SELECT track_id, cloud_id FROM cloud_track")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
        rows.collect()
    })
}

/// Push this device's library metadata, playlists, favourites and new plays.
pub fn push(db: &Db) -> CloudResult<SyncSummary> {
    let session = auth::current(db)?;
    let mut summary = SyncSummary::default();

    // 1. Track rows. Metadata only — the audio is a separate, explicit upload.
    let tracks = db.with(|c| query::all_tracks(c, "audio")).map_err(|e| CloudError::Rejected(e.to_string()))?;
    for chunk in tracks.chunks(200) {
        let rows: Vec<Value> = chunk
            .iter()
            .map(|t| {
                json!({
                    "user_id": session.user_id,
                    "match_key": match_key(&t.artist, &t.album, &t.title, t.duration_ms),
                    "title": t.title,
                    "artist_name": t.artist,
                    "album_title": t.album,
                    "album_artist_name": t.album_artist,
                    "track_no": t.track_no,
                    "disc_no": t.disc_no,
                    "year": t.year,
                    "genre": t.genre,
                    "duration_ms": t.duration_ms,
                    "codec": t.codec,
                })
            })
            .collect();
        let returned = upsert(db, "tracks", "user_id,match_key", Value::Array(rows))?;
        for row in returned.as_array().cloned().unwrap_or_default() {
            let (Some(cloud_id), Some(key)) = (row.get("id").and_then(Value::as_str), row.get("match_key").and_then(Value::as_str)) else { continue };
            if let Some(local) = chunk.iter().find(|t| match_key(&t.artist, &t.album, &t.title, t.duration_ms) == key) {
                let _ = remember_mapping(db, local.id, cloud_id, key);
                summary.tracks_pushed += 1;
            }
        }
    }

    let mapping = cloud_for_local(db).unwrap_or_default();

    // 2. Favourites — the set on this device becomes the set in the account.
    let favourites = db.with(query::favourites).map_err(|e| CloudError::Rejected(e.to_string()))?;
    let rows: Vec<Value> = favourites.iter().filter_map(|t| mapping.get(&t.id)).map(|id| json!({ "user_id": session.user_id, "track_id": id })).collect();
    if !rows.is_empty() {
        summary.favourites_pushed = rows.len();
        upsert(db, "favourites", "user_id,track_id", Value::Array(rows))?;
    }

    // 3. Playlists, with their tracks in order.
    let playlists = db.with(query::playlists).map_err(|e| CloudError::Rejected(e.to_string()))?;
    for playlist in &playlists {
        let detail = db.with(|c| query::playlist(c, playlist.id)).map_err(|e| CloudError::Rejected(e.to_string()))?;
        let Some(detail) = detail else { continue };
        let returned = upsert(
            db,
            "playlists",
            "user_id,name",
            json!([{ "user_id": session.user_id, "name": playlist.name, "description": playlist.description, "rules": playlist.rules, "updated_at": "now()" }]),
        )?;
        let Some(cloud_playlist) = returned.as_array().and_then(|a| a.first()).and_then(|r| r.get("id")).and_then(Value::as_str) else { continue };
        // Replace this playlist's contents: order matters and entries may have moved.
        send(db, "DELETE", &format!("playlist_tracks?playlist_id=eq.{cloud_playlist}"), Value::Null, "return=minimal")?;
        let rows: Vec<Value> = detail
            .entries
            .iter()
            .enumerate()
            .filter_map(|(i, e)| mapping.get(&e.track.id).map(|cloud| json!({ "user_id": session.user_id, "playlist_id": cloud_playlist, "track_id": cloud, "position": i as f64 })))
            .collect();
        if !rows.is_empty() {
            upsert(db, "playlist_tracks", "playlist_id,track_id,position", Value::Array(rows))?;
        }
        summary.playlists_pushed += 1;
    }

    // 4. Plays since the last push.
    let since: i64 = db.with(mutate::settings).ok().and_then(|s| s.get("cloud.history_cursor").and_then(Value::as_i64)).unwrap_or(0);
    let plays = db
        .with(|c| {
            let mut stmt = c.prepare("SELECT track_id, played_at, ms_played FROM play_history WHERE played_at > ?1 ORDER BY played_at LIMIT 500")?;
            let rows = stmt.query_map([since], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        })
        .unwrap_or_default();
    let rows: Vec<Value> = plays
        .iter()
        .filter_map(|(track, at, ms)| {
            mapping.get(track).map(|cloud| {
                json!({ "user_id": session.user_id, "track_id": cloud, "played_at": chrono_secs(*at), "ms_played": ms })
            })
        })
        .collect();
    if !rows.is_empty() {
        summary.plays_pushed = rows.len();
        send(db, "POST", "play_history", Value::Array(rows), "return=minimal")?;
    }
    if let Some((_, newest, _)) = plays.last() {
        let _ = db.with(|c| mutate::set_setting(c, "cloud.history_cursor", &json!(newest)));
    }

    Ok(summary)
}

/// Bring down what other devices changed: playlists and favourites, applied to the tracks this
/// device actually has. Nothing local is deleted for want of a match.
pub fn pull(db: &Db) -> CloudResult<SyncSummary> {
    let mut summary = SyncSummary::default();
    let by_cloud = local_for_cloud(db).unwrap_or_default();

    let favourites = get(db, "favourites?select=track_id")?;
    for row in favourites.as_array().cloned().unwrap_or_default() {
        let Some(local) = row.get("track_id").and_then(Value::as_str).and_then(|id| by_cloud.get(id)) else { continue };
        let _ = db.with(|c| mutate::toggle_favourite(c, *local, true));
        summary.favourites_pulled += 1;
    }

    let playlists = get(db, "playlists?select=id,name,description,playlist_tracks(track_id,position)")?;
    for row in playlists.as_array().cloned().unwrap_or_default() {
        let Some(name) = row.get("name").and_then(Value::as_str) else { continue };
        let mut entries: Vec<(f64, i64)> = row
            .get("playlist_tracks")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|e| {
                        let track = e.get("track_id").and_then(Value::as_str)?;
                        let position = e.get("position").and_then(Value::as_f64).unwrap_or(0.0);
                        by_cloud.get(track).map(|local| (position, *local))
                    })
                    .collect()
            })
            .unwrap_or_default();
        entries.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        let ids: Vec<i64> = entries.into_iter().map(|(_, id)| id).collect();

        let existing = db.with(query::playlists).unwrap_or_default().into_iter().find(|p| p.name == name);
        let local_id = match existing {
            Some(p) => p.id,
            None => db.with(|c| mutate::create_playlist(c, name)).map_err(|e| CloudError::Rejected(e.to_string()))?,
        };
        // Replace contents so an edit made elsewhere wins, rather than duplicating entries.
        let current = db.with(|c| query::playlist(c, local_id)).ok().flatten();
        if let Some(detail) = current {
            let entry_ids: Vec<i64> = detail.entries.iter().map(|e| e.entry_id).collect();
            if !entry_ids.is_empty() {
                let _ = db.with_mut(|c| mutate::remove_from_playlist(c, local_id, &entry_ids));
            }
        }
        if !ids.is_empty() {
            let _ = db.with_mut(|c| mutate::add_to_playlist(c, local_id, &ids));
        }
        summary.playlists_pulled += 1;
    }

    Ok(summary)
}

/// PostgREST wants a timestamp; local history is milliseconds since the epoch.
fn chrono_secs(ms: i64) -> String {
    let secs = ms / 1000;
    let days = secs / 86_400;
    let rem = secs % 86_400;
    // 1970-01-01 plus days, done without pulling in a date library for one field.
    let (mut y, mut d) = (1970, days);
    loop {
        let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
        let len = if leap { 366 } else { 365 };
        if d < len {
            break;
        }
        d -= len;
        y += 1;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let months = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 0;
    while m < 12 && d >= months[m] {
        d -= months[m];
        m += 1;
    }
    format!("{y:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", m + 1, d + 1, rem / 3600, (rem % 3600) / 60, rem % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_match_key_ignores_case_and_spacing_but_not_the_recording() {
        assert_eq!(match_key("Radiohead", "Kid A", "Idioteque", 320_400), match_key(" radiohead ", "kid  a", "IDIOTEQUE", 320_900));
        assert_ne!(match_key("Radiohead", "Kid A", "Idioteque", 320_000), match_key("Radiohead", "Kid A", "Idioteque", 420_000));
        assert_ne!(match_key("Radiohead", "Kid A", "Idioteque", 320_000), match_key("Someone Else", "Kid A", "Idioteque", 320_000));
    }

    #[test]
    fn timestamps_are_written_the_way_postgres_expects() {
        assert_eq!(chrono_secs(0), "1970-01-01T00:00:00Z");
        assert_eq!(chrono_secs(1_700_000_000_000), "2023-11-14T22:13:20Z");
        assert_eq!(chrono_secs(1_709_164_800_000), "2024-02-29T00:00:00Z", "leap years count");
    }
}
