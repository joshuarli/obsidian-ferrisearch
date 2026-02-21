set shell := ["bash", "-euo", "pipefail", "-c"]

default:
    @just --list

setup:
    prek install --install-hooks

loc:
    tokei

dev:
    bun run --watch build.ts

build:
    bun run build.ts production

build-rust:
    cargo build --release -p ferrisearch-napi

build-wasm:
    cargo build --release -p ferrisearch-wasm --target wasm32-unknown-unknown
    wasm-bindgen --target web --out-dir wasm/pkg target/wasm32-unknown-unknown/release/ferrisearch_wasm.wasm

build-all: build-rust build-wasm build

install:
    bash scripts/build-and-install.sh

test-wasm:
    WASM_BINDGEN_TEST_ONLY_NODE=1 cargo test -p ferrisearch-wasm --target wasm32-unknown-unknown

test: test-rust test-ts

test-rust:
    cargo test --all

test-ts:
    bun test

test-watch:
    bun test --watch

lint: lint-ts lint-rust

lint-ts:
    bunx biome check .

lint-rust:
    cargo clippy --all-targets --all-features -- -D warnings

fmt: fmt-ts fmt-rust

fmt-ts:
    bunx biome check --write .

fmt-rust:
    cargo fmt --all

fmt-rust-check:
    cargo fmt --all -- --check

pre-commit:
    prek run --all-files

ci: lint fmt-rust-check test build
