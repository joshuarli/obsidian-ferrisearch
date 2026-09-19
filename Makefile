.PHONY: build build-native build-wasm build-plugin install

PROFILE ?= dev-fast
VAULT_PLUGIN ?= /Users/josh/iCloud~md~obsidian/Documents/Notes/.obsidian/plugins/ferrisearch

NATIVE_FILE := ferrisearch.darwin-arm64.node
NATIVE_BINARY := target/$(PROFILE)/libferrisearch_napi.dylib
WASM_BINARY := target/wasm32-unknown-unknown/$(PROFILE)/ferrisearch_wasm.wasm

build: build-native build-wasm build-plugin

build-native:
	@test "$$(uname -s)" = Darwin || { echo "Ferrisearch native builds require macOS" >&2; exit 1; }
	@test "$$(uname -m)" = arm64 || { echo "Ferrisearch native builds require arm64" >&2; exit 1; }
	cargo build --profile "$(PROFILE)" -p ferrisearch-napi
	cp "$(NATIVE_BINARY)" "$(NATIVE_FILE)"

build-wasm:
	cargo build --profile "$(PROFILE)" -p ferrisearch-wasm --target wasm32-unknown-unknown
	wasm-bindgen --target web --out-dir wasm/pkg "$(WASM_BINARY)"

build-plugin: build-wasm
	deno run -A build.ts production

install: build
	mkdir -p "$(VAULT_PLUGIN)"
	cp dist/main.js dist/manifest.json dist/styles.css "$(VAULT_PLUGIN)/"
	cp "$(NATIVE_FILE)" dist/ferrisearch_wasm_bg.wasm "$(VAULT_PLUGIN)/"
	ls -lh "$(VAULT_PLUGIN)"
