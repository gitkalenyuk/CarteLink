#!/usr/bin/env bash
# CarteLink — macOS setup: dependencies, build, vet, tests.
# Usage: bash scripts/mac-setup.sh [--run]
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

echo "== build"
CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o cartelink .

echo "== vet"
go vet . ./internal/...

echo "== tests"
go test . ./internal/...

echo "== js syntax"
node --check internal/web/ui/app.js
node --check internal/web/ui/presets.js

echo
echo "Готово: ./cartelink  (UI: http://127.0.0.1:8317/ui/, дані: ~/Library/Application Support/CarteLink)"
if [[ "${1:-}" == "--run" ]]; then
  exec ./cartelink
fi
