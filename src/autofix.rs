//! Things CarteLink fixes by itself after an upstream error.

use std::time::Duration;

use reqwest::Method;
use serde_json::{Value, json};

use crate::app::app;
use crate::errlog::ErrorEntry;
use crate::util::{base_model_name, parse_time_ms};

static AUTOHIDE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Which account type refused a model its plan lacks (Kiro lists all its
/// models to every account and answers INVALID_MODEL_ID at request time).
pub fn rejected_model_provider(message: &str) -> Option<&'static str> {
    let m = message.to_ascii_lowercase();
    (m.contains("invalid_model_id") && m.contains("kiro ")).then_some("kiro")
}

/// Hides `model` for `provider` (the same list as Accounts → models → hide,
/// so it can be undone there); the next request goes to an account that has it.
pub async fn auto_hide_model(provider: &str, model: &str) {
    let model = base_model_name(model);
    if provider.is_empty() || model.is_empty() {
        return;
    }
    let a = app();
    let _g = AUTOHIDE.lock().await;
    let r = a.mgmt_get("/v0/management/oauth-excluded-models").await;
    if !r.ok() {
        return;
    }
    let v = r.json();
    let list: Vec<String> = v
        .get("oauth-excluded-models")
        .and_then(|m| m.get(provider))
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default();
    if list.iter().any(|m| m.trim().eq_ignore_ascii_case(&model)) {
        return;
    }
    let mut models = list;
    models.push(model.clone());
    let r = a.mgmt_json(Method::PATCH, "/v0/management/oauth-excluded-models", &json!({"provider": provider, "models": models})).await;
    if r.ok() {
        a.log_error(ErrorEntry {
            kind: "auto".into(),
            model: model.clone(),
            message: format!("model {model} is not available on the {provider} account(s) — CarteLink hid it for {provider}"),
            ..Default::default()
        });
    }
}

pub fn is_content_filter_error(message: &str) -> bool {
    let m = message.to_ascii_lowercase();
    m.contains("content_filter") || m.contains("content filter")
}

/// The engine cools a key down after any upstream failure, so one refused
/// request would make the next ones fail with auth_unavailable. Find the key
/// that served it (usage records carry its auth_index) and lift the cooldown.
pub async fn unblock_after_content_filter(model: &str) {
    let model = base_model_name(model);
    if model.is_empty() {
        return;
    }
    let a = app();
    let since = crate::util::now_ms() - 60_000;
    for _ in 0..6 {
        tokio::time::sleep(Duration::from_secs(3)).await;
        let snap = a.metrics.snapshot();
        for rec in &snap.history {
            let failed = rec.get("failed").and_then(Value::as_bool).unwrap_or(false);
            let idx = rec.get("auth_index").and_then(Value::as_str).unwrap_or("");
            let rec_model =
                ["model", "alias", "response_model"].iter().find_map(|k| rec.get(*k).and_then(Value::as_str).filter(|s| !s.is_empty())).unwrap_or("");
            if !failed || idx.is_empty() || !base_model_name(rec_model).eq_ignore_ascii_case(&model) {
                continue;
            }
            let ts = rec.get("timestamp").and_then(Value::as_str).map(parse_time_ms).unwrap_or(0);
            if ts > 0 && ts < since {
                continue;
            }
            let r = a.mgmt_json(Method::POST, "/v0/management/reset-quota", &json!({"auth_index": idx})).await;
            if r.ok() {
                a.log_error(ErrorEntry {
                    kind: "auto".into(),
                    model: model.clone(),
                    message: format!("the provider's content filter refused one request for {model} — CarteLink kept the key available"),
                    ..Default::default()
                });
            }
            return;
        }
    }
}
