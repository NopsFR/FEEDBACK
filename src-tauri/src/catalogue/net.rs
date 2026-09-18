//! One place where outbound catalogue requests are paced, retried and given up on.
//!
//! Each provider gets a lane: a minimum gap between requests, a timeout, its own user agent and a
//! circuit breaker. A provider that starts failing is left alone for a while rather than hammered,
//! and everything it does is counted so the developer panel can show the truth.
use super::{ProviderError, ProviderResult};
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const APP_CONTACT: &str = "https://github.com/feedback-player";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Health {
    Healthy,
    Degraded,
    RateLimited,
    Offline,
    Disabled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub provider: &'static str,
    pub state: Health,
    pub requests: u64,
    pub errors: u64,
    pub last_error: Option<String>,
    pub last_success_ms_ago: Option<u64>,
    pub average_latency_ms: u64,
    /// Seconds until the lane opens again, when it is closed.
    pub waiting_for: Option<u64>,
}

struct Inner {
    last_call: Option<Instant>,
    last_success: Option<Instant>,
    /// Nothing is sent before this instant: a Retry-After, or a breaker cooling off.
    hold_until: Option<Instant>,
    consecutive_failures: u32,
    state: Health,
    last_error: Option<String>,
    latency_ms: u64,
}

pub struct Lane {
    id: &'static str,
    user_agent: String,
    min_interval: Duration,
    timeout: Duration,
    inner: Mutex<Inner>,
    requests: AtomicU64,
    errors: AtomicU64,
    enabled: std::sync::atomic::AtomicBool,
}

impl Lane {
    pub fn new(id: &'static str, user_agent: impl Into<String>, min_interval: Duration, timeout: Duration) -> Self {
        Self {
            id,
            user_agent: user_agent.into(),
            min_interval,
            timeout,
            inner: Mutex::new(Inner { last_call: None, last_success: None, hold_until: None, consecutive_failures: 0, state: Health::Healthy, last_error: None, latency_ms: 0 }),
            requests: AtomicU64::new(0),
            errors: AtomicU64::new(0),
            enabled: std::sync::atomic::AtomicBool::new(true),
        }
    }

    pub fn id(&self) -> &'static str {
        self.id
    }

    pub fn set_enabled(&self, on: bool) {
        self.enabled.store(on, Ordering::Relaxed);
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.state = if on { Health::Healthy } else { Health::Disabled };
        if on {
            inner.hold_until = None;
            inner.consecutive_failures = 0;
        }
    }

    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    pub fn status(&self) -> Status {
        let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        Status {
            provider: self.id,
            state: inner.state,
            requests: self.requests.load(Ordering::Relaxed),
            errors: self.errors.load(Ordering::Relaxed),
            last_error: inner.last_error.clone(),
            last_success_ms_ago: inner.last_success.map(|t| t.elapsed().as_millis() as u64),
            average_latency_ms: inner.latency_ms,
            waiting_for: inner.hold_until.and_then(|t| t.checked_duration_since(Instant::now())).map(|d| d.as_secs() + 1),
        }
    }

    /// Wait out the gap this provider asks for, or refuse early if the lane is closed.
    fn take_turn(&self) -> ProviderResult<()> {
        if !self.enabled() {
            return Err(ProviderError::Disabled);
        }
        let sleep_for = {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(until) = inner.hold_until {
                let left = until.checked_duration_since(Instant::now());
                match left {
                    // Still cooling off: fail fast instead of queueing behind a wall.
                    Some(left) if left > Duration::from_millis(1500) => {
                        return Err(if inner.state == Health::RateLimited { ProviderError::RateLimited { retry_after: left } } else { ProviderError::Unavailable("This catalogue service is taking a break. FEEDBACK will try again shortly.".into()) })
                    }
                    Some(left) => left,
                    None => {
                        inner.hold_until = None;
                        Duration::ZERO
                    }
                }
            } else {
                inner.last_call.map(|t| self.min_interval.saturating_sub(t.elapsed())).unwrap_or(Duration::ZERO)
            }
        };
        if !sleep_for.is_zero() {
            std::thread::sleep(sleep_for);
        }
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).last_call = Some(Instant::now());
        Ok(())
    }

    fn succeeded(&self, latency: Duration) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.consecutive_failures = 0;
        inner.hold_until = None;
        inner.last_success = Some(Instant::now());
        inner.state = Health::Healthy;
        // Exponential moving average: recent requests matter more than the first one ever made.
        inner.latency_ms = if inner.latency_ms == 0 { latency.as_millis() as u64 } else { (inner.latency_ms * 3 + latency.as_millis() as u64) / 4 };
    }

    fn failed(&self, error: &ProviderError) {
        if matches!(error, ProviderError::NotFound | ProviderError::Disabled) {
            // A release with no sleeve on file is a normal answer; it says nothing about health.
            return;
        }
        self.errors.fetch_add(1, Ordering::Relaxed);
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.last_error = Some(error.to_string());
        match error {
            ProviderError::RateLimited { retry_after } => {
                inner.state = Health::RateLimited;
                inner.hold_until = Some(Instant::now() + *retry_after);
            }
            ProviderError::Offline | ProviderError::Unavailable(_) => {
                inner.consecutive_failures += 1;
                inner.state = if matches!(error, ProviderError::Offline) { Health::Offline } else { Health::Degraded };
                if inner.consecutive_failures >= 3 {
                    // Back off 30s, then a minute, then two, capped — with a little jitter so
                    // several providers don't all wake up together.
                    let steps = (inner.consecutive_failures - 3).min(3);
                    let base = Duration::from_secs(30 << steps);
                    let jitter = Duration::from_millis(u64::from(std::process::id() % 997) * 3);
                    inner.hold_until = Some(Instant::now() + base + jitter);
                }
            }
            _ => {}
        }
    }

    /// GET some JSON, paced and accounted for.
    pub fn get_json(&self, url: &str) -> ProviderResult<serde_json::Value> {
        let body = self.get_text(url, "application/json")?;
        serde_json::from_str(&body).map_err(|e| ProviderError::Malformed(e.to_string()))
    }

    pub fn get_text(&self, url: &str, accept: &str) -> ProviderResult<String> {
        self.take_turn()?;
        self.requests.fetch_add(1, Ordering::Relaxed);
        let started = Instant::now();
        let response = ureq::get(url).set("User-Agent", &self.user_agent).set("Accept", accept).timeout(self.timeout).call();
        match response {
            Ok(r) => match r.into_string() {
                Ok(body) => {
                    self.succeeded(started.elapsed());
                    Ok(body)
                }
                Err(e) => {
                    let err = ProviderError::Malformed(e.to_string());
                    self.failed(&err);
                    Err(err)
                }
            },
            Err(e) => {
                let err = classify(&e);
                self.failed(&err);
                Err(err)
            }
        }
    }

    /// GET bytes (artwork). Same pacing, no JSON parsing.
    pub fn get_bytes(&self, url: &str, max: usize) -> ProviderResult<Vec<u8>> {
        self.take_turn()?;
        self.requests.fetch_add(1, Ordering::Relaxed);
        let started = Instant::now();
        match ureq::get(url).set("User-Agent", &self.user_agent).timeout(self.timeout).call() {
            Ok(r) => {
                use std::io::Read;
                let mut bytes = Vec::new();
                if let Err(e) = r.into_reader().take(max as u64 + 1).read_to_end(&mut bytes) {
                    let err = ProviderError::Unavailable(e.to_string());
                    self.failed(&err);
                    return Err(err);
                }
                if bytes.len() > max {
                    return Err(ProviderError::Malformed("that image is unusually large".into()));
                }
                if bytes.is_empty() {
                    return Err(ProviderError::NotFound);
                }
                self.succeeded(started.elapsed());
                Ok(bytes)
            }
            Err(e) => {
                let err = classify(&e);
                self.failed(&err);
                Err(err)
            }
        }
    }
}

/// Turn a transport error into something the scheduler can act on, honouring Retry-After.
fn classify(error: &ureq::Error) -> ProviderError {
    match error {
        ureq::Error::Status(429, r) | ureq::Error::Status(503, r) => {
            let retry_after = r.header("retry-after").and_then(|v| v.trim().parse::<u64>().ok()).unwrap_or(5).clamp(1, 300);
            ProviderError::RateLimited { retry_after: Duration::from_secs(retry_after) }
        }
        ureq::Error::Status(404, _) => ProviderError::NotFound,
        ureq::Error::Status(code, _) => ProviderError::Unavailable(format!("The catalogue service answered with {code}.")),
        ureq::Error::Transport(_) => ProviderError::Offline,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_lane_paces_itself() {
        let lane = Lane::new("test", "FEEDBACK/test", Duration::from_millis(250), Duration::from_secs(1));
        lane.take_turn().unwrap();
        let started = Instant::now();
        lane.take_turn().unwrap();
        assert!(started.elapsed() >= Duration::from_millis(200), "the second turn must wait for the gap");
    }

    #[test]
    fn rate_limits_close_the_lane_until_the_service_says_otherwise() {
        let lane = Lane::new("test", "FEEDBACK/test", Duration::ZERO, Duration::from_secs(1));
        lane.failed(&ProviderError::RateLimited { retry_after: Duration::from_secs(30) });
        assert_eq!(lane.status().state, Health::RateLimited);
        assert!(matches!(lane.take_turn(), Err(ProviderError::RateLimited { .. })), "no request may go out while the service is holding us off");
        assert!(lane.status().waiting_for.is_some_and(|s| s > 25));
    }

    #[test]
    fn repeated_failures_open_the_breaker_and_success_closes_it() {
        let lane = Lane::new("test", "FEEDBACK/test", Duration::ZERO, Duration::from_secs(1));
        for _ in 0..3 {
            lane.failed(&ProviderError::Unavailable("boom".into()));
        }
        assert_eq!(lane.status().state, Health::Degraded);
        assert!(lane.take_turn().is_err(), "a failing provider is left alone rather than hammered");
        lane.succeeded(Duration::from_millis(120));
        assert_eq!(lane.status().state, Health::Healthy);
        assert!(lane.take_turn().is_ok());
        assert_eq!(lane.status().average_latency_ms, 120);
    }

    #[test]
    fn disabled_lanes_refuse_before_any_socket_is_opened() {
        let lane = Lane::new("test", "FEEDBACK/test", Duration::ZERO, Duration::from_secs(1));
        lane.set_enabled(false);
        assert_eq!(lane.take_turn(), Err(ProviderError::Disabled));
        assert_eq!(lane.status().state, Health::Disabled);
    }
}
