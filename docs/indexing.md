# Indexing and stored data

Ferrisearch indexes vault files whose paths end in `.md`. It records each indexed path and modification time in `index-manifest.json`. On startup, it compares that manifest with the vault and adds, updates, or removes changed documents.

File creation and deletion update the index immediately. File modifications are queued until the active workspace leaf changes. Opening a Ferrisearch modal flushes this queue before its first search. The plugin API's `refreshIndex()` method processes queued modifications.

File renames remove the old path from the index immediately. The new path is indexed only if it ends in `.md`.
If a file's path changes during a document read, that read is discarded.
Before adding a batch, Ferrisearch discards documents whose paths no longer resolve to the same file that was read.

The modification queue accepts only paths ending in `.md`. Refresh discards queued notes whose paths no longer end in `.md`.

Each refresh handles the notes queued when that refresh starts. Modifications queued during document reads remain pending for the next refresh, including further modifications to the same note. If refresh throws, notes whose paths still end in `.md` return to the queue alongside later modifications.

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

WASM rebuilds the in-memory index with a single-segment writer and no threads. It restores the index from the serialized blob, then uses the manifest to find vault changes. WASM users on desktop and mobile use the same blob cache. The WASM manifest carries a generation id and the expected blob size; a mismatch discards the cache and rebuilds. The blob is written before the manifest so an interrupted save leaves both files at their last good state.
