# Query Benchmarks

3442 documents, 1000 iterations per query

| Benchmark | Query | Median | p95 | p99 | vs last |
|-----------|-------|--------|-----|-----|--------|
| single_term | `repository` | 983 us | 1.04 ms | 1.15 ms | -9% |
| multi_term | `pull request` | 1.62 ms | 1.75 ms | 1.88 ms | -10% |
| phrase | `"pull request"` | 331 us | 351 us | 401 us | -5% |
| phrase+term | `"pull request" merge` | 1.04 ms | 1.12 ms | 1.28 ms | -10% |
| fuzzy | `repositry` | 2.15 ms | 2.33 ms | 2.48 ms | -9% |
| short | `git` | 342 us | 383 us | 416 us | -14% |
| rare | `graphql` | 704 us | 756 us | 842 us | -12% |
| no_results | `xyzzyplugh` | 487 us | 505 us | 530 us | -12% |
