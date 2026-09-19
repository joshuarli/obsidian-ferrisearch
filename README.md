# ferrisearch

warp speed fuzzy text-only search for Obsidian

For my vault (~1500 md files, ~100k lines), [Omnisearch's](https://github.com/scambier/obsidian-omnisearch) startup latency became a problem for me - I'd like to be able to open Obsidian and immediately search. This is especially important on mobile.

The solution to this was to replace minisearch with [tantivy](https://github.com/quickwit-oss/tantivy) and tune it towards minimizing subqueries.
Search is now so fast (~4ms for my vault) that input debouncing has been completely removed and results are pretty much instant.

Extraneous features and customizability have been removed for simplicity. The majority use case should be supported very well.

- Search is restricted to pure text.

Also, non-build/app dependencies have been cut down to the minimum.

- Svelte has been replaced with pure TS.
- The remaining TS hotpaths (mainly, results highlighting) have been moved into rust.

## Local build

On macOS arm64, `make install` builds the native and WASM engines, bundles the
plugin, and installs it into the configured Obsidian vault. The default targets
`/Users/josh/iCloud~md~obsidian/Documents/Notes`; override the destination with
`make install VAULT_PLUGIN=/path/to/.obsidian/plugins/ferrisearch`.

Use `PROFILE=release` for a production-oriented Rust build; the default
`dev-fast` profile is quicker for local iteration.

## new features

fuzziness -> fuzzy results only

This omits exact matches, which is useful for when you want to surface typos with correctly spelled search term.

Obsidian's maximum fuzziness doesn't match simple typos when the search term is correctly spelled.

## native build

The native build is only supported on darwin arm64 in github releases, everyone else gets WASM (otherwise the build footprint in github actions is unsustainably complicated).
