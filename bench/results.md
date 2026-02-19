# Query Benchmarks

3442 documents, 1000 iterations per query

| Benchmark | Query | Median | p95 | p99 | vs last |
|-----------|-------|--------|-----|-----|--------|
| single_term | `repository` | 142 us | 190 us | 202 us | -27% |
| multi_term | `pull request` | 163 us | 178 us | 202 us | -38% |
| phrase | `"pull request"` | 189 us | 203 us | 220 us | -24% |
| phrase+term | `"pull request" merge` | 246 us | 269 us | 295 us | -30% |
| fuzzy | `repositry` | 451 us | 514 us | 546 us | -56% |
| short | `git` | 217 us | 241 us | 301 us | -26% |
| rare | `graphql` | 116 us | 128 us | 145 us | -27% |
| no_results | `xyzzyplugh` | 64 us | 68 us | 77 us | -70% |
