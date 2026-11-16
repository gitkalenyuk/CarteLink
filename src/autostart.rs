//! Start with the system: Windows HKCU Run key, a macOS LaunchAgent, or an
//! XDG autostart entry. Always "--minimized" (straight to the tray).

fn exe() -> String {
    std::env::current_exe()
        .ok()
        .map(|p| std::fs::canonicalize(&p).unwrap_or(p))
        .map(|p| {
            let s = p.to_string_lossy().to_string();
            // canonicalize on Windows gives \\?\C:\…, which Run entries do not like.
            s.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(s)
        })
        .unwrap_or_default()
}

#[cfg(windows)]
mod imp {
    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const VALUE: &str = "CarteLink";

    fn command() -> String {
        format!("\"{}\" --minimized", super::exe())
    }

    pub fn enabled() -> bool {
        windows_registry::CURRENT_USER.open(RUN).and_then(|k| k.get_string(VALUE)).is_ok()
    }

    pub fn set(on: bool) -> Result<(), String> {
        let k = windows_registry::CURRENT_USER.create(RUN).map_err(|e| e.to_string())?;
        if on {
            k.set_string(VALUE, command()).map_err(|e| e.to_string())
        } else {
            match k.remove_value(VALUE) {
                Ok(()) => Ok(()),
                Err(e) if e.code().0 as u32 == 0x8007_0002 => Ok(()), // not found
                Err(e) => Err(e.to_string()),
            }
        }
    }

    /// Re-points an existing entry at the running executable (moved/renamed).
    pub fn refresh() {
        let Ok(k) = windows_registry::CURRENT_USER.options().read().write().open(RUN) else { return };
        if let Ok(cur) = k.get_string(VALUE) {
            let want = command();
            if cur != want {
                let _ = k.set_string(VALUE, want);
            }
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use std::path::PathBuf;

    const LABEL: &str = "link.cartel.cartelink";

    fn path() -> PathBuf {
        let home = dirs::home_dir().unwrap_or_default();
        if cfg!(target_os = "macos") {
            home.join("Library/LaunchAgents").join(format!("{LABEL}.plist"))
        } else {
            home.join(".config/autostart/cartelink.desktop")
        }
    }

    fn xml_esc(s: &str) -> String {
        s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
    }

    fn content() -> String {
        let exe = super::exe();
        if cfg!(target_os = "macos") {
            let args: Vec<String> = match exe.find(".app/Contents/MacOS/") {
                // Inside a bundle: launch the bundle so macOS treats it as the app.
                Some(i) => vec!["/usr/bin/open".into(), "-a".into(), exe[..i + 4].into(), "--args".into(), "--minimized".into()],
                None => vec![exe.clone(), "--minimized".into()],
            };
            let mut s = String::from(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n",
            );
            s.push_str(&format!("\t<key>Label</key><string>{LABEL}</string>\n\t<key>ProgramArguments</key>\n\t<array>\n"));
            for a in args {
                s.push_str(&format!("\t\t<string>{}</string>\n", xml_esc(&a)));
            }
            s.push_str("\t</array>\n\t<key>RunAtLoad</key><true/>\n</dict>\n</plist>\n");
            s
        } else {
            format!("[Desktop Entry]\nType=Application\nName=CarteLink\nExec=\"{exe}\" --minimized\nX-GNOME-Autostart-enabled=true\n")
        }
    }

    pub fn enabled() -> bool {
        path().exists()
    }

    pub fn set(on: bool) -> Result<(), String> {
        let p = path();
        if !on {
            return match std::fs::remove_file(&p) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
                _ => Ok(()),
            };
        }
        if let Some(d) = p.parent() {
            std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
        }
        std::fs::write(&p, content()).map_err(|e| e.to_string())
    }

    pub fn refresh() {
        if enabled() {
            let want = content();
            if std::fs::read_to_string(path()).map(|c| c != want).unwrap_or(true) {
                let _ = std::fs::write(path(), want);
            }
        }
    }
}

pub use imp::{enabled, refresh, set};
