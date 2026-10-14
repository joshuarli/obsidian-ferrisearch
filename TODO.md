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

