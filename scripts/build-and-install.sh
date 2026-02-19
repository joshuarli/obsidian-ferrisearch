#!/usr/bin/env bash
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VAULT_PATH="${FERRISEARCH_VAULT:-/Users/josh/iCloud~md~obsidian/Documents/Notes}"
PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/ferrisearch"

# Ensure Rust toolchain is in PATH
export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"

# Detect platform
PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
# Map architecture names to match Node.js conventions
case "$ARCH" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64)        ARCH="x64" ;;
esac

case "$PLATFORM" in
  darwin) DYLIB_EXT="dylib" ;;
  linux)  DYLIB_EXT="so" ;;
  *)      echo "Unsupported platform: $PLATFORM"; exit 1 ;;
esac

NODE_FILE="ferrisearch.${PLATFORM}-${ARCH}.node"

# ── Step 1: Build native Rust module ─────────────────────────────────────────
echo "==> Building native Rust module (release)..."
cd "$PROJECT_DIR"
cargo build --release -p ferrisearch-napi

# The cdylib is named libferrisearch_napi.dylib/.so
DYLIB_PATH="$PROJECT_DIR/target/release/libferrisearch_napi.${DYLIB_EXT}"
if [ ! -f "$DYLIB_PATH" ]; then
  echo "ERROR: Expected dylib not found at $DYLIB_PATH"
  exit 1
fi

# Copy the dylib as a .node file (this is what napi-rs CLI does)
cp "$DYLIB_PATH" "$PROJECT_DIR/$NODE_FILE"
echo "    Built $NODE_FILE ($(du -h "$PROJECT_DIR/$NODE_FILE" | cut -f1 | xargs))"

# ── Step 2: Build TypeScript ─────────────────────────────────────────────────
echo "==> Building TypeScript (production)..."
cd "$PROJECT_DIR"
bun run build.ts production
echo "    Built dist/main.js ($(du -h dist/main.js | cut -f1 | xargs))"

# ── Step 3: Install to Obsidian vault ────────────────────────────────────────
echo "==> Installing to $PLUGIN_DIR..."
mkdir -p "$PLUGIN_DIR"
cp dist/main.js     "$PLUGIN_DIR/"
cp dist/manifest.json "$PLUGIN_DIR/"
cp dist/styles.css  "$PLUGIN_DIR/"
cp "$PROJECT_DIR/$NODE_FILE" "$PLUGIN_DIR/"

echo ""
echo "==> Installed successfully!"
ls -lh "$PLUGIN_DIR"
echo ""
echo "Reload Obsidian or toggle the plugin to pick up the changes."
