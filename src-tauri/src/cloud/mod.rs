//! FEEDBACK's account and private cloud.
//!
//! The rules that matter: the client only ever holds a publishable key and the user's own session,
//! every row and every object is owned by that user and enforced by row-level security on the
//! server, and audio objects are private — playback uses short-lived signed URLs that are never
//! cached to disk. Local data is never destroyed because the cloud is unreachable.
pub mod auth;
pub mod stream;
pub mod sync;
pub mod upload;

use serde::{Deserialize, Serialize};

/// Public project endpoint and publishable key. These are meant to be in the client; they grant
/// nothing on their own — RLS decides what the session can see.
pub const BASE_URL: &str = "https://hufbbkfjdhxtjmfhqtvq.supabase.co";
pub const PUBLISHABLE_KEY: &str = "sb_publishable_je_Yqlll1iDGYd8NKK_Zsw_xqBB0Kwf";
pub const BUCKET: &str = "music";
/// Where the session is kept locally (the `setting` table), so a restart stays signed in.
pub const SESSION_KEY: &str = "cloud.session";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub access_token: String,
    pub refresh_token: String,
    /// Unix seconds. Refreshed before it lapses, not after a request fails.
    pub expires_at: i64,
    pub user_id: String,
    pub email: String,
}

impl Session {
    pub fn expired(&self, now: i64) -> bool {
        self.expires_at - 60 <= now
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudStatus {
    pub signed_in: bool,
    pub email: Option<String>,
    pub user_id: Option<String>,
    pub base_url: &'static str,
    /// Set when the last cloud call failed, so the UI can say why without guessing.
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CloudError {
    /// No session, or the session is no longer accepted.
    SignedOut,
    /// The service answered, and said no.
    Rejected(String),
    /// The service could not be reached at all — offline, DNS, timeout.
    Unreachable,
}

impl std::fmt::Display for CloudError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CloudError::SignedOut => write!(f, "Sign in to FEEDBACK to use your account."),
            CloudError::Rejected(m) => write!(f, "{m}"),
            CloudError::Unreachable => write!(f, "FEEDBACK couldn't reach your account right now. Your music on this device still works."),
        }
    }
}

pub type CloudResult<T> = Result<T, CloudError>;

pub fn now_secs() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Turn a transport or HTTP failure into something the UI can act on, without leaking internals.
pub fn classify(error: ureq::Error) -> CloudError {
    match error {
        ureq::Error::Status(401, _) | ureq::Error::Status(403, _) => CloudError::SignedOut,
        ureq::Error::Status(code, response) => {
            let body = response.into_string().unwrap_or_default();
            let message = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| {
                    v.get("msg")
                        .or_else(|| v.get("message"))
                        .or_else(|| v.get("error_description"))
                        .or_else(|| v.get("error"))
                        .and_then(|m| m.as_str().map(str::to_string))
                })
                .unwrap_or_else(|| format!("Your account service answered with {code}."));
            CloudError::Rejected(message)
        }
        ureq::Error::Transport(_) => CloudError::Unreachable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_session_is_refreshed_before_it_lapses_not_after() {
        let session = Session { access_token: "a".into(), refresh_token: "r".into(), expires_at: 1_000, user_id: "u".into(), email: "e".into() };
        assert!(!session.expired(900));
        assert!(session.expired(950), "a minute of headroom, so a request never races the expiry");
        assert!(session.expired(2_000));
    }

    #[test]
    fn failures_are_told_apart() {
        assert_eq!(CloudError::SignedOut.to_string(), "Sign in to FEEDBACK to use your account.");
        assert!(CloudError::Unreachable.to_string().contains("still works"), "being offline must never read like losing your music");
    }
}
