#!/usr/bin/env bash
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VAULT_ROOT="/Users/josh/iCloud~md~obsidian/Documents"
VAULT_NAMES=("Notes")
CARGO_PROFILE="${1:-dev-fast}"

# Ensure Rust toolchain is in PATH
export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"

# Detect platform
PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
# Map architecture names to match Node.js conventions
case "$ARCH" in
arm64 | aarch64) ARCH="arm64" ;;
x86_64) ARCH="x64" ;;
esac

case "$PLATFORM" in
darwin) DYLIB_EXT="dylib" ;;
linux) DYLIB_EXT="so" ;;
*)
  echo "Unsupported platform: $PLATFORM"
  exit 1
  ;;
esac

NODE_FILE="ferrisearch.${PLATFORM}-${ARCH}.node"

# ── Step 1: Build native Rust module (darwin-arm64 only) ─────────────────────
if [ "$PLATFORM" = "darwin" ] && [ "$ARCH" = "arm64" ]; then
  echo "==> Building native Rust module (profile: $CARGO_PROFILE)..."
  cd "$PROJECT_DIR"
  cargo build --profile "$CARGO_PROFILE" -p ferrisearch-napi

  # The cdylib is named libferrisearch_napi.dylib/.so
  DYLIB_PATH="$PROJECT_DIR/target/$CARGO_PROFILE/libferrisearch_napi.${DYLIB_EXT}"
  if [ ! -f "$DYLIB_PATH" ]; then
    echo "ERROR: Expected dylib not found at $DYLIB_PATH"
    exit 1
  fi

  # Copy the dylib as a .node file (this is what napi-rs CLI does)
  cp "$DYLIB_PATH" "$PROJECT_DIR/$NODE_FILE"
  echo "    Built $NODE_FILE ($(du -h "$PROJECT_DIR/$NODE_FILE" | cut -f1 | xargs))"
else
  echo "==> Skipping native build (not darwin-arm64, will use WASM)"
fi

# ── Step 2: Build WASM module ────────────────────────────────────────────────
echo "==> Building WASM module (profile: $CARGO_PROFILE)..."
cd "$PROJECT_DIR"
cargo build --profile "$CARGO_PROFILE" -p ferrisearch-wasm --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir wasm/pkg "target/wasm32-unknown-unknown/$CARGO_PROFILE/ferrisearch_wasm.wasm"
echo "    Built ferrisearch_wasm_bg.wasm ($(du -h wasm/pkg/ferrisearch_wasm_bg.wasm | cut -f1 | xargs))"

# ── Step 3: Build TypeScript ─────────────────────────────────────────────────
echo "==> Building TypeScript (production)..."
cd "$PROJECT_DIR"
bun run build.ts production
echo "    Built dist/main.js ($(du -h dist/main.js | cut -f1 | xargs))"

# ── Step 4: Install to Obsidian vaults ───────────────────────────────────────
for VAULT in "${VAULT_NAMES[@]}"; do
  PLUGIN_DIR="$VAULT_ROOT/$VAULT/.obsidian/plugins/ferrisearch"
  echo "==> Installing to $PLUGIN_DIR..."
  mkdir -p "$PLUGIN_DIR"
  cp dist/main.js "$PLUGIN_DIR/"
  cp dist/manifest.json "$PLUGIN_DIR/"
  cp dist/styles.css "$PLUGIN_DIR/"
  [ -f "$PROJECT_DIR/$NODE_FILE" ] && cp "$PROJECT_DIR/$NODE_FILE" "$PLUGIN_DIR/"
  cp dist/ferrisearch_wasm_bg.wasm "$PLUGIN_DIR/"
  ls -lh "$PLUGIN_DIR"
  echo ""
done

echo "==> Installed to ${#VAULT_NAMES[@]} vaults!"
echo "Reload Obsidian or toggle the plugin to pick up the changes."
