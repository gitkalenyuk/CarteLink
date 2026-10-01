#!/usr/bin/env bash
# CarteLink — macOS release build with the native WKWebView window. Each
# architecture is compiled once; the binaries are then packaged three ways:
#   dist/CarteLink-<ver>.dmg               universal (Apple Silicon + Intel)
#   dist/CarteLink-<ver>-apple-silicon.dmg arm64 only (M1…M5), half the size
#   dist/CarteLink-<ver>-intel.dmg         x86_64 only
# dist/CarteLink.app is the universal bundle (for a quick local run/install).
#
# Needs: Go ≥ 1.27, Xcode Command Line Tools (xcode-select --install).
# Usage: bash scripts/build-mac-app.sh            → all three .dmg
#        ARCH=arm64 bash scripts/build-mac-app.sh → one architecture only (faster)
set -euo pipefail
cd "$(dirname "$0")/.."

if ! xcode-select -p >/dev/null 2>&1; then
  echo "Потрібні Xcode Command Line Tools: виконай  xcode-select --install  і запусти скрипт ще раз." >&2
  exit 1
fi

VERSION=$(sed -n 's/^const Version = "\(.*\)"/\1/p' internal/config/config.go)
APP=dist/CarteLink.app
ARCHS=${ARCH:-"arm64 amd64"}
# Go 1.27 itself targets macOS 13 (its linker stamps go.o with 13.0). The cgo
# objects need the same target in CGO_CFLAGS/CGO_LDFLAGS: unlike
# MACOSX_DEPLOYMENT_TARGET these are part of Go's build-cache key, so objects
# cached from a plain `go build` (built for the host macOS) are not reused.
MINOS=13.0

label() { case $1 in arm64) echo apple-silicon ;; amd64) echo intel ;; *) echo "$1" ;; esac; }

echo "== CarteLink ${VERSION}: tests"
go vet . ./internal/...
go test . ./internal/...

rm -rf dist && mkdir -p dist

echo "== build (${ARCHS})"
BINS=()
for a in $ARCHS; do
  CGO_ENABLED=1 GOOS=darwin GOARCH=$a MACOSX_DEPLOYMENT_TARGET=$MINOS \
    CGO_CFLAGS="-O2 -g -mmacosx-version-min=$MINOS" CGO_LDFLAGS="-mmacosx-version-min=$MINOS" \
    go build -trimpath -ldflags "-s -w" -o "dist/cartelink-$a" .
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
  # Ad-hoc signature: required on Apple Silicon, lets Gatekeeper show the usual
  # "unidentified developer" prompt (right-click → Open) instead of "damaged".
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
