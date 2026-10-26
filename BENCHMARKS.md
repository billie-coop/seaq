# Seaq Benchmarks

All numbers in this document come from a single `yarn workspace seaq vitest bench` run. Nothing is estimated or rounded for narrative purposes.

> **Snapshot date:** 2026-10-23
> **Node.js:** v24.22.1 (Apple Silicon)
> **Vitest:** v4.0.16
> **Compared:** fuzzysort 4.0.2, Fuse.js 7, MiniSearch 7, uFuzzy 1.0, Lunr 2.3, seaq 1.1.5 (v1)

See [README.md](./packages/core/README.md) for API documentation.

---

## TL;DR

- **seaq v2** is 75% faster than v1 on 10K contacts (`869 vs 497 ops/s`). On 20K cities, v2 is 55-80% faster than v1 depending on query.
- **seaq indexes a list on its second search.** Repeated default searches of 10K contacts take 0.37 ms for `"nath fe"` with the index and 2.31 ms without it (6.2x). Strict searches (`fuzziness: 0`) reuse the index in 27 µs.
- **Cold start** (first search, nothing built): seaq is 4.1x faster than MiniSearch, 10x faster than Fuse.js and 24x faster than Lunr. fuzzysort (4.6x) and uFuzzy (4.3x) are faster than seaq. At its default threshold, fuzzysort returns 0 results for the benchmark query `"nath fe"`, so its time measures a fast rejection.
- **Repeated search on static data**: MiniSearch and Lunr answer word queries 190-1,700x faster than seaq's index. fuzzysort's `snapshot()` is 3.7x faster than seaq on `"na"` and 9.6x faster on simulated typing. seaq's index is 1.4-6.2x faster than scanning, depending on the query.
- **Nested data cold start**: seaq is 8.6-9.0x faster than MiniSearch and 10.9-11.5x faster than Fuse.js because it needs no data flattening or index build.
- **`includeMatches`** had no measurable cost in the unindexed search over 10K contacts, returning the top 10 results.
- **`limit: 10`** is 1.19x faster than returning every match and slicing the first 10.

---

## Test Environment

- **Datasets:**
  - 23 books from `@seaq/test-data/books.json` (classic Fuse.js test set)
  - 10,000 contacts from `@seaq/test-data/contacts-10k.json` (seeded PRNG, realistic names)
  - 20,000 cities from `@seaq/test-data/cities.json` (real-world cities)
  - 1K and 5K synthetic nested contacts (generated in `nested-arrays.bench.ts`)
- **seaq defaults:** `fuzziness: 0.2`, `limit: 10`, `threshold: 0.3`, and an index built on an array's second search.
- **Benchmark settings:**
  - The engine benchmarks in `seaq.bench.ts` (v1 vs v2, includeMatches, limit) pass `cache: false`, so every iteration scans the list, and most use `fuzziness: 0` for consistent measurement. The multi-word tests use `fuzziness: 0.2` to measure fuzzy overhead.
  - `realworld.bench.ts` uses seaq's defaults. A benchmark loop searches the same array over and over, so the `seaq` rows there use the index. The `seaq (no index)` rows pass `cache: false`, and cold-start rows pass `cache: false` so they measure a first search.
- **fuzzysort** runs with its defaults (`limit: 10`, `threshold: 0.5`). It has no typo tolerance and its threshold is stricter than seaq's, so it can return fewer results for the same query. The tables below give its result count where it returns nothing.

---

## v1 vs v2: 10K Contacts

Query: `"nath fe"`, keys: `['givenName', 'familyName']`, fuzziness: 0, no index.

| Variant | ops/s | mean (ms) | vs v1 |
|---------|------:|----------:|------:|
| v1 (published 1.1.5) | 497 | 2.01 | -- |
| v2 | 869 | 1.15 | +75% |

v2 is faster and also matches more: shorthand, adjacent swaps and words in any order.

## v1 vs v2: 20K Cities

Keys: `['name', 'state']`, fuzziness: 0, no index.

| Query | v1 (ops/s) | v2 (ops/s) | v2 vs v1 |
|-------|----------:|----------:|---------:|
| `"san"` | 237 | 368 | +55% |
| `"new york"` | 250 | 449 | +80% |
| `"los ang"` | 255 | 433 | +70% |

---

## Single Search Performance by Library

These benchmarks include index build time. seaq runs with `cache: false`, and uFuzzy has no index. fuzzysort's prepared-target cache is cleared each iteration. Fuse.js, MiniSearch and Lunr build their index inside each iteration.

### 23 Books

Query: `"hi"`.

| Library | ops/s | mean (ms) |
|---------|------:|----------:|
| seaq | 194,328 | 0.005 |
| uFuzzy | 190,704 | 0.005 |
| fuzzysort | 109,015 | 0.009 |
| MiniSearch | 41,693 | 0.024 |
| Fuse.js | 40,390 | 0.025 |
| Lunr | 5,967 | 0.168 |

On a tiny dataset, seaq is fastest, just ahead of uFuzzy. fuzzysort returns 0 results for `"hi"` at its default threshold (seaq returns 9). Index-based libraries pay their build cost on every call, which makes them 4.7x slower or more.

### 10K Contacts

Query: `"nath fe"`.

| Library | ops/s | mean (ms) |
|---------|------:|----------:|
| uFuzzy | 4,925 | 0.20 |
| fuzzysort | 1,808 | 0.55 |
| seaq | 866 | 1.15 |
| MiniSearch | 102 | 9.84 |
| Fuse.js | 39 | 25.40 |
| Lunr | 36 | 27.81 |

seaq is 8.5x faster than MiniSearch and 22x faster than Fuse.js in cold-start scenarios. uFuzzy is 5.7x faster than seaq but requires pre-flattened string arrays. fuzzysort is 2.1x faster but returns 0 results for this query at its default threshold. Its best match scores 0.38, below the 0.5 cutoff.

### No-Keys Mode (10K items)

Without keys, seaq matches each object against its JSON, property names included.

| Mode | ops/s | mean (ms) |
|------|------:|----------:|
| String array (10K pre-joined strings) | 1,175 | 0.85 |
| Object array (10K contacts, all fields) | 91 | 11.02 |

Searching a plain string array is 13x faster, because each object is matched against its whole JSON representation.

---

## 10 Consecutive Searches

Each iteration builds the index (or not) then searches 10 times. fuzzysort starts each iteration with a cleared cache, then reuses the targets it prepared on the first search. seaq runs with `cache: false` here, so it scans 10 times. With the default, the second search would build the index (see [Repeated Search on Static Data](#repeated-search-on-static-data-10k-contacts)).

### 23 Books

| Library | ops/s |
|---------|------:|
| uFuzzy | 64,799 |
| fuzzysort | 39,207 |
| MiniSearch | 30,963 |
| seaq | 20,653 |
| Lunr | 5,588 |
| Fuse.js | 5,420 |

### 10K Contacts

| Library | ops/s |
|---------|------:|
| uFuzzy | 500 |
| fuzzysort | 207 |
| MiniSearch | 95 |
| seaq | 85 |
| Lunr | 35 |
| Fuse.js | 4.6 |

seaq is 18x faster than Fuse.js. MiniSearch amortizes its index build and edges ahead at this scale.

---

## Repeated Search on Static Data (10K Contacts)

Each library's index is built once, outside the benchmark loop. For fuzzysort, that is an immutable `fuzzysort.snapshot()`. seaq uses the index it builds on a list's second search. `seaq (no index)` passes `cache: false` and scans every call. uFuzzy has no index and scans every call. This measures pure search throughput.

| Query | seaq | seaq (no index) | Fuse.js | fuzzysort | uFuzzy | MiniSearch | Lunr |
|-------|-----:|----------------:|--------:|----------:|-------:|-----------:|-----:|
| `"na"` (short) | 1,697 | 559 | 101 | 6,310 | 1,301 | 1,355,535 | 1,204,497 |
| `"nath fe"` (medium) | 2,669 | 433 | 45 | 11,141,724\* | 4,880 | 801,459 | 518,202 |
| `"natasha okeefe"` (long) | 427 | 313 | 17 | 4,849,275\* | 6,084 | 716,593 | 448,499 |

All values are ops/s. \* fuzzysort returns 0 results for these queries at its default threshold. Its snapshot rejects the whole dataset in well under a microsecond, so these numbers don't measure a real search.

seaq's index makes these searches 1.4-6.2x faster than scanning. The index keeps each item's prepared text and character classes. It skips candidates whose score bounds cannot reach the current cutoff, but still scores some candidates that ultimately fall outside the top 10. Non-ASCII characters share one class, so filtering is less selective for other scripts. A long fuzzy query like `"natasha okeefe"` can't rule out much, so it gains the least. With `fuzziness: 0`, the index answers `"nath fe"` in 27 µs (37,518 ops/s).

MiniSearch and Lunr are still 190-1,700x faster than seaq here: an inverted index looks words up instead of scoring characters. fuzzysort is 3.7x faster on `"na"`. uFuzzy, which scans without an index, beats seaq's index on the longer queries. If your data is large and static and raw repeated-query speed matters most, use an indexed library.

### Simulated Typing (7 keystrokes: n -> na -> ... -> natasha)

| Library | ops/s |
|---------|------:|
| MiniSearch | 185,883 |
| Lunr | 128,280 |
| fuzzysort | 2,537 |
| uFuzzy | 453 |
| seaq | 264 |
| seaq (no index) | 71 |
| Fuse.js | 11.2 |

Each iteration runs 7 searches. seaq's index makes typing 3.7x faster than scanning, at 0.54 ms per keystroke. fuzzysort is 9.6x faster than seaq: its snapshot only re-checks the previous query's matches when the query grows by a keystroke. seaq does the same only with `fuzziness: 0`, because a typo-tolerant search can match items the previous query didn't.

---

## Cold Start: Build + Search (10K Contacts)

This is the realistic first-search scenario: user loads a page with 10K items and immediately types a query. Index-based libraries must build their index first. fuzzysort's prepared-target cache is cleared each iteration. seaq runs with default options and `cache: false`.

Query: `"nath fe"`, keys: `['givenName', 'familyName']`.

| Library | ops/s | mean (ms) | vs seaq |
|---------|------:|----------:|--------:|
| fuzzysort\* | 1,886 | 0.53 | 4.6x faster |
| uFuzzy | 1,750 | 0.57 | 4.3x faster |
| **seaq** | **406** | **2.46** | **--** |
| seaq (`cache: true`, fresh array) | 468 | 2.13 | 15% faster |
| MiniSearch | 100 | 10.02 | 4.1x slower |
| Fuse.js | 39 | 25.37 | 10x slower |
| Lunr | 17 | 59.30 | 24x slower |

\* 0 results at fuzzysort's default threshold. seaq returns 10 for this query.

The `cache: true` row builds seaq's index on a new array every iteration, then searches it. It costs no more than a scan (15% less in this run), so indexing on the first search is free when the list will be searched again.

---

## includeMatches Overhead

10K contacts, `"nath fe"`, fuzziness: 0, no index.

| includeMatches | ops/s | mean (ms) |
|----------------|------:|----------:|
| false | 834 | 1.20 |
| true | 861 | 1.16 |

**No measurable cost in this run** (the `true` row was 3% faster, within run-to-run noise). Match positions are only computed for the final top results. Highlighting work depends on the returned results and their field lengths. Returning more results increases that work.

---

## Limit Optimization: Built-in `limit` vs `.slice()`

10K contacts, query `"na"`, fuzziness: 0, no index.

| Approach | ops/s | mean (ms) |
|----------|------:|----------:|
| `limit: Infinity`, then `.slice(0, 10)` | 467 | 2.14 |
| `limit: 10` | 554 | 1.81 |

**The built-in `limit` is 1.19x faster.** It keeps the top 10 in an O(n log k) heap instead of sorting every match. Both apply the default `threshold`, so they return the same 10 results.

---

## Multi-Word Query Performance

10K contacts, no index. Compares strict vs fuzzy and single-word vs multi-word.

| Query | Fuzziness | ops/s | mean (ms) |
|-------|----------:|------:|----------:|
| `"nath"` (1 word) | 0.2 | 473 | 2.12 |
| `"nath fe"` (2 words) | 0.2 | 398 | 2.51 |
| `"natasha okeefe"` (2 words, long) | 0.2 | 290 | 3.45 |
| `"nath fe"` (2 words) | 0 | 854 | 1.17 |

Key observations:
- **Fuzziness costs ~2.1x**: strict `"nath fe"` runs at 854 ops/s and fuzzy `"nath fe"` at 398 ops/s. A strict search can stop at the first missing character.
- **Multi-word costs ~1.2x** vs single-word at the same fuzziness (473 -> 398 ops/s).
- **Longer queries cost more**: `"natasha okeefe"` runs at 290 ops/s and `"nath fe"` at 398 ops/s, because longer strings need more character comparisons.

---

## Nested Object and Array Performance

seaq natively traverses nested properties (`company.name`) and arrays (`emails.address`). Fuse.js also takes nested keys. In these benchmarks MiniSearch gets pre-flattened data; it can also read nested fields through a custom `extractField`. In the search-only tables, seaq runs with defaults, so the benchmark loop uses its index.

### Nested Property Search: `company.name` (search-only, index pre-built)

| Library | 1K contacts (ops/s) | 5K contacts (ops/s) |
|---------|--------------------:|--------------------:|
| seaq (native nested) | 25,466 | 5,505 |
| MiniSearch (pre-flattened) | 28,956 | 5,942 |
| Fuse.js (native nested) | 346 | 68 |

On already-flattened, indexed data MiniSearch is 14% faster than seaq at 1K and 8% faster at 5K.

### Array Field Search: `emails.address` (search-only, index pre-built)

| Library | 1K contacts (ops/s) | 5K contacts (ops/s) |
|---------|--------------------:|--------------------:|
| seaq (native array traversal) | 8,560 | 1,739 |
| MiniSearch (pre-flattened) | 3,679 | 682 |
| Fuse.js (native array) | 310 | 60 |

seaq is faster than pre-indexed MiniSearch on array fields: 2.3x at 1K and 2.5x at 5K. Both are 10x+ faster than Fuse.js.

### Deep Nested: `addresses.city` (1K contacts, cold start for Fuse.js)

| Library | ops/s |
|---------|------:|
| seaq (native) | 16,385 |
| MiniSearch (pre-flattened) | 7,918 |
| Fuse.js (native) | 334 |

### Cold Start with Nested Data (includes flattening + index build)

seaq runs with `cache: false`.

| Library | 1K contacts (ops/s) | 5K contacts (ops/s) |
|---------|--------------------:|--------------------:|
| **seaq (no prep needed)** | **3,150** | **615** |
| MiniSearch (flatten + index) | 368 | 68 |
| Fuse.js (index build) | 289 | 54 |

**seaq is 8.6-9.0x faster than MiniSearch and 10.9-11.5x faster than Fuse.js** on cold start with nested data. There is no flattening step and no index build.

### Multi-Field Nested Search (1K contacts)

Searching across `name`, `company.name`, and `addresses.city` with query `"John Acme"`. seaq runs with `cache: false`; Fuse.js builds its index inside each iteration.

| Library | ops/s | mean (ms) |
|---------|------:|----------:|
| seaq | 2,439 | 0.41 |
| Fuse.js | 130 | 7.72 |

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
5. **Result counts differ.** Each library runs with its own defaults, so a faster time can mean less work: fuzzysort's 0.5 default threshold returns nothing for several benchmark queries. For result quality, `test/perf/quality.test.ts` checks what each library finds, and `yarn workspace seaq report quality acronyms` prints precision, recall and acronym tables.
6. Numbers will vary by machine. Relative comparisons are more meaningful than absolute ops/s.
