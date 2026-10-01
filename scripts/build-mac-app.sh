#!/usr/bin/env bash
# CarteLink — macOS release build: universal (Apple Silicon + Intel) binary with
# the native WKWebView window, wrapped into CarteLink.app and CarteLink-<ver>.dmg.
#
# Needs: Go ≥ 1.27, Xcode Command Line Tools (xcode-select --install).
# Usage: bash scripts/build-mac-app.sh            → dist/CarteLink.app + dist/CarteLink-<ver>.dmg
#        ARCH=arm64 bash scripts/build-mac-app.sh → one architecture only (faster)
set -euo pipefail
cd "$(dirname "$0")/.."

if ! xcode-select -p >/dev/null 2>&1; then
  echo "Потрібні Xcode Command Line Tools: виконай  xcode-select --install  і запусти скрипт ще раз." >&2
  exit 1
fi

VERSION=$(sed -n 's/^const Version = "\(.*\)"/\1/p' internal/config/config.go)
APP=dist/CarteLink.app
DMG=dist/CarteLink-${VERSION}.dmg
ARCHS=${ARCH:-"arm64 amd64"}
# Go 1.27 itself targets macOS 13 (its linker stamps go.o with 13.0). The cgo
# objects need the same target in CGO_CFLAGS/CGO_LDFLAGS: unlike
# MACOSX_DEPLOYMENT_TARGET these are part of Go's build-cache key, so objects
# cached from a plain `go build` (built for the host macOS) are not reused.
MINOS=13.0

echo "== CarteLink ${VERSION}: tests"
go vet . ./internal/...
go test . ./internal/...

rm -rf dist && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "== build (${ARCHS})"
BINS=()
for a in $ARCHS; do
  CGO_ENABLED=1 GOOS=darwin GOARCH=$a MACOSX_DEPLOYMENT_TARGET=$MINOS \
    CGO_CFLAGS="-O2 -g -mmacosx-version-min=$MINOS" CGO_LDFLAGS="-mmacosx-version-min=$MINOS" \
    go build -trimpath -ldflags "-s -w" -o "dist/cartelink-$a" .
  BINS+=("dist/cartelink-$a")
done
if [ ${#BINS[@]} -gt 1 ]; then
  lipo -create -output "$APP/Contents/MacOS/cartelink" "${BINS[@]}"
else
  cp "${BINS[0]}" "$APP/Contents/MacOS/cartelink"
fi
rm -f dist/cartelink-*

echo "== icon"
ICONSET=dist/icon.iconset
mkdir -p "$ICONSET"
for s in 16 32 128 256; do
  sips -z $s $s build/icon256.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  if [ $d -le 256 ]; then
    sips -z $d $d build/icon256.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
  fi
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/CarteLink.icns"
rm -rf "$ICONSET"

cat > "$APP/Contents/Info.plist" <<PLIST
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
codesign --force --deep --sign - "$APP"

echo "== dmg"
STAGE=dist/dmg
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "CarteLink ${VERSION}" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$STAGE"

echo
echo "Готово:"
echo "  $APP"
echo "  $DMG   ← цей файл роздавай користувачам"
