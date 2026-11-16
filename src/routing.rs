//! Model mapping: which real model answers a client's model name.
//!
//! Precedence:
//!  1. `modelMap` exact hit (both modes), then a "prefix*" wildcard (the longest wins).
//!  2. Mode "tiers" only: Claude Code tiers (a claude-* name containing
//!     haiku/sonnet/opus) and universal tiers reached through exact aliases.
//!  3. Unmapped: empty/"*" → default model; "always" → default model;
//!     "smart" → default model only when the engine does not serve the name;
//!     "passthrough" → unchanged.
//!
//! Matching is exact or by explicit wildcard — never a bare substring (2.2.0:
//! a "mini" rule caught every gemini-* model).

use crate::config::{Config, Routing, TIER_ALIASES, strip_provider_prefix};
use crate::util::{base_model_name, strip_1m, uncloak};

pub const ONE_MILLION: i64 = 1_000_000;

pub fn resolve_model(cfg: &Config, want: &str, known: Option<&dyn Fn(&str) -> bool>) -> String {
    let r = &cfg.routing;
    let want = strip_1m(want);
    let uncloaked = uncloak(want);
    let lw = uncloaked.trim().to_ascii_lowercase();

    if let Some(m) = lookup_map(r, &[want, &uncloaked]) {
        return strip_provider_prefix(Some(cfg), &m);
    }
    if r.mode != "table"
        && let Some(mut m) = tier_target(r, &lw)
    {
        if let Some(mapped) = r.model_map.get(&m).filter(|v| !v.is_empty()) {
            m = mapped.clone();
        }
        return strip_provider_prefix(Some(cfg), &m);
    }
    let def = strip_provider_prefix(Some(cfg), r.default_model.trim());
    if lw.is_empty() || lw == "*" {
        return if def.is_empty() { uncloaked } else { def };
    }
    if !def.is_empty() {
        match r.unmapped_strategy.as_str() {
            "always" => return def,
            "smart" => {
                if let Some(known) = known
                    && !known(&uncloaked)
                {
                    return def;
                }
            }
            _ => {}
        }
    }
    uncloaked
}

/// Exact (case-insensitive) or "prefix*" entry of the model map.
fn lookup_map(r: &Routing, names: &[&str]) -> Option<String> {
    let mm = &r.model_map;
    if mm.is_empty() {
        return None;
    }
    for n in names {
        if let Some(v) = mm.get(*n).filter(|v| !v.is_empty()) {
            return Some(v.clone());
        }
    }
    // Longest key first so the most specific wildcard wins.
    let mut keys: Vec<&String> = mm.iter().filter(|(_, v)| !v.is_empty()).map(|(k, _)| k).collect();
    keys.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
    for n in names {
        let ln = n.to_ascii_lowercase();
        if let Some(k) = keys.iter().find(|k| k.to_ascii_lowercase() == ln) {
            return Some(mm[*k].clone());
        }
    }
    for n in names {
        let ln = n.to_ascii_lowercase();
        if let Some(k) = keys.iter().find(|k| wildcard_match(&k.to_ascii_lowercase(), &ln)) {
            return Some(mm[*k].clone());
        }
    }
    None
}

/// "*" stands for any run of characters ("/" included). A pattern without "*"
/// never matches here (exact names are handled before).
pub fn wildcard_match(pattern: &str, name: &str) -> bool {
    if !pattern.contains('*') {
        return false;
    }
    let parts: Vec<&str> = pattern.split('*').collect();
    let Some(mut rest) = name.strip_prefix(parts[0]) else { return false };
    let last = parts[parts.len() - 1];
    for mid in &parts[1..parts.len() - 1] {
        match rest.find(mid) {
            Some(i) => rest = &rest[i + mid.len()..],
            None => return false,
        }
    }
    rest.len() >= last.len() && rest.ends_with(last)
}

fn tier_target(r: &Routing, lw: &str) -> Option<String> {
    let t = &r.tiers;
    if lw.starts_with("claude") {
        if lw.contains("haiku") && !t.haiku.is_empty() {
            return Some(t.haiku.clone());
        }
        if lw.contains("sonnet") && !t.sonnet.is_empty() {
            return Some(t.sonnet.clone());
        }
        if lw.contains("opus") && !t.opus.is_empty() {
            return Some(t.opus.clone());
        }
    }
    for (tier, aliases) in TIER_ALIASES {
        if aliases.contains(&lw) {
            let m = universal_tier(r, tier);
            return (!m.is_empty()).then_some(m);
        }
    }
    None
}

/// The model behind cartelink-fast/main/max. An empty tier follows its Claude
/// counterpart (fast → Haiku, main → Sonnet, max → Opus), then the default model.
pub fn universal_tier(r: &Routing, tier: &str) -> String {
    let t = &r.tiers;
    let pick = |vals: [&str; 3]| vals.into_iter().map(str::trim).find(|v| !v.is_empty()).unwrap_or("").to_string();
    match tier {
        "fast" => pick([&t.fast, &t.haiku, &r.default_model]),
        "main" => pick([&t.main, &t.sonnet, &r.default_model]),
        "max" => pick([&t.max, &t.opus, &r.default_model]),
        _ => String::new(),
    }
}

/// Client-facing names that currently resolve to a real model (set universal
/// tiers and non-wildcard table keys), advertised in /v1/models.
pub fn served_aliases(cfg: &Config) -> Vec<String> {
    let r = &cfg.routing;
    let mut out = vec![];
    if r.mode != "table" {
        for tier in ["fast", "main", "max"] {
            if !universal_tier(r, tier).is_empty() {
                out.push(format!("cartelink-{tier}"));
            }
        }
    }
    for (k, v) in &r.model_map {
        if !v.is_empty() && !k.contains(['*', '?', '[']) {
            out.push(k.clone());
        }
    }
    out
}

#[derive(Debug, Clone)]
pub struct CatalogModel {
    pub id: String,
    pub display_name: String,
    pub owned_by: String,
}

/// The /v1/models entries Claude Code shows in its /model picker (gateway model
/// discovery keeps only "claude" ids). Claude Code assumes 200K for unknown
/// models and honours only a "[1m]" suffix, so models with a 1M+ window get it.
pub fn claude_picker_entries(cfg: &Config, ctx_of: &dyn Fn(&str) -> i64) -> Vec<CatalogModel> {
    let entry = |id: &str, label: &str, model: &str| {
        if ctx_of(model) >= ONE_MILLION {
            CatalogModel { id: format!("{id}[1m]"), display_name: format!("{label}{model} · 1M"), owned_by: "cartelink".into() }
        } else {
            CatalogModel { id: id.into(), display_name: format!("{label}{model}"), owned_by: "cartelink".into() }
        }
    };
    let main = resolve_model(cfg, "claude-cartelink-main", None);
    if main.is_empty() || main == "claude-cartelink-main" {
        return vec![];
    }
    let mut out = vec![entry("claude-cartelink-main", "CarteLink: ", &main)];
    for (id, label) in [("claude-cartelink-fast", "CarteLink fast: "), ("claude-cartelink-max", "CarteLink max: ")] {
        let m = resolve_model(cfg, id, None);
        if !m.is_empty() && m != id && m != main {
            out.push(entry(id, label, &m));
        }
    }
    out
}

/// Whether a model id is on the blacklist ("model(high)" and "model[1m]" are the same model).
pub fn is_blacklisted(cfg: &Config, model: &str) -> bool {
    if model.is_empty() || cfg.model_blacklist.is_empty() {
        return false;
    }
    let base = base_model_name(model).to_ascii_lowercase();
    let full = model.trim().to_ascii_lowercase();
    cfg.model_blacklist.iter().any(|b| {
        let b = b.trim().to_ascii_lowercase();
        !b.is_empty() && (b == base || b == full)
    })
}

/// The model of the first enabled per-program rule whose matcher is part of
/// the User-Agent (case-insensitive). Such a model replaces normal routing.
pub fn app_rule_model(cfg: &Config, user_agent: &str) -> Option<String> {
    let ua = user_agent.to_lowercase();
    if ua.trim().is_empty() {
        return None;
    }
    cfg.routing
        .app_rules
        .iter()
        .filter(|r| r.enabled && !r.model.trim().is_empty())
        .find(|r| {
            let m = r.matcher.trim().to_lowercase();
            !m.is_empty() && ua.contains(&m)
        })
        .map(|r| strip_provider_prefix(Some(cfg), r.model.trim()))
}

/// The most fallback models one request may try after its own model.
pub const MAX_FALLBACKS: usize = 4;

/// Fallback models for `model` (as resolved), in order: its own chain first,
/// then the chains of those models, without repeats, blacklisted models or
/// models `allowed` rejects (a scoped key's list), at most `MAX_FALLBACKS`.
pub fn fallback_chain(cfg: &Config, model: &str, allowed: &dyn Fn(&str) -> bool) -> Vec<String> {
    let fb = &cfg.routing.fallbacks;
    if fb.is_empty() || model.trim().is_empty() {
        return vec![];
    }
    let lookup = |m: &str| -> Option<&Vec<String>> {
        let base = base_model_name(m);
        fb.get(m)
            .or_else(|| fb.iter().find(|(k, _)| k.eq_ignore_ascii_case(m)).map(|(_, v)| v))
            .or_else(|| fb.iter().find(|(k, _)| k.eq_ignore_ascii_case(&base)).map(|(_, v)| v))
    };
    let mut seen: Vec<String> = vec![base_model_name(model).to_ascii_lowercase()];
    let mut out = vec![];
    let mut queue: std::collections::VecDeque<String> = lookup(model).cloned().unwrap_or_default().into();
    while let Some(next) = queue.pop_front() {
        if out.len() >= MAX_FALLBACKS {
            break;
        }
        let next = strip_provider_prefix(Some(cfg), next.trim());
        let key = base_model_name(&next).to_ascii_lowercase();
        if next.is_empty() || seen.contains(&key) {
            continue;
        }
        seen.push(key);
        if let Some(more) = lookup(&next) {
            queue.extend(more.iter().cloned());
        }
        if is_blacklisted(cfg, &next) || !allowed(&next) {
            continue;
        }
        out.push(next);
    }
    out
}

/// Whether an engine answer means "this model cannot answer now, another may":
/// limits (429), server errors (5xx), unknown routes/models (404), and 400/403
/// whose message says the model is unknown, unavailable, unsupported or out of quota.
pub fn is_fallback_status(status: u16, message: &str) -> bool {
    match status {
        429 | 404 | 500..=599 => true,
        400 | 403 => {
            let m = message.to_ascii_lowercase();
            let model_problem = m.contains("model")
                && [
                    "unknown",
                    "unavailable",
                    "not available",
                    "not supported",
                    "unsupported",
                    "not found",
                    "does not exist",
                    "not exist",
                    "invalid model",
                    "invalid_model",
                    "no auth available",
                    "no available",
                ]
                .iter()
                .any(|s| m.contains(s));
            let quota = ["quota", "exhausted", "rate limit", "rate_limit", "usage limit", "usage_limit", "insufficient_quota", "billing"]
                .iter()
                .any(|s| m.contains(s));
            model_problem || quota
        }
        _ => false,
    }
}

/// The model most requests go to right now.
pub fn current_main_model(cfg: &Config) -> String {
    let t = &cfg.routing.tiers;
    [&t.sonnet, &t.main, &cfg.routing.default_model, &t.opus, &t.haiku]
        .into_iter()
        .map(|m| strip_provider_prefix(None, m.trim()))
        .find(|m| !m.is_empty())
        .unwrap_or_default()
}

/// A readable name for well-known model ids (by family prefix).
pub fn friendly_model_name(m: &str) -> String {
    const NAMES: &[(&str, &str)] = &[
        ("gemini-3.8-flash", "Gemini 3.8 Flash"),
        ("gemini-3.7-flash", "Gemini 3.7 Flash"),
        ("gemini-3.6-flash", "Gemini 3.6 Flash"),
        ("gemini-3.5-flash-lite", "Gemini 3.5 Flash Lite"),
        ("gemini-3.1-flash-lite", "Gemini 3.1 Flash Lite"),
        ("gemini-3-flash", "Gemini 3 Flash"),
        ("gemini-pro-agent", "Gemini 3.1 Pro"),
        ("gemini-3.1-pro", "Gemini 3.1 Pro"),
        ("gpt-oss-120b", "GPT-OSS 120B"),
        ("claude-opus-5-5", "Claude Opus 5.5"),
        ("claude-sonnet-5-5", "Claude Sonnet 5.5"),
        ("claude-fable-5-2", "Claude Fable 5.2"),
        ("claude-fable-5-1", "Claude Fable 5.1"),
        ("claude-haiku-5-5", "Claude Haiku 5.5"),
        ("claude-sonnet-4-6", "Claude Sonnet 4.6"),
        ("claude-opus-4-6", "Claude Opus 4.6"),
        ("gpt-5.5", "GPT 5.5"),
        ("gpt-6", "GPT 6"),
        ("gpt-4o", "GPT-4o"),
        ("o3-mini", "o3-mini"),
        ("kimi-k3", "Kimi K3"),
        ("kimi-k2.8", "Kimi K2.8"),
        ("kimi-k2.7", "Kimi K2.7"),
        ("kimi-k2.6", "Kimi K2.6"),
        ("kimi-k2.5", "Kimi K2.5"),
        ("kimi-k2", "Kimi K2"),
        ("grok-3", "Grok 3"),
        ("llama-3.3", "Llama 3.3"),
    ];
    let lower = m.to_ascii_lowercase();
    // A family prefix, bounded by the end or a separator, so "gpt-6" names
    // "gpt-6" and "gpt-6-astra" but never "gpt-60".
    for (prefix, name) in NAMES {
        if let Some(rest) = lower.strip_prefix(prefix)
            && (rest.is_empty() || rest.starts_with(['-', '(', ':', '[', '.', '@']))
        {
            return (*name).to_string();
        }
    }
    m.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::normalize;

    fn cfg(json: &str) -> Config {
        let mut c: Config = serde_json::from_str(json).unwrap();
        normalize(&mut c);
        c
    }

    #[test]
    fn tiers_and_aliases() {
        let c = cfg(r#"{"routing":{"tiers":{"sonnet":"gpt-5","haiku":"flash"},"defaultModel":"def"}}"#);
        assert_eq!(resolve_model(&c, "claude-sonnet-4-6", None), "gpt-5");
        assert_eq!(resolve_model(&c, "claude-3-5-haiku-latest", None), "flash");
        assert_eq!(resolve_model(&c, "cartelink-main", None), "gpt-5");
        assert_eq!(resolve_model(&c, "cartelink-fast", None), "flash");
        assert_eq!(resolve_model(&c, "cartelink-max", None), "def");
        assert_eq!(resolve_model(&c, "", None), "def");
    }

    #[test]
    fn no_substring_matches() {
        let c = cfg(r#"{"routing":{"mode":"table","modelMap":{"mini":"x"}}}"#);
        assert_eq!(resolve_model(&c, "gemini-3-flash", None), "gemini-3-flash");
    }

    #[test]
    fn wildcards_longest_wins() {
        let c = cfg(r#"{"routing":{"mode":"table","modelMap":{"gpt-*":"a","gpt-5*":"b"}}}"#);
        assert_eq!(resolve_model(&c, "gpt-5-mini", None), "b");
        assert_eq!(resolve_model(&c, "gpt-4", None), "a");
        assert!(wildcard_match("openrouter/*", "openrouter/meta/llama"));
        assert!(!wildcard_match("a*bc", "abc"[..2].as_ref()));
        assert!(!wildcard_match("ab*ba", "aba"));
    }

    #[test]
    fn smart_fallback() {
        let c = cfg(r#"{"routing":{"defaultModel":"def","unmappedStrategy":"smart"}}"#);
        let known = |m: &str| m == "real";
        assert_eq!(resolve_model(&c, "real", Some(&known)), "real");
        assert_eq!(resolve_model(&c, "ghost", Some(&known)), "def");
        assert_eq!(resolve_model(&c, "ghost", None), "ghost");
    }

    #[test]
    fn one_m_marker_and_blacklist() {
        let c = cfg(r#"{"routing":{"tiers":{"sonnet":"big"}},"modelBlacklist":["bad"]}"#);
        assert_eq!(resolve_model(&c, "claude-sonnet-x[1m]", None), "big");
        assert!(is_blacklisted(&c, "bad(high)"));
        assert!(is_blacklisted(&c, "BAD"));
        assert!(!is_blacklisted(&c, "badger"));
    }

    #[test]
    fn app_rules_pick_model() {
        let c = cfg(r#"{"routing":{"appRules":[
                {"name":"Off","matcher":"cursor","model":"x","enabled":false},
                {"name":"Cursor","matcher":"Cursor","model":"gpt-6"},
                {"name":"Empty","matcher":"cline","model":""},
                {"name":"Prefixed","matcher":"zed","model":"account:kimi-k3"}
            ]}}"#);
        assert_eq!(app_rule_model(&c, "cursor/1.7 electron").as_deref(), Some("gpt-6"));
        assert_eq!(app_rule_model(&c, "Cline/3.0"), None);
        assert_eq!(app_rule_model(&c, "Zed/0.2").as_deref(), Some("kimi-k3"));
        assert_eq!(app_rule_model(&c, ""), None);
        assert_eq!(app_rule_model(&c, "curl/8"), None);
    }

    #[test]
    fn fallback_chains() {
        let c = cfg(r#"{"routing":{"fallbacks":{"A":["b","c"],"b":["d","a"],"d":["e","f","g"]}},"modelBlacklist":["c"]}"#);
        let all = |_: &str| true;
        // Own chain first, then the chains of its members; no repeats, no blacklist, at most 4.
        assert_eq!(fallback_chain(&c, "a", &all), vec!["b", "d", "e", "f"]);
        assert_eq!(fallback_chain(&c, "a(high)", &all), vec!["b", "d", "e", "f"]);
        let only_d = |m: &str| m == "d";
        assert_eq!(fallback_chain(&c, "A", &only_d), vec!["d"]);
        assert!(fallback_chain(&c, "zzz", &all).is_empty());
        assert!(fallback_chain(&c, "", &all).is_empty());
    }

    #[test]
    fn fallback_statuses() {
        assert!(is_fallback_status(429, ""));
        assert!(is_fallback_status(503, ""));
        assert!(is_fallback_status(404, ""));
        assert!(is_fallback_status(400, "unknown model: foo"));
        assert!(is_fallback_status(400, "The model `x` does not exist"));
        assert!(is_fallback_status(403, "You exceeded your current quota"));
        assert!(!is_fallback_status(400, "messages: field required"));
        assert!(!is_fallback_status(401, "unknown model"));
        assert!(!is_fallback_status(200, ""));
    }

    #[test]
    fn friendly_names() {
        assert_eq!(friendly_model_name("gpt-6"), "GPT 6");
        assert_eq!(friendly_model_name("gpt-60"), "gpt-60");
        assert_eq!(friendly_model_name("kimi-k2.5-turbo"), "Kimi K2.5");
    }
}
