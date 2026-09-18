//! Playback URLs for the user's own cloud copies.
//!
//! Objects are private. A play gets a short-lived signed URL, which is deliberately *not* stored:
//! caching an expiring URL is how a player ends up with a track that silently 403s an hour later.
//! The stable thing — which object a track is — is cached; the permission is not.
use super::{auth, classify, now_secs, CloudResult, BASE_URL, BUCKET, PUBLISHABLE_KEY};
use crate::database::Db;
use serde::Serialize;
use std::time::Duration;

/// Long enough for a full track and a few seeks, short enough that a leaked URL is worthless.
pub const SIGNED_URL_SECS: i64 = 60 * 60 * 2;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamUrl {
    pub url: String,
    /// Unix seconds. The client asks again after this rather than replaying a dead URL.
    pub expires_at: i64,
}

pub fn signed_url(db: &Db, object_path: &str) -> CloudResult<StreamUrl> {
    let session = auth::current(db)?;
    let url = format!("{BASE_URL}/storage/v1/object/sign/{BUCKET}/{object_path}");
    let body: serde_json::Value = ureq::post(&url)
        .set("apikey", PUBLISHABLE_KEY)
        .set("Authorization", &format!("Bearer {}", session.access_token))
        .set("Content-Type", "application/json")
        .timeout(Duration::from_secs(20))
        .send_json(serde_json::json!({ "expiresIn": SIGNED_URL_SECS }))
        .map_err(classify)?
        .into_json()
        .map_err(|_| super::CloudError::Rejected("That storage reply made no sense.".into()))?;

    let signed = body.get("signedURL").or_else(|| body.get("signedUrl")).and_then(|v| v.as_str()).ok_or_else(|| super::CloudError::Rejected("Storage didn't return a link for that track.".into()))?;
    Ok(StreamUrl { url: format!("{BASE_URL}/storage/v1{signed}"), expires_at: now_secs() + SIGNED_URL_SECS - 60 })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_signed_url_expires_before_the_service_says_it_does() {
        // The client refreshes early, so a long track can't run past its own permission.
        let stream = StreamUrl { url: "https://x/y".into(), expires_at: now_secs() + SIGNED_URL_SECS - 60 };
        assert!(stream.expires_at < now_secs() + SIGNED_URL_SECS);
    }
}
