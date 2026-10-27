.PHONY: build build-native ensure-wasm-bindgen build-wasm build-plugin package install install-remote

PROFILE ?= release
VAULTS_ROOT ?= /Users/josh/Library/Mobile Documents/iCloud~md~obsidian/Documents

NATIVE_FILE := ferrisearch.darwin-arm64.node
NATIVE_BINARY := target/$(PROFILE)/libferrisearch_napi.dylib
WASM_BINARY := target/wasm32-unknown-unknown/$(PROFILE)/ferrisearch_wasm.wasm
PACKAGE := ferrisearch.zip
PACKAGE_FILES := dist/main.js dist/manifest.json dist/styles.css dist/ferrisearch_wasm_bg.wasm $(NATIVE_FILE)

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
	pnpm run build:plugin

package: build
	rm -f "$(PACKAGE)"
	zip -j "$(PACKAGE)" $(PACKAGE_FILES)

install: build
	@set -eu; \
	for vault in "$(VAULTS_ROOT)"/*/; do \
		[ -d "$${vault}.obsidian" ] || continue; \
		dest="$${vault}.obsidian/plugins/ferrisearch"; \
		mkdir -p "$$dest"; \
		cp dist/main.js dist/manifest.json dist/styles.css "$$dest/"; \
		cp "$(NATIVE_FILE)" dist/ferrisearch_wasm_bg.wasm "$$dest/"; \
		echo "Installed to $$dest:"; \
		ls -lh "$$dest"; \
	done

install-remote:
	@set -eu; \
	command -v gh >/dev/null || { echo "install-remote requires the GitHub CLI (gh)" >&2; exit 1; }; \
	command -v unzip >/dev/null || { echo "install-remote requires unzip" >&2; exit 1; }; \
	remote_dir="$$(mktemp -d)"; \
	trap 'rm -rf "$$remote_dir"' EXIT; \
	tag="$$(gh release list --exclude-drafts --limit 100 --json tagName,isPrerelease,publishedAt --jq 'map(select(.isPrerelease)) | sort_by(.publishedAt) | reverse | .[0].tagName // empty')"; \
	test -n "$$tag" || { echo "No prerelease release found" >&2; exit 1; }; \
	echo "Downloading Ferrisearch $$tag..."; \
	gh release download "$$tag" --pattern "$(PACKAGE)" --dir "$$remote_dir"; \
	unzip -q "$$remote_dir/$(PACKAGE)" -d "$$remote_dir/plugin"; \
	for vault in "$(VAULTS_ROOT)"/*/; do \
		[ -d "$${vault}.obsidian" ] || continue; \
		dest="$${vault}.obsidian/plugins/ferrisearch"; \
		mkdir -p "$$dest"; \
		cp "$$remote_dir/plugin/main.js" "$$remote_dir/plugin/manifest.json" "$$remote_dir/plugin/styles.css" "$$remote_dir/plugin/ferrisearch_wasm_bg.wasm" "$$remote_dir/plugin/$(NATIVE_FILE)" "$$dest/"; \
		echo "Installed to $$dest:"; \
		ls -lh "$$dest"; \
	done
