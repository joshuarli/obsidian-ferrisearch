# ferrisearch

faster and simpler omnisearch for obsidian

omnisearch takes forever to start up and this problem is not
mitigated by lazy-plugin-loader

key changes:
- minisearch has been replaced with tantivy (rust)
- search restricted to pure text, and features have been slimmed down
- builds are very fast
  - dependencies have been cut down to the minimum
    - svelte has been replaced with pure TS for simplicity
    - bun replaces esbuild
- focus on reducing percieved latency
  - the first 2 search characters do not issue a query by default
