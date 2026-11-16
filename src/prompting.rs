//! The user's own system prompt / AGENT.md and reasoning settings, injected
//! into model requests per request (a change in the UI applies at once).

use serde_json::{Map, Value, json};

use crate::caps::ModelCaps;
use crate::config::{Config, Prompting, Thinking};

/// API families CarteLink rewrites; they keep the system prompt and the
/// reasoning settings in different places.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Api {
    /// POST /v1/messages → "system", "thinking"
    Anthropic,
    /// POST /v1/chat/completions, /v1/completions → system message, "reasoning_effort"
    Chat,
    /// POST /v1/responses → "instructions", "reasoning"
    Responses,
}

pub fn api_family(path: &str) -> Option<Api> {
    match path {
        "/v1/messages" => Some(Api::Anthropic),
        "/v1/chat/completions" | "/v1/completions" => Some(Api::Chat),
        "/v1/responses" => Some(Api::Responses),
        _ => None,
    }
}

fn prompt_text(p: &Prompting) -> String {
    let mut parts = vec![];
    let t = p.text.trim();
    if !t.is_empty() {
        parts.push(t);
    }
    if p.agent_md_enabled {
        let t = p.agent_md.trim();
        if !t.is_empty() {
            parts.push(t);
        }
    }
    parts.join("\n\n")
}

fn applies(p: &Prompting, api: Api) -> bool {
    match p.scope.as_str() {
        "anthropic" => api == Api::Anthropic,
        "openai" => matches!(api, Api::Chat | Api::Responses),
        _ => true,
    }
}

/// Injects the configured system prompt. Returns true when the payload changed.
pub fn apply_prompting(cfg: &Config, payload: &mut Map<String, Value>, api: Api) -> bool {
    let p = &cfg.prompting;
    if !p.enabled || !applies(p, api) {
        return false;
    }
    let text = prompt_text(p);
    if text.is_empty() {
        return false;
    }
    match api {
        Api::Anthropic => inject_anthropic(payload, &text, &p.mode),
        Api::Chat => inject_chat(payload, &text, &p.mode),
        Api::Responses => inject_instructions(payload, &text, &p.mode),
    }
}

fn join_prompt(existing: &str, injected: &str, mode: &str) -> String {
    let existing = existing.trim();
    if mode == "replace" || existing.is_empty() {
        injected.to_string()
    } else if mode == "append" {
        format!("{existing}\n\n{injected}")
    } else {
        format!("{injected}\n\n{existing}")
    }
}

fn inject_anthropic(payload: &mut Map<String, Value>, text: &str, mode: &str) -> bool {
    let block = || json!({"type": "text", "text": text});
    let new = match payload.get("system") {
        Some(Value::String(cur)) => Value::String(join_prompt(cur, text, mode)),
        Some(Value::Array(cur)) => {
            let mut out = Vec::with_capacity(cur.len() + 1);
            match mode {
                "replace" => out.push(block()),
                "append" => {
                    out.extend(cur.iter().cloned());
                    out.push(block());
                }
                _ => {
                    out.push(block());
                    out.extend(cur.iter().cloned());
                }
            }
            Value::Array(out)
        }
        _ => Value::String(text.to_string()),
    };
    payload.insert("system".into(), new);
    true
}

fn is_system_msg(m: &Value) -> bool {
    matches!(m.get("role").and_then(Value::as_str), Some("system" | "developer"))
}

fn inject_chat(payload: &mut Map<String, Value>, text: &str, mode: &str) -> bool {
    let msgs: Vec<Value> = match payload.get("messages") {
        Some(Value::Array(a)) => a.clone(),
        _ => vec![],
    };
    let sys = json!({"role": "system", "content": text});
    if mode == "replace" {
        let mut out = vec![sys];
        out.extend(msgs.into_iter().filter(|m| !is_system_msg(m)));
        payload.insert("messages".into(), Value::Array(out));
        return true;
    }
    let mut msgs = msgs;
    for m in msgs.iter_mut() {
        if !is_system_msg(m) {
            continue;
        }
        let Some(obj) = m.as_object_mut() else { continue };
        match obj.get("content") {
            Some(Value::String(cur)) => {
                let joined = join_prompt(cur, text, mode);
                obj.insert("content".into(), Value::String(joined));
                payload.insert("messages".into(), Value::Array(msgs));
                return true;
            }
            Some(Value::Array(cur)) => {
                let blk = json!({"type": "text", "text": text});
                let mut out = Vec::with_capacity(cur.len() + 1);
                if mode == "append" {
                    out.extend(cur.iter().cloned());
                    out.push(blk);
                } else {
                    out.push(blk);
                    out.extend(cur.iter().cloned());
                }
                obj.insert("content".into(), Value::Array(out));
                payload.insert("messages".into(), Value::Array(msgs));
                return true;
            }
            _ => {}
        }
    }
    let mut out = vec![sys];
    out.extend(msgs);
    payload.insert("messages".into(), Value::Array(out));
    true
}

/// The Responses API "instructions" field. Codex keeps its real system prompt in
/// developer messages inside "input", so "replace" removes those too.
fn inject_instructions(payload: &mut Map<String, Value>, text: &str, mode: &str) -> bool {
    let cur = payload.get("instructions").and_then(Value::as_str).unwrap_or("").to_string();
    payload.insert("instructions".into(), Value::String(join_prompt(&cur, text, mode)));
    if mode != "replace" {
        return true;
    }
    if let Some(Value::Array(items)) = payload.get_mut("input") {
        items.retain(|it| {
            let typ = it.get("type").and_then(Value::as_str).unwrap_or("");
            let role = it.get("role").and_then(Value::as_str).unwrap_or("");
            !((typ.is_empty() || typ == "message") && (role == "developer" || role == "system"))
        });
    }
    true
}

/// Asks a capable model to think harder or less through the engine's own
/// thinking layer: a suffix on the model name ("model(high)", "model(16384)",
/// "model(none)", "model(auto)"), which the engine validates and converts.
pub fn apply_thinking(cfg: &Config, payload: &mut Map<String, Value>, api: Api, caps: &ModelCaps) -> bool {
    let th = &cfg.prompting.thinking;
    if !th.enabled || !caps.thinking {
        return false;
    }
    let Some(model) = payload.get("model").and_then(Value::as_str).map(str::to_string) else { return false };
    if model.is_empty() {
        return false;
    }
    let has_suffix = model.ends_with(')') && model.rfind('(').is_some_and(|i| i > 0);
    if !th.r#override && (has_suffix || client_sets_thinking(payload, api)) {
        return false;
    }
    let Some(suffix) = thinking_suffix(th, caps) else { return false };
    let base = if has_suffix { &model[..model.rfind('(').unwrap_or(model.len())] } else { model.as_str() };
    payload.insert("model".into(), Value::String(format!("{base}({suffix})")));
    true
}

fn thinking_suffix(th: &Thinking, caps: &ModelCaps) -> Option<String> {
    if th.budget > 0 && caps.max > 0 {
        let mut b = th.budget.min(caps.max);
        if caps.min > 0 && b < caps.min {
            b = caps.min;
        }
        return Some(b.to_string());
    }
    let mut level = th.level.as_str();
    match level {
        "off" => {
            if caps.zero_allowed || has_level(&caps.levels, "none") {
                return Some("none".into());
            }
            for l in ["minimal", "low"] {
                if has_level(&caps.levels, l) {
                    return Some(l.into());
                }
            }
            return None;
        }
        "dynamic" => {
            if caps.dynamic_allowed {
                return Some("auto".into());
            }
            level = "high";
        }
        _ => {}
    }
    if caps.levels.is_empty() || has_level(&caps.levels, level) {
        return Some(level.to_string());
    }
    nearest_level(&caps.levels, level)
}

/// Reasoning levels, weakest first. The engine knows the first ENGINE_LEVELS;
/// "ultra" (Codex Desktop) is ranked only to be mapped down.
const EFFORT_ORDER: [&str; 7] = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
const ENGINE_LEVELS: usize = 6;

fn rank(l: &str) -> Option<usize> {
    let l = l.trim();
    EFFORT_ORDER.iter().position(|x| x.eq_ignore_ascii_case(l))
}

fn has_level(levels: &[String], l: &str) -> bool {
    levels.iter().any(|x| x.eq_ignore_ascii_case(l.trim()))
}

/// The entry of `levels` closest to `level` (a tie goes to the lower one).
fn nearest_level(levels: &[String], level: &str) -> Option<String> {
    let want = rank(level)?;
    levels.iter().filter_map(|l| rank(l).map(|i| (l, i))).min_by_key(|(_, i)| (i.abs_diff(want), *i)).map(|(l, _)| l.clone())
}

/// Maps a client's reasoning level onto one the target model takes (the engine
/// rejects unknown levels such as "ultra" even after routing). Runs on every
/// request, independent of the thinking switch.
pub fn normalize_effort(payload: &mut Map<String, Value>, api: Api, caps: &ModelCaps) -> bool {
    fn fix(obj: Option<&mut Value>, key: &str, caps: &ModelCaps) -> bool {
        let Some(Value::Object(o)) = obj else { return false };
        let Some(Value::String(v)) = o.get(key) else { return false };
        let nv = effort_for(v, caps);
        if &nv == v {
            return false;
        }
        o.insert(key.into(), Value::String(nv));
        true
    }
    let mut changed = false;
    match api {
        Api::Responses => {
            // Natively served Responses models get their body as sent.
            if !caps.config_update {
                changed |= fix(payload.get_mut("reasoning"), "effort", caps);
                if let Some(Value::Array(items)) = payload.get_mut("input") {
                    for it in items.iter_mut() {
                        if it.get("type").and_then(Value::as_str) == Some("configuration_update") {
                            changed |= fix(it.get_mut("reasoning"), "effort", caps);
                        }
                    }
                }
            }
        }
        Api::Chat => {
            if let Some(Value::String(v)) = payload.get("reasoning_effort") {
                let nv = effort_for(v, caps);
                if &nv != v {
                    payload.insert("reasoning_effort".into(), Value::String(nv));
                    changed = true;
                }
            }
            changed |= fix(payload.get_mut("reasoning"), "effort", caps);
        }
        Api::Anthropic => changed |= fix(payload.get_mut("output_config"), "effort", caps),
    }
    if let Some(model) = payload.get("model").and_then(Value::as_str).map(str::to_string)
        && model.ends_with(')')
        && let Some(i) = model.rfind('(').filter(|&i| i > 0)
    {
        let raw = &model[i + 1..model.len() - 1];
        let nv = effort_for(raw, caps);
        if nv != raw {
            payload.insert("model".into(), Value::String(format!("{}{nv})", &model[..=i])));
            changed = true;
        }
    }
    changed
}

fn effort_for(v: &str, caps: &ModelCaps) -> String {
    let Some(want) = rank(v) else { return v.to_string() };
    if has_level(&caps.levels, v) {
        return v.to_string();
    }
    if caps.levels.is_empty() {
        // Budget-based or unknown model: the engine converts known levels itself.
        return if want < ENGINE_LEVELS { v.to_string() } else { EFFORT_ORDER[ENGINE_LEVELS - 1].to_string() };
    }
    nearest_level(&caps.levels, v).unwrap_or_else(|| v.to_string())
}

fn client_sets_thinking(payload: &Map<String, Value>, api: Api) -> bool {
    match api {
        Api::Anthropic => payload.contains_key("thinking") || payload.get("output_config").and_then(|o| o.get("effort")).is_some(),
        Api::Chat => payload.contains_key("reasoning_effort") || payload.contains_key("reasoning"),
        Api::Responses => payload.contains_key("reasoning"),
    }
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
    fn obj(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn anthropic_prepend_and_replace() {
        let c = cfg(r#"{"prompting":{"enabled":true,"text":"MINE"}}"#);
        let mut p = obj(json!({"system":"THEIRS"}));
        assert!(apply_prompting(&c, &mut p, Api::Anthropic));
        assert_eq!(p["system"], "MINE\n\nTHEIRS");
        let c = cfg(r#"{"prompting":{"enabled":true,"text":"MINE","mode":"replace"}}"#);
        let mut p = obj(json!({"system":[{"type":"text","text":"x"}]}));
        apply_prompting(&c, &mut p, Api::Anthropic);
        assert_eq!(p["system"], json!([{"type":"text","text":"MINE"}]));
    }

    #[test]
    fn chat_inserts_system() {
        let c = cfg(r#"{"prompting":{"enabled":true,"text":"S","mode":"append"}}"#);
        let mut p = obj(json!({"messages":[{"role":"system","content":"A"},{"role":"user","content":"u"}]}));
        apply_prompting(&c, &mut p, Api::Chat);
        assert_eq!(p["messages"][0]["content"], "A\n\nS");
        let mut p = obj(json!({"messages":[{"role":"user","content":"u"}]}));
        apply_prompting(&c, &mut p, Api::Chat);
        assert_eq!(p["messages"][0]["role"], "system");
    }

    #[test]
    fn responses_replace_drops_developer() {
        let c = cfg(r#"{"prompting":{"enabled":true,"text":"S","mode":"replace"}}"#);
        let mut p = obj(
            json!({"instructions":"codex","input":[{"type":"message","role":"developer","content":"x"},{"type":"message","role":"user","content":"y"}]}),
        );
        apply_prompting(&c, &mut p, Api::Responses);
        assert_eq!(p["instructions"], "S");
        assert_eq!(p["input"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn scope_limits() {
        let c = cfg(r#"{"prompting":{"enabled":true,"text":"S","scope":"anthropic"}}"#);
        let mut p = obj(json!({"messages":[]}));
        assert!(!apply_prompting(&c, &mut p, Api::Chat));
    }

    #[test]
    fn thinking_suffixes() {
        let caps = ModelCaps { thinking: true, levels: vec!["low".into(), "medium".into(), "high".into()], ..Default::default() };
        let c = cfg(r#"{"prompting":{"thinking":{"enabled":true,"level":"max"}}}"#);
        let mut p = obj(json!({"model":"m"}));
        assert!(apply_thinking(&c, &mut p, Api::Chat, &caps));
        assert_eq!(p["model"], "m(high)");
        // The client's own choice wins without override.
        let mut p = obj(json!({"model":"m","reasoning_effort":"low"}));
        assert!(!apply_thinking(&c, &mut p, Api::Chat, &caps));
        // Budget is clamped to the model's range.
        let caps = ModelCaps { thinking: true, min: 1024, max: 8000, ..Default::default() };
        let c = cfg(r#"{"prompting":{"thinking":{"enabled":true,"budget":99999}}}"#);
        let mut p = obj(json!({"model":"g(low)"}));
        assert!(!apply_thinking(&c, &mut p, Api::Anthropic, &caps));
        let c = cfg(r#"{"prompting":{"thinking":{"enabled":true,"budget":99999,"override":true}}}"#);
        assert!(apply_thinking(&c, &mut p, Api::Anthropic, &caps));
        assert_eq!(p["model"], "g(8000)");
    }

    #[test]
    fn effort_normalized() {
        let caps = ModelCaps { levels: vec!["low".into(), "high".into()], ..Default::default() };
        let mut p = obj(json!({"model":"x(ultra)","reasoning_effort":"xhigh"}));
        assert!(normalize_effort(&mut p, Api::Chat, &caps));
        assert_eq!(p["reasoning_effort"], "high");
        assert_eq!(p["model"], "x(high)");
        let none = ModelCaps::default();
        let mut p = obj(json!({"reasoning":{"effort":"ultra"}}));
        assert!(normalize_effort(&mut p, Api::Responses, &none));
        assert_eq!(p["reasoning"]["effort"], "max");
    }
}
