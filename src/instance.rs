//! Single instance: the running copy writes instance.json (pid + address); a
//! second launch asks it to show its window and exits.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::config::display_host;
use crate::paths;

#[derive(Serialize, Deserialize)]
struct Record {
    pid: u32,
    #[serde(default)]
    host: String,
    port: u16,
    home: String,
}

fn addr(host: &str, port: u16) -> String {
    let h = display_host(host);
    if h.contains(':') { format!("[{}]:{port}", h.trim_matches(['[', ']'])) } else { format!("{h}:{port}") }
}

/// The address of a live CarteLink using the same data folder.
pub fn existing() -> Option<(u32, String)> {
    let raw = std::fs::read(paths::instance_json()).ok()?;
    let r: Record = serde_json::from_slice(&raw).ok()?;
    if r.port == 0 {
        return None;
    }
    let a = addr(&r.host, r.port);
    let agent = ureq_get(&format!("http://{a}/api/app/ping"))?;
    let v: serde_json::Value = serde_json::from_str(&agent).ok()?;
    let home = paths::home().to_string_lossy().to_string();
    (v.get("app").and_then(|x| x.as_str()) == Some(paths::APP_NAME) && v.get("home").and_then(|x| x.as_str()) == Some(home.as_str()))
        .then_some((r.pid, a))
}

/// Asks the running copy at `addr` to bring its window up.
pub fn show(addr: &str) -> bool {
    let addr = addr.to_string();
    blocking(async move {
        let c = reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(3)).build().ok()?;
        let r = c.post(format!("http://{addr}/api/app/show")).header("Content-Type", "application/json").body("{}").send().await.ok()?;
        Some(r.status().is_success())
    })
    .flatten()
    .unwrap_or(false)
}

fn ureq_get(url: &str) -> Option<String> {
    let url = url.to_string();
    blocking(async move {
        let c = reqwest::Client::builder().no_proxy().timeout(Duration::from_millis(1500)).build().ok()?;
        c.get(url).send().await.ok()?.text().await.ok()
    })
    .flatten()
}

/// Runs a small future to completion before the main runtime exists.
fn blocking<T: Send + 'static>(f: impl std::future::Future<Output = T> + Send + 'static) -> Option<T> {
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().ok()?;
    Some(rt.block_on(f))
}

/// Takes the exclusive per-data-folder lock (held until the process exits).
/// false = another copy holds it.
pub fn lock() -> bool {
    static LOCK: std::sync::OnceLock<std::fs::File> = std::sync::OnceLock::new();
    let _ = std::fs::create_dir_all(paths::home());
    let Ok(f) = std::fs::OpenOptions::new().create(true).truncate(false).write(true).open(paths::home().join("instance.lock")) else {
        return true; // cannot even open the file: do not block the start
    };
    match f.try_lock() {
        Ok(()) => {
            let _ = LOCK.set(f);
            true
        }
        Err(std::fs::TryLockError::WouldBlock) => false,
        Err(_) => true,
    }
}

pub fn register(host: &str, port: u16) {
    let r = Record { pid: std::process::id(), host: host.to_string(), port, home: paths::home().to_string_lossy().to_string() };
    if let Ok(b) = serde_json::to_vec(&r) {
        let _ = paths::write_atomic(&paths::instance_json(), &b);
    }
}

/// Removes the record if it still points at this process.
pub fn unregister() {
    if let Ok(raw) = std::fs::read(paths::instance_json())
        && let Ok(r) = serde_json::from_slice::<Record>(&raw)
        && r.pid == std::process::id()
    {
        let _ = std::fs::remove_file(paths::instance_json());
    }
}
