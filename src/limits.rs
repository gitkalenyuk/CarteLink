//! Account state and limits in one plain shape for the UI (GET /api/limits,
//! GET /api/accounts). The engine keeps what upstream said about each account:
//! rate-limit headers of the last answer (Codex x-codex-*, Claude
//! anthropic-ratelimit-unified-*), cooldowns and, for plugin accounts, a quota
//! provider. Percentages exist only where the provider reports them.

use std::collections::HashMap;

use reqwest::Method;
use serde::Serialize;
use serde_json::{Value, json};

use crate::app::{App, QuotaEntry, app};
use crate::util::{jint, jstr, now_ms, parse_time_ms};

const WARN_AT: f64 = 80.0;
const QUOTA_TTL_MS: i64 = 5 * 60_000;
const QUOTA_KEEP_MS: i64 = 60 * 60_000;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LimitWindow {
    pub key: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub label: String,
    #[serde(skip_serializing_if = "is_zero")]
    pub minutes: i64,
    pub used_percent: f64,
    #[serde(skip_serializing_if = "is_zero")]
    pub reset_at: i64,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub rolled: bool,
}

fn is_zero(v: &i64) -> bool {
    *v == 0
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitMetric {
    pub label: String,
    pub value: f64,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub unit: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub currency: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub auth_index: String,
    /// The auth file name — what deleting the account needs.
    pub name: String,
    pub provider: String,
    pub label: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub plan: String,
    /// ok | warn | limited | error | invalid | disabled
    pub state: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub message: String,
    #[serde(skip_serializing_if = "is_zero")]
    pub retry_at: i64,
    #[serde(skip_serializing_if = "is_zero")]
    pub observed_at: i64,
    #[serde(skip_serializing_if = "is_zero")]
    pub created_at: i64,
    #[serde(skip_serializing_if = "is_zero")]
    pub last_refresh: i64,
    pub windows: Vec<LimitWindow>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub metrics: Vec<LimitMetric>,
    pub success: i64,
    pub failed: i64,
    pub percent: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub pending: bool,
    pub disabled: bool,
    /// Engine priority: accounts of the highest priority are used first (0 = default).
    pub priority: i64,
    /// Share in the weighted-round-robin strategy (1 = default, 0 = never picked).
    pub weight: i64,
}

fn clamp_pct(v: f64) -> f64 {
    if v.is_nan() || v < 0.0 {
        0.0
    } else if v > 100.0 {
        100.0
    } else {
        (v * 10.0).round() / 10.0
    }
}

fn window_key(minutes: i64, fallback: &str) -> String {
    match minutes {
        290..=310 => "5h".into(),
        10000..=10160 => "week".into(),
        m if m > 0 => "other".into(),
        _ => fallback.into(),
    }
}

fn minutes_label(m: i64) -> String {
    if m % 1440 == 0 {
        format!("{}d", m / 1440)
    } else if m % 60 == 0 {
        format!("{}h", m / 60)
    } else {
        format!("{m}m")
    }
}

fn codex_windows(sig: &HashMap<String, String>, observed: i64) -> Vec<LimitWindow> {
    let mut out = vec![];
    for (name, fallback) in [("primary", "5h"), ("secondary", "week")] {
        let p = format!("x-codex-{name}-");
        let Some(used) = sig.get(&format!("{p}used-percent")).and_then(|v| v.parse::<f64>().ok()) else { continue };
        let minutes = sig.get(&format!("{p}window-minutes")).and_then(|v| v.parse::<i64>().ok()).unwrap_or(0);
        let mut w = LimitWindow { key: window_key(minutes, fallback), minutes, used_percent: clamp_pct(used), ..Default::default() };
        if w.key == "other" {
            w.label = minutes_label(minutes);
        }
        if let Some(at) = sig.get(&format!("{p}reset-at")).and_then(|v| v.parse::<i64>().ok()).filter(|&x| x > 0) {
            w.reset_at = at * 1000;
        } else if let Some(after) = sig.get(&format!("{p}reset-after-seconds")).and_then(|v| v.parse::<f64>().ok()).filter(|&x| x >= 0.0)
            && observed > 0
        {
            w.reset_at = observed + (after * 1000.0) as i64;
        }
        out.push(w);
    }
    out
}

fn claude_windows(sig: &HashMap<String, String>) -> Vec<LimitWindow> {
    const PREFIX: &str = "anthropic-ratelimit-unified-";
    let mut out = vec![];
    for (k, v) in sig {
        let Some(name) = k.strip_prefix(PREFIX).and_then(|r| r.strip_suffix("-utilization")) else { continue };
        let Ok(frac) = v.parse::<f64>() else { continue };
        if name.is_empty() {
            continue;
        }
        let mut w = LimitWindow { used_percent: clamp_pct(frac * 100.0), ..Default::default() };
        match name {
            "5h" => {
                w.key = "5h".into();
                w.minutes = 300;
            }
            "7d" => {
                w.key = "week".into();
                w.minutes = 10080;
            }
            other => {
                w.key = "other".into();
                w.label = other.replace('_', " ");
            }
        }
        if let Some(at) = sig.get(&format!("{PREFIX}{name}-reset")).and_then(|v| v.parse::<i64>().ok()).filter(|&x| x > 0) {
            w.reset_at = at * 1000;
        }
        out.push(w);
    }
    out
}

fn rank(w: &LimitWindow) -> u8 {
    match w.key.as_str() {
        "5h" => 0,
        "week" => 1,
        _ => 2,
    }
}

pub fn looks_like_limit(msg: &str) -> bool {
    let m = msg.to_ascii_lowercase();
    ["quota", "rate limit", "rate_limit", "usage limit", "usage_limit", "429", "too many requests", "exhausted"].iter().any(|s| m.contains(s))
}

/// The sign-in itself was rejected: the account will not come back by waiting.
/// Network trouble never counts (auto-clean deletes accounts for good), and
/// status codes must stand alone ("401", not a request id containing 4013).
pub fn looks_like_auth_failure(msg: &str) -> bool {
    let m = msg.to_ascii_lowercase();
    if ["timeout", "timed out", "dial tcp", "connection", "connect:", "eof", "tls", "dns", "no such host", "network", "proxy", "temporarily"]
        .iter()
        .any(|s| m.contains(s))
    {
        return false;
    }
    let code = |c: &str| {
        m.match_indices(c).any(|(i, _)| {
            let before = m[..i].chars().next_back();
            let after = m[i + c.len()..].chars().next();
            !before.is_some_and(|ch| ch.is_ascii_alphanumeric()) && !after.is_some_and(|ch| ch.is_ascii_alphanumeric())
        })
    };
    if code("401") || code("403") {
        return true;
    }
    [
        "unauthorized",
        "unauthenticated",
        "invalid_grant",
        "invalid grant",
        "invalid token",
        "invalid_token",
        "token expired",
        "token has expired",
        "token is expired",
        "expired token",
        "refresh token is invalid",
        "refresh token expired",
        "refresh_token_expired",
        "revoked",
        "deactivated",
        "suspended",
        "banned",
        "account disabled",
        "account has been disabled",
        "forbidden",
        "permission_denied",
        "re-authenticate",
        "reauthenticate",
        "login required",
        "sign in again",
        "verify your account",
    ]
    .iter()
    .any(|s| m.contains(s))
}

fn first_non_empty<'a>(vals: &[&'a str]) -> &'a str {
    vals.iter().map(|v| v.trim()).find(|v| !v.is_empty()).unwrap_or("")
}

/// Normalizes one engine auth entry. `now` is injected for tests.
pub fn build_account(f: &Value, now: i64) -> Account {
    let mut prov = jstr(f, "provider").trim().to_ascii_lowercase();
    if prov.is_empty() {
        prov = jstr(f, "type").trim().to_ascii_lowercase();
    }
    let name = first_non_empty(&[jstr(f, "name"), jstr(f, "filename"), jstr(f, "id")]).to_string();
    let label = first_non_empty(&[jstr(f, "email"), jstr(f, "account"), jstr(f, "label"), &name]).to_string();
    let plan = f.get("id_token").map(|t| jstr(t, "plan_type")).unwrap_or("").trim().to_string();
    let mut acc = Account {
        id: jstr(f, "id").into(),
        auth_index: jstr(f, "auth_index").into(),
        name,
        provider: prov.clone(),
        label,
        plan,
        message: jstr(f, "status_message").trim().into(),
        success: jint(f.get("success")),
        failed: jint(f.get("failed")),
        created_at: parse_time_ms(jstr(f, "created_at")),
        last_refresh: parse_time_ms(jstr(f, "last_refresh")),
        disabled: f.get("disabled").and_then(Value::as_bool).unwrap_or(false),
        priority: jint(f.get("priority")),
        weight: if f.get("weight").is_some() { jint(f.get("weight")) } else { 1 },
        ..Default::default()
    };
    let mut sig = HashMap::new();
    if let Some(Value::Object(s)) = f.get("quota").and_then(|q| q.get("signals")) {
        for (k, v) in s {
            if let Some(v) = v.as_str() {
                sig.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
            }
        }
    }
    acc.observed_at = f.get("quota").map(|q| parse_time_ms(jstr(q, "observed_at"))).unwrap_or(0);

    let mut reached = false;
    match prov.as_str() {
        "codex" => {
            acc.windows.extend(codex_windows(&sig, acc.observed_at));
            if let Some(p) = sig.get("x-codex-plan-type").filter(|p| !p.is_empty()) {
                acc.plan = p.clone();
            }
            reached = sig.get("x-codex-limit-reached").is_some_and(|v| v.eq_ignore_ascii_case("true"))
                || sig.get("x-codex-allowed").is_some_and(|v| v.eq_ignore_ascii_case("false"));
        }
        "claude" => {
            acc.windows.extend(claude_windows(&sig));
            reached = sig.get("anthropic-ratelimit-unified-status").is_some_and(|v| v.eq_ignore_ascii_case("rejected"));
        }
        _ => {}
    }
    acc.windows.sort_by(|a, b| rank(a).cmp(&rank(b)).then_with(|| a.label.cmp(&b.label)));
    acc.percent = !acc.windows.is_empty();

    // A window that ended after the last answer has started again from zero.
    let mut max_used: f64 = 0.0;
    for w in acc.windows.iter_mut() {
        if w.reset_at > 0 && w.reset_at <= now {
            w.used_percent = 0.0;
            w.reset_at = 0;
            w.rolled = true;
        }
        max_used = max_used.max(w.used_percent);
    }
    let retry = parse_time_ms(jstr(f, "next_retry_after"));
    if retry > now {
        acc.retry_at = retry;
    }

    let status = jstr(f, "status").trim().to_ascii_lowercase();
    let blocked = f.get("unavailable").and_then(Value::as_bool).unwrap_or(false) || status == "error" || status == "unavailable";
    acc.state = if acc.disabled || status == "disabled" {
        "disabled"
    } else if blocked && (acc.retry_at > 0 || max_used >= 100.0 || (reached && max_used >= WARN_AT) || looks_like_limit(&acc.message)) {
        "limited"
    } else if blocked && looks_like_auth_failure(&acc.message) {
        "invalid"
    } else if blocked {
        "error"
    } else if max_used >= 100.0 {
        "limited"
    } else if max_used >= WARN_AT {
        "warn"
    } else {
        "ok"
    }
    .into();
    acc
}

fn apply_plugin_quota(acc: &mut Account, q: &Value, now: i64) {
    if let Some(sub) = q.get("subscription").filter(|s| s.is_object())
        && acc.plan.is_empty()
    {
        acc.plan = first_non_empty(&[jstr(sub, "plan"), jstr(sub, "tierName")]).to_string();
    }
    if let Some(Value::Array(sum)) = q.get("summary") {
        for m in sum {
            let label = jstr(m, "label").trim();
            if label.is_empty() {
                continue;
            }
            acc.metrics.push(LimitMetric {
                label: label.into(),
                value: m.get("value").and_then(Value::as_f64).unwrap_or(0.0),
                unit: jstr(m, "unit").into(),
                currency: jstr(m, "currency").into(),
            });
        }
    }
    let groups = q.get("groups").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut max_used: f64 = 0.0;
    for g in &groups {
        let gname = jstr(g, "displayName");
        for b in g.get("buckets").and_then(Value::as_array).into_iter().flatten() {
            let Some(rem) = b.get("remainingFraction").and_then(Value::as_f64) else { continue };
            let mut label = first_non_empty(&[jstr(b, "window"), jstr(b, "description")]).to_string();
            if !gname.is_empty() && groups.len() > 1 {
                label = format!("{gname} · {label}").trim().to_string();
            }
            let mut w = LimitWindow { key: "other".into(), label, used_percent: clamp_pct((1.0 - rem) * 100.0), ..Default::default() };
            let at = parse_time_ms(jstr(b, "resetTime"));
            if at > now {
                w.reset_at = at;
            }
            max_used = max_used.max(w.used_percent);
            acc.windows.push(w);
        }
    }
    if !acc.windows.is_empty() {
        acc.percent = true;
    }
    match acc.state.as_str() {
        "ok" | "warn" => {
            if max_used >= 100.0 {
                acc.state = "limited".into();
            } else if max_used >= WARN_AT {
                acc.state = "warn".into();
            }
        }
        "error" if max_used >= 100.0 => acc.state = "limited".into(),
        _ => {}
    }
}

/// Cached plugin quota; a stale or missing one starts one background fetch.
fn plugin_quota(a: &App, auth_index: &str, force: bool) -> (Option<Value>, bool) {
    let now = now_ms();
    let mut cache = a.quota.lock().unwrap_or_else(|e| e.into_inner());
    cache.retain(|_, e| e.fetching || now - e.at <= QUOTA_KEEP_MS);
    let e = cache.entry(auth_index.to_string()).or_insert(QuotaEntry { at: 0, quota: None, fetching: false });
    let stale = e.at == 0 || now - e.at > QUOTA_TTL_MS || force;
    if stale && !e.fetching {
        e.fetching = true;
        let idx = auth_index.to_string();
        tokio::spawn(async move {
            let a = app();
            let r = a.mgmt_json(Method::POST, "/v0/management/quota/fetch", &json!({"auth_index": idx})).await;
            let parsed = if r.ok() { Some(r.json()).filter(|v| v.is_object()) } else { None };
            let mut cache = a.quota.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(e) = cache.get_mut(&idx) {
                e.fetching = false;
                e.at = now_ms();
                // A failed refresh keeps the last good answer.
                if parsed.is_some() || e.quota.is_none() {
                    e.quota = parsed;
                }
            }
        });
    }
    (e.quota.clone(), e.fetching && e.at == 0)
}

/// Every account with its state and limits; None while the engine is down.
pub async fn accounts(force: bool) -> Option<Vec<Account>> {
    let a = app();
    let files = a.auth_files().await?;
    let now = now_ms();
    let mut out: Vec<Account> = files
        .iter()
        .map(|f| {
            let mut acc = build_account(f, now);
            if f.get("supports_quota").and_then(Value::as_bool).unwrap_or(false) && !acc.auth_index.is_empty() && acc.state != "disabled" {
                let (q, pending) = plugin_quota(a, &acc.auth_index, force);
                if let Some(q) = q {
                    apply_plugin_quota(&mut acc, &q, now);
                }
                acc.pending = pending;
            }
            acc
        })
        .collect();
    out.sort_by(|x, y| x.provider.cmp(&y.provider).then_with(|| x.label.to_lowercase().cmp(&y.label.to_lowercase())));
    Some(out)
}

pub fn summary(accounts: &[Account]) -> Value {
    let mut s: HashMap<&str, usize> = HashMap::new();
    for a in accounts {
        *s.entry(a.state.as_str()).or_default() += 1;
    }
    let g = |k: &str| s.get(k).copied().unwrap_or(0);
    json!({
        "total": accounts.len(), "ok": g("ok"), "warn": g("warn"), "limited": g("limited"),
        "error": g("error"), "invalid": g("invalid"), "disabled": g("disabled"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000_000;

    #[test]
    fn codex_percentages() {
        let f = json!({"provider":"codex","status":"active","quota":{"observed_at":"2027-01-15T08:00:00Z","signals":{
            "x-codex-primary-used-percent":"85","x-codex-primary-window-minutes":"300",
            "x-codex-secondary-used-percent":"10","x-codex-secondary-window-minutes":"10080"}}});
        let a = build_account(&f, NOW);
        assert_eq!(a.windows.len(), 2);
        assert_eq!(a.windows[0].key, "5h");
        assert_eq!(a.state, "warn");
        assert!(a.percent);
    }

    #[test]
    fn states() {
        let a = build_account(&json!({"provider":"gemini","unavailable":true,"status_message":"429 Too Many Requests"}), NOW);
        assert_eq!(a.state, "limited");
        let a = build_account(&json!({"provider":"gemini","status":"error","status_message":"invalid_grant: token has been revoked"}), NOW);
        assert_eq!(a.state, "invalid");
        let a = build_account(&json!({"provider":"gemini","status":"error","status_message":"connection reset"}), NOW);
        assert_eq!(a.state, "error");
        let a = build_account(&json!({"provider":"gemini","disabled":true}), NOW);
        assert_eq!(a.state, "disabled");
        let a = build_account(&json!({"provider":"gemini","status":"active","name":"antigravity-me@x.json"}), NOW);
        assert_eq!(a.state, "ok");
        assert_eq!(a.label, "antigravity-me@x.json");
    }

    #[test]
    fn priority_and_weight() {
        let a = build_account(&json!({"provider":"codex","priority":5,"weight":3}), NOW);
        assert_eq!((a.priority, a.weight), (5, 3));
        let a = build_account(&json!({"provider":"codex"}), NOW);
        assert_eq!((a.priority, a.weight), (0, 1));
        let a = build_account(&json!({"provider":"codex","weight":0}), NOW);
        assert_eq!(a.weight, 0);
    }

    #[test]
    fn auth_failure_detection_is_strict() {
        assert!(looks_like_auth_failure("HTTP 401 Unauthorized"));
        assert!(looks_like_auth_failure("invalid_grant: token has been revoked"));
        assert!(!looks_like_auth_failure("failed to refresh token: dial tcp 1.2.3.4:443: i/o timeout"));
        assert!(!looks_like_auth_failure("request id req_4031x failed"));
        assert!(!looks_like_auth_failure("429 Too Many Requests"));
    }

    #[test]
    fn window_rolls_over() {
        let f = json!({"provider":"claude","quota":{"signals":{"anthropic-ratelimit-unified-5h-utilization":"1.0","anthropic-ratelimit-unified-5h-reset":"1700000000"}}});
        let a = build_account(&f, NOW);
        assert!(a.windows[0].rolled);
        assert_eq!(a.state, "ok");
    }
}
