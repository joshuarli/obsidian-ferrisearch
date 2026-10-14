# Indexing and stored data

Ferrisearch indexes vault files whose paths end in `.md`. It records each indexed path and modification time in `index-manifest.json`. On startup, it compares that manifest with the vault and adds, updates, or removes changed documents.

File creation and deletion update the index immediately. File modifications are queued until the active workspace leaf changes. Opening a Ferrisearch modal does not flush this queue. The plugin API exposes `refreshIndex()`, but its method reference is unbound. Awaiting it through the API rejects with a `TypeError`.

Each refresh handles the notes queued when that refresh starts. Modifications queued during document reads remain pending for the next refresh, including further modifications to the same note. If the refresh throws, its notes return to the queue alongside later modifications.

The event handling and file diff are implemented in [`main.ts`](../src/main.ts), [`notes-indexer.ts`](../src/notes-indexer.ts), and [`search-engine.ts`](../src/search/search-engine.ts). Tantivy index operations are in [`index.rs`](../crates/ferrisearch-core/src/index.rs).

## Stored data

Ferrisearch keeps plugin data under `<vault>/<configDir>/plugins/ferrisearch/`.

| File or directory | Engine | Purpose |
| --- | --- | --- |
| `tantivy-index` | Native | Tantivy index files |
| `index-manifest.json` | Both | Indexed paths and modification times |
| `index-blob.bin` | WASM | Serialized in-memory index |
| `search-history.txt` | Both | Up to ten recent vault queries |

The native index uses Tantivy's filesystem-backed index. Its writer uses four workers with a 120 MB heap budget. The plugin batches startup changes and commits without merging segments. Other native commits merge multiple segments.

WASM rebuilds the in-memory index with a single-segment writer and no threads. It restores the index from the serialized blob, then uses the manifest to find vault changes. WASM users on desktop and mobile use the same blob cache.
