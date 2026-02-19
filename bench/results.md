# Query Benchmarks

3442 documents, 1000 iterations per query

| Benchmark | Query | Median | p95 | p99 | vs last |
|-----------|-------|--------|-----|-----|--------|
| single_term | `repository` | 688 us | 697 us | 718 us | -24% |
| multi_term | `pull request` | 1.12 ms | 1.16 ms | 1.17 ms | -24% |
| phrase | `"pull request"` | 236 us | 246 us | 277 us | -22% |
| phrase+term | `"pull request" merge` | 757 us | 769 us | 779 us | -20% |
| fuzzy | `repositry` | 1.57 ms | 1.61 ms | 1.62 ms | -19% |
| short | `git` | 305 us | 310 us | 321 us | -12% |
| rare | `graphql` | 493 us | 499 us | 509 us | -22% |
| no_results | `xyzzyplugh` | 310 us | 314 us | 324 us | -27% |
