//! Small helpers shared across modules.

use serde_json::Value;

/// `n` random bytes as lowercase hex (OS randomness).
pub fn random_hex(n: usize) -> String {
    let mut b = vec![0u8; n];
    getrandom::fill(&mut b).expect("OS random source unavailable");
    hex::encode(b)
}

/// Unix time in milliseconds.
pub fn now_ms() -> i64 {
    jiff::Timestamp::now().as_millisecond()
}

/// Parses an RFC 3339 timestamp into unix ms (0 = absent, unparsable or before 2000).
pub fn parse_time_ms(s: &str) -> i64 {
    let s = s.trim();
    if s.is_empty() {
        return 0;
    }
    match s.parse::<jiff::Timestamp>() {
        Ok(t) if t.as_second() > 946_684_800 => t.as_millisecond(),
        _ => 0,
    }
}

/// Keeps at most `n` characters (not bytes), adding "…" when cut.
pub fn truncate_chars(s: &str, n: usize) -> String {
    match s.char_indices().nth(n) {
        Some((i, _)) => format!("{}…", &s[..i]),
        None => s.to_string(),
    }
}

/// Reverses the engine's `claude-fable-5-dd-<reversed>` cloaking of
/// non-Claude model ids (a "(level)" suffix stays at the end).
pub fn uncloak(id: &str) -> String {
    const PREFIX: &str = "claude-fable-5-dd-";
    let Some(base) = id.strip_prefix(PREFIX) else { return id.to_string() };
    let (base, suffix) = match base.rfind('(') {
        Some(open) if base.ends_with(')') => (&base[..open], &base[open..]),
        _ => (base, ""),
    };
    let mut out: String = base.chars().rev().collect();
    out.push_str(suffix);
    out
}

/// Removes Claude Code's client-side "[1m]" context marker.
pub fn strip_1m(model: &str) -> &str {
    let n = model.len();
    if n > 4 && model.is_char_boundary(n - 4) && model[n - 4..].eq_ignore_ascii_case("[1m]") { model[..n - 4].trim() } else { model }
}

/// The model without CarteLink's own decorations: the thinking suffix
/// "model(high)" and the "[1m]" marker.
pub fn base_model_name(model: &str) -> String {
    let m = strip_1m(model.trim());
    if m.ends_with(')')
        && let Some(i) = m.rfind('(')
        && i > 0
    {
        return m[..i].trim().to_string();
    }
    m.to_string()
}

/// Extracts a readable message from an error body: OpenAI, Anthropic and
/// Gemini JSON shapes, else the raw text.
pub fn error_message_from_body(body: &[u8]) -> String {
    let s = String::from_utf8_lossy(body);
    let s = s.trim();
    if s.is_empty() {
        return String::new();
    }
    if let Ok(v) = serde_json::from_str::<Value>(s)
        && let Some(m) = find_message(&v, 0)
    {
        return m;
    }
    truncate_chars(s, 600)
}

fn find_message(v: &Value, depth: u8) -> Option<String> {
    if depth > 4 {
        return None;
    }
    match v {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Array(a) => a.iter().find_map(|x| find_message(x, depth + 1)),
        Value::Object(o) => {
            for k in ["message", "error", "detail", "msg"] {
                if let Some(x) = o.get(k)
                    && let Some(m) = find_message(x, depth + 1)
                {
                    if k == "message"
                        && let Some(Value::String(t)) = o.get("type")
                        && !t.is_empty()
                        && t != "error"
                    {
                        return Some(format!("{t}: {m}"));
                    }
                    return Some(m);
                }
            }
            None
        }
        _ => None,
    }
}

/// JSON string field or "".
pub fn jstr<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

/// Any JSON number (or numeric string) as i64.
pub fn jint(v: Option<&Value>) -> i64 {
    match v {
        Some(Value::Number(n)) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)).unwrap_or(0),
        Some(Value::String(s)) => s.trim().parse().unwrap_or(0),
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uncloak_works() {
        assert_eq!(uncloak("claude-fable-5-dd-olleh"), "hello");
        assert_eq!(uncloak("claude-fable-5-dd-olleh(high)"), "hello(high)");
        assert_eq!(uncloak("gpt-5"), "gpt-5");
    }

    #[test]
    fn base_name() {
        assert_eq!(base_model_name("gpt-5(high)"), "gpt-5");
        assert_eq!(base_model_name("claude-x[1m]"), "claude-x");
        assert_eq!(base_model_name("(x)"), "(x)");
    }

    #[test]
    fn messages() {
        assert_eq!(error_message_from_body(br#"{"error":{"type":"rate_limit","message":"slow"}}"#), "rate_limit: slow");
        assert_eq!(error_message_from_body(b"plain"), "plain");
    }

    #[test]
    fn truncation_is_char_safe() {
        assert_eq!(truncate_chars("привіт", 3), "при…");
        assert_eq!(truncate_chars("ab", 3), "ab");
    }

    #[test]
    fn time_parse() {
        assert!(parse_time_ms("2026-01-01T00:00:00Z") > 0);
        assert_eq!(parse_time_ms("0001-01-01T00:00:00Z"), 0);
        assert_eq!(parse_time_ms(""), 0);
    }
}
