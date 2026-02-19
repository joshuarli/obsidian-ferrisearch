# Query Benchmarks

3442 documents, 1000 iterations per query

| Benchmark | Query | Median | p95 | p99 | vs last |
|-----------|-------|--------|-----|-----|--------|
| single_term | `repository` | 3.28 ms | 3.56 ms | 3.67 ms | +4% |
| multi_term | `pull request` | 6.03 ms | 6.47 ms | 6.65 ms | +3% |
| phrase | `"pull request"` | 350 us | 379 us | 461 us | +1% |
| phrase+term | `"pull request" merge` | 3.25 ms | 3.54 ms | 3.75 ms | +2% |
| fuzzy | `repositry` | 4.51 ms | 4.86 ms | 5.05 ms | +2% |
| short | `git` | 2.42 ms | 2.60 ms | 2.76 ms | +1% |
| rare | `graphql` | 2.89 ms | 3.14 ms | 3.30 ms | +1% |
| no_results | `xyzzyplugh` | 2.69 ms | 2.88 ms | 3.01 ms | +2% |
