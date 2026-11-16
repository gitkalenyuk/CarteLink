//! Client keys. CarteLink checks every key itself; the engine only ever sees
//! its own internal key. Scoped keys (`cl-api-…`) reach only their models.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use axum::http::{Method, Request};
use serde_json::{Map, Value};

use crate::config::{Config, SCOPED_KEY_PREFIX, ScopedKey};
use crate::routing::{CatalogModel, friendly_model_name, is_blacklisted};
use crate::util::{strip_1m, uncloak};

/// Who is calling.
#[derive(Debug, Clone)]
pub enum Ident {
    /// A full-access key ("main" = the gateway key, "extra" = another full key).
    Full(&'static str),
    /// No key needed (key check off) and none / an unknown one given.
    Open,
    Scoped(ScopedKey),
}

impl Ident {
    pub fn scoped(&self) -> Option<&ScopedKey> {
        match self {
            Ident::Scoped(k) => Some(k),
            _ => None,
        }
    }
    /// Id for per-key statistics.
    pub fn stat_id(&self) -> String {
        match self {
            Ident::Full(k) => (*k).to_string(),
            Ident::Open => "open".into(),
            Ident::Scoped(k) => k.id.clone(),
        }
    }
    pub fn label(&self) -> String {
        match self {
            Ident::Scoped(k) => k.name.clone(),
            _ => String::new(),
        }
    }
}

pub enum KeyError {
    Missing,
    Wrong,
    Deleted,
    Disabled(String),
}

/// Every place a client may put its key (the same places the engine reads).
pub fn request_keys<B>(req: &Request<B>) -> Vec<String> {
    let h = req.headers();
    let get = |n: &str| h.get(n).and_then(|v| v.to_str().ok()).map(|s| s.trim().to_string()).unwrap_or_default();
    let mut bearer = get("authorization");
    if let Some((scheme, rest)) = bearer.split_once(' ')
        && scheme.eq_ignore_ascii_case("bearer")
    {
        bearer = rest.trim().to_string();
    }
    let mut out = vec![bearer, get("x-goog-api-key"), get("x-api-key")];
    if let Some(q) = req.uri().query() {
        for (k, v) in url::form_urlencoded::parse(q.as_bytes()) {
            if k == "key" || k == "auth_token" {
                out.push(v.trim().to_string());
            }
        }
    }
    out.retain(|k| !k.is_empty());
    out
}

/// Identifies the caller of a model API request.
pub fn identify<B>(cfg: &Config, req: &Request<B>) -> Result<Ident, KeyError> {
    let keys = request_keys(req);
    // A scoped key wins over anything else in the request, so its limits can
    // never be skipped by adding a full key in a second header.
    for k in &keys {
        if k.starts_with(SCOPED_KEY_PREFIX) {
            return match cfg.find_scoped_key(k) {
                Some(sk) if sk.enabled => Ok(Ident::Scoped(sk.clone())),
                Some(sk) => Err(KeyError::Disabled(sk.name.clone())),
                None => Err(KeyError::Deleted),
            };
        }
    }
    for k in &keys {
        if k == &cfg.api_key {
            return Ok(Ident::Full("main"));
        }
        if cfg.cliproxy.api_keys.iter().any(|x| x == k) {
            return Ok(Ident::Full("extra"));
        }
    }
    if !cfg.require_key {
        return Ok(Ident::Open);
    }
    Err(if keys.is_empty() { KeyError::Missing } else { KeyError::Wrong })
}

/// Whether a scoped key has passed its expiry date (0 = never expires).
pub fn key_expired(sk: &ScopedKey, now_ms: i64) -> bool {
    sk.expires > 0 && now_ms >= sk.expires
}

/// Sliding one-minute window of one key. Records the request and returns Ok
/// when it fits under `rpm`; otherwise Err(unix ms when a slot frees up).
pub fn rpm_take(window: &mut VecDeque<i64>, now_ms: i64, rpm: u32) -> Result<(), i64> {
    while window.front().is_some_and(|&t| t <= now_ms - 60_000) {
        window.pop_front();
    }
    if rpm > 0 && window.len() >= rpm as usize {
        return Err(window.front().map(|t| t + 60_000).unwrap_or(now_ms + 60_000));
    }
    window.push_back(now_ms);
    Ok(())
}

/// Per-key request times of the last minute (in memory only).
static RPM: Mutex<Option<HashMap<String, VecDeque<i64>>>> = Mutex::new(None);

/// Counts one request of `key_id` against its per-minute limit.
pub fn rpm_check(key_id: &str, rpm: u32, now_ms: i64) -> Result<(), i64> {
    if rpm == 0 {
        return Ok(());
    }
    let mut g = RPM.lock().unwrap_or_else(|e| e.into_inner());
    let map = g.get_or_insert_with(HashMap::new);
    // Keys idle for a minute need no window.
    map.retain(|_, w| w.back().is_some_and(|&t| t > now_ms - 60_000));
    rpm_take(map.entry(key_id.to_string()).or_default(), now_ms, rpm)
}

/// Requests of `key_id` within the last minute.
pub fn rpm_used(key_id: &str, now_ms: i64) -> usize {
    let g = RPM.lock().unwrap_or_else(|e| e.into_inner());
    g.as_ref().and_then(|m| m.get(key_id)).map(|w| w.iter().filter(|&&t| t > now_ms - 60_000).count()).unwrap_or(0)
}

/// The local calendar day ("2026-11-16") daily limits count in.
pub fn local_day(now_ms: i64) -> String {
    jiff::Timestamp::from_millisecond(now_ms).map(|t| t.to_zoned_datetime(jiff::tz::TimeZone::system()).date().to_string()).unwrap_or_default()
}

/// Unix ms of the next local midnight (when daily limits start over).
pub fn next_local_midnight(now_ms: i64) -> i64 {
    let tz = jiff::tz::TimeZone::system();
    jiff::Timestamp::from_millisecond(now_ms)
        .ok()
        .and_then(|t| t.to_zoned_datetime(tz.clone()).date().tomorrow().ok())
        .and_then(|d| d.to_zoned_datetime(tz).ok())
        .map(|z| z.timestamp().as_millisecond())
        .unwrap_or(now_ms + 86_400_000)
}

/// "in 42 s", "in 5 min", "in 3 h 20 min" — how long until `at`.
pub fn wait_text(now_ms: i64, at_ms: i64) -> String {
    let secs = ((at_ms - now_ms).max(0) as u64).div_ceil(1000);
    match secs {
        0..=59 => format!("in {secs} s"),
        60..=3599 => format!("in {} min", secs.div_ceil(60)),
        _ => {
            let m = secs.div_ceil(60);
            format!("in {} h {} min", m / 60, m % 60)
        }
    }
}

/// Local wall-clock time of `at_ms` ("14:05" today, "2026-11-17 00:00" otherwise).
pub fn clock_text(now_ms: i64, at_ms: i64) -> String {
    let tz = jiff::tz::TimeZone::system();
    let (Ok(now), Ok(at)) = (jiff::Timestamp::from_millisecond(now_ms), jiff::Timestamp::from_millisecond(at_ms)) else { return String::new() };
    let (now, at) = (now.to_zoned_datetime(tz.clone()), at.to_zoned_datetime(tz));
    if now.date() == at.date() { at.strftime("%H:%M:%S").to_string() } else { at.strftime("%Y-%m-%d %H:%M").to_string() }
}

/// POST routes with the model in a JSON body.
pub fn body_model_path(p: &str) -> bool {
    matches!(
        p,
        "/v1/messages"
            | "/v1/messages/count_tokens"
            | "/v1/chat/completions"
            | "/v1/completions"
            | "/v1/responses"
            | "/v1/responses/compact"
            | "/v1/images/generations"
    )
}

/// The whole API surface of a scoped key: only routes whose model is checked.
pub fn scoped_allowed_path(method: &Method, p: &str) -> bool {
    if method == Method::GET {
        p == "/v1/models" || p == "/models" || p == "/v1beta/models" || p.starts_with("/v1beta/models/")
    } else if method == Method::POST {
        body_model_path(p) || p.starts_with("/v1beta/models/")
    } else {
        false
    }
}

/// The requested model as the engine should get it, if the key allows it.
/// "[1m]", cloaked Claude ids and a "(high)" suffix do not change the model.
pub fn scoped_model_match(sk: &ScopedKey, want: &str) -> Option<String> {
    let name = uncloak(strip_1m(want)).trim().to_string();
    let (base, suffix) = match name.rfind('(') {
        Some(i) if i > 0 && name.ends_with(')') => (name[..i].to_string(), name[i..].to_string()),
        _ => (name.clone(), String::new()),
    };
    sk.models.iter().find(|m| m.eq_ignore_ascii_case(&base)).map(|m| format!("{m}{suffix}"))
}

/// The model of a Gemini path: /v1beta/models/<model>[:<method>].
pub fn gemini_path_model(p: &str) -> String {
    let tail = p.strip_prefix("/v1beta/models/").unwrap_or("");
    let parts: Vec<&str> = tail.split(':').collect();
    if parts.len() <= 2 { parts[0].to_string() } else { String::new() }
}

/// What /v1/models shows a scoped key: its models, described like the engine does.
pub fn scoped_catalog(sk: &ScopedKey, upstream: &[Value]) -> Vec<CatalogModel> {
    let by_id: std::collections::HashMap<String, &Value> =
        upstream.iter().map(|raw| (uncloak(raw.get("id").and_then(Value::as_str).unwrap_or("")).to_ascii_lowercase(), raw)).collect();
    sk.models
        .iter()
        .map(|id| {
            let mut m = CatalogModel { id: id.clone(), display_name: friendly_model_name(id), owned_by: "cartelink".into() };
            if let Some(raw) = by_id.get(&id.to_ascii_lowercase()) {
                if let Some(o) = raw.get("owned_by").and_then(Value::as_str).filter(|s| !s.is_empty()) {
                    m.owned_by = o.into();
                }
                if let Some(n) = raw.get("display_name").and_then(Value::as_str).filter(|s| !s.is_empty() && !s.contains("claude-fable-5-dd")) {
                    m.display_name = n.into();
                }
            }
            m
        })
        .collect()
}

/// Keeps the allowed entries of an engine list in its own format
/// ({"models":[…]}: Gemini "models/<id>" names, Codex "slug").
pub fn filter_model_list(cfg: &Config, sk: &ScopedKey, body: &[u8]) -> Vec<u8> {
    let mut doc: Map<String, Value> = serde_json::from_slice(body).unwrap_or_default();
    let models = match doc.remove("models") {
        Some(Value::Array(a)) => a,
        _ => vec![],
    };
    let kept: Vec<Value> = models
        .into_iter()
        .filter(|m| {
            let id = m.get("slug").and_then(Value::as_str).filter(|s| !s.is_empty()).or_else(|| m.get("name").and_then(Value::as_str)).unwrap_or("");
            let id = id.strip_prefix("models/").unwrap_or(id);
            scoped_model_match(sk, id).is_some() && !is_blacklisted(cfg, id)
        })
        .collect();
    doc.insert("models".into(), Value::Array(kept));
    serde_json::to_vec(&doc).unwrap_or_else(|_| br#"{"models":[]}"#.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::normalize;

    fn cfg() -> Config {
        let mut c: Config = serde_json::from_str(
            r#"{"apiKey":"cl-main","cliproxy":{"apiKeys":["cl-extra"]},"scopedKeys":[{"id":"k1","name":"bot","key":"cl-api-aaa","models":["gpt-5"]},{"id":"k2","name":"off","key":"cl-api-off","models":["x"],"enabled":false}]}"#,
        )
        .unwrap();
        normalize(&mut c);
        c
    }

    fn req(h: &[(&str, &str)], uri: &str) -> Request<()> {
        let mut b = Request::builder().uri(uri);
        for (k, v) in h {
            b = b.header(*k, *v);
        }
        b.body(()).unwrap()
    }

    #[test]
    fn keys_identify() {
        let c = cfg();
        assert!(matches!(identify(&c, &req(&[("authorization", "Bearer cl-main")], "/v1/x")), Ok(Ident::Full("main"))));
        assert!(matches!(identify(&c, &req(&[("x-api-key", "cl-extra")], "/v1/x")), Ok(Ident::Full("extra"))));
        assert!(matches!(identify(&c, &req(&[], "/v1beta/models/x?key=cl-api-aaa")), Ok(Ident::Scoped(_))));
        // A scoped key cannot be widened by also sending the full key.
        assert!(matches!(identify(&c, &req(&[("authorization", "Bearer cl-main"), ("x-api-key", "cl-api-aaa")], "/v1/x")), Ok(Ident::Scoped(_))));
        assert!(matches!(identify(&c, &req(&[("x-api-key", "cl-api-gone")], "/v1/x")), Err(KeyError::Deleted)));
        assert!(matches!(identify(&c, &req(&[("x-api-key", "cl-api-off")], "/v1/x")), Err(KeyError::Disabled(_))));
        assert!(matches!(identify(&c, &req(&[("x-api-key", "nope")], "/v1/x")), Err(KeyError::Wrong)));
        assert!(matches!(identify(&c, &req(&[], "/v1/x")), Err(KeyError::Missing)));
    }

    #[test]
    fn model_match() {
        let c = cfg();
        let sk = &c.scoped_keys[0];
        assert_eq!(scoped_model_match(sk, "GPT-5(high)").as_deref(), Some("gpt-5(high)"));
        assert_eq!(scoped_model_match(sk, "gpt-5[1m]").as_deref(), Some("gpt-5"));
        assert!(scoped_model_match(sk, "gpt-4").is_none());
        assert_eq!(gemini_path_model("/v1beta/models/gpt-5:generateContent"), "gpt-5");
        assert_eq!(gemini_path_model("/v1beta/models/a:b:c"), "");
    }

    #[test]
    fn expiry() {
        let mut sk = ScopedKey { expires: 0, ..Default::default() };
        assert!(!key_expired(&sk, 5));
        sk.expires = 10;
        assert!(!key_expired(&sk, 9));
        assert!(key_expired(&sk, 10));
    }

    #[test]
    fn rpm_window_slides() {
        let mut w = VecDeque::new();
        assert!(rpm_take(&mut w, 1_000, 2).is_ok());
        assert!(rpm_take(&mut w, 2_000, 2).is_ok());
        // Full: the next slot frees when the first request is a minute old.
        assert_eq!(rpm_take(&mut w, 3_000, 2), Err(61_000));
        assert_eq!(w.len(), 2, "a refused request is not counted");
        assert!(rpm_take(&mut w, 61_000, 2).is_ok());
        // No limit: always fits.
        let mut w2 = VecDeque::new();
        for t in 0..100 {
            assert!(rpm_take(&mut w2, t, 0).is_ok());
        }
    }

    #[test]
    fn rpm_per_key() {
        let id = format!("test-{}", crate::util::random_hex(4));
        assert!(rpm_check(&id, 1, 1_000).is_ok());
        assert!(rpm_check(&id, 1, 1_500).is_err());
        assert_eq!(rpm_used(&id, 1_500), 1);
        assert!(rpm_check(&id, 0, 1_500).is_ok());
    }

    #[test]
    fn day_and_wait_texts() {
        let now = 1_800_000_000_000;
        assert_eq!(local_day(now).len(), 10);
        let midnight = next_local_midnight(now);
        assert!(midnight > now && midnight <= now + 25 * 3_600_000);
        assert_ne!(local_day(midnight), local_day(now));
        assert_eq!(local_day(midnight - 1), local_day(now));
        assert_eq!(wait_text(0, 42_000), "in 42 s");
        assert_eq!(wait_text(0, 61_000), "in 2 min");
        assert_eq!(wait_text(0, 3 * 3_600_000 + 20 * 60_000), "in 3 h 20 min");
        assert!(!clock_text(now, now + 1000).is_empty());
    }

    #[test]
    fn list_filter() {
        let c = cfg();
        let out = filter_model_list(&c, &c.scoped_keys[0], br#"{"models":[{"name":"models/gpt-5"},{"slug":"other"}],"x":1}"#);
        let v: Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(v["models"].as_array().unwrap().len(), 1);
        assert_eq!(v["x"], 1);
    }
}
