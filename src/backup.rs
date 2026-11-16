//! Backup and restore of CarteLink's settings and accounts as one zip.
//! Plugin DLLs are not included: `plugins.json` lists them and they are
//! installed from the store again after a restore.

use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::{Value, json};

use crate::paths;

pub const MANIFEST: &str = "manifest.json";
pub const PLUGINS: &str = "plugins.json";
/// After a restore: plugins to install once the engine is up (read by tasks.rs).
pub const PENDING_PLUGINS: &str = "restore-plugins.json";
const AUTHS_PREFIX: &str = "data/cliproxy/auths/";
/// Fixed files (zip name → path under the data home).
const FIXED: [&str; 5] = ["config.json", "data/cliproxy/config.yaml", "data/metrics.json", "data/errors.jsonl", "data/account-health.json"];
pub const MAX_UPLOAD: usize = 64 << 20;
const MAX_ENTRY: u64 = 64 << 20;
const MAX_TOTAL: u64 = 256 << 20;

static RESTORING: AtomicBool = AtomicBool::new(false);

/// Whether `name` is an entry a backup may contain (no path tricks).
pub fn allowed_entry(name: &str) -> bool {
    if name == MANIFEST || name == PLUGINS || FIXED.contains(&name) {
        return true;
    }
    let Some(file) = name.strip_prefix(AUTHS_PREFIX) else { return false };
    file.ends_with(".json")
        && file.len() <= 200
        && !file.starts_with('.')
        && !file.contains("..")
        && file.chars().all(|c| c.is_alphanumeric() || "-_.@+ ()".contains(c))
}

/// Where a (validated) entry lives on disk.
fn target(home: &Path, name: &str) -> PathBuf {
    name.split('/').fold(home.to_path_buf(), |p, part| p.join(part))
}

pub fn file_name(now: jiff::ZonedDateTime) -> String {
    format!("cartelink-backup-{}.zip", now.strftime("%Y%m%d-%H%M"))
}

/// Builds the zip from the data home. `plugins` = installed plugin ids.
pub fn build(home: &Path, plugins: &[String]) -> Result<Vec<u8>, String> {
    use zip::write::SimpleFileOptions;
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut zw = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let put = |zw: &mut zip::ZipWriter<Cursor<Vec<u8>>>, name: &str, data: &[u8]| -> Result<(), String> {
        zw.start_file(name, opts).map_err(|e| e.to_string())?;
        zw.write_all(data).map_err(|e| e.to_string())
    };
    let manifest = json!({
        "app": paths::APP_NAME,
        "version": crate::config::VERSION,
        "created": jiff::Timestamp::now().to_string(),
    });
    put(&mut zw, MANIFEST, serde_json::to_string_pretty(&manifest).unwrap_or_default().as_bytes())?;
    for name in FIXED {
        if let Ok(data) = std::fs::read(target(home, name)) {
            put(&mut zw, name, &data)?;
        }
    }
    if let Ok(dir) = std::fs::read_dir(target(home, AUTHS_PREFIX.trim_end_matches('/'))) {
        let mut names: Vec<String> = dir
            .flatten()
            .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
            .filter_map(|e| e.file_name().to_str().map(str::to_string))
            .map(|f| format!("{AUTHS_PREFIX}{f}"))
            .filter(|n| allowed_entry(n))
            .collect();
        names.sort();
        for n in names {
            if let Ok(data) = std::fs::read(target(home, &n)) {
                put(&mut zw, &n, &data)?;
            }
        }
    }
    put(&mut zw, PLUGINS, serde_json::to_string_pretty(&json!({ "plugins": plugins })).unwrap_or_default().as_bytes())?;
    Ok(zw.finish().map_err(|e| e.to_string())?.into_inner())
}

/// A checked backup, ready to write.
#[derive(Debug)]
pub struct Restore {
    pub files: Vec<(String, Vec<u8>)>,
    pub plugins: Vec<String>,
    pub version: String,
}

/// Reads and validates a backup zip: manifest of CarteLink, only known
/// entries, sane sizes, config.json is a JSON object.
pub fn parse(zip_bytes: &[u8]) -> Result<Restore, String> {
    let mut za = zip::ZipArchive::new(Cursor::new(zip_bytes)).map_err(|_| "це не zip-архів резервної копії CarteLink".to_string())?;
    let mut files = Vec::new();
    let mut total = 0u64;
    let mut manifest = None;
    let mut plugins = Vec::new();
    for i in 0..za.len() {
        let mut f = za.by_index(i).map_err(|e| e.to_string())?;
        if f.is_dir() {
            continue;
        }
        let name = f.name().map_err(|e| e.to_string())?.replace('\\', "/");
        if !allowed_entry(&name) || f.enclosed_name().is_none() {
            return Err(format!("невідомий файл в архіві: {name}"));
        }
        if f.size() > MAX_ENTRY {
            return Err(format!("файл {name} завеликий"));
        }
        let mut data = Vec::with_capacity(f.size() as usize);
        (&mut f).take(MAX_ENTRY + 1).read_to_end(&mut data).map_err(|e| format!("{name}: {e}"))?;
        total += data.len() as u64;
        if data.len() as u64 > MAX_ENTRY || total > MAX_TOTAL {
            return Err("архів завеликий".into());
        }
        if files.iter().any(|(n, _): &(String, Vec<u8>)| *n == name) {
            return Err(format!("файл {name} повторюється в архіві"));
        }
        match name.as_str() {
            MANIFEST => manifest = serde_json::from_slice::<Value>(&data).ok(),
            PLUGINS => {
                let v: Value = serde_json::from_slice(&data).unwrap_or(Value::Null);
                plugins = v
                    .get("plugins")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().filter_map(Value::as_str).filter(|s| valid_plugin_id(s)).map(str::to_string).collect())
                    .unwrap_or_default();
            }
            _ => {
                if name.ends_with(".json") && !matches!(serde_json::from_slice::<Value>(&data), Ok(Value::Object(_))) {
                    return Err(format!("файл {name} пошкоджений"));
                }
                files.push((name, data));
            }
        }
    }
    let m = manifest.ok_or("в архіві немає manifest.json — це не резервна копія CarteLink")?;
    if m.get("app").and_then(Value::as_str) != Some(paths::APP_NAME) {
        return Err("це резервна копія іншої програми".into());
    }
    if !files.iter().any(|(n, _)| n == "config.json") {
        return Err("в архіві немає config.json".into());
    }
    let version = m.get("version").and_then(Value::as_str).unwrap_or("").to_string();
    Ok(Restore { files, plugins, version })
}

fn valid_plugin_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 100 && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)) && !s.contains("..")
}

/// Writes the restored files (each atomically) and remembers the plugins to install.
pub fn write(home: &Path, r: &Restore) -> Result<usize, String> {
    for (name, data) in &r.files {
        paths::write_atomic(&target(home, name), data).map_err(|e| format!("{name}: {e}"))?;
    }
    if !r.plugins.is_empty() {
        let p = home.join("data").join(PENDING_PLUGINS);
        paths::write_atomic(&p, serde_json::to_string(&r.plugins).unwrap_or_default().as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(r.files.len())
}

/// Only one restore at a time. The guard frees the slot when dropped.
pub struct RestoreGuard(());
impl Drop for RestoreGuard {
    fn drop(&mut self) {
        RESTORING.store(false, Ordering::Release);
    }
}
pub fn begin_restore() -> Option<RestoreGuard> {
    (!RESTORING.swap(true, Ordering::AcqRel)).then_some(RestoreGuard(()))
}

/// Starts a fresh copy of CarteLink with the same arguments once this one
/// has exited (the single-instance lock is held until then), and exits.
/// Call after `crate::shutdown()`.
pub fn restart_app() -> ! {
    if let Err(e) = spawn_delayed_self() {
        tracing::error!("restart: {e}");
    }
    std::process::exit(0);
}

fn spawn_delayed_self() -> std::io::Result<()> {
    let exe = std::env::current_exe()?;
    let args: Vec<String> = std::env::args().skip(1).collect();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let q = |s: &str| format!("\"{}\"", s.replace('"', ""));
        let mut line = format!("/d /c ping -n 3 127.0.0.1 >nul & start \"\" {}", q(&exe.to_string_lossy()));
        for a in &args {
            line.push(' ');
            line.push_str(&q(a));
        }
        std::process::Command::new("cmd.exe")
            .raw_arg(line)
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        std::process::Command::new("/bin/sh")
            .arg("-c")
            .arg("sleep 2; exec \"$0\" \"$@\"")
            .arg(&exe)
            .args(&args)
            .process_group(0)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_validation() {
        for ok in ["config.json", "manifest.json", "plugins.json", "data/cliproxy/config.yaml", "data/cliproxy/auths/codex-a@b.com.json"] {
            assert!(allowed_entry(ok), "{ok}");
        }
        for bad in [
            "../config.json",
            "/config.json",
            "data/cliproxy/auths/../../x.json",
            "data/cliproxy/auths/sub/x.json",
            "data/cliproxy/auths/x.exe",
            "data/cliproxy/auths/.hidden.json",
            "data/cliproxy/auths/a\\..\\b.json",
            "data/bin/engine.exe",
            "data/cliproxy/plugins/x.dll",
            "C:/Windows/x.json",
        ] {
            assert!(!allowed_entry(bad), "{bad}");
        }
    }

    fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
        use zip::write::SimpleFileOptions;
        let mut zw = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (n, d) in entries {
            zw.start_file(*n, SimpleFileOptions::default()).unwrap();
            zw.write_all(d).unwrap();
        }
        zw.finish().unwrap().into_inner()
    }

    #[test]
    fn round_trip_in_temp_home() {
        let home = std::env::temp_dir().join(format!("cl-backup-test-{}", crate::util::random_hex(6)));
        std::fs::create_dir_all(home.join("data/cliproxy/auths")).unwrap();
        std::fs::write(home.join("config.json"), br#"{"apiKey":"cl-x"}"#).unwrap();
        std::fs::write(home.join("data/cliproxy/config.yaml"), b"port: 1\n").unwrap();
        std::fs::write(home.join("data/cliproxy/auths/claude-a.json"), br#"{"type":"claude"}"#).unwrap();
        std::fs::write(home.join("data/cliproxy/auths/notes.txt"), b"skip").unwrap();
        let z = build(&home, &["kiro".into()]).unwrap();
        let r = parse(&z).unwrap();
        let names: Vec<&str> = r.files.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, ["config.json", "data/cliproxy/config.yaml", "data/cliproxy/auths/claude-a.json"]);
        assert_eq!(r.plugins, ["kiro"]);
        assert_eq!(r.version, crate::config::VERSION);

        let other = std::env::temp_dir().join(format!("cl-backup-test-{}", crate::util::random_hex(6)));
        assert_eq!(write(&other, &r).unwrap(), 3);
        assert_eq!(std::fs::read(other.join("data/cliproxy/auths/claude-a.json")).unwrap(), br#"{"type":"claude"}"#);
        assert!(other.join("data").join(PENDING_PLUGINS).exists());
        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::remove_dir_all(&other);
    }

    #[test]
    fn rejects_bad_archives() {
        let manifest = br#"{"app":"CarteLink","version":"3.0.0"}"#.as_slice();
        assert!(parse(b"not a zip").is_err());
        assert!(parse(&zip_of(&[("config.json", b"{}")])).is_err(), "no manifest");
        assert!(parse(&zip_of(&[(MANIFEST, br#"{"app":"Other"}"#), ("config.json", b"{}")])).is_err());
        assert!(parse(&zip_of(&[(MANIFEST, manifest)])).is_err(), "no config.json");
        assert!(parse(&zip_of(&[(MANIFEST, manifest), ("config.json", b"{}"), ("../evil.json", b"{}")])).is_err());
        assert!(parse(&zip_of(&[(MANIFEST, manifest), ("config.json", b"[]")])).is_err());
        assert!(parse(&zip_of(&[(MANIFEST, manifest), ("config.json", b"{}"), ("data/cliproxy/auths/a.json", b"{}")])).is_ok());
    }

    #[test]
    fn single_restore() {
        let g = begin_restore().unwrap();
        assert!(begin_restore().is_none());
        drop(g);
        assert!(begin_restore().is_some());
    }

    #[test]
    fn backup_name() {
        let t: jiff::ZonedDateTime = "2026-11-16T09:05:00+02:00[Europe/Kyiv]".parse().unwrap();
        assert_eq!(file_name(t), "cartelink-backup-20261116-0905.zip");
    }
}
