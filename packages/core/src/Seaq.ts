/**
 * Seaq is a Fuzzy searching utility function.
 */
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

/**
 * Configuration for {@link seaq} search behavior.
 *
 * All options are optional — calling `seaq(list, query)` with no options
 * searches a plain string array with light typo tolerance: shorthand
 * ("steplau"), acronyms ("NYC"), adjacent swaps ("laguht"), words in any
 * order and the odd missing character all match.
 */
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
   * - `'separate'` — scores each field independently and takes the best match.
   *   More precise for single-field queries but cannot match across field boundaries.
   */
  fieldMode?: 'joined' | 'separate';
  /**
   * Maximum number of results to return. Default: `10`.
   *
   * Uses a min-heap internally for O(n log k) selection instead of
   * O(n log n) full sort, so this is significantly faster than sorting
   * everything and calling `.slice(0, n)` on large result sets.
   *
   * Set to `Infinity` to return all matches (not recommended for large lists).
   * `0` or a negative limit returns `[]`.
   */
  limit?: number;
  /**
   * Relative score cutoff — results below `topScore * threshold` are dropped.
   *
   * - `0.3` (default) — keeps results scoring at least 30% of the best match
   * - `0` — no filtering, returns everything with score > 0 (old behavior)
   * - `1` — only perfect/near-perfect matches
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
   * set and `indices` relative to that field's `value`. Match positions are
   * only computed for the final (post-limit) results, so this adds near-zero
   * cost to the scoring phase.
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
   * The index records which character classes each item contains, so
   * searches only score items that can make the results. Added, removed or
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
 * // Cross-field matching with joined mode
 * seaq(contacts, 'john smith', { keys: ['firstName', 'lastName'], fieldMode: 'joined' })
 *
 * @example
 * // Shorthand, swapped letters and word order work by default
 * seaq(contacts, 'laguht steph', { keys: ['name'] })
 *
 * @example
 * // Strict: every character must be found
 * seaq(contacts, 'steph', { keys: ['name'], fuzziness: 0 })
 *
 * @example
 * // Nested property + array traversal
 * seaq(users, 'admin', { keys: ['roles.name'] })
 *
 * @example
 * // Tighter cap than the default limit of 10
 * seaq(contacts, 'john', { keys: ['name'], limit: 3 })
 *
 * @example
 * // Items edited in place between searches — turn the index off
 * seaq(contacts, 'john', { keys: ['name'], cache: false })
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
  // Clamp to the documented [0, 1] range — fuzziness > 1 would flip the
  // miss penalty into a score bonus inside the scorer
  const fuzziness = rawFuzziness < 0 ? 0 : rawFuzziness > 1 ? 1 : rawFuzziness;
  const separate = keys !== undefined && options?.fieldMode === 'separate';
  const limit = options?.limit ?? 10;
  const threshold = options?.threshold ?? 0.3;
  const cache = options?.cache;

  if (!query.trim() || limit <= 0) return [];

  const plan = planQuery(query);
  // Split dot-notation paths once per call instead of per segment per item
  const paths = keys?.map((key) => ({ key, path: key.split('.') }));
  const prep: (item: T) => string = paths
    ? (item) => buildJoinedString(item, paths)
    : keylessString;

  // Joined mode and keyless lists use the list index: always with
  // cache: true, never with cache: false, and by default from the second
  // search of the same array on (one-off searches don't pay to build it).
  // Separate mode's cache stays per item and is opt-in.
  const { items: scored, maxScore } =
    paths && separate
      ? scoreSeparate(list, plan, paths, fuzziness, cache === true)
      : (cache ?? searchedBefore(list))
        ? scoreIndexed(list, plan, fuzziness, limit, threshold, JSON.stringify(keys) ?? '', prep)
        : scoreScan(list, plan, fuzziness, prep, paths !== undefined);

  const sorted = getTopN(scored, limit, maxScore * threshold);
  if (!options?.includeMatches) return sorted.map((m) => m.item);

  // Match positions are computed only for the finalists — scoring never
  // pays for position collection
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

/** A search key and its dot-notation path, split. */
interface KeyPath {
  key: string;
  path: string[];
}

/** Arrays searched at least once with the default `cache` setting. */
const searched = new WeakSet<object>();

/**
 * Whether `list` was searched before (with the default `cache` setting).
 * Records it either way, so the second search of an array builds its index.
 */
function searchedBefore(list: object): boolean {
  if (searched.has(list)) return true;
  searched.add(list);
  return false;
}

/**
 * Score every item's search string (joined mode or keyless), without an
 * index. Items scoring 0 are left out.
 *
 * In strict mode with keys, a character-class gate rejects most items
 * before scoring. Without keys it doesn't pay: objects are matched as long
 * JSON strings, where building the mask costs more than the native
 * `indexOf` scan that rejects them.
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
 * Get top N items by score using a min-heap for efficiency.
 * O(n log k) instead of O(n log n) for full sort.
 * Items scoring below `cutoff` are skipped without entering the heap.
 *
 * Ties keep list order (like the stable sort used when everything fits),
 * so the result doesn't depend on which lower-scoring items passed through
 * the heap along the way.
 */
function getTopN<T>(items: Array<Scored<T>>, n: number, cutoff: number): Array<Scored<T>> {
  if (items.length <= n) {
    return items.filter((m) => m.score >= cutoff).sort((a, b) => b.score - a.score);
  }

  // Min-heap of positions in `items`, worst at the root: lower score is
  // worse, and on equal scores the later position is worse
  const heap: number[] = [];
  // biome-ignore lint/style/noNonNullAssertion: heap only holds valid positions
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
      // biome-ignore lint/style/noNonNullAssertion: heap is full (length === n > 0)
    } else if (s > score(heap[0]!)) {
      // Later positions only win on a strictly higher score
      heap[0] = i;
      heapifyDown(heap, worse);
    }
  }

  // Pop worst-first, then reverse for best-first
  const result: Array<Scored<T>> = [];
  while (heap.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: heap is non-empty
    result.push(items[heap[0]!]!);
    // biome-ignore lint/style/noNonNullAssertion: heap is non-empty
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      heapifyDown(heap, worse);
    }
  }
  return result.reverse();
}

// Min-heap operations over item positions (worst at root)
type Worse = (a: number, b: number) => boolean;

function heapPush(heap: number[], pos: number, worse: Worse): void {
  heap.push(pos);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    // biome-ignore lint/style/noNonNullAssertion: i and parent in-bounds; hot path
    if (!worse(heap[i]!, heap[parent]!)) break;
    // biome-ignore lint/style/noNonNullAssertion: same in-bounds guarantee as above
    const tmp = heap[i]!;
    // biome-ignore lint/style/noNonNullAssertion: same in-bounds guarantee as above
    heap[i] = heap[parent]!;
    heap[parent] = tmp;
    i = parent;
  }
}

/** Restore the heap after replacing its root. */
function heapifyDown(heap: number[], worse: Worse): void {
  const len = heap.length;
  let i = 0;
  while (true) {
    const left = 2 * i + 1;
    const right = 2 * i + 2;
    let smallest = i;

    // biome-ignore lint/style/noNonNullAssertion: left < len guard; smallest in-bounds; hot path
    if (left < len && worse(heap[left]!, heap[smallest]!)) smallest = left;
    // biome-ignore lint/style/noNonNullAssertion: right < len guard; smallest in-bounds; hot path
    if (right < len && worse(heap[right]!, heap[smallest]!)) smallest = right;
    if (smallest === i) break;

    // biome-ignore lint/style/noNonNullAssertion: i and smallest both in-bounds by guards above
    const tmp = heap[i]!;
    // biome-ignore lint/style/noNonNullAssertion: i and smallest both in-bounds by guards above
    heap[i] = heap[smallest]!;
    heap[smallest] = tmp;
    i = smallest;
  }
}

/**
 * Score `value` with positions and wrap it as a match. Only called for
 * strings that scored > 0, so at least one position is found.
 */
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

/** Collapse ascending, non-empty match positions into inclusive [start, end] ranges. */
function positionsToRanges(positions: number[]): [number, number][] {
  const ranges: [number, number][] = [];
  // biome-ignore lint/style/noNonNullAssertion: non-empty by precondition
  let start = positions[0]!;
  let end = start;
  for (let i = 1; i < positions.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: i < positions.length by loop guard
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

/**
 * Build the joined search string for an item: every leaf value from every
 * key, space-separated, in key order.
 */
function buildJoinedString(item: unknown, paths: KeyPath[]): string {
  const acc: string[] = [];
  for (const { path } of paths) collectValues(item, path, 0, acc);
  return acc.join(' ');
}

/**
 * Joined-mode matches: rebuild the joined string, score it with positions
 * and split them into per-field matches with field-relative indices.
 * Positions on the spaces between fields are dropped.
 */
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
    // biome-ignore lint/style/noNonNullAssertion: v < values.length
    const value = values[v]!;
    const end = start + value.length;
    const own: number[] = [];
    // biome-ignore lint/style/noNonNullAssertion: p < positions.length
    for (; p < positions.length && positions[p]! <= end; p++) {
      // biome-ignore lint/style/noNonNullAssertion: p < positions.length
      if (positions[p]! < end) own.push(positions[p]! - start);
    }
    if (own.length > 0) {
      matches.push({ key: valueKeys[v], value, indices: positionsToRanges(own), score });
    }
    start = end + 1; // past the ' ' separator
  }
  return matches;
}

/** A field's values, prepared for separate-mode scoring. */
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

/**
 * Separate mode: score each field value on its own and keep the best. For
 * multi-word queries, each word also finds its best field value on its own
 * (so "john smith" can match firstName + lastName), and the average of those
 * counts when it's higher.
 */
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
    // null/undefined entries (sparse arrays, optional data) never match
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

/** Separate-mode matches: the field values that won, scored with positions. */
function separateMatches(
  item: unknown,
  plan: QueryPlan,
  paths: KeyPath[],
  fuzziness: number,
): SeaqMatch[] {
  const wordPlans = plan.words.length > 1 ? plan.words.map(planQuery) : null;
  const winners: Winner[] = [];
  scoreFields(prepareFields(item, paths), plan, wordPlans, fuzziness, winners);
  return winners.map((w) => singleMatch(w.value, w.plan, fuzziness, null, w.key));
}

/** A field value that won, and the plan it was scored with. */
interface Winner {
  key: string;
  value: string;
  plan: QueryPlan;
}

// Where the last bestValueScore() that scored above 0 found its best score
let winField = 0;
let winValue = 0;

/** The best score of `plan` across all field values. */
function bestValueScore(fields: Field[], plan: QueryPlan, fuzziness: number): number {
  let best = 0;
  for (let fi = 0; fi < fields.length; fi++) {
    // biome-ignore lint/style/noNonNullAssertion: fi < fields.length
    const field = fields[fi]!;
    for (let vi = 0; vi < field.values.length; vi++) {
      // biome-ignore lint/style/noNonNullAssertion: values, lowers and masks are parallel
      const mask = field.masks[vi]!;
      // Bitmask gate. Strict: a query class is missing. Fuzzy: no overlap.
      if (fuzziness ? (plan.mask & mask) === 0 : (plan.mask & ~mask) !== 0) continue;
      // biome-ignore lint/style/noNonNullAssertion: values, lowers and masks are parallel
      const s = scoreString(plan, field.values[vi]!, field.lowers[vi]!, -1, fuzziness);
      if (s > best) {
        best = s;
        winField = fi;
        winValue = vi;
      }
    }
  }
  return best;
}

/** The winner found by the last bestValueScore() that scored above 0. */
function lastWinner(fields: Field[], plan: QueryPlan): Winner {
  // biome-ignore lint/style/noNonNullAssertion: a valid field index
  const field = fields[winField]!;
  // biome-ignore lint/style/noNonNullAssertion: a valid value index
  return { key: field.key, value: field.values[winValue]!, plan };
}

/**
 * Score one item's fields in separate mode. With `winners`, also records
 * the field values that won.
 */
function scoreFields(
  fields: Field[],
  plan: QueryPlan,
  wordPlans: QueryPlan[] | null,
  fuzziness: number,
  winners: Winner[] | null,
): number {
  const whole = bestValueScore(fields, plan, fuzziness);
  const wholeWinner = winners && whole > 0 ? lastWinner(fields, plan) : null;
  if (wordPlans && whole < 1) {
    const byWord = scoreWords(fields, wordPlans, fuzziness, whole, winners);
    if (byWord > whole) return byWord;
  }
  if (wholeWinner) winners?.push(wholeWinner);
  return whole;
}

/**
 * Separate mode, multi-word queries: the average of each word's best field
 * value score, or 0 when that can't beat `whole`. Skipped unless every word
 * matches some value strictly, a cheap check that rules out most items.
 */
function scoreWords(
  fields: Field[],
  wordPlans: QueryPlan[],
  fuzziness: number,
  whole: number,
  winners: Winner[] | null,
): number {
  for (const wp of wordPlans) if (!matchesSomeValue(fields, wp)) return 0;
  const found: Winner[] = [];
  let sum = 0;
  for (let w = 0; w < wordPlans.length; w++) {
    // biome-ignore lint/style/noNonNullAssertion: w < wordPlans.length
    const wp = wordPlans[w]!;
    // Above 0: the word matches some value strictly
    sum += bestValueScore(fields, wp, fuzziness);
    if (winners) found.push(lastWinner(fields, wp));
    // Give up once even perfect scores for the remaining words can't win
    if ((sum + wordPlans.length - (w + 1)) / wordPlans.length <= whole) return 0;
  }
  winners?.push(...found);
  return sum / wordPlans.length;
}

/** Does the one-word `wordPlan` match some field value strictly? */
function matchesSomeValue(fields: Field[], wordPlan: QueryPlan): boolean {
  // biome-ignore lint/style/noNonNullAssertion: a one-word plan
  const word = wordPlan.lowerWords[0]!;
  for (const field of fields) {
    for (let vi = 0; vi < field.lowers.length; vi++) {
      if (
        // biome-ignore lint/style/noNonNullAssertion: lowers and masks are parallel
        (wordPlan.mask & ~field.masks[vi]!) === 0 &&
        // biome-ignore lint/style/noNonNullAssertion: vi < lowers.length
        matchesStrict(field.lowers[vi]!, word)
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Push the string form of a leaf value onto `list` (skips null/undefined). */
function collectLeaf(value: unknown, list: string[]): void {
  if (typeof value === 'string') {
    list.push(value);
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    list.push(String(value));
  } else if (value !== null && value !== undefined) {
    list.push(JSON.stringify(value));
  }
}

/**
 * Walk a pre-split property path, collecting all leaf values as strings.
 * Arrays are traversed automatically at any level.
 */
function collectValues(obj: unknown, segments: string[], segIdx: number, list: string[]): string[] {
  if (segIdx >= segments.length) {
    collectLeaf(obj, list);
    return list;
  }
  // Cheap null/undefined guard: indexing null/undefined throws, but primitives
  // (string/number/etc.) safely return undefined for non-numeric keys, so we
  // skip the typeof check and let the value guard below filter those.
  if (obj == null) return list;

  // biome-ignore lint/style/noNonNullAssertion: segIdx < segments.length by guard above
  const value = (obj as Record<string, unknown>)[segments[segIdx]!];
  if (value === null || value === undefined) return list;

  const isLast = segIdx === segments.length - 1;
  if (isLast && (typeof value === 'string' || typeof value === 'number')) {
    // Fast path for primitive leaves - avoid the generic leaf handling
    list.push(typeof value === 'string' ? value : String(value));
  } else if (Array.isArray(value)) {
    // Search each item in the array.
    for (let i = 0, len = value.length; i < len; i += 1) {
      collectValues(value[i], segments, segIdx + 1, list);
    }
  } else if (!isLast) {
    // An object. Recurse further.
    collectValues(value, segments, segIdx + 1, list);
  } else {
    collectLeaf(value, list);
  }
  return list;
}
