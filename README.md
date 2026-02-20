# ferrisearch

warp speed fuzzy text-only search for Obsidian

for larger vaults, Omnisearch's startup latency became a problem for me,
and has started feeling sluggish

ferrisearch is based on [Omnisearch](https://github.com/scambier/obsidian-omnisearch) but has since diverged infrastructurally a lot:
- minisearch has been replaced with [tantivy](https://github.com/quickwit-oss/tantivy) + wasm to bridge ts <-> rust on all platforms
- search is restricted to pure text, and some Omnisearch features have been removed
- search is now so fast (~1ms) that input debouncing has been completely removed
- dependencies have been cut down to the minimum
  - svelte has been replaced with pure ts
  - as much as possible hot path ts has been moved into rust land


## native build

native build is only supported on darwin arm64 in github releases, everyone else gets wasm (otherwise the build footprint in github actions is unsustainably complicated)
