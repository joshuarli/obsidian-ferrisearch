# Query Benchmarks

3442 documents, 1000 iterations per query

| Benchmark | Query | Median | p95 | p99 | vs last |
|-----------|-------|--------|-----|-----|--------|
| single_term | `repository` | 446 us | 478 us | 546 us | -35% |
| multi_term | `pull request` | 705 us | 755 us | 811 us | -37% |
| phrase | `"pull request"` | 242 us | 261 us | 294 us | +3% |
| phrase+term | `"pull request" merge` | 557 us | 597 us | 674 us | -26% |
| fuzzy | `repositry` | 966 us | 1.02 ms | 1.07 ms | -38% |
| short | `git` | 292 us | 315 us | 357 us | -4% |
| rare | `graphql` | 328 us | 357 us | 402 us | -33% |
| no_results | `xyzzyplugh` | 171 us | 198 us | 233 us | -45% |
