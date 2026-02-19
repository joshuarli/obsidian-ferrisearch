# Query Benchmarks

3442 documents, 1000 iterations per query

| Benchmark | Query | Median | p95 | p99 | vs last |
|-----------|-------|--------|-----|-----|--------|
| single_term | `repository` | 911 us | 918 us | 933 us | -7% |
| multi_term | `pull request` | 1.47 ms | 1.47 ms | 1.49 ms | -10% |
| phrase | `"pull request"` | 301 us | 304 us | 319 us | -9% |
| phrase+term | `"pull request" merge` | 941 us | 987 us | 1.01 ms | -10% |
| fuzzy | `repositry` | 1.95 ms | 2.06 ms | 2.29 ms | -9% |
| short | `git` | 346 us | 377 us | 446 us | +1% |
| rare | `graphql` | 636 us | 693 us | 765 us | -10% |
| no_results | `xyzzyplugh` | 426 us | 452 us | 486 us | -13% |
