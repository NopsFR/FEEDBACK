//! Accounts: sign up, sign in, refresh, sign out. The session lives in the local settings table so
//! FEEDBACK stays signed in across restarts, and is cleared the moment the user signs out.
use super::{classify, now_secs, CloudError, CloudResult, Session, BASE_URL, PUBLISHABLE_KEY, SESSION_KEY};
use crate::database::Db;
use crate::library::mutate;
use serde_json::Value;
use std::time::Duration;

fn auth_url(path: &str) -> String {
    format!("{BASE_URL}/auth/v1/{path}")
}

fn session_from(body: &Value, fallback_email: &str) -> CloudResult<Session> {
    let access_token = body.get("access_token").and_then(Value::as_str).ok_or_else(|| CloudError::Rejected("That account service reply made no sense.".into()))?;
    let refresh_token = body.get("refresh_token").and_then(Value::as_str).unwrap_or_default();
    let expires_in = body.get("expires_in").and_then(Value::as_i64).unwrap_or(3600);
    let user = body.get("user");
    Ok(Session {
        access_token: access_token.to_string(),
        refresh_token: refresh_token.to_string(),
        expires_at: now_secs() + expires_in,
        user_id: user.and_then(|u| u.get("id")).and_then(Value::as_str).unwrap_or_default().to_string(),
        email: user.and_then(|u| u.get("email")).and_then(Value::as_str).unwrap_or(fallback_email).to_string(),
    })
}

fn post(path: &str, body: Value) -> CloudResult<Value> {
    ureq::post(&auth_url(path))
        .set("apikey", PUBLISHABLE_KEY)
        .set("Content-Type", "application/json")
        .timeout(Duration::from_secs(20))
        .send_json(body)
        .map_err(classify)?
        .into_json()
        .map_err(|_| CloudError::Rejected("That account service reply made no sense.".into()))
}

pub fn save(db: &Db, session: Option<&Session>) -> rusqlite::Result<()> {
    let value = match session {
        Some(s) => serde_json::to_value(s).unwrap_or(Value::Null),
        None => Value::Null,
    };
    db.with(|c| mutate::set_setting(c, SESSION_KEY, &value))
}

pub fn load(db: &Db) -> Option<Session> {
    let settings = db.with(mutate::settings).ok()?;
    serde_json::from_value(settings.get(SESSION_KEY)?.clone()).ok()
}

/// Create an account. Some projects require the email to be confirmed first; when that is the case
/// there is no session yet, and we say so instead of pretending to be signed in.
pub fn sign_up(db: &Db, email: &str, password: &str) -> CloudResult<Option<Session>> {
    if !email.contains('@') || password.chars().count() < 8 {
        return Err(CloudError::Rejected("Use a real email address and a password of at least 8 characters.".into()));
    }
    let body = post("signup", serde_json::json!({ "email": email, "password": password }))?;
    match body.get("access_token") {
        Some(_) => {
            let session = session_from(&body, email)?;
            let _ = save(db, Some(&session));
            Ok(Some(session))
        }
        None => Ok(None),
    }
}

pub fn sign_in(db: &Db, email: &str, password: &str) -> CloudResult<Session> {
    let body = post("token?grant_type=password", serde_json::json!({ "email": email, "password": password }))?;
    let session = session_from(&body, email)?;
    let _ = save(db, Some(&session));
    Ok(session)
}

pub fn refresh(db: &Db, session: &Session) -> CloudResult<Session> {
    if session.refresh_token.is_empty() {
        return Err(CloudError::SignedOut);
    }
    let body = post("token?grant_type=refresh_token", serde_json::json!({ "refresh_token": session.refresh_token }))?;
    let refreshed = session_from(&body, &session.email)?;
    let _ = save(db, Some(&refreshed));
    Ok(refreshed)
}

/// A session that is good to use right now: refreshed when it is close to lapsing.
///
/// Being offline does not sign you out — an unreachable service leaves the stored session alone so
/// everything keeps working when the network comes back.
pub fn current(db: &Db) -> CloudResult<Session> {
    let session = load(db).ok_or(CloudError::SignedOut)?;
    if !session.expired(now_secs()) {
        return Ok(session);
    }
    match refresh(db, &session) {
        Ok(fresh) => Ok(fresh),
        Err(CloudError::Unreachable) => Err(CloudError::Unreachable),
        Err(e) => {
            let _ = save(db, None);
            Err(e)
        }
    }
}

pub fn sign_out(db: &Db) -> CloudResult<()> {
    if let Some(session) = load(db) {
        // Best effort: the local session goes either way.
        let _ = ureq::post(&auth_url("logout"))
            .set("apikey", PUBLISHABLE_KEY)
            .set("Authorization", &format!("Bearer {}", session.access_token))
            .timeout(Duration::from_secs(10))
            .call();
    }
    let _ = save(db, None);
    Ok(())
}

pub fn request_password_reset(email: &str) -> CloudResult<()> {
    post("recover", serde_json::json!({ "email": email })).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_session_survives_a_restart_and_signing_out_clears_it() {
        let db = Db::open_in_memory().unwrap();
        assert!(load(&db).is_none());
        let session = Session { access_token: "a".into(), refresh_token: "r".into(), expires_at: now_secs() + 3600, user_id: "u".into(), email: "me@example.com".into() };
        save(&db, Some(&session)).unwrap();
        assert_eq!(load(&db).unwrap(), session);
        assert_eq!(current(&db).unwrap(), session);
        sign_out(&db).unwrap();
        assert!(load(&db).is_none());
        assert_eq!(current(&db).unwrap_err(), CloudError::SignedOut);
    }

    #[test]
    fn obviously_bad_credentials_never_leave_the_machine() {
        let db = Db::open_in_memory().unwrap();
        assert!(matches!(sign_up(&db, "not-an-email", "longenough"), Err(CloudError::Rejected(_))));
        assert!(matches!(sign_up(&db, "me@example.com", "short"), Err(CloudError::Rejected(_))));
    }

    #[test]
    fn a_reply_without_a_token_is_not_a_session() {
        assert!(session_from(&serde_json::json!({ "user": { "id": "u" } }), "e@x").is_err());
        let ok = session_from(&serde_json::json!({ "access_token": "a", "refresh_token": "r", "expires_in": 60, "user": { "id": "u", "email": "e@x" } }), "fallback@x").unwrap();
        assert_eq!(ok.user_id, "u");
        assert_eq!(ok.email, "e@x");
        assert!(ok.expires_at > now_secs());
    }
}
