Prefix: FERR
Next: 11

### FERR-7 · P2 · Bound persisted result limits before collection

- **Area:** Config
- **Where:** `src/settings/index.ts:90-94`; `src/search/search-engine.ts:322-339`; `crates/ferrisearch-core/src/search.rs:125-145`
- **Problem:** Settings load persisted `resultLimit` without validation. The Rust binding converts the numeric limit to `usize` and passes it to Tantivy; limit zero asserts, while a very large limit sizes a large top-results buffer. The settings UI's lower-bound check does not protect persisted values or impose an upper bound.
- **Recommendation:** Choose a documented maximum and validate persisted settings and core search options as a nonzero bounded limit.
- **Fix with:** make-invalid-states-unrepresentable
- **Effort:** M
- **Design:** [FERR-7 RFC](docs/rfc/FERR-7-result-limit.md)

### FERR-10 · P3 · Avoid sentinel collisions in diacritic removal

- **Area:** Search fields
- **Where:** `src/tools/utils.ts:42-52`
- **Problem:** `removeDiacritics()` replaces backticks and carets with NUL-prefixed sentinels, then restores every matching sentinel. A note containing the literal sequence `NUL+B` or `NUL+C` is changed into a backtick or caret when diacritics are ignored.
- **Recommendation:** Remove diacritics without reserving input strings as sentinels.
- **Fix with:** comment-cleanup
- **Effort:** S
