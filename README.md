# ferrisearch

faster and simpler omnisearch for obsidian

omnisearch takes forever to start up and this problem is not
mitigated by lazy-plugin-loader

key changes:
- minisearch has been replaced with tantivy (rust)
- search restricted to pure text
- builds are very fast
  - svelte has been replaced with pure TS for simplicity
  - bun replaces esbuild
