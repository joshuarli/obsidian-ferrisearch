# Benchmarks

## Corpus

The benchmark uses GitHub's documentation (~3,400 markdown files) as a realistic stand-in for a large Obsidian vault.

### Setup

Decompress the corpus (requires zstd):

```bash
zstd -d --long=31 bench/gh-docs.tar.zst --stdout | tar -x -C bench/corpus
```

### Run

```bash
cargo bench --bench query
```

Results are written to `target/criterion/` with HTML reports.

### Source

from https://github.com/github/docs/tree/main/content

```
tar -cf - content \
| zstd -22 --ultra -T0 --long=31 \
-o gh-docs.tar.zst
```
