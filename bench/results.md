# Query Benchmarks

3442 documents, 1000 iterations per query

| Benchmark | Query | Median | p95 | p99 | vs last |
|-----------|-------|--------|-----|-----|--------|
| single_term | `repository` | 252 us | 281 us | 364 us | +300% |
| multi_term | `pull request` | 446 us | 481 us | 543 us | +390% |
| phrase | `"pull request"` | 348 us | 383 us | 421 us | +203% |
| phrase+term | `"pull request" merge` | 535 us | 583 us | 649 us | +296% |
| fuzzy | `repositry` | 510 us | 576 us | 687 us | +45% |
| short | `git` | 231 us | 251 us | 286 us | +169% |
| rare | `graphql` | 208 us | 227 us | 271 us | +447% |
| no_results | `xyzzyplugh` | 119 us | 140 us | 152 us | +89% |
