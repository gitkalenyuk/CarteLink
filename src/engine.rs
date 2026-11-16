//! The embedded CLIProxyAPI engine: a Go binary compiled into this executable
//! (build.rs), written to the data folder on first run and supervised as a
//! hidden child process on a private loopback port.
//!
//! Only CarteLink talks to it: the engine accepts one internal client key, and
//! every client request reaches it through the gateway (src/proxy.rs), which
//! checks the real client keys first.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_norway::{Mapping, Value as Yaml};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};

use crate::config::Config;
use crate::paths;
use crate::util::random_hex;

static ENGINE_ZST: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/engine.zst"));
const ENGINE_ID: &str = env!("CARTELINK_ENGINE_ID");
pub const UPSTREAM_VERSION: &str = env!("CARTELINK_ENGINE_VERSION");

pub struct Engine {
    /// Internal loopback port (changes per run).
    port: AtomicU16,
    /// The only client key the engine accepts.
    pub internal_key: String,
    /// Guards the engine host's own /_cartelink endpoints.
    pub host_secret: String,
    proc: tokio::sync::Mutex<Option<Running>>,
    start_lock: tokio::sync::Mutex<()>,
    running: AtomicBool,
    restarting: AtomicBool,
    /// Bumped on every intended stop so the supervisor knows an exit was expected.
    generation: AtomicU64,
    last_error: Mutex<String>,
    exe: Mutex<Option<PathBuf>>,
    #[cfg(windows)]
    job: Option<job::Job>,
}

struct Running {
    child: Child,
    stdin: Option<ChildStdin>,
}

impl Engine {
    pub fn new() -> Self {
        Engine {
            port: AtomicU16::new(0),
            internal_key: format!("cl-internal-{}", random_hex(24)),
            host_secret: random_hex(24),
            proc: tokio::sync::Mutex::new(None),
            start_lock: tokio::sync::Mutex::new(()),
            running: AtomicBool::new(false),
            restarting: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            last_error: Mutex::new(String::new()),
            exe: Mutex::new(None),
            #[cfg(windows)]
            job: job::Job::new(),
        }
    }

    pub fn port(&self) -> u16 {
        self.port.load(Ordering::Acquire)
    }
    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port())
    }
    pub fn running(&self) -> bool {
        self.running.load(Ordering::Acquire)
    }
    pub fn restarting(&self) -> bool {
        self.restarting.load(Ordering::Acquire)
    }
    pub fn last_error(&self) -> String {
        self.last_error.lock().map(|g| g.clone()).unwrap_or_default()
    }
    fn set_error(&self, e: impl Into<String>) {
        if let Ok(mut g) = self.last_error.lock() {
            *g = e.into();
        }
    }

    /// Writes the engine binary next to the data unless the same build is there.
    fn ensure_binary(&self) -> std::io::Result<PathBuf> {
        if let Some(p) = self.exe.lock().ok().and_then(|g| g.clone())
            && p.exists()
        {
            return Ok(p);
        }
        let dir = paths::bin_dir();
        std::fs::create_dir_all(&dir)?;
        let name = format!("cartelink-engine-{ENGINE_ID}{}", std::env::consts::EXE_SUFFIX);
        let path = dir.join(&name);
        if !path.exists() {
            let bytes = zstd::stream::decode_all(ENGINE_ZST).map_err(std::io::Error::other)?;
            let tmp = dir.join(format!("{name}.{}.tmp", std::process::id()));
            std::fs::write(&tmp, &bytes)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))?;
            }
            if let Err(e) = std::fs::rename(&tmp, &path) {
                let _ = std::fs::remove_file(&tmp);
                if !path.exists() {
                    return Err(e);
                }
            }
            tracing::info!("engine binary written: {}", path.display());
        }
        // Old builds' binaries are useless now.
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().to_string();
                if n.starts_with("cartelink-engine-") && n != name {
                    let _ = std::fs::remove_file(e.path());
                }
            }
        }
        if let Ok(mut g) = self.exe.lock() {
            *g = Some(path.clone());
        }
        Ok(path)
    }

    /// Starts the engine and waits until it answers /healthz. Boxed with an
    /// explicit Send bound: the supervisor it spawns calls it again.
    pub fn start<'a>(self: &'a Arc<Self>, cfg: &'a Config) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(self.start_inner(cfg))
    }

    /// One start at a time: a second caller (Start pressed during the boot, the
    /// supervisor, a restart) waits for the first and then finds the engine up.
    /// A child that is alive is never replaced, only waited for.
    async fn start_inner(self: &Arc<Self>, cfg: &Config) -> Result<(), String> {
        let _one = self.start_lock.lock().await;
        let generation = self.generation.load(Ordering::Acquire);
        let alive = {
            let mut g = self.proc.lock().await;
            matches!(g.as_mut().map(|r| r.child.try_wait()), Some(Ok(None)))
        };
        if alive && self.running() {
            return Ok(());
        }
        if !alive {
            self.spawn_child(cfg, generation).await?;
        }
        self.wait_healthy(generation).await
    }

    async fn spawn_child(self: &Arc<Self>, cfg: &Config, generation: u64) -> Result<(), String> {
        let exe = self.ensure_binary().map_err(|e| format!("engine binary: {e}"))?;
        let port = pick_internal_port(self.port());
        self.port.store(port, Ordering::Release);
        sync_config_yaml(&paths::engine_config(), &self.managed(cfg, port)).map_err(|e| format!("config.yaml: {e}"))?;

        let mut cmd = Command::new(&exe);
        cmd.arg("-config")
            .arg(paths::engine_config())
            .arg("-secret")
            .arg(&self.host_secret)
            .current_dir(paths::engine_dir())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        let mut child = cmd.spawn().map_err(|e| format!("start engine: {e}"))?;
        #[cfg(windows)]
        if let (Some(job), Some(h)) = (&self.job, child.raw_handle()) {
            job.assign(h);
        }
        for out in [child.stdout.take().map(Either::Out), child.stderr.take().map(Either::Err)].into_iter().flatten() {
            tokio::spawn(forward_log("engine", out));
        }
        let stdin = child.stdin.take();
        *self.proc.lock().await = Some(Running { child, stdin });
        // The supervisor watches this child from now on, healthy or not yet.
        let me = Arc::clone(self);
        tokio::spawn(async move { me.supervise(generation).await });
        Ok(())
    }

    /// Waits until /healthz answers. A slow start (plugins loading, a virus
    /// scanner checking the fresh binary) is reported but the child is kept:
    /// the supervisor marks it running as soon as it answers.
    async fn wait_healthy(&self, generation: u64) -> Result<(), String> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
        loop {
            if self.generation.load(Ordering::Acquire) != generation {
                return Err("engine start was cancelled".into());
            }
            if self.probe().await {
                self.running.store(true, Ordering::Release);
                self.set_error("");
                tracing::info!("engine {UPSTREAM_VERSION} ready on 127.0.0.1:{}", self.port());
                return Ok(());
            }
            if let Some(code) = self.exited().await {
                let msg = format!("engine exited during start ({code})");
                self.set_error(&msg);
                return Err(msg);
            }
            if tokio::time::Instant::now() > deadline {
                let msg = "engine is still starting after 60 s — it keeps trying".to_string();
                self.set_error(&msg);
                return Err(msg);
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    }

    async fn probe(&self) -> bool {
        let url = format!("{}/healthz", self.base_url());
        let Ok(client) = reqwest::Client::builder().timeout(Duration::from_secs(2)).no_proxy().build() else { return false };
        matches!(client.get(&url).send().await, Ok(r) if r.status().as_u16() < 500)
    }

    /// Returns Some(exit description) when the child has already exited.
    async fn exited(&self) -> Option<String> {
        let mut g = self.proc.lock().await;
        let r = g.as_mut()?;
        match r.child.try_wait() {
            Ok(Some(st)) => Some(st.to_string()),
            _ => None,
        }
    }

    /// Watches one child: marks it running once it answers and, on an
    /// unexpected exit, starts a new one with backoff (its own supervisor takes
    /// over). Any intended stop changes the generation and ends it.
    async fn supervise(self: Arc<Self>, generation: u64) {
        let current = |me: &Self| me.generation.load(Ordering::Acquire) == generation;
        let mut delay = Duration::from_secs(1);
        loop {
            tokio::time::sleep(Duration::from_millis(700)).await;
            if !current(&self) {
                return;
            }
            let Some(status) = self.exited().await else {
                if !self.running() && current(&self) && self.probe().await {
                    self.running.store(true, Ordering::Release);
                    self.set_error("");
                    crate::app::app().emit(crate::app::LiveEvent::Changed { what: "status".into() });
                }
                continue;
            };
            if !current(&self) {
                return;
            }
            self.running.store(false, Ordering::Release);
            let msg = format!("engine stopped unexpectedly ({status}); restarting");
            tracing::error!("{msg}");
            self.set_error(&msg);
            crate::app::app().log_error(crate::errlog::ErrorEntry { kind: "app".into(), message: msg.clone(), ..Default::default() });
            crate::app::app().notify("engine", "CarteLink", "Рушій несподівано зупинився — CarteLink перезапускає його.");
            {
                let mut g = self.proc.lock().await;
                if current(&self) {
                    *g = None;
                }
            }
            loop {
                tokio::time::sleep(delay).await;
                delay = (delay * 2).min(Duration::from_secs(30));
                if !current(&self) {
                    return;
                }
                let cfg = crate::app::app().config();
                match self.start(&cfg).await {
                    Ok(()) => return, // the new child has its own supervisor
                    Err(e) => {
                        tracing::error!("engine restart failed: {e}");
                        // A child that exists but is slow is watched by its own supervisor.
                        if self.proc.lock().await.is_some() {
                            return;
                        }
                    }
                }
            }
        }
    }

    /// No engine process at all (a start failed before spawning).
    pub async fn is_down(&self) -> bool {
        self.proc.lock().await.is_none() && !self.restarting()
    }

    /// Stops the engine: closes its stdin (it shuts down gracefully), then kills.
    pub async fn stop(&self) {
        self.generation.fetch_add(1, Ordering::AcqRel);
        self.running.store(false, Ordering::Release);
        let Some(mut r) = self.proc.lock().await.take() else { return };
        drop(r.stdin.take());
        if tokio::time::timeout(Duration::from_secs(10), r.child.wait()).await.is_err() {
            let _ = r.child.kill().await;
        }
    }

    pub async fn restart(self: &Arc<Self>, cfg: &Config) -> Result<(), String> {
        if self.restarting.swap(true, Ordering::AcqRel) {
            return Err("restart already in progress".into());
        }
        self.stop().await;
        let r = self.start(cfg).await;
        self.restarting.store(false, Ordering::Release);
        r
    }

    /// Rewrites config.yaml (managed keys only); the engine reloads it itself.
    pub fn sync(&self, cfg: &Config) -> Result<(), String> {
        let port = self.port();
        if port == 0 {
            return Ok(());
        }
        sync_config_yaml(&paths::engine_config(), &self.managed(cfg, port))
    }

    fn managed(&self, cfg: &Config, port: u16) -> Managed {
        Managed {
            port,
            secret: cfg.cliproxy.management_secret.clone(),
            auth_dir: paths::auth_dir(),
            api_key: self.internal_key.clone(),
            extra_yaml: cfg.cliproxy.extra_config_yaml.clone(),
            plugins_dir: paths::plugins_dir(),
        }
    }
}

enum Either {
    Out(tokio::process::ChildStdout),
    Err(tokio::process::ChildStderr),
}

async fn forward_log(name: &'static str, out: Either) {
    let reader: Box<dyn tokio::io::AsyncRead + Unpin + Send> = match out {
        Either::Out(o) => Box::new(o),
        Either::Err(e) => Box::new(e),
    };
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim_end();
        // CarteLink's own polling (usage queue every 3 s, caps, catalog) would bury the log.
        let noise = ["/v0/management/usage-queue", "/_cartelink/", "\"/v1/models\"", "/v0/management/auth-files\"", "/healthz"];
        if !line.is_empty() && !noise.iter().any(|n| line.contains(n)) {
            tracing::info!(target: "engine", "[{name}] {line}");
        }
    }
}

/// A free loopback port, preferring the previous one so a restart keeps it.
fn pick_internal_port(prev: u16) -> u16 {
    if prev != 0 && std::net::TcpListener::bind(("127.0.0.1", prev)).is_ok() {
        return prev;
    }
    std::net::TcpListener::bind(("127.0.0.1", 0)).and_then(|l| l.local_addr()).map(|a| a.port()).unwrap_or(18317)
}

/// The config.yaml keys CarteLink owns; everything else (providers, plugin
/// configs, routing strategy… written through the Management API) is kept.
pub struct Managed {
    pub port: u16,
    pub secret: String,
    pub auth_dir: PathBuf,
    pub api_key: String,
    pub extra_yaml: String,
    pub plugins_dir: PathBuf,
}

const HEADER: &str =
    "# Managed by CarteLink 3 — host, port, management secret, auth-dir, api-keys and plugins.enabled/dir are rewritten on every start.\n";

fn parse_doc(b: &[u8]) -> Option<Mapping> {
    if String::from_utf8_lossy(b).trim().is_empty() {
        return None;
    }
    match serde_norway::from_slice::<Yaml>(b) {
        Ok(Yaml::Mapping(m)) => Some(m),
        _ => None,
    }
}

/// Copies config.yaml to config.yaml.bak when it parses: the last good copy.
pub fn backup_config_yaml(path: &Path) {
    let Ok(cur) = std::fs::read(path) else { return };
    if parse_doc(&cur).is_none() {
        return;
    }
    let bak = with_suffix(path, ".bak");
    if std::fs::read(&bak).map(|old| old == cur).unwrap_or(false) {
        return;
    }
    let _ = paths::write_atomic(&bak, &cur);
}

fn with_suffix(p: &Path, s: &str) -> PathBuf {
    let mut os = p.as_os_str().to_owned();
    os.push(s);
    PathBuf::from(os)
}

fn key(s: &str) -> Yaml {
    Yaml::String(s.into())
}

/// Merges the managed keys into config.yaml. An empty or broken file is kept
/// aside and the last good copy is used; only without one does it start fresh.
/// Skips the write when nothing changes (the engine watches the file).
pub fn sync_config_yaml(path: &Path, m: &Managed) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let cur = std::fs::read(path).unwrap_or_default();
    let mut doc = match parse_doc(&cur) {
        Some(d) => {
            backup_config_yaml(path);
            d
        }
        None => {
            if !String::from_utf8_lossy(&cur).trim().is_empty() {
                let stamp = jiff::Timestamp::now().strftime("%Y%m%d-%H%M%S").to_string();
                let broken = with_suffix(path, &format!(".broken-{stamp}"));
                let _ = std::fs::write(&broken, &cur);
                tracing::warn!("config.yaml is not valid YAML — kept as {}", broken.display());
            }
            match std::fs::read(with_suffix(path, ".bak")).ok().and_then(|b| parse_doc(&b)) {
                Some(d) => {
                    tracing::warn!("config.yaml was empty or broken — restored from config.yaml.bak");
                    d
                }
                None => {
                    let mut d = Mapping::new();
                    d.insert(key("logging-to-file"), Yaml::Bool(false));
                    d.insert(key("request-log"), Yaml::Bool(false));
                    d
                }
            }
        }
    };

    doc.insert(key("host"), key("127.0.0.1"));
    doc.insert(key("port"), Yaml::Number(m.port.into()));
    doc.insert(key("usage-statistics-enabled"), Yaml::Bool(true));
    doc.insert(key("redis-usage-queue-retention-seconds"), Yaml::Number(3600.into()));

    let mut rm = match doc.get("remote-management") {
        Some(Yaml::Mapping(x)) => x.clone(),
        _ => Mapping::new(),
    };
    rm.insert(key("allow-remote"), Yaml::Bool(false));
    rm.insert(key("disable-control-panel"), Yaml::Bool(false));
    // The engine replaces a plaintext secret with its bcrypt hash in the file.
    // Writing the plaintext again on every sync made it reload and re-hash
    // after every settings change (2.x); keep the hash while the secret is the
    // one it was made from.
    let mark_path = path.parent().map(|d| d.join(".secret-mark")).unwrap_or_else(|| PathBuf::from(".secret-mark"));
    let mark = secret_mark(&m.secret);
    let existing = rm.get("secret-key").and_then(Yaml::as_str).unwrap_or("").to_string();
    let hashed = existing.starts_with("$2a$") || existing.starts_with("$2b$") || existing.starts_with("$2y$");
    let same_secret = std::fs::read_to_string(&mark_path).map(|s| s.trim() == mark).unwrap_or(false);
    if !(hashed && same_secret) {
        rm.insert(key("secret-key"), key(&m.secret));
        let _ = std::fs::write(&mark_path, &mark);
    }
    doc.insert(key("remote-management"), Yaml::Mapping(rm));
    doc.insert(key("auth-dir"), key(&m.auth_dir.to_string_lossy()));
    doc.insert(key("api-keys"), Yaml::Sequence(vec![key(&m.api_key)]));

    let mut cc = match doc.get("claude-code") {
        Some(Yaml::Mapping(x)) => x.clone(),
        _ => Mapping::new(),
    };
    cc.insert(key("disable-cloaking-model-list"), Yaml::Bool(true));
    doc.insert(key("claude-code"), Yaml::Mapping(cc));

    let mut pl = match doc.get("plugins") {
        Some(Yaml::Mapping(x)) => x.clone(),
        _ => Mapping::new(),
    };
    pl.insert(key("enabled"), Yaml::Bool(true));
    pl.insert(key("dir"), key(&m.plugins_dir.to_string_lossy()));
    doc.insert(key("plugins"), Yaml::Mapping(pl));

    let extra = m.extra_yaml.trim();
    if !extra.is_empty() {
        match serde_norway::from_str::<Yaml>(extra) {
            Ok(Yaml::Mapping(ex)) => {
                for (k, v) in ex {
                    // Managed keys stay managed: the gateway depends on them.
                    let ks = k.as_str().unwrap_or("");
                    if matches!(
                        ks,
                        "host"
                            | "port"
                            | "api-keys"
                            | "auth-dir"
                            | "remote-management"
                            | "plugins"
                            | "tls"
                            | "usage-statistics-enabled"
                            | "claude-code"
                    ) {
                        continue;
                    }
                    doc.insert(k, v);
                }
            }
            Ok(Yaml::Null) => {}
            Ok(_) => return Err("extra config YAML must be a mapping (key: value)".into()),
            Err(e) => return Err(format!("extra config YAML: {e}")),
        }
    }

    let body = serde_norway::to_string(&Yaml::Mapping(doc)).map_err(|e| e.to_string())?;
    let out = format!("{HEADER}{body}");
    if out.as_bytes() == cur.as_slice() {
        return Ok(());
    }
    paths::write_atomic(path, out.as_bytes()).map_err(|e| e.to_string())
}

/// FNV-1a: stable across Rust releases (DefaultHasher is not guaranteed to be).
fn secret_mark(secret: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in secret.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// Full-access client keys a 2.x config.yaml held (added there through the
/// Management API). Read once on upgrade so those programs keep working.
pub fn legacy_yaml_keys(path: &Path) -> Vec<String> {
    let Some(doc) = std::fs::read(path).ok().and_then(|b| parse_doc(&b)) else { return vec![] };
    match doc.get("api-keys") {
        Some(Yaml::Sequence(s)) => {
            s.iter().filter_map(Yaml::as_str).map(str::trim).filter(|k| !k.is_empty() && !k.starts_with("cl-internal-")).map(str::to_string).collect()
        }
        _ => vec![],
    }
}

#[cfg(windows)]
mod job {
    //! A job object that kills the engine when CarteLink exits, even on a crash.
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JobObjectExtendedLimitInformation, SetInformationJobObject,
    };

    pub struct Job(HANDLE);
    // The handle is only used to assign processes; the OS closes it at exit.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        pub fn new() -> Option<Self> {
            unsafe {
                let h = CreateJobObjectW(None, None).ok()?;
                let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                SetInformationJobObject(
                    h,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const core::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
                .ok()?;
                Some(Job(h))
            }
        }

        pub fn assign(&self, process: std::os::windows::io::RawHandle) {
            unsafe {
                let _ = AssignProcessToJobObject(self.0, HANDLE(process));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yaml_sync_keeps_foreign_keys_and_restores_backup() {
        let dir = std::env::temp_dir().join(format!("cl-yaml-{}", random_hex(4)));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.yaml");
        std::fs::write(&path, "openai-compatibility:\n  - name: x\n    base-url: http://a\napi-keys: [old]\n").unwrap();
        let m = Managed {
            port: 1234,
            secret: "s".into(),
            auth_dir: dir.join("auths"),
            api_key: "cl-internal-1".into(),
            extra_yaml: "request-retry: 3\nport: 1\n".into(),
            plugins_dir: dir.join("plugins"),
        };
        sync_config_yaml(&path, &m).unwrap();
        let doc = parse_doc(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(doc.get("port").and_then(Yaml::as_u64), Some(1234));
        assert!(doc.get("openai-compatibility").is_some());
        assert_eq!(doc.get("request-retry").and_then(Yaml::as_u64), Some(3));
        // Broken file → restored from .bak (the good copy taken before the write).
        std::fs::write(&path, "").unwrap();
        sync_config_yaml(&path, &m).unwrap();
        let doc = parse_doc(&std::fs::read(&path).unwrap()).unwrap();
        assert!(doc.get("openai-compatibility").is_some());
        let _ = std::fs::remove_dir_all(dir);
    }
}
