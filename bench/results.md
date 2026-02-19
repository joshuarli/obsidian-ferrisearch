# Query Benchmarks

3442 documents, 1000 iterations per query

| Benchmark | Query | Median | p95 | p99 | vs last |
|-----------|-------|--------|-----|-----|--------|
| single_term | `repository` | 63 us | 68 us | 79 us | -56% |
| multi_term | `pull request` | 91 us | 99 us | 111 us | -44% |
| phrase | `"pull request"` | 115 us | 131 us | 150 us | -39% |
| phrase+term | `"pull request" merge` | 135 us | 146 us | 167 us | -45% |
| fuzzy | `repositry` | 351 us | 404 us | 446 us | -22% |
| short | `git` | 86 us | 91 us | 102 us | -60% |
| rare | `graphql` | 38 us | 41 us | 42 us | -67% |
| no_results | `xyzzyplugh` | 63 us | 67 us | 79 us | -2% |
