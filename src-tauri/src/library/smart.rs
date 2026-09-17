//! Validated smart-playlist rules compiled to parameterised SQLite queries.
use rusqlite::{params_from_iter, types::Value, Connection};
use serde::{Deserialize, Serialize};

use super::query::{track_from_row, TrackRow, TRACK_SELECT};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rules {
    pub r#match: Match,
    pub conditions: Vec<Condition>,
    pub sort: Sort,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Match {
    All,
    Any,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Condition {
    pub field: String,
    pub op: String,
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Sort {
    AddedDesc,
    PlaysDesc,
    LastPlayedDesc,
    YearDesc,
    Title,
    Artist,
    Random,
}

fn text(value: &serde_json::Value) -> Result<String, String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| "This rule needs some text.".into())
}
fn number(value: &serde_json::Value) -> Result<i64, String> {
    value
        .as_i64()
        .filter(|v| *v >= 0)
        .ok_or_else(|| "This rule needs a positive number.".into())
}

pub fn compile(rules: &Rules) -> Result<(String, Vec<Value>), String> {
    if rules.conditions.is_empty() {
        return Err("Add at least one rule.".into());
    }
    if rules.conditions.len() > 20 {
        return Err("A smart playlist can have up to 20 rules.".into());
    }
    if rules.limit.is_some_and(|v| v == 0 || v > 10_000) {
        return Err("The track limit must be between 1 and 10,000.".into());
    }

    let mut clauses = Vec::with_capacity(rules.conditions.len());
    let mut values = Vec::with_capacity(rules.conditions.len());
    for c in &rules.conditions {
        let (sql, value) = match (c.field.as_str(), c.op.as_str()) {
            ("genre", "is") => ("lower(COALESCE(t.genre,'')) = lower(?)", Value::Text(text(&c.value)?)),
            ("genre", "contains") => ("instr(lower(COALESCE(t.genre,'')), lower(?)) > 0", Value::Text(text(&c.value)?)),
            ("genre", "not") => ("lower(COALESCE(t.genre,'')) != lower(?)", Value::Text(text(&c.value)?)),
            ("artist", "is") => ("lower(t.artist_name) = lower(?)", Value::Text(text(&c.value)?)),
            ("artist", "contains") => ("instr(lower(t.artist_name), lower(?)) > 0", Value::Text(text(&c.value)?)),
            ("artist", "not") => ("lower(t.artist_name) != lower(?)", Value::Text(text(&c.value)?)),
            ("album", "is") => ("lower(t.album_title) = lower(?)", Value::Text(text(&c.value)?)),
            ("album", "contains") => ("instr(lower(t.album_title), lower(?)) > 0", Value::Text(text(&c.value)?)),
            ("album", "not") => ("lower(t.album_title) != lower(?)", Value::Text(text(&c.value)?)),
            ("codec", "is") => ("lower(COALESCE(t.codec,'')) = lower(?)", Value::Text(text(&c.value)?)),
            ("year", "eq") => ("COALESCE(t.year,0) = ?", Value::Integer(number(&c.value)?)),
            ("year", "gte") => ("COALESCE(t.year,0) >= ?", Value::Integer(number(&c.value)?)),
            ("year", "lte") => ("COALESCE(t.year,0) <= ?", Value::Integer(number(&c.value)?)),
            ("plays", "eq") => ("COALESCE(st.play_count,0) = ?", Value::Integer(number(&c.value)?)),
            ("plays", "gte") => ("COALESCE(st.play_count,0) >= ?", Value::Integer(number(&c.value)?)),
            ("plays", "lte") => ("COALESCE(st.play_count,0) <= ?", Value::Integer(number(&c.value)?)),
            ("duration", "gte") => ("t.duration_ms >= ? * 1000", Value::Integer(number(&c.value)?)),
            ("duration", "lte") => ("t.duration_ms <= ? * 1000", Value::Integer(number(&c.value)?)),
            ("added", "within") => ("t.added_at >= CAST(strftime('%s','now') AS INTEGER) * 1000 - ? * 86400000", Value::Integer(number(&c.value)?)),
            ("lastPlayed", "within") => ("st.last_played_at >= CAST(strftime('%s','now') AS INTEGER) * 1000 - ? * 86400000", Value::Integer(number(&c.value)?)),
            ("lastPlayed", "notWithin") => ("st.last_played_at IS NOT NULL AND st.last_played_at < CAST(strftime('%s','now') AS INTEGER) * 1000 - ? * 86400000", Value::Integer(number(&c.value)?)),
            ("lastPlayed", "never") => ("st.last_played_at IS NULL", Value::Null),
            ("favourite", "true") => ("fav.track_id IS NOT NULL", Value::Null),
            ("favourite", "false") => ("fav.track_id IS NULL", Value::Null),
            _ => return Err(format!("Unsupported smart-playlist rule: {} {}.", c.field, c.op)),
        };
        clauses.push(sql);
        if value != Value::Null {
            values.push(value);
        }
    }
    let join = match rules.r#match {
        Match::All => " AND ",
        Match::Any => " OR ",
    };
    let order = match rules.sort {
        Sort::AddedDesc => "t.added_at DESC",
        Sort::PlaysDesc => "COALESCE(st.play_count,0) DESC, lower(t.title)",
        Sort::LastPlayedDesc => "st.last_played_at DESC",
        Sort::YearDesc => "t.year DESC, lower(t.album_title), t.track_no",
        Sort::Title => "lower(t.title)",
        Sort::Artist => "lower(t.artist_name), lower(t.album_title), t.track_no",
        Sort::Random => "random()",
    };
    let mut tail = format!(
        "WHERE t.missing = 0 AND t.kind = 'audio' AND ({}) ORDER BY {order}",
        clauses.join(join)
    );
    if let Some(limit) = rules.limit {
        tail.push_str(" LIMIT ?");
        values.push(Value::Integer(limit.into()));
    }
    Ok((tail, values))
}

pub fn tracks(conn: &Connection, rules: &Rules) -> rusqlite::Result<Vec<TrackRow>> {
    let (tail, values) = compile(rules).map_err(rusqlite::Error::InvalidParameterName)?;
    let mut stmt = conn.prepare(&format!("{TRACK_SELECT} {tail}"))?;
    let tracks = stmt
        .query_map(params_from_iter(values), track_from_row)?
        .collect();
    tracks
}

#[cfg(test)]
mod tests {
    /// Every rule the editor offers (src/features/playlists/SmartPlaylistEditor.tsx) must compile here.
    #[test]
    fn every_offered_rule_compiles() {
        let pairs = [
            ("genre", "is"), ("genre", "contains"), ("genre", "not"),
            ("artist", "is"), ("artist", "contains"), ("artist", "not"),
            ("album", "is"), ("album", "contains"), ("album", "not"),
            ("codec", "is"),
            ("year", "eq"), ("year", "gte"), ("year", "lte"),
            ("plays", "eq"), ("plays", "gte"), ("plays", "lte"),
            ("duration", "gte"), ("duration", "lte"),
            ("added", "within"),
            ("lastPlayed", "within"), ("lastPlayed", "notWithin"), ("lastPlayed", "never"),
            ("favourite", "true"), ("favourite", "false"),
        ];
        for (field, op) in pairs {
            let value = if matches!(field, "genre" | "artist" | "album" | "codec") { serde_json::json!("x") } else { serde_json::json!(2) };
            let rules = super::Rules {
                r#match: super::Match::All,
                conditions: vec![super::Condition { field: field.into(), op: op.into(), value }],
                sort: super::Sort::Title,
                limit: None,
            };
            super::compile(&rules).unwrap_or_else(|e| panic!("{field} {op}: {e}"));
        }
    }

    use super::*;
    #[test]
    fn compiler_binds_values_and_rejects_unknown_rules() {
        let rules = Rules {
            r#match: Match::All,
            conditions: vec![Condition {
                field: "artist".into(),
                op: "contains".into(),
                value: "x') OR 1=1 --".into(),
            }],
            sort: Sort::Title,
            limit: Some(50),
        };
        let (sql, values) = compile(&rules).unwrap();
        assert!(!sql.contains("OR 1=1"));
        assert_eq!(values, vec![Value::Text("x') OR 1=1 --".into()), Value::Integer(50)]);
        let bad = Rules {
            conditions: vec![Condition {
                field: "path".into(),
                op: "contains".into(),
                value: "x".into(),
            }],
            ..rules
        };
        assert!(compile(&bad).is_err());
    }

    #[test]
    fn smart_playlist_returns_matching_tracks() {
        let db = crate::database::Db::open_in_memory().unwrap();
        db.with(|c| {
            c.execute("INSERT INTO track(path,filename,title,artist_name,album_title,album_artist_name,year,genre,duration_ms,added_at) VALUES ('/a','a','Old Loud','Band','One','Band',1999,'Punk',180000,1)", [])?;
            let first = c.last_insert_rowid();
            c.execute("INSERT INTO track(path,filename,title,artist_name,album_title,album_artist_name,year,genre,duration_ms,added_at) VALUES ('/b','b','New Quiet','Band','Two','Band',2024,'Folk',180000,2)", [])?;
            c.execute("INSERT INTO play_stats(track_id,play_count) VALUES (?1,8)", [first])?;
            let rules = Rules { r#match: Match::All, conditions: vec![
                Condition { field: "genre".into(), op: "is".into(), value: "punk".into() },
                Condition { field: "plays".into(), op: "gte".into(), value: 5.into() },
            ], sort: Sort::PlaysDesc, limit: None };
            let found = tracks(c, &rules)?;
            assert_eq!(found.len(), 1);
            assert_eq!(found[0].title, "Old Loud");
            Ok(())
        }).unwrap();
    }
}
