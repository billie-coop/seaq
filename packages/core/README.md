# seaq

Zero-dependency fuzzy search. One function, no index, no setup.

```typescript
import { seaq } from 'seaq';

const results = seaq(contacts, 'john', { keys: ['name', 'email'] });
```

Works the same whether your list has 20 items or 20,000 -- no refactoring needed.

**[Docs & live playground →](https://billie-coop.github.io/seaq/)** Try seaq on your own JSON and compare it side by side with fuzzysort, Fuse.js, MiniSearch, uFuzzy, and Lunr.

## Install

```bash
npm install seaq
```

## Usage

### Search objects by key

```typescript
const contacts = [
  { name: 'John Smith', email: 'john@example.com' },
  { name: 'Jane Doe', email: 'jane@test.com' },
];

seaq(contacts, 'jo', { keys: ['name', 'email'] });
// => [{ name: 'John Smith', ... }]
```

### Nested objects (dot notation)

```typescript
const users = [
  { name: 'Alice', address: { city: 'New York' } },
  { name: 'Bob', address: { city: 'Los Angeles' } },
];

seaq(users, 'new york', { keys: ['address.city'] });
```

### Array traversal

Dot notation walks into arrays automatically. Given `emails` is an array of objects, `'emails.address'` searches every element:

```typescript
const people = [
  { name: 'Charlie', emails: [{ address: 'charlie@work.com' }, { address: 'charlie@home.com' }] },
];

seaq(people, 'work.com', { keys: ['emails.address'] });
```

### Plain string arrays

No `keys` needed when searching strings directly:

```typescript
seaq(['apple', 'banana', 'orange'], 'app');
// => ['apple']
```

### Acronym matching

seaq gives bonus score to acronym matches -- useful for searching names, locations, and abbreviations:

```typescript
seaq(['Hillsdale Michigan', 'Historical Museum'], 'HiMi');
// => ['Hillsdale Michigan', 'Historical Museum']  (Hillsdale ranked first)
```

### Cross-field matching

The default `joined` field mode concatenates field values before scoring, so queries can span fields:

```typescript
seaq(contacts, 'john smith', { keys: ['firstName', 'lastName'] });
// Matches even though "john" is in firstName and "smith" is in lastName
```

### Match highlighting

Set `includeMatches: true` to get character-level match positions for building highlighted search results. Matches are reported per field in both field modes -- each entry names the `key` that matched and gives `indices` relative to that field's value:

```typescript
const results = seaq(contacts, 'john smith', {
  keys: ['firstName', 'lastName'],
  includeMatches: true,
});
// => [{
//   item: { firstName: 'John', lastName: 'Smith', ... },
//   score: 0.93,
//   matches: [
//     { key: 'firstName', value: 'John',  indices: [[0, 3]], score: 0.93 },
//     { key: 'lastName',  value: 'Smith', indices: [[0, 4]], score: 0.93 },
//   ],
// }]
```

Match positions are only computed for the final (post-limit) results, so `includeMatches` adds near-zero cost to the scoring phase.

### Repeated searches (typeahead)

By default every call re-reads the list from scratch -- that's what makes seaq great for dynamic data. If the same list is searched repeatedly (typing in a search box over a static list), set `cache: true`:

```typescript
seaq(contacts, query, { keys: ['name', 'email'], cache: true });
```

With `cache: true`, seaq builds an index for the list on the first search and reuses it on later calls with the same array:

- **Only promising items get scored.** The index records which letters each item contains. Strict searches (`fuzziness: 0`) only score items that contain every letter in the query. Fuzzy searches skip items whose missing letters cap their score below what's already in the top results.
- **Typing gets cheaper.** In strict mode, when the query extends the previous one ("nat" → "nata"), only the previous matches are re-checked.
- **Results are identical** to an uncached search.

On 10K contacts this makes a default search about 8x faster (1.7 ms → 0.2 ms) and a strict search about 20x faster (1.1 ms → 0.05 ms). The first search on a list costs about the same as an uncached search.

The index is keyed on the array in a `WeakMap`, so it's garbage-collected with the list. Adding, removing or replacing items is detected automatically. Mutating an item in place is not: replace the object instead. Building a new array each render (e.g. `items.filter(...)`) means a new index each time, which costs about as much as an uncached search. In `fieldMode: 'separate'`, the cache stores prepared strings per item instead of using the list index.

## API

```typescript
seaq<T>(list: T[], query: string, options?: SeaqOptions<T>): T[]
seaq<T>(list: T[], query: string, options: SeaqOptions<T> & { includeMatches: true }): SeaqResult<T>[]
```

Returns a new array of matching items sorted by relevance (highest score first). The original array is never mutated. An empty query returns `[]`.

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `keys` | `string[]` | -- | Fields to search. Supports dot notation for nested properties (`'address.city'`) and automatic array traversal (`'emails.address'`). Omit when searching a plain `string[]`; without `keys`, non-string items are matched against their JSON representation. |
| `fuzziness` | `number` | `0.2` | Typo tolerance from 0 to 1 (clamped). `0` = strict (every character must match). `0.2` = light tolerance. `0.5` = moderate. `0.8`+ = very loose. |
| `fieldMode` | `'joined' \| 'separate'` | `'joined'` | `'joined'` concatenates all field values into one string before scoring -- supports cross-field queries like "john smith" matching firstName + lastName. `'separate'` scores each field independently and takes the best. Ignored for plain string arrays. |
| `limit` | `number` | `10` | Maximum results to return. Uses a min-heap internally for O(n log k) selection, faster than full-sorting then slicing. Set to `Infinity` to return all matches; `0` or negative returns `[]`. |
| `threshold` | `number` | `0.3` | Relative score cutoff. Results scoring below `topScore * threshold` are dropped. `0` = no filtering (return everything with score > 0). `1` = only near-perfect matches. Note: higher = stricter -- the opposite polarity of Fuse.js's `threshold`. |
| `includeMatches` | `boolean` | `false` | When `true`, returns `SeaqResult<T>` objects with per-field match metadata (character positions, matched value, per-match score) instead of plain items. |
| `cache` | `boolean` | `false` | When `true`, builds a search index for the list on first use and reuses it while the same array is searched again -- much faster repeated searches with identical results. Items must not be mutated in place (replace them instead). See [Repeated searches](#repeated-searches-typeahead). |

### Types

```typescript
interface SeaqResult<T> {
  item: T;
  score: number;
  matches: SeaqMatch[];
}

interface SeaqMatch {
  key?: string;      // Field key (set in both field modes; undefined for plain string/number items)
  value: string;     // The field value that was scored; indices are relative to it
  indices: [number, number][];  // Highlight ranges as [start, end] pairs (inclusive)
  score: number;     // Per-field score in separate mode; the overall item score in joined mode
}
```

## Feature comparison

| Feature | seaq | fuzzysort | fuse.js | minisearch | ufuzzy | lunr |
|---------|:----:|:---------:|:-------:|:----------:|:------:|:----:|
| Exact match | yes | yes | yes | yes | yes | yes |
| Fuzzy/typo tolerance | yes | no | yes | partial | yes | partial |
| Partial/prefix match | yes | yes | yes | yes | yes | yes |
| Acronym bonus | yes | yes | weak | no | no | no |
| Nested object access | yes | yes | yes | no | no | no |
| Array field traversal | **yes** | via getter | partial | no | no | no |
| Cross-field matching | yes | yes | no | no | no | no |
| Match highlighting | yes | yes | yes | yes | yes | no |
| Pre-built index | no | optional | yes | yes | no | yes |
| Zero dependencies | yes | yes | yes | yes | yes | yes |

## When to use seaq

**seaq is a good fit when:**

- Your list is dynamic -- data changes each render, so index-based libs waste time rebuilding
- You need to search nested objects or arrays without manual flattening
- Acronym matching matters (e.g., "NYC" matching "New York City")
- You want zero setup -- no constructor, no addAll, no index step; one function call
- Cold-start performance matters -- seaq has no index overhead, so the first search is fast
- Your list size is unpredictable -- works from 20 items to 20,000 without API changes

**Consider alternatives when:**

- You repeatedly search a large static dataset (10K+ items) -- MiniSearch and Lunr amortize their index cost across many searches and will be significantly faster after the first query (`cache: true` closes part of this gap, but an inverted index still wins on raw repeated-query throughput)
- You only search flat string arrays and need maximum throughput -- uFuzzy is purpose-built for this
- You never need typo tolerance and want the fastest repeated search -- fuzzysort matches in-order characters only, but its `snapshot()` is much faster than re-scanning while the user types
- You need features like stemming, stopwords, or boolean queries -- Lunr and MiniSearch have full-text search capabilities that seaq does not

For benchmark methodology and detailed performance numbers, see [BENCHMARKS.md](https://github.com/billie-coop/seaq/blob/main/BENCHMARKS.md).

## License

MIT
