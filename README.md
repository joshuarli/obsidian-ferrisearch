# ferrisearch

warp speed fuzzy text-only search for Obsidian.md

i made this because for my vault, omnisearch takes forever to start up
and this problem is not mitigated by lazy-plugin-loader

comparison with omnisearch:
- minisearch has been replaced with tantivy (rust)
- search restricted to pure text, and features have been slimmed down
- builds are very fast
  - dependencies have been cut down to the minimum
    - svelte has been replaced with pure TS for simplicity
    - bun replaces esbuild
- cut down on query granularity for maximum performance
- cut down on unnecessary/useless queries
  - the first 2 search characters do not issue a query by default
- search is so fast (<1ms) that
  - input debouncing (300ms) has been completely removed
  - as much typescript as possible has been moved into rust land
