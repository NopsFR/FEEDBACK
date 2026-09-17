//! Atomic, retry-safe phone edits. Conflicting playlist edits preserve both versions.
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use crate::{database::now_ms, library::{mutate, query}};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Edit {
    pub operation_id: String,
    pub kind: String,
    pub id: Option<i64>,
    pub on: Option<bool>,
    pub base: Option<Value>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub track_ids: Option<Vec<i64>>,
}

pub fn fingerprint(detail: &query::PlaylistDetail) -> Value {
    json!({"name": detail.playlist.name, "description": detail.playlist.description,
        "entries": detail.entries.iter().map(|e| vec![e.entry_id, e.track.id]).collect::<Vec<_>>(),
        "rules": detail.playlist.rules})
}

pub fn apply(conn: &mut Connection, device: i64, edit: Edit) -> Result<Value, String> {
    if edit.operation_id.is_empty() || edit.operation_id.len() > 80 { return Err("Invalid edit identifier.".into()); }
    let run = || -> rusqlite::Result<Value> {
        let tx = conn.transaction()?;
        if let Some(result) = tx.query_row("SELECT result FROM phone_edit_receipt WHERE device_id=?1 AND operation_id=?2", params![device, edit.operation_id], |r| r.get::<_, String>(0)).optional()? {
            return serde_json::from_str(&result).map_err(|e| rusqlite::Error::InvalidParameterName(e.to_string()));
        }
        let invalid = |message: &str| rusqlite::Error::InvalidParameterName(message.into());
        let result = match edit.kind.as_str() {
            "favourite" => {
                let id = edit.id.ok_or_else(|| invalid("A track is required."))?;
                let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM track WHERE id=?1)", [id], |r| r.get(0))?;
                if exists { mutate::toggle_favourite(&tx, id, edit.on.ok_or_else(|| invalid("A favourite value is required."))?)?; }
                json!({"deleted": !exists})
            }
            "playlist" | "deletePlaylist" => {
                let current = match edit.id { Some(id) => query::playlist(&tx, id)?, None => None };
                if current.as_ref().is_some_and(|d| d.playlist.rules.is_some()) { return Err(invalid("Edit smart-playlist rules on the computer.")); }
                let conflict = edit.id.is_some() && current.as_ref().map(fingerprint) != edit.base;
                if edit.kind == "deletePlaylist" {
                    if current.is_some() && conflict { return Err(invalid("This playlist changed on the computer. Open it again before deleting it.")); }
                    if let Some(id) = edit.id { mutate::delete_playlist(&tx, id)?; }
                    json!({"deleted": true})
                } else {
                    let name = edit.name.as_deref().unwrap_or("").trim();
                    let ids = edit.track_ids.as_deref().unwrap_or(&[]);
                    if name.is_empty() || name.len() > 480 || ids.len() > 10000 || edit.description.as_ref().is_some_and(|d| d.len() > 4000) { return Err(invalid("Check the playlist name and track limit (10,000).")); }
                    // A deleted/changed desktop playlist becomes a separate phone copy.
                    let id = if conflict || current.is_none() {
                        mutate::create_playlist(&tx, &if conflict { format!("{name} (phone copy)") } else { name.into() })?
                    } else { edit.id.unwrap() };
                    if !conflict { mutate::rename_playlist(&tx, id, name, edit.description.as_deref())?; }
                    tx.execute("DELETE FROM playlist_track WHERE playlist_id=?1", [id])?;
                    let mut omitted = 0;
                    for (position, track) in ids.iter().enumerate() {
                        let n = tx.execute("INSERT INTO playlist_track(playlist_id,track_id,position,added_at) SELECT ?1,id,?3,?4 FROM track WHERE id=?2", params![id, track, position as i64, now_ms()])?;
                        omitted += usize::from(n == 0);
                    }
                    tx.execute("UPDATE playlist SET updated_at=?2 WHERE id=?1", params![id, now_ms()])?;
                    json!({"detail": query::playlist(&tx, id)?, "conflict": conflict, "omitted": omitted})
                }
            }
            _ => return Err(invalid("Unknown phone edit.")),
        };
        tx.execute("INSERT INTO phone_edit_receipt(device_id,operation_id,result) VALUES (?1,?2,?3)", params![device, edit.operation_id, result.to_string()])?;
        // Receipts only guard retries of recent operations; keep the newest few hundred per device.
        tx.execute(
            "DELETE FROM phone_edit_receipt WHERE device_id=?1 AND rowid NOT IN (SELECT rowid FROM phone_edit_receipt WHERE device_id=?1 ORDER BY rowid DESC LIMIT 400)",
            [device],
        )?;
        tx.commit()?;
        Ok(result)
    };
    let mut run = run;
    run().map_err(|e| match e { rusqlite::Error::InvalidParameterName(message) => message, other => { log::error!(target: "SYNC", "phone edit: {other}"); "Couldn't save this edit. It remains on your phone.".into() } })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn edit(value: Value) -> Edit { serde_json::from_value(value).unwrap() }
    #[test]
    fn retries_conflicts_and_smart_protection() {
        let db = crate::database::Db::open_in_memory().unwrap();
        db.with_mut(|c| {
            c.execute("INSERT INTO device(id,name,token_hash,created_at) VALUES (1,'Phone','test',0)", [])?;
            c.execute("INSERT INTO track(id,path,filename,title,artist_name,album_title,album_artist_name,added_at) VALUES (1,'/a','a','A','B','C','B',0)", [])?;
            let create = json!({"operationId":"one","kind":"playlist","name":"Phone list","trackIds":[1,1]});
            let result = apply(c, 1, edit(create.clone())).unwrap();
            assert_eq!(apply(c, 1, edit(create)).unwrap(), result);
            let id = result["detail"]["playlist"]["id"].as_i64().unwrap();
            let original = query::playlist(c, id)?.unwrap();
            assert_eq!(original.entries.len(), 2);
            let base = fingerprint(&original);
            mutate::rename_playlist(c, id, "Desktop change", None)?;
            let conflict = apply(c, 1, edit(json!({"operationId":"two","kind":"playlist","id":id,"base":base,"name":"Phone change","trackIds":[1]}))).unwrap();
            assert_eq!(conflict["conflict"], true);
            assert_ne!(conflict["detail"]["playlist"]["id"], id);
            assert_eq!(query::playlist(c, id)?.unwrap().playlist.name, "Desktop change");
            assert!(apply(c, 1, edit(json!({"operationId":"three","kind":"deletePlaylist","id":id,"base":base}))).is_err());
            let rules = json!({"match":"all","conditions":[{"field":"plays","op":"gte","value":0}],"sort":"title","limit":null});
            let smart = mutate::create_smart_playlist(c, "Smart", &rules)?;
            assert!(apply(c, 1, edit(json!({"operationId":"four","kind":"playlist","id":smart,"name":"Oops","trackIds":[]}))).is_err());
            Ok(())
        }).unwrap();
    }
}
