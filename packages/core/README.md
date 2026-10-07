# seaq

Zero-dependency fuzzy search. One function, no setup, no index to manage.

```typescript
import { seaq } from 'seaq';

const results = seaq(contacts, 'john', { keys: ['name', 'email'] });
```

Works the same whether your list has 20 items or 20,000 -- no refactoring needed. Search the same list again and seaq indexes it for you.

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
// => [{ name: 'John Smith', ... }, { name: 'Jane Doe', ... }]  (John ranked first)
```

### Shorthand, swapped letters, word order and typos

seaq is built for what people actually type into a search box:

```typescript
const people = [
  { firstName: 'Stephen', lastName: 'Laughton' },
  { firstName: 'Steve', lastName: 'Lawson' },
];
const keys = ['firstName', 'lastName'];

seaq(people, 'steplau', { keys });        // shorthand: word prefixes typed together
seaq(people, 'laguht', { keys });         // adjacent letters swapped
seaq(people, 'laughton steph', { keys }); // words in any order
seaq(people, 'stephin', { keys });        // a typo: "i" isn't in "Stephen"
// => Stephen Laughton ranks first for each
```

Shorthand, acronyms, adjacent swaps and word order work at every `fuzziness`; each swap or a reversed word order costs a little score. Typos -- characters that aren't in the item at all -- need `fuzziness` above 0. The default `0.2` allows them at a lower score; `fuzziness: 0` rejects them.

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

Characters that start a word score extra, so acronyms and initials find what they stand for. Capitals you type also earn a small bonus where the item has the same capital:

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
//   score: 0.94,
//   matches: [
//     { key: 'firstName', value: 'John',  indices: [[0, 3]], score: 0.94 },
//     { key: 'lastName',  value: 'Smith', indices: [[0, 4]], score: 0.94 },
//   ],
// }]
```

Match positions are only computed for the final (post-limit) results, so `includeMatches` adds near-zero cost to the scoring phase.

### Repeated searches (typeahead)

You don't set anything up for a search box. The first search of an array just scans it. The second search of the same array builds an index, and later searches reuse it:

- **Only promising items get scored.** The index records which letters each item contains. Strict searches (`fuzziness: 0`) only score items that contain every letter in the query. Fuzzy searches skip items whose missing letters cap their score below what's already in the top results.
- **Typing gets cheaper.** In strict mode, when the query extends the previous one ("nat" → "nata"), only the previous matches are re-checked.
- **Results are identical** to a search without the index.

On 10K contacts, a default search for `"nath fe"` takes 2.6 ms without the index and 0.38 ms with it; with `fuzziness: 0` it takes 13 µs. Building the index costs about as much as one search without it. It uses about 0.5 MB of memory per 10K contacts.

The index is keyed on the array in a `WeakMap`, so it's garbage-collected with the list. Adding, removing or replacing items is detected automatically. **Mutating an item in place is not detected** once the array is indexed: replace the object (`list[i] = { ...item, name }`), or pass `cache: false`. A new array each render (e.g. `items.filter(...)`) is a new list, so it's scanned like any first search.

Control it with the `cache` option:

```typescript
seaq(list, query, { cache: true });  // index on the first search
seaq(list, query, { cache: false }); // never index; always re-read the items
```

In `fieldMode: 'separate'` there is no index; `cache: true` caches prepared strings per item instead, and by default nothing is cached.

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
| `fuzziness` | `number` | `0.2` | Tolerance for characters that aren't in the item at all, from 0 to 1 (clamped). `0.2` = light typo tolerance: missing characters are allowed and scored lower. `0` = every query character must exist (fastest). `0.5` = moderate. `0.8`+ = very loose. Shorthand (`steplau`), acronyms, adjacent swaps (`laguht`) and any word order match at every setting. |
| `fieldMode` | `'joined' \| 'separate'` | `'joined'` | `'joined'` concatenates all field values into one string before scoring -- supports cross-field queries like "john smith" matching firstName + lastName. `'separate'` scores each field independently and takes the best. Ignored for plain string arrays. |
| `limit` | `number` | `10` | Maximum results to return. Uses a min-heap internally for O(n log k) selection, faster than full-sorting then slicing. Set to `Infinity` to return all matches; `0` or negative returns `[]`. |
| `threshold` | `number` | `0.3` | Relative score cutoff. Results scoring below `topScore * threshold` are dropped. `0` = no filtering (return everything with score > 0). `1` = only near-perfect matches. Note: higher = stricter -- the opposite polarity of Fuse.js's `threshold`. |
| `includeMatches` | `boolean` | `false` | When `true`, returns `SeaqResult<T>` objects with per-field match metadata (character positions, matched value, per-match score) instead of plain items. |
| `cache` | `boolean` | -- | Unset: an array is indexed on its second search. `true`: indexed on the first search. `false`: never indexed. Results are identical either way. Items mutated in place aren't detected once indexed -- replace them instead. See [Repeated searches](#repeated-searches-typeahead). |

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
| Index | automatic | optional | required | required | no | required |
| Zero dependencies | yes | yes | yes | yes | yes | yes |

## When to use seaq

**seaq is a good fit when:**

- You want zero setup -- no constructor, no addAll, no index step; one function call
- Users type shorthand, initials, swapped letters or small typos
- Your list is dynamic -- data changes each render, so index-based libs waste time rebuilding
- You need to search nested objects or arrays without manual flattening
- Acronym matching matters (e.g., "NYC" matching "New York City")
- Your list size is unpredictable -- works from 20 items to 20,000 without API changes

**Consider alternatives when:**

- You repeatedly search a large static dataset and need the most throughput -- MiniSearch and Lunr use inverted indexes that answer word queries in microseconds. seaq's automatic index closes much of the gap, but an inverted index still wins on raw repeated-query speed
- You only search flat string arrays and need maximum throughput -- uFuzzy is purpose-built for this
- You never need typo tolerance and want the fastest search while the user types -- fuzzysort only matches characters in order, and its `snapshot()` re-checks only the previous matches on each keystroke
- You need features like stemming, stopwords, or boolean queries -- Lunr and MiniSearch have full-text search capabilities that seaq does not

For benchmark methodology and detailed performance numbers, see [BENCHMARKS.md](https://github.com/billie-coop/seaq/blob/main/BENCHMARKS.md).

## License

MIT
