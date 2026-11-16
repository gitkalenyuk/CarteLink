//! Opening URLs and folders outside the app.

use std::path::Path;
use std::process::{Child, Command};

/// Opens a URL in the default browser.
pub fn open_default(url: &str) {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return;
    }
    let _ = spawn_default(url);
}

fn spawn_default(target: &str) -> std::io::Result<Child> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        Command::new("rundll32").args(["url.dll,FileProtocolHandler", target]).creation_flags(0x0800_0000).spawn()
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(target).spawn()
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open").arg(target).spawn()
    }
}

/// Opens a folder in the file manager.
pub fn open_path(p: &Path) {
    #[cfg(windows)]
    let _ = Command::new("explorer").arg(p).spawn();
    #[cfg(not(windows))]
    let _ = spawn_default(&p.to_string_lossy());
}

/// Opens a sign-in page in a separate private browser window with a throwaway
/// profile: no cookies of earlier logins (one account per sign-in), and
/// killing the process really closes the window after the login. Falls back
/// to the default browser (which then cannot be closed automatically).
pub fn open_clean(url: &str) -> Option<Child> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return None;
    }
    let profile = crate::paths::data_dir().join("oauth-browser");
    let _ = std::fs::remove_dir_all(&profile);
    let _ = std::fs::create_dir_all(&profile);
    let args = |private: &str| -> Vec<String> {
        vec![
            format!("--user-data-dir={}", profile.display()),
            "--no-first-run".into(),
            "--no-default-browser-check".into(),
            private.into(),
            "--new-window".into(),
            url.into(),
        ]
    };
    let mut candidates: Vec<(std::path::PathBuf, &str)> = vec![];
    #[cfg(windows)]
    {
        let env = |k: &str| std::env::var(k).unwrap_or_default();
        let (pf, pf86, local) = (env("ProgramFiles"), env("ProgramFiles(x86)"), env("LocalAppData"));
        for (base, rel, private) in [
            (&pf86, r"Microsoft\Edge\Application\msedge.exe", "--inprivate"),
            (&pf, r"Microsoft\Edge\Application\msedge.exe", "--inprivate"),
            (&pf, r"Google\Chrome\Application\chrome.exe", "--incognito"),
            (&pf86, r"Google\Chrome\Application\chrome.exe", "--incognito"),
            (&local, r"Google\Chrome\Application\chrome.exe", "--incognito"),
            (&pf, r"BraveSoftware\Brave-Browser\Application\brave.exe", "--incognito"),
            (&local, r"BraveSoftware\Brave-Browser\Application\brave.exe", "--incognito"),
        ] {
            if !base.is_empty() {
                candidates.push((Path::new(base).join(rel), private));
            }
        }
    }
    #[cfg(target_os = "macos")]
    for app in [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ] {
        candidates.push((app.into(), "--incognito"));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    for bin in ["google-chrome", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"] {
        candidates.push((bin.into(), "--incognito"));
    }
    for (bin, private) in candidates {
        if bin.is_absolute() && !bin.exists() {
            continue;
        }
        if let Ok(c) = Command::new(&bin).args(args(private)).spawn() {
            return Some(c);
        }
    }
    open_default(url);
    None
}
