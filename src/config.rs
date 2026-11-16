//! `config.json`: CarteLink's own settings. Compatible with the 2.x files
//! (schema 2) and migrated to schema 3 on the first save.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::paths;
use crate::util::random_hex;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const DEFAULT_PORT: u16 = 8317;
pub const KEY_PREFIX: &str = "cl-";
pub const SECRET_PREFIX: &str = "cl-mgmt-";
/// Keys limited to chosen models. A key with this prefix that has no record in
/// `scopedKeys` is refused, never treated as a full-access key.
pub const SCOPED_KEY_PREFIX: &str = "cl-api-";
const SCHEMA: u32 = 3;

/// UI designs shipped with the app ("" = the default).
pub const THEMES: [&str; 15] = [
    "",
    "datamatics",
    "departures",
    "transit",
    "wayfinding",
    "dense",
    "tiles",
    "pulsar",
    "atlas",
    "boarding",
    "cassette",
    "spectrum",
    "darkroom",
    "warm",
    "custom",
];

/// Exact client model names that select each universal tier (case-insensitive,
/// never a substring).
pub const TIER_ALIASES: [(&str, &[&str]); 3] = [
    ("fast", &["cartelink-fast", "claude-cartelink-fast", "cursor-small", "codex-mini", "windsurf-fast", "cascade-fast"]),
    (
        "main",
        &[
            "cartelink-main",
            "claude-cartelink-main",
            "cursor-sonnet",
            "cursor-primary",
            "cursor-default",
            "codex-smart",
            "codex-default",
            "windsurf-base",
            "cascade-base",
        ],
    ),
    ("max", &["cartelink-max", "claude-cartelink-max", "codex-reason", "windsurf-adv", "cascade-adv", "cascade-advanced"]),
];

pub const THINKING_LEVELS: [&str; 6] = ["off", "low", "medium", "high", "max", "dynamic"];

/// Legacy "provider:" prefixes old UI versions put in front of a model id.
const LEGACY_PROVIDER_TAGS: [&str; 10] =
    ["account", "provider", "compat", "openai", "anthropic", "claude", "codex", "gemini", "antigravity", "vertex"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub schema: u32,
    pub api_key: String,
    pub require_key: bool,
    pub providers: Vec<Provider>,
    pub routing: Routing,
    pub cliproxy: Cliproxy,
    pub scoped_keys: Vec<ScopedKey>,
    pub model_blacklist: Vec<String>,
    pub prompting: Prompting,
    pub desktop: Desktop,
    pub hidden_accounts: Vec<String>,
    pub accounts: AccountsPolicy,
    pub notify: Notify,
    pub inspector: Inspector,
    /// Interface layout and look chosen by the user (sidebar order, hidden
    /// elements, dashboard widgets, custom design tokens). Owned by the UI.
    pub ui: Value,
    /// Keys this version does not know, kept so a newer file survives a save.
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            schema: 0,
            api_key: String::new(),
            require_key: true,
            providers: vec![],
            routing: Routing::default(),
            cliproxy: Cliproxy::default(),
            scoped_keys: vec![],
            model_blacklist: vec![],
            prompting: Prompting::default(),
            desktop: Desktop::default(),
            hidden_accounts: vec![],
            accounts: AccountsPolicy::default(),
            notify: Notify::default(),
            inspector: Inspector::default(),
            ui: Value::Object(Default::default()),
            extra: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Desktop {
    pub close_to_tray: bool,
    pub lang: String,
    pub theme: String,
    pub switcher: Switcher,
    /// Start the app hidden in the tray even when started by hand.
    pub start_hidden: bool,
}

impl Default for Desktop {
    fn default() -> Self {
        Desktop { close_to_tray: true, lang: String::new(), theme: String::new(), switcher: Switcher::default(), start_hidden: false }
    }
}

/// The always-on-top model switcher: two preset models and which one is live.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Switcher {
    pub enabled: bool,
    pub model1: String,
    pub model2: String,
    /// 1 or 2; 0 = neither.
    pub active: u8,
    /// After the first successful answer by model 1 everything moves to model 2
    /// (one-shot; applying preset 1 again re-arms it).
    pub auto_switch: bool,
    pub auto_armed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pos: Option<[i32; 2]>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Routing {
    /// "tiers" | "table"
    pub mode: String,
    pub default_provider_id: String,
    pub default_model: String,
    pub model_map: BTreeMap<String, String>,
    pub tiers: Tiers,
    /// "smart" | "passthrough" | "always"
    pub unmapped_strategy: String,
    pub custom_points: Vec<CustomPoint>,
    /// Fallback chains: when the model (as resolved) fails before answering
    /// (limit, server error, model unavailable), the next one is tried.
    pub fallbacks: BTreeMap<String, Vec<String>>,
    /// Per-program rules: requests whose User-Agent matches go to their own model.
    pub app_rules: Vec<AppRule>,
}

/// A program's own model, matched by its User-Agent (case-insensitive substring).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppRule {
    pub id: String,
    /// What the user calls it ("Cursor").
    pub name: String,
    /// Substring of the User-Agent ("cursor", "claude-cli").
    pub matcher: String,
    /// The model every request of this program goes to ("" = normal routing).
    pub model: String,
    #[serde(default = "yes")]
    pub enabled: bool,
}

impl Default for Routing {
    fn default() -> Self {
        Routing {
            mode: "tiers".into(),
            default_provider_id: String::new(),
            default_model: String::new(),
            model_map: BTreeMap::new(),
            tiers: Tiers::default(),
            unmapped_strategy: "smart".into(),
            custom_points: vec![],
            fallbacks: BTreeMap::new(),
            app_rules: vec![],
        }
    }
}

impl Routing {
    /// One model answers everything: every tier, the default model, every
    /// exact swap and table row.
    pub fn apply_all(&mut self, model: &str) {
        let m = model.trim().to_string();
        let t = &mut self.tiers;
        t.haiku = m.clone();
        t.sonnet = m.clone();
        t.opus = m.clone();
        t.fast = m.clone();
        t.main = m.clone();
        t.max = m.clone();
        self.default_model = m.clone();
        self.default_provider_id.clear();
        for v in self.model_map.values_mut() {
            *v = m.clone();
        }
        for cp in &self.custom_points {
            self.model_map.insert(cp.model.clone(), m.clone());
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CustomPoint {
    pub label: String,
    pub model: String,
}

/// Tier targets. The cursor*/codex*/windsurf* fields are 2.2.0 leftovers,
/// folded into fast/main/max on load and never written again.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Tiers {
    pub haiku: String,
    pub sonnet: String,
    pub opus: String,
    pub fast: String,
    pub main: String,
    pub max: String,
    #[serde(skip_serializing)]
    pub cursor_small: String,
    #[serde(skip_serializing)]
    pub cursor_sonnet: String,
    #[serde(skip_serializing)]
    pub cursor_primary: String,
    #[serde(skip_serializing)]
    pub codex_mini: String,
    #[serde(skip_serializing)]
    pub codex_smart: String,
    #[serde(skip_serializing)]
    pub codex_reason: String,
    #[serde(skip_serializing)]
    pub windsurf_fast: String,
    #[serde(skip_serializing)]
    pub windsurf_base: String,
    #[serde(skip_serializing)]
    pub windsurf_adv: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Cliproxy {
    pub port: u16,
    pub host: String,
    /// Extra full-access client keys (the gateway key is always valid too).
    pub api_keys: Vec<String>,
    #[serde(rename = "extraConfigYAML")]
    pub extra_config_yaml: String,
    pub management_secret: String,
}

impl Default for Cliproxy {
    fn default() -> Self {
        Cliproxy {
            port: DEFAULT_PORT,
            host: "127.0.0.1".into(),
            api_keys: vec![],
            extra_config_yaml: String::new(),
            management_secret: String::new(),
        }
    }
}

/// A user-visible model source: an account turned into a provider entry
/// (BaseURL "embedded://cliproxy") or a manual entry.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Provider {
    pub id: String,
    pub label: String,
    pub base_url: String,
    pub format: String,
    pub keys: Vec<String>,
    pub models: Vec<String>,
    pub extra_headers: BTreeMap<String, String>,
    pub enabled: bool,
}

/// A client key that sees and accepts only its own models, outside routing.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ScopedKey {
    pub id: String,
    pub name: String,
    pub key: String,
    pub models: Vec<String>,
    /// Unix ms; 0 = unknown (keys made by 2.x).
    pub created: i64,
    /// Turned off keys are refused like deleted ones but keep their record.
    #[serde(default = "yes")]
    pub enabled: bool,
    /// Requests per minute (0 = no limit).
    pub rpm: u32,
    /// Requests per day (0 = no limit).
    pub daily_requests: u32,
    /// Unix ms after which the key stops working (0 = never).
    pub expires: i64,
    /// Free text: which device or person has it.
    pub note: String,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Prompting {
    pub enabled: bool,
    /// "prepend" | "append" | "replace"
    pub mode: String,
    pub text: String,
    pub agent_md: String,
    pub agent_md_name: String,
    pub agent_md_enabled: bool,
    /// "all" | "anthropic" | "openai"
    pub scope: String,
    pub thinking: Thinking,
}

impl Default for Prompting {
    fn default() -> Self {
        Prompting {
            enabled: false,
            mode: "prepend".into(),
            text: String::new(),
            agent_md: String::new(),
            agent_md_name: String::new(),
            agent_md_enabled: false,
            scope: "all".into(),
            thinking: Thinking::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Thinking {
    pub enabled: bool,
    pub level: String,
    pub budget: i64,
    pub r#override: bool,
}

impl Default for Thinking {
    fn default() -> Self {
        Thinking { enabled: false, level: "medium".into(), budget: 0, r#override: false }
    }
}

/// What CarteLink does about accounts that stopped working.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AccountsPolicy {
    /// Delete accounts whose sign-in has been rejected for `auto_clean_hours`.
    pub auto_clean: bool,
    pub auto_clean_hours: u32,
    /// Check every account's sign-in every N hours (0 = off).
    pub check_hours: u32,
}

impl Default for AccountsPolicy {
    fn default() -> Self {
        AccountsPolicy { auto_clean: false, auto_clean_hours: 24, check_hours: 6 }
    }
}

/// System notifications from the tray.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Notify {
    pub enabled: bool,
    /// An account's sign-in was rejected.
    pub account_dead: bool,
    /// An account hit its limit.
    pub limit: bool,
    /// The engine stopped and was restarted.
    pub engine: bool,
    /// A fallback model answered instead of the requested one.
    pub fallback: bool,
}

impl Default for Notify {
    fn default() -> Self {
        Notify { enabled: true, account_dead: true, limit: false, engine: true, fallback: false }
    }
}

/// The request inspector keeps the last requests with their bodies in memory
/// (never on disk). Off by default: bodies hold the user's prompts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Inspector {
    pub enabled: bool,
    /// How many requests to keep (10..500).
    pub keep: u32,
}

impl Default for Inspector {
    fn default() -> Self {
        Inspector { enabled: false, keep: 100 }
    }
}

#[derive(Debug)]
pub enum LoadError {
    /// The file exists but cannot be read (locked): starting with defaults
    /// would overwrite the real settings on the next save.
    Unreadable(std::io::Error),
}

impl std::fmt::Display for LoadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LoadError::Unreadable(e) => write!(f, "config.json: {e}"),
        }
    }
}

/// Loads config.json. A corrupt file is moved aside and defaults are used;
/// the second value is then a warning for the user.
pub fn load() -> Result<(Config, Option<String>), LoadError> {
    let path = paths::config_json();
    let raw = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(LoadError::Unreadable(e)),
    };
    let text = String::from_utf8_lossy(&raw);
    let text = text.trim_start_matches('\u{feff}');
    if text.trim().is_empty() {
        let mut c = Config::default();
        normalize(&mut c);
        // An existing but empty file (a power cut during a save on 2.x) means the
        // settings are gone: say so instead of quietly starting with a new key.
        let warning = (!raw.is_empty() || path.exists()).then(|| {
            "config.json був порожній — CarteLink почав з налаштувань за замовчуванням і новим ключем. Скопіюй новий ключ у свої програми."
                .to_string()
        });
        return Ok((c, warning));
    }
    match serde_json::from_str::<Config>(text) {
        Ok(mut c) => {
            normalize(&mut c);
            Ok((c, None))
        }
        Err(e) => {
            let stamp = jiff::Timestamp::now().strftime("%Y%m%d-%H%M%S").to_string();
            let backup = path.with_file_name(format!("config.json.corrupt-{stamp}"));
            let _ = std::fs::rename(&path, &backup);
            let mut c = Config::default();
            normalize(&mut c);
            Ok((c, Some(format!("config.json був пошкоджений і замінений на налаштування за замовчуванням.\n\n{e}\n\nКопія: {}", backup.display()))))
        }
    }
}

impl Config {
    pub fn save(&self) -> std::io::Result<()> {
        let mut out = serde_json::to_vec_pretty(self).map_err(std::io::Error::other)?;
        out.push(b'\n');
        paths::write_atomic(&paths::config_json(), &out)
    }

    pub fn find_scoped_key(&self, key: &str) -> Option<&ScopedKey> {
        self.scoped_keys.iter().find(|k| k.key == key)
    }
}

pub fn new_key() -> String {
    format!("{KEY_PREFIX}{}", random_hex(24))
}
pub fn new_scoped_key() -> String {
    format!("{SCOPED_KEY_PREFIX}{}", random_hex(24))
}

pub fn valid_theme(t: &str) -> bool {
    THEMES.contains(&t) || t == "console" || t == "graphite"
}

/// Drops a legacy "provider:" prefix. Only a known provider tag counts as a
/// prefix: real ids contain colons too ("qwen3:32b").
pub fn strip_provider_prefix(cfg: Option<&Config>, model: &str) -> String {
    let Some(i) = model.find(':') else { return model.to_string() };
    if i == 0 || i == model.len() - 1 || model.contains("://") {
        return model.to_string();
    }
    let prefix = model[..i].trim().to_ascii_lowercase();
    if LEGACY_PROVIDER_TAGS.contains(&prefix.as_str()) {
        return model[i + 1..].to_string();
    }
    if let Some(cfg) = cfg
        && cfg.providers.iter().any(|p| !p.id.trim().is_empty() && p.id.trim().eq_ignore_ascii_case(&prefix))
    {
        return model[i + 1..].to_string();
    }
    model.to_string()
}

fn clean_strings(v: &mut Vec<String>) {
    v.iter_mut().for_each(|s| *s = s.trim().to_string());
    v.retain(|s| !s.is_empty());
}

/// Trims a model list and drops duplicates (case-insensitive).
pub fn clean_models(input: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    input.iter().map(|m| m.trim().to_string()).filter(|m| !m.is_empty() && seen.insert(m.to_ascii_lowercase())).collect()
}

/// Load-time fixups and validation. Idempotent.
pub fn normalize(c: &mut Config) {
    if c.api_key.trim().is_empty() {
        c.api_key = new_key();
    }
    c.api_key = c.api_key.trim().to_string();
    if c.routing.mode != "table" {
        c.routing.mode = "tiers".into();
    }
    if !matches!(c.routing.unmapped_strategy.as_str(), "passthrough" | "always" | "smart") {
        c.routing.unmapped_strategy = "smart".into();
    }
    c.routing.model_map.retain(|k, _| !k.trim().is_empty());
    fold_legacy_tiers(&mut c.routing.tiers);
    {
        let mut seen = std::collections::HashSet::new();
        let pts = std::mem::take(&mut c.routing.custom_points);
        for mut p in pts {
            p.model = p.model.trim().to_string();
            p.label = p.label.trim().to_string();
            if p.model.is_empty() || !seen.insert(p.model.to_ascii_lowercase()) {
                continue;
            }
            if p.label.is_empty() {
                p.label = p.model.clone();
            }
            c.routing.custom_points.push(p);
        }
    }
    let sw = &mut c.desktop.switcher;
    if sw.active != 1 && sw.active != 2 {
        sw.active = 0;
    }
    sw.model1 = sw.model1.trim().to_string();
    sw.model2 = sw.model2.trim().to_string();
    if sw.auto_armed && !(sw.auto_switch && sw.active == 1) {
        sw.auto_armed = false;
    }
    c.desktop.lang = c.desktop.lang.trim().to_string();
    // 2.x designs: "glass" became Aurora, "terminal" became Phosphor.
    match c.desktop.theme.as_str() {
        // 3.0 previews: colour-only themes became the nearest full design.
        "glass" | "aurora" | "sunset" | "synthwave" => c.desktop.theme = "pulsar".into(),
        "terminal" | "phosphor" => c.desktop.theme = "datamatics".into(),
        "paper" | "swiss" => c.desktop.theme = "warm".into(),
        "nord" => c.desktop.theme = String::new(),
        "graphite" => c.desktop.theme = String::new(),
        _ => {}
    }
    if c.desktop.theme == "console" || !valid_theme(&c.desktop.theme) {
        c.desktop.theme = String::new();
    }
    let p = &mut c.prompting;
    if !matches!(p.mode.as_str(), "append" | "replace") {
        p.mode = "prepend".into();
    }
    if !matches!(p.scope.as_str(), "anthropic" | "openai") {
        p.scope = "all".into();
    }
    if !THINKING_LEVELS.contains(&p.thinking.level.as_str()) {
        p.thinking.level = "medium".into();
    }
    p.thinking.budget = p.thinking.budget.max(0);
    p.agent_md_name = p.agent_md_name.trim().to_string();
    if c.schema < 2 {
        // <= 2.2.0 silently saved an auto-moved port (8318…8417).
        if c.cliproxy.port > DEFAULT_PORT && c.cliproxy.port <= DEFAULT_PORT + 100 {
            c.cliproxy.port = DEFAULT_PORT;
        }
    }
    c.schema = c.schema.max(SCHEMA);
    clean_strings(&mut c.hidden_accounts);
    c.hidden_accounts.dedup();
    let provs = std::mem::take(&mut c.providers);
    for mut p in provs {
        p.id = p.id.trim().to_string();
        p.label = p.label.trim().to_string();
        if p.id.is_empty() && p.label.is_empty() {
            continue;
        }
        if p.id.is_empty() {
            p.id = format!("p-{}", random_hex(4));
        }
        if p.label.is_empty() {
            p.label = p.id.clone();
        }
        p.base_url = p.base_url.trim().trim_end_matches('/').to_string();
        p.format = match p.format.trim() {
            "anthropic" => "anthropic".into(),
            "gemini" => "gemini".into(),
            _ => "openai".into(),
        };
        clean_strings(&mut p.keys);
        clean_strings(&mut p.models);
        c.providers.push(p);
    }
    clean_strings(&mut c.model_blacklist);
    let cp = &mut c.cliproxy;
    cp.host = cp.host.trim().to_string();
    if cp.host.is_empty() {
        cp.host = "127.0.0.1".into();
    }
    if cp.port == 0 {
        cp.port = DEFAULT_PORT;
    }
    cp.management_secret = cp.management_secret.trim().to_string();
    if cp.management_secret.is_empty() {
        cp.management_secret = format!("{SECRET_PREFIX}{}", random_hex(18));
    }
    // Extra full keys: no scoped keys, no duplicates, not the gateway key, no
    // placeholder keys of old versions.
    let api_key = c.api_key.clone();
    let mut seen = std::collections::HashSet::new();
    cp.api_keys.retain(|k| {
        let k = k.trim();
        !k.is_empty()
            && !k.starts_with(SCOPED_KEY_PREFIX)
            && k != api_key
            && k != "cg-default-key"
            && k != "vg-cliproxy-default-key"
            && seen.insert(k.to_string())
    });
    cp.api_keys.iter_mut().for_each(|k| *k = k.trim().to_string());
    let keys = std::mem::take(&mut c.scoped_keys);
    let mut seen_ids = std::collections::HashSet::new();
    for mut k in keys {
        k.key = k.key.trim().to_string();
        if k.key.is_empty() {
            continue;
        }
        k.id = k.id.trim().to_string();
        if k.id.is_empty() || !seen_ids.insert(k.id.clone()) {
            k.id = format!("k-{}", random_hex(4));
            seen_ids.insert(k.id.clone());
        }
        k.name = k.name.trim().to_string();
        k.models = clean_models(&k.models);
        c.scoped_keys.push(k);
    }
    if c.accounts.auto_clean_hours == 0 {
        c.accounts.auto_clean_hours = 24;
    }
    c.routing.fallbacks = std::mem::take(&mut c.routing.fallbacks)
        .into_iter()
        .map(|(k, v)| (k.trim().to_string(), clean_models(&v).into_iter().filter(|m| !m.eq_ignore_ascii_case(k.trim())).collect::<Vec<_>>()))
        .filter(|(k, v)| !k.is_empty() && !v.is_empty())
        .collect();
    let rules = std::mem::take(&mut c.routing.app_rules);
    for mut r in rules {
        r.matcher = r.matcher.trim().to_string();
        r.name = r.name.trim().to_string();
        r.model = r.model.trim().to_string();
        if r.matcher.is_empty() {
            continue;
        }
        if r.id.is_empty() {
            r.id = format!("r-{}", random_hex(4));
        }
        if r.name.is_empty() {
            r.name = r.matcher.clone();
        }
        c.routing.app_rules.push(r);
    }
    c.inspector.keep = c.inspector.keep.clamp(10, 500);
    if !c.ui.is_object() {
        c.ui = Value::Object(Default::default());
    }
    // The Telegram sign-in of 2.x is gone for good (2.8.0); drop its leftovers.
    c.extra.remove("auth");
}

fn fold_legacy_tiers(t: &mut Tiers) {
    fn first(cur: &str, vals: &[&str]) -> String {
        if !cur.trim().is_empty() {
            return cur.trim().to_string();
        }
        vals.iter().map(|v| v.trim()).find(|v| !v.is_empty()).unwrap_or("").to_string()
    }
    t.fast = first(&t.fast, &[&t.cursor_small, &t.codex_mini, &t.windsurf_fast]);
    t.main = first(&t.main, &[&t.cursor_sonnet, &t.cursor_primary, &t.codex_smart, &t.windsurf_base]);
    t.max = first(&t.max, &[&t.codex_reason, &t.windsurf_adv]);
    for f in [
        &mut t.cursor_small,
        &mut t.cursor_sonnet,
        &mut t.cursor_primary,
        &mut t.codex_mini,
        &mut t.codex_smart,
        &mut t.codex_reason,
        &mut t.windsurf_fast,
        &mut t.windsurf_base,
        &mut t.windsurf_adv,
    ] {
        f.clear();
    }
    for f in [&mut t.haiku, &mut t.sonnet, &mut t.opus] {
        *f = f.trim().to_string();
    }
}

/// A bind host as something a client can connect to.
pub fn display_host(h: &str) -> String {
    match h.trim() {
        "" | "0.0.0.0" | "::" | "[::]" => "127.0.0.1".into(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_tiers_fold() {
        let mut c: Config = serde_json::from_str(r#"{"routing":{"tiers":{"cursorSmall":"a","codexSmart":"b","windsurfAdv":"c"}}}"#).unwrap();
        normalize(&mut c);
        assert_eq!(c.routing.tiers.fast, "a");
        assert_eq!(c.routing.tiers.main, "b");
        assert_eq!(c.routing.tiers.max, "c");
        let out = serde_json::to_string(&c).unwrap();
        assert!(!out.contains("cursorSmall"));
    }

    #[test]
    fn unknown_keys_survive() {
        let mut c: Config = serde_json::from_str(r#"{"futureThing":{"x":1},"apiKey":"cl-x"}"#).unwrap();
        normalize(&mut c);
        let out = serde_json::to_string(&c).unwrap();
        assert!(out.contains("futureThing"));
    }

    #[test]
    fn old_theme_names_map_to_new_worlds() {
        for (old, new) in [
            ("glass", "pulsar"),
            ("terminal", "datamatics"),
            ("console", ""),
            ("graphite", ""),
            ("bogus", ""),
            ("swiss", "warm"),
            ("transit", "transit"),
        ] {
            let mut c: Config = serde_json::from_str(&format!(r#"{{"desktop":{{"theme":"{old}"}}}}"#)).unwrap();
            normalize(&mut c);
            assert_eq!(c.desktop.theme, new, "{old}");
        }
    }

    #[test]
    fn telegram_auth_leftover_is_dropped() {
        let mut c: Config = serde_json::from_str(r#"{"auth":{"session":"x"}}"#).unwrap();
        normalize(&mut c);
        assert!(!serde_json::to_string(&c).unwrap().contains("session"));
    }

    #[test]
    fn provider_prefix() {
        assert_eq!(strip_provider_prefix(None, "qwen3:32b"), "qwen3:32b");
        assert_eq!(strip_provider_prefix(None, "account:gpt-5"), "gpt-5");
        assert_eq!(strip_provider_prefix(None, "http://x"), "http://x");
    }

    #[test]
    fn scoped_and_placeholder_keys_leave_full_list() {
        let mut c: Config =
            serde_json::from_str(r#"{"apiKey":"cl-main","cliproxy":{"apiKeys":["cl-main","cl-api-x","cg-default-key","cl-other","cl-other"]}}"#)
                .unwrap();
        normalize(&mut c);
        assert_eq!(c.cliproxy.api_keys, vec!["cl-other"]);
    }
}
