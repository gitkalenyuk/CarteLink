#!/usr/bin/env bash
# CarteLink 3 — macOS setup: dependencies, checks, a local build.
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
if ! need cargo; then
  echo "Rust не знайдено — встановлюю rustup (https://rustup.rs)…"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi
if ! xcode-select -p >/dev/null 2>&1; then
  echo "Потрібні Xcode Command Line Tools: виконай  xcode-select --install  і запусти скрипт ще раз." >&2
  exit 1
fi

echo "== versions"; go version; cargo --version

echo "== tests + lint"
cargo test
cargo clippy -- -D warnings

echo "== js syntax"
for f in ui/js/*.js ui/js/pages/*.js ui/js/data/*.js ui/*.js; do node --check "$f"; done

echo "== build"
cargo build --release
cp target/release/cartelink ./cartelink

echo
echo "Готово: ./cartelink  (UI: http://127.0.0.1:8317/ui/, дані: ~/Library/Application Support/CarteLink)"
if [[ "${1:-}" == "--run" ]]; then
  exec ./cartelink
fi
