//! Provider adapters. Each one speaks to a single service and hands back FEEDBACK's own models.
pub mod coverart;
pub mod musicbrainz;

use super::net::Lane;
use std::sync::Arc;
use std::time::Duration;

/// The lanes every provider shares, built once. Pacing lives here, not in the adapters.
pub struct Lanes {
    pub musicbrainz: Arc<Lane>,
    pub coverart: Arc<Lane>,
}

pub fn user_agent() -> String {
    format!("FEEDBACK/{} ( {} )", env!("CARGO_PKG_VERSION"), super::net::APP_CONTACT)
}

impl Lanes {
    pub fn new() -> Self {
        let ua = user_agent();
        Self {
            // MusicBrainz allows about one request a second per IP, with a contactable user agent.
            // FEEDBACK leaves extra headroom: bursts still earn a 503 that blocks every request
            // from this address, and a personal library has no reason to push the limit.
            musicbrainz: Arc::new(Lane::new("musicbrainz", ua.clone(), Duration::from_millis(1400), Duration::from_secs(20))),
            // The Cover Art Archive publishes no rate limit; still, images are big, so go steadily.
            coverart: Arc::new(Lane::new("coverart", ua, Duration::from_millis(250), Duration::from_secs(30))),
        }
    }

    pub fn all(&self) -> Vec<Arc<Lane>> {
        vec![self.musicbrainz.clone(), self.coverart.clone()]
    }

    pub fn by_id(&self, id: &str) -> Option<Arc<Lane>> {
        self.all().into_iter().find(|l| l.id() == id)
    }
}

impl Default for Lanes {
    fn default() -> Self {
        Self::new()
    }
}
