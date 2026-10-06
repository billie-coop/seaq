# Seaq Benchmarks

All numbers in this document come from a single `yarn workspace seaq vitest bench` run. Nothing is estimated or rounded for narrative purposes.

> **Snapshot date:** 2026-10-06
> **Node.js:** v22.13.1 (Apple Silicon)
> **Vitest:** v4.0.16
> **Compared:** fuzzysort 4.0.2, Fuse.js 7, MiniSearch 7, uFuzzy 1.0, Lunr 2.3, seaq 1.1.5 (v1)

See [README.md](./README.md) for API documentation.

---

## TL;DR

- **seaq v2** is 96% faster than v1 on 10K contacts in joined mode (`1,005 vs 512 ops/s`) and 59% faster in separate mode (`815 ops/s`).
- On 20K cities, v2 joined is 92-127% faster than v1 depending on query.
- **Cold start** (no pre-built index): seaq is 4.2x faster than MiniSearch, 12x faster than Fuse.js and 30x faster than Lunr. fuzzysort (4.0x) and uFuzzy (2.9x) are faster than seaq. At its default threshold, fuzzysort returns 0 results for the benchmark query `"nath fe"`, so its time measures a fast rejection.
- **Pre-built index** (repeated search on static data): MiniSearch and Lunr are 1,600-2,100x faster than seaq. fuzzysort's `snapshot()` is 10x faster than seaq on `"na"` and 32x faster on simulated typing. seaq does not build an index, so this is the expected tradeoff.
- **Nested data cold start**: seaq is 10-12x faster than MiniSearch and 14x faster than Fuse.js because it needs no data flattening or index build.
- **includeMatches** adds no measurable overhead.
- **`limit: 10` vs `.slice(0, 10)`**: effectively identical performance.

---

## Test Environment

- **Datasets:**
  - 23 books from `@seaq/test-data/books.json` (classic Fuse.js test set)
  - 10,000 contacts from `@seaq/test-data/contacts-10k.json` (seeded PRNG, realistic names)
  - 20,000 cities from `@seaq/test-data/cities.json` (real-world US cities)
  - 1K and 5K synthetic nested contacts (generated in `nested-arrays.bench.ts`)
- **Current defaults:** `fuzziness: 0.2`, `fieldMode: 'joined'`, `limit: 10`, `threshold: 0.3`
- **Benchmark settings:** Most benchmarks use `fuzziness: 0` for consistent measurement. The multi-word regression tests use `fuzziness: 0.2` to measure fuzzy overhead. The `realworld.bench.ts` tests use default options (including `fuzziness: 0.2`).
- **fuzzysort** runs with its defaults (`limit: 10`, `threshold: 0.5`). It has no typo tolerance and its threshold is stricter than seaq's, so it can return fewer results for the same query. The tables below give its result count where it returns nothing.

---

## v1 vs v2: 10K Contacts

Query: `"nath fe"`, keys: `['givenName', 'familyName']`, fuzziness: 0.

| Variant | ops/s | mean (ms) | vs v1 |
|---------|------:|----------:|------:|
| v1 (published 1.1.5) | 512 | 1.95 | -- |
| v2 (joined) | 1,005 | 1.00 | +96% |
| v2 (separate) | 815 | 1.23 | +59% |

Both v2 modes are faster than v1, and joined mode (the default) is the fastest.

## v1 vs v2: 20K Cities

Keys: `['name', 'state']`, fuzziness: 0.

| Query | v1 (ops/s) | v2 joined (ops/s) | v2 separate (ops/s) | v2 joined vs v1 |
|-------|----------:|-----------------:|-------------------:|----------------:|
| `"san"` | 231 | 444 | 370 | +92% |
| `"new york"` | 227 | 516 | 388 | +127% |
| `"los ang"` | 237 | 507 | 376 | +114% |

Across all three queries, v2 joined is the fastest mode and v2 separate sits in between.

---

## Single Search Performance by Library

These benchmarks include index build time. seaq and uFuzzy have no index to build. fuzzysort's prepared-target cache is cleared each iteration. Fuse.js, MiniSearch and Lunr build their index inside each iteration.

### 23 Books

Query: `"hi"`.

| Library | ops/s | mean (ms) |
|---------|------:|----------:|
| seaq (joined) | 272,824 | 0.004 |
| seaq (separate) | 250,692 | 0.004 |
| uFuzzy | 183,549 | 0.005 |
| fuzzysort | 98,389 | 0.010 |
| MiniSearch | 42,132 | 0.024 |
| Fuse.js | 39,596 | 0.025 |
| Lunr | 5,750 | 0.174 |

On a tiny dataset, seaq is fastest. fuzzysort returns 0 results for `"hi"` at its default threshold (seaq returns 9). Index-based libraries pay their build cost on every call, which makes them 6x slower.

### 10K Contacts

Query: `"nath fe"`.

| Library | ops/s | mean (ms) |
|---------|------:|----------:|
| uFuzzy | 5,016 | 0.20 |
| fuzzysort | 1,814 | 0.55 |
| seaq (joined) | 989 | 1.01 |
| seaq (separate) | 764 | 1.31 |
| MiniSearch | 105 | 9.57 |
| Fuse.js | 40 | 25.28 |
| Lunr | 35 | 28.32 |

seaq is 9.5x faster than MiniSearch and 25x faster than Fuse.js in cold-start scenarios. uFuzzy is 5x faster than seaq but requires pre-flattened string arrays. fuzzysort is 1.8x faster but returns 0 results for this query at its default threshold. Its best match scores 0.38, below the 0.5 cutoff.

### No-Keys Mode (10K items)

When searching without specifying keys, seaq auto-detects searchable fields.

| Mode | ops/s | mean (ms) |
|------|------:|----------:|
| String array (10K pre-joined strings) | 1,661 | 0.60 |
| Object array (10K contacts, all fields) | 170 | 5.89 |

Searching a plain string array is ~9.8x faster than auto-scanning all object fields.

---

## 10 Consecutive Searches

Each iteration builds the index (or not) then searches 10 times. This models a component that re-runs search on every keystroke but keeps its index alive across calls. fuzzysort starts each iteration with a cleared cache, then reuses the targets it prepared on the first search.

### 23 Books

| Library | ops/s |
|---------|------:|
| uFuzzy | 66,596 |
| fuzzysort | 36,274 |
| MiniSearch | 33,459 |
| seaq (joined) | 27,477 |
| Lunr | 5,542 |
| Fuse.js | 5,429 |

### 10K Contacts

| Library | ops/s |
|---------|------:|
| uFuzzy | 521 |
| fuzzysort | 205 |
| MiniSearch | 104 |
| seaq (joined) | 97 |
| Lunr | 35 |
| Fuse.js | 4.5 |

seaq is 22x faster than Fuse.js. MiniSearch amortizes its index build and edges ahead at this scale.

---

## Pre-Built Index: Search Only (10K Contacts)

For libraries that support it, the index is built once upfront. For fuzzysort, that is an immutable `fuzzysort.snapshot()`. seaq and uFuzzy re-scan on every call because they have no index. This measures pure search throughput.

| Query | seaq | Fuse.js | fuzzysort | uFuzzy | MiniSearch | Lunr |
|-------|-----:|--------:|----------:|-------:|-----------:|-----:|
| `"na"` (short) | 620 | 113 | 6,390 | 1,376 | 1,301,751 | 1,142,225 |
| `"nath fe"` (medium) | 471 | 47 | 9,436,244\* | 4,915 | 767,271 | 511,431 |
| `"natasha okeefe"` (long) | 357 | 18 | 4,458,107\* | 5,760 | 707,632 | 430,161 |

All values are ops/s. \* fuzzysort returns 0 results for these queries at its default threshold. Its snapshot rejects the whole dataset in well under a microsecond, so these numbers don't measure a real search.

MiniSearch and Lunr are 1,600-2,100x faster than seaq when the index is pre-built, and fuzzysort is 10x faster on `"na"`. seaq is the wrong choice for this scenario. If your data is large and static, use an indexed library.

### Simulated Typing (7 keystrokes: n -> na -> ... -> natasha)

| Library | ops/s |
|---------|------:|
| MiniSearch | 180,766 |
| Lunr | 127,336 |
| fuzzysort | 2,648 |
| uFuzzy | 471 |
| seaq | 84 |
| Fuse.js | 11.7 |

Each iteration runs 7 searches. MiniSearch is 2,155x faster than seaq on pre-indexed data while the user types, and fuzzysort is 32x faster. A fuzzysort snapshot only re-checks the previous query's matches when the query grows by a keystroke.

---

## Cold Start: Build + Search (10K Contacts)

This is the realistic first-search scenario: user loads a page with 10K items and immediately types a query. Index-based libraries must build their index first. fuzzysort's prepared-target cache is cleared each iteration.

Query: `"nath fe"`, keys: `['givenName', 'familyName']`.

| Library | ops/s | mean (ms) | vs seaq |
|---------|------:|----------:|--------:|
| fuzzysort\* | 1,882 | 0.53 | 4.0x faster |
| uFuzzy | 1,373 | 0.73 | 2.9x faster |
| **seaq** | **469** | **2.13** | **--** |
| MiniSearch | 111 | 9.03 | 4.2x slower |
| Fuse.js | 40 | 25.17 | 11.8x slower |
| Lunr | 16 | 62.95 | 29.5x slower |

\* 0 results at fuzzysort's default threshold. seaq returns 10 for this query.

---

## Performance by Mode (Joined vs Separate)

Query: `"nath fe"`, 10K contacts, fuzziness: 0.

| Mode | ops/s | mean (ms) |
|------|------:|----------:|
| Joined | 989 | 1.01 |
| Separate | 764 | 1.31 |

On 23 books:

| Mode | ops/s |
|------|------:|
| Joined | 272,824 |
| Separate | 250,692 |

Joined mode (the default) is 1.3x faster on 10K contacts and 1.1x faster on books. Choose between the modes for their matching semantics, not for speed.

---

## includeMatches Overhead

10K contacts, `"nath fe"`, fuzziness: 0.

### Joined Mode

| includeMatches | ops/s | mean (ms) |
|----------------|------:|----------:|
| false | 952 | 1.05 |
| true | 969 | 1.03 |

### Separate Mode

| includeMatches | ops/s | mean (ms) |
|----------------|------:|----------:|
| false | 703 | 1.42 |
| true | 707 | 1.42 |

**No measurable overhead in either mode.** The differences are within noise, and in this run `includeMatches: true` was marginally faster both times.

---

## Limit Optimization: Built-in `limit` vs `.slice()`

10K contacts, query `"na"`, joined mode, fuzziness: 0.

| Approach | ops/s | mean (ms) |
|----------|------:|----------:|
| `.slice(0, 10)` | 708 | 1.41 |
| `limit: 10` | 728 | 1.37 |

**Effectively identical** (1.03x). The built-in `limit` uses an O(n log k) heap, which matches `.slice()` performance on small limits. The benefit of `limit` is that it avoids allocating the full sorted array.

---

## Multi-Word Query Performance (Separate Mode)

10K contacts, separate mode. Compares strict vs fuzzy and single-word vs multi-word.

| Query | Fuzziness | ops/s | mean (ms) |
|-------|----------:|------:|----------:|
| `"nath"` (1 word) | 0.2 | 357 | 2.80 |
| `"nath fe"` (2 words) | 0.2 | 274 | 3.66 |
| `"natasha okeefe"` (2 words, long) | 0.2 | 212 | 4.72 |
| `"nath fe"` (2 words) | 0 | 704 | 1.42 |

Key observations:
- **Fuzziness costs ~2.6x**: strict `"nath fe"` runs at 704 ops/s and fuzzy `"nath fe"` at 274 ops/s.
- **Multi-word costs ~1.3x** vs single-word at the same fuzziness (357 -> 274 ops/s).
- **Longer queries cost more**: `"natasha okeefe"` runs at 212 ops/s and `"nath fe"` at 274 ops/s, because longer strings need more character comparisons.

---

## Nested Object and Array Performance

seaq natively traverses nested properties (`company.name`) and arrays (`emails.address`). Other libraries require pre-flattening the data.

### Nested Property Search: `company.name` (search-only, index pre-built)

| Library | 1K contacts (ops/s) | 5K contacts (ops/s) |
|---------|--------------------:|--------------------:|
| MiniSearch (pre-flattened) | 28,203 | 5,702 |
| seaq (native nested) | 6,999 | 1,435 |
| Fuse.js (native nested) | 359 | 68 |

MiniSearch is 4x faster when the data is already flattened and indexed.

### Array Field Search: `emails.address` (search-only, index pre-built)

| Library | 1K contacts (ops/s) | 5K contacts (ops/s) |
|---------|--------------------:|--------------------:|
| seaq (native array traversal) | 4,941 | 997 |
| MiniSearch (pre-flattened) | 3,625 | 617 |
| Fuse.js (native array) | 317 | 60 |

seaq is faster than pre-indexed MiniSearch on array fields: 1.4x at 1K and 1.6x at 5K. Both are 15x+ faster than Fuse.js.

### Deep Nested: `addresses.city` (1K contacts, cold start for Fuse.js)

| Library | ops/s |
|---------|------:|
| MiniSearch (pre-flattened) | 7,374 |
| seaq (native) | 4,339 |
| Fuse.js (native) | 339 |

### Cold Start with Nested Data (includes flattening + index build)

| Library | 1K contacts (ops/s) | 5K contacts (ops/s) |
|---------|--------------------:|--------------------:|
| **seaq (no prep needed)** | **4,015** | **818** |
| MiniSearch (flatten + index) | 387 | 68 |
| Fuse.js (index build) | 291 | 57 |

**seaq is 10-12x faster than MiniSearch and 14x faster than Fuse.js** on cold start with nested data. There is no flattening step and no index build.

### Multi-Field Nested Search (1K contacts)

Searching across `name`, `company.name`, and `addresses.city` with query `"John Acme"`:

| Library | ops/s | mean (ms) |
|---------|------:|----------:|
| seaq | 3,026 | 0.33 |
| Fuse.js | 128 | 7.79 |

seaq is 24x faster than Fuse.js on multi-field nested search.

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
2. **Cold start** = index build (if any) + search, measured per iteration.
3. **Search only** = index pre-built outside the benchmark loop, measures pure search throughput.
4. **Single search** benchmarks for Fuse.js, MiniSearch, and Lunr include index construction inside each iteration (cold-start behavior). seaq and uFuzzy have no index. fuzzysort caches prepared targets across calls, so its cold benchmarks call `fuzzysort.cleanup()` first.
5. **Result counts differ.** Each library runs with its own defaults, so a faster time can mean less work: fuzzysort's 0.5 default threshold returns nothing for several benchmark queries. See `quality.test.ts`, `quality-metrics.test.ts` and `acronym-quality.test.ts` for result-quality comparisons.
6. Numbers will vary by machine. Relative comparisons are more meaningful than absolute ops/s.
