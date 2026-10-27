# Architecture

Ferrisearch uses a TypeScript Obsidian plugin and a Rust search engine. The TypeScript layer reads vault files and prepares queries. [`ferrisearch-core`](../crates/ferrisearch-core/src/lib.rs) owns the Tantivy schema, tokenizer, and search logic. The [NAPI-RS](../napi/src/lib.rs) and [WASM](../wasm/src/lib.rs) bindings expose that crate to the plugin.

## Platform selection

| Platform | Engine | Index |
| --- | --- | --- |
| Desktop macOS arm64 | NAPI native module when it loads | Tantivy mmap index on disk |
| Every other platform | WASM | In-memory Tantivy index |

The plugin tries the native module only on desktop macOS arm64. If loading it throws, the plugin initializes WASM. Mobile and other desktop platforms use WASM directly. The production bundle embeds the WASM binary; development builds load it from the plugin folder through Obsidian's vault adapter as a fallback.

If the native module reports an unexpected NAPI version, Ferrisearch shows a restart notice and throws, so initialization falls back to WASM instead of running with no index. Restart Obsidian before searching.

The manual release archive contains the WASM engine and a macOS arm64 native module. The release workflow is described in [releases](releases.md).
