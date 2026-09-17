//! Read models for the UI.
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TrackRow {
    pub id: i64,
    pub title: String,
    pub artist: String,
    pub artist_id: Option<i64>,
    pub album: String,
    pub album_id: Option<i64>,
    pub album_artist: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_no: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disc_no: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    pub duration_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codec: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bitrate: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sample_rate: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bit_depth: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channels: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub art: Option<String>,
    pub has_lyrics: bool,
    pub kind: String,
    pub favourite: bool,
    pub play_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_played_at: Option<i64>,
    pub added_at: i64,
    pub missing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rg_track: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rg_album: Option<f64>,
    pub file_size: i64,
}

pub const TRACK_SELECT: &str = "SELECT t.id, t.title, t.artist_name, t.artist_id, t.album_title, t.album_id, t.album_artist_name, t.track_no, t.disc_no, t.year,
    t.genre, t.duration_ms, t.codec, t.bitrate, t.sample_rate, t.bit_depth, t.channels, t.artwork_hash, t.has_lyrics, t.kind,
    (fav.track_id IS NOT NULL), COALESCE(st.play_count, 0), st.last_played_at, t.added_at, t.missing, t.rg_track_gain, t.rg_album_gain, t.file_size
    FROM track t LEFT JOIN favourite fav ON fav.track_id = t.id LEFT JOIN play_stats st ON st.track_id = t.id";

pub fn track_from_row(r: &Row) -> rusqlite::Result<TrackRow> {
    Ok(TrackRow {
        id: r.get(0)?,
        title: r.get(1)?,
        artist: r.get(2)?,
        artist_id: r.get(3)?,
        album: r.get(4)?,
        album_id: r.get(5)?,
        album_artist: r.get(6)?,
        track_no: r.get(7)?,
        disc_no: r.get(8)?,
        year: r.get(9)?,
        genre: r.get(10)?,
        duration_ms: r.get(11)?,
        codec: r.get(12)?,
        bitrate: r.get(13)?,
        sample_rate: r.get(14)?,
        bit_depth: r.get(15)?,
        channels: r.get(16)?,
        art: r.get(17)?,
        has_lyrics: r.get::<_, i64>(18)? != 0,
        kind: r.get(19)?,
        favourite: r.get::<_, i64>(20)? != 0,
        play_count: r.get(21)?,
        last_played_at: r.get(22)?,
        added_at: r.get(23)?,
        missing: r.get::<_, i64>(24)? != 0,
        rg_track: r.get(25)?,
        rg_album: r.get(26)?,
        file_size: r.get(27)?,
    })
}

fn tracks_where(conn: &Connection, clause: &str, p: impl rusqlite::Params) -> rusqlite::Result<Vec<TrackRow>> {
    let sql = format!("{TRACK_SELECT} {clause}");
    let mut stmt = conn.prepare_cached(&sql)?;
    let rows = stmt.query_map(p, track_from_row)?;
    rows.collect()
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AlbumRow {
    pub id: i64,
    pub title: String,
    pub artist: String,
    pub artist_id: Option<i64>,
    pub year: Option<i64>,
    pub genre: Option<String>,
    pub art: Option<String>,
    pub palette: Option<String>,
    pub track_count: i64,
    pub duration_ms: i64,
    pub added_at: i64,
    pub last_played_at: Option<i64>,
    pub play_count: i64,
}

const ALBUM_SELECT: &str = "SELECT a.id, a.title, COALESCE(ar.name, 'Unknown Artist'), a.album_artist_id, a.year, a.genre, a.artwork_hash, aw.palette,
    COUNT(t.id), COALESCE(SUM(t.duration_ms), 0), a.added_at, MAX(st.last_played_at), COALESCE(SUM(st.play_count), 0)
    FROM album a
    JOIN track t ON t.album_id = a.id AND t.missing = 0
    LEFT JOIN artist ar ON ar.id = a.album_artist_id
    LEFT JOIN artwork aw ON aw.hash = a.artwork_hash
    LEFT JOIN play_stats st ON st.track_id = t.id";

fn album_from_row(r: &Row) -> rusqlite::Result<AlbumRow> {
    Ok(AlbumRow {
        id: r.get(0)?,
        title: r.get(1)?,
        artist: r.get(2)?,
        artist_id: r.get(3)?,
        year: r.get(4)?,
        genre: r.get(5)?,
        art: r.get(6)?,
        palette: r.get(7)?,
        track_count: r.get(8)?,
        duration_ms: r.get(9)?,
        added_at: r.get(10)?,
        last_played_at: r.get(11)?,
        play_count: r.get(12)?,
    })
}

fn albums_where(conn: &Connection, where_clause: &str, tail: &str, p: impl rusqlite::Params) -> rusqlite::Result<Vec<AlbumRow>> {
    let sql = format!("{ALBUM_SELECT} {where_clause} GROUP BY a.id {tail}");
    let mut stmt = conn.prepare_cached(&sql)?;
    let rows = stmt.query_map(p, album_from_row)?;
    rows.collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistRow {
    pub id: i64,
    pub name: String,
    pub album_count: i64,
    pub track_count: i64,
    pub art: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub tracks: i64,
    pub albums: i64,
    pub artists: i64,
    pub videos: i64,
    pub folders: i64,
    pub duration_ms: i64,
}

pub fn overview(conn: &Connection) -> rusqlite::Result<Overview> {
    conn.query_row(
        "SELECT
            (SELECT COUNT(*) FROM track WHERE missing = 0 AND kind = 'audio'),
            (SELECT COUNT(DISTINCT album_id) FROM track WHERE missing = 0 AND album_id IS NOT NULL),
            (SELECT COUNT(DISTINCT album_artist_id) FROM album WHERE id IN (SELECT album_id FROM track WHERE missing = 0)),
            (SELECT COUNT(*) FROM track WHERE missing = 0 AND kind = 'video'),
            (SELECT COUNT(*) FROM library_folder),
            (SELECT COALESCE(SUM(duration_ms), 0) FROM track WHERE missing = 0 AND kind = 'audio')",
        [],
        |r| Ok(Overview { tracks: r.get(0)?, albums: r.get(1)?, artists: r.get(2)?, videos: r.get(3)?, folders: r.get(4)?, duration_ms: r.get(5)? }),
    )
}

pub fn all_tracks(conn: &Connection, kind: &str) -> rusqlite::Result<Vec<TrackRow>> {
    tracks_where(conn, "WHERE t.missing = 0 AND t.kind = ?1 ORDER BY lower(t.album_artist_name), lower(t.album_title), t.disc_no, t.track_no, lower(t.title)", [kind])
}

pub fn tracks_by_ids(conn: &Connection, ids: &[i64]) -> rusqlite::Result<Vec<TrackRow>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let json = serde_json::to_string(ids).unwrap_or_else(|_| "[]".into());
    let rows = tracks_where(conn, "WHERE t.id IN (SELECT value FROM json_each(?1))", [json])?;
    let mut map: std::collections::HashMap<i64, TrackRow> = rows.into_iter().map(|t| (t.id, t)).collect();
    Ok(ids.iter().filter_map(|id| map.remove(id)).collect())
}

pub fn all_albums(conn: &Connection) -> rusqlite::Result<Vec<AlbumRow>> {
    albums_where(conn, "", "ORDER BY lower(COALESCE(ar.sort_name, '')), a.year, lower(a.title)", [])
}

pub fn all_artists(conn: &Connection) -> rusqlite::Result<Vec<ArtistRow>> {
    let mut stmt = conn.prepare_cached(
        "SELECT ar.id, ar.name,
            (SELECT COUNT(DISTINCT t.album_id) FROM track t JOIN album a ON a.id = t.album_id WHERE a.album_artist_id = ar.id AND t.missing = 0),
            (SELECT COUNT(*) FROM track t WHERE (t.artist_id = ar.id OR t.album_id IN (SELECT id FROM album WHERE album_artist_id = ar.id)) AND t.missing = 0),
            (SELECT a.artwork_hash FROM album a WHERE a.album_artist_id = ar.id AND a.artwork_hash IS NOT NULL ORDER BY a.year DESC LIMIT 1)
         FROM artist ar
         WHERE EXISTS (SELECT 1 FROM track t WHERE t.artist_id = ar.id AND t.missing = 0)
            OR EXISTS (SELECT 1 FROM album a JOIN track t ON t.album_id = a.id WHERE a.album_artist_id = ar.id AND t.missing = 0)
         ORDER BY ar.sort_name",
    )?;
    let rows = stmt.query_map([], |r| Ok(ArtistRow { id: r.get(0)?, name: r.get(1)?, album_count: r.get(2)?, track_count: r.get(3)?, art: r.get(4)? }))?;
    rows.collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumDetail {
    pub album: AlbumRow,
    pub tracks: Vec<TrackRow>,
    pub more_by_artist: Vec<AlbumRow>,
}

pub fn album(conn: &Connection, id: i64) -> rusqlite::Result<Option<AlbumDetail>> {
    let Some(album) = albums_where(conn, "WHERE a.id = ?1", "", [id])?.into_iter().next() else { return Ok(None) };
    let tracks = tracks_where(conn, "WHERE t.album_id = ?1 AND t.missing = 0 ORDER BY COALESCE(t.disc_no, 1), COALESCE(t.track_no, 9999), lower(t.filename)", [id])?;
    let more = match album.artist_id {
        Some(aid) => albums_where(conn, "WHERE a.album_artist_id = ?1 AND a.id != ?2", "ORDER BY a.year DESC", params![aid, id])?,
        None => vec![],
    };
    Ok(Some(AlbumDetail { album, tracks, more_by_artist: more }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistDetail {
    pub id: i64,
    pub name: String,
    pub albums: Vec<AlbumRow>,
    pub appears_on: Vec<AlbumRow>,
    pub top_tracks: Vec<TrackRow>,
    pub videos: Vec<TrackRow>,
    pub track_count: i64,
    pub duration_ms: i64,
}

pub fn artist(conn: &Connection, id: i64) -> rusqlite::Result<Option<ArtistDetail>> {
    let Some(name) = conn.query_row("SELECT name FROM artist WHERE id = ?1", [id], |r| r.get::<_, String>(0)).optional()? else { return Ok(None) };
    let albums = albums_where(conn, "WHERE a.album_artist_id = ?1", "ORDER BY a.year DESC, lower(a.title)", [id])?;
    let appears_on = albums_where(conn, "WHERE a.album_artist_id != ?1 AND a.id IN (SELECT album_id FROM track WHERE artist_id = ?1)", "ORDER BY a.year DESC", [id])?;
    let top_tracks = tracks_where(
        conn,
        "WHERE (t.artist_id = ?1 OR t.album_id IN (SELECT id FROM album WHERE album_artist_id = ?1)) AND t.missing = 0 AND t.kind = 'audio'
         ORDER BY COALESCE(st.play_count, 0) DESC, fav.track_id IS NULL, t.year DESC, t.track_no LIMIT 10",
        [id],
    )?;
    let videos = tracks_where(conn, "WHERE t.artist_id = ?1 AND t.kind = 'video' AND t.missing = 0 ORDER BY t.year DESC, lower(t.title)", [id])?;
    let (track_count, duration_ms) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(duration_ms), 0) FROM track WHERE (artist_id = ?1 OR album_id IN (SELECT id FROM album WHERE album_artist_id = ?1)) AND missing = 0 AND kind = 'audio'",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(Some(ArtistDetail { id, name, albums, appears_on, top_tracks, videos, track_count, duration_ms }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub tracks: Vec<TrackRow>,
    pub albums: Vec<AlbumRow>,
    pub artists: Vec<ArtistRow>,
    pub videos: Vec<TrackRow>,
    pub playlists: Vec<PlaylistRow>,
    pub genres: Vec<String>,
}

pub fn fts_query(q: &str) -> Option<String> {
    let toks: Vec<String> = q
        .split(|c: char| !c.is_alphanumeric() && c != '\'')
        .map(|t| t.trim_matches('\'').to_string())
        .filter(|t| !t.is_empty())
        .take(8)
        .map(|t| format!("\"{}\"*", t.replace('"', "")))
        .collect();
    if toks.is_empty() { None } else { Some(toks.join(" ")) }
}

pub fn search(conn: &Connection, q: &str) -> rusqlite::Result<SearchResult> {
    let Some(fq) = fts_query(q) else {
        return Ok(SearchResult { tracks: vec![], albums: vec![], artists: vec![], videos: vec![], playlists: vec![], genres: vec![] });
    };
    let like = format!("%{}%", q.trim().replace('%', "").replace('_', ""));
    let tracks = tracks_where(conn, "JOIN track_fts ON track_fts.rowid = t.id WHERE track_fts MATCH ?1 AND t.missing = 0 AND t.kind = 'audio' ORDER BY bm25(track_fts, 10.0, 6.0, 4.0, 3.0, 1.0), COALESCE(st.play_count,0) DESC LIMIT 60", [&fq])?;
    let videos = tracks_where(conn, "JOIN track_fts ON track_fts.rowid = t.id WHERE track_fts MATCH ?1 AND t.missing = 0 AND t.kind = 'video' ORDER BY bm25(track_fts) LIMIT 12", [&fq])?;
    let albums = albums_where(conn, "WHERE a.title LIKE ?1 OR ar.name LIKE ?1", "ORDER BY (a.title LIKE ?1) DESC, a.year DESC LIMIT 16", [&like])?;
    let mut artists = Vec::new();
    {
        let mut stmt = conn.prepare_cached(
            "SELECT ar.id, ar.name, (SELECT COUNT(*) FROM album a WHERE a.album_artist_id = ar.id),
                (SELECT COUNT(*) FROM track t WHERE t.artist_id = ar.id AND t.missing = 0),
                (SELECT a.artwork_hash FROM album a WHERE a.album_artist_id = ar.id AND a.artwork_hash IS NOT NULL LIMIT 1)
             FROM artist ar WHERE ar.name LIKE ?1 AND EXISTS (SELECT 1 FROM track t WHERE t.artist_id = ar.id AND t.missing = 0)
             ORDER BY (lower(ar.name) = lower(?2)) DESC, (ar.name LIKE ?3) DESC, ar.sort_name LIMIT 12",
        )?;
        let starts = format!("{}%", q.trim());
        let rows = stmt.query_map(params![like, q.trim(), starts], |r| Ok(ArtistRow { id: r.get(0)?, name: r.get(1)?, album_count: r.get(2)?, track_count: r.get(3)?, art: r.get(4)? }))?;
        for r in rows.flatten() {
            artists.push(r);
        }
    }
    let playlists = playlists_where(conn, "WHERE p.name LIKE ?1", [&like])?;
    let mut genres = Vec::new();
    {
        let mut stmt = conn.prepare_cached("SELECT DISTINCT genre FROM track WHERE genre LIKE ?1 AND missing = 0 ORDER BY genre LIMIT 8")?;
        for g in stmt.query_map([&like], |r| r.get::<_, String>(0))?.flatten() {
            genres.push(g);
        }
    }
    Ok(SearchResult { tracks, albums, artists, videos, playlists, genres })
}

// ---------- home ----------
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Home {
    pub recently_added: Vec<AlbumRow>,
    pub recently_played: Vec<AlbumRow>,
    pub most_played: Vec<TrackRow>,
    pub forgotten: Vec<AlbumRow>,
    pub random_albums: Vec<AlbumRow>,
    pub genres: Vec<GenreRow>,
    pub videos: Vec<TrackRow>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenreRow {
    pub name: String,
    pub track_count: i64,
    pub album_count: i64,
}

pub fn genres(conn: &Connection) -> rusqlite::Result<Vec<GenreRow>> {
    let mut stmt = conn.prepare_cached(
        "SELECT genre, COUNT(*), COUNT(DISTINCT album_id) FROM track WHERE genre IS NOT NULL AND missing = 0 AND kind = 'audio' GROUP BY lower(genre) ORDER BY COUNT(*) DESC",
    )?;
    let rows = stmt.query_map([], |r| Ok(GenreRow { name: r.get(0)?, track_count: r.get(1)?, album_count: r.get(2)? }))?;
    rows.collect()
}

pub fn home(conn: &Connection) -> rusqlite::Result<Home> {
    let now = crate::database::now_ms();
    let sixty_days = 60 * 24 * 3600 * 1000_i64;
    Ok(Home {
        recently_added: albums_where(conn, "", "ORDER BY MAX(t.added_at) DESC LIMIT 18", [])?,
        recently_played: albums_where(conn, "", "HAVING MAX(st.last_played_at) IS NOT NULL ORDER BY MAX(st.last_played_at) DESC LIMIT 12", [])?,
        most_played: tracks_where(conn, "WHERE t.missing = 0 AND t.kind = 'audio' AND st.play_count > 0 ORDER BY st.play_count DESC, st.last_played_at DESC LIMIT 12", [])?,
        forgotten: albums_where(conn, "", "HAVING MAX(st.last_played_at) IS NOT NULL AND MAX(st.last_played_at) < ?1 ORDER BY SUM(st.play_count) DESC LIMIT 10", [now - sixty_days])?,
        random_albums: albums_where(conn, "", "ORDER BY random() LIMIT 8", [])?,
        genres: genres(conn)?,
        videos: tracks_where(conn, "WHERE t.missing = 0 AND t.kind = 'video' ORDER BY t.added_at DESC LIMIT 8", [])?,
    })
}

pub fn albums_for_genre(conn: &Connection, genre: &str) -> rusqlite::Result<Vec<AlbumRow>> {
    albums_where(conn, "WHERE lower(t.genre) = lower(?1)", "ORDER BY a.year DESC", [genre])
}

pub fn albums_for_year(conn: &Connection, year: i64) -> rusqlite::Result<Vec<AlbumRow>> {
    albums_where(conn, "WHERE a.year = ?1", "ORDER BY lower(ar.sort_name)", [year])
}

// ---------- playlists ----------
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistRow {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub track_count: i64,
    pub duration_ms: i64,
    pub updated_at: i64,
    pub arts: Vec<String>,
}

fn playlists_where(conn: &Connection, clause: &str, p: impl rusqlite::Params) -> rusqlite::Result<Vec<PlaylistRow>> {
    let sql = format!(
        "SELECT p.id, p.name, p.description, COUNT(t.id), COALESCE(SUM(t.duration_ms), 0), p.updated_at,
            (SELECT group_concat(h, ',') FROM (SELECT DISTINCT t2.artwork_hash AS h FROM playlist_track pt2 JOIN track t2 ON t2.id = pt2.track_id
                WHERE pt2.playlist_id = p.id AND t2.artwork_hash IS NOT NULL ORDER BY pt2.position LIMIT 4))
         FROM playlist p LEFT JOIN playlist_track pt ON pt.playlist_id = p.id LEFT JOIN track t ON t.id = pt.track_id AND t.missing = 0
         {clause} GROUP BY p.id ORDER BY p.updated_at DESC"
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    let rows = stmt.query_map(p, |r| {
        let arts: Option<String> = r.get(6)?;
        Ok(PlaylistRow {
            id: r.get(0)?,
            name: r.get(1)?,
            description: r.get(2)?,
            track_count: r.get(3)?,
            duration_ms: r.get(4)?,
            updated_at: r.get(5)?,
            arts: arts.map(|s| s.split(',').map(str::to_string).collect()).unwrap_or_default(),
        })
    })?;
    rows.collect()
}

pub fn playlists(conn: &Connection) -> rusqlite::Result<Vec<PlaylistRow>> {
    playlists_where(conn, "", [])
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistEntry {
    pub entry_id: i64,
    pub track: TrackRow,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistDetail {
    pub playlist: PlaylistRow,
    pub entries: Vec<PlaylistEntry>,
}

pub fn playlist(conn: &Connection, id: i64) -> rusqlite::Result<Option<PlaylistDetail>> {
    let Some(pl) = playlists_where(conn, "WHERE p.id = ?1", [id])?.into_iter().next() else { return Ok(None) };
    let sql = format!("{} JOIN playlist_track pt ON pt.track_id = t.id WHERE pt.playlist_id = ?1 ORDER BY pt.position", TRACK_SELECT.replace("SELECT t.id,", "SELECT pt.id AS entry_id, t.id,"));
    let mut stmt = conn.prepare_cached(&sql)?;
    let rows = stmt.query_map([id], |r| {
        let entry_id: i64 = r.get(0)?;
        // shift columns by one
        let track = TrackRow {
            id: r.get(1)?, title: r.get(2)?, artist: r.get(3)?, artist_id: r.get(4)?, album: r.get(5)?, album_id: r.get(6)?, album_artist: r.get(7)?,
            track_no: r.get(8)?, disc_no: r.get(9)?, year: r.get(10)?, genre: r.get(11)?, duration_ms: r.get(12)?, codec: r.get(13)?, bitrate: r.get(14)?,
            sample_rate: r.get(15)?, bit_depth: r.get(16)?, channels: r.get(17)?, art: r.get(18)?, has_lyrics: r.get::<_, i64>(19)? != 0, kind: r.get(20)?,
            favourite: r.get::<_, i64>(21)? != 0, play_count: r.get(22)?, last_played_at: r.get(23)?, added_at: r.get(24)?, missing: r.get::<_, i64>(25)? != 0,
            rg_track: r.get(26)?, rg_album: r.get(27)?, file_size: r.get(28)?,
        };
        Ok(PlaylistEntry { entry_id, track })
    })?;
    let entries = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Some(PlaylistDetail { playlist: pl, entries }))
}

pub fn favourites(conn: &Connection) -> rusqlite::Result<Vec<TrackRow>> {
    tracks_where(conn, "WHERE fav.track_id IS NOT NULL AND t.missing = 0 ORDER BY fav.created_at DESC", [])
}

pub fn history(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<TrackRow>> {
    tracks_where(
        conn,
        "JOIN (SELECT track_id, MAX(played_at) AS last FROM play_history GROUP BY track_id ORDER BY last DESC LIMIT ?1) h ON h.track_id = t.id WHERE t.missing = 0 ORDER BY h.last DESC",
        [limit],
    )
}

pub fn most_played(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<TrackRow>> {
    tracks_where(conn, "WHERE st.play_count > 0 AND t.missing = 0 ORDER BY st.play_count DESC, st.last_played_at DESC LIMIT ?1", [limit])
}

pub fn recently_added_tracks(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<TrackRow>> {
    tracks_where(conn, "WHERE t.missing = 0 AND t.kind = 'audio' ORDER BY t.added_at DESC LIMIT ?1", [limit])
}

#[cfg(test)]
mod perf {
    use crate::library::store::{upsert_track, FileFacts};
    use crate::metadata::tags::{MediaKind, TrackMeta};
    use std::time::Instant;

    /// 20k tracks / 2k albums: the read models the UI uses must stay interactive.
    #[test]
    fn large_library_queries_are_fast() {
        let db = crate::database::Db::open_in_memory().unwrap();
        db.with_mut(|c| {
            c.execute("INSERT INTO library_folder(path, added_at) VALUES ('/music', 0)", [])?;
            let tx = c.transaction()?;
            for i in 0..20_000u32 {
                let artist = format!("Artist {}", i % 400);
                let album = format!("Album {}", i % 2000);
                let path = format!("/music/{artist}/{album}/{i:05}.flac");
                let m = TrackMeta { title: Some(format!("Song number {i}")), artist: Some(artist.clone()), album: Some(album), track_no: Some(i % 10 + 1), year: Some(1990 + (i % 30) as i32), genre: Some(["Emo", "Metal", "Indie", "Post-Hardcore"][(i % 4) as usize].into()), duration_ms: 200_000, ..Default::default() };
                let f = FileFacts { folder_id: 1, path: &path, filename: "x.flac", size: 1, mtime: 1, kind: MediaKind::Audio, artwork_hash: None, has_lyrics: false, dir_album: None, dir_artist: None, file_title: "x".into(), file_track_no: None };
                upsert_track(&tx, &f, &m)?;
            }
            tx.commit()
        })
        .unwrap();
        db.with(|c| {
            let t = Instant::now();
            let tracks = super::all_tracks(c, "audio")?;
            let t_tracks = t.elapsed();
            let t = Instant::now();
            let albums = super::all_albums(c)?;
            let t_albums = t.elapsed();
            let t = Instant::now();
            let artists = super::all_artists(c)?;
            let t_artists = t.elapsed();
            let t = Instant::now();
            let s = super::search(c, "song 1999")?;
            let t_search = t.elapsed();
            let t = Instant::now();
            let _ = super::home(c)?;
            let t_home = t.elapsed();
            eprintln!("tracks {} in {:?}, albums {} in {:?}, artists {} in {:?}, search {} in {:?}, home {:?}", tracks.len(), t_tracks, albums.len(), t_albums, artists.len(), t_artists, s.tracks.len(), t_search, t_home);
            assert_eq!(tracks.len(), 20_000);
            assert_eq!(albums.len(), 2000);
            assert!(t_tracks.as_millis() < 2500 && t_albums.as_millis() < 1500 && t_search.as_millis() < 300, "too slow");
            Ok(())
        })
        .unwrap();
    }
}
