//! The gateway: every request that is not the UI or its control API passes
//! through here on its way to the engine.
//!
//! Jobs, in order: keep everything but the model API on this computer; pause
//! gate; check the client key (the engine only knows CarteLink's internal key);
//! scoped-key limits; model mapping, blacklist, system prompt and reasoning
//! settings in the request body; an honest /v1/models; streaming the answer
//! back untouched while noting errors, statistics and live events.

use std::collections::VecDeque;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::{ConnectInfo, Request};
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Uri, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use http_body_util::BodyExt;
use hyper::body::{Frame, Incoming, SizeHint};
use hyper_util::client::legacy::Client;
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::rt::{TokioExecutor, TokioIo};
use serde::Serialize;
use serde_json::{Map, Value, json};

use crate::app::{App, LiveEvent, app};
use crate::config::Config;
use crate::errlog::ErrorEntry;
use crate::prompting::{api_family, apply_prompting, apply_thinking, normalize_effort};
use crate::routing::{
    CatalogModel, app_rule_model, claude_picker_entries, fallback_chain, friendly_model_name, is_blacklisted, is_fallback_status, resolve_model,
    served_aliases,
};
use crate::scoped::{self, Ident, KeyError};
use crate::server::Conn;
use crate::util::{base_model_name, error_message_from_body, now_ms, truncate_chars, uncloak};

const MAX_REWRITE: usize = 32 << 20;
const CAPTURE: usize = 8192;
/// What the request inspector keeps of each body.
const INSPECT_CAP: usize = 64 << 10;
/// An error answer read whole to decide on a fallback model.
const FALLBACK_READ: usize = 1 << 20;

fn client() -> &'static Client<HttpConnector, Body> {
    static C: OnceLock<Client<HttpConnector, Body>> = OnceLock::new();
    C.get_or_init(|| {
        let mut http = HttpConnector::new();
        http.set_nodelay(true);
        http.set_connect_timeout(Some(Duration::from_secs(5)));
        Client::builder(TokioExecutor::new()).pool_idle_timeout(Duration::from_secs(60)).build(http)
    })
}

fn json_resp(status: StatusCode, v: Value) -> Response {
    (status, [(header::CONTENT_TYPE, "application/json")], v.to_string()).into_response()
}

// ---------------------------------------------------------------- gates ----

/// The surface other devices can reach: routes that check the key themselves.
/// An allowlist, so a new engine route (OAuth callbacks, plugins…) stays closed.
pub fn network_allowed_path(p: &str) -> bool {
    p == "/healthz" || p == "/models" || ["/v1/", "/v1beta/", "/openai/v1/", "/backend-api/codex/"].iter().any(|x| p.starts_with(x))
}

/// Middleware ahead of everything: other devices get the model API only.
pub async fn local_gate(ConnectInfo(conn): ConnectInfo<Conn>, req: Request, next: Next) -> Response {
    if !conn.is_local() && !network_allowed_path(req.uri().path()) {
        return json_resp(
            StatusCode::FORBIDDEN,
            json!({"error": {"type": "local_only", "message": "CarteLink: this address works only on the computer running the app; other devices can use the model API (/v1) with a key."}}),
        );
    }
    next.run(req).await
}

/// A host name an attacker's page cannot run on (DNS rebinding): an IP,
/// localhost, or the host CarteLink is configured on.
pub fn trusted_host(host: &str, bound: &[&str]) -> bool {
    let h = match host.rsplit_once(':') {
        Some((h, port)) if port.chars().all(|c| c.is_ascii_digit()) && !h.ends_with(':') => h,
        _ => host,
    };
    let h = h.trim_matches(['[', ']']);
    h.eq_ignore_ascii_case("localhost")
        || h.parse::<std::net::IpAddr>().is_ok()
        || bound.iter().any(|b| !h.is_empty() && h.eq_ignore_ascii_case(b.trim()))
}

/// The control API has no auth of its own: only same-origin browser requests
/// (the app window, a tab on the UI) and non-browser local processes pass.
pub fn same_origin(headers: &HeaderMap, bound: &[&str]) -> bool {
    let host = headers.get(header::HOST).and_then(|v| v.to_str().ok()).unwrap_or("");
    if !trusted_host(host, bound) {
        return false;
    }
    let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()).unwrap_or("");
    let site = headers.get("sec-fetch-site").and_then(|v| v.to_str().ok()).unwrap_or("");
    if origin.is_empty() && matches!(site, "" | "none" | "same-origin") {
        return true;
    }
    if site == "cross-site" || site == "same-site" {
        return false;
    }
    if !origin.is_empty() {
        let Ok(u) = url::Url::parse(origin) else { return false };
        let o_host = match (u.host_str(), u.port()) {
            (Some(h), Some(p)) => format!("{h}:{p}"),
            (Some(h), None) => h.to_string(),
            _ => return false,
        };
        return o_host.eq_ignore_ascii_case(host);
    }
    true
}

/// The management secret as the engine reads it (X-Management-Key or a bearer
/// token), compared in constant time.
fn management_key_ok(h: &HeaderMap, secret: &str) -> bool {
    if secret.is_empty() {
        return false;
    }
    let mut given = h.get("x-management-key").and_then(|v| v.to_str().ok()).unwrap_or("").trim().to_string();
    if given.is_empty() {
        given = h.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")).unwrap_or("").trim().to_string();
    }
    let (a, b) = (given.as_bytes(), secret.as_bytes());
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn bound_hosts(a: &App) -> Vec<String> {
    vec![a.bound().0, a.config().cliproxy.host.clone()]
}

// -------------------------------------------------------------- handler ----

fn is_model_api(p: &str) -> bool {
    p.starts_with("/v1") || p == "/models" || p.starts_with("/openai/") || p.starts_with("/backend-api/")
}

fn anthropic_style(path: &str) -> bool {
    path.starts_with("/v1/messages")
}

fn key_error(path: &str, status: StatusCode, code: &str, msg: &str) -> Response {
    let typ = match status {
        StatusCode::UNAUTHORIZED => "authentication_error",
        StatusCode::BAD_REQUEST | StatusCode::PAYLOAD_TOO_LARGE => "invalid_request_error",
        StatusCode::TOO_MANY_REQUESTS => "rate_limit_error",
        _ => "permission_error",
    };
    if anthropic_style(path) {
        json_resp(status, json!({"type": "error", "error": {"type": typ, "message": msg}}))
    } else {
        json_resp(status, json!({"type": "error", "error": {"type": typ, "code": code, "message": msg}}))
    }
}

struct Ctx {
    method: Method,
    path: String,
    client: String,
    /// Friendly program name (`apps::app_name` of the User-Agent).
    app: String,
    ident: Option<Ident>,
    want: String,
    resolved: String,
    /// The model that failed first when a fallback model answered ("" = none).
    fallback_from: String,
    started: Instant,
    /// Set while the request inspector is on.
    inspect: Option<Inspect>,
}

impl Ctx {
    fn reject(&self, a: &App, status: StatusCode, code: &str, model: &str, msg: &str) -> Response {
        a.log_error(ErrorEntry {
            status: status.as_u16(),
            kind: "gateway".into(),
            method: self.method.to_string(),
            path: self.path.clone(),
            model: model.into(),
            client: self.client.clone(),
            key: self.ident.as_ref().map(Ident::label).unwrap_or_default(),
            message: format!("{code}: {msg}"),
            ..Default::default()
        });
        let resp = key_error(&self.path, status, code, msg);
        inspect_record(a, self, status.as_u16(), format!("{code}: {msg}").as_bytes(), false);
        resp
    }

    /// What the live feed and the error log show as the model that answered.
    fn resolved_shown(&self) -> String {
        if !self.fallback_from.is_empty() {
            format!("{} → {} (запасна)", self.fallback_from, self.resolved)
        } else if self.resolved == self.want {
            String::new()
        } else {
            self.resolved.clone()
        }
    }
}

// ------------------------------------------------------------ inspector ----

/// Request side of an inspector record, collected on the way in.
struct Inspect {
    headers: Vec<[String; 2]>,
    /// The body as sent to the engine (only when CarteLink read it).
    body: Option<Bytes>,
}

/// One model request as the inspector keeps it (memory only, never on disk).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectItem {
    pub id: u64,
    pub t: i64,
    pub method: String,
    pub path: String,
    pub app: String,
    pub client: String,
    pub key: String,
    pub model: String,
    pub resolved: String,
    pub fallback: bool,
    pub status: u16,
    pub ms: u64,
    pub request_headers: Vec<[String; 2]>,
    pub request_body: String,
    pub request_size: usize,
    pub request_truncated: bool,
    pub response_body: String,
    pub response_truncated: bool,
}

impl InspectItem {
    /// The list view: everything but headers and bodies.
    pub fn summary(&self) -> Value {
        json!({
            "id": self.id, "t": self.t, "method": self.method, "path": self.path, "app": self.app,
            "key": self.key, "model": self.model, "resolved": self.resolved, "fallback": self.fallback,
            "status": self.status, "ms": self.ms, "requestSize": self.request_size,
        })
    }
}

static INSPECTOR: Mutex<VecDeque<InspectItem>> = Mutex::new(VecDeque::new());
static INSPECT_SEQ: AtomicU64 = AtomicU64::new(1);

fn inspector() -> std::sync::MutexGuard<'static, VecDeque<InspectItem>> {
    INSPECTOR.lock().unwrap_or_else(|e| e.into_inner())
}

/// Headers as the inspector shows them: credentials are never kept.
pub fn redacted_headers(h: &HeaderMap) -> Vec<[String; 2]> {
    const SECRET: [&str; 6] = ["authorization", "proxy-authorization", "x-api-key", "x-goog-api-key", "x-management-key", "cookie"];
    h.iter()
        .map(|(k, v)| {
            let name = k.as_str().to_string();
            let value = if SECRET.contains(&name.as_str()) { "***".to_string() } else { String::from_utf8_lossy(v.as_bytes()).into_owned() };
            [name, value]
        })
        .collect()
}

/// At most `cap` bytes as text, and whether something was cut.
fn clip(b: &[u8], cap: usize) -> (String, bool) {
    let cut = b.len() > cap;
    (String::from_utf8_lossy(&b[..b.len().min(cap)]).into_owned(), cut)
}

fn inspect_record(a: &App, ctx: &Ctx, status: u16, response: &[u8], response_cut: bool) {
    let Some(ins) = &ctx.inspect else { return };
    let cfg = a.config();
    if !cfg.inspector.enabled {
        inspector().clear();
        return;
    }
    let (request_body, request_truncated) = ins.body.as_deref().map(|b| clip(b, INSPECT_CAP)).unwrap_or_default();
    let (response_body, cut) = clip(response, INSPECT_CAP);
    let item = InspectItem {
        id: INSPECT_SEQ.fetch_add(1, Ordering::Relaxed),
        t: now_ms(),
        method: ctx.method.to_string(),
        path: ctx.path.clone(),
        app: ctx.app.clone(),
        client: truncate_chars(&ctx.client, 200),
        key: ctx.ident.as_ref().map(Ident::label).unwrap_or_default(),
        model: ctx.want.clone(),
        resolved: ctx.resolved_shown(),
        fallback: !ctx.fallback_from.is_empty(),
        status,
        ms: ctx.started.elapsed().as_millis() as u64,
        request_headers: ins.headers.clone(),
        request_body,
        request_size: ins.body.as_ref().map_or(0, Bytes::len),
        request_truncated,
        response_body,
        response_truncated: cut || response_cut,
    };
    let keep = cfg.inspector.keep.max(1) as usize;
    let mut g = inspector();
    g.push_back(item);
    while g.len() > keep {
        g.pop_front();
    }
}

/// Inspector records, newest first (none, and the memory freed, while it is off).
pub fn inspector_items(cfg: &Config) -> Vec<Value> {
    let mut g = inspector();
    if !cfg.inspector.enabled {
        g.clear();
        return vec![];
    }
    g.iter().rev().map(InspectItem::summary).collect()
}

pub fn inspector_get(id: u64) -> Option<InspectItem> {
    inspector().iter().find(|i| i.id == id).cloned()
}

pub fn inspector_clear() {
    inspector().clear();
}

/// Fallback handler: everything the UI router does not serve.
pub async fn handle(req: Request) -> Response {
    let a = app();
    let path = req.uri().path().to_string();
    let cfg = a.config();

    if path == "/healthz" {
        return if a.engine.running() {
            json_resp(StatusCode::OK, json!({"status": "ok", "paused": a.paused()}))
        } else {
            json_resp(StatusCode::SERVICE_UNAVAILABLE, json!({"status": "starting"}))
        };
    }

    // The engine's Management API bans an IP for 30 min after 5 failed logins,
    // and every request reaches it from 127.0.0.1 — CarteLink's own calls
    // included. A request without the right secret must never get there (a web
    // page could otherwise lock CarteLink out of its engine). The UI itself
    // goes through /api/cliproxy/api.
    if path.starts_with("/v0/management") {
        if !management_key_ok(req.headers(), &cfg.cliproxy.management_secret) {
            return json_resp(StatusCode::UNAUTHORIZED, json!({"error": "invalid management key"}));
        }
        return forward(req, false, None).await;
    }
    // Plugin consoles have no auth of their own: same-origin pages only.
    if path.starts_with("/v0/resource/plugins/") {
        let hosts = bound_hosts(a);
        let hosts: Vec<&str> = hosts.iter().map(String::as_str).collect();
        let host = req.headers().get(header::HOST).and_then(|v| v.to_str().ok()).unwrap_or("");
        if !trusted_host(host, &hosts) {
            return json_resp(StatusCode::FORBIDDEN, json!({"ok": false, "error": "this host name is not allowed"}));
        }
        let has_origin = req.headers().contains_key(header::ORIGIN) || req.headers().contains_key("sec-fetch-site");
        if (req.method() != Method::GET || has_origin) && !same_origin(req.headers(), &hosts) {
            return json_resp(StatusCode::FORBIDDEN, json!({"ok": false, "error": "cross-origin access to plugin consoles is not allowed"}));
        }
        return forward(req, false, None).await;
    }
    if path.starts_with("/v0/") || path == "/management.html" || !is_model_api(&path) {
        return forward(req, false, None).await;
    }
    // CORS preflight carries no key: the engine answers it (as in 2.x).
    if req.method() == Method::OPTIONS {
        return forward(req, false, None).await;
    }

    let client = req.headers().get(header::USER_AGENT).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let mut ctx = Ctx {
        method: req.method().clone(),
        path: path.clone(),
        app: crate::apps::app_name(&client),
        client,
        ident: None,
        want: String::new(),
        resolved: String::new(),
        fallback_from: String::new(),
        started: Instant::now(),
        inspect: cfg.inspector.enabled.then(|| Inspect { headers: redacted_headers(req.headers()), body: None }),
    };

    if a.paused() {
        a.log_error(ErrorEntry {
            status: 503,
            kind: "gateway".into(),
            method: ctx.method.to_string(),
            path: path.clone(),
            client: ctx.client.clone(),
            message: "paused: CarteLink is stopped".into(),
            ..Default::default()
        });
        return json_resp(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"error": {"type": "paused", "message": "CarteLink is paused — press Start in the app."}}),
        );
    }
    if !a.engine.running() {
        return json_resp(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"error": {"type": "starting", "message": "CarteLink engine is starting — try again in a few seconds."}}),
        );
    }

    let ident = match scoped::identify(&cfg, &req) {
        Ok(i) => i,
        Err(e) => {
            let (status, code, msg) = match e {
                KeyError::Missing => {
                    (StatusCode::UNAUTHORIZED, "missing_api_key", "CarteLink: API key is missing — copy it from the app.".to_string())
                }
                KeyError::Wrong => {
                    (StatusCode::UNAUTHORIZED, "invalid_api_key", "CarteLink: wrong API key — copy the current one from the app.".to_string())
                }
                KeyError::Deleted => (StatusCode::UNAUTHORIZED, "invalid_api_key", "this CarteLink API key was deleted".to_string()),
                KeyError::Disabled(n) => (StatusCode::UNAUTHORIZED, "api_key_disabled", format!("CarteLink API key \"{n}\" is turned off")),
            };
            return ctx.reject(a, status, code, "", &msg);
        }
    };
    ctx.ident = Some(ident.clone());

    if let Some(sk) = ident.scoped() {
        if !scoped::scoped_allowed_path(&ctx.method, &path) {
            let msg = format!("API key \"{}\" cannot use {} {}", sk.name, ctx.method, path);
            return ctx.reject(a, StatusCode::FORBIDDEN, "endpoint_not_allowed", "", &msg);
        }
        if path.starts_with("/v1beta/models/") {
            let model = scoped::gemini_path_model(&path);
            if scoped::scoped_model_match(sk, &model).is_none() || is_blacklisted(&cfg, &model) {
                return scoped_refused(a, &ctx, sk, &model);
            }
        }
        if let Err(resp) = key_limits(a, &ctx, sk) {
            return resp;
        }
    }

    if ctx.method == Method::GET && (path == "/v1/models" || path == "/models") {
        return models_list(req, &ident, &cfg).await;
    }
    if let Some(sk) = ident.scoped()
        && ctx.method == Method::GET
        && path == "/v1beta/models"
    {
        return scoped_engine_list(req, sk.clone(), &cfg).await;
    }

    let mut req = req;
    if ctx.method == Method::POST
        && (matches!(path.as_str(), "/v1/messages" | "/v1/messages/count_tokens" | "/v1/chat/completions" | "/v1/completions" | "/v1/responses")
            || (ident.scoped().is_some() && scoped::body_model_path(&path)))
    {
        let (parts, body) = req.into_parts();
        match read_limited(body, MAX_REWRITE).await {
            Ok(bytes) => {
                return match rewrite_body(a, &cfg, &mut ctx, &bytes, None) {
                    Ok(Some(b)) => forward_model(parts, bytes, b, ctx, &cfg).await,
                    Ok(None) => forward_model(parts, bytes.clone(), bytes, ctx, &cfg).await,
                    Err(resp) => resp,
                };
            }
            Err(ReadErr::TooLarge(body)) => {
                if ident.scoped().is_some() {
                    return ctx.reject(a, StatusCode::PAYLOAD_TOO_LARGE, "invalid_request", "", "request body is too large");
                }
                req = Request::from_parts(parts, body);
            }
            Err(ReadErr::Io(e)) => {
                return json_resp(
                    StatusCode::BAD_REQUEST,
                    json!({"error": {"type": "invalid_request_error", "message": format!("could not read the request body: {e}")}}),
                );
            }
        }
    }

    forward(req, true, Some(ctx)).await
}

/// A scoped key's own limits: expiry for every request; requests per minute
/// and per day for model calls (POST) — model lists never use them up.
fn key_limits(a: &App, ctx: &Ctx, sk: &crate::config::ScopedKey) -> Result<(), Response> {
    let now = now_ms();
    if scoped::key_expired(sk, now) {
        let msg = format!("CarteLink API key \"{}\" expired ({})", sk.name, scoped::clock_text(now, sk.expires));
        return Err(ctx.reject(a, StatusCode::UNAUTHORIZED, "api_key_expired", "", &msg));
    }
    if ctx.method != Method::POST {
        return Ok(());
    }
    let day = scoped::local_day(now);
    let limited = |at: i64, msg: String| {
        let mut r = ctx.reject(a, StatusCode::TOO_MANY_REQUESTS, "api_key_limit", "", &msg);
        let secs = ((at - now).max(0) + 999) / 1000;
        r.headers_mut().insert(header::RETRY_AFTER, HeaderValue::from(secs.max(1)));
        r
    };
    if sk.daily_requests > 0 {
        let used = a.metrics.key_stats().get(&sk.id).map(|k| crate::metrics::day_count(k, &day)).unwrap_or(0);
        if used >= sk.daily_requests as i64 {
            let at = scoped::next_local_midnight(now);
            let msg = format!(
                "CarteLink API key \"{}\" used its {} requests for today; the limit resets {} (at {}).",
                sk.name,
                sk.daily_requests,
                scoped::wait_text(now, at),
                scoped::clock_text(now, at)
            );
            return Err(limited(at, msg));
        }
    }
    if let Err(at) = scoped::rpm_check(&sk.id, sk.rpm, now) {
        let msg = format!(
            "CarteLink API key \"{}\" reached its limit of {} requests per minute; try again {} (at {}).",
            sk.name,
            sk.rpm,
            scoped::wait_text(now, at),
            scoped::clock_text(now, at)
        );
        return Err(limited(at, msg));
    }
    // Counted for every scoped key (the UI shows today's use); checked above.
    let _ = a.metrics.take_daily(&sk.id, &day, 0);
    Ok(())
}

fn scoped_refused(a: &App, ctx: &Ctx, sk: &crate::config::ScopedKey, model: &str) -> Response {
    let msg = format!("model \"{model}\" is not available for API key \"{}\". Available: {}", sk.name, sk.models.join(", "));
    ctx.reject(a, StatusCode::FORBIDDEN, "model_not_allowed", model, &msg)
}

enum ReadErr {
    TooLarge(Body),
    Io(String),
}

/// Reads a body up to `limit` bytes; a larger one comes back whole (what was
/// read is put back in front of the rest) so it can still go through untouched.
async fn read_limited(body: Body, limit: usize) -> Result<Bytes, ReadErr> {
    let mut body = body;
    let mut chunks: Vec<Bytes> = Vec::new();
    let mut total = 0usize;
    while let Some(frame) = body.frame().await {
        let frame = frame.map_err(|e| ReadErr::Io(e.to_string()))?;
        if let Ok(data) = frame.into_data() {
            total += data.len();
            chunks.push(data);
            if total > limit {
                let head = futures_util::stream::iter(chunks.into_iter().map(Ok::<Bytes, axum::Error>));
                let rest = body.into_data_stream();
                use futures_util::StreamExt;
                return Err(ReadErr::TooLarge(Body::from_stream(head.chain(rest))));
            }
        }
    }
    let mut out = Vec::with_capacity(total);
    for c in chunks {
        out.extend_from_slice(&c);
    }
    Ok(Bytes::from(out))
}

/// Applies mapping, blacklist, identity clean-up, system prompt and reasoning
/// settings. Ok(None) = send the original bytes. `force` = a fallback model
/// that replaces routing (a scoped key must still allow it).
fn rewrite_body(a: &App, cfg: &Config, ctx: &mut Ctx, bytes: &Bytes, force: Option<&str>) -> Result<Option<Bytes>, Response> {
    let scoped = ctx.ident.as_ref().and_then(|i| i.scoped().cloned());
    let mut payload: Map<String, Value> = match serde_json::from_slice(bytes) {
        Ok(Value::Object(m)) => m,
        _ => {
            if scoped.is_some() {
                return Err(ctx.reject(a, StatusCode::BAD_REQUEST, "invalid_request", "", "request body is not valid JSON"));
            }
            return Ok(None);
        }
    };
    let want = payload.get("model").and_then(Value::as_str).unwrap_or("").to_string();
    let resolved = match &scoped {
        Some(sk) => {
            let asked = force.unwrap_or(&want);
            match scoped::scoped_model_match(sk, asked) {
                Some(m) => m,
                None => return Err(scoped_refused(a, ctx, sk, asked)),
            }
        }
        None => match force {
            Some(f) => f.to_string(),
            // A per-program rule replaces normal routing (tiers, default model).
            None => app_rule_model(cfg, &ctx.client).unwrap_or_else(|| {
                let known = |m: &str| a.is_known_model(m);
                resolve_model(cfg, &want, Some(&known))
            }),
        },
    };
    ctx.want = want.clone();
    ctx.resolved = resolved.clone();
    // Scoped: always re-encode, so the engine reads the very "model" checked
    // here (with duplicate keys serde keeps the last one, the engine the first).
    let mut changed = scoped.is_some();
    if resolved != want {
        payload.insert("model".into(), Value::String(resolved.clone()));
        changed = true;
    }
    let target = if resolved.is_empty() { uncloak(&want) } else { resolved.clone() };

    if is_blacklisted(cfg, &target) || is_blacklisted(cfg, &want) {
        let msg = format!("model {target} is blocked by the CarteLink model blacklist");
        a.log_error(ErrorEntry {
            status: 400,
            kind: "gateway".into(),
            method: ctx.method.to_string(),
            path: ctx.path.clone(),
            model: want,
            resolved: target,
            client: ctx.client.clone(),
            message: msg.clone(),
            ..Default::default()
        });
        return Err(json_resp(StatusCode::BAD_REQUEST, json!({"type": "error", "error": {"type": "invalid_request_error", "message": msg}})));
    }

    // Claude Code tells every model it is Claude ("You are powered by the model
    // named …"): name the real model instead.
    if clean_identity(&mut payload, &target) {
        changed = true;
    }
    if let Some(api) = api_family(&ctx.path) {
        if apply_prompting(cfg, &mut payload, api) {
            changed = true;
        }
        let caps = a.caps.get(&target);
        if normalize_effort(&mut payload, api, &caps) {
            changed = true;
        }
        if apply_thinking(cfg, &mut payload, api, &caps) {
            changed = true;
        }
    }
    if !changed {
        return Ok(None);
    }
    match serde_json::to_vec(&payload) {
        Ok(b) => Ok(Some(Bytes::from(b))),
        Err(_) => Ok(None),
    }
}

fn identity_re() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| {
        regex::Regex::new(
            r"(?i)You are powered by the model named [^.\n\r]+(?:\.|\r?\n)\s*(?:The exact model ID is [a-zA-Z0-9_.\-\[\]]+(?:\.|\r?\n)\s*)?",
        )
        .unwrap()
    })
}

fn clean_identity(payload: &mut Map<String, Value>, target: &str) -> bool {
    let friendly = friendly_model_name(target);
    let replacement = format!(
        "You are powered by the model named {friendly}. The exact model ID is {target}. When asked about your identity or which model you are, you must identify as {friendly} ({target}). "
    );
    let re = identity_re();
    let fix = |s: &str| -> Option<String> { re.is_match(s).then(|| re.replace_all(s, regex::NoExpand(&replacement)).into_owned()) };
    let mut changed = false;
    match payload.get_mut("system") {
        Some(Value::String(s)) => {
            if let Some(n) = fix(s) {
                *s = n;
                changed = true;
            }
        }
        Some(Value::Array(items)) => {
            for it in items.iter_mut() {
                if let Some(Value::String(t)) = it.get_mut("text")
                    && let Some(n) = fix(t)
                {
                    *t = n;
                    changed = true;
                }
            }
        }
        _ => {}
    }
    changed
}

// ------------------------------------------------------------- forward ----

const HOP: [&str; 8] =
    ["connection", "keep-alive", "proxy-connection", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding"];

/// Query string without the client's key parameters.
fn strip_key_params(q: &str) -> String {
    q.split('&')
        .filter(|p| {
            let name = p.split('=').next().unwrap_or("");
            !p.is_empty() && name != "key" && name != "auth_token"
        })
        .collect::<Vec<_>>()
        .join("&")
}

/// The engine-bound copy of a client request: engine URL, hop-by-hop headers
/// dropped and, with `rewrite_key`, the client's key swapped for the internal one.
fn engine_request(parts: &Parts, body: Body, len: Option<usize>, rewrite_key: bool) -> Result<hyper::Request<Body>, Response> {
    let a = app();
    let upgrade = parts.headers.contains_key(header::UPGRADE);
    let mut pq = parts.uri.path().to_string();
    if let Some(q) = parts.uri.query() {
        let q = if rewrite_key { strip_key_params(q) } else { q.to_string() };
        if !q.is_empty() {
            pq.push('?');
            pq.push_str(&q);
        }
    }
    let uri: Uri = match format!("{}{}", a.engine.base_url(), pq).parse() {
        Ok(u) => u,
        Err(e) => return Err(json_resp(StatusCode::BAD_REQUEST, json!({"error": {"message": format!("bad path: {e}")}}))),
    };

    let mut headers = HeaderMap::with_capacity(parts.headers.len() + 2);
    for (k, v) in parts.headers.iter() {
        let n = k.as_str();
        if HOP.contains(&n) || n == "host" || (!upgrade && n == "upgrade") {
            continue;
        }
        if rewrite_key && matches!(n, "authorization" | "x-api-key" | "x-goog-api-key") {
            continue;
        }
        headers.append(k.clone(), v.clone());
    }
    if upgrade {
        headers.insert(header::CONNECTION, HeaderValue::from_static("upgrade"));
    }
    if rewrite_key && let Ok(v) = HeaderValue::from_str(&format!("Bearer {}", a.engine.internal_key)) {
        headers.insert(header::AUTHORIZATION, v);
    }
    if let Some(n) = len {
        headers.insert(header::CONTENT_LENGTH, HeaderValue::from(n));
    }
    let mut out = hyper::Request::new(body);
    *out.method_mut() = parts.method.clone();
    *out.uri_mut() = uri;
    *out.headers_mut() = headers;
    Ok(out)
}

fn engine_unreachable(e: &impl std::fmt::Display) -> String {
    format!("CarteLink could not reach its engine: {e}")
}

/// Sends the request to the engine and streams the answer back.
async fn forward(req: Request, rewrite_key: bool, ctx: Option<Ctx>) -> Response {
    let a = app();
    let (mut parts, body) = req.into_parts();
    let upgrade = parts.headers.contains_key(header::UPGRADE);
    let client_upgrade = if upgrade { parts.extensions.remove::<hyper::upgrade::OnUpgrade>() } else { None };
    let out = match engine_request(&parts, body, None, rewrite_key) {
        Ok(o) => o,
        Err(r) => return r,
    };
    let resp = match client().request(out).await {
        Ok(r) => r,
        Err(e) => {
            let msg = engine_unreachable(&e);
            if let Some(ctx) = &ctx {
                finish(a, ctx, 502, &msg, msg.as_bytes(), false);
            }
            return json_resp(StatusCode::BAD_GATEWAY, json!({"error": {"type": "engine_unavailable", "message": msg}}));
        }
    };
    if resp.status() == StatusCode::SWITCHING_PROTOCOLS {
        return upgraded(resp, client_upgrade);
    }
    let (rparts, rbody) = resp.into_parts();
    respond(rparts, Body::new(rbody), parts.uri.path(), ctx)
}

/// A model request whose body CarteLink read: sent as rewritten and, when the
/// model fails before answering (limit, server error, model unavailable,
/// engine unreachable), sent again with the next model of its fallback chain.
/// The decision is made on the status line and the (small) error body, so the
/// client never sees a byte of a failed attempt.
async fn forward_model(parts: Parts, orig: Bytes, first: Bytes, mut ctx: Ctx, cfg: &Config) -> Response {
    let a = app();
    let scoped = ctx.ident.as_ref().and_then(|i| i.scoped().cloned());
    let allowed = |m: &str| scoped.as_ref().is_none_or(|sk| scoped::scoped_model_match(sk, m).is_some());
    let mut chain = if ctx.resolved.is_empty() { vec![] } else { fallback_chain(cfg, &ctx.resolved, &allowed) }.into_iter();
    let mut body = first;
    loop {
        if let Some(ins) = ctx.inspect.as_mut() {
            ins.body = Some(body.clone());
        }
        let out = match engine_request(&parts, Body::from(body.clone()), Some(body.len()), true) {
            Ok(o) => o,
            Err(r) => return r,
        };
        let has_next = !chain.as_slice().is_empty();
        let resp = match client().request(out).await {
            Ok(r) => r,
            Err(e) => {
                let msg = engine_unreachable(&e);
                if has_next && let Some(b) = next_fallback(a, cfg, &mut ctx, &orig, &mut chain, 502, &msg) {
                    body = b;
                    continue;
                }
                finish(a, &ctx, 502, &msg, msg.as_bytes(), false);
                return json_resp(StatusCode::BAD_GATEWAY, json!({"error": {"type": "engine_unavailable", "message": msg}}));
            }
        };
        let status = resp.status().as_u16();
        let (mut rparts, rbody) = resp.into_parts();
        if !has_next || !(matches!(status, 400 | 403) || is_fallback_status(status, "")) {
            return respond(rparts, Body::new(rbody), parts.uri.path(), Some(ctx));
        }
        let bytes = match tokio::time::timeout(Duration::from_secs(30), read_limited(Body::new(rbody), FALLBACK_READ)).await {
            Ok(Ok(b)) => b,
            // Too big to be an error message: pass it on as it is.
            Ok(Err(ReadErr::TooLarge(rest))) => return respond(rparts, rest, parts.uri.path(), Some(ctx)),
            Ok(Err(ReadErr::Io(_))) | Err(_) => Bytes::new(),
        };
        let msg = error_message_from_body(&bytes);
        if is_fallback_status(status, &msg)
            && let Some(b) = next_fallback(a, cfg, &mut ctx, &orig, &mut chain, status, &msg)
        {
            body = b;
            continue;
        }
        // The body was read whole (or lost): its length is set anew.
        rparts.headers.remove(header::CONTENT_LENGTH);
        return respond(rparts, Body::from(bytes), parts.uri.path(), Some(ctx));
    }
}

/// Rewrites the request for the next usable model of the chain, noting the
/// switch (error log "auto", notification). None = no model left.
fn next_fallback(
    a: &App,
    cfg: &Config,
    ctx: &mut Ctx,
    orig: &Bytes,
    chain: &mut std::vec::IntoIter<String>,
    status: u16,
    msg: &str,
) -> Option<Bytes> {
    let from = ctx.resolved.clone();
    let (want0, resolved0) = (ctx.want.clone(), ctx.resolved.clone());
    for to in chain.by_ref() {
        match rewrite_body(a, cfg, ctx, orig, Some(&to)) {
            Ok(b) => {
                let body = b.unwrap_or_else(|| orig.clone());
                if ctx.fallback_from.is_empty() {
                    ctx.fallback_from = from.clone();
                }
                autofix_after_error(&from, msg);
                let reason = if msg.is_empty() { format!("HTTP {status}") } else { format!("{status}: {}", truncate_chars(msg, 300)) };
                a.log_error(ErrorEntry {
                    status,
                    kind: "auto".into(),
                    method: ctx.method.to_string(),
                    path: ctx.path.clone(),
                    model: ctx.want.clone(),
                    resolved: format!("{from} → {to}"),
                    client: ctx.client.clone(),
                    key: ctx.ident.as_ref().map(Ident::label).unwrap_or_default(),
                    message: format!("{from} failed ({reason}) — CarteLink sent the request to the fallback model {to}"),
                    ..Default::default()
                });
                a.notify("fallback", "Запасна модель", &format!("{from} не відповіла (помилка {status}) — запит передано на {to}."));
                return Some(body);
            }
            Err(_) => {
                ctx.want = want0.clone();
                ctx.resolved = resolved0.clone();
            }
        }
    }
    None
}

/// The engine's answer for the client: hop-by-hop headers dropped, CORS only
/// on the model API, the body watched by `Tee` when it is a model request.
fn respond(mut rparts: hyper::http::response::Parts, body: Body, path: &str, ctx: Option<Ctx>) -> Response {
    for h in HOP {
        rparts.headers.remove(h);
    }
    // The engine allows every origin; only the model API should (browser
    // clients call it directly). Panel and engine pages stay same-origin.
    if !is_model_api(path) {
        for h in [
            "access-control-allow-origin",
            "access-control-allow-credentials",
            "access-control-allow-headers",
            "access-control-allow-methods",
            "access-control-expose-headers",
        ] {
            rparts.headers.remove(h);
        }
    }
    let status = rparts.status.as_u16();
    let body = match ctx {
        Some(ctx) => Body::new(Tee::new(body, status, ctx)),
        None => body,
    };
    Response::from_parts(rparts, body)
}

fn upgraded(mut resp: hyper::Response<Incoming>, client_upgrade: Option<hyper::upgrade::OnUpgrade>) -> Response {
    let engine_upgrade = hyper::upgrade::on(&mut resp);
    let (parts, _) = resp.into_parts();
    if let Some(cu) = client_upgrade {
        tokio::spawn(async move {
            let (Ok(c), Ok(e)) = (cu.await, engine_upgrade.await) else { return };
            let mut c = TokioIo::new(c);
            let mut e = TokioIo::new(e);
            let _ = tokio::io::copy_bidirectional(&mut c, &mut e).await;
        });
    }
    Response::from_parts(parts, Body::empty())
}

/// Fixes CarteLink makes by itself after an upstream error of `sent`.
fn autofix_after_error(sent: &str, message: &str) {
    // An account type that lists models its plan lacks (Kiro): hide the model there.
    if let Some(prov) = crate::autofix::rejected_model_provider(message) {
        let model = sent.to_string();
        tokio::spawn(async move { crate::autofix::auto_hide_model(prov, &model).await });
    }
    // A content-filter refusal is about this request, not the key.
    if crate::autofix::is_content_filter_error(message) {
        let sent = sent.to_string();
        tokio::spawn(async move { crate::autofix::unblock_after_content_filter(&sent).await });
    }
}

/// What happens once a model request is answered (status known, body done).
fn finish(a: &App, ctx: &Ctx, status: u16, message: &str, body: &[u8], body_cut: bool) {
    let ms = ctx.started.elapsed().as_millis() as u64;
    let scoped = ctx.ident.as_ref().and_then(|i| i.scoped().cloned());
    let failed = status >= 400;
    if let Some(i) = &ctx.ident {
        a.metrics.count_key(&i.stat_id(), failed);
    }
    a.metrics.count_app(&ctx.app, failed, ms);
    let resolved_shown = ctx.resolved_shown();
    if failed {
        let sent = if ctx.resolved.is_empty() { ctx.want.clone() } else { ctx.resolved.clone() };
        a.log_error(ErrorEntry {
            status,
            kind: "upstream".into(),
            method: ctx.method.to_string(),
            path: ctx.path.clone(),
            model: ctx.want.clone(),
            resolved: resolved_shown.clone(),
            client: ctx.client.clone(),
            key: ctx.ident.as_ref().map(Ident::label).unwrap_or_default(),
            message: message.to_string(),
            ..Default::default()
        });
        autofix_after_error(&sent, message);
    } else if api_family(&ctx.path).is_some() && scoped.is_none() {
        crate::api::switcher_auto_advance(&ctx.resolved);
    }
    inspect_record(a, ctx, status, body, body_cut);
    a.emit(LiveEvent::Request {
        t: now_ms(),
        method: ctx.method.to_string(),
        path: ctx.path.clone(),
        status,
        ms,
        model: ctx.want.clone(),
        resolved: resolved_shown,
        client: truncate_chars(&ctx.client, 60),
        key: ctx.ident.as_ref().map(Ident::label).unwrap_or_default(),
    });
}

/// Passes the engine's answer through untouched, keeping the first bytes of an
/// error answer for the log (of every answer while the inspector is on);
/// `finish` runs when the body ends or is dropped.
struct Tee {
    inner: Body,
    status: u16,
    buf: Vec<u8>,
    cap: usize,
    seen: usize,
    ctx: Option<Ctx>,
}

impl Tee {
    fn new(inner: Body, status: u16, ctx: Ctx) -> Self {
        let cap = if ctx.inspect.is_some() {
            INSPECT_CAP
        } else if status >= 400 {
            CAPTURE
        } else {
            0
        };
        Tee { inner, status, buf: Vec::new(), cap, seen: 0, ctx: Some(ctx) }
    }
    fn done(&mut self) {
        if let Some(ctx) = self.ctx.take() {
            let msg = if self.status >= 400 { error_message_from_body(&self.buf[..self.buf.len().min(CAPTURE)]) } else { String::new() };
            finish(app(), &ctx, self.status, &msg, &self.buf, self.seen > self.buf.len());
        }
    }
}

impl Drop for Tee {
    fn drop(&mut self) {
        self.done();
    }
}

impl hyper::body::Body for Tee {
    type Data = Bytes;
    type Error = axum::Error;

    fn poll_frame(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Result<Frame<Bytes>, axum::Error>>> {
        let this = &mut *self;
        match Pin::new(&mut this.inner).poll_frame(cx) {
            Poll::Ready(Some(Ok(frame))) => {
                if let Some(d) = frame.data_ref() {
                    this.seen += d.len();
                    let room = this.cap.saturating_sub(this.buf.len());
                    this.buf.extend_from_slice(&d[..d.len().min(room)]);
                }
                Poll::Ready(Some(Ok(frame)))
            }
            Poll::Ready(None) => {
                this.done();
                Poll::Ready(None)
            }
            other => other,
        }
    }

    fn is_end_stream(&self) -> bool {
        self.inner.is_end_stream()
    }

    fn size_hint(&self) -> SizeHint {
        self.inner.size_hint()
    }
}

// ---------------------------------------------------------- model lists ----

/// Fetches a GET from the engine with the internal key (small JSON answers).
async fn engine_get(req_headers: HeaderMap, path_q: String) -> Result<(StatusCode, HeaderMap, Bytes), Response> {
    let a = app();
    let mut out = hyper::Request::builder().method(Method::GET).uri(format!("{}{}", a.engine.base_url(), path_q));
    for (k, v) in &req_headers {
        let n = k.as_str();
        if HOP.contains(&n) || matches!(n, "host" | "authorization" | "x-api-key" | "x-goog-api-key" | "accept-encoding") {
            continue;
        }
        out = out.header(k, v);
    }
    out = out.header(header::AUTHORIZATION, format!("Bearer {}", a.engine.internal_key));
    let out = out.body(Body::empty()).map_err(|e| json_resp(StatusCode::BAD_REQUEST, json!({"error": {"message": e.to_string()}})))?;
    let resp = client()
        .request(out)
        .await
        .map_err(|e| json_resp(StatusCode::BAD_GATEWAY, json!({"error": {"type": "engine_unavailable", "message": e.to_string()}})))?;
    let status = resp.status();
    let headers = resp.headers().clone();
    let body = resp.into_body().collect().await.map(|c| c.to_bytes()).unwrap_or_default();
    Ok((status, headers, body))
}

fn path_and_query(req: &Request, strip: bool) -> String {
    let mut s = req.uri().path().to_string();
    if let Some(q) = req.uri().query() {
        let q = if strip { strip_key_params(q) } else { q.to_string() };
        if !q.is_empty() {
            s.push('?');
            s.push_str(&q);
        }
    }
    s
}

fn passthrough(status: StatusCode, headers: &HeaderMap, body: Bytes) -> Response {
    let mut r = Response::new(Body::from(body));
    *r.status_mut() = status;
    for (k, v) in headers {
        let n = k.as_str();
        if HOP.contains(&n) || n == "content-length" || n == "content-encoding" {
            continue;
        }
        r.headers_mut().append(k.clone(), v.clone());
    }
    r
}

fn is_anthropic_list(req: &Request) -> bool {
    req.headers().contains_key("anthropic-version")
        || req.headers().get(header::USER_AGENT).and_then(|v| v.to_str().ok()).is_some_and(|ua| ua.starts_with("claude-cli"))
}

const OFFICIAL_CLAUDE: [(&str, &str); 23] = [
    ("claude-fable-5-2", "Claude Fable 5.2"),
    ("claude-fable-5-1", "Claude Fable 5.1"),
    ("claude-opus-5-5", "Claude Opus 5.5"),
    ("claude-sonnet-5-5", "Claude Sonnet 5.5"),
    ("claude-haiku-5-5", "Claude Haiku 5.5"),
    ("claude-opus-5", "Claude Opus 5"),
    ("claude-sonnet-5", "Claude Sonnet 5"),
    ("claude-haiku-4-5", "Claude Haiku 4.5"),
    ("claude-haiku-4-5-20251001", "Claude Haiku 4.5 (20251001)"),
    ("claude-fable-5", "Claude Fable 5"),
    ("claude-opus-4-8", "Claude Opus 4.8"),
    ("claude-opus-4-7", "Claude Opus 4.7"),
    ("claude-opus-4-6", "Claude Opus 4.6"),
    ("claude-opus-4-6-thinking", "Claude Opus 4.6 (Thinking)"),
    ("claude-opus-3", "Claude Opus 3"),
    ("claude-sonnet-4-6", "Claude Sonnet 4.6"),
    ("claude-3-7-sonnet-20250219", "Claude 3.7 Sonnet"),
    ("claude-3-7-sonnet-latest", "Claude 3.7 Sonnet (Latest)"),
    ("claude-3-5-sonnet-20241022", "Claude 3.5 Sonnet"),
    ("claude-3-5-sonnet-latest", "Claude 3.5 Sonnet (Latest)"),
    ("claude-3-5-haiku-20241022", "Claude 3.5 Haiku"),
    ("claude-3-5-haiku-latest", "Claude 3.5 Haiku (Latest)"),
    ("claude-3-haiku-20240307", "Claude 3 Haiku"),
];

/// /v1/models: models the engine serves, enabled CarteLink providers, aliases
/// that currently resolve, official Claude names the mapping rewrites — minus
/// the blacklist, in the format the client expects.
async fn models_list(req: Request, ident: &Ident, cfg: &Arc<Config>) -> Response {
    let a = app();
    let scoped = ident.scoped();
    // Codex asks with ?client_version= and expects the engine's own catalogue.
    let codex_catalog = req.uri().query().is_some_and(|q| q.split('&').any(|p| p.split('=').next() == Some("client_version")));
    let (status, headers, body) = match engine_get(req.headers().clone(), path_and_query(&req, true)).await {
        Ok(x) => x,
        Err(r) => return r,
    };
    if codex_catalog {
        if let Some(sk) = scoped
            && status == StatusCode::OK
        {
            return passthrough(status, &headers, Bytes::from(scoped::filter_model_list(cfg, sk, &body)));
        }
        return passthrough(status, &headers, body);
    }
    if status != StatusCode::OK {
        return passthrough(status, &headers, body);
    }
    let anthropic = is_anthropic_list(&req);
    let upstream: Vec<Value> =
        serde_json::from_slice::<Value>(&body).ok().and_then(|v| v.get("data").cloned()).and_then(|d| d.as_array().cloned()).unwrap_or_default();

    let mut seen = std::collections::HashSet::new();
    let mut all: Vec<CatalogModel> = Vec::new();
    let mut add = |m: CatalogModel| {
        if !m.id.is_empty() && seen.insert(m.id.clone()) {
            all.push(m);
        }
    };
    if let Some(sk) = scoped {
        for m in scoped::scoped_catalog(sk, &upstream) {
            add(m);
        }
    } else {
        for raw in &upstream {
            let id = uncloak(raw.get("id").and_then(Value::as_str).unwrap_or(""));
            let owned = raw.get("owned_by").and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or("cliproxy").to_string();
            let dn = raw.get("display_name").and_then(Value::as_str).unwrap_or("");
            let display_name = if dn.is_empty() || dn.contains("claude-fable-5-dd") { friendly_model_name(&id) } else { dn.to_string() };
            add(CatalogModel { id, display_name, owned_by: owned });
        }
        for p in cfg.providers.iter().filter(|p| p.enabled) {
            for m in &p.models {
                let m = m.trim();
                add(CatalogModel { id: m.into(), display_name: friendly_model_name(m), owned_by: p.id.clone() });
            }
        }
        if anthropic {
            let ctx_of = |m: &str| a.caps.get(m).context;
            for e in claude_picker_entries(cfg, &ctx_of) {
                add(e);
            }
        }
        for alias in served_aliases(cfg) {
            let target = resolve_model(cfg, &alias, None);
            add(CatalogModel { display_name: format!("{alias} → {target}"), id: alias, owned_by: "cartelink".into() });
        }
        for (id, name) in OFFICIAL_CLAUDE {
            if resolve_model(cfg, id, None) != id {
                add(CatalogModel { id: id.into(), display_name: name.into(), owned_by: "anthropic".into() });
            }
        }
    }
    all.retain(|m| !is_blacklisted(cfg, &m.id));

    let out = if anthropic {
        let data: Vec<Value> = all
            .iter()
            .map(|m| {
                let target = if scoped.is_some() {
                    m.id.clone()
                } else {
                    let known = |x: &str| a.is_known_model(x);
                    let t = resolve_model(cfg, &m.id, Some(&known));
                    if t.is_empty() { m.id.clone() } else { t }
                };
                let caps = a.caps.get(&base_model_name(&target));
                let max_in = if caps.context > 0 { caps.context } else { 200_000 };
                let max_out = if caps.max_output > 0 { caps.max_output } else { 64_000 };
                json!({
                    "type": "model", "id": m.id, "display_name": m.display_name,
                    "created_at": "2025-01-01T00:00:00Z", "max_tokens": max_out, "max_input_tokens": max_in,
                    "object": "model", "owned_by": m.owned_by,
                })
            })
            .collect();
        let first = data.first().and_then(|d| d.get("id")).cloned().unwrap_or(json!(""));
        let last = data.last().and_then(|d| d.get("id")).cloned().unwrap_or(json!(""));
        json!({"data": data, "has_more": false, "first_id": first, "last_id": last})
    } else {
        let data: Vec<Value> = all.iter().map(|m| json!({"id": m.id, "object": "model", "owned_by": m.owned_by})).collect();
        json!({"object": "list", "data": data})
    };
    let mut r = passthrough(StatusCode::OK, &headers, Bytes::from(out.to_string()));
    r.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json; charset=utf-8"));
    r
}

/// A list the engine answers in its own format, filtered to a scoped key's models.
async fn scoped_engine_list(req: Request, sk: crate::config::ScopedKey, cfg: &Arc<Config>) -> Response {
    let (status, headers, body) = match engine_get(req.headers().clone(), path_and_query(&req, true)).await {
        Ok(x) => x,
        Err(r) => return r,
    };
    if status != StatusCode::OK {
        return passthrough(status, &headers, body);
    }
    passthrough(status, &headers, Bytes::from(scoped::filter_model_list(cfg, &sk, &body)))
}

#[allow(dead_code)]
fn header_name(s: &'static str) -> HeaderName {
    HeaderName::from_static(s)
}

#[allow(dead_code)]
fn _assert_send() {
    fn is_send<T: Send>(_: &T) {}
    let r: Request = Request::new(Body::empty());
    let f = handle(r);
    is_send(&f);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn network_paths() {
        assert!(network_allowed_path("/v1/chat/completions"));
        assert!(network_allowed_path("/v1beta/models"));
        assert!(!network_allowed_path("/api/config"));
        assert!(!network_allowed_path("/v0/management/auth-files"));
        assert!(!network_allowed_path("/ui/"));
        assert!(!network_allowed_path("/v1"));
    }

    #[test]
    fn hosts() {
        assert!(trusted_host("127.0.0.1:8317", &[]));
        assert!(trusted_host("[::1]:8317", &[]));
        assert!(trusted_host("localhost:8317", &[]));
        assert!(!trusted_host("evil.example:8317", &[]));
        assert!(trusted_host("mybox.lan:8317", &["mybox.lan"]));
    }

    #[test]
    fn origin_check() {
        let mut h = HeaderMap::new();
        h.insert(header::HOST, "127.0.0.1:8317".parse().unwrap());
        assert!(same_origin(&h, &[]));
        h.insert(header::ORIGIN, "http://127.0.0.1:8317".parse().unwrap());
        assert!(same_origin(&h, &[]));
        h.insert(header::ORIGIN, "http://evil.example".parse().unwrap());
        assert!(!same_origin(&h, &[]));
        let mut h2 = HeaderMap::new();
        h2.insert(header::HOST, "127.0.0.1:8317".parse().unwrap());
        h2.insert("sec-fetch-site", "cross-site".parse().unwrap());
        assert!(!same_origin(&h2, &[]));
    }

    #[test]
    fn management_key_check() {
        let mut h = HeaderMap::new();
        assert!(!management_key_ok(&h, "s3"));
        h.insert("x-management-key", "s3".parse().unwrap());
        assert!(management_key_ok(&h, "s3"));
        assert!(!management_key_ok(&h, "s4"));
        assert!(!management_key_ok(&h, ""));
        let mut b = HeaderMap::new();
        b.insert(header::AUTHORIZATION, "Bearer s3".parse().unwrap());
        assert!(management_key_ok(&b, "s3"));
    }

    #[test]
    fn key_params_stripped() {
        assert_eq!(strip_key_params("alt=sse&key=abc"), "alt=sse");
        assert_eq!(strip_key_params("auth_token=x"), "");
        assert_eq!(strip_key_params("keys=1&key=2"), "keys=1");
    }

    #[test]
    fn inspector_hides_credentials() {
        let mut h = HeaderMap::new();
        for (k, v) in [
            ("authorization", "Bearer cl-x"),
            ("x-api-key", "k"),
            ("x-goog-api-key", "g"),
            ("cookie", "c=1"),
            ("user-agent", "claude-cli/2"),
            ("content-type", "application/json"),
        ] {
            h.insert(HeaderName::from_static(k), v.parse().unwrap());
        }
        let out = redacted_headers(&h);
        let get = |n: &str| out.iter().find(|[k, _]| k == n).map(|[_, v]| v.as_str());
        assert_eq!(get("authorization"), Some("***"));
        assert_eq!(get("x-api-key"), Some("***"));
        assert_eq!(get("x-goog-api-key"), Some("***"));
        assert_eq!(get("cookie"), Some("***"));
        assert_eq!(get("user-agent"), Some("claude-cli/2"));
        assert!(!format!("{out:?}").contains("cl-x"));
    }

    #[test]
    fn clip_marks_cuts() {
        assert_eq!(clip(b"abc", 5), ("abc".to_string(), false));
        assert_eq!(clip(b"abcdef", 3), ("abc".to_string(), true));
    }

    #[test]
    fn identity_cleanup() {
        let mut p: Map<String, Value> =
            serde_json::from_value(json!({"system": "You are powered by the model named Fable 5. The exact model ID is claude-fable-5.\nRest"}))
                .unwrap();
        assert!(clean_identity(&mut p, "gpt-6"));
        let s = p["system"].as_str().unwrap();
        assert!(s.contains("GPT 6 (gpt-6)"));
        assert!(s.ends_with("Rest"));
    }
}
