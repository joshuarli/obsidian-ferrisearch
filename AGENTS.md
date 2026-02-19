Ferrisearch is an Obsidian plugin that provides fast full-text search using a Rust/Tantivy backend via NAPI-RS bindings. It replaces Obsidian's built-in search with two modal UIs: vault-wide search and in-file search.

## Architecture

```
TypeScript (Obsidian plugin)  <-->  NAPI-RS  <-->  Rust/Tantivy (search engine)
```

The plugin loads a platform-specific `.node` binary (`ferrisearch.{platform}-{arch}.node`) at runtime from the plugin directory via `require()`. The native module exposes `SearchIndex` with methods for adding/removing documents, committing, warming up, and searching.

**NAPI version check:** Native `.node` binaries are cached in memory by `dlopen()` — rebuilding the binary on disk does NOT update the in-memory copy until Obsidian restarts. To detect stale binaries, the native module exports `napiVersion()` (Rust: `NAPI_VERSION` in `napi/src/lib.rs`) and the TS layer checks it against `EXPECTED_NAPI_VERSION` in `search-engine.ts`. **Bump both constants whenever the NAPI interface changes** (new methods, renamed/added fields, changed signatures). On mismatch, the plugin shows a "please restart Obsidian" notice and skips initialization.

## Directory Structure

```
src/
  main.ts                  # Plugin entry point (FerrisearchPlugin extends Plugin)
  globals.ts               # Shared types, enums, Observable, eventBus singleton
  database.ts              # JSON file storage for embeds cache
  notes-indexer.ts         # Deferred reindexing (flags notes, reindexes on modal open)
  components/
    modals.ts              # Modal classes (FerrisearchVaultModal, FerrisearchInFileModal)
    vault-modal.ts         # Vault search UI (history display, lazy-loaded results, min query length gate)
    infile-modal.ts        # In-file search UI (grouped match offsets, min query length gate)
    result-items.ts        # DOM creation for search result items
  search/
    search-engine.ts       # Wraps native Tantivy index, handles indexing + querying
    query.ts               # Query parser (uses search-query-parser lib)
    search-history.ts      # Flat file storage (~/.obsidian/plugins/ferrisearch/search-history.txt)
  repositories/
    documents-repository.ts  # In-memory cache of IndexedDocument objects
    embeds-repository.ts     # Tracks embed relationships between notes
  tools/
    api.ts                 # Public API (globalThis.ferrisearch) + URL scheme handler
    event-bus.ts           # Pub/sub with context-based enable/disable
    notes.ts               # openNote() helper
    text-processing.ts     # Highlight, excerpt, regex match extraction
    utils.ts               # Shared utilities (diacritics, paths, tags, metadata)
  settings/
    index.ts               # SettingsTab, defaults, showExcerpt observable
    utils.ts               # Types (FerrisearchSettings, WeightingSettings), save helper
    settings-behavior.ts   # Behavior settings UI (min query length, fuzziness, camelCase, etc.)
    settings-ui.ts         # UI settings UI
    settings-weighting.ts  # Field weight sliders + recency boost
    settings-danger.ts     # Danger zone (diacritics, disable, clear index)
  test-utils/
    setup.ts               # happy-dom registration, obsidian module mock, polyfills
    mock-plugin.ts         # createMockPlugin() factory for tests
    mock-result-note.ts    # Test data factory
napi/
  src/lib.rs               # NAPI-RS bindings (JS <-> Rust bridge), fully documented DocumentInput
  build.rs, Cargo.toml
crates/
  ferrisearch-core/src/
    lib.rs                 # Re-exports all modules
    types.rs               # Core types: DocumentInput, SearchResult, SearchOptions, FieldBoosts, IndexConfig
    schema.rs              # Tantivy schema (4 searched fields) + FieldHandles
    tokenizer.rs           # FerrisearchTokenizer (Unicode-category separator regex, camelCase split) + DiacriticFilter
    index.rs               # IndexManager: create/open index, add/remove/commit, stored IndexReader
    search.rs              # Search: two-phase (exact+prefix then fuzzy), phrase queries, PhrasePrefixQuery, recency boost
  ferrisearch-core/benches/
    query.rs               # Query latency benchmarks (writes bench/results.md with % change tracking)
bench/
  gh-docs.tar.zst          # GitHub docs corpus (~3,400 markdown files)
  corpus/                   # Extracted corpus (gitignored)
  results.md                # Latest benchmark results
  README.md                 # Corpus setup + run instructions
scripts/
  build-and-install.sh      # Build + install to multiple Obsidian vaults
```

## Rust Search Engine

### Tokenizer (`tokenizer.rs`)

`FerrisearchTokenizer` splits text on Unicode punctuation/symbols/separators/control chars (`\p{P}\p{Z}\p{Cc}\p{S}`). For each token, it emits:
1. The full lowercased token at position N
2. CamelCase sub-tokens (e.g. "fooBar" → "foo", "bar") also at position N

Sub-tokens sharing the parent position is critical for phrase queries: `"variable is"` matches `myVariable is` because "variable" (sub-token at pos 0) and "is" (pos 1) are consecutive.

`DiacriticFilter` strips combining marks via NFD decomposition (e.g. "café" → "cafe").

### Schema (`schema.rs`)

4 fields are searched: `display_title`, `directory`, `content`, `headings`. Others are indexed but not searched (basename, aliases, tags_text, unmarked_tags — disabled for performance). All text fields use `WithFreqsAndPositions` for phrase query support. Fieldnorms disabled on all short fields (only content has length normalization).

### Search (`search.rs`)

**Two-phase search** for each query:
- **Phase 1 (exact + prefix, no fuzzy):** For each term, builds per-field sub-queries OR'd together, then AND'd across terms:
  - **Exact:** `TermQuery` on all 4 searched fields (boosted by field weight)
  - **Prefix:** `PhrasePrefixQuery` on 3 fields (skips directory) — fast FST prefix scan (0.8x boost)
- **Phase 2 (add fuzzy):** Only triggers if Phase 1 returns fewer than `FUZZY_RESULT_THRESHOLD` (5) results and fuzziness > 0. Adds `FuzzyTermQuery` on **content only** (0.6x boost). Correctly-spelled queries never pay the fuzzy cost.

Quoted phrases (`"foo bar"`) use `PhraseQuery` — requires terms at consecutive positions in the same field.

Query parsing (`parse_query`) splits input into individual terms and quoted phrases. Single-word phrases are promoted to terms. Unclosed quotes fall back to individual terms.

### Index (`index.rs`)

`IndexManager` stores an `Index`, `IndexWriter`, and `IndexReader`. Uses explicit single-threaded writer — Obsidian vaults are small enough that multi-threaded indexing adds overhead without benefit. Heap size: 50MB for disk, 15MB for in-memory (tests).

On `commit()`, force-merges to a single segment (best-effort — background merge policy may already have consolidated). Single-segment means a single FST traversal per query. `warm_up()` pre-loads FST pages into the OS page cache by touching each field's `inverted_index().terms().num_terms()`. Called after initial indexing and when the search modal opens.

## Key Patterns

- **No framework for UI.** Modals use plain DOM (`document.createElement`). Each modal is a `renderXxxModal()` function that builds DOM, wires events, and returns `{ destroy() }`.
- **EventBus** dispatches keyboard actions (Enter, Tab, Arrow keys) from modal key handlers to the active modal's logic. Contexts (`'vault'`, `'infile'`) are enabled/disabled to route events to the correct modal.
- **Observable** is a minimal reactive primitive. `showExcerpt` is the only instance — it lets result items reactively show/hide excerpts. Cleanup uses a `WeakMap<HTMLElement, unsubscribe>`.
- **Lazy loading** via `IntersectionObserver` in vault results. Wrappers get a placeholder height; actual result DOM is created when scrolled into view.
- **Deferred reindexing.** File modifications are flagged in `NotesIndexer`; actual reindex happens when the search modal opens (`refreshIndex()`), or on window blur.
- **Differential indexing.** A sidecar manifest (`index-manifest.json`) tracks `{path, mtime}` for each indexed document. On startup, only changed/new/removed files are reprocessed.
- **Only `.md` files are indexed** (`isFileIndexable` checks `path.endsWith('.md')`).
- **Minimum query length.** Both modals skip search and show a message when the query is shorter than `minQueryLength` (default: 3). Configurable in settings.

## Build & Test

| Command | Purpose |
|---------|---------|
| `bun run build` | Production build → `dist/main.js` (CJS, minified, tree-shaken) |
| `bun run dev` | Watch mode build |
| `bun test` | Run tests (68 tests across 5 files) |
| `bun run lint` | Biome check (lint + format, read-only) |
| `bun run format` | Biome auto-fix |
| `bun run build:rust` | Build native module via napi-rs |
| `bun run build:all` | Rust + JS build |
| `cargo test` | Run Rust tests (81 tests) |
| `cargo clippy --all-targets --all-features -- -D warnings` | Rust linter |
| `cargo bench --bench query` | Query latency benchmarks → `bench/results.md` |
| `scripts/build-and-install.sh` | Build + install to Obsidian vaults |

- **Build tool:** Bun's bundler (`build.ts`). Output is CJS targeting browser. Obsidian and CodeMirror packages are externalized. Native `.node` files are also externalized.
- **Test runner:** `bun:test` with `happy-dom` for DOM APIs. The `obsidian` module is mocked in `setup.ts`. `IntersectionObserver` is mocked to fire immediately.
- **Linter/Formatter:** Biome (TS/JS), cargo clippy + cargo fmt (Rust), shfmt + shellcheck (shell). All run via pre-commit hooks.

## Dependencies

- **Runtime:** `search-query-parser` (query parsing with keywords like `ext:`, `path:`, quoted phrases, exclusions)
- **Dev:** `@biomejs/biome`, `happy-dom`, `@types/bun`, `obsidian`, `typescript`
- **Native:** Rust crate `ferrisearch-core` using Tantivy 0.25 for full-text search, exposed via `napi-rs`. Custom tokenizer splits on Unicode punctuation/symbols/separators/control chars, emits camelCase sub-tokens at shared positions, and optionally strips diacritics via NFD decomposition.

## Data Flow

1. **Startup:** `populateIndex()` loads sidecar manifest, diffs against vault files, adds/removes changed documents in the native Tantivy index, saves updated sidecar + embeds cache.
2. **File events:** Create/delete trigger immediate index updates. Modify flags for deferred reindex. Rename does remove + add.
3. **Search:** User types in modal → min query length check → debounced (300ms) → `Query` parser → `searchEngine.search()` calls native Tantivy → post-filters (extension, path, exact terms, exclusions, downranked folders, tag boost) → `getSuggestions()` fetches full documents, injects embeds, extracts match offsets → rendered as lazy-loaded DOM.
4. **History:** When a vault search result is opened, the query is saved to `search-history.txt`. When the modal opens with an empty query, the last 10 history entries are displayed.

## Settings

Settings are persisted via Obsidian's `plugin.saveData()`. Key settings:
- **Behavior:** `hideExcluded`, `downrankedFoldersFilters`, `splitCamelCase`, `fuzziness` (0/1/2), `ignoreDiacritics`, `minQueryLength` (default: 3), `resultLimit` (default: 10)
- **UI:** `showExcerpt`, `maxEmbeds`, `renderLineReturnInExcerpts`, `highlight`
- **Weighting:** `weightBasename`, `weightDirectory`, `weightHeadings`, `weightUnmarkedTags`
- **Other:** `recencyBoost` (disabled/day/week/month), `verboseLogging`
