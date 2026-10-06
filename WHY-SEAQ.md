# Why seaq

seaq is a fuzzy search function. One function call, zero dependencies, no index to build.

This document is grounded in real benchmark numbers from
[`test/perf/why-seaq.test.ts`](packages/core/test/perf/why-seaq.test.ts),
tested against fuzzysort, Fuse.js, MiniSearch, uFuzzy, and Lunr. All timings are medians
of 80 runs after a 20-run warmup. You can reproduce them yourself:

```
yarn workspace seaq vitest run test/perf/why-seaq.test.ts
```

The thesis: **seaq is competitive at any scale without an index. Your data can
grow from 20 items to 20K and you change nothing.**

---

## 1. Small lists

Command palettes, file pickers, autocomplete dropdowns. Under 50 items, there
is nothing to index -- the overhead of building one is pure waste.

### Command palette: 20 menu items

| Library    | Time  | vs best |
|------------|------:|--------:|
| seaq       |  7 us |    1.0x |
| fuzzysort  |  8 us |    1.2x |
| uFuzzy     | 12 us |    1.8x |
| MiniSearch | 27 us |    4.1x |
| Fuse.js    | 31 us |    4.7x |

### File picker: "btn" across 21 file paths

| Library    | Time  | vs best | Found `Button.tsx`? |
|------------|------:|--------:|:-------------------:|
| seaq       |  2 us |    1.0x | Yes                 |
| fuzzysort  |  4 us |    2.4x | No                  |
| uFuzzy     |  7 us |    3.8x | No                  |
| Fuse.js    | 14 us |    7.7x | No                  |
| MiniSearch | 25 us |   13.4x | No                  |

seaq is the fastest library on small lists, with fuzzysort close behind. seaq is
also the only library that matched "btn" to `Button.tsx`. fuzzysort finds it as
a subsequence, but the score falls below its default 0.5 threshold.

---

## 2. Acronym matching

Search a list of 12 tech terms (like "Application Programming Interface") using
their acronyms (like "API").

| Query | seaq | fuzzysort | Fuse.js | MiniSearch | uFuzzy |
|-------|:----:|:---------:|:-------:|:----------:|:------:|
| API   |  OK  |    OK     |   OK    |     --     |   --   |
| CLI   |  OK  |    OK     |   --    |     --     |   --   |
| IDE   |  --  |    OK     |   --    |     --     |   --   |
| TDD   |  OK  |    OK     |   OK    |     --     |   --   |
| SEO   |  OK  |    OK     |   --    |     --     |   --   |
| SPA   |  OK  |    OK     |   --    |     --     |   --   |

**fuzzysort: 6/6. seaq: 5/6. Fuse.js: 2/6. MiniSearch: 0/6. uFuzzy: 0/6.**

seaq's `string_score` algorithm gives explicit bonuses when query characters
match the first letter of each word. fuzzysort scores word-start matches the
same way and ranks all six correctly. On the larger 14-query acronym suite in
`acronym-quality.test.ts`, both find 14/14: seaq ranks all 14 first and
fuzzysort ranks 13 first. Fuse.js, MiniSearch and uFuzzy do not model acronyms.

---

## 3. Cold start on big data

Data just arrived from an API. No time to build an index. You need results now.

### 10K contacts, searching "nath"

| Library    |   Time  | vs best |
|------------|--------:|--------:|
| uFuzzy     |  328 us |    1.0x |
| fuzzysort  |  584 us |    1.8x |
| seaq       | 1.75 ms |    5.3x |
| MiniSearch | 10.0 ms |   30.6x |
| Fuse.js    | 14.8 ms |   45.0x |
| Lunr       | 64.2 ms |  195.8x |

### 20K cities, searching "san"

| Library    |    Time  | vs best |
|------------|--------: |--------:|
| uFuzzy     |   928 us |    1.0x |
| seaq       |  3.44 ms |    3.7x |
| fuzzysort  |  7.64 ms |    8.2x |
| Fuse.js    | 17.1 ms  |   18.5x |
| MiniSearch | 30.9 ms  |   33.2x |
| Lunr       |  161 ms  |  173.8x |

uFuzzy is fastest here because it only searches flat string arrays. seaq and
fuzzysort trade places: fuzzysort is 3x faster on 10K short names, and seaq is
2.2x faster on 20K cities. Both are 5-47x faster than Fuse.js, MiniSearch, and
Lunr, which pay to build an index they will never reuse. (fuzzysort's
prepared-target cache is cleared before each run so it starts cold too.)

---

## 4. Scaling without refactoring

The same `seaq()` call, the same options, the same code. Just more data.

```js
seaq(cities, "san", { keys: ["name", "state"] })
```

| Size       |   Time   | Results |
|------------|----------|--------:|
| 20 cities  |     3 us |       1 |
| 200 cities |    29 us |      10 |
| 2K cities  |   293 us |      10 |
| 20K cities |  3.29 ms |      10 |

No index to build, rebuild, or invalidate. Your list grew 1000x and you changed
zero lines of code. With indexed libraries, going from 20 to 20K items means
adding constructor setup, `addAll()` calls, rebuild logic, and teardown.

---

## 5. Nested objects

A CRM contact has `company.name` and `emails.address` nested inside it. Search
for "acme" across both fields:

```js
// seaq -- 1 line
seaq(contacts, "acme", { keys: ["company.name", "emails.address"] })

// fuzzysort -- dot paths work, arrays need a getter
fuzzysort.go("acme", contacts, {
  keys: ["company.name", c => c.emails.map(e => e.address).join(" ")],
})

// MiniSearch -- must flatten first
const flat = contacts.map((c, id) => ({
  id,
  companyName: c.company.name,
  emails: c.emails.map(e => e.address).join(" "),
}));
const ms = new MiniSearch({ fields: ["companyName", "emails"] });
ms.addAll(flat);
ms.search("acme");

// uFuzzy -- must build a string haystack
const hay = contacts.map(c =>
  `${c.company.name} ${c.emails.map(e => e.address).join(" ")}`
);
new uFuzzy().search(hay, "acme");
```

seaq traverses dot-notation paths and arrays natively. No flattening, no string
concatenation, no data transformation step.

---

## 6. Dynamic data

When data changes between searches -- live feeds, paginated API results, data
that changes every render -- indexed libraries rebuild their index every time.
That index cost is wasted.

### 500 items, dataset alternates each search

| Library    |  Time  | vs best |
|------------|-------:|--------:|
| uFuzzy     |  46 us |    1.0x |
| fuzzysort  |  58 us |    1.3x |
| seaq       |  88 us |    1.9x |
| MiniSearch | 378 us |    8.3x |
| Fuse.js    | 715 us |   15.6x |

seaq has no index. Its speed does not change whether the data is the same as
last time or completely different.

---

## 7. The tradeoff

When data is large, static, and searched repeatedly, pre-indexed libraries win.
This is where seaq is weakest. Here are the honest numbers.

### Single search on pre-indexed 10K contacts

| Library    |   Time  | vs best |
|------------|--------:|--------:|
| MiniSearch |   32 us |    1.0x |
| fuzzysort  |   71 us |    2.2x |
| Lunr       |   72 us |    2.3x |
| uFuzzy     |  267 us |    8.4x |
| seaq       | 1.74 ms |   54.4x |
| Fuse.js    | 11.6 ms |  361.4x |

fuzzysort's index is an immutable `fuzzysort.snapshot()`.

### Simulated typing: 7 keystrokes on 10K pre-indexed contacts

| Library    | Total   | Per keystroke |
|------------|--------:|--------------:|
| MiniSearch |  249 us |        36 us  |
| fuzzysort  |  428 us |        61 us  |
| Lunr       | 1.15 ms |       165 us  |
| uFuzzy     | 2.23 ms |       318 us  |
| seaq       | 12.3 ms |      1.75 ms  |
| Fuse.js    | 87.2 ms |      12.5 ms  |

MiniSearch is 54x faster than seaq when it can reuse its index, and fuzzysort
is 29x faster. Those gaps are real.

But look at seaq's absolute time: **1.75 ms per keystroke**. That is well under
the 16 ms frame budget for 60fps UI. The user will not notice. seaq is slower
in relative terms, but fast enough in absolute terms for any interactive use
case.

The question is not "which is fastest?" It is "do I need to manage an index for
this?"

---

## 8. v1 to v2

seaq v2 has a faster engine and sensible defaults instead of a firehose of
garbage.

### Engine comparison (fuzziness 0, apples-to-apples)

| Query      | v1 time  | v2 time  | Speedup |
|------------|----------|----------|--------:|
| "san"      | 3.86 ms  | 2.38 ms  |    1.6x |
| "new york" | 3.89 ms  | 1.86 ms  |    2.1x |
| "los ang"  | 3.68 ms  | 1.79 ms  |    2.1x |

The core scoring engine is 1.6-2.1x faster through pre-lowered targets, bitmask
pre-filtering, and a quadratic miss penalty.

### The real v2 win: limit + threshold

| Query  | v1 time  | v1 results | v2 time  | v2 results |
|--------|----------|------------|----------|------------|
| "san"  | 4.00 ms  |      1,894 | 2.13 ms  |         10 |
| "na"   | 4.41 ms  |      4,808 | 2.29 ms  |         10 |

v1 scored and sorted every item, then you called `.slice(0, 10)` to get the top
results. A query like "nath" on 10K contacts returned 9,756 results -- 97.5%
garbage.

v2 defaults to `{ limit: 10, threshold: 0.3 }`. The threshold drops results
scoring below 30% of the best match. The heap keeps only the top N without a
full sort. You get 10 good results instead of 9,756 bad ones, and it is about
1.9x faster too.

---

## When to use seaq

**Use seaq when:**

- You do not want to manage an index
- Data is dynamic -- changes each render, arrives from an API
- List size is unpredictable (20 today, 20K tomorrow)
- You need nested object or array traversal
- You need acronym matching (NYC -> New York City)
- You want 1 function call, 0 setup, 0 dependencies

**Consider fuzzysort when:**

- You search short strings (file names, commands, names) and never need typo
  tolerance -- it only matches characters in order, so "jonh" won't find "John"
- Data is static enough to `snapshot()` once and you want the fastest typing

**Consider MiniSearch or Lunr when:**

- Data is large AND static AND searched repeatedly
- You need full-text features (stemming, stop words, field boosting)

**The mental model:** seaq is `Array.filter()` with smart fuzzy scoring. It does
not need an index. It does not care how big your list is. It just scans and
scores -- fast enough for any UI.
