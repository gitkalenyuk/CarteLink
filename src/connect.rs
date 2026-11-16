//! One-click program setup: writes a client program's own config so it talks
//! to this CarteLink, merging with what is there (the user's other settings
//! stay). The original file is kept once as `<file>.cartelink.bak` (or, when
//! there was no file, a `<file>.cartelink.new` marker) so "undo" can put it back.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Map, Value, json};

/// Programs CarteLink can set up by itself: (id, name, path relative to the home folder).
pub const PROGRAMS: [(&str, &str, &str); 5] = [
    ("claude-code", "Claude Code", ".claude/settings.json"),
    ("codex", "Codex CLI", ".codex/config.toml"),
    ("opencode", "OpenCode", ".config/opencode/opencode.json"),
    ("qwen-code", "Qwen Code", ".qwen/settings.json"),
    ("gemini-cli", "Gemini CLI", ".gemini/.env"),
];

/// Codex reads its key from this environment variable.
pub const KEY_ENV: &str = "CARTELINK_API_KEY";
/// Default models: CarteLink's own tier aliases, so the Models page decides.
pub const DEFAULT_MODEL: &str = "cartelink-main";
pub const DEFAULT_FAST: &str = "cartelink-fast";

/// What a program is set up with.
#[derive(Debug, Clone, Default)]
pub struct Gateway {
    /// http://host:port (no trailing slash).
    pub base: String,
    pub key: String,
    pub model: String,
    pub fast: String,
    /// Context window of `model` (0 = unknown).
    pub context: i64,
    /// Whether the caller chose the model (Claude Code then pins it).
    pub model_chosen: bool,
    pub fast_chosen: bool,
}

impl Gateway {
    fn base_v1(&self) -> String {
        format!("{}/v1", self.base)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgramStatus {
    pub id: String,
    pub name: String,
    pub path: String,
    pub exists: bool,
    pub configured: bool,
    pub backup: bool,
}

/// The folder the programs keep their configs in: `CARTELINK_CLIENT_HOME`
/// (tests, portable setups) or the user's home.
pub fn client_home() -> PathBuf {
    if let Some(v) = std::env::var_os("CARTELINK_CLIENT_HOME").filter(|v| !v.is_empty()) {
        return PathBuf::from(v);
    }
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

pub fn find(id: &str) -> Option<(&'static str, &'static str, &'static str)> {
    let id = if id == "codex-cli" { "codex" } else { id };
    PROGRAMS.iter().copied().find(|p| p.0 == id)
}

pub fn path_for(home: &Path, rel: &str) -> PathBuf {
    rel.split('/').fold(home.to_path_buf(), |p, part| p.join(part))
}

fn side(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_os_string();
    s.push(suffix);
    PathBuf::from(s)
}
pub fn backup_path(path: &Path) -> PathBuf {
    side(path, ".cartelink.bak")
}
fn new_marker(path: &Path) -> PathBuf {
    side(path, ".cartelink.new")
}

fn same_url(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.trim().trim_end_matches('/').to_ascii_lowercase().replace("://localhost:", "://127.0.0.1:");
    norm(a) == norm(b)
}

// ------------------------------------------------------------------ JSON ----

fn parse_json_object(existing: Option<&str>) -> Result<Map<String, Value>, String> {
    let Some(text) = existing.map(|t| t.trim_start_matches('\u{feff}')).filter(|t| !t.trim().is_empty()) else {
        return Ok(Map::new());
    };
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Object(m)) => Ok(m),
        Ok(_) => Err("файл налаштувань має неочікуваний формат (не JSON-обʼєкт) — CarteLink його не змінює".into()),
        Err(e) => Err(format!("файл налаштувань не читається як JSON ({e}) — виправ його або підключи вручну")),
    }
}

/// `m[key]` as an object, created (or replaced, if it is not an object) when missing.
fn obj<'a>(m: &'a mut Map<String, Value>, key: &str) -> &'a mut Map<String, Value> {
    let slot = m.entry(key.to_string()).or_insert_with(|| Value::Object(Map::new()));
    if !slot.is_object() {
        *slot = Value::Object(Map::new());
    }
    slot.as_object_mut().expect("object")
}

fn to_pretty(m: Map<String, Value>) -> String {
    let mut s = serde_json::to_string_pretty(&Value::Object(m)).unwrap_or_else(|_| "{}".into());
    s.push('\n');
    s
}

/// ~/.claude/settings.json: env ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN and
/// gateway model discovery; every other key stays.
pub fn merge_claude(existing: Option<&str>, g: &Gateway) -> Result<String, String> {
    let mut root = parse_json_object(existing)?;
    let env = obj(&mut root, "env");
    env.insert("ANTHROPIC_BASE_URL".into(), json!(g.base));
    env.insert("ANTHROPIC_AUTH_TOKEN".into(), json!(g.key));
    env.insert("CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY".into(), json!("1"));
    // A real Anthropic key would win over the token: CarteLink answers instead.
    env.remove("ANTHROPIC_API_KEY");
    if g.fast_chosen && !g.fast.is_empty() {
        env.insert("ANTHROPIC_DEFAULT_HAIKU_MODEL".into(), json!(g.fast));
    }
    if g.model_chosen && !g.model.is_empty() {
        root.insert("model".into(), json!(g.model));
    }
    Ok(to_pretty(root))
}

pub fn claude_configured(existing: &str, g: &Gateway) -> bool {
    let Ok(root) = parse_json_object(Some(existing)) else { return false };
    let env = root.get("env");
    let s = |k: &str| env.and_then(|e| e.get(k)).and_then(Value::as_str).unwrap_or("");
    same_url(s("ANTHROPIC_BASE_URL"), &g.base) && s("ANTHROPIC_AUTH_TOKEN") == g.key
}

/// ~/.config/opencode/opencode.json: a `cartelink` provider block.
pub fn merge_opencode(existing: Option<&str>, g: &Gateway) -> Result<String, String> {
    let mut root = parse_json_object(existing)?;
    root.entry("$schema").or_insert_with(|| json!("https://opencode.ai/config.json"));
    let providers = obj(&mut root, "provider");
    let mut models = Map::new();
    for m in [&g.model, &g.fast] {
        if !m.is_empty() {
            models.insert(m.clone(), json!({ "name": m }));
        }
    }
    providers.insert(
        "cartelink".into(),
        json!({
            "npm": "@ai-sdk/openai-compatible",
            "name": "CarteLink",
            "options": { "baseURL": g.base_v1(), "apiKey": g.key },
            "models": models,
        }),
    );
    root.insert("model".into(), json!(format!("cartelink/{}", g.model)));
    if !g.fast.is_empty() {
        root.insert("small_model".into(), json!(format!("cartelink/{}", g.fast)));
    }
    Ok(to_pretty(root))
}

pub fn opencode_configured(existing: &str, g: &Gateway) -> bool {
    let Ok(root) = parse_json_object(Some(existing)) else { return false };
    let Some(opt) = root.get("provider").and_then(|p| p.get("cartelink")).and_then(|c| c.get("options")) else { return false };
    let key = opt.get("apiKey").and_then(Value::as_str).unwrap_or("");
    same_url(opt.get("baseURL").and_then(Value::as_str).unwrap_or(""), &g.base_v1()) && (key == g.key || key == "{env:CARTELINK_API_KEY}")
}

/// ~/.qwen/settings.json: OpenAI-compatible providers pointing at CarteLink.
pub fn merge_qwen(existing: Option<&str>, g: &Gateway) -> Result<String, String> {
    let mut root = parse_json_object(existing)?;
    let base_v1 = g.base_v1();
    {
        let mp = obj(&mut root, "modelProviders");
        let list = mp.entry("openai").or_insert_with(|| json!([]));
        if !list.is_array() {
            *list = json!([]);
        }
        let arr = list.as_array_mut().expect("array");
        // Earlier CarteLink entries (any address) are replaced, the user's own stay.
        arr.retain(|e| {
            let name = e.get("name").and_then(Value::as_str).unwrap_or("");
            let url = e.get("baseUrl").and_then(Value::as_str).unwrap_or("");
            !(name.starts_with("CarteLink ") || same_url(url, &base_v1))
        });
        let mut seen = Vec::new();
        for m in [&g.model, &g.fast] {
            if m.is_empty() || seen.contains(m) {
                continue;
            }
            seen.push(m.clone());
            arr.push(json!({ "id": m, "name": format!("CarteLink {m}"), "baseUrl": base_v1, "envKey": KEY_ENV }));
        }
    }
    obj(&mut root, "env").insert(KEY_ENV.into(), json!(g.key));
    obj(obj(&mut root, "security"), "auth").insert("selectedType".into(), json!("openai"));
    obj(&mut root, "model").insert("name".into(), json!(g.model));
    Ok(to_pretty(root))
}

pub fn qwen_configured(existing: &str, g: &Gateway) -> bool {
    let Ok(root) = parse_json_object(Some(existing)) else { return false };
    let key_ok = root.get("env").and_then(|e| e.get(KEY_ENV)).and_then(Value::as_str) == Some(g.key.as_str());
    let url_ok = root
        .get("modelProviders")
        .and_then(|m| m.get("openai"))
        .and_then(Value::as_array)
        .is_some_and(|a| a.iter().any(|e| same_url(e.get("baseUrl").and_then(Value::as_str).unwrap_or(""), &g.base_v1())));
    key_ok && url_ok
}

// ------------------------------------------------------------------ TOML ----

/// ~/.codex/config.toml: `model_provider = "cartelink"` and its provider
/// table; comments, formatting and every other key stay.
pub fn merge_codex(existing: Option<&str>, g: &Gateway) -> Result<String, String> {
    use toml_edit::{DocumentMut, Item, Table, value};
    let text = existing.unwrap_or("").trim_start_matches('\u{feff}');
    let mut doc: DocumentMut = text.parse().map_err(|e| format!("config.toml не читається ({e}) — виправ його або підключи вручну"))?;
    doc["model"] = value(g.model.as_str());
    doc["model_provider"] = value("cartelink");
    if g.context > 0 {
        doc["model_context_window"] = value(g.context);
        doc["model_auto_compact_token_limit"] = value(g.context * 9 / 10);
    } else {
        // Numbers of an earlier model would be wrong for this one.
        doc.remove("model_context_window");
        doc.remove("model_auto_compact_token_limit");
    }
    if !doc.get("model_providers").is_some_and(Item::is_table_like) {
        let mut t = Table::new();
        t.set_implicit(true);
        doc["model_providers"] = Item::Table(t);
    }
    let mut p = Table::new();
    p["name"] = value("CarteLink");
    p["base_url"] = value(g.base_v1());
    p["env_key"] = value(KEY_ENV);
    p["wire_api"] = value("responses");
    let providers = doc["model_providers"].as_table_like_mut().ok_or("model_providers is not a table")?;
    // Keep the position of an existing block; only its values change.
    match providers.get_mut("cartelink").and_then(Item::as_table_like_mut) {
        Some(old) => {
            for (k, v) in p.iter() {
                old.insert(k, v.clone());
            }
        }
        None => {
            providers.insert("cartelink", Item::Table(p));
        }
    }
    Ok(doc.to_string())
}

pub fn codex_configured(existing: &str, g: &Gateway) -> bool {
    let Ok(doc) = existing.parse::<toml_edit::DocumentMut>() else { return false };
    doc.get("model_provider").and_then(|v| v.as_str()) == Some("cartelink")
        && doc
            .get("model_providers")
            .and_then(|m| m.get("cartelink"))
            .and_then(|c| c.get("base_url"))
            .and_then(|v| v.as_str())
            .is_some_and(|u| same_url(u, &g.base_v1()))
}

// ------------------------------------------------------------------- .env ----

/// Sets `KEY=value` lines in a dotenv file; other lines (comments too) stay.
pub fn merge_env_file(existing: Option<&str>, set: &[(&str, &str)]) -> String {
    let mut lines: Vec<String> = existing.unwrap_or("").lines().map(str::to_string).collect();
    for (k, v) in set {
        let line = format!("{k}={v}");
        let pos = lines.iter().position(|l| {
            let t = l.trim_start();
            let t = t.strip_prefix("export ").unwrap_or(t);
            t.split_once('=').is_some_and(|(name, _)| name.trim() == *k)
        });
        match pos {
            Some(i) => lines[i] = line,
            None => lines.push(line),
        }
    }
    let mut out = lines.join("\n");
    out.push('\n');
    out
}

fn env_value<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    text.lines().find_map(|l| {
        let t = l.trim_start();
        let t = t.strip_prefix("export ").unwrap_or(t);
        let (k, v) = t.split_once('=')?;
        (k.trim() == key).then(|| v.trim().trim_matches(['"', '\'']))
    })
}

pub fn merge_gemini(existing: Option<&str>, g: &Gateway) -> String {
    merge_env_file(existing, &[("GOOGLE_GEMINI_BASE_URL", &g.base), ("GEMINI_API_KEY", &g.key), ("GEMINI_MODEL", &g.model)])
}

pub fn gemini_configured(existing: &str, g: &Gateway) -> bool {
    env_value(existing, "GOOGLE_GEMINI_BASE_URL").is_some_and(|u| same_url(u, &g.base))
        && env_value(existing, "GEMINI_API_KEY") == Some(g.key.as_str())
}

// ------------------------------------------------------------- dispatch ----

pub fn render(id: &str, existing: Option<&str>, g: &Gateway) -> Result<String, String> {
    match id {
        "claude-code" => merge_claude(existing, g),
        "codex" => merge_codex(existing, g),
        "opencode" => merge_opencode(existing, g),
        "qwen-code" => merge_qwen(existing, g),
        "gemini-cli" => Ok(merge_gemini(existing, g)),
        _ => Err(format!("unknown program {id}")),
    }
}

pub fn configured(id: &str, existing: &str, g: &Gateway) -> bool {
    match id {
        "claude-code" => claude_configured(existing, g),
        "codex" => codex_configured(existing, g),
        "opencode" => opencode_configured(existing, g),
        "qwen-code" => qwen_configured(existing, g),
        "gemini-cli" => gemini_configured(existing, g),
        _ => false,
    }
}

pub fn status(home: &Path, g: &Gateway) -> Vec<ProgramStatus> {
    PROGRAMS
        .iter()
        .map(|(id, name, rel)| {
            let path = path_for(home, rel);
            let text = std::fs::read_to_string(&path).ok();
            ProgramStatus {
                id: id.to_string(),
                name: name.to_string(),
                path: path.display().to_string(),
                exists: text.is_some(),
                configured: text.as_deref().is_some_and(|t| configured(id, t, g)),
                backup: backup_path(&path).exists() || new_marker(&path).exists(),
            }
        })
        .collect()
}

#[derive(Debug, Serialize)]
pub struct ApplyResult {
    pub path: String,
    pub changed: bool,
}

/// Writes the program's config (backing up the original once).
pub fn apply(home: &Path, id: &str, g: &Gateway) -> Result<ApplyResult, String> {
    let (id, _, rel) = find(id).ok_or_else(|| format!("unknown program {id}"))?;
    let path = path_for(home, rel);
    let existing = match std::fs::read_to_string(&path) {
        Ok(t) => Some(t),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("{}: {e}", path.display())),
    };
    let next = render(id, existing.as_deref(), g)?;
    let shown = path.display().to_string();
    if existing.as_deref() == Some(next.as_str()) {
        return Ok(ApplyResult { path: shown, changed: false });
    }
    let (bak, marker) = (backup_path(&path), new_marker(&path));
    if !bak.exists() && !marker.exists() {
        match &existing {
            Some(_) => {
                std::fs::copy(&path, &bak).map_err(|e| format!("{}: {e}", bak.display()))?;
            }
            None => {
                if let Some(dir) = marker.parent() {
                    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
                }
                std::fs::write(&marker, b"CarteLink created this file; undo deletes it.\n").map_err(|e| format!("{}: {e}", marker.display()))?;
            }
        }
    }
    crate::paths::write_atomic(&path, next.as_bytes()).map_err(|e| format!("{shown}: {e}"))?;
    Ok(ApplyResult { path: shown, changed: true })
}

/// Puts the original file back (or removes the file CarteLink created).
pub fn undo(home: &Path, id: &str) -> Result<ApplyResult, String> {
    let (_, _, rel) = find(id).ok_or_else(|| format!("unknown program {id}"))?;
    let path = path_for(home, rel);
    let shown = path.display().to_string();
    let (bak, marker) = (backup_path(&path), new_marker(&path));
    if bak.exists() {
        let data = std::fs::read(&bak).map_err(|e| format!("{}: {e}", bak.display()))?;
        crate::paths::write_atomic(&path, &data).map_err(|e| format!("{shown}: {e}"))?;
        let _ = std::fs::remove_file(&bak);
        let _ = std::fs::remove_file(&marker);
        return Ok(ApplyResult { path: shown, changed: true });
    }
    if marker.exists() {
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("{shown}: {e}")),
        }
        let _ = std::fs::remove_file(&marker);
        return Ok(ApplyResult { path: shown, changed: true });
    }
    Err("резервної копії немає — CarteLink цей файл не змінював".into())
}

// --------------------------------------------------------- user env var ----

/// Sets the user environment variable Codex reads its key from. Windows: the
/// registry (new terminals see it). Elsewhere: returns the line for the shell profile.
pub fn set_user_env(name: &str, val: &str) -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        let k = windows_registry::CURRENT_USER.create("Environment").map_err(|e| e.to_string())?;
        if k.get_string(name).ok().as_deref() != Some(val) {
            k.set_string(name, val).map_err(|e| e.to_string())?;
            broadcast_env_change();
        }
        Ok(None)
    }
    #[cfg(not(windows))]
    {
        Ok(Some(format!("export {name}={}", shell_quote(val))))
    }
}

#[cfg(not(windows))]
fn shell_quote(s: &str) -> String {
    if s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.:/".contains(c)) { s.to_string() } else { format!("'{}'", s.replace('\'', "'\\''")) }
}

/// Tells Explorer (and programs started from it) that the environment changed.
#[cfg(windows)]
fn broadcast_env_change() {
    std::thread::spawn(|| unsafe {
        use windows::Win32::Foundation::{LPARAM, WPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{HWND_BROADCAST, SMTO_ABORTIFHUNG, SendMessageTimeoutW, WM_SETTINGCHANGE};
        let what: Vec<u16> = "Environment\0".encode_utf16().collect();
        let _ = SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, WPARAM(0), LPARAM(what.as_ptr() as isize), SMTO_ABORTIFHUNG, 3000, None);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gw() -> Gateway {
        Gateway {
            base: "http://127.0.0.1:8317".into(),
            key: "cl-test".into(),
            model: "cartelink-main".into(),
            fast: "cartelink-fast".into(),
            context: 0,
            model_chosen: false,
            fast_chosen: false,
        }
    }

    #[test]
    fn claude_keeps_other_settings() {
        let old = r#"{"permissions":{"allow":["Bash(ls)"]},"env":{"FOO":"1","ANTHROPIC_API_KEY":"sk-real"},"theme":"dark"}"#;
        let out = merge_claude(Some(old), &gw()).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["permissions"]["allow"][0], "Bash(ls)");
        assert_eq!(v["theme"], "dark");
        assert_eq!(v["env"]["FOO"], "1");
        assert_eq!(v["env"]["ANTHROPIC_BASE_URL"], "http://127.0.0.1:8317");
        assert_eq!(v["env"]["ANTHROPIC_AUTH_TOKEN"], "cl-test");
        assert_eq!(v["env"]["CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY"], "1");
        assert!(v["env"].get("ANTHROPIC_API_KEY").is_none());
        assert!(v.get("model").is_none());
        assert!(claude_configured(&out, &gw()));
        assert!(!claude_configured(old, &gw()));
        // Order of the user's keys is kept.
        assert!(out.find("permissions").unwrap() < out.find("theme").unwrap());
    }

    #[test]
    fn claude_refuses_broken_json() {
        assert!(merge_claude(Some("{ // comment\n}"), &gw()).is_err());
        assert!(merge_claude(Some("[1]"), &gw()).is_err());
        assert!(merge_claude(None, &gw()).is_ok());
        assert!(merge_claude(Some("\u{feff}{}"), &gw()).is_ok());
    }

    #[test]
    fn codex_keeps_other_keys() {
        let old = "# my settings\napproval_policy = \"on-request\"\nmodel = \"gpt-5\"\nmodel_context_window = 1\n\n[model_providers.other]\nname = \"Other\"\nbase_url = \"http://x\"\n\n[profiles.fast]\nmodel = \"o4\"\n";
        let mut g = gw();
        g.context = 400_000;
        let out = merge_codex(Some(old), &g).unwrap();
        assert!(out.starts_with("# my settings\n"));
        let doc: toml_edit::DocumentMut = out.parse().unwrap();
        assert_eq!(doc["approval_policy"].as_str(), Some("on-request"));
        assert_eq!(doc["model"].as_str(), Some("cartelink-main"));
        assert_eq!(doc["model_provider"].as_str(), Some("cartelink"));
        assert_eq!(doc["model_context_window"].as_integer(), Some(400_000));
        assert_eq!(doc["model_auto_compact_token_limit"].as_integer(), Some(360_000));
        assert_eq!(doc["model_providers"]["other"]["name"].as_str(), Some("Other"));
        assert_eq!(doc["model_providers"]["cartelink"]["base_url"].as_str(), Some("http://127.0.0.1:8317/v1"));
        assert_eq!(doc["model_providers"]["cartelink"]["env_key"].as_str(), Some("CARTELINK_API_KEY"));
        assert_eq!(doc["model_providers"]["cartelink"]["wire_api"].as_str(), Some("responses"));
        assert_eq!(doc["profiles"]["fast"]["model"].as_str(), Some("o4"));
        assert!(codex_configured(&out, &g));
        assert!(!codex_configured(old, &g));
        // Applying twice changes nothing.
        assert_eq!(merge_codex(Some(&out), &g).unwrap(), out);
        // Unknown window: stale numbers go.
        g.context = 0;
        let out2 = merge_codex(Some(&out), &g).unwrap();
        assert!(!out2.contains("model_context_window"));
    }

    #[test]
    fn codex_from_empty_file() {
        let out = merge_codex(None, &gw()).unwrap();
        let doc: toml_edit::DocumentMut = out.parse().unwrap();
        assert_eq!(doc["model_providers"]["cartelink"]["name"].as_str(), Some("CarteLink"));
        // Top-level keys come before the table and no empty [model_providers] header.
        assert!(out.find("model_provider =").unwrap() < out.find("[model_providers.cartelink]").unwrap());
        assert!(!out.contains("[model_providers]\n"));
        assert!(merge_codex(Some("model = = 1"), &gw()).is_err());
    }

    #[test]
    fn opencode_and_qwen_merge() {
        let old = r#"{"theme":"x","provider":{"mine":{"name":"Mine"}}}"#;
        let out = merge_opencode(Some(old), &gw()).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["theme"], "x");
        assert_eq!(v["provider"]["mine"]["name"], "Mine");
        assert_eq!(v["provider"]["cartelink"]["options"]["baseURL"], "http://127.0.0.1:8317/v1");
        assert_eq!(v["model"], "cartelink/cartelink-main");
        assert!(opencode_configured(&out, &gw()));

        let old = r#"{"modelProviders":{"openai":[{"id":"m","name":"Mine","baseUrl":"http://other/v1"},{"id":"x","name":"CarteLink x","baseUrl":"http://127.0.0.1:9999/v1"}]},"ui":{"theme":"y"}}"#;
        let out = merge_qwen(Some(old), &gw()).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        let list = v["modelProviders"]["openai"].as_array().unwrap();
        assert_eq!(list.len(), 3);
        assert_eq!(list[0]["name"], "Mine");
        assert_eq!(v["ui"]["theme"], "y");
        assert_eq!(v["env"]["CARTELINK_API_KEY"], "cl-test");
        assert!(qwen_configured(&out, &gw()));
    }

    #[test]
    fn env_file_merge() {
        let old = "# comment\nOTHER=1\nexport GEMINI_API_KEY=old\n";
        let out = merge_gemini(Some(old), &gw());
        assert_eq!(out, "# comment\nOTHER=1\nGEMINI_API_KEY=cl-test\nGOOGLE_GEMINI_BASE_URL=http://127.0.0.1:8317\nGEMINI_MODEL=cartelink-main\n");
        assert!(gemini_configured(&out, &gw()));
        assert!(!gemini_configured(old, &gw()));
    }

    #[test]
    fn apply_and_undo_in_temp_home() {
        let home = std::env::temp_dir().join(format!("cl-connect-test-{}", crate::util::random_hex(6)));
        let g = gw();
        // No file yet: created, undo deletes it.
        let r = apply(&home, "claude-code", &g).unwrap();
        assert!(r.changed);
        let p = path_for(&home, ".claude/settings.json");
        assert!(p.exists());
        assert!(!apply(&home, "claude-code", &g).unwrap().changed);
        assert!(status(&home, &g).iter().any(|s| s.id == "claude-code" && s.configured && s.backup));
        undo(&home, "claude-code").unwrap();
        assert!(!p.exists());
        assert!(undo(&home, "claude-code").is_err());
        // Existing file: backed up once, restored exactly.
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, "{\"a\":1}").unwrap();
        apply(&home, "claude-code", &g).unwrap();
        let mut g2 = g.clone();
        g2.key = "cl-other".into();
        apply(&home, "claude-code", &g2).unwrap();
        assert_eq!(std::fs::read_to_string(backup_path(&p)).unwrap(), "{\"a\":1}");
        undo(&home, "claude-code").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "{\"a\":1}");
        assert!(apply(&home, "nope", &g).is_err());
        let _ = std::fs::remove_dir_all(&home);
    }
}
