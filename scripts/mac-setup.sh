#!/usr/bin/env bash
# CarteLink — macOS setup: dependencies, build, vet, tests.
# Usage: bash scripts/mac-setup.sh [--run]
# For a distributable CarteLink.app + .dmg use scripts/build-mac-app.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

need() { command -v "$1" >/dev/null 2>&1; }

if ! need brew; then
  echo "Homebrew не знайдено. Встанови: https://brew.sh" >&2
  exit 1
fi
need go   || brew install go
need node || brew install node
need git  || brew install git

echo "== go version"; go version

# The native window (WKWebView) needs cgo = Xcode Command Line Tools. Without
# them the build still works but opens the UI in the default browser.
CGO=0
if xcode-select -p >/dev/null 2>&1; then
  CGO=1
else
  echo "(!) Xcode Command Line Tools не знайдено — збираю без нативного вікна (UI відкриється в браузері)."
  echo "    Встанови їх:  xcode-select --install"
fi

echo "== build (CGO_ENABLED=$CGO)"
CGO_ENABLED=$CGO go build -trimpath -ldflags "-s -w" -o cartelink .

echo "== vet"
go vet . ./internal/...

echo "== tests"
go test . ./internal/...

echo "== js syntax"
for f in internal/web/ui/*.js; do node --check "$f"; done

echo
echo "Готово: ./cartelink  (UI: http://127.0.0.1:8317/ui/, дані: ~/Library/Application Support/CarteLink)"
if [[ "${1:-}" == "--run" ]]; then
  exec ./cartelink
fi
