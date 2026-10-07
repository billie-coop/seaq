# Seaq Benchmarks

All numbers in this document come from a single `yarn workspace seaq vitest bench` run. Nothing is estimated or rounded for narrative purposes.

> **Snapshot date:** 2026-10-07
> **Node.js:** v24.20.0 (Apple Silicon)
> **Vitest:** v4.0.16
> **Compared:** fuzzysort 4.0.2, Fuse.js 7, MiniSearch 7, uFuzzy 1.0, Lunr 2.3, seaq 1.1.5 (v1)

See [README.md](./packages/core/README.md) for API documentation.

---

## TL;DR

- **seaq v2** is 73% faster than v1 on 10K contacts in joined mode (`883 vs 510 ops/s`) and 9% faster in separate mode (`557 ops/s`). On 20K cities, v2 joined is 66-73% faster than v1 depending on query.
- **seaq indexes a list on its second search.** Repeated default searches of 10K contacts take 0.38 ms for `"nath fe"` with the index and 2.26 ms without it (6.0x). Strict searches (`fuzziness: 0`) reuse the index in 15 µs.
- **Cold start** (first search, nothing built): seaq is 3.8x faster than MiniSearch, 10x faster than Fuse.js and 24x faster than Lunr. fuzzysort (4.3x) and uFuzzy (4.1x) are faster than seaq. At its default threshold, fuzzysort returns 0 results for the benchmark query `"nath fe"`, so its time measures a fast rejection.
- **Repeated search on static data**: MiniSearch and Lunr answer word queries 200-1,700x faster than seaq's index. fuzzysort's `snapshot()` is 3.6x faster than seaq on `"na"` and 9.4x faster on simulated typing. seaq's index is 1.4-6.0x faster than scanning, depending on the query.
- **Nested data cold start**: seaq is 7.9-8.8x faster than MiniSearch and 10.7-11.5x faster than Fuse.js because it needs no data flattening or index build.
- **includeMatches** costs under 5%.
- **`limit: 10`** is 1.15x faster than returning every match and slicing the first 10.

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
| v1 (published 1.1.5) | 510 | 1.96 | -- |
| v2 (joined) | 883 | 1.13 | +73% |
| v2 (separate) | 557 | 1.79 | +9% |

Both v2 modes are faster than v1, and joined mode (the default) is the fastest. v2 also matches more: shorthand, adjacent swaps and words in any order.

## v1 vs v2: 20K Cities

Keys: `['name', 'state']`, fuzziness: 0, no index.

| Query | v1 (ops/s) | v2 joined (ops/s) | v2 separate (ops/s) | v2 joined vs v1 |
|-------|----------:|-----------------:|-------------------:|----------------:|
| `"san"` | 222 | 368 | 327 | +66% |
| `"new york"` | 270 | 449 | 348 | +66% |
| `"los ang"` | 256 | 443 | 327 | +73% |

Across all three queries, v2 joined is the fastest mode and v2 separate sits in between.

---

## Single Search Performance by Library

These benchmarks include index build time. seaq runs with `cache: false`, and uFuzzy has no index. fuzzysort's prepared-target cache is cleared each iteration. Fuse.js, MiniSearch and Lunr build their index inside each iteration.

### 23 Books

Query: `"hi"`.

| Library | ops/s | mean (ms) |
|---------|------:|----------:|
| seaq (joined) | 198,223 | 0.005 |
| uFuzzy | 196,455 | 0.005 |
| seaq (separate) | 178,950 | 0.006 |
| fuzzysort | 115,533 | 0.009 |
| Fuse.js | 39,618 | 0.025 |
| MiniSearch | 37,887 | 0.026 |
| Lunr | 5,663 | 0.177 |

On a tiny dataset, seaq's default joined mode is fastest. fuzzysort returns 0 results for `"hi"` at its default threshold (seaq returns 9). Index-based libraries pay their build cost on every call, which makes them 5x slower.

### 10K Contacts

Query: `"nath fe"`.

| Library | ops/s | mean (ms) |
|---------|------:|----------:|
| uFuzzy | 4,622 | 0.22 |
| fuzzysort | 1,831 | 0.55 |
| seaq (joined) | 848 | 1.18 |
| seaq (separate) | 581 | 1.72 |
| MiniSearch | 101 | 9.91 |
| Fuse.js | 38 | 25.99 |
| Lunr | 34 | 29.26 |

seaq is 8.4x faster than MiniSearch and 22x faster than Fuse.js in cold-start scenarios. uFuzzy is 5.5x faster than seaq but requires pre-flattened string arrays. fuzzysort is 2.2x faster but returns 0 results for this query at its default threshold. Its best match scores 0.38, below the 0.5 cutoff.

### No-Keys Mode (10K items)

When searching without specifying keys, seaq auto-detects searchable fields.

| Mode | ops/s | mean (ms) |
|------|------:|----------:|
| String array (10K pre-joined strings) | 1,190 | 0.84 |
| Object array (10K contacts, all fields) | 95 | 10.56 |

Searching a plain string array is 13x faster than auto-scanning all object fields, because each object is matched against its whole JSON representation.

---

## 10 Consecutive Searches

Each iteration builds the index (or not) then searches 10 times. fuzzysort starts each iteration with a cleared cache, then reuses the targets it prepared on the first search. seaq runs with `cache: false` here, so it scans 10 times. With the default, the second search would build the index (see [Repeated Search on Static Data](#repeated-search-on-static-data-10k-contacts)).

### 23 Books

| Library | ops/s |
|---------|------:|
| uFuzzy | 66,836 |
| fuzzysort | 40,204 |
| MiniSearch | 34,231 |
| seaq (joined) | 20,525 |
| Fuse.js | 5,305 |
| Lunr | 5,176 |

### 10K Contacts

| Library | ops/s |
|---------|------:|
| uFuzzy | 453 |
| fuzzysort | 200 |
| MiniSearch | 100 |
| seaq (joined) | 83 |
| Lunr | 35 |
| Fuse.js | 4.6 |

seaq is 18x faster than Fuse.js. MiniSearch amortizes its index build and edges ahead at this scale.

---

## Repeated Search on Static Data (10K Contacts)

Each library's index is built once, outside the benchmark loop. For fuzzysort, that is an immutable `fuzzysort.snapshot()`. seaq uses the index it builds on a list's second search. `seaq (no index)` passes `cache: false` and scans every call. uFuzzy has no index and scans every call. This measures pure search throughput.

| Query | seaq | seaq (no index) | Fuse.js | fuzzysort | uFuzzy | MiniSearch | Lunr |
|-------|-----:|----------------:|--------:|----------:|-------:|-----------:|-----:|
| `"na"` (short) | 1,826 | 566 | 103 | 6,504 | 1,297 | 1,366,326 | 1,186,975 |
| `"nath fe"` (medium) | 2,663 | 442 | 48 | 10,931,846\* | 5,450 | 772,050 | 539,884 |
| `"natasha okeefe"` (long) | 421 | 304 | 17 | 4,634,092\* | 6,238 | 721,809 | 471,425 |

All values are ops/s. \* fuzzysort returns 0 results for these queries at its default threshold. Its snapshot rejects the whole dataset in well under a microsecond, so these numbers don't measure a real search.

seaq's index makes these searches 1.4-6.0x faster than scanning. It records which characters each contact contains, so a search only scores contacts that can make the top 10. A long fuzzy query like `"natasha okeefe"` can't rule out much, so it gains the least. With `fuzziness: 0`, the index answers `"nath fe"` in 15 µs (64,873 ops/s).

MiniSearch and Lunr are still 200-1,700x faster than seaq here: an inverted index looks words up instead of scoring characters. fuzzysort is 3.6x faster on `"na"`. uFuzzy, which scans without an index, beats seaq's index on the longer queries. If your data is large and static and raw repeated-query speed matters most, use an indexed library.

### Simulated Typing (7 keystrokes: n -> na -> ... -> natasha)

| Library | ops/s |
|---------|------:|
| MiniSearch | 191,214 |
| Lunr | 134,680 |
| fuzzysort | 2,626 |
| uFuzzy | 467 |
| seaq | 281 |
| seaq (no index) | 70 |
| Fuse.js | 11.4 |

Each iteration runs 7 searches. seaq's index makes typing 4.0x faster than scanning, at 0.51 ms per keystroke. fuzzysort is 9.4x faster than seaq: its snapshot only re-checks the previous query's matches when the query grows by a keystroke. seaq does the same only with `fuzziness: 0`, because a typo-tolerant search can match items the previous query didn't.

---

## Cold Start: Build + Search (10K Contacts)

This is the realistic first-search scenario: user loads a page with 10K items and immediately types a query. Index-based libraries must build their index first. fuzzysort's prepared-target cache is cleared each iteration. seaq runs with default options and `cache: false`.

Query: `"nath fe"`, keys: `['givenName', 'familyName']`.

| Library | ops/s | mean (ms) | vs seaq |
|---------|------:|----------:|--------:|
| fuzzysort\* | 1,819 | 0.55 | 4.3x faster |
| uFuzzy | 1,732 | 0.58 | 4.1x faster |
| **seaq** | **426** | **2.35** | **--** |
| seaq (`cache: true`, fresh array) | 429 | 2.33 | 1% faster |
| MiniSearch | 111 | 9.00 | 3.8x slower |
| Fuse.js | 41 | 24.47 | 10x slower |
| Lunr | 18 | 55.59 | 24x slower |

\* 0 results at fuzzysort's default threshold. seaq returns 10 for this query.

The `cache: true` row builds seaq's index on a new array every iteration, then searches it. It costs about the same as a scan (1% less in this run), so indexing on the first search is nearly free when the list will be searched again.

---

## Performance by Mode (Joined vs Separate)

Query: `"nath fe"`, 10K contacts, fuzziness: 0, no index.

| Mode | ops/s | mean (ms) |
|------|------:|----------:|
| Joined | 848 | 1.18 |
| Separate | 581 | 1.72 |

On 23 books:

| Mode | ops/s |
|------|------:|
| Joined | 198,223 |
| Separate | 178,950 |

Joined mode (the default) is 1.5x faster on 10K contacts and 1.1x faster on books. Only joined mode uses the index; separate mode always scans. Choose between the modes for their matching semantics.

---

## includeMatches Overhead

10K contacts, `"nath fe"`, fuzziness: 0, no index.

### Joined Mode

| includeMatches | ops/s | mean (ms) |
|----------------|------:|----------:|
| false | 834 | 1.20 |
| true | 804 | 1.24 |

### Separate Mode

| includeMatches | ops/s | mean (ms) |
|----------------|------:|----------:|
| false | 517 | 1.93 |
| true | 518 | 1.93 |

**Under 5% in either mode** (4% joined, no measurable difference separate in this run). Match positions are only computed for the final top results, so the cost doesn't grow with the list.

---

## Limit Optimization: Built-in `limit` vs `.slice()`

10K contacts, query `"na"`, joined mode, fuzziness: 0, no index.

| Approach | ops/s | mean (ms) |
|----------|------:|----------:|
| `limit: Infinity`, then `.slice(0, 10)` | 432 | 2.31 |
| `limit: 10` | 495 | 2.02 |

**The built-in `limit` is 1.15x faster.** It keeps the top 10 in an O(n log k) heap instead of sorting every match. Both apply the default `threshold`, so they return the same 10 results.

---

## Multi-Word Query Performance (Separate Mode)

10K contacts, separate mode, no index. Compares strict vs fuzzy and single-word vs multi-word.

| Query | Fuzziness | ops/s | mean (ms) |
|-------|----------:|------:|----------:|
| `"nath"` (1 word) | 0.2 | 294 | 3.40 |
| `"nath fe"` (2 words) | 0.2 | 214 | 4.67 |
| `"natasha okeefe"` (2 words, long) | 0.2 | 168 | 5.97 |
| `"nath fe"` (2 words) | 0 | 575 | 1.74 |

Key observations:
- **Fuzziness costs ~2.7x**: strict `"nath fe"` runs at 575 ops/s and fuzzy `"nath fe"` at 214 ops/s. A strict search can stop at the first missing character.
- **Multi-word costs ~1.4x** vs single-word at the same fuzziness (294 -> 214 ops/s).
- **Longer queries cost more**: `"natasha okeefe"` runs at 168 ops/s and `"nath fe"` at 214 ops/s, because longer strings need more character comparisons.

---

## Nested Object and Array Performance

seaq natively traverses nested properties (`company.name`) and arrays (`emails.address`). Other libraries require pre-flattening the data. In the search-only tables, seaq runs with defaults, so the benchmark loop uses its index.

### Nested Property Search: `company.name` (search-only, index pre-built)

| Library | 1K contacts (ops/s) | 5K contacts (ops/s) |
|---------|--------------------:|--------------------:|
| seaq (native nested) | 29,589 | 6,185 |
| MiniSearch (pre-flattened) | 29,921 | 6,011 |
| Fuse.js (native nested) | 347 | 69 |

seaq matches MiniSearch on already-flattened, indexed data: MiniSearch is 1% faster at 1K and seaq 3% faster at 5K.

### Array Field Search: `emails.address` (search-only, index pre-built)

| Library | 1K contacts (ops/s) | 5K contacts (ops/s) |
|---------|--------------------:|--------------------:|
| seaq (native array traversal) | 9,296 | 1,823 |
| MiniSearch (pre-flattened) | 3,744 | 673 |
| Fuse.js (native array) | 301 | 57 |

seaq is faster than pre-indexed MiniSearch on array fields: 2.5x at 1K and 2.7x at 5K. Both are 10x+ faster than Fuse.js.

### Deep Nested: `addresses.city` (1K contacts, cold start for Fuse.js)

| Library | ops/s |
|---------|------:|
| seaq (native) | 17,402 |
| MiniSearch (pre-flattened) | 7,466 |
| Fuse.js (native) | 329 |

### Cold Start with Nested Data (includes flattening + index build)

seaq runs with `cache: false`.

| Library | 1K contacts (ops/s) | 5K contacts (ops/s) |
|---------|--------------------:|--------------------:|
| **seaq (no prep needed)** | **3,036** | **647** |
| MiniSearch (flatten + index) | 385 | 74 |
| Fuse.js (index build) | 283 | 56 |

**seaq is 7.9-8.8x faster than MiniSearch and 10.7-11.5x faster than Fuse.js** on cold start with nested data. There is no flattening step and no index build.

### Multi-Field Nested Search (1K contacts)

Searching across `name`, `company.name`, and `addresses.city` with query `"John Acme"`. seaq runs with `cache: false`; Fuse.js builds its index inside each iteration.

| Library | ops/s | mean (ms) |
|---------|------:|----------:|
| seaq | 2,615 | 0.38 |
| Fuse.js | 127 | 7.85 |

seaq is 21x faster than Fuse.js on multi-field nested search.

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
