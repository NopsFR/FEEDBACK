//! axum app for the LAN server. HTTPS on `port` (PWA + API + media), plain HTTP on `port + 1` for first-time setup only
//! (CA download + instructions), since the phone can't reach HTTPS until it trusts the CA.
use super::{certs, check_token, random_code};
use crate::library::{mutate, query};
use crate::state::AppState;
use axum::body::Body;
use axum::extract::{Path as AxPath, Query, State as AxState};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[derive(Clone)]
struct Ctx {
    app: AppHandle,
    pwa_dir: Option<PathBuf>,
    pairing: Arc<parking_lot::Mutex<Option<(String, std::time::Instant)>>>,
}

pub struct Running {
    #[allow(dead_code)] // kept for diagnostics and future settings UI
    pub port: u16,
    pub urls: Vec<String>,
    pub setup_url: String,
    handle: axum_server::Handle,
    setup_handle: axum_server::Handle,
    pub pairing: Arc<parking_lot::Mutex<Option<(String, std::time::Instant)>>>,
}

impl Running {
    pub fn stop(&self) {
        self.handle.graceful_shutdown(Some(std::time::Duration::from_secs(2)));
        self.setup_handle.graceful_shutdown(Some(std::time::Duration::from_secs(1)));
    }
    pub fn new_code(&self) -> String {
        let code = random_code();
        *self.pairing.lock() = Some((code.clone(), std::time::Instant::now()));
        code
    }
}

fn lan_ips() -> Vec<IpAddr> {
    let mut out: Vec<IpAddr> = local_ip_address::list_afinet_netifas()
        .map(|l| l.into_iter().map(|(_, ip)| ip).filter(|ip| matches!(ip, IpAddr::V4(v4) if v4.is_private())).collect())
        .unwrap_or_default();
    out.sort();
    out.dedup();
    out
}

pub async fn start(app: AppHandle, port: u16, pwa_dir: Option<PathBuf>) -> Result<Running, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?.join("lan");
    let ips = lan_ips();
    let mut hosts = vec!["localhost".to_string()];
    if let Ok(h) = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")) {
        hosts.push(format!("{}.local", h.to_lowercase()));
    }
    let mut cert_ips = ips.clone();
    cert_ips.push(IpAddr::from([127, 0, 0, 1]));
    let pem = certs::ensure(&data, &cert_ips, &hosts)?;
    let tls = axum_server::tls_rustls::RustlsConfig::from_pem(pem.leaf_cert.into_bytes(), pem.leaf_key.into_bytes()).await.map_err(|e| e.to_string())?;
    let pairing = Arc::new(parking_lot::Mutex::new(None));
    let ctx = Ctx { app: app.clone(), pwa_dir, pairing: pairing.clone() };

    let api = Router::new()
        .route("/api/hello", get(hello))
        .route("/api/pair", post(pair))
        .route("/api/overview", get(overview))
        .route("/api/home", get(home))
        .route("/api/tracks", get(tracks))
        .route("/api/tracks/by-ids", post(tracks_by_ids))
        .route("/api/albums", get(albums))
        .route("/api/albums/by", get(albums_by))
        .route("/api/artists", get(artists))
        .route("/api/genres", get(genres))
        .route("/api/album/{id}", get(album))
        .route("/api/artist/{id}", get(artist))
        .route("/api/search", get(search))
        .route("/api/smart/{which}", get(smart))
        .route("/api/radio/{id}", get(radio))
        .route("/api/playlists", get(playlists))
        .route("/api/playlist/{id}", get(playlist))
        .route("/api/lyrics/{id}", get(lyrics))
        .route("/api/favourite/{id}", post(favourite))
        .route("/api/play/{id}", post(record_play))
        .route("/api/edits", post(phone_edit))
        .route("/media/track/{id}", get(media_track))
        .route("/media/art/{hash}/{size}", get(media_art))
        .fallback(get(static_file))
        .with_state(ctx.clone());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let handle = axum_server::Handle::new();
    let h2 = handle.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = axum_server::bind_rustls(addr, tls).handle(h2).serve(api.into_make_service()).await {
            log::error!(target: "SYNC", "https server stopped: {e}");
        }
    });

    let ca = pem.ca_cert.clone();
    let https_port = port;
    let setup = Router::new()
        .route("/feedback-ca.crt", get(move || {
            let ca = ca.clone();
            async move { ([(header::CONTENT_TYPE, "application/x-x509-ca-cert"), (header::CONTENT_DISPOSITION, "attachment; filename=\"feedback-ca.crt\"")], ca) }
        }))
        .fallback(get(move |headers: HeaderMap| async move { Html(setup_page(&headers, https_port)) }));
    let setup_addr = SocketAddr::from(([0, 0, 0, 0], port + 1));
    let setup_handle = axum_server::Handle::new();
    let sh2 = setup_handle.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = axum_server::bind(setup_addr).handle(sh2).serve(setup.into_make_service()).await {
            log::error!(target: "SYNC", "setup server stopped: {e}");
        }
    });

    let urls = ips.iter().map(|ip| format!("https://{ip}:{port}")).collect::<Vec<_>>();
    let setup_url = ips.first().map(|ip| format!("http://{ip}:{}", port + 1)).unwrap_or_default();
    log::info!(target: "SYNC", "LAN server on {:?} (setup {setup_url})", urls);
    Ok(Running { port, urls, setup_url, handle, setup_handle, pairing })
}

fn setup_page(headers: &HeaderMap, port: u16) -> String {
    let host = headers.get(header::HOST).and_then(|h| h.to_str().ok()).unwrap_or("").split(':').next().unwrap_or("").to_string();
    format!(r#"<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>FEEDBACK — set up this phone</title>
<style>body{{margin:0;background:#0b0b0b;color:#e6e1d6;font:16px/1.5 system-ui;padding:28px 22px}}h1{{font:900 30px/1 system-ui;letter-spacing:-.02em;text-transform:uppercase;margin:0 0 20px}}
ol{{padding-left:20px}}li{{margin:0 0 14px}}a.b{{display:inline-block;background:#e6e1d6;color:#0b0b0b;padding:12px 16px;font-weight:700;text-decoration:none;letter-spacing:.08em;text-transform:uppercase;font-size:13px}}
code{{background:#1d1d1d;padding:2px 6px}}small{{color:#a9a49a}}</style>
<h1>Set up FEEDBACK<br>on this phone</h1>
<p>FEEDBACK talks to your computer over your own Wi-Fi with an encrypted connection. Your phone needs to trust this computer once.</p>
<ol>
<li><a class=b href="/feedback-ca.crt">Download certificate</a><br><small>iPhone: tap “Allow”. The profile is only for this computer's FEEDBACK server.</small></li>
<li>iPhone: <b>Settings → General → VPN &amp; Device Management</b> → install “FEEDBACK Local Library CA”.</li>
<li>Then <b>Settings → General → About → Certificate Trust Settings</b> → turn on full trust for it.</li>
<li>Open <a style="color:#ff2a3a" href="https://{host}:{port}">https://{host}:{port}</a> in Safari, tap Share → <b>Add to Home Screen</b>.</li>
<li>Enter the pairing code shown in FEEDBACK on the computer (Settings → Devices).</li>
</ol>
<small>You can remove the profile at any time. Revoke this phone from the computer and it loses access immediately.</small>"#)
}

// ---------- auth ----------
fn bearer(headers: &HeaderMap, q: &TokenQuery) -> Option<String> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::to_string)
        .or_else(|| q.t.clone())
}

#[derive(Deserialize, Default)]
struct TokenQuery {
    t: Option<String>,
    download: Option<u8>,
}

fn authorised(ctx: &Ctx, headers: &HeaderMap, q: &TokenQuery) -> Result<(), Response> {
    let Some(tok) = bearer(headers, q) else { return Err(StatusCode::UNAUTHORIZED.into_response()) };
    let state = ctx.app.state::<AppState>();
    match state.db.with(|c| check_token(c, &tok)) {
        Ok(Some(_)) => Ok(()),
        _ => Err(StatusCode::UNAUTHORIZED.into_response()),
    }
}

fn json<T: Serialize>(r: rusqlite::Result<T>) -> Response {
    match r {
        Ok(v) => Json(v).into_response(),
        Err(e) => {
            log::error!(target: "SYNC", "{e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

macro_rules! guarded {
    ($ctx:ident, $headers:ident, $q:ident) => {
        if let Err(r) = authorised(&$ctx, &$headers, &$q) {
            return r;
        }
    };
}

async fn hello() -> impl IntoResponse {
    Json(serde_json::json!({ "app": "FEEDBACK", "version": env!("CARGO_PKG_VERSION") }))
}

async fn radio(AxState(ctx): AxState<Ctx>, headers: HeaderMap, Query(q): Query<TokenQuery>, AxPath(id): AxPath<i64>) -> Response {
    guarded!(ctx, headers, q);
    json(ctx.app.state::<AppState>().db.with(|c| query::radio(c, id, 50)))
}

async fn phone_edit(AxState(ctx): AxState<Ctx>, headers: HeaderMap, Query(q): Query<TokenQuery>, Json(edit): Json<super::edits::Edit>) -> Response {
    let Some(token) = bearer(&headers, &q) else { return StatusCode::UNAUTHORIZED.into_response() };
    let state = ctx.app.state::<AppState>();
    let Ok(Some(device)) = state.db.with(|c| check_token(c, &token)) else { return StatusCode::UNAUTHORIZED.into_response() };
    let result = state.db.with_mut(|c| Ok(super::edits::apply(c, device, edit)));
    match result {
        Ok(Ok(result)) => {
            use tauri::Emitter;
            let _ = ctx.app.emit("library-changed", ());
            Json(result).into_response()
        }
        Ok(Err(message)) => (StatusCode::CONFLICT, Json(serde_json::json!({"message": message}))).into_response(),
        Err(e) => json::<()>(Err(e)),
    }
}

#[derive(Deserialize)]
struct PairBody {
    code: String,
    name: String,
}

async fn pair(AxState(ctx): AxState<Ctx>, Json(body): Json<PairBody>) -> Response {
    let ok = {
        let mut p = ctx.pairing.lock();
        match p.as_ref() {
            Some((code, at)) if at.elapsed().as_secs() < 300 && *code == body.code.trim() => {
                *p = None; // single use
                true
            }
            _ => false,
        }
    };
    if !ok {
        tokio::time::sleep(std::time::Duration::from_millis(700)).await; // slow down guessing
        return (StatusCode::FORBIDDEN, "That code didn't match. Generate a new one on the computer.").into_response();
    }
    let state = ctx.app.state::<AppState>();
    match state.db.with(|c| super::add_device(c, &body.name)) {
        Ok(token) => {
            use tauri::Emitter;
            let _ = ctx.app.emit("devices-changed", ());
            Json(serde_json::json!({ "token": token })).into_response()
        }
        Err(e) => json::<()>(Err(e)),
    }
}

async fn overview(AxState(ctx): AxState<Ctx>, headers: HeaderMap, Query(q): Query<TokenQuery>) -> Response {
    guarded!(ctx, headers, q);
    json(ctx.app.state::<AppState>().db.with(query::overview))
}
async fn home(AxState(ctx): AxState<Ctx>, headers: HeaderMap, Query(q): Query<TokenQuery>) -> Response {
    guarded!(ctx, headers, q);
    json(ctx.app.state::<AppState>().db.with(query::home))
}
#[derive(Deserialize)]
struct KindQuery {
    kind: Option<String>,
}
async fn tracks(AxState(ctx): AxState<Ctx>, headers: HeaderMap, Query(q): Query<TokenQuery>, Query(k): Query<KindQuery>) -> Response {
    guarded!(ctx, headers, q);
    let kind = k.kind.unwrap_or_else(|| "audio".into());
    json(ctx.app.state::<AppState>().db.with(|c| query::all_tracks(c, &kind)))
}
async fn tracks_by_ids(AxState(ctx): AxState<Ctx>, headers: HeaderMap, Query(q): Query<TokenQuery>, Json(ids): Json<Vec<i64>>) -> Response {
    guarded!(ctx, headers, q);
    json(ctx.app.state::<AppState>().db.with(|c| query::tracks_by_ids(c, &ids)))
}
async fn albums(AxState(ctx): AxState<Ctx>, headers: HeaderMap, Query(q): Query<TokenQuery>) -> Response {
    guarded!(ctx, headers, q);
    json(ctx.app.state::<AppState>().db.with(query::all_albums))
}
#[derive(Deserialize)]
struct ByQuery {
    genre: Option<String>,
    year: Option<i64>,
}
async fn albums_by(AxState(ctx): AxState<Ctx>, headers: HeaderMap, Query(q): Query<TokenQuery>, Query(b): Query<ByQuery>) -> Response {
    guarded!(ctx, headers, q);
    json(ctx.app.state::<AppState>().db.with(|c| match (b.genre.as_deref(), b.year) {
        (Some(g), _) => query::albums_for_genre(c, g),
        (None, Some(y)) => query::albums_for_year(c, y),
        _ => query::all_albums(c),
    }))
}
async fn artists(AxState(ctx): AxState<Ctx>, headers: HeaderMap, Query(q): Query<TokenQuery>) -> Response {
    guarded!(ctx, headers, q);
    json(ctx.app.state::<AppState>().db.with(query::all_artists))
}
async fn genres(AxState(ctx): AxState<Ctx>, headers: HeaderMap, Query(q): Query<TokenQuery>) -> Response {
    guarded!(ctx, headers, q);
    json(ctx.app.state::<AppState>().db.with(query::genres))
}
async fn album(AxState(ctx): AxState<Ctx>, headers: HeaderMap, Query(q): Query<TokenQuery>, AxPath(id): AxPath<i64>) -> Response {
    guarded!(ctx, headers, q);
    match ctx.app.state::<AppState>().db.with(|c| query::album(c, id)) {
        Ok(Some(d)) => Json(d).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => json::<()>(Err(e)),
    }
}
async fn artist(AxState(ctx): AxState<Ctx>, headers: HeaderMap, Query(q): Query<TokenQuery>, AxPath(id): AxPath<i64>) -> Response {
    guarded!(ctx, headers, q);
    match ctx.app.state::<AppState>().db.with(|c| query::artist(c, id)) {
        Ok(Some(d)) => Json(d).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => json::<()>(Err(e)),
    }
}
#[derive(Deserialize)]
struct SearchQuery {
    q: String,
}
async fn search(AxState(ctx): AxState<Ctx>, headers: HeaderMap, Query(t): Query<TokenQuery>, Query(s): Query<SearchQuery>) -> Response {
    guarded!(ctx, headers, t);
    json(ctx.app.state::<AppState>().db.with(|c| query::search(c, &s.q)))
}
async fn smart(AxState(ctx): AxState<Ctx>, headers: HeaderMap, Query(q): Query<TokenQuery>, AxPath(which): AxPath<String>) -> Response {
    guarded!(ctx, headers, q);
    json(ctx.app.state::<AppState>().db.with(|c| match which.as_str() {
        "favourites" => query::favourites(c),
        "history" => query::history(c, 300),
        "most-played" => query::most_played(c, 300),
        "recently-added" => query::recently_added_tracks(c, 300),
        "missing" => query::missing_tracks(c, 300),
        _ => Ok(vec![]),
    }))
}
async fn playlists(AxState(ctx): AxState<Ctx>, headers: HeaderMap, Query(q): Query<TokenQuery>) -> Response {
    guarded!(ctx, headers, q);
    json(ctx.app.state::<AppState>().db.with(query::playlists))
}
async fn playlist(AxState(ctx): AxState<Ctx>, headers: HeaderMap, Query(q): Query<TokenQuery>, AxPath(id): AxPath<i64>) -> Response {
    guarded!(ctx, headers, q);
    match ctx.app.state::<AppState>().db.with(|c| query::playlist(c, id)) {
        Ok(Some(d)) => Json(d).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => json::<()>(Err(e)),
    }
}
async fn lyrics(AxState(ctx): AxState<Ctx>, headers: HeaderMap, Query(q): Query<TokenQuery>, AxPath(id): AxPath<i64>) -> Response {
    guarded!(ctx, headers, q);
    let path = ctx.app.state::<AppState>().db.with(|c| mutate::track_path(c, id));
    match path {
        Ok(Some(p)) => Json(crate::metadata::lyrics::find(std::path::Path::new(&p))).into_response(),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}
#[derive(Deserialize)]
struct FavBody {
    on: bool,
}
async fn favourite(AxState(ctx): AxState<Ctx>, headers: HeaderMap, Query(q): Query<TokenQuery>, AxPath(id): AxPath<i64>, Json(b): Json<FavBody>) -> Response {
    guarded!(ctx, headers, q);
    json(ctx.app.state::<AppState>().db.with(|c| mutate::toggle_favourite(c, id, b.on)))
}
#[derive(Deserialize)]
struct PlayBody {
    ms: i64,
    skipped: bool,
}
async fn record_play(AxState(ctx): AxState<Ctx>, headers: HeaderMap, Query(q): Query<TokenQuery>, AxPath(id): AxPath<i64>, Json(b): Json<PlayBody>) -> Response {
    guarded!(ctx, headers, q);
    json(ctx.app.state::<AppState>().db.with(|c| mutate::record_play(c, id, b.ms, b.skipped)))
}

/// Reuse the desktop protocol handler so Range + transcoding behave identically.
fn to_axum(resp: tauri::http::Response<Vec<u8>>) -> Response {
    let (parts, body) = resp.into_parts();
    let mut r = Response::new(Body::from(body));
    *r.status_mut() = StatusCode::from_u16(parts.status.as_u16()).unwrap_or(StatusCode::OK);
    for (k, v) in parts.headers.iter() {
        if let (Ok(name), Ok(val)) = (header::HeaderName::from_bytes(k.as_str().as_bytes()), header::HeaderValue::from_bytes(v.as_bytes())) {
            r.headers_mut().insert(name, val);
        }
    }
    r
}

fn proto_request(path: &str, headers: &HeaderMap) -> tauri::http::Request<Vec<u8>> {
    let mut b = tauri::http::Request::builder().uri(format!("fbmedia://localhost{path}"));
    if let Some(r) = headers.get(header::RANGE).and_then(|v| v.to_str().ok()) {
        b = b.header("range", r);
    }
    b.body(Vec::new()).unwrap()
}

async fn media_track(AxState(ctx): AxState<Ctx>, headers: HeaderMap, Query(q): Query<TokenQuery>, AxPath(id): AxPath<i64>) -> Response {
    guarded!(ctx, headers, q);
    if q.download == Some(1) {
        // Whole original file for saving on the phone (iOS decodes ALAC natively, so no transcode here).
        let path = ctx.app.state::<AppState>().db.with(|c| mutate::track_path(c, id));
        let Ok(Some(path)) = path else { return StatusCode::NOT_FOUND.into_response() };
        return match tokio::fs::read(&path).await {
            Ok(bytes) => ([(header::CONTENT_TYPE, "application/octet-stream")], bytes).into_response(),
            Err(_) => StatusCode::NOT_FOUND.into_response(),
        };
    }
    let app = ctx.app.clone();
    let req = proto_request(&format!("/track/{id}"), &headers);
    let resp = tokio::task::spawn_blocking(move || crate::media::handle(&app, &req)).await;
    match resp {
        Ok(r) => to_axum(r),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn media_art(AxState(ctx): AxState<Ctx>, headers: HeaderMap, Query(q): Query<TokenQuery>, AxPath((hash, size)): AxPath<(String, String)>) -> Response {
    guarded!(ctx, headers, q);
    let app = ctx.app.clone();
    let req = proto_request(&format!("/art/{hash}/{size}"), &headers);
    match tokio::task::spawn_blocking(move || crate::media::handle(&app, &req)).await {
        Ok(r) => to_axum(r),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// Serve the built PWA. Unknown paths fall back to index.html (single-page app). No directory traversal.
async fn static_file(AxState(ctx): AxState<Ctx>, uri: axum::http::Uri) -> Response {
    let Some(dir) = ctx.pwa_dir.as_ref() else {
        return (StatusCode::NOT_FOUND, "The phone app isn't bundled in this build.").into_response();
    };
    let rel = uri.path().trim_start_matches('/');
    let safe = !rel.split('/').any(|seg| seg == ".." || seg.contains('\\') || seg.contains(':'));
    let mut path = if safe && !rel.is_empty() { dir.join(rel) } else { dir.join("index.html") };
    if !path.is_file() {
        path = dir.join("index.html");
    }
    match tokio::fs::read(&path).await {
        Ok(bytes) => {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            let mime = match ext {
                "html" => "text/html; charset=utf-8",
                "js" => "text/javascript",
                "css" => "text/css",
                "json" | "webmanifest" => "application/manifest+json",
                "svg" => "image/svg+xml",
                "png" => "image/png",
                "woff2" => "font/woff2",
                "woff" => "font/woff",
                "jpg" => "image/jpeg",
                _ => "application/octet-stream",
            };
            let cache = if ext == "html" || rel == "sw.js" { "no-cache" } else { "public, max-age=31536000, immutable" };
            ([(header::CONTENT_TYPE, mime), (header::CACHE_CONTROL, cache)], bytes).into_response()
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}
