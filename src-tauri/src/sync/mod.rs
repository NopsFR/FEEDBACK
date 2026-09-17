//! Optional LAN server: lets a phone (PWA) browse and download media from this desktop.
//! Off by default. HTTPS with a locally generated CA (needed for service workers / OPFS on iOS),
//! explicit pairing with a short-lived code, per-device bearer tokens, revocable. Only library media by id is exposed.
pub mod certs;
pub mod server;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

pub const DEFAULT_PORT: u16 = 47821;

pub fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::getrandom(&mut buf).expect("os rng");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn random_code() -> String {
    let mut buf = [0u8; 4];
    getrandom::getrandom(&mut buf).expect("os rng");
    format!("{:06}", u32::from_le_bytes(buf) % 1_000_000)
}

pub fn token_hash(token: &str) -> String {
    blake3::hash(token.as_bytes()).to_hex().to_string()
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeviceRow {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
    pub last_seen_at: Option<i64>,
}

pub fn devices(conn: &Connection) -> rusqlite::Result<Vec<DeviceRow>> {
    let mut stmt = conn.prepare("SELECT id, name, created_at, last_seen_at FROM device WHERE revoked = 0 ORDER BY created_at DESC")?;
    let rows = stmt.query_map([], |r| Ok(DeviceRow { id: r.get(0)?, name: r.get(1)?, created_at: r.get(2)?, last_seen_at: r.get(3)? }))?;
    rows.collect()
}

pub fn add_device(conn: &Connection, name: &str) -> rusqlite::Result<String> {
    let token = random_hex(32);
    conn.execute(
        "INSERT INTO device(name, token_hash, created_at) VALUES (?1, ?2, ?3)",
        params![name.chars().take(60).collect::<String>(), token_hash(&token), crate::database::now_ms()],
    )?;
    Ok(token)
}

pub fn revoke_device(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("UPDATE device SET revoked = 1 WHERE id = ?1", [id])?;
    Ok(())
}

/// Returns device id when the token is valid; updates last_seen (at most once a minute).
pub fn check_token(conn: &Connection, token: &str) -> rusqlite::Result<Option<i64>> {
    let h = token_hash(token);
    let row: Option<(i64, Option<i64>)> = conn
        .query_row("SELECT id, last_seen_at FROM device WHERE token_hash = ?1 AND revoked = 0", [h], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    if let Some((id, seen)) = row {
        let now = crate::database::now_ms();
        if seen.map(|s| now - s > 60_000).unwrap_or(true) {
            conn.execute("UPDATE device SET last_seen_at = ?2 WHERE id = ?1", params![id, now])?;
        }
        return Ok(Some(id));
    }
    Ok(None)
}
