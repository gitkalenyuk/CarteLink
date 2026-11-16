//! The desktop window (WebView2 on Windows, WKWebView on macOS), the tray
//! icon and the floating always-on-top model switcher. Runs on the main thread.

use std::sync::{Arc, Mutex};

use tao::dpi::{LogicalSize, PhysicalPosition};
use tao::event::{Event, StartCause, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop, EventLoopBuilder, EventLoopProxy};
use tao::window::{Icon, Theme, Window, WindowBuilder};
use tray_icon::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use wry::{NewWindowResponse, WebContext, WebView, WebViewBuilder};

use crate::app::{Desktop, app};
use crate::traytext::{T, tr};

static ICON32: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/icon32.rgba"));
static ICON256: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/icon256.rgba"));

#[derive(Debug)]
pub enum UserEvent {
    Show,
    SetSwitcher(bool),
    LangChanged,
    Quit,
    Menu(MenuEvent),
    Tray(TrayIconEvent),
}

pub struct Handle {
    proxy: Mutex<EventLoopProxy<UserEvent>>,
}

impl Desktop for Handle {
    fn show_main(&self) {
        self.send(UserEvent::Show);
    }
    fn set_switcher(&self, show: bool) {
        self.send(UserEvent::SetSwitcher(show));
    }
    fn switcher_available(&self) -> bool {
        true
    }
    fn tray_available(&self) -> bool {
        true
    }
    fn lang_changed(&self) {
        self.send(UserEvent::LangChanged);
    }
    fn quit(&self) {
        self.send(UserEvent::Quit);
    }
    fn notify(&self, title: &str, body: &str) {
        let (title, body) = (title.to_string(), body.to_string());
        // Showing a toast talks to the OS (COM / NSUserNotificationCenter):
        // never on the UI thread or a runtime worker.
        let _ = std::thread::Builder::new().name("notify".into()).spawn(move || show_notification(&title, &body));
    }
}

/// The name toasts are shown under ("CarteLink", not "Windows PowerShell").
#[cfg(windows)]
const TOAST_APP_ID: &str = "CarteLink";

/// Windows shows a toast only for a registered AppUserModelID: an
/// unpackaged app registers it under HKCU (no Start-menu shortcut needed).
#[cfg(windows)]
fn toast_app_id() -> Option<&'static str> {
    static OK: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    let ok = *OK.get_or_init(|| {
        let r = windows_registry::CURRENT_USER.create(format!(r"Software\Classes\AppUserModelId\{TOAST_APP_ID}")).and_then(|k| {
            k.set_string("DisplayName", "CarteLink")?;
            k.set_u32("ShowInSettings", 1)
        });
        if let Err(e) = &r {
            tracing::warn!("register toast app id: {e}");
        }
        r.is_ok()
    });
    ok.then_some(TOAST_APP_ID)
}

fn show_notification(title: &str, body: &str) {
    let mut n = notify_rust::Notification::new();
    n.summary(title).body(body).appname("CarteLink");
    #[cfg(windows)]
    if let Some(id) = toast_app_id() {
        n.app_id(id);
    }
    #[cfg(target_os = "macos")]
    {
        static SET: std::sync::Once = std::sync::Once::new();
        SET.call_once(|| {
            let _ = notify_rust::set_application("cartel.link");
        });
    }
    if let Err(e) = n.show() {
        tracing::warn!("notification: {e}");
    }
}

impl Handle {
    fn send(&self, e: UserEvent) {
        if let Ok(p) = self.proxy.lock() {
            let _ = p.send_event(e);
        }
    }
}

pub struct Options {
    pub url: String,
    pub start_hidden: bool,
}

/// Creates the event loop and hands the server side its handle. Must be
/// called on the main thread before `run`.
pub fn create() -> (EventLoop<UserEvent>, Arc<Handle>) {
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let p1 = proxy.clone();
    MenuEvent::set_event_handler(Some(move |e| {
        let _ = p1.send_event(UserEvent::Menu(e));
    }));
    let p2 = proxy.clone();
    TrayIconEvent::set_event_handler(Some(move |e| {
        let _ = p2.send_event(UserEvent::Tray(e));
    }));
    (event_loop, Arc::new(Handle { proxy: Mutex::new(proxy) }))
}

fn icon(bytes: &[u8], size: u32) -> Option<Icon> {
    Icon::from_rgba(bytes.to_vec(), size, size).ok()
}

struct Tray {
    _icon: TrayIcon,
    open: MenuItem,
    switcher: CheckMenuItem,
    quit: MenuItem,
}

fn lang() -> String {
    app().config().desktop.lang.clone()
}

fn build_tray() -> Option<Tray> {
    let l = lang();
    let open = MenuItem::new(tr(&l, T::Open), true, None);
    let switcher = CheckMenuItem::new(tr(&l, T::Switcher), true, app().config().desktop.switcher.enabled, None);
    let quit = MenuItem::new(tr(&l, T::Quit), true, None);
    let menu = Menu::new();
    menu.append_items(&[&open, &switcher, &PredefinedMenuItem::separator(), &quit]).ok()?;
    let ic = tray_icon::Icon::from_rgba(ICON32.to_vec(), 32, 32).ok()?;
    let tray =
        TrayIconBuilder::new().with_menu(Box::new(menu)).with_menu_on_left_click(false).with_tooltip(tr(&l, T::Tip)).with_icon(ic).build().ok()?;
    Some(Tray { _icon: tray, open, switcher, quit })
}

impl Tray {
    fn relabel(&self) {
        let l = lang();
        self.open.set_text(tr(&l, T::Open));
        self.switcher.set_text(tr(&l, T::Switcher));
        self.quit.set_text(tr(&l, T::Quit));
        let _ = self._icon.set_tooltip(Some(tr(&l, T::Tip)));
    }
}

/// Our own pages stay in the window; anything else opens in the browser.
fn is_ours(url: &str) -> bool {
    let Ok(u) = url::Url::parse(url) else { return false };
    if u.scheme() == "about" || u.scheme() == "data" || u.scheme() == "blob" {
        return true;
    }
    let base = app().public_base();
    let Ok(b) = url::Url::parse(&base) else { return false };
    let same_port = u.port_or_known_default() == b.port_or_known_default();
    let local_host = matches!(u.host_str(), Some("127.0.0.1" | "localhost" | "[::1]")) || u.host_str() == b.host_str();
    same_port && local_host && !u.path().starts_with("/v0/resource/plugins/")
}

fn webview(window: &Window, ctx: &mut WebContext, url: &str, devtools: bool) -> wry::Result<WebView> {
    WebViewBuilder::new_with_web_context(ctx)
        .with_url(url)
        .with_devtools(devtools)
        .with_hotkeys_zoom(true)
        .with_clipboard(true)
        .with_background_color((11, 11, 14, 255))
        .with_navigation_handler(|u| {
            if is_ours(&u) {
                true
            } else {
                crate::browser::open_default(&u);
                false
            }
        })
        .with_new_window_req_handler(|u, _| {
            crate::browser::open_default(&u);
            NewWindowResponse::Deny
        })
        .build(window)
}

struct Switcher {
    window: Window,
    _view: WebView,
}

fn switcher_url() -> String {
    format!("{}/ui/switcher.html", app().public_base())
}

fn open_switcher(target: &tao::event_loop::EventLoopWindowTarget<UserEvent>, ctx: &mut WebContext) -> Option<Switcher> {
    let mut b = WindowBuilder::new()
        .with_title("CarteLink")
        .with_inner_size(LogicalSize::new(340.0, 316.0))
        .with_resizable(false)
        .with_minimizable(false)
        .with_maximizable(false)
        .with_always_on_top(true)
        .with_focused(false)
        .with_theme(Some(Theme::Dark))
        .with_window_icon(icon(ICON32, 32));
    #[cfg(windows)]
    {
        use tao::platform::windows::WindowBuilderExtWindows;
        b = b.with_skip_taskbar(true);
    }
    if let Some([x, y]) = app().config().desktop.switcher.pos {
        // Only when the point is still on a monitor.
        let on_screen = target.available_monitors().any(|m| {
            let p = m.position();
            let s = m.size();
            x >= p.x - 100 && y >= p.y && x < p.x + s.width as i32 - 40 && y < p.y + s.height as i32 - 40
        });
        if on_screen {
            b = b.with_position(PhysicalPosition::new(x, y));
        }
    } else if let Some(m) = target.primary_monitor() {
        let s = m.size();
        let sf = m.scale_factor();
        let w = (340.0 * sf) as i32;
        b = b.with_position(PhysicalPosition::new(m.position().x + s.width as i32 - w - (24.0 * sf) as i32, m.position().y + (24.0 * sf) as i32));
    }
    let window = b.build(target).ok()?;
    let view = webview(&window, ctx, &switcher_url(), false).ok()?;
    Some(Switcher { window, _view: view })
}

/// Runs the event loop; never returns.
pub fn run(event_loop: EventLoop<UserEvent>, opts: Options) -> ! {
    let mut ctx = WebContext::new(Some(crate::paths::webview_dir()));
    let window = WindowBuilder::new()
        .with_title("CarteLink")
        .with_inner_size(LogicalSize::new(1280.0, 840.0))
        .with_min_inner_size(LogicalSize::new(940.0, 620.0))
        .with_window_icon(icon(ICON256, 256))
        .with_theme(Some(Theme::Dark))
        .with_visible(false)
        .build(&event_loop)
        .expect("create window");
    let view = match webview(&window, &mut ctx, &opts.url, true) {
        Ok(v) => v,
        Err(e) => {
            crate::alert(&format!(
                "Не вдалось відкрити вікно (WebView): {e}\n\nCarteLink відкриється у вашому браузері. На Windows встановіть Microsoft Edge WebView2 Runtime."
            ));
            crate::browser::open_default(&opts.url);
            // Keep serving without a window.
            loop {
                std::thread::park();
            }
        }
    };
    let main_id = window.id();
    if !opts.start_hidden {
        window.set_visible(true);
    }

    #[cfg(target_os = "macos")]
    let _menubar = macos_menu();

    let mut tray: Option<Tray> = None;
    let mut switcher: Option<Switcher> = None;
    let mut hint_shown = false;
    let mut last_move: Option<((i32, i32), std::time::Instant)> = None;

    let show_main = |w: &Window| {
        w.set_visible(true);
        if w.is_minimized() {
            w.set_minimized(false);
        }
        w.set_focus();
    };

    event_loop.run(move |event, target, control_flow| {
        *control_flow = ControlFlow::Wait;
        let _keep = &view;
        match event {
            Event::NewEvents(StartCause::Init) => {
                tray = build_tray();
                if app().config().desktop.switcher.enabled {
                    switcher = open_switcher(target, &mut ctx);
                }
            }
            Event::WindowEvent { window_id, event: WindowEvent::CloseRequested, .. } => {
                if window_id == main_id {
                    if tray.is_some() && app().config().desktop.close_to_tray {
                        window.set_visible(false);
                        if !hint_shown {
                            hint_shown = true;
                            tracing::info!("window hidden to the tray");
                        }
                    } else {
                        *control_flow = ControlFlow::Exit;
                    }
                } else if switcher.as_ref().is_some_and(|s| s.window.id() == window_id) {
                    switcher = None;
                    let _ = app().update_config(|c| {
                        c.desktop.switcher.enabled = false;
                        Ok(())
                    });
                    if let Some(t) = &tray {
                        t.switcher.set_checked(false);
                    }
                }
            }
            Event::WindowEvent { window_id, event: WindowEvent::Moved(p), .. } => {
                if switcher.as_ref().is_some_and(|s| s.window.id() == window_id) {
                    last_move = Some(((p.x, p.y), std::time::Instant::now() + std::time::Duration::from_millis(600)));
                }
            }
            Event::UserEvent(UserEvent::Show) => show_main(&window),
            Event::UserEvent(UserEvent::SetSwitcher(on)) => {
                if on && switcher.is_none() {
                    switcher = open_switcher(target, &mut ctx);
                } else if !on {
                    switcher = None;
                }
                if let Some(t) = &tray {
                    t.switcher.set_checked(on);
                }
            }
            Event::UserEvent(UserEvent::LangChanged) => {
                if let Some(t) = &tray {
                    t.relabel();
                }
            }
            Event::UserEvent(UserEvent::Quit) => *control_flow = ControlFlow::Exit,
            Event::UserEvent(UserEvent::Tray(
                TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } | TrayIconEvent::DoubleClick { .. },
            )) => show_main(&window),
            Event::UserEvent(UserEvent::Menu(e)) => {
                if let Some(t) = &tray {
                    if e.id == *t.open.id() {
                        show_main(&window);
                    } else if e.id == *t.quit.id() {
                        *control_flow = ControlFlow::Exit;
                    } else if e.id == *t.switcher.id() {
                        let on = t.switcher.is_checked();
                        let _ = app().update_config(|c| {
                            c.desktop.switcher.enabled = on;
                            Ok(())
                        });
                        if on && switcher.is_none() {
                            switcher = open_switcher(target, &mut ctx);
                        } else if !on {
                            switcher = None;
                        }
                    }
                }
            }
            #[cfg(target_os = "macos")]
            Event::Reopen { .. } => show_main(&window),
            Event::LoopDestroyed => {
                switcher = None;
                tray = None;
                crate::block_shutdown();
            }
            _ => {}
        }
        // The switcher's position is saved once dragging stops.
        if let Some(((x, y), at)) = last_move {
            if std::time::Instant::now() >= at {
                last_move = None;
                let _ = app().update_config(|c| {
                    c.desktop.switcher.pos = Some([x, y]);
                    Ok(())
                });
            } else if *control_flow == ControlFlow::Wait {
                *control_flow = ControlFlow::WaitUntil(at);
            }
        }
    })
}

/// macOS needs an app menu with an Edit submenu, or Cmd+C / Cmd+V do nothing
/// in the web view.
#[cfg(target_os = "macos")]
fn macos_menu() -> Menu {
    use tray_icon::menu::Submenu;
    let menu = Menu::new();
    let app_menu = Submenu::with_items(
        "CarteLink",
        true,
        &[&PredefinedMenuItem::about(None, None), &PredefinedMenuItem::separator(), &PredefinedMenuItem::hide(None), &PredefinedMenuItem::quit(None)],
    )
    .expect("menu");
    let edit = Submenu::with_items(
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(None),
            &PredefinedMenuItem::redo(None),
            &PredefinedMenuItem::separator(),
            &PredefinedMenuItem::cut(None),
            &PredefinedMenuItem::copy(None),
            &PredefinedMenuItem::paste(None),
            &PredefinedMenuItem::select_all(None),
        ],
    )
    .expect("menu");
    let _ = menu.append_items(&[&app_menu, &edit]);
    menu.init_for_nsapp();
    menu
}
