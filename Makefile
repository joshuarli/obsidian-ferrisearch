.PHONY: build build-native ensure-wasm-bindgen build-wasm build-plugin install

PROFILE ?= release
VAULT_PLUGIN ?= /Users/josh/iCloud~md~obsidian/Documents/Notes/.obsidian/plugins/ferrisearch

NATIVE_FILE := ferrisearch.darwin-arm64.node
NATIVE_BINARY := target/$(PROFILE)/libferrisearch_napi.dylib
WASM_BINARY := target/wasm32-unknown-unknown/$(PROFILE)/ferrisearch_wasm.wasm

# wasm-bindgen's CLI schema must match the Rust crate that produced the Wasm.
# Read the resolved crate version instead of maintaining a second version pin.
WASM_BINDGEN_VERSION := $(shell awk '$$0 == "name = \"wasm-bindgen\"" { getline; sub(/^version = "/, ""); sub(/"$$/, ""); print; exit }' Cargo.lock)
WASM_BINDGEN_ROOT ?= target/wasm-bindgen-cli
WASM_BINDGEN ?= $(WASM_BINDGEN_ROOT)/bin/wasm-bindgen

build: build-native build-wasm build-plugin

build-native:
	@test "$$(uname -s)" = Darwin || { echo "Ferrisearch native builds require macOS" >&2; exit 1; }
	@test "$$(uname -m)" = arm64 || { echo "Ferrisearch native builds require arm64" >&2; exit 1; }
	cargo build --profile "$(PROFILE)" -p ferrisearch-napi
	cp "$(NATIVE_BINARY)" "$(NATIVE_FILE)"

ensure-wasm-bindgen:
	@if [ ! -x "$(WASM_BINDGEN)" ] || [ "$$("$(WASM_BINDGEN)" --version | awk '{print $$2}')" != "$(WASM_BINDGEN_VERSION)" ]; then \
		echo "Installing wasm-bindgen-cli $(WASM_BINDGEN_VERSION)..."; \
		cargo install --locked --force wasm-bindgen-cli --version "$(WASM_BINDGEN_VERSION)" --root "$(WASM_BINDGEN_ROOT)"; \
	fi
	@test -x "$(WASM_BINDGEN)" || { echo "wasm-bindgen CLI was not installed at $(WASM_BINDGEN)" >&2; exit 1; }

build-wasm: ensure-wasm-bindgen
	cargo build --profile "$(PROFILE)" -p ferrisearch-wasm --target wasm32-unknown-unknown
	"$(WASM_BINDGEN)" --target web --out-dir wasm/pkg "$(WASM_BINARY)"

build-plugin: build-wasm
	deno run -A build.ts production

install: build
	mkdir -p "$(VAULT_PLUGIN)"
	cp dist/main.js dist/manifest.json dist/styles.css "$(VAULT_PLUGIN)/"
	cp "$(NATIVE_FILE)" dist/ferrisearch_wasm_bg.wasm "$(VAULT_PLUGIN)/"
	ls -lh "$(VAULT_PLUGIN)"
