#!/usr/bin/env bash
# CarteLink 3 — macOS release build (WKWebView window, menu-bar icon). Each
# architecture is compiled once (build.rs also compiles the Go engine for that
# architecture and embeds it); the binaries are packaged three ways:
#   dist/CarteLink-<ver>.dmg               universal (Apple Silicon + Intel)
#   dist/CarteLink-<ver>-apple-silicon.dmg arm64 only, half the size
#   dist/CarteLink-<ver>-intel.dmg         x86_64 only
# dist/CarteLink.app is the universal bundle.
#
# Needs: Rust (rustup), Go ≥ 1.27, Xcode Command Line Tools (xcode-select --install).
# Usage: bash scripts/build-mac-app.sh            → all three .dmg
#        ARCH=arm64 bash scripts/build-mac-app.sh → one architecture only (faster)
set -euo pipefail
cd "$(dirname "$0")/.."

if ! xcode-select -p >/dev/null 2>&1; then
  echo "Потрібні Xcode Command Line Tools: виконай  xcode-select --install  і запусти скрипт ще раз." >&2
  exit 1
fi

VERSION=$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -1)
APP=dist/CarteLink.app
ARCHS=${ARCH:-"arm64 amd64"}
MINOS=13.0
export MACOSX_DEPLOYMENT_TARGET=$MINOS
export CGO_CFLAGS="-O2 -mmacosx-version-min=$MINOS"
export CGO_LDFLAGS="-mmacosx-version-min=$MINOS"

label() { case $1 in arm64) echo apple-silicon ;; amd64) echo intel ;; *) echo "$1" ;; esac; }
triple() { case $1 in arm64) echo aarch64-apple-darwin ;; amd64) echo x86_64-apple-darwin ;; esac; }

echo "== CarteLink ${VERSION}: tests"
cargo test --release

rm -rf dist && mkdir -p dist

echo "== build (${ARCHS})"
BINS=()
for a in $ARCHS; do
  t=$(triple "$a")
  rustup target add "$t" >/dev/null
  cargo build --release --target "$t"
  cp "target/$t/release/cartelink" "dist/cartelink-$a"
  BINS+=("dist/cartelink-$a")
done

echo "== icon"
ICONSET=dist/icon.iconset
ICNS=dist/CarteLink.icns
mkdir -p "$ICONSET"
for s in 16 32 128 256; do
  sips -z $s $s build/icon256.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  if [ $d -le 256 ]; then
    sips -z $d $d build/icon256.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
  fi
done
iconutil -c icns "$ICONSET" -o "$ICNS"
rm -rf "$ICONSET"

# make_app <bundle> <binary...> — one binary is copied, several are lipo'd.
make_app() {
  local app=$1
  shift
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
  if [ $# -gt 1 ]; then
    lipo -create -output "$app/Contents/MacOS/cartelink" "$@"
  else
    cp "$1" "$app/Contents/MacOS/cartelink"
  fi
  cp "$ICNS" "$app/Contents/Resources/CarteLink.icns"
  cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>CarteLink</string>
  <key>CFBundleDisplayName</key><string>CarteLink</string>
  <key>CFBundleIdentifier</key><string>cartel.link</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleExecutable</key><string>cartelink</string>
  <key>CFBundleIconFile</key><string>CarteLink</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>${MINOS}</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST
  # Ad-hoc signature: required on Apple Silicon; Gatekeeper then shows the
  # usual "unidentified developer" prompt (right-click → Open).
  codesign --force --deep --sign - "$app"
}

# make_dmg <bundle> <dmg> — the bundle next to an /Applications shortcut.
make_dmg() {
  local stage=dist/dmg
  rm -rf "$stage" && mkdir -p "$stage"
  cp -R "$1" "$stage/"
  ln -s /Applications "$stage/Applications"
  hdiutil create -volname "CarteLink ${VERSION}" -srcfolder "$stage" -ov -format UDZO "$2" >/dev/null
  rm -rf "$stage"
  DMGS+=("$2")
}

echo "== app + dmg"
DMGS=()
make_app "$APP" "${BINS[@]}"
if [ ${#BINS[@]} -gt 1 ]; then
  make_dmg "$APP" "dist/CarteLink-${VERSION}.dmg"
  for a in $ARCHS; do
    one=dist/$(label "$a")/CarteLink.app
    make_app "$one" "dist/cartelink-$a"
    make_dmg "$one" "dist/CarteLink-${VERSION}-$(label "$a").dmg"
    rm -rf "$(dirname "$one")"
  done
else
  make_dmg "$APP" "dist/CarteLink-${VERSION}-$(label "$ARCHS").dmg"
fi
rm -f dist/cartelink-* "$ICNS"

echo
echo "Готово:"
echo "  $APP"
for d in "${DMGS[@]}"; do
  echo "  $d   ($(du -h "$d" | cut -f1))"
done
echo "Ці .dmg роздавай користувачам (universal підходить будь-якому Mac)."
