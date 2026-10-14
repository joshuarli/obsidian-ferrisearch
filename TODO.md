Prefix: FERR
Next: 11

### FERR-5 · P2 · Remove renamed notes when they leave the Markdown index

- **Area:** Data
- **Where:** `src/main.ts:157-163`; `src/notes-indexer.ts:27-29`
- **Problem:** The rename handler removes the old path only when the new path ends in `.md`. Renaming an indexed Markdown note to another extension leaves its old document in the index, so searches can return a path that no longer exists.
- **Recommendation:** Remove the old indexed path for every rename, then add the new path only when it is indexable.
- **Fix with:** none
- **Effort:** S

### FERR-6 · P2 · Parse query terms with the index tokenizer

- **Area:** Search fields
- **Where:** `crates/ferrisearch-core/src/search.rs:20-74,212-213`; `crates/ferrisearch-core/src/tokenizer.rs:13,28-40`
- **Problem:** The index tokenizer splits punctuation and symbols, but the query parser splits terms only on whitespace and passes each term directly to Tantivy. Queries such as `C++` or `foo-bar` therefore do not use the same tokens as indexed notes and can miss expected matches.
- **Recommendation:** Normalize unquoted query terms with the same tokenizer used during indexing while preserving quoted-phrase behavior.
- **Fix with:** reference-parity
- **Effort:** M

### FERR-7 · P2 · Bound persisted result limits before collection

- **Area:** Config
- **Where:** `src/settings/index.ts:90-94`; `src/search/search-engine.ts:322-339`; `crates/ferrisearch-core/src/search.rs:125-145`
- **Problem:** Settings load persisted `resultLimit` without validation. The Rust binding converts the numeric limit to `usize` and passes it to Tantivy; limit zero asserts, while a very large limit sizes a large top-results buffer. The settings UI's lower-bound check does not protect persisted values or impose an upper bound.
- **Recommendation:** Choose a documented maximum and validate persisted settings and core search options as a nonzero bounded limit.
- **Fix with:** make-invalid-states-unrepresentable
- **Effort:** M
- **Design:** [FERR-7 RFC](docs/rfc/FERR-7-result-limit.md)

### FERR-8 · P2 · Run checks before publishing prereleases

- **Area:** Build
- **Where:** `.github/workflows/build.yml:1-28`; `Makefile:16,35-38`; `package.json:10-20`
- **Problem:** The prerelease workflow runs `make package`, which builds the plugin through `pnpm run build:plugin`; that path skips `prebuild`, tests, and type checking. A broken release can therefore be published even though the repository defines checks for those failures.
- **Recommendation:** Run the focused lint, typecheck, and test commands before packaging and publishing.
- **Fix with:** none
- **Effort:** S

### FERR-9 · P3 · Declare the global plugin API in TypeScript

- **Area:** Types
- **Where:** `src/main.ts:64,172`
- **Problem:** Two `@ts-expect-error` directives suppress missing `globalThis.ferrisearch` type errors when the plugin registers and removes its global API. Removing the directives makes the current typecheck fail, so the runtime API lacks an enforceable TypeScript contract.
- **Recommendation:** Declare the global API shape and remove both suppressions.
- **Fix with:** api-surface-and-module-boundaries
- **Effort:** S

### FERR-10 · P3 · Avoid sentinel collisions in diacritic removal

- **Area:** Search fields
- **Where:** `src/tools/utils.ts:42-52`
- **Problem:** `removeDiacritics()` replaces backticks and carets with NUL-prefixed sentinels, then restores every matching sentinel. A note containing the literal sequence `NUL+B` or `NUL+C` is changed into a backtick or caret when diacritics are ignored.
- **Recommendation:** Remove diacritics without reserving input strings as sentinels.
- **Fix with:** comment-cleanup
- **Effort:** S
