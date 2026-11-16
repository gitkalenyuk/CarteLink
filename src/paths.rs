//! Where CarteLink keeps its data. Resolved once at startup.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const APP_NAME: &str = "CarteLink";

/// Names of the data folders of earlier product names; the newest existing one
/// is copied over on the first start so accounts and settings survive.
const LEGACY_HOMES: [&str; 2] = ["CartelGate", "VisionGateGo"];

static HOME: OnceLock<PathBuf> = OnceLock::new();

/// The data root: `CARTELINK_HOME` (or the legacy variables), a portable
/// folder next to the executable (`data/` or `.portable`), else the per-user
/// config folder.
pub fn home() -> &'static Path {
    HOME.get_or_init(resolve_home)
}

fn resolve_home() -> PathBuf {
    for var in ["CARTELINK_HOME", "CARTELGATE_HOME", "VISIONGATE_HOME"] {
        if let Ok(v) = std::env::var(var) {
            let v = v.trim();
            if !v.is_empty() {
                // Absolute: the working directory changes later (engine folder).
                return std::path::absolute(v).unwrap_or_else(|_| PathBuf::from(v));
            }
        }
    }
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf))
        && (dir.join("data").is_dir() || dir.join(".portable").exists())
    {
        return dir;
    }
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    let home = base.join(APP_NAME);
    if !home.exists() {
        for legacy in LEGACY_HOMES {
            let from = base.join(legacy);
            if from.is_dir() {
                if let Err(e) = copy_tree(&from, &home) {
                    eprintln!("migrate {}: {e}", from.display());
                }
                break;
            }
        }
    }
    home
}

pub fn config_json() -> PathBuf {
    home().join("config.json")
}
pub fn instance_json() -> PathBuf {
    home().join("instance.json")
}
pub fn data_dir() -> PathBuf {
    home().join("data")
}
pub fn engine_dir() -> PathBuf {
    data_dir().join("cliproxy")
}
pub fn engine_config() -> PathBuf {
    engine_dir().join("config.yaml")
}
pub fn auth_dir() -> PathBuf {
    engine_dir().join("auths")
}
pub fn plugins_dir() -> PathBuf {
    engine_dir().join("plugins")
}
pub fn logs_dir() -> PathBuf {
    engine_dir().join("logs")
}
pub fn app_log() -> PathBuf {
    logs_dir().join("app.log")
}
pub fn bin_dir() -> PathBuf {
    data_dir().join("bin")
}
pub fn webview_dir() -> PathBuf {
    data_dir().join("webview")
}

/// Copies a previous product's data folder, skipping browser caches and logs
/// (large, recreated anyway).
fn copy_tree(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        let name_s = name.to_string_lossy();
        let target = dst.join(&name);
        let ft = entry.file_type()?;
        if ft.is_dir() {
            if skip_dir(&name_s) {
                continue;
            }
            copy_tree(&entry.path(), &target)?;
        } else if ft.is_file() && !skip_file(&name_s) {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

fn skip_dir(name: &str) -> bool {
    matches!(
        name,
        "EBWebView"
            | "Cache"
            | "Code Cache"
            | "GPUCache"
            | "DawnGraphiteCache"
            | "DawnWebGPUCache"
            | "Local Storage"
            | "Session Storage"
            | "Network"
            | "Shared Dictionary"
            | "blob_storage"
            | "oauth-browser"
            | "logs"
            | "webview"
            | "bin"
    ) || name.starts_with("chatgpt-profile")
}

fn skip_file(name: &str) -> bool {
    matches!(
        name,
        "chats.json" | "chatgpt-accounts.json" | "log.txt" | "log.txt.old" | "Local State" | "Preferences" | "SharedStorage" | "instance.json"
    ) || name.ends_with(".log")
        || name.contains(".log.")
}

/// Writes a file through a temp file + rename so a crash never leaves it truncated.
pub fn write_atomic(path: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp = path.with_extension(format!("{}.tmp{}-{n}", path.extension().and_then(|e| e.to_str()).unwrap_or(""), std::process::id()));
    {
        use std::io::Write;
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(data)?;
        // On disk before the rename: a power cut must not leave an empty file.
        f.sync_all()?;
    }
    // On Windows a virus scanner or indexer may hold the target for a moment:
    // retry briefly instead of falling back to a non-atomic write.
    let mut last = None;
    for attempt in 0..6 {
        match std::fs::rename(&tmp, path) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last = Some(e);
                std::thread::sleep(std::time::Duration::from_millis(40 * (attempt + 1)));
            }
        }
    }
    let _ = std::fs::remove_file(&tmp);
    Err(last.unwrap_or_else(|| std::io::Error::other("rename failed")))
}
