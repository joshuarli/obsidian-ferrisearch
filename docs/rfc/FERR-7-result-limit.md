# FERR-7: Bound persisted result limits

Status: draft

## Summary

Search result limits reach Tantivy without persisted-value validation or an upper bound. Zero can assert, and very large values can allocate an excessive top-results buffer.

## Motivation

The settings UI rejects values below one but does not set a maximum. `loadSettings()` merges saved settings directly into defaults, and Rust casts the numeric limit to `usize` before collecting results.

## Design

Represent the core limit as a validated nonzero value with an explicit maximum. Validate saved plugin settings before they reach the search engine, and return a typed error for invalid direct binding input. Keep the default limit at ten.

## Alternatives considered

- Validate only zero and negative values. This leaves large allocations possible.
- Rely on the settings UI. Saved settings and direct binding inputs bypass the UI.
- Collect all matching results and apply limits after filtering. This addresses result truncation but does not bound the collector's work or memory.

## Open questions

- What maximum result count should the settings UI and bindings accept? Recommendation: 1,000, which keeps ordinary settings flexible while bounding the collector buffer.
- Should an invalid saved setting reset to the default with a visible notice, or fail loading settings? Recommendation: reset that setting to ten and report the invalid value once.

## Decision

Pending owner review.
