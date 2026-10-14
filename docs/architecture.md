# Architecture

Ferrisearch uses a TypeScript Obsidian plugin and a Rust search engine. The TypeScript layer reads vault files and prepares queries. [`ferrisearch-core`](../crates/ferrisearch-core/src/lib.rs) owns the Tantivy schema, tokenizer, and search logic. The [NAPI-RS](../napi/src/lib.rs) and [WASM](../wasm/src/lib.rs) bindings expose that crate to the plugin.

## Platform selection

| Platform | Engine | Index |
| --- | --- | --- |
| Desktop macOS arm64 | NAPI native module when it loads | Tantivy mmap index on disk |
| Every other platform | WASM | In-memory Tantivy index |

The plugin tries the native module only on desktop macOS arm64. If loading it throws, the plugin initializes WASM. Mobile and other desktop platforms use WASM directly. The plugin loads the WASM binary through Obsidian's vault adapter.

If the native module reports an unexpected NAPI version, Ferrisearch shows a restart notice. The initializer returns without creating a native index. The caller still marks the engine native, so it does not fall back to WASM. Restart Obsidian before searching.

The manual release archive contains the WASM engine and a macOS arm64 native module. The release workflow is described in [releases](releases.md).
