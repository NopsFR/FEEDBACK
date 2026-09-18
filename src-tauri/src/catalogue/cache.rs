//! A bounded, versioned cache for catalogue answers.
//!
//! Entries hold already-normalised FEEDBACK models, never raw provider payloads, so a provider can
//! change its wire format without poisoning what's stored. Nothing here is authoritative: every row
//! has an expiry, the table is pruned, and a miss simply means asking again.
use crate::database::{now_ms, Db};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

/// Bump when the shape of a cached value changes: older rows are then ignored and pruned.
pub const SCHEMA: i64 = 1;
/// Plenty for a personal library; keeps the file from growing without bound.
const MAX_ROWS: i64 = 5_000;

static HITS: AtomicU64 = AtomicU64::new(0);
static MISSES: AtomicU64 = AtomicU64::new(0);
static STALE: AtomicU64 = AtomicU64::new(0);

/// What kind of answer this is — which decides how long it stays fresh.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Search,
    Recording,
    Release,
    Artist,
    ArtworkRef,
    Lyrics,
    Recommendation,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Search => "search",
            Kind::Recording => "recording",
            Kind::Release => "release",
            Kind::Artist => "artist",
            Kind::ArtworkRef => "artwork",
            Kind::Lyrics => "lyrics",
            Kind::Recommendation => "recommendation",
        }
    }

    /// How long an answer of this kind is worth trusting.
    ///
    /// Searches go stale as a service's index changes, so they're short. Identity facts — what a
    /// recording is, which release it came from — barely change, so they're long. Lyrics are edited
    /// occasionally but not often. Recommendations are meant to move.
    pub fn ttl(self) -> Duration {
        match self {
            Kind::Search => Duration::from_secs(60 * 60 * 6),
            Kind::Recording | Kind::Release | Kind::Artist => Duration::from_secs(60 * 60 * 24 * 30),
            Kind::ArtworkRef => Duration::from_secs(60 * 60 * 24 * 60),
            Kind::Lyrics => Duration::from_secs(60 * 60 * 24 * 30),
            Kind::Recommendation => Duration::from_secs(60 * 60 * 12),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub hits: u64,
    pub misses: u64,
    pub stale_served: u64,
    pub rows: i64,
    pub schema: i64,
}

pub fn key(provider: &str, kind: Kind, args: &str) -> String {
    format!("{provider}:{}:{}:{}", kind.as_str(), SCHEMA, args.trim().to_lowercase())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Freshness {
    Fresh,
    /// Past its expiry but still worth showing while a new answer is fetched.
    Stale,
}

pub struct Hit<T> {
    pub value: T,
    pub freshness: Freshness,
    pub age_ms: i64,
}

/// Read a cached value. Expired rows come back marked `Stale` so a caller can serve them while
/// revalidating, or ignore them when only a fresh answer will do.
pub fn get<T: serde::de::DeserializeOwned>(db: &Db, key: &str) -> Option<Hit<T>> {
    let row = db
        .with(|c| {
            c.query_row("SELECT body, fetched_at, expires_at FROM cat_cache WHERE key = ?1 AND schema = ?2", params![key, SCHEMA], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?))
            })
            .optional()
        })
        .ok()
        .flatten();
    let (body, fetched_at, expires_at) = row?;
    let value = serde_json::from_str::<T>(&body).ok()?;
    let now = now_ms();
    let freshness = if now <= expires_at { Freshness::Fresh } else { Freshness::Stale };
    if freshness == Freshness::Fresh {
        HITS.fetch_add(1, Ordering::Relaxed);
    } else {
        STALE.fetch_add(1, Ordering::Relaxed);
    }
    Some(Hit { value, freshness, age_ms: now - fetched_at })
}

pub fn miss() {
    MISSES.fetch_add(1, Ordering::Relaxed);
}

pub fn put<T: Serialize>(db: &Db, key: &str, provider: &str, kind: Kind, value: &T) {
    put_for(db, key, provider, kind, value, kind.ttl());
}

/// Same, with an explicit lifetime — for answers that deserve less trust, such as "nothing found".
pub fn put_for<T: Serialize>(db: &Db, key: &str, provider: &str, kind: Kind, value: &T, ttl: Duration) {
    let Ok(body) = serde_json::to_string(value) else { return };
    let now = now_ms();
    let expires = now + ttl.as_millis() as i64;
    let _ = db.with(|c| {
        c.execute(
            "INSERT INTO cat_cache(key, provider, kind, body, fetched_at, expires_at, schema) VALUES (?1,?2,?3,?4,?5,?6,?7)
             ON CONFLICT(key) DO UPDATE SET body=excluded.body, fetched_at=excluded.fetched_at, expires_at=excluded.expires_at, schema=excluded.schema",
            params![key, provider, kind.as_str(), body, now, expires, SCHEMA],
        )?;
        Ok(())
    });
}

/// Drop expired rows, anything written by an older schema, and the oldest rows above the cap.
pub fn prune(db: &Db) -> rusqlite::Result<usize> {
    db.with(|c| {
        let mut removed = c.execute("DELETE FROM cat_cache WHERE expires_at < ?1 OR schema <> ?2", params![now_ms(), SCHEMA])?;
        removed += c.execute("DELETE FROM cat_cache WHERE key IN (SELECT key FROM cat_cache ORDER BY fetched_at DESC LIMIT -1 OFFSET ?1)", [MAX_ROWS])?;
        Ok(removed)
    })
}

pub fn clear(db: &Db, provider: Option<&str>) -> rusqlite::Result<usize> {
    db.with(|c| match provider {
        Some(p) => c.execute("DELETE FROM cat_cache WHERE provider = ?1", [p]),
        None => c.execute("DELETE FROM cat_cache", []),
    })
}

pub fn stats(db: &Db) -> Stats {
    let rows = db.with(|c| c.query_row("SELECT COUNT(*) FROM cat_cache", [], |r| r.get::<_, i64>(0))).unwrap_or(0);
    Stats { hits: HITS.load(Ordering::Relaxed), misses: MISSES.load(Ordering::Relaxed), stale_served: STALE.load(Ordering::Relaxed), rows, schema: SCHEMA }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_round_trip_expire_and_prune() {
        let db = Db::open_in_memory().unwrap();
        let k = key("musicbrainz", Kind::Search, " Kid A ");
        assert_eq!(k, "musicbrainz:search:1:kid a", "keys are per provider, kind, schema and normalised args");
        assert!(get::<Vec<String>>(&db, &k).is_none());

        put(&db, &k, "musicbrainz", Kind::Search, &vec!["a".to_string(), "b".to_string()]);
        let hit = get::<Vec<String>>(&db, &k).expect("cached");
        assert_eq!(hit.value, vec!["a", "b"]);
        assert_eq!(hit.freshness, Freshness::Fresh);

        // An entry past its expiry is still handed back, marked stale, so callers can revalidate.
        db.with(|c| c.execute("UPDATE cat_cache SET expires_at = 1 WHERE key = ?1", [&k]).map(|_| ())).unwrap();
        assert_eq!(get::<Vec<String>>(&db, &k).unwrap().freshness, Freshness::Stale);
        assert_eq!(prune(&db).unwrap(), 1);
        assert!(get::<Vec<String>>(&db, &k).is_none());
    }

    #[test]
    fn rows_from_an_older_schema_are_ignored() {
        let db = Db::open_in_memory().unwrap();
        db.with(|c| {
            c.execute(
                "INSERT INTO cat_cache(key, provider, kind, body, fetched_at, expires_at, schema) VALUES ('old','musicbrainz','search','[\"x\"]', ?1, ?2, 0)",
                params![now_ms(), now_ms() + 100_000],
            )
            .map(|_| ())
        })
        .unwrap();
        assert!(get::<Vec<String>>(&db, "old").is_none(), "a value written by an older cache schema must not be trusted");
        assert_eq!(prune(&db).unwrap(), 1);
    }
}
