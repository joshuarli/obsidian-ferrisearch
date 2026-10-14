# Ferrisearch

Ferrisearch is an Obsidian plugin for full-text search across Markdown notes.

## Build, test, and check

- Build the plugin bundle: `pnpm run build`.
- Build the native engine, WASM engine, and plugin: `pnpm run build:all`.
- Run TypeScript tests: `pnpm run test`.
- Run Rust tests: `cargo test`.
- Check TypeScript: `pnpm run lint:check && pnpm run typecheck`.
- Check Rust: `cargo clippy --all-targets --all-features -- -D warnings`.

## Invariants

- Only vault paths ending in `.md` are indexed. See [indexing](docs/indexing.md).
- Only desktop macOS arm64 attempts the native engine. Other platforms use WASM directly. See [architecture](docs/architecture.md).
- The NAPI and WASM bindings call the shared `ferrisearch-core` crate. See [architecture](docs/architecture.md).
- Update the owning topic doc when a code change alters documented behavior.

## Topics

- Search fields, query syntax, and ranking: [search](docs/search.md).
- Index updates and persisted data: [indexing](docs/indexing.md).
- Platform selection and engine layout: [architecture](docs/architecture.md).
- Integrations with other Obsidian plugins: [plugin API](docs/api.md).
- Result limit proposal: [FERR-7 RFC](docs/rfc/FERR-7-result-limit.md).
- Local setup and development commands: [development](docs/development.md).
- Package and prerelease workflow: [releases](docs/releases.md).
- Benchmark method and recorded results: [performance](docs/performance.md).
