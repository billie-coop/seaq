# Why seaq

seaq is a fuzzy search function. One function call, zero dependencies, no index
to manage.

This document is grounded in real benchmark numbers from
[`test/perf/why-seaq.test.ts`](packages/core/test/perf/why-seaq.test.ts),
tested against fuzzysort, Fuse.js, MiniSearch, uFuzzy, and Lunr. All timings are medians
of 80 runs after a 20-run warmup. You can reproduce them yourself:

```
yarn workspace seaq vitest run test/perf/why-seaq.test.ts
```

The thesis: **seaq is competitive at any scale with zero setup. Your data can
grow from 20 items to 20K and you change nothing.** One-off searches scan the
list; a list you search again gets an index automatically.

---

## 1. Small lists

Command palettes, file pickers, autocomplete dropdowns. Under 50 items, every
library answers in microseconds.

### Command palette: 20 menu items

| Library    | Time  | vs best |
|------------|------:|--------:|
| fuzzysort  |  9 us |    1.0x |
| seaq       | 12 us |    1.3x |
| uFuzzy     | 12 us |    1.4x |
| MiniSearch | 27 us |    3.1x |
| Fuse.js    | 32 us |    3.6x |

### File picker: "btn" across 21 file paths

| Library    | Time  | vs best | Found `Button.tsx`? |
|------------|------:|--------:|:-------------------:|
| seaq       |  3 us |    1.0x | Yes                 |
| fuzzysort  |  5 us |    1.8x | No                  |
| uFuzzy     |  7 us |    2.8x | No                  |
| Fuse.js    | 16 us |    6.4x | No                  |
| MiniSearch | 25 us |   10.0x | No                  |

On lists this small every library answers in microseconds: fuzzysort is fastest
on the command palette, and seaq on the file picker. seaq is the only library
that matched "btn" to `Button.tsx`. fuzzysort finds it
as a subsequence, but the score falls below its default 0.5 threshold.

---

## 2. Acronym matching

Search a list of 12 tech terms (like "Application Programming Interface") using
their acronyms (like "API").

| Query | seaq | fuzzysort | Fuse.js | MiniSearch | uFuzzy |
|-------|:----:|:---------:|:-------:|:----------:|:------:|
| API   |  OK  |    OK     |   OK    |     --     |   --   |
| CLI   |  OK  |    OK     |   --    |     --     |   --   |
| IDE   |  OK  |    OK     |   --    |     --     |   --   |
| TDD   |  OK  |    OK     |   OK    |     --     |   --   |
| SEO   |  OK  |    OK     |   --    |     --     |   --   |
| SPA   |  OK  |    OK     |   --    |     --     |   --   |

**seaq: 6/6. fuzzysort: 6/6. Fuse.js: 2/6. MiniSearch: 0/6. uFuzzy: 0/6.**

seaq gives explicit bonuses when query characters match the first letter of
each word. When the earliest match for a letter is mid-word (the "d" at the end
of "Integrated"), seaq also tries jumping to the next word start ("Development")
and keeps the better score. fuzzysort scores word-start matches the same way.
On the larger 14-query acronym suite in `acronym-quality.test.ts`, both find
14/14: seaq ranks all 14 first and fuzzysort ranks 13 first. Fuse.js,
MiniSearch and uFuzzy do not model acronyms.

---

## 3. Cold start on big data

Data just arrived from an API. No time to build an index. You need results now.
seaq runs with `cache: false` here so every run is a true first search.

### 10K contacts, searching "nath"

| Library    |   Time  | vs best |
|------------|--------:|--------:|
| uFuzzy     |  315 us |    1.0x |
| fuzzysort  |  632 us |    2.0x |
| seaq       | 2.17 ms |    6.9x |
| MiniSearch | 10.8 ms |   34.3x |
| Fuse.js    | 16.1 ms |   51.1x |
| Lunr       | 69.6 ms |  221.0x |

### 20K cities, searching "san"

| Library    |    Time  | vs best |
|------------|--------: |--------:|
| uFuzzy     |   994 us |    1.0x |
| seaq       |  3.88 ms |    3.9x |
| fuzzysort  |  8.88 ms |    8.9x |
| Fuse.js    | 19.4 ms  |   19.5x |
| MiniSearch | 31.6 ms  |   31.8x |
| Lunr       |  198 ms  |  198.8x |

uFuzzy is fastest here because it only searches flat string arrays. seaq and
fuzzysort trade places: fuzzysort is 3.4x faster on 10K short names, and seaq is
2.3x faster on 20K cities. seaq is 5-51x faster than Fuse.js, MiniSearch, and
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
| 20 cities  |     4 us |       1 |
| 200 cities |    35 us |      10 |
| 2K cities  |   358 us |      10 |
| 20K cities |  4.36 ms |      10 |

These are first searches (`cache: false`). Searching the same list again builds
an index automatically, so there is still nothing to build, rebuild, or
invalidate. Your list grew 1000x and you changed zero lines of code. With
indexed libraries, going from 20 to 20K items means adding constructor setup,
`addAll()` calls, rebuild logic, and teardown.

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
| fuzzysort  |  62 us |    1.3x |
| seaq       |  97 us |    2.1x |
| MiniSearch | 423 us |    9.2x |
| Fuse.js    | 800 us |   17.5x |

seaq only indexes an array it has seen before, so new data is simply scanned.
Nothing is built that won't be reused.

---

## 7. The tradeoff

When data is large, static, and searched repeatedly, pre-indexed libraries win.
This is where seaq is weakest. Here are the honest numbers.

seaq builds its own index on a list's second search, so the `seaq` rows below
use it. `seaq no index` passes `cache: false` and scans every time.

### Single search on pre-indexed 10K contacts

| Library       |   Time  | vs best |
|---------------|--------:|--------:|
| MiniSearch    |   33 us |    1.0x |
| fuzzysort     |   72 us |    2.2x |
| Lunr          |   75 us |    2.3x |
| seaq          |  274 us |    8.4x |
| uFuzzy        |  294 us |    9.0x |
| seaq no index | 2.22 ms |   68.2x |
| Fuse.js       | 12.5 ms |  384.9x |

fuzzysort's index is an immutable `fuzzysort.snapshot()`.

### Simulated typing: 7 keystrokes on 10K pre-indexed contacts

| Library       | Total   | Per keystroke |
|---------------|--------:|--------------:|
| MiniSearch    |  257 us |        37 us  |
| fuzzysort     |  418 us |        60 us  |
| Lunr          |  884 us |       126 us  |
| uFuzzy        | 2.29 ms |       327 us  |
| seaq          | 3.71 ms |       531 us  |
| seaq no index | 15.7 ms |      2.24 ms  |
| Fuse.js       | 93.4 ms |      13.3 ms  |

seaq's index makes repeated searches 4-8x faster than scanning, but MiniSearch
is still 8-14x faster than seaq when it can reuse its index, and fuzzysort is
3.8-8.9x faster. Those gaps are real. MiniSearch and Lunr look up whole words.
fuzzysort's snapshot only re-checks the previous matches when the query grows by
a keystroke; seaq does that only with `fuzziness: 0`, because a typo-tolerant
search can match items the previous query didn't.

But look at seaq's absolute time: **0.53 ms per keystroke**. That is well under
the 16 ms frame budget for 60fps UI. The user will not notice. seaq is slower
in relative terms, but fast enough in absolute terms for any interactive use
case.

The question is not "which is fastest?" It is "do I need to manage an index for
this?"

---

## 8. v1 to v2

seaq v2 has a faster engine, an automatic index, and sensible defaults instead
of a firehose of garbage.

### Engine comparison (fuzziness 0, no index)

| Query      | v1 time  | v1 results | v2 time  | v2 results | Speedup |
|------------|----------|-----------:|----------|-----------:|--------:|
| "san"      | 3.92 ms  |      1,894 | 3.27 ms  |      2,183 |    1.2x |
| "new york" | 4.18 ms  |          3 | 2.22 ms  |          4 |    1.9x |
| "los ang"  | 3.79 ms  |          5 | 2.21 ms  |         44 |    1.7x |

The core scoring engine is 1.2-1.9x faster through pre-lowered targets, bitmask
pre-filtering, and a quadratic miss penalty, while matching more: shorthand,
swapped letters, and words in any order, which is why "los ang" finds 44 cities
instead of 5. A short query like "san" gains the least, because v2 finds and
scores more matches for it.

### The real v2 win: limit + threshold

| Query  | v1 time  | v1 results | v2 time  | v2 results |
|--------|----------|-----------:|----------|-----------:|
| "san"  | 4.06 ms  |      1,894 | 2.77 ms  |         10 |
| "na"   | 4.73 ms  |      4,808 | 3.18 ms  |         10 |

v1 scored and sorted every item, then you called `.slice(0, 10)` to get the top
results. A query like "nath" on 10K contacts returned 9,756 results -- 97.5%
garbage.

v2 defaults to `{ limit: 10, threshold: 0.3 }`. The threshold drops results
scoring below 30% of the best match. The heap keeps only the top N without a
full sort. You get 10 good results instead of 9,756 bad ones, and it is about
1.5x faster too.

---

## When to use seaq

**Use seaq when:**

- You do not want to manage an index (seaq keeps its own)
- Data is dynamic -- changes each render, arrives from an API
- List size is unpredictable (20 today, 20K tomorrow)
- You need nested object or array traversal
- Users type shorthand, acronyms (NYC -> New York City), swapped letters or typos
- You want 1 function call, 0 setup, 0 dependencies

**Consider fuzzysort when:**

- You search short strings (file names, commands, names) and never need typo
  tolerance -- it only matches characters in order, so "jonh" won't find "John"
- Data is static enough to `snapshot()` once and you want the fastest typing

**Consider MiniSearch or Lunr when:**

- Data is large AND static AND searched repeatedly, and microseconds per
  keystroke matter
- You need full-text features (stemming, stop words, field boosting)

**The mental model:** seaq is `Array.filter()` with smart fuzzy scoring.
One-off searches just scan; a list you search again gets an index
automatically. Fast enough for any UI.
