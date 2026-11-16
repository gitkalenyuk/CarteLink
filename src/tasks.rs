//! Background loops.

use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Duration;

use serde_json::{Value, json};

use crate::app::{LiveEvent, app};
use crate::errlog::ErrorEntry;
use crate::paths;
use crate::util::now_ms;

pub fn spawn_all() {
    tokio::spawn(metrics_loop());
    tokio::spawn(catalog_loop());
    tokio::spawn(backup_loop());
    tokio::spawn(accounts_loop());
    tokio::spawn(reinstall_plugins());
}

/// Drains the engine's usage-queue (only the backend reads it).
async fn metrics_loop() {
    let a = app();
    let mut tick = tokio::time::interval(Duration::from_secs(3));
    let mut flush_at = now_ms();
    loop {
        tick.tick().await;
        if a.engine.running() {
            for _ in 0..20 {
                let r = a.mgmt_get("/v0/management/usage-queue?count=200").await;
                if !r.ok() {
                    break;
                }
                let recs = crate::metrics::parse_queue(&r.body);
                let n = recs.len();
                if n > 0 {
                    a.metrics.ingest(recs);
                    a.emit(LiveEvent::Changed { what: "metrics".into() });
                }
                if n < 200 {
                    break;
                }
            }
        }
        if now_ms() - flush_at >= 10_000 {
            flush_at = now_ms();
            let m = &a.metrics;
            tokio::task::block_in_place(|| m.flush());
        }
    }
}

/// Model catalog (the "smart" fallback) and capabilities: soon after the
/// engine starts (accounts register over the first seconds), then each minute.
async fn catalog_loop() {
    let a = app();
    let mut n: u64 = 0;
    loop {
        let wait = if n < 4 { 4 } else { 60 };
        tokio::time::sleep(Duration::from_secs(wait)).await;
        n += 1;
        if !a.engine.running() {
            n = 0;
            // A start that failed before the process existed (bad extra YAML,
            // binary locked by a scanner) gets retried once the cause is gone.
            if a.engine.is_down().await {
                let cfg = a.config();
                if let Err(e) = a.engine.start(&cfg).await {
                    tracing::warn!("engine start retry: {e}");
                }
            }
            continue;
        }
        a.refresh_catalog().await;
        a.refresh_caps().await;
        if n.is_multiple_of(2) {
            sync_account_providers().await;
        }
    }
}

/// A last-known-good copy of config.yaml (the engine writes it in place).
async fn backup_loop() {
    loop {
        tokio::time::sleep(Duration::from_secs(300)).await;
        let p = paths::engine_config();
        let _ = tokio::task::spawn_blocking(move || crate::engine::backup_config_yaml(&p)).await;
    }
}

/// Every working account gets a provider entry with its real models (the
/// Models page offers them); the user's removals are respected.
pub async fn sync_account_providers() {
    let a = app();
    let Some(files) = a.auth_files().await else { return };
    let cfg = a.config();
    for f in files {
        let name =
            ["name", "filename", "id"].iter().find_map(|k| f.get(*k).and_then(Value::as_str).filter(|s| !s.is_empty())).unwrap_or("").to_string();
        if name.is_empty() || f.get("disabled").and_then(Value::as_bool).unwrap_or(false) {
            continue;
        }
        let id = crate::api::account_provider_id(&name);
        if cfg.hidden_accounts.contains(&id) || cfg.providers.iter().any(|p| p.id == id) {
            continue;
        }
        let body = bytes::Bytes::from(serde_json::json!({"name": name, "auto": true}).to_string());
        let _ = crate::api::account_to_provider_pub(body).await;
    }
}

// ------------------------------------------------------------- accounts ----

/// What CarteLink knows about the accounts between checks. `first_bad` is
/// `data/account-health.json` (name → when its sign-in was first seen
/// rejected, unchanged format), which drives the optional auto-clean.
struct Health {
    loaded: bool,
    first_bad: HashMap<String, i64>,
    /// Last state seen per account (memory only).
    last: HashMap<String, String>,
}

static HEALTH: LazyLock<tokio::sync::Mutex<Health>> =
    LazyLock::new(|| tokio::sync::Mutex::new(Health { loaded: false, first_bad: HashMap::new(), last: HashMap::new() }));
/// One full check at a time.
static CHECKING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn health_path() -> std::path::PathBuf {
    paths::data_dir().join("account-health.json")
}

/// Result of an account check (POST /api/accounts/check).
#[derive(Debug, Default, Clone, serde::Serialize)]
pub struct CheckReport {
    pub checked: usize,
    pub ok_count: usize,
    pub invalid: Vec<String>,
    pub limited: Vec<String>,
}

/// A state change worth a notification.
#[derive(Debug, PartialEq, Eq)]
pub enum Alert {
    Dead,
    Limited,
}

/// Whether a state change needs telling. `prev` is None for an account not
/// seen in this run; `known_bad` = already in account-health.json (told before).
pub fn transition(prev: Option<&str>, now: &str, known_bad: bool) -> Option<Alert> {
    match now {
        "invalid" if prev != Some("invalid") && !(prev.is_none() && known_bad) => Some(Alert::Dead),
        "limited" if prev.is_some_and(|p| p != "limited") => Some(Alert::Limited),
        _ => None,
    }
}

/// The state after a refresh: a rejected refresh token means the sign-in is
/// dead even before the engine marks the account.
pub fn effective_state(state: &str, refresh_error: Option<&str>) -> String {
    match refresh_error {
        Some(e) if state != "disabled" && crate::limits::looks_like_auth_failure(e) => "invalid".into(),
        _ => state.to_string(),
    }
}

/// Records the current states, notifies about changes and saves account-health.json.
async fn observe(list: &[crate::limits::Account], refresh_errors: &HashMap<String, String>) -> CheckReport {
    let a = app();
    let mut h = HEALTH.lock().await;
    if !h.loaded {
        h.loaded = true;
        h.first_bad = std::fs::read(health_path()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    }
    let now = now_ms();
    let mut rep = CheckReport { checked: list.len(), ..Default::default() };
    for acc in list {
        let err = refresh_errors.get(&acc.id).or_else(|| refresh_errors.get(&acc.name)).map(String::as_str);
        let state = effective_state(&acc.state, err);
        let shown = if acc.label.is_empty() { acc.name.as_str() } else { acc.label.as_str() };
        let who = if acc.provider.is_empty() { shown.to_string() } else { format!("{shown} ({})", acc.provider) };
        match transition(h.last.get(&acc.name).map(String::as_str), &state, h.first_bad.contains_key(&acc.name)) {
            Some(Alert::Dead) => a.notify("account_dead", "Акаунт не працює", &format!("{who}: вхід відхилено — увійди знову або видали акаунт.")),
            Some(Alert::Limited) => a.notify("limit", "Акаунт на ліміті", &format!("{who}: ліміт вичерпано, запити йдуть іншими акаунтами.")),
            None => {}
        }
        match state.as_str() {
            "invalid" => {
                rep.invalid.push(acc.name.clone());
                h.first_bad.entry(acc.name.clone()).or_insert(now);
            }
            "limited" => rep.limited.push(acc.name.clone()),
            "ok" | "warn" => rep.ok_count += 1,
            _ => {}
        }
        if state != "invalid" {
            h.first_bad.remove(&acc.name);
        }
        h.last.insert(acc.name.clone(), state);
    }
    let names: std::collections::HashSet<&str> = list.iter().map(|x| x.name.as_str()).collect();
    h.first_bad.retain(|n, _| names.contains(n.as_str()));
    h.last.retain(|n, _| names.contains(n.as_str()));
    if let Ok(b) = serde_json::to_vec(&h.first_bad) {
        let _ = paths::write_atomic(&health_path(), &b);
    }
    rep
}

/// Full check: the engine refreshes every account's sign-in (a real call to
/// each provider's token endpoint), then the states are read again.
pub async fn check_accounts() -> Result<CheckReport, String> {
    let _one = CHECKING.lock().await;
    let a = app();
    if !a.engine.running() {
        return Err("Рушій не запущений — зачекай кілька секунд.".into());
    }
    let r = a.mgmt_json(reqwest::Method::POST, "/v0/management/auth-files/refresh", &json!({"all": true})).await;
    let mut errors = HashMap::new();
    if r.ok() {
        for x in r.json().get("results").and_then(Value::as_array).into_iter().flatten() {
            if x.get("success").and_then(Value::as_bool) == Some(false)
                && let Some(id) = x.get("id").and_then(Value::as_str).filter(|s| !s.is_empty())
            {
                errors.insert(id.to_string(), x.get("error").and_then(Value::as_str).unwrap_or("").to_string());
            }
        }
    } else {
        tracing::warn!("auth refresh: HTTP {}", r.status);
    }
    let list = crate::limits::accounts(true).await.ok_or("Рушій не відповідає — спробуй ще раз.")?;
    let rep = observe(&list, &errors).await;
    a.emit(LiveEvent::Changed { what: "accounts".into() });
    Ok(rep)
}

/// Watches account states every 10 min, runs the full check every
/// `accounts.checkHours` (0 = off) and the optional clean-up of accounts whose
/// sign-in has been rejected for a while.
async fn accounts_loop() {
    let a = app();
    let mut last_check: i64 = 0;
    loop {
        tokio::time::sleep(Duration::from_secs(600)).await;
        if !a.engine.running() {
            continue;
        }
        let cfg = a.config();
        let every = cfg.accounts.check_hours as i64 * 3_600_000;
        if every > 0 && now_ms() - last_check >= every {
            last_check = now_ms();
            if let Err(e) = check_accounts().await {
                tracing::warn!("account check: {e}");
                continue;
            }
        } else if let Some(list) = crate::limits::accounts(false).await {
            observe(&list, &HashMap::new()).await;
        } else {
            continue;
        }
        if cfg.accounts.auto_clean {
            auto_clean(cfg.accounts.auto_clean_hours).await;
        }
    }
}

async fn auto_clean(hours: u32) {
    let a = app();
    let limit = hours as i64 * 3_600_000;
    let now = now_ms();
    let due: Vec<String> = HEALTH.lock().await.first_bad.iter().filter(|(_, t)| now - **t >= limit).map(|(n, _)| n.clone()).collect();
    if due.is_empty() {
        return;
    }
    match crate::api::delete_accounts(&due).await {
        Ok((deleted, _)) if !deleted.is_empty() => {
            a.log_error(ErrorEntry {
                kind: "auto".into(),
                message: format!("CarteLink deleted {} account(s) whose sign-in was rejected for {hours} h: {}", deleted.len(), deleted.join(", ")),
                ..Default::default()
            });
            let mut h = HEALTH.lock().await;
            for d in &deleted {
                h.first_bad.remove(d);
                h.last.remove(d);
            }
            if let Ok(b) = serde_json::to_vec(&h.first_bad) {
                let _ = paths::write_atomic(&health_path(), &b);
            }
            drop(h);
            a.emit(LiveEvent::Changed { what: "accounts".into() });
        }
        Ok(_) => {}
        Err(e) => tracing::warn!("auto-clean: {e}"),
    }
}

// -------------------------------------------------------------- restore ----

/// After a restore from a backup: installs the plugins the backup listed
/// (their DLLs are not in it) once the engine is up.
async fn reinstall_plugins() {
    let path = paths::data_dir().join(crate::backup::PENDING_PLUGINS);
    let Ok(raw) = std::fs::read(&path) else { return };
    let ids: Vec<String> = serde_json::from_slice(&raw).unwrap_or_default();
    let a = app();
    for _ in 0..90 {
        if a.engine.running() {
            break;
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    if !a.engine.running() {
        return;
    }
    let installed: Vec<String> = a
        .mgmt_get("/v0/management/plugins")
        .await
        .json()
        .get("plugins")
        .and_then(Value::as_array)
        .map(|l| l.iter().filter_map(|p| p.get("id").and_then(Value::as_str)).map(str::to_string).collect())
        .unwrap_or_default();
    let mut failed = Vec::new();
    for id in ids.iter().filter(|id| !installed.contains(id)) {
        let enc = percent_encoding::utf8_percent_encode(id, percent_encoding::NON_ALPHANUMERIC).to_string();
        let r = a.mgmt_json(reqwest::Method::POST, &format!("/v0/management/plugin-store/{enc}/install"), &json!({})).await;
        if !r.ok() {
            failed.push(id.clone());
        }
    }
    if !failed.is_empty() {
        a.log_error(ErrorEntry {
            kind: "app".into(),
            message: format!("After the restore these plugins could not be installed from the store: {}", failed.join(", ")),
            ..Default::default()
        });
    }
    let _ = std::fs::remove_file(&path);
    a.emit(LiveEvent::Changed { what: "accounts".into() });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transitions() {
        assert_eq!(transition(None, "invalid", false), Some(Alert::Dead));
        assert_eq!(transition(None, "invalid", true), None, "dead before this run: told already");
        assert_eq!(transition(Some("ok"), "invalid", true), Some(Alert::Dead));
        assert_eq!(transition(Some("invalid"), "invalid", false), None);
        assert_eq!(transition(Some("ok"), "limited", false), Some(Alert::Limited));
        assert_eq!(transition(Some("warn"), "limited", false), Some(Alert::Limited));
        assert_eq!(transition(None, "limited", false), None);
        assert_eq!(transition(Some("limited"), "limited", false), None);
        assert_eq!(transition(Some("invalid"), "ok", true), None);
    }

    #[test]
    fn refresh_errors_mark_dead() {
        assert_eq!(effective_state("ok", Some("oauth2: \"invalid_grant\" refresh token revoked")), "invalid");
        assert_eq!(effective_state("ok", Some("dial tcp: connection refused")), "ok");
        assert_eq!(effective_state("disabled", Some("invalid_grant")), "disabled");
        assert_eq!(effective_state("limited", None), "limited");
    }
}
