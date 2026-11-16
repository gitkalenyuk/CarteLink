//! Build script:
//!  1. compiles the CLIProxyAPI engine host (enginehost/, Go) for the target
//!     and embeds it zstd-compressed — one executable ships everything;
//!  2. renders the app icon into raw RGBA for the window and tray;
//!  3. on Windows adds the icon and version info to the executable.
//!
//! `CARTELINK_ENGINE_BIN=<path>` uses a prebuilt engine instead of running Go.

use std::hash::{DefaultHasher, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    println!("cargo:rerun-if-changed=enginehost");
    println!("cargo:rerun-if-changed=third_party/CLIProxyAPI");
    println!("cargo:rerun-if-changed=go.mod");
    println!("cargo:rerun-if-changed=build/icon256.png");
    println!("cargo:rerun-if-env-changed=CARTELINK_ENGINE_BIN");

    let engine = build_engine(&manifest, &out);
    let bytes = std::fs::read(&engine).expect("read engine binary");
    let mut h = DefaultHasher::new();
    h.write(&bytes);
    let id = format!("{:016x}", h.finish());
    let packed = zstd::stream::encode_all(&bytes[..], 19).expect("compress engine");
    std::fs::write(out.join("engine.zst"), packed).unwrap();
    println!("cargo:rustc-env=CARTELINK_ENGINE_ID={}", &id[..12]);
    println!("cargo:rustc-env=CARTELINK_ENGINE_VERSION={}", upstream_version(&manifest));

    icons(&manifest, &out);

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        #[cfg(windows)]
        {
            let mut res = winresource::WindowsResource::new();
            res.set_icon(manifest.join("build/icon.ico").to_str().unwrap());
            res.set("ProductName", "CarteLink");
            res.set("FileDescription", "CarteLink — local AI gateway");
            res.set("CompanyName", "YouTube Cartel");
            res.set("LegalCopyright", "YouTube Cartel");
            res.set_manifest(MANIFEST);
            res.compile().expect("windows resources");
        }
    }
}

/// Per-monitor DPI awareness and modern common controls for message boxes.
#[cfg(windows)]
const MANIFEST: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency><dependentAssembly>
    <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/>
  </dependentAssembly></dependency>
  <application xmlns="urn:schemas-microsoft-com:asm.v3"><windowsSettings>
    <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
    <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
  </windowsSettings></application>
</assembly>"#;

fn upstream_version(manifest: &Path) -> String {
    let src = std::fs::read_to_string(manifest.join("enginehost/main.go")).unwrap_or_default();
    src.lines().find_map(|l| l.trim().strip_prefix("const UpstreamVersion = \"").and_then(|r| r.strip_suffix('"'))).unwrap_or("unknown").to_string()
}

fn build_engine(manifest: &Path, out: &Path) -> PathBuf {
    if let Ok(p) = std::env::var("CARTELINK_ENGINE_BIN") {
        let p = PathBuf::from(p);
        assert!(p.exists(), "CARTELINK_ENGINE_BIN does not exist: {}", p.display());
        return p;
    }
    let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap();
    let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap();
    let goos = match os.as_str() {
        "macos" => "darwin",
        other => other,
    };
    let goarch = match arch.as_str() {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        "x86" => "386",
        other => other,
    };
    let exe = out.join(if goos == "windows" { "engine.exe" } else { "engine" });
    let mut ldflags = String::from("-s -w");
    if goos == "windows" {
        ldflags.push_str(" -H=windowsgui");
    }
    let mut cmd = Command::new(std::env::var("GO").unwrap_or_else(|_| "go".into()));
    cmd.current_dir(manifest)
        .args(["build", "-trimpath", "-ldflags", &ldflags, "-o"])
        .arg(&exe)
        .arg("./enginehost")
        .env("GOOS", goos)
        .env("GOARCH", goarch);
    // macOS plugins are loaded through dlopen (cgo); elsewhere pure Go.
    cmd.env("CGO_ENABLED", if goos == "darwin" { "1" } else { "0" });
    let status = cmd.status().expect("run `go build` — install Go (see go.mod) or set CARTELINK_ENGINE_BIN");
    assert!(status.success(), "go build of the engine failed");
    exe
}

fn icons(manifest: &Path, out: &Path) {
    let img = image::open(manifest.join("build/icon256.png")).expect("build/icon256.png").to_rgba8();
    for size in [32u32, 256] {
        let r = image::imageops::resize(&img, size, size, image::imageops::FilterType::Lanczos3);
        std::fs::write(out.join(format!("icon{size}.rgba")), r.as_raw()).unwrap();
    }
}
