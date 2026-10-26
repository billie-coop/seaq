import { type Scored, scoreIndexed } from './listIndex';
import { charMask, lowercase, planQuery, type QueryPlan, scoreString } from './score';

export interface SeaqMatch {
  /** The key that matched; `undefined` without `keys`. */
  key?: string;
  /** The field value that matched; `indices` are relative to it. */
  value: string;
  /** Highlight ranges as inclusive `[start, end]` UTF-16 offsets. */
  indices: [number, number][];
  /** The item's score. */
  score: number;
}

export interface SeaqResult<T> {
  item: T;
  score: number;
  matches: SeaqMatch[];
}

export interface SeaqOptions<T> {
  /**
   * Keys to search, with dot paths (`'address.city'`) that walk into arrays at
   * any level. An item's values are searched as one space-separated string,
   * so a query can span fields. Without `keys`, strings are searched as they
   * are and other items as JSON; `null` and `undefined` never match.
   */
  keys?: Array<Extract<keyof T, string>> | string[];
  /**
   * Tolerance, from 0 to 1, for query characters that can't be matched in
   * order (typos, extra letters). Default `0.2`; `0` requires every
   * character.
   */
  fuzziness?: number;
  /** Maximum results, default `10`. `Infinity` returns every match. */
  limit?: number;
  /**
   * Drops results scoring below `threshold` × the best score. Default `0.3`;
   * `1` keeps only results tied with the best. Higher is stricter, unlike
   * Fuse.js.
   */
  threshold?: number;
  /** Return {@link SeaqResult}s with highlight positions per matched value. */
  includeMatches?: boolean;
  /**
   * Default: an array is indexed on its second search. `true` indexes on the
   * first, `false` never. Replaced items are detected, items **mutated in
   * place are not**.
   */
  cache?: boolean;
}

/**
 * Fuzzy search `list`, best match first. Returns a new array.
 *
 * @example
 * seaq(contacts, 'john', { keys: ['name', 'email'] })
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
    (cache ?? searchedBefore(list))
      ? scoreIndexed(list, plan, fuzziness, limit, threshold, JSON.stringify(keys) ?? '', prep)
      : scoreScan(list, plan, fuzziness, prep, paths !== undefined);

  const sorted = getTopN(scored, limit, maxScore * threshold);
  if (!options?.includeMatches) return sorted.map((m) => m.item);

  return sorted.map(({ item, score }) => ({
    item,
    score,
    matches: paths
      ? joinedMatches(item, plan, paths, fuzziness, score)
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
 * Without an index. Strict searches with keys skip
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

  return heap.sort((a, b) => score(b) - score(a) || a - b).map((i) => items[i]!);
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
function singleMatch(value: string, plan: QueryPlan, fuzziness: number, score: number): SeaqMatch {
  const positions: number[] = [];
  scoreString(plan, value, lowercase(value), -1, fuzziness, positions);
  return { value, indices: positionsToRanges(positions), score };
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
