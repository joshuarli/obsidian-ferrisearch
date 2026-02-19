set shell := ["bash", "-euo", "pipefail", "-c"]

default:
    @just --list

setup:
    prek install --install-hooks

loc:
    tokei

bench:
    cargo bench --bench query

dev:
    bun run --watch build.ts

build:
    bun run build.ts production

build-rust:
    cargo build --release -p ferrisearch-napi

build-all: build-rust build

# Build and install to Obsidian vault
install:
    bash scripts/build-and-install.sh

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
