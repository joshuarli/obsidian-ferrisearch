# Performance

This document records the repeatable performance measurements for Ferrisearch.
The goal is to keep search and startup-indexing changes comparable across dependency
and implementation updates.

## Benchmark method

Run the native harness on macOS arm64 with a release NAPI binary:

```sh
make build-native PROFILE=release
pnpm run test-search \
  "/Users/josh/iCloud~md~obsidian/Documents/Notes" \
  "search" 0
```

The benchmark uses a fresh temporary Tantivy index for every invocation and indexes
the markdown corpus from scratch. It reports file discovery, file reads, indexing,
and total startup time. Search latency uses five discarded warmups followed by 100
timed searches and reports p50, mean, standard deviation, and mean + 3σ.

The current harness follows the production native startup sequence: it calls
`addDocumentsBulk()` and then `commitNoMerge()`. The N-API add and commit portions
are timed separately so an indexing regression can be attributed to document
marshalling or Tantivy commit work.

The harness passes `scoreBreakdown: true`, so its search timings include the optional
per-field Tantivy explain work. The normal plugin setting is off by default. Search
and indexing measurements should be compared using the same query, fuzziness, corpus,
Rust profile, and score-breakdown setting.

The original baseline corpus contained 2,518 markdown files as discovered by `fd`.
The later thread-scaling sweep contained 2,519 files after one note was added.
The reference machine is a MacBookAir10,1 with Apple arm64 and 8 CPUs. Measurements
are not isolated from normal machine load, so small changes should be treated as
directional unless repeated across several runs.

## Baseline: dependency-upgraded native engine

Recorded 2026-09-19 after the dependency upgrade to Tantivy 0.26.2 and the current
Rust/TypeScript dependency locks. These measurements use the legacy harness path:
`addDocuments()` followed by force-merging `commit()`. The production startup path
uses bulk insertion and `commitNoMerge()`; a production-aligned baseline is recorded
separately below.

| Query | Fuzziness | Index | Total | Search p50 | Search mean |
| --- | ---: | ---: | ---: | ---: | ---: |
| `search` | 0 | 2,013.1 ms | 2,653.4 ms | 3.026 ms | 3.063 ms |
| `project plan` | 1 | 2,025.3 ms | 2,524.9 ms | 74.920 ms | 75.001 ms |
| `projet` | 2 | 2,034.8 ms | 2,534.2 ms | 49.388 ms | 49.442 ms |

For comparison, the same legacy method before the dependency upgrade measured search
p50/mean of 3.027/3.182 ms, 75.773/76.901 ms, and 49.919/50.987 ms respectively.

## Indexing target

The startup target is a full initial native index under 1 second for this corpus.
The benchmark must use the production sequence (`addDocumentsBulk()` plus
`commitNoMerge()`) before evaluating this target; force-merging is not part of the
normal startup path.

Before the writer change, the production-aligned sequence took 2,031.8 ms to index
and 2,538.5 ms end to end for `search`/fuzziness 0. The optimized configuration
uses up to six writer threads based on available parallelism, with a 30 MB budget
per worker, stores result-only fields without postings, and uses an allocation-light
tokenizer path. Two release-profile runs of the earlier three-worker configuration
measured:

- Indexing: **857.9–863.7 ms**; add/marshalling: **53.0–54.3 ms**; commit: **804.8–809.4 ms**
- End to end: **1,362.9–1,369.2 ms**
- Search p50/mean: **3.039–3.049 / 3.079–3.081 ms**

The preceding two-thread configuration measured 1,155–1,202 ms for indexing. A
release-profile thread sweep on the 2,519-file corpus, with three runs per point,
measured these median indexing times:

| Writer workers | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Median | 1,849 ms | 1,060 ms | 851 ms | 783 ms | 784 ms | **767 ms** | 801 ms | 859 ms |

The production default is now fixed at four workers. This is slightly slower than
the six-worker median on the reference machine, but avoids making startup latency
depend on host CPU topology; four workers still measured a 783 ms median and remains
under the one-second target.
