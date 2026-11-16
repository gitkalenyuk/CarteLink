//! CarteLink 3 — a local AI gateway in one executable.
//!
//! One process, one port: the model API (OpenAI, Anthropic, Gemini formats),
//! the UI and its control API. The original CLIProxyAPI engine is embedded in
//! this binary and supervised as a hidden child process on a private port.

#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]
// axum handlers return early with a ready Response; boxing it buys nothing.
#![allow(clippy::result_large_err)]

mod api;
mod api2;
mod app;
mod apps;
mod autofix;
mod autostart;
mod backup;
mod browser;
mod caps;
mod config;
mod connect;
mod devices;
mod engine;
mod errlog;
#[cfg(any(windows, target_os = "macos"))]
mod gui;
mod instance;
mod limits;
mod metrics;
mod paths;
mod prompting;
mod proxy;
mod routes;
mod routing;
mod scoped;
mod server;
mod tasks;
mod traytext;
mod util;

use std::io::Write;
use std::sync::Mutex;
use std::time::Duration;

struct Args {
    headless: bool,
    minimized: bool,
    port: Option<u16>,
}

fn parse_args() -> Args {
    let mut a = Args { headless: false, minimized: false, port: None };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--headless" | "-headless" => a.headless = true,
            "--minimized" | "-minimized" => a.minimized = true,
            "--port" | "-port" => a.port = it.next().and_then(|p| p.parse().ok()).filter(|&p| p > 0),
            s if s.starts_with("--port=") => a.port = s[7..].parse().ok().filter(|&p| p > 0),
            "--version" | "-v" => {
                attach_console();
                println!("CarteLink {} (engine CLIProxyAPI {})", config::VERSION, engine::UPSTREAM_VERSION);
                std::process::exit(0);
            }
            "--help" | "-h" => {
                attach_console();
                println!(
                    "CarteLink {}\n  --headless     server only, no window\n  --minimized    start in the tray\n  --port N       use port N for this run only",
                    config::VERSION
                );
                std::process::exit(0);
            }
            _ => {}
        }
    }
    a
}

/// A GUI-subsystem build has no console; print into the terminal it was started from.
fn attach_console() {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::System::Console::{ATTACH_PARENT_PROCESS, AttachConsole};
        let _ = AttachConsole(ATTACH_PARENT_PROCESS);
    }
}

/// A blocking message box (a GUI build has no console to print to).
pub fn alert(text: &str) {
    tracing::error!("{text}");
    #[cfg(windows)]
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{MB_ICONWARNING, MB_OK, MessageBoxW};
        use windows::core::HSTRING;
        MessageBoxW(None, &HSTRING::from(text), &HSTRING::from("CarteLink"), MB_OK | MB_ICONWARNING);
    }
    #[cfg(target_os = "macos")]
    {
        let esc = text.replace('\\', "\\\\").replace('"', "\\\"");
        let _ = std::process::Command::new("osascript").args(["-e", &format!("display alert \"CarteLink\" message \"{esc}\"")]).status();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    eprintln!("{text}");
}

// ---------------------------------------------------------------- logging ----

/// app.log, kept under 5 MB (the old file becomes app.log.1).
struct LogFile {
    file: Mutex<Option<std::fs::File>>,
    echo: bool,
}

impl LogFile {
    fn open(echo: bool) -> Self {
        let path = paths::app_log();
        let _ = std::fs::create_dir_all(paths::logs_dir());
        if std::fs::metadata(&path).map(|m| m.len() > 5 << 20).unwrap_or(false) {
            let old = path.with_extension("log.1");
            let _ = std::fs::remove_file(&old);
            let _ = std::fs::rename(&path, &old);
        }
        let f = std::fs::OpenOptions::new().create(true).append(true).open(&path).ok();
        LogFile { file: Mutex::new(f), echo }
    }
}

struct LogWriter<'a>(&'a LogFile);

impl Write for LogWriter<'_> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if let Ok(mut g) = self.0.file.lock() {
            // The app runs for weeks in the tray: rotate while running, not only at start.
            if g.as_ref().and_then(|f| f.metadata().ok()).is_some_and(|m| m.len() > 5 << 20) {
                let path = paths::app_log();
                *g = None;
                let old = path.with_extension("log.1");
                let _ = std::fs::remove_file(&old);
                let _ = std::fs::rename(&path, &old);
                *g = std::fs::OpenOptions::new().create(true).append(true).open(&path).ok();
            }
            if let Some(f) = g.as_mut() {
                let _ = f.write_all(buf);
            }
        }
        if self.0.echo {
            let _ = std::io::stderr().write_all(buf);
        }
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for LogFile {
    type Writer = LogWriter<'a>;
    fn make_writer(&'a self) -> Self::Writer {
        LogWriter(self)
    }
}

fn init_logging(echo: bool) {
    let writer = LogFile::open(echo);
    let _ = tracing_subscriber::fmt().with_writer(writer).with_ansi(false).with_target(false).with_max_level(tracing::Level::INFO).try_init();
    std::panic::set_hook(Box::new(|info| {
        tracing::error!("panic: {info}");
    }));
}

// --------------------------------------------------------------- shutdown ----

static RUNTIME: std::sync::OnceLock<tokio::runtime::Runtime> = std::sync::OnceLock::new();

/// Stops the engine and saves state. Safe to call more than once.
pub async fn shutdown() {
    static DONE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if DONE.swap(true, std::sync::atomic::Ordering::AcqRel) {
        return;
    }
    let a = app::app();
    instance::unregister();
    // The last usage records still sit in the engine's queue.
    if a.engine.running() {
        let r = a.mgmt_get("/v0/management/usage-queue?count=500").await;
        if r.ok() {
            a.metrics.ingest(metrics::parse_queue(&r.body));
        }
    }
    a.metrics.flush();
    a.set_oauth_child(None);
    a.engine.stop().await;
    tracing::info!("CarteLink stopped");
}

/// `shutdown` from the GUI thread (outside the runtime), then exit.
pub fn block_shutdown() {
    if let Some(rt) = RUNTIME.get() {
        let _ = rt.block_on(async { tokio::time::timeout(Duration::from_secs(12), shutdown()).await });
    }
    std::process::exit(0);
}

// ------------------------------------------------------------------- main ----

fn main() {
    let args = parse_args();
    if args.headless {
        attach_console();
    }

    // One copy per data folder, enforced by an OS file lock (two quick launches
    // used to start two engines on the same accounts). A second launch shows
    // the first copy's window and exits.
    if !instance::lock() {
        for _ in 0..30 {
            if let Some((pid, addr)) = instance::existing() {
                allow_foreground(pid);
                instance::show(&addr);
                return;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        attach_console();
        alert("CarteLink уже запущений з цією папкою даних.");
        return;
    }

    let (mut cfg, warning) = match config::load() {
        Ok(x) => x,
        Err(e) => {
            alert(&format!("Не вдалось прочитати налаштування: {e}"));
            std::process::exit(1);
        }
    };
    init_logging(args.headless);
    tracing::info!("CarteLink {} starting (engine {}), data: {}", config::VERSION, engine::UPSTREAM_VERSION, paths::home().display());

    let _ = std::fs::create_dir_all(paths::engine_dir());
    // Engine plugins resolve some data paths against the working directory
    // (autostart starts the app in System32): pin it to the engine folder.
    let _ = std::env::set_current_dir(paths::engine_dir());

    // 2.x kept extra full-access client keys in config.yaml: carry them over.
    let legacy = engine::legacy_yaml_keys(&paths::engine_config());
    if !legacy.is_empty() {
        for k in legacy {
            if !k.starts_with(config::SCOPED_KEY_PREFIX) && k != cfg.api_key && !cfg.cliproxy.api_keys.contains(&k) {
                cfg.cliproxy.api_keys.push(k);
            }
        }
        config::normalize(&mut cfg);
    }
    if let Err(e) = cfg.save() {
        tracing::warn!("save config.json: {e}");
    }

    let start_hidden = args.minimized || cfg.desktop.start_hidden;
    let a = app::init(cfg);
    if let Some(w) = &warning {
        *a.config_warning.lock().unwrap_or_else(|e| e.into_inner()) = Some(w.clone());
    }
    autostart::refresh();

    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().thread_name("cartelink").build().expect("tokio runtime");
    let rt = RUNTIME.get_or_init(|| rt);

    // The port is fixed (clients are configured for it). When something else
    // holds it, use a free one for this run only — never saved.
    let cfg = a.config();
    let host = cfg.cliproxy.host.clone();
    let wanted = args.port.unwrap_or(cfg.cliproxy.port);
    if args.port.is_some() {
        a.set_session_port(Some(wanted));
    }
    let (port, moved) = server::pick_free_port(&host, wanted);
    if moved {
        tracing::warn!("port {wanted} busy — CarteLink uses {port} for this run (not saved)");
        a.set_session_port(Some(port));
    }

    let serve = rt.block_on(async {
        a.server.serve(&host, port, routes::router()).await?;
        a.mark_bound(&host, port);
        instance::register(&host, port);
        Ok::<(), std::io::Error>(())
    });
    if let Err(e) = serve {
        alert(&format!("CarteLink не зміг стартувати.\n\nПорт {host}:{port}: {e}\n\nПовний лог: {}", paths::app_log().display()));
        std::process::exit(1);
    }

    // The engine starts in the background: the UI is up at once and shows
    // "starting" until it is ready.
    rt.spawn(async move {
        let a = app::app();
        let cfg = a.config();
        if let Err(e) = a.engine.start(&cfg).await {
            tracing::error!("engine start: {e}");
            a.log_error(errlog::ErrorEntry { kind: "app".into(), message: format!("engine start failed: {e}"), ..Default::default() });
        }
        a.emit(app::LiveEvent::Changed { what: "status".into() });
        a.refresh_catalog().await;
        a.refresh_caps().await;
    });
    rt.spawn(async { tasks::spawn_all() });

    let mut url = format!("{}/ui/", a.public_base());
    if moved {
        url.push_str(&format!("?moved={wanted}&port={port}"));
    }

    if let Some(w) = &warning
        && args.headless
    {
        eprintln!("{w}");
    }

    #[cfg(any(windows, target_os = "macos"))]
    if !args.headless {
        let (event_loop, handle) = gui::create();
        a.set_desktop(handle);
        if let Some(w) = warning {
            std::thread::spawn(move || alert(&w));
        }
        gui::run(event_loop, gui::Options { url, start_hidden });
    }

    println!("CarteLink {} — one server, one port", config::VERSION);
    println!("  UI:         {url}");
    println!("  OpenAI API: {}/v1/chat/completions", a.public_base());
    println!("  Anthropic:  {}/v1/messages", a.public_base());
    println!("  Gemini:     {}/v1beta/models", a.public_base());
    if moved {
        println!("  (port {wanted} was busy — using {port} for this run)");
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    if !args.headless && !start_hidden {
        browser::open_default(&url);
    }
    rt.block_on(async {
        #[cfg(unix)]
        {
            let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("SIGTERM handler");
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = term.recv() => {}
            }
        }
        #[cfg(not(unix))]
        let _ = tokio::signal::ctrl_c().await;
        shutdown().await;
    });
}

/// Lets the already running copy take the foreground when asked to show itself.
fn allow_foreground(pid: u32) {
    #[cfg(windows)]
    unsafe {
        let _ = windows::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow(pid);
    }
    #[cfg(not(windows))]
    let _ = pid;
}
