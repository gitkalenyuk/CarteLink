//! The control API under /api: what the UI and the floating switcher use.
//! Reachable only from this computer and only same-origin (see `guard`).

use std::collections::HashMap;
use std::convert::Infallible;
use std::time::Duration;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, Request};
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get, post, put};
use futures_util::stream::Stream;
use serde_json::{Map, Value, json};

use crate::app::{LiveEvent, app};
use crate::config::{self, Config, Provider, ScopedKey, VERSION};
use crate::engine::UPSTREAM_VERSION;
use crate::errlog::ErrorEntry;
use crate::paths;
use crate::proxy::same_origin;
use crate::routing::current_main_model;
use crate::util::{now_ms, random_hex};

type Res = Response;

fn ok(v: Value) -> Res {
    (StatusCode::OK, axum::Json(v)).into_response()
}
fn fail(status: StatusCode, msg: impl Into<String>) -> Res {
    (status, axum::Json(json!({"ok": false, "error": msg.into()}))).into_response()
}
fn bad(msg: impl Into<String>) -> Res {
    fail(StatusCode::BAD_REQUEST, msg)
}

fn parse_body(b: &Bytes) -> Result<Value, Res> {
    if b.is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_slice(b).map_err(|e| bad(format!("invalid JSON: {e}")))
}

pub fn router() -> Router {
    Router::new()
        .route("/status", get(status))
        .route("/alive", get(alive))
        .route("/endpoints", get(endpoints))
        .route("/config", get(config_get).put(config_put).patch(config_patch))
        .route("/server/start", post(server_start))
        .route("/server/stop", post(server_stop))
        .route("/server/restart", post(server_restart))
        .route("/generate-key", post(generate_key))
        .route("/scoped-keys", get(scoped_list).post(scoped_create))
        .route("/scoped-keys/{id}", put(scoped_update).delete(scoped_delete).patch(scoped_patch))
        .route("/scoped-keys/{id}/rotate", post(scoped_rotate))
        .route("/accounts", get(accounts_get))
        .route("/accounts/delete", post(accounts_delete))
        .route("/accounts/toggle", post(accounts_toggle))
        .route("/accounts/reset", post(accounts_reset))
        .route("/accounts/priority", post(accounts_priority))
        .route("/engine-tuning", get(engine_tuning_get).put(engine_tuning_put))
        .route("/inspector", get(inspector_list))
        .route("/inspector/clear", post(inspector_clear))
        .route("/inspector/{id}", get(inspector_item))
        .route("/stats/apps", get(stats_apps))
        .route("/stats/accounts", get(stats_accounts))
        .route("/account-to-provider", post(account_to_provider))
        .route("/account-provider/hide", post(account_provider_hide))
        .route("/provider-models", post(provider_models))
        .route("/cliproxy/api/{*path}", any(mgmt_passthrough))
        .route("/cliproxy/oauth/start", post(oauth_start))
        .route("/cliproxy/oauth/status", get(oauth_status))
        .route("/cliproxy/oauth/cancel", any(oauth_cancel))
        .route("/cliproxy/oauth/close-browser", post(oauth_close))
        .route("/app/ping", get(app_ping))
        .route("/app/show", post(app_show))
        .route("/app/settings", get(app_settings_get).put(app_settings_put))
        .route("/app/open", post(app_open))
        .route("/app/quit", post(app_quit))
        .route("/routing/apply-all", post(apply_all))
        .route("/switcher", get(switcher_get).put(switcher_put))
        .route("/switcher/switch", post(switcher_switch))
        .route("/model-info", get(model_info))
        .route("/model-context", get(model_context))
        .route("/engine-models", get(engine_models))
        .route("/test-model", post(test_model))
        .route("/errors", get(errors_get))
        .route("/errors/clear", post(errors_clear))
        .route("/limits", get(limits_get))
        .route("/metrics", get(metrics_get))
        .route("/metrics/summary", get(metrics_summary))
        .route("/metrics/clear", post(metrics_clear))
        .route("/ui-prefs", get(ui_prefs_get).put(ui_prefs_put))
        .route("/logs", get(logs_get))
        .route("/events", get(events))
        .merge(crate::api2::router())
        .fallback(|req: Request| async move { fail(StatusCode::NOT_FOUND, format!("unknown endpoint {}", req.uri().path())) })
        .layer(middleware::from_fn(guard))
}

/// Same-origin only: the engine answers every route with "Access-Control-
/// Allow-Origin: *", and without this any web page open in the user's browser
/// could read the config or drive the Management API.
async fn guard(req: Request, next: Next) -> Res {
    let a = app();
    let hosts = [a.bound().0, a.config().cliproxy.host.clone()];
    let hosts: Vec<&str> = hosts.iter().map(String::as_str).collect();
    if req.uri().path() == "/alive" {
        return next.run(req).await;
    }
    if !same_origin(req.headers(), &hosts) {
        return fail(StatusCode::FORBIDDEN, "cross-origin access to the control API is not allowed");
    }
    let mut r = next.run(req).await;
    r.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    r
}

// ----------------------------------------------------------------- status ----

fn engine_state() -> Value {
    let a = app();
    let cfg = a.config();
    let (host, port) = a.bound();
    json!({
        "running": a.engine.running() && !a.paused(),
        "engineUp": a.engine.running(),
        "paused": a.paused(),
        "restarting": a.engine.restarting(),
        "lastError": a.engine.last_error(),
        "port": port,
        "configPort": cfg.cliproxy.port,
        "host": host,
        "version": UPSTREAM_VERSION,
    })
}

async fn status() -> Res {
    let a = app();
    let cfg = a.config();
    ok(json!({
        "version": VERSION,
        "engine": engine_state(),
        "requireKey": cfg.require_key,
        "routing": cfg.routing,
        "providers": cfg.providers,
        "mainModel": current_main_model(&cfg),
        "prompting": cfg.prompting.enabled,
        "errors24h": a.errlog.count_since(now_ms() - 86_400_000),
        "uptime": now_ms() - a.started_at,
        "platform": std::env::consts::OS,
        "warning": a.config_warning.lock().ok().and_then(|g| g.clone()),
    }))
}

/// Minimal liveness for a window following a restart to another port. Open to
/// any local origin (it reveals nothing).
async fn alive(req: Request) -> Res {
    let a = app();
    let mut r = ok(json!({"app": "CarteLink", "running": a.engine.running(), "restarting": a.engine.restarting()}));
    if let Some(o) = req.headers().get(header::ORIGIN) {
        let trusted = o
            .to_str()
            .ok()
            .and_then(|s| url::Url::parse(s).ok())
            .and_then(|u| u.host_str().map(str::to_string))
            .is_some_and(|h| crate::proxy::trusted_host(&h, &[]));
        if trusted {
            r.headers_mut().insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, o.clone());
        }
    }
    r
}

async fn endpoints() -> Res {
    let a = app();
    let cfg = a.config();
    let base = a.public_base();
    ok(json!({
        "base": base,
        "openai": format!("{base}/v1"),
        "anthropic": base,
        "anthropic_messages": format!("{base}/v1/messages"),
        "gemini": format!("{base}/v1beta/models"),
        "key": cfg.api_key,
        "requireKey": cfg.require_key,
        "lan": !matches!(cfg.cliproxy.host.as_str(), "127.0.0.1" | "localhost" | "::1"),
    }))
}

fn config_for_ui(cfg: &Config) -> Value {
    let mut v = serde_json::to_value(cfg).unwrap_or(json!({}));
    if let Some(cp) = v.get_mut("cliproxy").and_then(Value::as_object_mut) {
        cp.insert("managementSecret".into(), json!(""));
    }
    v
}

async fn config_get() -> Res {
    ok(config_for_ui(&app().config()))
}

/// Fields with their own endpoints: a save from a page loaded earlier must not
/// roll them back.
fn keep_protected(prev: &Config, next: &mut Config) {
    next.desktop = prev.desktop.clone();
    next.scoped_keys = prev.scoped_keys.clone();
    next.ui = prev.ui.clone();
    next.cliproxy.management_secret = prev.cliproxy.management_secret.clone();
}

fn after_config_save(prev: &Config, next: &Config) -> Value {
    let a = app();
    let addr_changed = prev.cliproxy.port != next.cliproxy.port || prev.cliproxy.host != next.cliproxy.host;
    if addr_changed {
        a.set_session_port(None); // an explicit choice ends a temporary port
    }
    json!({"ok": true, "needsRestart": addr_changed, "port": next.cliproxy.port})
}

/// PUT: the whole config (2.x UI style).
async fn config_put(body: Bytes) -> Res {
    let a = app();
    let mut fresh: Config = match serde_json::from_slice(&body) {
        Ok(c) => c,
        Err(e) => return bad(format!("invalid config: {e}")),
    };
    let prev = a.config();
    keep_protected(&prev, &mut fresh);
    match a.update_config(|c| {
        *c = fresh;
        Ok(())
    }) {
        Ok(next) => ok(after_config_save(&prev, &next)),
        Err(e) => fail(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

/// RFC 7386 JSON merge patch.
fn merge_patch(target: &mut Value, patch: &Value) {
    match patch {
        Value::Object(p) => {
            if !target.is_object() {
                *target = Value::Object(Map::new());
            }
            let t = target.as_object_mut().unwrap();
            for (k, v) in p {
                if v.is_null() {
                    t.remove(k);
                } else {
                    merge_patch(t.entry(k.clone()).or_insert(Value::Null), v);
                }
            }
        }
        other => *target = other.clone(),
    }
}

/// PATCH: only the changed fields, applied on the live config under the write
/// lock, so concurrent changes (the switcher, another page) are never lost.
async fn config_patch(body: Bytes) -> Res {
    let a = app();
    let patch = match parse_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    if extra_yaml_in(&patch).is_some_and(|y| !y.trim().is_empty())
        && let Err(e) = check_yaml(extra_yaml_in(&patch).unwrap_or(""))
    {
        return bad(e);
    }
    let prev = a.config();
    match a.update_config(|c| {
        let mut v = serde_json::to_value(&*c).map_err(|e| e.to_string())?;
        merge_patch(&mut v, &patch);
        let mut next: Config = serde_json::from_value(v).map_err(|e| format!("invalid config: {e}"))?;
        keep_protected(c, &mut next);
        *c = next;
        Ok(())
    }) {
        Ok(next) => ok(after_config_save(&prev, &next)),
        Err(e) => bad(e),
    }
}

fn extra_yaml_in(patch: &Value) -> Option<&str> {
    patch.get("cliproxy")?.get("extraConfigYAML")?.as_str()
}

fn check_yaml(s: &str) -> Result<(), String> {
    match serde_norway::from_str::<serde_norway::Value>(s) {
        Ok(serde_norway::Value::Mapping(_)) | Ok(serde_norway::Value::Null) => Ok(()),
        Ok(_) => Err("YAML must be a mapping (key: value)".into()),
        Err(e) => Err(format!("YAML: {e}")),
    }
}

// ----------------------------------------------------------------- server ----

async fn server_start() -> Res {
    let a = app();
    a.set_paused(false);
    if !a.engine.running() {
        let cfg = a.config();
        if let Err(e) = a.engine.start(&cfg).await {
            return fail(StatusCode::CONFLICT, e);
        }
    }
    ok(json!({"ok": true, "running": a.engine.running()}))
}

async fn server_stop() -> Res {
    app().set_paused(true);
    ok(json!({"ok": true, "running": false}))
}

/// Restarts the engine and, when the saved address changed, moves the gateway
/// there. The reply comes first; the UI follows with /api/alive.
async fn server_restart() -> Res {
    let a = app();
    let cfg = a.config();
    let (cur_host, cur_port) = a.bound();
    let host = cfg.cliproxy.host.clone();
    let port = a.effective_port();
    let moving = cur_host != host || cur_port != port;
    // Same port, other host: our own listener holds the port, so it is freed
    // first (and taken back if the new address cannot be bound).
    let same_port = port == cur_port;
    if moving && !same_port && !crate::server::port_free(&host, port) {
        return fail(StatusCode::CONFLICT, format!("адреса {host}:{port} зайнята або недоступна"));
    }
    if a.engine.restarting() {
        return fail(StatusCode::CONFLICT, "restart already in progress");
    }
    let reply = json!({"ok": true, "restarting": true, "port": port, "host": config::display_host(&host)});
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(400)).await;
        let a = app();
        a.set_paused(false);
        if moving {
            if same_port {
                a.server.stop();
                tokio::time::sleep(Duration::from_millis(300)).await;
            }
            match a.server.serve(&host, port, crate::routes::router()).await {
                Ok(()) => {
                    a.mark_bound(&host, port);
                    crate::instance::register(&host, port);
                }
                Err(e) => {
                    a.log_error(ErrorEntry { kind: "app".into(), message: format!("listen on {host}:{port}: {e}"), ..Default::default() });
                    if same_port {
                        let _ = a.server.serve(&cur_host, cur_port, crate::routes::router()).await;
                    }
                }
            }
        }
        let cfg = a.config();
        if let Err(e) = a.engine.restart(&cfg).await {
            tracing::error!("restart: {e}");
        }
        a.emit(LiveEvent::Changed { what: "status".into() });
    });
    ok(reply)
}

async fn generate_key() -> Res {
    match app().update_config(|c| {
        c.api_key = config::new_key();
        Ok(())
    }) {
        Ok(c) => ok(json!({"ok": true, "key": c.api_key})),
        Err(e) => fail(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

// ------------------------------------------------------------ scoped keys ----

async fn scoped_list() -> Res {
    let a = app();
    let cfg = a.config();
    let stats = a.metrics.key_stats();
    let now = now_ms();
    let day = crate::scoped::local_day(now);
    let keys: Vec<Value> = cfg
        .scoped_keys
        .iter()
        .map(|k| {
            let mut v = serde_json::to_value(k).unwrap_or(json!({}));
            if let Some(s) = stats.get(&k.id) {
                v["stats"] = json!(s);
            }
            v["usage"] = json!({
                "today": stats.get(&k.id).map(|s| crate::metrics::day_count(s, &day)).unwrap_or(0),
                "lastMinute": crate::scoped::rpm_used(&k.id, now),
                "expired": crate::scoped::key_expired(k, now),
                "dayResetsAt": crate::scoped::next_local_midnight(now),
            });
            v
        })
        .collect();
    ok(json!({"ok": true, "keys": keys, "requireKey": cfg.require_key, "main": stats.get("main")}))
}

fn read_scoped_form(v: &Value) -> Result<(String, Vec<String>), Res> {
    let name = v.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if name.is_empty() {
        return Err(bad("name is required"));
    }
    if name.chars().count() > 80 {
        return Err(bad("name is too long"));
    }
    let models: Vec<String> =
        v.get("models").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default();
    let models = config::clean_models(&models);
    if models.is_empty() {
        return Err(bad("choose at least one model"));
    }
    Ok((name, models))
}

/// Optional limits of a scoped key: {rpm, dailyRequests, expires, note}; only
/// the fields present change. Returns whether any was present.
fn read_scoped_limits(v: &Value, k: &mut ScopedKey) -> Result<bool, Res> {
    let mut any = false;
    let count = |name: &str| -> Result<Option<u32>, Res> {
        match v.get(name) {
            None | Some(Value::Null) => Ok(None),
            Some(x) => match x.as_u64() {
                Some(n) if n <= 10_000_000 => Ok(Some(n as u32)),
                _ => Err(bad(format!("{name} must be a whole number from 0 to 10000000"))),
            },
        }
    };
    if let Some(n) = count("rpm")? {
        k.rpm = n;
        any = true;
    }
    if let Some(n) = count("dailyRequests")? {
        k.daily_requests = n;
        any = true;
    }
    match v.get("expires") {
        None | Some(Value::Null) => {}
        Some(x) => match x.as_i64() {
            Some(t) if t >= 0 => {
                k.expires = t;
                any = true;
            }
            _ => return Err(bad("expires must be unix milliseconds (0 = never)")),
        },
    }
    if let Some(n) = v.get("note").and_then(Value::as_str) {
        let n = n.trim();
        if n.chars().count() > 500 {
            return Err(bad("note is too long"));
        }
        k.note = n.to_string();
        any = true;
    }
    Ok(any)
}

async fn scoped_create(body: Bytes) -> Res {
    let v = match parse_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let (name, models) = match read_scoped_form(&v) {
        Ok(x) => x,
        Err(r) => return r,
    };
    let mut created = ScopedKey {
        id: format!("k-{}", random_hex(4)),
        name,
        key: config::new_scoped_key(),
        models,
        created: now_ms(),
        enabled: true,
        ..Default::default()
    };
    if let Err(r) = read_scoped_limits(&v, &mut created) {
        return r;
    }
    let c2 = created.clone();
    match app().update_config(move |c| {
        c.scoped_keys.push(c2);
        Ok(())
    }) {
        Ok(_) => ok(json!({"ok": true, "key": created})),
        Err(e) => fail(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

fn with_scoped(id: &str, f: impl FnOnce(&mut ScopedKey)) -> Res {
    let mut found: Option<ScopedKey> = None;
    let r = app().update_config(|c| {
        let k = c.scoped_keys.iter_mut().find(|k| k.id == id).ok_or("API key not found")?;
        f(k);
        found = Some(k.clone());
        Ok(())
    });
    match r {
        Ok(_) => ok(json!({"ok": true, "key": found})),
        Err(e) if e.contains("not found") => fail(StatusCode::NOT_FOUND, e),
        Err(e) => fail(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

async fn scoped_update(Path(id): Path<String>, body: Bytes) -> Res {
    let v = match parse_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let (name, models) = match read_scoped_form(&v) {
        Ok(x) => x,
        Err(r) => return r,
    };
    // Validate the limits before touching the config.
    if let Err(r) = read_scoped_limits(&v, &mut ScopedKey::default()) {
        return r;
    }
    with_scoped(&id, |k| {
        k.name = name;
        k.models = models;
        let _ = read_scoped_limits(&v, k);
    })
}

/// PATCH {enabled?, rpm?, dailyRequests?, expires?, note?}: turn a key off
/// without deleting it, or change its limits.
async fn scoped_patch(Path(id): Path<String>, body: Bytes) -> Res {
    let v = match parse_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let enabled = v.get("enabled").and_then(Value::as_bool);
    match read_scoped_limits(&v, &mut ScopedKey::default()) {
        Err(r) => return r,
        Ok(false) if enabled.is_none() => return bad("enabled is required"),
        Ok(_) => {}
    }
    with_scoped(&id, |k| {
        if let Some(e) = enabled {
            k.enabled = e;
        }
        let _ = read_scoped_limits(&v, k);
    })
}

/// A new secret for the same key record (the old one stops working at once).
async fn scoped_rotate(Path(id): Path<String>) -> Res {
    with_scoped(&id, |k| k.key = config::new_scoped_key())
}

async fn scoped_delete(Path(id): Path<String>) -> Res {
    let r = app().update_config(|c| {
        let before = c.scoped_keys.len();
        c.scoped_keys.retain(|k| k.id != id);
        if c.scoped_keys.len() == before {
            return Err("API key not found".into());
        }
        Ok(())
    });
    match r {
        Ok(_) => {
            app().metrics.forget_key(&id);
            ok(json!({"ok": true}))
        }
        Err(e) if e.contains("not found") => fail(StatusCode::NOT_FOUND, e),
        Err(e) => fail(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

// --------------------------------------------------------------- accounts ----

async fn limits_get(Query(q): Query<HashMap<String, String>>) -> Res {
    let a = app();
    if !a.engine.running() {
        return ok(json!({"ok": true, "running": false, "accounts": [], "summary": crate::limits::summary(&[])}));
    }
    let force = q.get("refresh").is_some_and(|v| v == "1");
    match crate::limits::accounts(force).await {
        Some(list) => ok(json!({"ok": true, "running": !a.paused(), "now": now_ms(), "summary": crate::limits::summary(&list), "accounts": list})),
        None => fail(StatusCode::BAD_GATEWAY, "engine did not return accounts"),
    }
}

async fn accounts_get(q: Query<HashMap<String, String>>) -> Res {
    limits_get(q).await
}

/// The id of the provider entry made from an account file (2.x scheme, kept
/// so existing entries still match): "antigravity-me@x.json" → "cp-antigravity-me-x".
pub fn account_provider_id(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let base = base.strip_suffix(".json").unwrap_or(base);
    let (fam, rest) = match base.find('-') {
        Some(i) if i > 0 => (&base[..i], &base[i + 1..]),
        _ => (base, base),
    };
    let mut short: String = rest.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    short.truncate(24);
    format!("cp-{fam}-{}", short.trim_matches('-').to_ascii_lowercase())
}

fn account_family(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let base = base.strip_suffix(".json").unwrap_or(base);
    match base.find('-') {
        Some(i) if i > 0 => base[..i].to_string(),
        _ => base.to_string(),
    }
}

fn account_display(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let base = base.strip_suffix(".json").unwrap_or(base);
    match base.find('-') {
        Some(i) if i > 0 => base[i + 1..].to_string(),
        _ => base.to_string(),
    }
}

/// Deletes accounts: {names:[…]} or {filter:"invalid"|"error"|"broken"|"disabled"|"limited"|"all"}.
/// "broken" = sign-in rejected or failing (not just rate-limited).
async fn accounts_delete(body: Bytes) -> Res {
    let v = match parse_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let mut names: Vec<String> =
        v.get("names").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default();
    if let Some(filter) = v.get("filter").and_then(Value::as_str) {
        let Some(list) = crate::limits::accounts(false).await else { return fail(StatusCode::SERVICE_UNAVAILABLE, "engine is not running") };
        names.extend(
            list.into_iter()
                .filter(|acc| match filter {
                    "all" => true,
                    "broken" => matches!(acc.state.as_str(), "invalid" | "error"),
                    s => acc.state == s,
                })
                .map(|acc| acc.name),
        );
    }
    names.retain(|n| !n.trim().is_empty());
    names.sort();
    names.dedup();
    if names.is_empty() {
        return ok(json!({"ok": true, "deleted": 0, "files": [], "failed": []}));
    }
    match delete_accounts(&names).await {
        Ok((deleted, failed)) => ok(
            json!({"ok": failed.is_empty(), "deleted": deleted.len(), "files": deleted, "failed": failed, "error": if failed.is_empty() { Value::Null } else { json!(format!("{} not deleted", failed.len())) }}),
        ),
        Err(e) => fail(StatusCode::BAD_GATEWAY, e),
    }
}

/// Deletes account files in the engine and their provider entries in config.
pub async fn delete_accounts(names: &[String]) -> Result<(Vec<String>, Vec<Value>), String> {
    let a = app();
    let r = a.mgmt_json(reqwest::Method::DELETE, "/v0/management/auth-files", &json!({"names": names})).await;
    let v = r.json();
    if !r.ok() && r.status != 207 {
        return Err(crate::util::error_message_from_body(&r.body));
    }
    let mut deleted: Vec<String> =
        v.get("files").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default();
    if deleted.is_empty() && r.ok() && names.len() == 1 {
        deleted = names.to_vec();
    }
    let failed: Vec<Value> = v.get("failed").and_then(Value::as_array).cloned().unwrap_or_default();
    let gone: std::collections::HashSet<String> = deleted
        .iter()
        .chain(names.iter().filter(|n| !failed.iter().any(|f| f.get("name").and_then(Value::as_str) == Some(n.as_str()))))
        .map(|n| account_provider_id(n))
        .collect();
    if !gone.is_empty() {
        let _ = a.update_config(|c| {
            c.providers.retain(|p| !gone.contains(&p.id));
            c.hidden_accounts.retain(|h| !gone.contains(h));
            Ok(())
        });
    }
    a.quota.lock().unwrap_or_else(|e| e.into_inner()).clear();
    a.emit(LiveEvent::Changed { what: "accounts".into() });
    tokio::spawn(async { app().refresh_catalog().await });
    Ok((deleted, failed))
}

/// {name, disabled}: turn one account (or several: names[]) off or on.
async fn accounts_toggle(body: Bytes) -> Res {
    let v = match parse_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let Some(disabled) = v.get("disabled").and_then(Value::as_bool) else { return bad("disabled is required") };
    let mut names: Vec<String> =
        v.get("names").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default();
    if let Some(n) = v.get("name").and_then(Value::as_str) {
        names.push(n.to_string());
    }
    let a = app();
    let mut failed = vec![];
    for n in &names {
        let r = a.mgmt_json(reqwest::Method::PATCH, "/v0/management/auth-files/status", &json!({"name": n, "disabled": disabled})).await;
        if !r.ok() {
            failed.push(json!({"name": n, "error": crate::util::error_message_from_body(&r.body)}));
        }
    }
    a.emit(LiveEvent::Changed { what: "accounts".into() });
    ok(json!({"ok": failed.is_empty(), "failed": failed}))
}

/// {authIndex | authIndexes[]}: lift the cooldown after a limit.
async fn accounts_reset(body: Bytes) -> Res {
    let v = match parse_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let mut idx: Vec<String> =
        v.get("authIndexes").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default();
    if let Some(i) = v.get("authIndex").and_then(Value::as_str) {
        idx.push(i.into());
    }
    let a = app();
    let mut n = 0;
    for i in &idx {
        if a.mgmt_json(reqwest::Method::POST, "/v0/management/reset-quota", &json!({"auth_index": i})).await.ok() {
            n += 1;
        }
    }
    a.emit(LiveEvent::Changed { what: "accounts".into() });
    ok(json!({"ok": n == idx.len(), "reset": n}))
}

/// {name, priority?, weight?}: the engine picks accounts of the highest
/// priority first; with the weighted-round-robin strategy, by weight (0 = never).
async fn accounts_priority(body: Bytes) -> Res {
    let v = match parse_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let name = v.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if name.is_empty() {
        return bad("name is required");
    }
    let mut patch = Map::new();
    patch.insert("name".into(), json!(name));
    if let Some(p) = v.get("priority").filter(|p| !p.is_null()) {
        match p.as_i64() {
            Some(n) if (-1000..=1000).contains(&n) => {
                patch.insert("priority".into(), json!(n));
            }
            _ => return bad("priority must be a whole number from -1000 to 1000"),
        }
    }
    if let Some(w) = v.get("weight").filter(|w| !w.is_null()) {
        match w.as_i64() {
            Some(n) if (0..=1_000_000).contains(&n) => {
                patch.insert("weight".into(), json!(n));
            }
            _ => return bad("weight must be a whole number from 0 to 1000000"),
        }
    }
    if patch.len() == 1 {
        return bad("priority or weight is required");
    }
    let a = app();
    let r = a.mgmt_json(reqwest::Method::PATCH, "/v0/management/auth-files/fields", &Value::Object(patch)).await;
    if !r.ok() {
        return fail(StatusCode::from_u16(r.status).unwrap_or(StatusCode::BAD_GATEWAY), crate::util::error_message_from_body(&r.body));
    }
    a.emit(LiveEvent::Changed { what: "accounts".into() });
    ok(json!({"ok": true}))
}

// ------------------------------------------------------------ engine tuning ----

#[derive(Clone, Copy)]
enum Tune {
    Int,
    Bool,
    Strategy,
}

/// UI field, engine Management API path, engine JSON key, kind.
const TUNING: [(&str, &str, &str, Tune); 6] = [
    ("requestRetry", "request-retry", "request-retry", Tune::Int),
    ("maxRetryCredentials", "max-retry-credentials", "max-retry-credentials", Tune::Int),
    ("maxRetryInterval", "max-retry-interval", "max-retry-interval", Tune::Int),
    ("routingStrategy", "routing/strategy", "strategy", Tune::Strategy),
    ("switchProject", "quota-exceeded/switch-project", "switch-project", Tune::Bool),
    ("switchPreviewModel", "quota-exceeded/switch-preview-model", "switch-preview-model", Tune::Bool),
];

const STRATEGIES: [&str; 3] = ["round-robin", "weighted-round-robin", "fill-first"];

/// A value from the UI as the engine takes it, or why not.
fn tuning_value(kind: Tune, field: &str, v: &Value) -> Result<Value, String> {
    match kind {
        Tune::Int => v.as_i64().filter(|n| (0..=1_000_000).contains(n)).map(Value::from).ok_or(format!("{field} must be a whole number ≥ 0")),
        Tune::Bool => v.as_bool().map(Value::from).ok_or(format!("{field} must be true or false")),
        Tune::Strategy => v
            .as_str()
            .map(|s| s.trim().to_ascii_lowercase())
            .filter(|s| STRATEGIES.contains(&s.as_str()))
            .map(Value::from)
            .ok_or(format!("{field} must be one of {}", STRATEGIES.join(", "))),
    }
}

async fn engine_tuning_state() -> Result<Value, Res> {
    let a = app();
    if !a.engine.running() {
        return Err(fail(StatusCode::SERVICE_UNAVAILABLE, "engine is not running"));
    }
    let paths: Vec<String> = TUNING.iter().map(|(_, path, _, _)| format!("/v0/management/{path}")).collect();
    let answers = futures_util::future::join_all(paths.iter().map(|p| a.mgmt_get(p))).await;
    let mut out = Map::new();
    out.insert("ok".into(), json!(true));
    for ((field, _, key, _), r) in TUNING.iter().zip(answers) {
        let v = if r.ok() { r.json().get(*key).cloned().unwrap_or(Value::Null) } else { Value::Null };
        out.insert((*field).into(), v);
    }
    Ok(Value::Object(out))
}

/// GET: the engine's retry and account-choice settings.
async fn engine_tuning_get() -> Res {
    match engine_tuning_state().await {
        Ok(v) => ok(v),
        Err(r) => r,
    }
}

/// PUT {any subset of the GET fields}: writes them to the engine (it saves config.yaml).
async fn engine_tuning_put(body: Bytes) -> Res {
    let v = match parse_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let mut writes = vec![];
    for (field, path, _, kind) in TUNING {
        let Some(x) = v.get(field).filter(|x| !x.is_null()) else { continue };
        match tuning_value(kind, field, x) {
            Ok(val) => writes.push((path, val)),
            Err(e) => return bad(e),
        }
    }
    if writes.is_empty() {
        return bad("nothing to change");
    }
    let a = app();
    for (path, val) in writes {
        let r = a.mgmt_json(reqwest::Method::PUT, &format!("/v0/management/{path}"), &json!({"value": val})).await;
        if !r.ok() {
            return fail(StatusCode::from_u16(r.status).unwrap_or(StatusCode::BAD_GATEWAY), crate::util::error_message_from_body(&r.body));
        }
    }
    a.emit(LiveEvent::Changed { what: "engine".into() });
    engine_tuning_get().await
}

// --------------------------------------------------------------- inspector ----

async fn inspector_list() -> Res {
    let cfg = app().config();
    ok(json!({"ok": true, "enabled": cfg.inspector.enabled, "keep": cfg.inspector.keep, "items": crate::proxy::inspector_items(&cfg)}))
}

async fn inspector_item(Path(id): Path<String>) -> Res {
    let Ok(id) = id.parse::<u64>() else { return bad("bad id") };
    match crate::proxy::inspector_get(id) {
        Some(item) => ok(json!({"ok": true, "item": item})),
        None => fail(StatusCode::NOT_FOUND, "request not found (the inspector keeps only the latest ones)"),
    }
}

async fn inspector_clear() -> Res {
    crate::proxy::inspector_clear();
    ok(json!({"ok": true}))
}

// ------------------------------------------------------------------ stats ----

async fn stats_apps() -> Res {
    let mut apps: Vec<Value> = app()
        .metrics
        .app_stats()
        .into_iter()
        .map(|(name, s)| {
            json!({"name": name, "requests": s.requests, "failed": s.failed, "last": s.last, "tokens": s.tokens,
                "avgMs": crate::metrics::avg(s.latency_sum, s.latency_n)})
        })
        .collect();
    apps.sort_by_key(|x| std::cmp::Reverse(x["requests"].as_i64().unwrap_or(0)));
    ok(json!({"ok": true, "apps": apps}))
}

/// Per-account totals and 7 days of hourly buckets, with names from the engine.
async fn stats_accounts() -> Res {
    let (stats, hourly) = app().metrics.account_stats();
    let accounts = crate::limits::accounts(false).await.unwrap_or_default();
    let row = |idx: &str, acc: Option<&crate::limits::Account>| {
        let s = stats.get(idx).cloned().unwrap_or_default();
        let hours: Vec<Value> = hourly
            .get(idx)
            .map(|h| {
                let mut v: Vec<(i64, &crate::metrics::HourBucket)> = h.iter().filter_map(|(k, b)| k.parse::<i64>().ok().map(|t| (t, b))).collect();
                v.sort_by_key(|(t, _)| *t);
                v.into_iter().map(|(t, b)| json!({"t": t, "ok": b.ok, "failed": b.failed, "tokens": b.tokens})).collect()
            })
            .unwrap_or_default();
        json!({
            "authIndex": idx,
            "name": acc.map(|a| a.name.as_str()).unwrap_or(""),
            "label": acc.map(|a| a.label.as_str()).unwrap_or(idx),
            "provider": acc.map(|a| a.provider.as_str()).unwrap_or(""),
            "state": acc.map(|a| a.state.as_str()).unwrap_or("gone"),
            "priority": acc.map_or(0, |a| a.priority),
            "weight": acc.map_or(1, |a| a.weight),
            "gone": acc.is_none(),
            "requests": s.requests, "failed": s.failed, "tokens": s.tokens, "last": s.last,
            "avgMs": crate::metrics::avg(s.latency_sum, s.latency_n),
            "hourly": hours,
        })
    };
    let mut out: Vec<Value> = accounts.iter().filter(|a| !a.auth_index.is_empty()).map(|a| row(&a.auth_index, Some(a))).collect();
    let known: std::collections::HashSet<&str> = accounts.iter().map(|a| a.auth_index.as_str()).collect();
    out.extend(stats.keys().filter(|k| !known.contains(k.as_str())).map(|k| row(k, None)));
    ok(json!({"ok": true, "accounts": out}))
}

/// Turns an account into a provider entry carrying its real model list.
pub async fn account_to_provider_pub(body: Bytes) -> Res {
    account_to_provider(body).await
}

async fn account_to_provider(body: Bytes) -> Res {
    let v = match parse_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let name = v.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if name.is_empty() {
        return bad("name is required");
    }
    let auto = v.get("auto").and_then(Value::as_bool).unwrap_or(false);
    let id = account_provider_id(&name);
    let a = app();
    if auto {
        let cfg = a.config();
        if cfg.hidden_accounts.contains(&id) {
            return ok(json!({"ok": true, "id": id, "skipped": "hidden"}));
        }
        if cfg.providers.iter().any(|p| p.id == id) {
            return ok(json!({"ok": true, "id": id, "skipped": "exists"}));
        }
    }
    let path = format!("/v0/management/auth-files/models?name={}", percent_encoding::utf8_percent_encode(&name, percent_encoding::NON_ALPHANUMERIC));
    let r = a.mgmt_get(&path).await;
    let models: Vec<String> = if r.ok() {
        r.json()
            .get("models")
            .and_then(Value::as_array)
            .map(|m| m.iter().filter_map(|x| x.get("id").and_then(Value::as_str)).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
            .unwrap_or_default()
    } else {
        vec![]
    };
    let n = models.len();
    let fam = account_family(&name);
    let label = format!("{fam} · {}", account_display(&name));
    let id2 = id.clone();
    let res = a.update_config(move |c| {
        if auto && (c.hidden_accounts.contains(&id2) || c.providers.iter().any(|p| p.id == id2)) {
            return Ok(());
        }
        c.hidden_accounts.retain(|h| h != &id2);
        if let Some(p) = c.providers.iter_mut().find(|p| p.id == id2) {
            p.models = models;
        } else {
            c.providers.push(Provider {
                id: id2,
                label,
                base_url: "embedded://cliproxy".into(),
                format: "openai".into(),
                models,
                enabled: true,
                ..Default::default()
            });
        }
        Ok(())
    });
    match res {
        Ok(_) => ok(json!({"ok": true, "id": id, "models": n})),
        Err(e) => fail(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

async fn account_provider_hide(body: Bytes) -> Res {
    let v = match parse_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let id = v.get("id").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if id.is_empty() {
        return bad("id is required");
    }
    match app().update_config(|c| {
        if !c.hidden_accounts.contains(&id) {
            c.hidden_accounts.push(id.clone());
        }
        c.providers.retain(|p| p.id != id);
        Ok(())
    }) {
        Ok(_) => ok(json!({"ok": true})),
        Err(e) => fail(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

/// Fetches <baseUrl>/models from an OpenAI-compatible upstream.
async fn provider_models(body: Bytes) -> Res {
    let v = match parse_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let base = v.get("baseUrl").and_then(Value::as_str).unwrap_or("").trim().trim_end_matches('/').to_string();
    match url::Url::parse(&base) {
        Ok(u) if matches!(u.scheme(), "http" | "https") && u.host_str().is_some() => {}
        _ => return bad("base URL must start with http:// or https://"),
    }
    let mut req = app().web.get(format!("{base}/models")).header("Accept", "application/json");
    if let Some(k) = v.get("apiKey").and_then(Value::as_str).map(str::trim).filter(|k| !k.is_empty()) {
        req = req.bearer_auth(k);
    }
    if let Some(Value::Object(h)) = v.get("headers") {
        for (k, val) in h {
            if let (false, Some(val)) = (k.trim().is_empty(), val.as_str()) {
                req = req.header(k.trim(), val);
            }
        }
    }
    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => return fail(StatusCode::BAD_GATEWAY, e.to_string()),
    };
    let status = resp.status();
    let raw = resp.bytes().await.unwrap_or_default();
    if !status.is_success() {
        let msg = crate::util::truncate_chars(String::from_utf8_lossy(&raw).trim(), 300);
        return fail(StatusCode::BAD_GATEWAY, format!("upstream {}: {msg}", status.as_u16()));
    }
    ok(json!({"ok": true, "models": parse_model_ids(&raw)}))
}

pub fn parse_model_ids(raw: &[u8]) -> Vec<String> {
    let Ok(v) = serde_json::from_slice::<Value>(raw) else { return vec![] };
    let items = match &v {
        Value::Array(a) => a.clone(),
        Value::Object(o) => ["data", "models", "items"].iter().find_map(|k| o.get(*k).and_then(Value::as_array).cloned()).unwrap_or_default(),
        _ => vec![],
    };
    let mut out: Vec<String> = items
        .iter()
        .filter_map(|it| match it {
            Value::String(s) => Some(s.trim().to_string()),
            Value::Object(m) => m.get("id").or_else(|| m.get("name")).and_then(Value::as_str).map(|s| s.trim().to_string()),
            _ => None,
        })
        .filter(|s| !s.is_empty())
        .collect();
    out.sort();
    out.dedup();
    out
}

// ------------------------------------------------------ management passthrough ----

async fn mgmt_passthrough(req: Request) -> Res {
    // The raw path: Path<String> would decode %2F / %3F and change the engine URL.
    let path = req.uri().path().split_once("/cliproxy/api/").map(|(_, p)| p.to_string()).unwrap_or_default();
    let method = req.method().clone();
    let query = req.uri().query().map(|q| format!("?{q}")).unwrap_or_default();
    let ctype = req.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(str::to_string);
    let body = if method == Method::GET {
        None
    } else {
        match axum::body::to_bytes(req.into_body(), 64 << 20).await {
            Ok(b) if !b.is_empty() => Some(b),
            Ok(_) => None,
            Err(e) => return bad(e.to_string()),
        }
    };
    let m = reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap_or(reqwest::Method::GET);
    let r = app().mgmt(m, &format!("/v0/management/{path}{query}"), body, ctype.as_deref()).await;
    if !method.eq(&Method::GET) {
        app().emit(LiveEvent::Changed { what: "engine".into() });
    }
    let mut resp = Response::new(axum::body::Body::from(r.body));
    *resp.status_mut() = StatusCode::from_u16(r.status).unwrap_or(StatusCode::BAD_GATEWAY);
    if let Ok(v) = HeaderValue::from_str(&r.ctype) {
        resp.headers_mut().insert(header::CONTENT_TYPE, v);
    }
    resp
}

// ------------------------------------------------------------------ OAuth ----

fn state_ok(s: &str) -> bool {
    !s.is_empty() && s.len() <= 128 && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

async fn oauth_start(body: Bytes) -> Res {
    let v = match parse_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let provider = v.get("provider").and_then(Value::as_str).unwrap_or("").trim().to_ascii_lowercase();
    if provider.is_empty() || !provider.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_')) {
        return bad("provider is required");
    }
    let mut path = format!("/v0/management/{provider}-auth-url");
    if matches!(provider.as_str(), "anthropic" | "codex" | "antigravity") {
        path.push_str("?is_webui=true");
    }
    let a = app();
    let r = a.mgmt_get(&path).await;
    if !r.ok() {
        return fail(StatusCode::from_u16(r.status).unwrap_or(StatusCode::BAD_GATEWAY), crate::util::error_message_from_body(&r.body));
    }
    let mut full = r.json();
    let url = full.get("url").and_then(Value::as_str).unwrap_or("").to_string();
    if url.is_empty() {
        let e = full.get("error").and_then(Value::as_str).unwrap_or("Не вдалося згенерувати посилання для входу").to_string();
        return bad(e);
    }
    // Plugin logins may answer with a path on the engine itself.
    let url = if url.starts_with('/') { format!("{}{url}", a.public_base()) } else { url };
    full["url"] = json!(url);
    if v.get("noBrowser").and_then(Value::as_bool) != Some(true) {
        // The previous sign-in window must be gone first: Chrome/Edge would hand
        // the new URL to it (same profile) and the new process would exit.
        a.set_oauth_child(None);
        a.set_oauth_child(crate::browser::open_clean(&url));
    }
    (StatusCode::OK, axum::Json(full)).into_response()
}

async fn oauth_status(Query(q): Query<HashMap<String, String>>) -> Res {
    let state = q.get("state").cloned().unwrap_or_default();
    if !state_ok(&state) {
        return bad("bad state");
    }
    let a = app();
    let r = a.mgmt_get(&format!("/v0/management/get-auth-status?state={state}")).await;
    if r.ok() {
        let v = r.json();
        let st = v.get("status").and_then(Value::as_str).unwrap_or("");
        if st == "ok" || st == "success" || v.get("completed").and_then(Value::as_bool) == Some(true) {
            a.set_oauth_child(None);
            a.emit(LiveEvent::Changed { what: "accounts".into() });
        }
    }
    let mut resp = Response::new(axum::body::Body::from(r.body));
    *resp.status_mut() = StatusCode::from_u16(r.status).unwrap_or(StatusCode::BAD_GATEWAY);
    resp.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    resp
}

async fn oauth_cancel(Query(q): Query<HashMap<String, String>>) -> Res {
    let state = q.get("state").cloned().unwrap_or_default();
    if !state_ok(&state) {
        return bad("bad state");
    }
    let a = app();
    a.set_oauth_child(None);
    let r = a.mgmt(reqwest::Method::DELETE, &format!("/v0/management/oauth-session?state={state}"), None, None).await;
    (StatusCode::from_u16(r.status).unwrap_or(StatusCode::BAD_GATEWAY), r.body).into_response()
}

async fn oauth_close() -> Res {
    app().set_oauth_child(None);
    ok(json!({"ok": true}))
}

// -------------------------------------------------------------------- app ----

async fn app_ping() -> Res {
    ok(json!({"app": paths::APP_NAME, "home": paths::home().to_string_lossy(), "version": VERSION}))
}

async fn app_show() -> Res {
    match app().desktop() {
        Some(d) => d.show_main(),
        None => crate::browser::open_default(&format!("{}/ui/", app().public_base())),
    }
    ok(json!({"ok": true}))
}

async fn app_quit() -> Res {
    if let Some(d) = app().desktop() {
        d.quit();
    } else {
        tokio::spawn(async {
            tokio::time::sleep(Duration::from_millis(300)).await;
            crate::shutdown().await;
            std::process::exit(0);
        });
    }
    ok(json!({"ok": true}))
}

fn app_settings() -> Value {
    let a = app();
    let cfg = a.config();
    let d = a.desktop();
    json!({
        "ok": true,
        "platform": std::env::consts::OS,
        "autostart": crate::autostart::enabled(),
        "closeToTray": cfg.desktop.close_to_tray,
        "startHidden": cfg.desktop.start_hidden,
        "trayAvailable": d.is_some_and(|d| d.tray_available()),
        "lang": cfg.desktop.lang,
        "theme": if cfg.desktop.theme.is_empty() { "console" } else { cfg.desktop.theme.as_str() },
        "switcher": cfg.desktop.switcher.enabled,
        "switcherAvailable": d.is_some_and(|d| d.switcher_available()),
        "accounts": cfg.accounts,
        "home": paths::home().to_string_lossy(),
    })
}

async fn app_settings_get() -> Res {
    ok(app_settings())
}

async fn app_settings_put(body: Bytes) -> Res {
    let v = match parse_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    if let Some(t) = v.get("theme").and_then(Value::as_str)
        && !config::valid_theme(t)
    {
        return bad("unknown theme");
    }
    if let Some(on) = v.get("autostart").and_then(Value::as_bool)
        && let Err(e) = crate::autostart::set(on)
    {
        return fail(StatusCode::INTERNAL_SERVER_ERROR, format!("автозапуск: {e}"));
    }
    let a = app();
    let lang_changed = v.get("lang").is_some();
    let r = a.update_config(|c| {
        if let Some(x) = v.get("closeToTray").and_then(Value::as_bool) {
            c.desktop.close_to_tray = x;
        }
        if let Some(x) = v.get("startHidden").and_then(Value::as_bool) {
            c.desktop.start_hidden = x;
        }
        if let Some(x) = v.get("lang").and_then(Value::as_str) {
            c.desktop.lang = x.to_string();
        }
        if let Some(x) = v.get("theme").and_then(Value::as_str) {
            c.desktop.theme = if x == "console" { String::new() } else { x.to_string() };
        }
        if let Some(x) = v.get("switcher").and_then(Value::as_bool) {
            c.desktop.switcher.enabled = x;
        }
        if let Some(acc) = v.get("accounts") {
            if let Some(x) = acc.get("autoClean").and_then(Value::as_bool) {
                c.accounts.auto_clean = x;
            }
            if let Some(x) = acc.get("autoCleanHours").and_then(Value::as_u64) {
                c.accounts.auto_clean_hours = x.clamp(1, 24 * 30) as u32;
            }
        }
        Ok(())
    });
    if let Err(e) = r {
        return fail(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    if let Some(d) = a.desktop() {
        if let Some(x) = v.get("switcher").and_then(Value::as_bool) {
            d.set_switcher(x);
        }
        if lang_changed {
            d.lang_changed();
        }
    }
    ok(app_settings())
}

async fn app_open(body: Bytes) -> Res {
    let v = match parse_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let p = match v.get("what").and_then(Value::as_str).unwrap_or("data") {
        "logs" => paths::logs_dir(),
        "auths" => paths::auth_dir(),
        "plugins" => paths::plugins_dir(),
        _ => paths::home().to_path_buf(),
    };
    let _ = std::fs::create_dir_all(&p);
    crate::browser::open_path(&p);
    ok(json!({"ok": true}))
}

// ------------------------------------------------------------- routing ----

fn clean_model(m: &str) -> String {
    config::strip_provider_prefix(None, m.trim())
}

async fn apply_all(body: Bytes) -> Res {
    let v = match parse_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let model = clean_model(v.get("model").and_then(Value::as_str).unwrap_or(""));
    if model.is_empty() {
        return bad("model is empty");
    }
    match app().update_config(|c| {
        c.routing.apply_all(&model);
        let sw = &mut c.desktop.switcher;
        sw.active = if !sw.model1.is_empty() && clean_model(&sw.model1).eq_ignore_ascii_case(&model) {
            1
        } else if !sw.model2.is_empty() && clean_model(&sw.model2).eq_ignore_ascii_case(&model) {
            2
        } else {
            0
        };
        sw.auto_armed = sw.auto_switch && sw.active == 1;
        Ok(())
    }) {
        Ok(c) => ok(json!({"ok": true, "routing": c.routing})),
        Err(e) => fail(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

fn switcher_state(cfg: &Config) -> Value {
    let sw = &cfg.desktop.switcher;
    json!({
        "ok": true, "enabled": sw.enabled, "model1": sw.model1, "model2": sw.model2, "active": sw.active,
        "autoSwitch": sw.auto_switch, "autoArmed": sw.auto_armed, "current": current_main_model(cfg),
        "lang": cfg.desktop.lang, "theme": cfg.desktop.theme,
        "available": app().desktop().is_some_and(|d| d.switcher_available()),
    })
}

async fn switcher_get() -> Res {
    ok(switcher_state(&app().config()))
}

async fn switcher_put(body: Bytes) -> Res {
    let v = match parse_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let a = app();
    let r = a.update_config(|c| {
        let sw = &mut c.desktop.switcher;
        if let Some(m) = v.get("model1").and_then(Value::as_str) {
            sw.model1 = clean_model(m);
            if sw.active == 1 && !sw.model1.is_empty() {
                let m = sw.model1.clone();
                c.routing.apply_all(&m);
            }
        }
        let sw = &mut c.desktop.switcher;
        if let Some(m) = v.get("model2").and_then(Value::as_str) {
            sw.model2 = clean_model(m);
            if sw.active == 2 && !sw.model2.is_empty() {
                let m = sw.model2.clone();
                c.routing.apply_all(&m);
            }
        }
        let sw = &mut c.desktop.switcher;
        if let Some(e) = v.get("enabled").and_then(Value::as_bool) {
            sw.enabled = e;
        }
        if let Some(x) = v.get("autoSwitch").and_then(Value::as_bool) {
            sw.auto_switch = x;
            sw.auto_armed = x && sw.active == 1;
        }
        Ok(())
    });
    match r {
        Ok(c) => {
            if let (Some(e), Some(d)) = (v.get("enabled").and_then(Value::as_bool), a.desktop()) {
                d.set_switcher(e);
            }
            ok(switcher_state(&c))
        }
        Err(e) => fail(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

async fn switcher_switch(body: Bytes) -> Res {
    let v = parse_body(&body).unwrap_or(json!({}));
    let to = v.get("to").and_then(Value::as_u64).unwrap_or(0) as u8;
    match app().update_config(|c| {
        let sw = &c.desktop.switcher;
        let to = if to == 1 || to == 2 {
            to
        } else if sw.active == 1 {
            2
        } else {
            1
        };
        let model = if to == 2 { sw.model2.clone() } else { sw.model1.clone() };
        if model.is_empty() {
            return Err(format!("model {to} is not selected"));
        }
        c.routing.apply_all(&model);
        let sw = &mut c.desktop.switcher;
        sw.active = to;
        sw.auto_armed = sw.auto_switch && to == 1;
        Ok(())
    }) {
        Ok(c) => ok(switcher_state(&c)),
        Err(e) => bad(e),
    }
}

/// Moves the switcher to preset 2 after the first request preset 1 answered
/// successfully (one-shot; applying preset 1 again re-arms it).
pub fn switcher_auto_advance(resolved: &str) {
    let a = app();
    let cfg = a.config();
    let sw = &cfg.desktop.switcher;
    if !sw.auto_switch || !sw.auto_armed || sw.active != 1 || sw.model2.is_empty() {
        return;
    }
    // Compare base names: a thinking suffix "(high)" is the same model.
    let m1 = crate::util::base_model_name(&clean_model(&sw.model1));
    if !m1.is_empty() && !resolved.is_empty() && !m1.eq_ignore_ascii_case(&crate::util::base_model_name(&clean_model(resolved))) {
        return;
    }
    let r = a.update_config(|c| {
        let s = &c.desktop.switcher;
        if !s.auto_switch || !s.auto_armed || s.active != 1 || s.model2.is_empty() {
            return Err("raced".into());
        }
        let m2 = s.model2.clone();
        c.routing.apply_all(&m2);
        c.desktop.switcher.active = 2;
        c.desktop.switcher.auto_armed = false;
        Ok(())
    });
    if r.is_ok() {
        tracing::info!("switcher: first answer from {} — switched everything to {}", sw.model1, sw.model2);
    }
}

// ----------------------------------------------------------------- models ----

async fn model_info() -> Res {
    ok(json!({"ok": true, "models": &*app().caps.all()}))
}

async fn model_context(Query(q): Query<HashMap<String, String>>) -> Res {
    let a = app();
    let model = q.get("model").map(|s| s.trim().to_string()).unwrap_or_default();
    let mut resolved = a.resolve(&model);
    if resolved.is_empty() {
        resolved = model.clone();
    }
    let c = a.caps.get(&resolved);
    ok(json!({"ok": true, "model": model, "resolved": resolved, "context": c.context, "maxOutput": c.max_output}))
}

async fn engine_models() -> Res {
    let a = app();
    a.refresh_catalog().await;
    let cat = a.catalog.load();
    ok(json!({"ok": true, "models": cat.ids, "at": cat.at}))
}

/// Sends a tiny request to a model through the engine and reports how it went.
async fn test_model(body: Bytes) -> Res {
    let v = match parse_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let want = v.get("model").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if want.is_empty() {
        return bad("model is empty");
    }
    let a = app();
    let resolved = a.resolve(&want);
    let started = std::time::Instant::now();
    let r = a
        .local
        .post(format!("{}/v1/chat/completions", a.engine.base_url()))
        .bearer_auth(&a.engine.internal_key)
        .timeout(Duration::from_secs(90))
        .json(&json!({"model": resolved, "stream": false, "max_tokens": 32, "messages": [{"role": "user", "content": "Reply with the single word: OK"}]}))
        .send()
        .await;
    let ms = started.elapsed().as_millis() as u64;
    match r {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let body = resp.bytes().await.unwrap_or_default();
            if (200..300).contains(&status) {
                let v: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
                let text = v.pointer("/choices/0/message/content").and_then(Value::as_str).unwrap_or("").trim().to_string();
                ok(json!({"ok": true, "model": want, "resolved": resolved, "ms": ms, "reply": crate::util::truncate_chars(&text, 200)}))
            } else {
                ok(
                    json!({"ok": false, "model": want, "resolved": resolved, "ms": ms, "status": status, "error": crate::util::error_message_from_body(&body)}),
                )
            }
        }
        Err(e) => ok(json!({"ok": false, "model": want, "resolved": resolved, "ms": ms, "error": e.to_string()})),
    }
}

// ------------------------------------------------------- errors / metrics ----

async fn errors_get(Query(q): Query<HashMap<String, String>>) -> Res {
    let a = app();
    let limit = q.get("limit").and_then(|l| l.parse().ok()).unwrap_or(200usize);
    ok(json!({"ok": true, "total": a.errlog.total(), "last24h": a.errlog.count_since(now_ms() - 86_400_000), "errors": a.errlog.list(limit)}))
}

async fn errors_clear() -> Res {
    app().errlog.clear();
    app().emit(LiveEvent::Changed { what: "errors".into() });
    ok(json!({"ok": true}))
}

/// The statistics with each model's average answer and first-token times
/// (avg_latency_ms, avg_ttft_ms; 0 = not reported).
fn metrics_value(s: &crate::metrics::MetricsState) -> Value {
    let mut v = serde_json::to_value(s).unwrap_or(json!({}));
    if let Some(Value::Object(models)) = v.get_mut("model_stats") {
        for (name, m) in models.iter_mut() {
            if let (Some(st), Value::Object(o)) = (s.model_stats.get(name), m) {
                o.insert("avg_latency_ms".into(), json!(crate::metrics::avg(st.latency_sum, st.latency_n)));
                o.insert("avg_ttft_ms".into(), json!(crate::metrics::avg(st.ttft_sum, st.ttft_n)));
            }
        }
    }
    v
}

async fn metrics_get() -> Res {
    ok(json!({"ok": true, "metrics": metrics_value(&app().metrics.snapshot())}))
}

/// Everything but the history: cheap enough to poll.
async fn metrics_summary() -> Res {
    let mut s = app().metrics.snapshot();
    s.history.truncate(60);
    ok(json!({"ok": true, "metrics": metrics_value(&s)}))
}

async fn metrics_clear() -> Res {
    app().metrics.clear();
    app().emit(LiveEvent::Changed { what: "metrics".into() });
    ok(json!({"ok": true}))
}

// ------------------------------------------------------------ UI prefs ----

async fn ui_prefs_get() -> Res {
    ok(json!({"ok": true, "prefs": app().config().ui}))
}

async fn ui_prefs_put(body: Bytes) -> Res {
    if body.len() > 512 * 1024 {
        return bad("too large");
    }
    let v = match parse_body(&body) {
        Ok(Value::Object(m)) => Value::Object(m),
        Ok(_) => return bad("prefs must be an object"),
        Err(r) => return r,
    };
    match app().update_config(|c| {
        c.ui = v;
        Ok(())
    }) {
        Ok(_) => ok(json!({"ok": true})),
        Err(e) => fail(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

// ------------------------------------------------------------ logs / live ----

async fn logs_get(Query(q): Query<HashMap<String, String>>) -> Res {
    let lines = q.get("lines").and_then(|l| l.parse().ok()).unwrap_or(300usize).min(5000);
    let text = std::fs::read(paths::app_log()).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
    let all: Vec<&str> = text.lines().collect();
    let tail = all[all.len().saturating_sub(lines)..].join("\n");
    ok(json!({"ok": true, "path": paths::app_log().to_string_lossy(), "text": tail}))
}

async fn events() -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = app().events.subscribe();
    let stream = futures_util::stream::unfold(rx, |mut rx| async move {
        let e = match rx.recv().await {
            Ok(ev) => Event::default().json_data(&ev).unwrap_or_else(|_| Event::default().data("{}")),
            // Too slow to keep up: tell the page to reload everything.
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => Event::default().data(r#"{"type":"changed","what":"all"}"#),
            Err(tokio::sync::broadcast::error::RecvError::Closed) => return None,
        };
        Some((Ok(e), rx))
    });
    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_ids_match_2x() {
        assert_eq!(account_provider_id("antigravity-me@gmail.com.json"), "cp-antigravity-me-gmail-com");
        assert_eq!(account_family("codex-a-b.json"), "codex");
        assert_eq!(account_display("codex-a-b.json"), "a-b");
    }

    #[test]
    fn merge_patch_rfc7386() {
        let mut t = json!({"a": 1, "b": {"c": 2, "d": 3}});
        merge_patch(&mut t, &json!({"b": {"c": null, "e": 4}, "f": [1]}));
        assert_eq!(t, json!({"a": 1, "b": {"d": 3, "e": 4}, "f": [1]}));
    }

    #[test]
    fn scoped_limits_form() {
        let mut k = ScopedKey::default();
        assert!(!read_scoped_limits(&json!({"name": "x"}), &mut k).unwrap_or(true));
        assert!(
            read_scoped_limits(&json!({"rpm": 10, "dailyRequests": 500, "expires": 1_900_000_000_000_i64, "note": " phone "}), &mut k)
                .unwrap_or(false)
        );
        assert_eq!((k.rpm, k.daily_requests, k.expires, k.note.as_str()), (10, 500, 1_900_000_000_000, "phone"));
        assert!(read_scoped_limits(&json!({"rpm": -1}), &mut k).is_err());
        assert!(read_scoped_limits(&json!({"expires": "soon"}), &mut k).is_err());
        assert_eq!(k.rpm, 10, "a refused form changes nothing it did not accept");
    }

    #[test]
    fn tuning_values() {
        assert_eq!(tuning_value(Tune::Int, "requestRetry", &json!(3)).ok(), Some(json!(3)));
        assert!(tuning_value(Tune::Int, "requestRetry", &json!(-1)).is_err());
        assert!(tuning_value(Tune::Bool, "switchProject", &json!(1)).is_err());
        assert_eq!(tuning_value(Tune::Strategy, "routingStrategy", &json!(" Fill-First ")).ok(), Some(json!("fill-first")));
        assert!(tuning_value(Tune::Strategy, "routingStrategy", &json!("random")).is_err());
    }

    #[test]
    fn metrics_with_averages() {
        let mut s = crate::metrics::MetricsState::default();
        s.model_stats.insert("m".into(), crate::metrics::ModelStat { latency_sum: 300, latency_n: 3, ..Default::default() });
        let v = metrics_value(&s);
        assert_eq!(v["model_stats"]["m"]["avg_latency_ms"], 100);
        assert_eq!(v["model_stats"]["m"]["avg_ttft_ms"], 0);
    }

    #[test]
    fn model_ids() {
        assert_eq!(parse_model_ids(br#"{"data":[{"id":"b"},{"id":"a"},{"id":"a"}]}"#), vec!["a", "b"]);
        assert_eq!(parse_model_ids(br#"["x"]"#), vec!["x"]);
    }
}
