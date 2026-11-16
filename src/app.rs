//! Shared application state.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use arc_swap::ArcSwap;
use bytes::Bytes;
use serde::Serialize;
use serde_json::Value;
use tokio::sync::broadcast;

use crate::caps::{CapsStore, ModelCaps};
use crate::config::{self, Config};
use crate::engine::Engine;
use crate::errlog::{ErrorEntry, ErrorLog};
use crate::metrics::Metrics;
use crate::paths;
use crate::util::{base_model_name, uncloak};

/// What the window side (tray, floating switcher) can do for the server side.
pub trait Desktop: Send + Sync {
    fn show_main(&self);
    fn set_switcher(&self, show: bool);
    fn switcher_available(&self) -> bool;
    fn tray_available(&self) -> bool;
    /// The UI language changed: re-label the tray menu.
    fn lang_changed(&self);
    fn quit(&self);
    /// A system notification (tray toast). Default: nothing.
    fn notify(&self, _title: &str, _body: &str) {}
}

/// Live updates for the UI (Server-Sent Events on /api/events).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum LiveEvent {
    /// One finished model request.
    Request {
        t: i64,
        method: String,
        path: String,
        status: u16,
        ms: u64,
        model: String,
        resolved: String,
        client: String,
        key: String,
    },
    Error {
        entry: ErrorEntry,
    },
    /// Something the user should know about (also a tray notification).
    Notice {
        kind: String,
        title: String,
        text: String,
    },
    /// Config, engine state or routing changed: the UI reloads what it shows.
    Changed {
        what: String,
    },
}

#[derive(Default)]
pub struct Catalog {
    /// Lower-cased ids the engine serves.
    pub set: HashSet<String>,
    /// Same ids in their original spelling.
    pub ids: Vec<String>,
    pub at: i64,
}

pub struct MgmtResp {
    pub status: u16,
    pub body: Bytes,
    pub ctype: String,
}

impl MgmtResp {
    pub fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }
    pub fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }
    fn err(status: u16, msg: &str) -> Self {
        MgmtResp { status, body: Bytes::from(serde_json::json!({"ok": false, "error": msg}).to_string()), ctype: "application/json".into() }
    }
}

pub struct QuotaEntry {
    pub at: i64,
    pub quota: Option<Value>,
    pub fetching: bool,
}

pub struct App {
    cfg: ArcSwap<Config>,
    cfg_write: Mutex<()>,
    pub engine: Arc<Engine>,
    pub errlog: ErrorLog,
    pub metrics: Metrics,
    pub caps: CapsStore,
    pub catalog: ArcSwap<Catalog>,
    paused: AtomicBool,
    pub events: broadcast::Sender<LiveEvent>,
    /// Local calls (the engine): no system proxy.
    pub local: reqwest::Client,
    /// Outside calls (provider model lists): system proxy honoured.
    pub web: reqwest::Client,
    session_port: Mutex<Option<u16>>,
    bound: Mutex<(String, u16)>,
    desktop: OnceLock<Arc<dyn Desktop>>,
    pub quota: Mutex<HashMap<String, QuotaEntry>>,
    pub oauth_child: Mutex<Option<std::process::Child>>,
    pub server: crate::server::ServerControl,
    pub started_at: i64,
    pub config_warning: Mutex<Option<String>>,
    notified: Mutex<HashMap<String, i64>>,
}

static APP: OnceLock<Arc<App>> = OnceLock::new();

pub fn app() -> &'static Arc<App> {
    APP.get().expect("app not initialised")
}

pub fn init(cfg: Config) -> &'static Arc<App> {
    let local = reqwest::Client::builder().no_proxy().connect_timeout(Duration::from_secs(5)).build().expect("http client");
    let web = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(25))
        .user_agent(concat!("CarteLink/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("http client");
    let (events, _) = broadcast::channel(512);
    let app = App {
        bound: Mutex::new((cfg.cliproxy.host.clone(), cfg.cliproxy.port)),
        cfg: ArcSwap::from_pointee(cfg),
        cfg_write: Mutex::new(()),
        engine: Arc::new(Engine::new()),
        errlog: ErrorLog::open(paths::data_dir().join("errors.jsonl")),
        metrics: Metrics::open(paths::data_dir().join("metrics.json")),
        caps: CapsStore::default(),
        catalog: ArcSwap::from_pointee(Catalog::default()),
        paused: AtomicBool::new(false),
        events,
        local,
        web,
        session_port: Mutex::new(None),
        desktop: OnceLock::new(),
        quota: Mutex::new(HashMap::new()),
        oauth_child: Mutex::new(None),
        server: crate::server::ServerControl::default(),
        started_at: crate::util::now_ms(),
        config_warning: Mutex::new(None),
        notified: Mutex::new(HashMap::new()),
    };
    APP.get_or_init(|| Arc::new(app))
}

impl App {
    /// The live config. Cheap; read it per request so UI changes apply at once.
    pub fn config(&self) -> Arc<Config> {
        self.cfg.load_full()
    }

    /// Applies `mutate` to a copy, normalizes, saves and swaps it in. Writers
    /// are serialized, so two quick edits never overwrite each other.
    pub fn update_config(&self, mutate: impl FnOnce(&mut Config) -> Result<(), String>) -> Result<Arc<Config>, String> {
        let _w = self.cfg_write.lock().unwrap_or_else(|p| p.into_inner());
        let mut next = (*self.cfg.load_full()).clone();
        mutate(&mut next)?;
        config::normalize(&mut next);
        next.save().map_err(|e| format!("save config.json: {e}"))?;
        let next = Arc::new(next);
        self.cfg.store(next.clone());
        if let Err(e) = self.engine.sync(&next) {
            tracing::warn!("config.yaml sync: {e}");
        }
        self.emit(LiveEvent::Changed { what: "config".into() });
        Ok(next)
    }

    pub fn emit(&self, ev: LiveEvent) {
        let _ = self.events.send(ev);
    }

    /// Tells the user: a live event for the UI and, when the user allows this
    /// kind (config.notify), a tray notification. Repeats within 30 min are dropped.
    pub fn notify(&self, kind: &str, title: &str, text: &str) {
        let cfg = self.config();
        let n = &cfg.notify;
        let allowed = n.enabled
            && match kind {
                "account_dead" => n.account_dead,
                "limit" => n.limit,
                "engine" => n.engine,
                "fallback" => n.fallback,
                _ => true,
            };
        self.emit(LiveEvent::Notice { kind: kind.into(), title: title.into(), text: text.into() });
        if !allowed {
            return;
        }
        let key = format!("{kind}|{title}|{text}");
        let now = crate::util::now_ms();
        {
            let mut seen = self.notified.lock().unwrap_or_else(|e| e.into_inner());
            seen.retain(|_, t| now - *t < 30 * 60_000);
            if seen.contains_key(&key) {
                return;
            }
            seen.insert(key, now);
        }
        if let Some(d) = self.desktop() {
            d.notify(title, text);
        }
    }

    pub fn log_error(&self, e: ErrorEntry) {
        let entry = self.errlog.add(e);
        self.emit(LiveEvent::Error { entry });
    }

    pub fn paused(&self) -> bool {
        self.paused.load(Ordering::Acquire)
    }
    pub fn set_paused(&self, v: bool) {
        self.paused.store(v, Ordering::Release);
        self.emit(LiveEvent::Changed { what: "status".into() });
    }

    // ---- addresses ----

    pub fn set_session_port(&self, p: Option<u16>) {
        *self.session_port.lock().unwrap_or_else(|e| e.into_inner()) = p;
    }
    pub fn session_port(&self) -> Option<u16> {
        *self.session_port.lock().unwrap_or_else(|e| e.into_inner())
    }
    /// The port the gateway is configured for (a temporary one on this run).
    pub fn effective_port(&self) -> u16 {
        self.session_port().unwrap_or_else(|| self.config().cliproxy.port)
    }
    pub fn mark_bound(&self, host: &str, port: u16) {
        *self.bound.lock().unwrap_or_else(|e| e.into_inner()) = (host.to_string(), port);
    }
    /// Where the gateway listens right now.
    pub fn bound(&self) -> (String, u16) {
        self.bound.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
    pub fn public_base(&self) -> String {
        let (h, p) = self.bound();
        let h = config::display_host(&h);
        if h.contains(':') { format!("http://[{}]:{p}", h.trim_matches(['[', ']'])) } else { format!("http://{h}:{p}") }
    }

    // ---- desktop ----

    pub fn set_desktop(&self, d: Arc<dyn Desktop>) {
        let _ = self.desktop.set(d);
    }
    pub fn desktop(&self) -> Option<&Arc<dyn Desktop>> {
        self.desktop.get()
    }

    // ---- engine Management API ----

    pub async fn mgmt(&self, method: reqwest::Method, path: &str, body: Option<Bytes>, ctype: Option<&str>) -> MgmtResp {
        if !self.engine.running() {
            return MgmtResp::err(503, "Рушій не запущений — зачекай кілька секунд або натисни «Перезапустити».");
        }
        let cfg = self.config();
        let url = format!("{}{}", self.engine.base_url(), path);
        let timeout = if path.contains("/plugin-store") { Duration::from_secs(180) } else { Duration::from_secs(25) };
        let mut req = self
            .local
            .request(method, &url)
            .timeout(timeout)
            .header("X-Management-Key", &cfg.cliproxy.management_secret)
            .header("Accept", "application/json, application/yaml, text/plain, */*");
        if let Some(b) = body {
            req = req.header("Content-Type", ctype.filter(|c| !c.is_empty()).unwrap_or("application/json")).body(b);
        }
        match req.send().await {
            Ok(r) => {
                let status = r.status().as_u16();
                let ctype = r.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("application/json").to_string();
                let body = r.bytes().await.unwrap_or_default();
                MgmtResp { status, body, ctype }
            }
            Err(e) => MgmtResp::err(502, &format!("Помилка звʼязку з рушієм: {e}")),
        }
    }

    pub async fn mgmt_get(&self, path: &str) -> MgmtResp {
        self.mgmt(reqwest::Method::GET, path, None, None).await
    }

    pub async fn mgmt_json(&self, method: reqwest::Method, path: &str, body: &Value) -> MgmtResp {
        self.mgmt(method, path, Some(Bytes::from(body.to_string())), Some("application/json")).await
    }

    /// The engine's account list (`auth-files`), either shape.
    pub async fn auth_files(&self) -> Option<Vec<Value>> {
        let r = self.mgmt_get("/v0/management/auth-files").await;
        if !r.ok() {
            return None;
        }
        match r.json() {
            Value::Array(a) => Some(a),
            Value::Object(mut o) => match o.remove("files") {
                Some(Value::Array(a)) => Some(a),
                _ => Some(vec![]),
            },
            _ => Some(vec![]),
        }
    }

    // ---- model catalog and capabilities ----

    /// Refreshes the list of models the engine serves (drives the "smart" fallback).
    pub async fn refresh_catalog(&self) {
        if !self.engine.running() {
            return;
        }
        let url = format!("{}/v1/models", self.engine.base_url());
        let Ok(r) = self.local.get(&url).bearer_auth(&self.engine.internal_key).timeout(Duration::from_secs(10)).send().await else { return };
        if !r.status().is_success() {
            return;
        }
        let Ok(v) = r.json::<Value>().await else { return };
        let mut cat = Catalog { at: crate::util::now_ms(), ..Default::default() };
        if let Some(Value::Array(data)) = v.get("data") {
            for m in data {
                let orig = uncloak(m.get("id").and_then(Value::as_str).unwrap_or("").trim());
                let low = orig.to_ascii_lowercase();
                if !low.is_empty() && cat.set.insert(low) {
                    cat.ids.push(orig);
                }
            }
        }
        self.catalog.store(Arc::new(cat));
    }

    pub async fn refresh_caps(&self) {
        if !self.engine.running() {
            return;
        }
        let url = format!("{}/_cartelink/caps", self.engine.base_url());
        let Ok(r) = self.local.get(&url).header("X-CarteLink-Secret", &self.engine.host_secret).timeout(Duration::from_secs(10)).send().await else {
            return;
        };
        if let Ok(m) = r.json::<HashMap<String, ModelCaps>>().await {
            self.caps.replace(m);
        }
    }

    /// Whether the engine (or an enabled provider) serves `model`. With no
    /// catalog yet it answers true, so nothing is rerouted blindly.
    pub fn is_known_model(&self, model: &str) -> bool {
        let m = base_model_name(model).to_ascii_lowercase();
        let cat = self.catalog.load();
        if cat.set.is_empty() || cat.set.contains(&m) {
            return true;
        }
        let cfg = self.config();
        cfg.providers.iter().filter(|p| p.enabled).flat_map(|p| p.models.iter()).any(|pm| pm.trim().eq_ignore_ascii_case(&m))
    }

    /// Client model name → the model CarteLink sends it to.
    pub fn resolve(&self, model: &str) -> String {
        let cfg = self.config();
        let known = |m: &str| self.is_known_model(m);
        crate::routing::resolve_model(&cfg, model, Some(&known))
    }

    // ---- OAuth browser ----

    pub fn set_oauth_child(&self, c: Option<std::process::Child>) {
        let mut g = self.oauth_child.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(mut old) = g.take() {
            let _ = old.kill();
            let _ = old.wait();
        }
        *g = c;
    }
}
