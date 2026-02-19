# Query Benchmarks

3442 documents, 1000 iterations per query

| Benchmark | Query | Median | p95 | p99 | vs last |
|-----------|-------|--------|-----|-----|--------|
| single_term | `repository` | 194 us | 229 us | 264 us | -57% |
| multi_term | `pull request` | 262 us | 312 us | 377 us | -63% |
| phrase | `"pull request"` | 248 us | 284 us | 319 us | +2% |
| phrase+term | `"pull request" merge` | 349 us | 397 us | 479 us | -37% |
| fuzzy | `repositry` | 1.03 ms | 1.12 ms | 1.26 ms | +7% |
| short | `git` | 294 us | 367 us | 441 us | ~ |
| rare | `graphql` | 158 us | 195 us | 218 us | -52% |
| no_results | `xyzzyplugh` | 214 us | 225 us | 250 us | +25% |
