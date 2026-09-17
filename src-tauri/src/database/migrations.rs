use rusqlite::Connection;

/// Ordered migrations. Never edit a shipped migration; append a new one.
const MIGRATIONS: &[&str] = &[
    // 1 — core library
    r#"
    CREATE TABLE library_folder (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        added_at INTEGER NOT NULL,
        last_scan_at INTEGER,
        available INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE artist (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        sort_name TEXT NOT NULL,
        name_key TEXT NOT NULL UNIQUE
    );
    CREATE TABLE album (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        album_artist_id INTEGER REFERENCES artist(id) ON DELETE SET NULL,
        year INTEGER,
        genre TEXT,
        artwork_hash TEXT,
        album_key TEXT NOT NULL UNIQUE,
        added_at INTEGER NOT NULL
    );
    CREATE TABLE artwork (
        hash TEXT PRIMARY KEY,
        mime TEXT,
        width INTEGER,
        height INTEGER,
        palette TEXT
    );
    CREATE TABLE track (
        id INTEGER PRIMARY KEY,
        folder_id INTEGER REFERENCES library_folder(id) ON DELETE CASCADE,
        kind TEXT NOT NULL DEFAULT 'audio',
        path TEXT NOT NULL UNIQUE,
        filename TEXT NOT NULL,
        title TEXT NOT NULL,
        artist_id INTEGER REFERENCES artist(id) ON DELETE SET NULL,
        artist_name TEXT NOT NULL,
        album_id INTEGER REFERENCES album(id) ON DELETE SET NULL,
        album_title TEXT NOT NULL,
        album_artist_name TEXT NOT NULL,
        track_no INTEGER,
        track_total INTEGER,
        disc_no INTEGER,
        disc_total INTEGER,
        year INTEGER,
        genre TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        codec TEXT,
        bitrate INTEGER,
        sample_rate INTEGER,
        bit_depth INTEGER,
        channels INTEGER,
        file_size INTEGER NOT NULL DEFAULT 0,
        mtime INTEGER NOT NULL DEFAULT 0,
        added_at INTEGER NOT NULL,
        artwork_hash TEXT,
        has_lyrics INTEGER NOT NULL DEFAULT 0,
        rg_track_gain REAL,
        rg_album_gain REAL,
        missing INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX track_album ON track(album_id, disc_no, track_no);
    CREATE INDEX track_artist ON track(artist_id);
    CREATE INDEX track_folder ON track(folder_id);
    CREATE INDEX track_added ON track(added_at DESC);
    CREATE INDEX album_artist_idx ON album(album_artist_id);

    CREATE TABLE play_stats (
        track_id INTEGER PRIMARY KEY REFERENCES track(id) ON DELETE CASCADE,
        play_count INTEGER NOT NULL DEFAULT 0,
        skip_count INTEGER NOT NULL DEFAULT 0,
        last_played_at INTEGER
    );
    CREATE TABLE play_history (
        id INTEGER PRIMARY KEY,
        track_id INTEGER NOT NULL REFERENCES track(id) ON DELETE CASCADE,
        played_at INTEGER NOT NULL,
        ms_played INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX history_time ON play_history(played_at DESC);
    CREATE TABLE favourite (
        track_id INTEGER PRIMARY KEY REFERENCES track(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE playlist (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE TABLE playlist_track (
        id INTEGER PRIMARY KEY,
        playlist_id INTEGER NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
        track_id INTEGER NOT NULL REFERENCES track(id) ON DELETE CASCADE,
        position REAL NOT NULL,
        added_at INTEGER NOT NULL
    );
    CREATE INDEX playlist_track_pos ON playlist_track(playlist_id, position);
    CREATE TABLE setting (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE track_fts USING fts5(
        title, artist, album, album_artist, genre,
        content='', contentless_delete=1,
        tokenize='unicode61 remove_diacritics 2',
        prefix='2 3'
    );
    "#,
    // 2 — re-read MP4 audio so ALAC is detected correctly (codec probe moved to symphonia)
    r#"
    UPDATE track SET mtime = 0 WHERE lower(path) LIKE '%.m4a' OR lower(path) LIKE '%.mp4';
    "#,
    // 3 — paired devices for the optional LAN server
    r#"
    CREATE TABLE device (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER,
        revoked INTEGER NOT NULL DEFAULT 0
    );
    "#,
    // 4 — rule-based smart playlists; NULL keeps the existing manual behaviour
    r#"
    ALTER TABLE playlist ADD COLUMN rules TEXT;
    "#,
    // 5 — retry receipts for phone edits, scoped to the paired device
    r#"
    CREATE TABLE phone_edit_receipt (
        device_id INTEGER NOT NULL REFERENCES device(id) ON DELETE CASCADE,
        operation_id TEXT NOT NULL,
        result TEXT NOT NULL,
        PRIMARY KEY(device_id, operation_id)
    );
    "#,
];

pub fn run(conn: &mut Connection) -> rusqlite::Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate() {
        let version = (i + 1) as i64;
        if version <= current {
            continue;
        }
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", version)?;
        tx.commit()?;
        log::info!(target: "DATABASE", "migrated to schema v{version}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn migrations_apply_and_are_idempotent() {
        let mut c = rusqlite::Connection::open_in_memory().unwrap();
        super::run(&mut c).unwrap();
        super::run(&mut c).unwrap();
        let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v as usize, super::MIGRATIONS.len());
        c.execute("INSERT INTO track_fts(rowid, title, artist, album, album_artist, genre) VALUES (1,'Hello','A','B','C','D')", []).unwrap();
        c.execute("DELETE FROM track_fts WHERE rowid = 1", []).unwrap();
    }
}
