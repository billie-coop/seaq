import { type Scored, scoreIndexed } from './listIndex';
import {
  charMask,
  lowercase,
  matchesStrict,
  planQuery,
  type QueryPlan,
  scoreString,
} from './score';

/**
 * Match metadata for a single scored field.
 */
export interface SeaqMatch {
  /**
   * Field key this match belongs to. Set in both `separate` and `joined`
   * modes; `undefined` when searching plain string/number arrays or keyless
   * objects.
   */
  key?: string;
  /** The field value that was scored. `indices` are relative to this string. */
  value: string;
  /** Highlight ranges as `[start, end]` pairs (inclusive). */
  indices: [number, number][];
  /**
   * Score for this specific match. In `separate` mode this is the per-field
   * score; in `joined` mode fields are scored together as one string, so each
   * match carries the overall item score.
   */
  score: number;
}

/**
 * A search result with match metadata, returned when `includeMatches: true`.
 */
export interface SeaqResult<T> {
  item: T;
  score: number;
  matches: SeaqMatch[];
}

/** Options for {@link seaq}. All are optional. */
export interface SeaqOptions<T> {
  /**
   * Object keys to search. Supports:
   * - Simple keys: `['name', 'email']`
   * - Dot notation for nested properties: `['address.city']`
   * - Automatic array traversal: `['tags.name']` walks into arrays at any level
   *
   * Omit when searching a plain `string[]`. Without `keys`, non-string items
   * are matched against their JSON representation (numbers against their
   * string form); `null` and `undefined` items never match.
   */
  keys?: Array<Extract<keyof T, string>> | string[];
  /**
   * Tolerance for characters that aren't in the item at all (typos like
   * "stephin" for "Stephen"), from 0 to 1. Values outside that range are
   * clamped. Shorthand ("steplau"), acronyms, adjacent swaps ("jonh" →
   * "john") and any word order match at every setting.
   *
   * - `0.2` (default) — light tolerance: missing characters allowed, scored lower
   * - `0` — every query character must be found. Fastest.
   * - `0.5` — moderate tolerance
   * - `0.8–1` — very loose, matches almost anything (rarely useful)
   */
  fuzziness?: number;
  /**
   * How multi-field scoring works when multiple `keys` are provided.
   * Ignored when searching a plain `string[]` (no `keys`).
   *
   * - `'joined'` (default) — concatenates all field values (space-separated)
   *   into one string before scoring. Supports cross-field queries like
   *   "john smith" matching firstName="John" + lastName="Smith", and
   *   concatenated prefixes like "helgre" matching "Helen Green".
   * - `'separate'` — scores each field value on its own and keeps the best.
   *   Different query words may still match different fields, but one word
   *   can't span two fields ("helgre" won't match "Helen" + "Green").
   */
  fieldMode?: 'joined' | 'separate';
  /**
   * Maximum number of results to return. Default: `10`.
   *
   * Selects the top results with a heap instead of sorting every match.
   * Set to `Infinity` to return all matches (not recommended for large lists).
   * `0` or a negative limit returns `[]`.
   */
  limit?: number;
  /**
   * Relative score cutoff — results below `topScore * threshold` are dropped.
   *
   * - `0.3` (default) — keeps results scoring at least 30% of the best match
   * - `0` — no filtering, returns everything with score > 0
   * - `1` — only results tied with the best score, however low it is
   *
   * Note: higher = stricter. This is the opposite polarity of Fuse.js's
   * `threshold`, where lower values are stricter.
   */
  threshold?: number;
  /**
   * When `true`, returns {@link SeaqResult} objects with match metadata
   * (character positions, matched value, score) instead of plain items.
   * Useful for building search-result highlighting.
   *
   * Matches are per field value in both field modes: each entry has `key`
   * set and `indices` relative to that field's `value`. Positions are only
   * worked out for the returned results.
   */
  includeMatches?: boolean;
  /**
   * Search index for repeated searches over the same array (typeahead).
   * Results are identical with or without it.
   *
   * - default — the second search of an array builds an index (keyed on the
   *   array via a `WeakMap`) that later searches reuse; one-off searches
   *   just scan
   * - `true` — build the index on the first search
   * - `false` — never index; every search re-reads the items
   *
   * Added, removed or
   * replaced items are detected; an item **mutated in place is not** —
   * replace the object, or pass `cache: false`.
   *
   * In `fieldMode: 'separate'` there is no index: `cache: true` caches
   * prepared strings per item (keyed on object identity) instead, and the
   * default is not to cache.
   */
  cache?: boolean;
}

/**
 * Fuzzy search an array of items, returning matches sorted by relevance.
 *
 * Items with a score of 0 (no match) are filtered out, as are `null` and
 * `undefined` entries. The remaining items are sorted highest-score-first
 * and returned as a new array (the original is never mutated).
 *
 * @param list - Array of objects or strings to search
 * @param query - Search query string. Empty string returns `[]`.
 * @param options - See {@link SeaqOptions} for full details on keys, fuzziness, fieldMode, and limit.
 * @returns Filtered and sorted array of matching items
 *
 * @example
 * // Search objects by specific keys (joined mode, light typo tolerance)
 * seaq(contacts, 'john', { keys: ['name', 'email'] })
 *
 * @example
 * // Search a plain string array (no keys needed)
 * seaq(['apple', 'banana'], 'app')
 */
export function seaq<T>(
  list: Array<T>,
  query: string,
  options: SeaqOptions<T> & { includeMatches: true },
): SeaqResult<T>[];
export function seaq<T>(list: Array<T>, query: string, options?: SeaqOptions<T>): Array<T>;
export function seaq<T>(
  list: Array<T>,
  query: string,
  options?: SeaqOptions<T>,
): Array<T> | SeaqResult<T>[] {
  const keys = options?.keys as string[] | undefined;
  const rawFuzziness = options?.fuzziness ?? 0.2;
  // Above 1, the miss penalty would turn into a bonus
  const fuzziness = rawFuzziness < 0 ? 0 : rawFuzziness > 1 ? 1 : rawFuzziness;
  const separate = keys !== undefined && options?.fieldMode === 'separate';
  const limit = options?.limit ?? 10;
  const threshold = options?.threshold ?? 0.3;
  const cache = options?.cache;

  if (!query.trim() || limit <= 0) return [];

  const plan = planQuery(query);
  const paths = keys?.map((key) => ({ key, path: key.split('.') }));
  const prep: (item: T) => string = paths
    ? (item) => buildJoinedString(item, paths)
    : keylessString;

  const { items: scored, maxScore } =
    paths && separate
      ? scoreSeparate(list, plan, paths, fuzziness, cache === true)
      : (cache ?? searchedBefore(list))
        ? scoreIndexed(list, plan, fuzziness, limit, threshold, JSON.stringify(keys) ?? '', prep)
        : scoreScan(list, plan, fuzziness, prep, paths !== undefined);

  const sorted = getTopN(scored, limit, maxScore * threshold);
  if (!options?.includeMatches) return sorted.map((m) => m.item);

  return sorted.map(({ item, score }) => ({
    item,
    score,
    matches: paths
      ? separate
        ? separateMatches(item, plan, paths, fuzziness)
        : joinedMatches(item, plan, paths, fuzziness, score)
      : [singleMatch(keylessString(item), plan, fuzziness, score)],
  }));
}

interface KeyPath {
  key: string;
  path: string[];
}

/** Arrays searched with the default `cache` setting; their second search builds an index. */
const searched = new WeakSet<object>();

function searchedBefore(list: object): boolean {
  if (searched.has(list)) return true;
  searched.add(list);
  return false;
}

/**
 * Joined mode or keyless, without an index. Strict searches with keys skip
 * items missing a query character class before scoring. Without keys,
 * objects are long JSON strings, and building their mask measured slower
 * than letting the scorer reject them.
 */
function scoreScan<T>(
  list: T[],
  plan: QueryPlan,
  fuzziness: number,
  prep: (item: T) => string,
  keyed: boolean,
): { items: Scored<T>[]; maxScore: number } {
  const gate = keyed && !fuzziness;
  const items: Scored<T>[] = [];
  let maxScore = 0;
  for (const item of list) {
    const str = prep(item);
    const lower = lowercase(str);
    if (gate && (plan.mask & ~charMask(lower)) !== 0) continue;
    const score = scoreString(plan, str, lower, -1, fuzziness);
    if (score > 0) {
      if (score > maxScore) maxScore = score;
      items.push({ item, score });
    }
  }
  return { items, maxScore };
}

/**
 * The search string of an item without keys: strings as they are, numbers
 * in their string form, other objects as JSON. `null` and `undefined` give
 * '', which never matches.
 */
function keylessString(item: unknown): string {
  if (typeof item === 'string') return item;
  if (item === null || item === undefined) return '';
  return typeof item === 'number' ? String(item) : JSON.stringify(item);
}

/**
 * The top `n` items scoring at least `cutoff`, best first. Ties keep list
 * order, as the stable sort does when everything fits, so the result doesn't
 * depend on which items passed through the heap.
 */
function getTopN<T>(items: Array<Scored<T>>, n: number, cutoff: number): Array<Scored<T>> {
  if (items.length <= n) {
    return items.filter((m) => m.score >= cutoff).sort((a, b) => b.score - a.score);
  }

  // Min-heap of positions in `items`, worst at the root: lower score is
  // worse, and on equal scores the later position is worse
  const heap: number[] = [];
  const score = (pos: number) => items[pos]!.score;
  const worse = (a: number, b: number) => {
    const sa = score(a);
    const sb = score(b);
    return sa < sb || (sa === sb && a > b);
  };

  for (let i = 0; i < items.length; i++) {
    const s = score(i);
    if (s < cutoff) continue;
    if (heap.length < n) {
      heapPush(heap, i, worse);
    } else if (s > score(heap[0]!)) {
      // Later positions only win on a strictly higher score
      heap[0] = i;
      heapifyDown(heap, worse);
    }
  }

  const result: Array<Scored<T>> = [];
  while (heap.length > 0) {
    result.push(items[heap[0]!]!);
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      heapifyDown(heap, worse);
    }
  }
  return result.reverse();
}

type Worse = (a: number, b: number) => boolean;

function heapPush(heap: number[], pos: number, worse: Worse): void {
  heap.push(pos);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (!worse(heap[i]!, heap[parent]!)) break;
    const tmp = heap[i]!;
    heap[i] = heap[parent]!;
    heap[parent] = tmp;
    i = parent;
  }
}

function heapifyDown(heap: number[], worse: Worse): void {
  const len = heap.length;
  let i = 0;
  while (true) {
    const left = 2 * i + 1;
    const right = 2 * i + 2;
    let smallest = i;

    if (left < len && worse(heap[left]!, heap[smallest]!)) smallest = left;
    if (right < len && worse(heap[right]!, heap[smallest]!)) smallest = right;
    if (smallest === i) break;

    const tmp = heap[i]!;
    heap[i] = heap[smallest]!;
    heap[smallest] = tmp;
    i = smallest;
  }
}

/** Only called for values that scored > 0, so some position is found. */
function singleMatch(
  value: string,
  plan: QueryPlan,
  fuzziness: number,
  score: number | null,
  key?: string,
): SeaqMatch {
  const positions: number[] = [];
  const s = scoreString(plan, value, lowercase(value), -1, fuzziness, positions);
  const match: SeaqMatch = { value, indices: positionsToRanges(positions), score: score ?? s };
  if (key !== undefined) match.key = key;
  return match;
}

/** Ascending, non-empty positions as inclusive [start, end] ranges. */
function positionsToRanges(positions: number[]): [number, number][] {
  const ranges: [number, number][] = [];
  let start = positions[0]!;
  let end = start;
  for (let i = 1; i < positions.length; i++) {
    const p = positions[i]!;
    if (p === end + 1) {
      end = p;
    } else {
      ranges.push([start, end]);
      start = p;
      end = p;
    }
  }
  ranges.push([start, end]);
  return ranges;
}

function buildJoinedString(item: unknown, paths: KeyPath[]): string {
  const acc: string[] = [];
  for (const { path } of paths) collectValues(item, path, 0, acc);
  return acc.join(' ');
}

/** Splits the joined string's positions per field value, dropping the separators. */
function joinedMatches(
  item: unknown,
  plan: QueryPlan,
  paths: KeyPath[],
  fuzziness: number,
  score: number,
): SeaqMatch[] {
  const values: string[] = [];
  const valueKeys: string[] = [];
  for (const { key, path } of paths) {
    const before = values.length;
    collectValues(item, path, 0, values);
    for (let i = before; i < values.length; i++) valueKeys.push(key);
  }
  const joined = values.join(' ');
  const positions: number[] = [];
  scoreString(plan, joined, lowercase(joined), -1, fuzziness, positions);

  const matches: SeaqMatch[] = [];
  let p = 0;
  let start = 0;
  for (let v = 0; v < values.length; v++) {
    const value = values[v]!;
    const end = start + value.length;
    const own: number[] = [];
    for (; p < positions.length && positions[p]! <= end; p++) {
      if (positions[p]! < end) own.push(positions[p]! - start);
    }
    if (own.length > 0) {
      matches.push({ key: valueKeys[v], value, indices: positionsToRanges(own), score });
    }
    start = end + 1;
  }
  return matches;
}

interface Field {
  key: string;
  values: string[];
  lowers: string[];
  masks: number[];
}

function prepareFields(item: unknown, paths: KeyPath[]): Field[] {
  const fields: Field[] = [];
  for (const { key, path } of paths) {
    const values = collectValues(item, path, 0, []);
    const lowers: string[] = [];
    const masks: number[] = [];
    for (const value of values) {
      const lower = lowercase(value);
      lowers.push(lower);
      masks.push(charMask(lower));
    }
    fields.push({ key, values, lowers, masks });
  }
  return fields;
}

/** Prepared fields cached per item (`cache: true`), then per keys. */
const fieldCache = new WeakMap<object, Map<string, Field[]>>();

function scoreSeparate<T>(
  list: T[],
  plan: QueryPlan,
  paths: KeyPath[],
  fuzziness: number,
  useCache: boolean,
): { items: Scored<T>[]; maxScore: number } {
  const wordPlans = plan.words.length > 1 ? plan.words.map(planQuery) : null;
  const signature = JSON.stringify(paths.map((p) => p.key));
  const items: Scored<T>[] = [];
  let maxScore = 0;

  for (const item of list) {
    if (item === null || item === undefined) continue;

    let fields: Field[] | undefined;
    let byKeys: Map<string, Field[]> | undefined;
    if (useCache && typeof item === 'object') {
      byKeys = fieldCache.get(item);
      if (!byKeys) {
        byKeys = new Map();
        fieldCache.set(item, byKeys);
      }
      fields = byKeys.get(signature);
    }
    if (!fields) {
      fields = prepareFields(item, paths);
      byKeys?.set(signature, fields);
    }

    const score = scoreFields(fields, plan, wordPlans, fuzziness, null);
    if (score > 0) {
      if (score > maxScore) maxScore = score;
      items.push({ item, score });
    }
  }
  return { items, maxScore };
}

function separateMatches(
  item: unknown,
  plan: QueryPlan,
  paths: KeyPath[],
  fuzziness: number,
): SeaqMatch[] {
  const wordPlans = plan.words.length > 1 ? plan.words.map(planQuery) : null;
  const matches: SeaqMatch[] = [];
  scoreFields(prepareFields(item, paths), plan, wordPlans, fuzziness, matches);
  return matches;
}

/**
 * Score one item's fields in separate mode: the best score of the whole
 * query against any one value, or for multi-word queries the average of
 * each word's best value score when that's higher ("john smith" across
 * firstName and lastName). With `matches` (only for results), the winning
 * values are added with highlight positions.
 */
function scoreFields(
  fields: Field[],
  plan: QueryPlan,
  wordPlans: QueryPlan[] | null,
  fuzziness: number,
  matches: SeaqMatch[] | null,
): number {
  let whole = 0;
  let wholeField = 0;
  let wholeValue = 0;
  for (let fi = 0; fi < fields.length; fi++) {
    const { values, lowers, masks } = fields[fi]!;
    for (let vi = 0; vi < values.length; vi++) {
      const mask = masks[vi]!;
      // Bitmask gate. Strict: a query class is missing. Fuzzy: no overlap.
      if (fuzziness ? (plan.mask & mask) === 0 : (plan.mask & ~mask) !== 0) continue;
      const s = scoreString(plan, values[vi]!, lowers[vi]!, -1, fuzziness);
      if (s > whole) {
        whole = s;
        wholeField = fi;
        wholeValue = vi;
      }
    }
  }

  // Each word against each value, keeping each word's best, when every word
  // matches some value strictly
  if (wordPlans !== null && whole < 1 && everyWordMatches(fields, wordPlans)) {
    const n = wordPlans.length;
    // [field, value] of each word's best, for highlights
    const wins: number[] | null = matches ? [] : null;
    let sum = 0;
    let w = 0;
    for (; w < n; w++) {
      const wp = wordPlans[w]!;
      let best = 0;
      for (let fi = 0; fi < fields.length; fi++) {
        const { values, lowers, masks } = fields[fi]!;
        for (let vi = 0; vi < values.length; vi++) {
          const mask = masks[vi]!;
          if (fuzziness ? (wp.mask & mask) === 0 : (wp.mask & ~mask) !== 0) continue;
          const s = scoreString(wp, values[vi]!, lowers[vi]!, -1, fuzziness);
          if (s > best) {
            best = s;
            if (wins) {
              wins[2 * w] = fi;
              wins[2 * w + 1] = vi;
            }
          }
        }
      }
      sum += best;
      // Give up once even perfect scores for the remaining words can't win
      if ((sum + n - w - 1) / n <= whole) break;
    }
    if (w === n) {
      if (matches && wins) {
        for (let i = 0; i < n; i++) {
          const field = fields[wins[2 * i]!]!;
          const value = field.values[wins[2 * i + 1]!]!;
          matches.push(singleMatch(value, wordPlans[i]!, fuzziness, null, field.key));
        }
      }
      return sum / n;
    }
  }

  if (matches) {
    const field = fields[wholeField]!;
    matches.push(singleMatch(field.values[wholeValue]!, plan, fuzziness, null, field.key));
  }
  return whole;
}

function everyWordMatches(fields: Field[], wordPlans: QueryPlan[]): boolean {
  for (const wp of wordPlans) {
    const word = wp.lowerWords[0]!;
    let found = false;
    for (let fi = 0; fi < fields.length && !found; fi++) {
      const { lowers, masks } = fields[fi]!;
      for (let vi = 0; vi < lowers.length && !found; vi++) {
        found = (wp.mask & ~masks[vi]!) === 0 && matchesStrict(lowers[vi]!, word);
      }
    }
    if (!found) return false;
  }
  return true;
}

/** Skips null and undefined; objects are JSON. */
function collectLeaf(value: unknown, list: string[]): void {
  if (typeof value === 'string') {
    list.push(value);
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    list.push(String(value));
  } else if (value !== null && value !== undefined) {
    list.push(JSON.stringify(value));
  }
}

/** Leaf values along `segments` as strings, walking into arrays at any level. */
function collectValues(obj: unknown, segments: string[], segIdx: number, list: string[]): string[] {
  if (segIdx >= segments.length) {
    collectLeaf(obj, list);
    return list;
  }
  // Indexing a primitive gives undefined, so only null/undefined need a guard
  if (obj == null) return list;

  const value = (obj as Record<string, unknown>)[segments[segIdx]!];
  if (value === null || value === undefined) return list;

  const isLast = segIdx === segments.length - 1;
  if (isLast && (typeof value === 'string' || typeof value === 'number')) {
    list.push(typeof value === 'string' ? value : String(value));
  } else if (Array.isArray(value)) {
    for (let i = 0, len = value.length; i < len; i += 1) {
      collectValues(value[i], segments, segIdx + 1, list);
    }
  } else if (!isLast) {
    collectValues(value, segments, segIdx + 1, list);
  } else {
    collectLeaf(value, list);
  }
  return list;
}
