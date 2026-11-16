//! Control API for the 3.0 features that live outside the gateway path:
//! one-click client setup, backup/restore, account checks, LAN devices (QR),
//! notifications. Merged into /api by api::router (same guard).

use std::collections::HashMap;
use std::time::Duration;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, Query};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde_json::{Value, json};

use crate::app::app;
use crate::backup;
use crate::connect::{self, Gateway};
use crate::devices;
use crate::paths;

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
    match serde_json::from_slice(b) {
        Ok(v @ Value::Object(_)) => Ok(v),
        Ok(_) => Err(bad("JSON object expected")),
        Err(e) => Err(bad(format!("invalid JSON: {e}"))),
    }
}

pub fn router() -> Router {
    Router::new()
        .route("/connect", get(connect_list))
        .route("/connect/{id}", post(connect_apply))
        .route("/connect/{id}/undo", post(connect_undo))
        .route("/backup", get(backup_get))
        .route("/restore", post(restore).layer(DefaultBodyLimit::max(backup::MAX_UPLOAD)))
        .route("/accounts/check", post(accounts_check))
        .route("/accounts/policy", get(policy_get).put(policy_put))
        .route("/devices/lan", get(devices_lan))
        .route("/qr", get(qr))
        .route("/notify", get(notify_get).put(notify_put))
}

// -------------------------------------------------------------- connect ----

/// What programs are pointed at: this gateway's address and the client key.
fn gateway(model: Option<&str>, fast: Option<&str>) -> Gateway {
    let a = app();
    let cfg = a.config();
    let key = if cfg.require_key { cfg.api_key.clone() } else { "any".to_string() };
    let model_chosen = model.is_some_and(|m| !m.is_empty());
    let fast_chosen = fast.is_some_and(|m| !m.is_empty());
    let model = model.filter(|m| !m.is_empty()).unwrap_or(connect::DEFAULT_MODEL).to_string();
    let fast = fast.filter(|m| !m.is_empty()).unwrap_or(connect::DEFAULT_FAST).to_string();
    let resolved = a.resolve(&model);
    let context = a.caps.get(if resolved.is_empty() { &model } else { &resolved }).context;
    Gateway { base: a.public_base(), key, model, fast, context, model_chosen, fast_chosen }
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, Res> {
    tokio::task::spawn_blocking(f).await.map_err(|e| fail(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn connect_list() -> Res {
    let g = gateway(None, None);
    let base = g.base.clone();
    match blocking(move || connect::status(&connect::client_home(), &g)).await {
        Ok(list) => ok(json!({"ok": true, "base": base, "programs": list})),
        Err(r) => r,
    }
}

fn model_arg(v: &Value, key: &str) -> Result<Option<String>, Res> {
    match v.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => {
            let s = s.trim();
            if s.len() > 200 || s.chars().any(char::is_control) {
                return Err(bad(format!("{key}: invalid model name")));
            }
            Ok(Some(s.to_string()))
        }
        Some(_) => Err(bad(format!("{key} must be a string"))),
    }
}

fn connect_note(id: &str) -> &'static str {
    match id {
        "claude-code" => "Перезапусти Claude Code — він підхопить нову адресу й ключ.",
        "opencode" => "Перезапусти OpenCode і вибери модель командою /models.",
        "qwen-code" => "Перезапусти Qwen Code. Модель можна змінити командою /model.",
        "gemini-cli" => "Перезапусти Gemini CLI. При першому запуску обери вхід через «Gemini API key».",
        _ => "",
    }
}

async fn connect_apply(Path(id): Path<String>, body: Bytes) -> Res {
    let Some((id, _, _)) = connect::find(&id) else {
        return fail(StatusCode::NOT_FOUND, format!("unknown program {id}"));
    };
    let v = match parse_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let (model, fast) = match (model_arg(&v, "model"), model_arg(&v, "fastModel")) {
        (Ok(m), Ok(f)) => (m, f),
        (Err(r), _) | (_, Err(r)) => return r,
    };
    let g = gateway(model.as_deref(), fast.as_deref());
    let key = g.key.clone();
    let res = match blocking(move || connect::apply(&connect::client_home(), id, &g)).await {
        Ok(r) => r,
        Err(r) => return r,
    };
    let r = match res {
        Ok(r) => r,
        Err(e) => return bad(e),
    };
    let mut out = json!({"ok": true, "path": r.path, "changed": r.changed, "note": connect_note(id)});
    if id == "codex" {
        // Codex reads the key from an environment variable, not from its file.
        match blocking(move || connect::set_user_env(connect::KEY_ENV, &key)).await {
            Ok(Ok(None)) => {
                out["note"] = json!("Ключ записано в змінну середовища CARTELINK_API_KEY. Відкрий новий термінал і запусти Codex.");
            }
            Ok(Ok(Some(line))) => {
                out["note"] = json!(
                    "Codex бере ключ зі змінної середовища CARTELINK_API_KEY. Додай цей рядок у ~/.zshrc або ~/.bashrc і відкрий новий термінал."
                );
                out["exportLine"] = json!(line);
            }
            Ok(Err(e)) => {
                out["note"] = json!(format!("Файл записано, але змінну CARTELINK_API_KEY задати не вдалось: {e}"));
                out["envError"] = json!(true);
            }
            Err(r) => return r,
        }
    }
    ok(out)
}

async fn connect_undo(Path(id): Path<String>) -> Res {
    let Some((id, _, _)) = connect::find(&id) else {
        return fail(StatusCode::NOT_FOUND, format!("unknown program {id}"));
    };
    match blocking(move || connect::undo(&connect::client_home(), id)).await {
        Ok(Ok(r)) => ok(json!({"ok": true, "path": r.path, "changed": r.changed, "note": "Повернуто файл, який був до CarteLink."})),
        Ok(Err(e)) => bad(e),
        Err(r) => r,
    }
}

// ------------------------------------------------------- backup/restore ----

/// Ids of the plugins installed in the engine (empty while it is down).
async fn installed_plugins() -> Vec<String> {
    let a = app();
    if !a.engine.running() {
        return vec![];
    }
    a.mgmt_get("/v0/management/plugins")
        .await
        .json()
        .get("plugins")
        .and_then(Value::as_array)
        .map(|l| l.iter().filter_map(|p| p.get("id").and_then(Value::as_str)).map(str::to_string).collect())
        .unwrap_or_default()
}

async fn backup_get() -> Res {
    let plugins = installed_plugins().await;
    let zip = blocking(move || {
        app().metrics.flush();
        backup::build(paths::home(), &plugins)
    })
    .await;
    let data = match zip {
        Ok(Ok(d)) => d,
        Ok(Err(e)) => return fail(StatusCode::INTERNAL_SERVER_ERROR, format!("backup: {e}")),
        Err(r) => return r,
    };
    let name = backup::file_name(jiff::ZonedDateTime::now());
    let mut r = data.into_response();
    let h = r.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/zip"));
    if let Ok(v) = HeaderValue::from_str(&format!("attachment; filename=\"{name}\"")) {
        h.insert(header::CONTENT_DISPOSITION, v);
    }
    r
}

/// Restores a backup: validates it, stops everything, writes the files and
/// starts CarteLink again (the new settings load at start).
async fn restore(body: Bytes) -> Res {
    if body.is_empty() {
        return bad("порожній файл — надішли zip резервної копії");
    }
    let Some(guard) = backup::begin_restore() else {
        return fail(StatusCode::CONFLICT, "Відновлення вже триває.");
    };
    let parsed = match blocking(move || backup::parse(&body)).await {
        Ok(Ok(p)) => p,
        Ok(Err(e)) => return bad(e),
        Err(r) => return r,
    };
    let current_plugins = installed_plugins().await;
    tracing::info!("restore: {} files from a {} backup, restarting", parsed.files.len(), parsed.version);
    crate::shutdown().await;
    let plugins = parsed.plugins.clone();
    let version = parsed.version.clone();
    let written = blocking(move || {
        let home = paths::home();
        // The state being replaced is kept, in case the backup was the wrong one.
        let safety = home.join("data").join("backups").join(format!("before-restore-{}.zip", jiff::ZonedDateTime::now().strftime("%Y%m%d-%H%M%S")));
        if let Ok(z) = backup::build(home, &current_plugins)
            && let Err(e) = paths::write_atomic(&safety, &z)
        {
            tracing::warn!("restore safety copy: {e}");
        }
        backup::write(home, &parsed)
    })
    .await;
    // The engine is stopped either way: start again in any case.
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(700)).await;
        drop(guard);
        backup::restart_app();
    });
    match written {
        Ok(Ok(n)) => ok(json!({"ok": true, "restarting": true, "files": n, "plugins": plugins, "version": version})),
        Ok(Err(e)) => fail(StatusCode::INTERNAL_SERVER_ERROR, format!("restore: {e}")),
        Err(r) => r,
    }
}

// ------------------------------------------------------------- accounts ----

async fn accounts_check() -> Res {
    match crate::tasks::check_accounts().await {
        Ok(r) => ok(json!({"ok": true, "checked": r.checked, "ok_count": r.ok_count, "invalid": r.invalid, "limited": r.limited})),
        Err(e) => fail(StatusCode::SERVICE_UNAVAILABLE, e),
    }
}

fn policy_json() -> Value {
    let p = &app().config().accounts;
    json!({"ok": true, "autoClean": p.auto_clean, "autoCleanHours": p.auto_clean_hours, "checkHours": p.check_hours})
}

async fn policy_get() -> Res {
    ok(policy_json())
}

fn opt_bool(v: &Value, key: &str) -> Result<Option<bool>, Res> {
    match v.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Bool(b)) => Ok(Some(*b)),
        Some(_) => Err(bad(format!("{key} must be true or false"))),
    }
}

fn opt_u32(v: &Value, key: &str, range: std::ops::RangeInclusive<u32>) -> Result<Option<u32>, Res> {
    match v.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(x) => match x.as_u64().and_then(|n| u32::try_from(n).ok()).filter(|n| range.contains(n)) {
            Some(n) => Ok(Some(n)),
            None => Err(bad(format!("{key} must be a whole number {}..{}", range.start(), range.end()))),
        },
    }
}

async fn policy_put(body: Bytes) -> Res {
    let v = match parse_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let (auto_clean, clean_hours, check_hours) =
        match (opt_bool(&v, "autoClean"), opt_u32(&v, "autoCleanHours", 1..=720), opt_u32(&v, "checkHours", 0..=168)) {
            (Ok(a), Ok(b), Ok(c)) => (a, b, c),
            (Err(r), _, _) | (_, Err(r), _) | (_, _, Err(r)) => return r,
        };
    let r = app().update_config(|c| {
        if let Some(x) = auto_clean {
            c.accounts.auto_clean = x;
        }
        if let Some(x) = clean_hours {
            c.accounts.auto_clean_hours = x;
        }
        if let Some(x) = check_hours {
            c.accounts.check_hours = x;
        }
        Ok(())
    });
    match r {
        Ok(_) => ok(policy_json()),
        Err(e) => fail(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

// ---------------------------------------------------------------- notify ----

fn notify_json() -> Value {
    let n = &app().config().notify;
    json!({"ok": true, "enabled": n.enabled, "accountDead": n.account_dead, "limit": n.limit, "engine": n.engine, "fallback": n.fallback})
}

async fn notify_get() -> Res {
    ok(notify_json())
}

async fn notify_put(body: Bytes) -> Res {
    let v = match parse_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let mut vals = [None; 5];
    for (slot, key) in vals.iter_mut().zip(["enabled", "accountDead", "limit", "engine", "fallback"]) {
        match opt_bool(&v, key) {
            Ok(b) => *slot = b,
            Err(r) => return r,
        }
    }
    let r = app().update_config(|c| {
        let n = &mut c.notify;
        for (slot, field) in vals.iter().zip([&mut n.enabled, &mut n.account_dead, &mut n.limit, &mut n.engine, &mut n.fallback]) {
            if let Some(b) = slot {
                *field = *b;
            }
        }
        Ok(())
    });
    match r {
        Ok(_) => ok(notify_json()),
        Err(e) => fail(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

// --------------------------------------------------------------- devices ----

async fn devices_lan() -> Res {
    let (host, port) = app().bound();
    let primary = devices::primary_ipv4();
    let info = devices::lan_info(&host, port, primary);
    let mut v = serde_json::to_value(&info).unwrap_or(Value::Null);
    v["ok"] = json!(true);
    ok(v)
}

async fn qr(Query(q): Query<HashMap<String, String>>) -> Res {
    let text = q.get("text").map(String::as_str).unwrap_or("");
    match devices::qr_svg(text) {
        Ok(svg) => {
            let mut r = svg.into_response();
            r.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("image/svg+xml"));
            r
        }
        Err(e) => bad(e),
    }
}
