//! The Cover Art Archive: sleeves for MusicBrainz releases.
//!
//! Keyed by release or release-group MBID, so it only works once identity is settled. Thumbnails
//! come in fixed sizes; FEEDBACK asks for the smallest one that suits the surface rather than
//! pulling full-resolution scans onto a phone.
use crate::catalogue::net::Lane;
use crate::catalogue::{ArtworkProvider, ExternalIds, ProviderError, ProviderResult};
use std::sync::Arc;

pub const ID: &str = "coverart";
const BASE: &str = "https://coverartarchive.org";
const MAX_BYTES: usize = 12 * 1024 * 1024;

pub struct CoverArtArchive {
    lane: Arc<Lane>,
}

impl CoverArtArchive {
    pub fn new(lane: Arc<Lane>) -> Self {
        Self { lane }
    }
}

fn valid_mbid(id: &str) -> bool {
    id.len() == 36 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// 250, 500 and 1200 are the sizes the archive publishes; anything else means the original scan.
pub fn front_url(kind: &str, mbid: &str, size: u32) -> Option<String> {
    if !valid_mbid(mbid) {
        return None;
    }
    let suffix = match size {
        250 => "front-250",
        500 => "front-500",
        1200 => "front-1200",
        _ => "front",
    };
    Some(format!("{BASE}/{kind}/{mbid}/{suffix}"))
}

impl ArtworkProvider for CoverArtArchive {
    fn id(&self) -> &'static str {
        ID
    }

    /// Prefer the exact release the user has; fall back to the release group, which is what most
    /// people mean by "the album cover" when their pressing has no scan of its own.
    fn artwork(&self, ids: &ExternalIds, size: u32) -> ProviderResult<Vec<u8>> {
        let candidates = [ids.release_mbid.as_deref().map(|id| ("release", id)), ids.release_group_mbid.as_deref().map(|id| ("release-group", id))];
        let mut last = ProviderError::NotFound;
        for (kind, mbid) in candidates.into_iter().flatten() {
            let Some(url) = front_url(kind, mbid, size) else {
                last = ProviderError::Malformed("that release id doesn't look right".into());
                continue;
            };
            match self.lane.get_bytes(&url, MAX_BYTES) {
                Ok(bytes) => return Ok(bytes),
                Err(ProviderError::NotFound) => last = ProviderError::NotFound,
                Err(e) => return Err(e),
            }
        }
        Err(last)
    }
}

/// Inline a small preview so the dialog needs no second round trip (and no network of its own).
pub fn data_url(bytes: &[u8]) -> String {
    use base64::Engine;
    let kind = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) { "image/png" } else { "image/jpeg" };
    format!("data:{kind};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_urls_carry_the_image_type() {
        assert!(data_url(&[0x89, b'P', b'N', b'G', 0]).starts_with("data:image/png;base64,"));
        assert!(data_url(&[0xff, 0xd8, 0xff]).starts_with("data:image/jpeg;base64,"));
    }

    #[test]
    fn urls_are_built_only_from_real_looking_ids() {
        assert_eq!(front_url("release", "b8048f24-c026-3398-b23a-b5e50716cbc7", 250).as_deref(), Some("https://coverartarchive.org/release/b8048f24-c026-3398-b23a-b5e50716cbc7/front-250"));
        assert!(front_url("release", "../../etc/passwd", 250).is_none());
        assert!(front_url("release", "not-an-id", 500).is_none());
        assert!(front_url("release-group", "b8048f24-c026-3398-b23a-b5e50716cbc7", 99).unwrap().ends_with("/front"));
    }
}
