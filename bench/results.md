# Query Benchmarks

3442 documents, 1000 iterations per query

| Benchmark | Query | Median | p95 | p99 | vs last |
|-----------|-------|--------|-----|-----|--------|
| single_term | `repository` | 1.08 ms | 1.16 ms | 1.29 ms | -67% |
| multi_term | `pull request` | 1.80 ms | 1.99 ms | 2.20 ms | -70% |
| phrase | `"pull request"` | 348 us | 383 us | 445 us | ~ |
| phrase+term | `"pull request" merge` | 1.16 ms | 1.29 ms | 1.41 ms | -64% |
| fuzzy | `repositry` | 2.36 ms | 2.56 ms | 2.76 ms | -48% |
| short | `git` | 396 us | 469 us | 554 us | -84% |
| rare | `graphql` | 801 us | 870 us | 1.05 ms | -72% |
| no_results | `xyzzyplugh` | 553 us | 595 us | 651 us | -79% |
