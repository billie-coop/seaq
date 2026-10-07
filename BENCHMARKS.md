# Seaq Benchmarks

All numbers in this document come from a single `yarn workspace seaq vitest bench` run. Nothing is estimated or rounded for narrative purposes.

> **Snapshot date:** 2026-10-06
> **Node.js:** v22.13.1 (Apple Silicon)
> **Vitest:** v4.0.16
> **Compared:** fuzzysort 4.0.2, Fuse.js 7, MiniSearch 7, uFuzzy 1.0, Lunr 2.3, seaq 1.1.5 (v1)

See [README.md](./packages/core/README.md) for API documentation.

---

## TL;DR

- **seaq v2** is 80% faster than v1 on 10K contacts in joined mode (`874 vs 486 ops/s`) and 19% faster in separate mode (`579 ops/s`). On 20K cities, v2 joined is 71-100% faster than v1 depending on query.
- **seaq indexes a list on its second search.** Repeated default searches of 10K contacts take 0.32 ms for `"nath fe"` with the index and 2.36 ms without it (7.3x). Strict searches (`fuzziness: 0`) reuse the index in 16 µs.
- **Cold start** (first search, nothing built): seaq is 4.1x faster than MiniSearch, 10x faster than Fuse.js and 27x faster than Lunr. fuzzysort (4.4x) and uFuzzy (3.1x) are faster than seaq. At its default threshold, fuzzysort returns 0 results for the benchmark query `"nath fe"`, so its time measures a fast rejection.
- **Repeated search on static data**: MiniSearch and Lunr answer word queries 160-1,700x faster than seaq's index. fuzzysort's `snapshot()` is 3.1x faster than seaq on `"na"` and 8.7x faster on simulated typing. seaq's index is 1.4-7.3x faster than scanning, depending on the query.
- **Nested data cold start**: seaq is 8.5-9x faster than MiniSearch and 11x faster than Fuse.js because it needs no data flattening or index build.
- **includeMatches** costs under 5%.
- **`limit: 10`** is 1.19x faster than returning every match and slicing the first 10.

---

## Test Environment

- **Datasets:**
  - 23 books from `@seaq/test-data/books.json` (classic Fuse.js test set)
  - 10,000 contacts from `@seaq/test-data/contacts-10k.json` (seeded PRNG, realistic names)
  - 20,000 cities from `@seaq/test-data/cities.json` (real-world cities)
  - 1K and 5K synthetic nested contacts (generated in `nested-arrays.bench.ts`)
- **seaq defaults:** `fuzziness: 0.2`, `fieldMode: 'joined'`, `limit: 10`, `threshold: 0.3`, and an index built on an array's second search.
- **Benchmark settings:**
  - The engine benchmarks in `seaq.bench.ts` (v1 vs v2, modes, includeMatches, limit) pass `cache: false`, so every iteration scans the list, and most use `fuzziness: 0` for consistent measurement. The multi-word tests use `fuzziness: 0.2` to measure fuzzy overhead.
  - `realworld.bench.ts` uses seaq's defaults. A benchmark loop searches the same array over and over, so the `seaq` rows there use the index. The `seaq (no index)` rows pass `cache: false`, and cold-start rows pass `cache: false` so they measure a first search.
- **fuzzysort** runs with its defaults (`limit: 10`, `threshold: 0.5`). It has no typo tolerance and its threshold is stricter than seaq's, so it can return fewer results for the same query. The tables below give its result count where it returns nothing.

---

## v1 vs v2: 10K Contacts

Query: `"nath fe"`, keys: `['givenName', 'familyName']`, fuzziness: 0, no index.

| Variant | ops/s | mean (ms) | vs v1 |
|---------|------:|----------:|------:|
| v1 (published 1.1.5) | 486 | 2.06 | -- |
| v2 (joined) | 874 | 1.14 | +80% |
| v2 (separate) | 579 | 1.73 | +19% |

Both v2 modes are faster than v1, and joined mode (the default) is the fastest. v2 also matches more: shorthand, adjacent swaps and words in any order.

## v1 vs v2: 20K Cities

Keys: `['name', 'state']`, fuzziness: 0, no index.

| Query | v1 (ops/s) | v2 joined (ops/s) | v2 separate (ops/s) | v2 joined vs v1 |
|-------|----------:|-----------------:|-------------------:|----------------:|
| `"san"` | 194 | 331 | 273 | +71% |
| `"new york"` | 207 | 405 | 285 | +96% |
| `"los ang"` | 199 | 399 | 279 | +100% |

Across all three queries, v2 joined is the fastest mode and v2 separate sits in between.

---

## Single Search Performance by Library

These benchmarks include index build time. seaq runs with `cache: false`, and uFuzzy has no index. fuzzysort's prepared-target cache is cleared each iteration. Fuse.js, MiniSearch and Lunr build their index inside each iteration.

### 23 Books

Query: `"hi"`.

| Library | ops/s | mean (ms) |
|---------|------:|----------:|
| seaq (joined) | 195,020 | 0.005 |
| uFuzzy | 168,181 | 0.006 |
| seaq (separate) | 158,496 | 0.006 |
| fuzzysort | 89,663 | 0.011 |
| MiniSearch | 38,992 | 0.026 |
| Fuse.js | 35,105 | 0.028 |
| Lunr | 5,329 | 0.188 |

On a tiny dataset, seaq's default joined mode is fastest. fuzzysort returns 0 results for `"hi"` at its default threshold (seaq returns 9). Index-based libraries pay their build cost on every call, which makes them 5x slower.

### 10K Contacts

Query: `"nath fe"`.

| Library | ops/s | mean (ms) |
|---------|------:|----------:|
| uFuzzy | 4,657 | 0.21 |
| fuzzysort | 1,721 | 0.58 |
| seaq (joined) | 804 | 1.24 |
| seaq (separate) | 551 | 1.82 |
| MiniSearch | 96 | 10.42 |
| Fuse.js | 36 | 27.45 |
| Lunr | 33 | 29.92 |

seaq is 8.4x faster than MiniSearch and 22x faster than Fuse.js in cold-start scenarios. uFuzzy is 5.8x faster than seaq but requires pre-flattened string arrays. fuzzysort is 2.1x faster but returns 0 results for this query at its default threshold. Its best match scores 0.38, below the 0.5 cutoff.

### No-Keys Mode (10K items)

When searching without specifying keys, seaq auto-detects searchable fields.

| Mode | ops/s | mean (ms) |
|------|------:|----------:|
| String array (10K pre-joined strings) | 1,175 | 0.85 |
| Object array (10K contacts, all fields) | 96 | 10.36 |

Searching a plain string array is 12x faster than auto-scanning all object fields, because each object is matched against its whole JSON representation.

---

## 10 Consecutive Searches

Each iteration builds the index (or not) then searches 10 times. fuzzysort starts each iteration with a cleared cache, then reuses the targets it prepared on the first search. seaq runs with `cache: false` here, so it scans 10 times. With the default, the second search would build the index (see [Repeated Search on Static Data](#repeated-search-on-static-data-10k-contacts)).

### 23 Books

| Library | ops/s |
|---------|------:|
| uFuzzy | 64,019 |
| fuzzysort | 32,863 |
| MiniSearch | 31,182 |
| seaq (joined) | 19,607 |
| Lunr | 4,846 |
| Fuse.js | 4,844 |

### 10K Contacts

| Library | ops/s |
|---------|------:|
| uFuzzy | 462 |
| fuzzysort | 192 |
| MiniSearch | 94 |
| seaq (joined) | 83 |
| Lunr | 32 |
| Fuse.js | 4.3 |

seaq is 19x faster than Fuse.js. MiniSearch amortizes its index build and edges ahead at this scale.

---

## Repeated Search on Static Data (10K Contacts)

Each library's index is built once, outside the benchmark loop. For fuzzysort, that is an immutable `fuzzysort.snapshot()`. seaq uses the index it builds on a list's second search. `seaq (no index)` passes `cache: false` and scans every call. uFuzzy has no index and scans every call. This measures pure search throughput.

| Query | seaq | seaq (no index) | Fuse.js | fuzzysort | uFuzzy | MiniSearch | Lunr |
|-------|-----:|----------------:|--------:|----------:|-------:|-----------:|-----:|
| `"na"` (short) | 1,961 | 552 | 112 | 6,158 | 1,349 | 1,166,681 | 1,108,624 |
| `"nath fe"` (medium) | 3,083 | 424 | 45 | 9,491,730\* | 4,724 | 748,726 | 495,604 |
| `"natasha okeefe"` (long) | 427 | 311 | 18 | 4,528,869\* | 5,763 | 712,262 | 439,447 |

All values are ops/s. \* fuzzysort returns 0 results for these queries at its default threshold. Its snapshot rejects the whole dataset in well under a microsecond, so these numbers don't measure a real search.

seaq's index makes these searches 1.4-7.3x faster than scanning. It records which characters each contact contains, so a search only scores contacts that can make the top 10. A long fuzzy query like `"natasha okeefe"` can't rule out much, so it gains the least. With `fuzziness: 0`, the index answers `"nath fe"` in 16 µs (62,717 ops/s).

MiniSearch and Lunr are still 160-1,700x faster than seaq here: an inverted index looks words up instead of scoring characters. fuzzysort is 3.1x faster on `"na"`. uFuzzy, which scans without an index, beats seaq's index on the longer queries. If your data is large and static and raw repeated-query speed matters most, use an indexed library.

### Simulated Typing (7 keystrokes: n -> na -> ... -> natasha)

| Library | ops/s |
|---------|------:|
| MiniSearch | 181,990 |
| Lunr | 128,723 |
| fuzzysort | 2,533 |
| uFuzzy | 456 |
| seaq | 292 |
| seaq (no index) | 68 |
| Fuse.js | 11.2 |

Each iteration runs 7 searches. seaq's index makes typing 4.3x faster than scanning, at 0.49 ms per keystroke. fuzzysort is 8.7x faster than seaq: its snapshot only re-checks the previous query's matches when the query grows by a keystroke. seaq does the same only with `fuzziness: 0`, because a typo-tolerant search can match items the previous query didn't.

---

## Cold Start: Build + Search (10K Contacts)

This is the realistic first-search scenario: user loads a page with 10K items and immediately types a query. Index-based libraries must build their index first. fuzzysort's prepared-target cache is cleared each iteration. seaq runs with default options and `cache: false`.

Query: `"nath fe"`, keys: `['givenName', 'familyName']`.

| Library | ops/s | mean (ms) | vs seaq |
|---------|------:|----------:|--------:|
| fuzzysort\* | 1,919 | 0.52 | 4.4x faster |
| uFuzzy | 1,340 | 0.75 | 3.1x faster |
| **seaq** | **432** | **2.32** | **--** |
| seaq (`cache: true`, fresh array) | 415 | 2.41 | 4% slower |
| MiniSearch | 105 | 9.53 | 4.1x slower |
| Fuse.js | 41 | 24.24 | 10x slower |
| Lunr | 16 | 63.21 | 27x slower |

\* 0 results at fuzzysort's default threshold. seaq returns 10 for this query.

The `cache: true` row builds seaq's index on a new array every iteration, then searches it. It costs about the same as a scan (4% more in this run), so indexing on the first search is nearly free when the list will be searched again.

---

## Performance by Mode (Joined vs Separate)

Query: `"nath fe"`, 10K contacts, fuzziness: 0, no index.

| Mode | ops/s | mean (ms) |
|------|------:|----------:|
| Joined | 804 | 1.24 |
| Separate | 551 | 1.82 |

On 23 books:

| Mode | ops/s |
|------|------:|
| Joined | 195,020 |
| Separate | 158,496 |

Joined mode (the default) is 1.5x faster on 10K contacts and 1.2x faster on books. Only joined mode uses the index; separate mode always scans. Choose between the modes for their matching semantics.

---

## includeMatches Overhead

10K contacts, `"nath fe"`, fuzziness: 0, no index.

### Joined Mode

| includeMatches | ops/s | mean (ms) |
|----------------|------:|----------:|
| false | 810 | 1.23 |
| true | 797 | 1.26 |

### Separate Mode

| includeMatches | ops/s | mean (ms) |
|----------------|------:|----------:|
| false | 510 | 1.96 |
| true | 494 | 2.02 |

**Under 5% in either mode** (2% joined, 3% separate in this run). Match positions are only computed for the final top results, so the cost doesn't grow with the list.

---

## Limit Optimization: Built-in `limit` vs `.slice()`

10K contacts, query `"na"`, joined mode, fuzziness: 0, no index.

| Approach | ops/s | mean (ms) |
|----------|------:|----------:|
| `limit: Infinity`, then `.slice(0, 10)` | 419 | 2.39 |
| `limit: 10` | 501 | 2.00 |

**The built-in `limit` is 1.19x faster.** It keeps the top 10 in an O(n log k) heap instead of sorting every match. Both apply the default `threshold`, so they return the same 10 results.

---

## Multi-Word Query Performance (Separate Mode)

10K contacts, separate mode, no index. Compares strict vs fuzzy and single-word vs multi-word.

| Query | Fuzziness | ops/s | mean (ms) |
|-------|----------:|------:|----------:|
| `"nath"` (1 word) | 0.2 | 251 | 3.99 |
| `"nath fe"` (2 words) | 0.2 | 190 | 5.28 |
| `"natasha okeefe"` (2 words, long) | 0.2 | 145 | 6.91 |
| `"nath fe"` (2 words) | 0 | 502 | 1.99 |

Key observations:
- **Fuzziness costs ~2.6x**: strict `"nath fe"` runs at 502 ops/s and fuzzy `"nath fe"` at 190 ops/s. A strict search can stop at the first missing character.
- **Multi-word costs ~1.3x** vs single-word at the same fuzziness (251 -> 190 ops/s).
- **Longer queries cost more**: `"natasha okeefe"` runs at 145 ops/s and `"nath fe"` at 190 ops/s, because longer strings need more character comparisons.

---

## Nested Object and Array Performance

seaq natively traverses nested properties (`company.name`) and arrays (`emails.address`). Other libraries require pre-flattening the data. In the search-only tables, seaq runs with defaults, so the benchmark loop uses its index.

### Nested Property Search: `company.name` (search-only, index pre-built)

| Library | 1K contacts (ops/s) | 5K contacts (ops/s) |
|---------|--------------------:|--------------------:|
| seaq (native nested) | 29,207 | 6,093 |
| MiniSearch (pre-flattened) | 25,886 | 5,313 |
| Fuse.js (native nested) | 330 | 64 |

seaq is 1.1x faster than MiniSearch on already-flattened, indexed data.

### Array Field Search: `emails.address` (search-only, index pre-built)

| Library | 1K contacts (ops/s) | 5K contacts (ops/s) |
|---------|--------------------:|--------------------:|
| seaq (native array traversal) | 8,649 | 1,795 |
| MiniSearch (pre-flattened) | 3,318 | 552 |
| Fuse.js (native array) | 289 | 53 |

seaq is faster than pre-indexed MiniSearch on array fields: 2.6x at 1K and 3.3x at 5K. Both are 10x+ faster than Fuse.js.

### Deep Nested: `addresses.city` (1K contacts, cold start for Fuse.js)

| Library | ops/s |
|---------|------:|
| seaq (native) | 17,158 |
| MiniSearch (pre-flattened) | 6,877 |
| Fuse.js (native) | 295 |

### Cold Start with Nested Data (includes flattening + index build)

seaq runs with `cache: false`.

| Library | 1K contacts (ops/s) | 5K contacts (ops/s) |
|---------|--------------------:|--------------------:|
| **seaq (no prep needed)** | **2,923** | **555** |
| MiniSearch (flatten + index) | 345 | 62 |
| Fuse.js (index build) | 259 | 50 |

**seaq is 8.5-9x faster than MiniSearch and 11x faster than Fuse.js** on cold start with nested data. There is no flattening step and no index build.

### Multi-Field Nested Search (1K contacts)

Searching across `name`, `company.name`, and `addresses.city` with query `"John Acme"`. seaq runs with `cache: false`; Fuse.js builds its index inside each iteration.

| Library | ops/s | mean (ms) |
|---------|------:|----------:|
| seaq | 2,340 | 0.43 |
| Fuse.js | 117 | 8.57 |

seaq is 20x faster than Fuse.js on multi-field nested search.

---

## Running Benchmarks

```bash
# All benchmarks (takes 2-3 minutes)
yarn workspace seaq vitest bench

# Individual benchmark files
yarn workspace seaq vitest bench test/perf/seaq.bench.ts
yarn workspace seaq vitest bench test/perf/realworld.bench.ts
yarn workspace seaq vitest bench test/perf/nested-arrays.bench.ts

# Individual library benchmarks
yarn workspace seaq vitest bench test/perf/fuse.bench.ts
yarn workspace seaq vitest bench test/perf/minisearch.bench.ts
yarn workspace seaq vitest bench test/perf/lunr.bench.ts
yarn workspace seaq vitest bench test/perf/ufuzzy.bench.ts
yarn workspace seaq vitest bench test/perf/fuzzysort.bench.ts
```

---

## Methodology Notes

1. All benchmarks use Vitest's built-in benchmarking with warmup and multiple iterations for statistical significance.
2. **Cold start** = index build (if any) + search, measured per iteration. seaq passes `cache: false`, since a benchmark loop that repeats the same array would otherwise index it on the second iteration.
3. **Search only** = index pre-built outside the benchmark loop, measures pure search throughput. For seaq, that's the index it builds on a list's second search.
4. **Single search** benchmarks for Fuse.js, MiniSearch, and Lunr include index construction inside each iteration (cold-start behavior). seaq runs with `cache: false` and uFuzzy has no index. fuzzysort caches prepared targets across calls, so its cold benchmarks call `fuzzysort.cleanup()` first.
5. **Result counts differ.** Each library runs with its own defaults, so a faster time can mean less work: fuzzysort's 0.5 default threshold returns nothing for several benchmark queries. See `quality.test.ts`, `quality-metrics.test.ts` and `acronym-quality.test.ts` for result-quality comparisons.
6. Numbers will vary by machine. Relative comparisons are more meaningful than absolute ops/s.
