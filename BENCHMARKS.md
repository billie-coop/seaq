# Seaq Benchmarks

All numbers in this document come from a single `yarn workspace seaq vitest bench` run. Nothing is estimated or rounded for narrative purposes.

> **Snapshot date:** 2026-10-06
> **Node.js:** v22.13.1 (Apple Silicon)
> **Vitest:** v4.0.16
> **Compared:** fuzzysort 4.0.2, Fuse.js 7, MiniSearch 7, uFuzzy 1.0, Lunr 2.3, seaq 1.1.5 (v1)

See [README.md](./packages/core/README.md) for API documentation.

---

## TL;DR

- **seaq v2** is 89% faster than v1 on 10K contacts in joined mode (`930 vs 492 ops/s`) and 42% faster in separate mode (`698 ops/s`). On 20K cities, v2 joined is 75-94% faster than v1 depending on query.
- **seaq indexes a list on its second search.** Repeated default searches of 10K contacts take 0.38 ms for `"nath fe"` with the index and 2.56 ms without it (6.7x). Strict searches (`fuzziness: 0`) reuse the index in 13 µs.
- **Cold start** (first search, nothing built): seaq is 3.6x faster than MiniSearch, 9.5x faster than Fuse.js and 24x faster than Lunr. fuzzysort (4.8x) and uFuzzy (3.5x) are faster than seaq. At its default threshold, fuzzysort returns 0 results for the benchmark query `"nath fe"`, so its time measures a fast rejection.
- **Repeated search on static data**: MiniSearch and Lunr answer word queries 200-1,800x faster than seaq's index. fuzzysort's `snapshot()` is 3.5x faster than seaq on `"na"` and 9.6x faster on simulated typing. seaq's index is 1.5-6.7x faster than scanning, depending on the query.
- **Nested data cold start**: seaq is 8.4x faster than MiniSearch and 10-11x faster than Fuse.js because it needs no data flattening or index build.
- **includeMatches** costs under 10%.
- **`limit: 10` vs `.slice(0, 10)`**: effectively identical performance.

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
| v1 (published 1.1.5) | 492 | 2.03 | -- |
| v2 (joined) | 930 | 1.08 | +89% |
| v2 (separate) | 698 | 1.43 | +42% |

Both v2 modes are faster than v1, and joined mode (the default) is the fastest. v2 also matches more: shorthand, adjacent swaps and words in any order.

## v1 vs v2: 20K Cities

Keys: `['name', 'state']`, fuzziness: 0, no index.

| Query | v1 (ops/s) | v2 joined (ops/s) | v2 separate (ops/s) | v2 joined vs v1 |
|-------|----------:|-----------------:|-------------------:|----------------:|
| `"san"` | 215 | 377 | 336 | +75% |
| `"new york"` | 237 | 459 | 368 | +94% |
| `"los ang"` | 236 | 452 | 351 | +92% |

Across all three queries, v2 joined is the fastest mode and v2 separate sits in between.

---

## Single Search Performance by Library

These benchmarks include index build time. seaq runs with `cache: false`, and uFuzzy has no index. fuzzysort's prepared-target cache is cleared each iteration. Fuse.js, MiniSearch and Lunr build their index inside each iteration.

### 23 Books

Query: `"hi"`.

| Library | ops/s | mean (ms) |
|---------|------:|----------:|
| seaq (joined) | 205,418 | 0.005 |
| seaq (separate) | 201,251 | 0.005 |
| uFuzzy | 183,033 | 0.005 |
| fuzzysort | 84,464 | 0.012 |
| MiniSearch | 39,201 | 0.026 |
| Fuse.js | 37,924 | 0.026 |
| Lunr | 5,384 | 0.186 |

On a tiny dataset, seaq is fastest. fuzzysort returns 0 results for `"hi"` at its default threshold (seaq returns 9). Index-based libraries pay their build cost on every call, which makes them 5x slower.

### 10K Contacts

Query: `"nath fe"`.

| Library | ops/s | mean (ms) |
|---------|------:|----------:|
| uFuzzy | 4,538 | 0.22 |
| fuzzysort | 1,711 | 0.58 |
| seaq (joined) | 918 | 1.09 |
| seaq (separate) | 662 | 1.51 |
| MiniSearch | 98 | 10.18 |
| Fuse.js | 38 | 26.17 |
| Lunr | 32 | 31.41 |

seaq is 9.3x faster than MiniSearch and 24x faster than Fuse.js in cold-start scenarios. uFuzzy is 4.9x faster than seaq but requires pre-flattened string arrays. fuzzysort is 1.9x faster but returns 0 results for this query at its default threshold. Its best match scores 0.38, below the 0.5 cutoff.

### No-Keys Mode (10K items)

When searching without specifying keys, seaq auto-detects searchable fields.

| Mode | ops/s | mean (ms) |
|------|------:|----------:|
| String array (10K pre-joined strings) | 1,223 | 0.82 |
| Object array (10K contacts, all fields) | 85 | 11.72 |

Searching a plain string array is 14x faster than auto-scanning all object fields, because each object is matched against its whole JSON representation.

---

## 10 Consecutive Searches

Each iteration builds the index (or not) then searches 10 times. fuzzysort starts each iteration with a cleared cache, then reuses the targets it prepared on the first search. seaq runs with `cache: false` here, so it scans 10 times. With the default, the second search would build the index (see [Repeated Search on Static Data](#repeated-search-on-static-data-10k-contacts)).

### 23 Books

| Library | ops/s |
|---------|------:|
| uFuzzy | 62,708 |
| fuzzysort | 34,271 |
| MiniSearch | 32,711 |
| seaq (joined) | 20,601 |
| Fuse.js | 5,297 |
| Lunr | 4,875 |

### 10K Contacts

| Library | ops/s |
|---------|------:|
| uFuzzy | 460 |
| fuzzysort | 187 |
| MiniSearch | 98 |
| seaq (joined) | 93 |
| Lunr | 31 |
| Fuse.js | 4.4 |

seaq is 21x faster than Fuse.js. MiniSearch amortizes its index build and edges ahead at this scale.

---

## Repeated Search on Static Data (10K Contacts)

Each library's index is built once, outside the benchmark loop. For fuzzysort, that is an immutable `fuzzysort.snapshot()`. seaq uses the index it builds on a list's second search. `seaq (no index)` passes `cache: false` and scans every call. uFuzzy has no index and scans every call. This measures pure search throughput.

| Query | seaq | seaq (no index) | Fuse.js | fuzzysort | uFuzzy | MiniSearch | Lunr |
|-------|-----:|----------------:|--------:|----------:|-------:|-----------:|-----:|
| `"na"` (short) | 1,800 | 522 | 110 | 6,262 | 1,346 | 1,206,999 | 1,116,952 |
| `"nath fe"` (medium) | 2,608 | 390 | 46 | 8,583,223\* | 5,124 | 732,282 | 515,382 |
| `"natasha okeefe"` (long) | 403 | 269 | 17 | 4,495,830\* | 5,692 | 714,074 | 446,508 |

All values are ops/s. \* fuzzysort returns 0 results for these queries at its default threshold. Its snapshot rejects the whole dataset in well under a microsecond, so these numbers don't measure a real search.

seaq's index makes these searches 1.5-6.7x faster than scanning. It records which characters each contact contains, so a search only scores contacts that can make the top 10. A long fuzzy query like `"natasha okeefe"` can't rule out much, so it gains the least. With `fuzziness: 0`, the index answers `"nath fe"` in 13 µs (78,463 ops/s).

MiniSearch and Lunr are still 200-1,800x faster than seaq here: an inverted index looks words up instead of scoring characters. fuzzysort is 3.5x faster on `"na"`. uFuzzy, which scans without an index, beats seaq's index on the longer queries. If your data is large and static and raw repeated-query speed matters most, use an indexed library.

### Simulated Typing (7 keystrokes: n -> na -> ... -> natasha)

| Library | ops/s |
|---------|------:|
| MiniSearch | 175,043 |
| Lunr | 119,785 |
| fuzzysort | 2,558 |
| uFuzzy | 447 |
| seaq | 268 |
| seaq (no index) | 67 |
| Fuse.js | 10.7 |

Each iteration runs 7 searches. seaq's index makes typing 4x faster than scanning, at 0.53 ms per keystroke. fuzzysort is 9.6x faster than seaq: its snapshot only re-checks the previous query's matches when the query grows by a keystroke. seaq does the same only with `fuzziness: 0`, because a typo-tolerant search can match items the previous query didn't.

---

## Cold Start: Build + Search (10K Contacts)

This is the realistic first-search scenario: user loads a page with 10K items and immediately types a query. Index-based libraries must build their index first. fuzzysort's prepared-target cache is cleared each iteration. seaq runs with default options and `cache: false`.

Query: `"nath fe"`, keys: `['givenName', 'familyName']`.

| Library | ops/s | mean (ms) | vs seaq |
|---------|------:|----------:|--------:|
| fuzzysort\* | 1,833 | 0.55 | 4.8x faster |
| uFuzzy | 1,333 | 0.75 | 3.5x faster |
| **seaq** | **380** | **2.63** | **--** |
| seaq (`cache: true`, fresh array) | 386 | 2.59 | same |
| MiniSearch | 104 | 9.58 | 3.6x slower |
| Fuse.js | 40 | 25.01 | 9.5x slower |
| Lunr | 16 | 62.73 | 24x slower |

\* 0 results at fuzzysort's default threshold. seaq returns 10 for this query.

The `cache: true` row builds seaq's index on a new array every iteration, then searches it. It costs the same as a scan, so indexing on the first search is free when the list will be searched again.

---

## Performance by Mode (Joined vs Separate)

Query: `"nath fe"`, 10K contacts, fuzziness: 0, no index.

| Mode | ops/s | mean (ms) |
|------|------:|----------:|
| Joined | 918 | 1.09 |
| Separate | 662 | 1.51 |

On 23 books:

| Mode | ops/s |
|------|------:|
| Joined | 205,418 |
| Separate | 201,251 |

Joined mode (the default) is 1.4x faster on 10K contacts and about the same on books. Only joined mode uses the index; separate mode always scans. Choose between the modes for their matching semantics.

---

## includeMatches Overhead

10K contacts, `"nath fe"`, fuzziness: 0, no index.

### Joined Mode

| includeMatches | ops/s | mean (ms) |
|----------------|------:|----------:|
| false | 928 | 1.08 |
| true | 877 | 1.14 |

### Separate Mode

| includeMatches | ops/s | mean (ms) |
|----------------|------:|----------:|
| false | 665 | 1.50 |
| true | 611 | 1.64 |

**Under 10% in either mode** (6% joined, 9% separate in this run). Match positions are only computed for the final top results, so the cost doesn't grow with the list.

---

## Limit Optimization: Built-in `limit` vs `.slice()`

10K contacts, query `"na"`, joined mode, fuzziness: 0, no index.

| Approach | ops/s | mean (ms) |
|----------|------:|----------:|
| `.slice(0, 10)` | 573 | 1.74 |
| `limit: 10` | 577 | 1.73 |

**Effectively identical** (1.01x). The built-in `limit` uses an O(n log k) heap, which matches `.slice()` performance on small limits. The benefit of `limit` is that it avoids allocating the full sorted array.

---

## Multi-Word Query Performance (Separate Mode)

10K contacts, separate mode, no index. Compares strict vs fuzzy and single-word vs multi-word.

| Query | Fuzziness | ops/s | mean (ms) |
|-------|----------:|------:|----------:|
| `"nath"` (1 word) | 0.2 | 293 | 3.42 |
| `"nath fe"` (2 words) | 0.2 | 207 | 4.83 |
| `"natasha okeefe"` (2 words, long) | 0.2 | 147 | 6.79 |
| `"nath fe"` (2 words) | 0 | 633 | 1.58 |

Key observations:
- **Fuzziness costs ~3.1x**: strict `"nath fe"` runs at 633 ops/s and fuzzy `"nath fe"` at 207 ops/s. A strict search can stop at the first missing character.
- **Multi-word costs ~1.4x** vs single-word at the same fuzziness (293 -> 207 ops/s).
- **Longer queries cost more**: `"natasha okeefe"` runs at 147 ops/s and `"nath fe"` at 207 ops/s, because longer strings need more character comparisons.

---

## Nested Object and Array Performance

seaq natively traverses nested properties (`company.name`) and arrays (`emails.address`). Other libraries require pre-flattening the data. In the search-only tables, seaq runs with defaults, so the benchmark loop uses its index.

### Nested Property Search: `company.name` (search-only, index pre-built)

| Library | 1K contacts (ops/s) | 5K contacts (ops/s) |
|---------|--------------------:|--------------------:|
| seaq (native nested) | 34,586 | 7,036 |
| MiniSearch (pre-flattened) | 27,600 | 5,794 |
| Fuse.js (native nested) | 343 | 68 |

seaq is 1.2x faster than MiniSearch on already-flattened, indexed data.

### Array Field Search: `emails.address` (search-only, index pre-built)

| Library | 1K contacts (ops/s) | 5K contacts (ops/s) |
|---------|--------------------:|--------------------:|
| seaq (native array traversal) | 8,437 | 1,681 |
| MiniSearch (pre-flattened) | 3,568 | 607 |
| Fuse.js (native array) | 309 | 60 |

seaq is faster than pre-indexed MiniSearch on array fields: 2.4x at 1K and 2.8x at 5K. Both are 10x+ faster than Fuse.js.

### Deep Nested: `addresses.city` (1K contacts, cold start for Fuse.js)

| Library | ops/s |
|---------|------:|
| seaq (native) | 20,563 |
| MiniSearch (pre-flattened) | 7,279 |
| Fuse.js (native) | 333 |

### Cold Start with Nested Data (includes flattening + index build)

seaq runs with `cache: false`.

| Library | 1K contacts (ops/s) | 5K contacts (ops/s) |
|---------|--------------------:|--------------------:|
| **seaq (no prep needed)** | **3,043** | **552** |
| MiniSearch (flatten + index) | 360 | 66 |
| Fuse.js (index build) | 282 | 53 |

**seaq is 8.4x faster than MiniSearch and 10-11x faster than Fuse.js** on cold start with nested data. There is no flattening step and no index build.

### Multi-Field Nested Search (1K contacts)

Searching across `name`, `company.name`, and `addresses.city` with query `"John Acme"`. seaq runs with `cache: false`; Fuse.js builds its index inside each iteration.

| Library | ops/s | mean (ms) |
|---------|------:|----------:|
| seaq | 2,344 | 0.43 |
| Fuse.js | 125 | 8.00 |

seaq is 19x faster than Fuse.js on multi-field nested search.

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
