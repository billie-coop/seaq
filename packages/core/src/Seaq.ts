/**
 * Seaq is a Fuzzy searching utility function.
 */
import { scoreIndexed } from './listIndex';
import { charMask, matchesStrict, planQuery, type QueryPlan, scoreString } from './score';

export { charMask };

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
 * searches a plain string array for items containing every query character:
 * shorthand ("steplau"), acronyms ("NYC"), adjacent swaps ("laguht") and
 * words in any order all match; missing characters don't.
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
   * "stephan" or "steve" for "Stephen"), from 0 to 1. Values outside that
   * range are clamped.
   *
   * - `0` (default) — every query character must be found. Shorthand
   *   ("steplau"), acronyms, adjacent swaps ("jonh" → "john") and any word
   *   order still match. Fastest, especially with `cache: true`.
   * - `0.2` — light tolerance: missing characters allowed, scored lower
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
   * When `true`, builds a search index for the list (keyed on the array via
   * a `WeakMap`) and reuses it while the same array is searched again —
   * a large win for repeated searches (e.g. typeahead) over a static list.
   * Results are identical to an uncached search.
   *
   * The index records which character classes each item contains, so strict
   * searches only score items containing every query character, and fuzzy
   * searches skip items whose missing characters cap their score below the
   * current top results. Added, removed or replaced items are detected; an
   * item mutated in place is not (replace the object instead).
   *
   * In `fieldMode: 'separate'`, prepared strings are cached per item
   * (keyed on object identity) instead.
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
 * // Search objects by specific keys (joined mode, every character must match)
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
 * // Typo tolerance for characters that aren't there at all
 * seaq(contacts, 'stephan', { keys: ['name'], fuzziness: 0.2 })
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
 * // Repeated searches over a static list (typeahead) — enable the cache
 * seaq(contacts, 'john', { keys: ['name'], cache: true })
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
  const rawFuzziness = options?.fuzziness === undefined ? 0 : options.fuzziness;
  // Clamp to the documented [0, 1] range — fuzziness > 1 would flip the
  // miss penalty into a score bonus inside the scorer
  const fuzziness = rawFuzziness < 0 ? 0 : rawFuzziness > 1 ? 1 : rawFuzziness;
  const fieldMode = options?.fieldMode ?? 'joined';
  const limit = options?.limit ?? 10;
  const threshold = options?.threshold ?? 0.3;
  const includeMatches = options?.includeMatches ?? false;
  const useCache = options?.cache ?? false;

  if (!query.trim()) return [];
  if (limit <= 0) return [];

  // Split dot-notation paths once per call instead of per segment per item
  const keyPaths = keys?.map((k) => k.split('.'));

  // cache + joined mode (or a keyless list) uses the list-level index; the
  // separate-mode cache stays per item
  const indexPaths = useCache && (!keys || fieldMode === 'joined') ? (keyPaths ?? null) : undefined;
  const { items: scored, maxScore } =
    indexPaths !== undefined
      ? scoreIndexed(
          list,
          query,
          fuzziness,
          limit,
          threshold,
          keys ? keys.join('\u0000') : '',
          indexPaths
            ? (item) => buildJoinedString(item, indexPaths)
            : (item) =>
                typeof item === 'string'
                  ? item
                  : typeof item === 'number'
                    ? String(item)
                    : JSON.stringify(item),
        )
      : scoreItems(list, query, keys, keyPaths, fuzziness, fieldMode, includeMatches, useCache);

  const cutoff = maxScore * threshold;

  let sorted: Array<MetaDataItem<T>>;
  if (Number.isFinite(limit)) {
    sorted = getTopN(scored, limit, cutoff);
  } else {
    const filtered = cutoff > 0 ? scored.filter((m) => m.score >= cutoff) : scored;
    sorted = filtered.sort((a, b) => b.score - a.score);
  }

  if (includeMatches) {
    // Match positions are computed only for the finalists (deferred from the
    // scoring phase) — scoring never pays for position collection
    computeMatches(sorted, query, keys, keyPaths, fuzziness, fieldMode);
    // biome-ignore lint/style/noNonNullAssertion: computeMatches sets matches on every finalist
    return sorted.map((m) => ({ item: m.item, score: m.score, matches: m.matches! }));
  }
  return sorted.map((m) => m.item);
}

/**
 * Get top N items by score using a min-heap for efficiency.
 * O(n log k) instead of O(n log n) for full sort.
 * Items scoring below `cutoff` are skipped without entering the heap.
 *
 * Ties keep list order (like the stable sort used when there is no limit),
 * so the result doesn't depend on which lower-scoring items passed through
 * the heap along the way.
 */
function getTopN<T>(
  items: Array<MetaDataItem<T>>,
  n: number,
  cutoff: number,
): Array<MetaDataItem<T>> {
  if (items.length <= n) {
    // If we have fewer items than limit, just filter and sort them all
    const eligible = cutoff > 0 ? items.filter((m) => m.score >= cutoff) : items;
    return eligible.sort((a, b) => b.score - a.score);
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
      heapReplace(heap, i, worse);
    }
  }

  // Pop worst-first, then reverse for best-first
  const result: Array<MetaDataItem<T>> = [];
  while (heap.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: heapPop returns a valid position
    result.push(items[heapPop(heap, worse)]!);
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

function heapPop(heap: number[], worse: Worse): number {
  // biome-ignore lint/style/noNonNullAssertion: caller guarantees heap.length > 0
  const result = heap[0]!;
  // biome-ignore lint/style/noNonNullAssertion: same caller guarantee — pop() returns defined when heap is non-empty
  const last = heap.pop()!;
  if (heap.length > 0) {
    heap[0] = last;
    heapifyDown(heap, 0, worse);
  }
  return result;
}

function heapReplace(heap: number[], pos: number, worse: Worse): void {
  heap[0] = pos;
  heapifyDown(heap, 0, worse);
}

function heapifyDown(heap: number[], i: number, worse: Worse): void {
  const len = heap.length;
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
 * Collapse ascending match positions into inclusive [start, end] ranges.
 * Precondition: `positions` is non-empty — every caller only rescores
 * strings that already scored > 0, which implies at least one position.
 */
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

/** A field value's location within a joined search string. */
interface JoinedSegment {
  key: string;
  value: string;
  start: number;
}

/**
 * Build the joined search string for an item: every leaf value from every
 * key, space-separated, in key order.
 */
function buildJoinedString(item: unknown, keyPaths: string[][]): string {
  const acc: string[] = [];
  for (let k = 0; k < keyPaths.length; k++) {
    // biome-ignore lint/style/noNonNullAssertion: k < keyPaths.length by loop guard
    collectValues(item, keyPaths[k]!, 0, acc);
  }
  return acc.join(' ');
}

/**
 * Build the joined search string along with the segment table needed to map
 * match positions back to individual fields. Only called for finalists.
 */
function buildJoinedSegments(
  item: unknown,
  keys: string[],
  keyPaths: string[][],
): { joined: string; segments: JoinedSegment[] } {
  const acc: string[] = [];
  const segments: JoinedSegment[] = [];
  for (let k = 0; k < keyPaths.length; k++) {
    const before = acc.length;
    // biome-ignore lint/style/noNonNullAssertion: k < keyPaths.length by loop guard
    collectValues(item, keyPaths[k]!, 0, acc);
    for (let i = before; i < acc.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: keys and keyPaths are parallel; values pushed by collectValues are defined
      segments.push({ key: keys[k]!, value: acc[i]!, start: 0 });
    }
  }
  let offset = 0;
  for (const seg of segments) {
    seg.start = offset;
    offset += seg.value.length + 1; // +1 for the ' ' separator
  }
  return { joined: acc.join(' '), segments };
}

/**
 * Split match positions on a joined string into per-field {@link SeaqMatch}
 * entries with field-relative indices. Positions landing on the space
 * separators between fields are dropped.
 */
function mapPositionsToSegments(
  positions: number[],
  segments: JoinedSegment[],
  score: number,
): SeaqMatch[] {
  const matches: SeaqMatch[] = [];
  let segIdx = 0;
  let segPositions: number[] = [];

  const flush = (seg: JoinedSegment): void => {
    if (segPositions.length > 0) {
      matches.push({
        key: seg.key,
        value: seg.value,
        indices: positionsToRanges(segPositions),
        score,
      });
      segPositions = [];
    }
  };

  // Invariant: positions are strictly ascending (string_score always
  // advances) and every position is < joined.length, while the segments
  // cover the joined string end to end — so segIdx can never run past the
  // last segment while positions remain.
  for (const p of positions) {
    // biome-ignore lint/style/noNonNullAssertion: see invariant above
    while (p >= segments[segIdx]!.start + segments[segIdx]!.value.length) {
      // biome-ignore lint/style/noNonNullAssertion: see invariant above
      flush(segments[segIdx]!);
      segIdx++;
    }
    // biome-ignore lint/style/noNonNullAssertion: see invariant above
    const seg = segments[segIdx]!;
    if (p < seg.start) continue; // separator between fields
    segPositions.push(p - seg.start);
  }
  // biome-ignore lint/style/noNonNullAssertion: flush only dereferences seg when positions were collected, which implies segments[segIdx] exists
  flush(segments[segIdx]!);
  return matches;
}

/**
 * Compute match metadata for the finalists. Scoring runs without position
 * collection; this re-scores only the (≤ limit) surviving items with
 * positions enabled and reconstructs the strings they were scored against.
 */
function computeMatches<T>(
  items: MetaDataItem<T>[],
  query: string,
  keys: string[] | undefined,
  keyPaths: string[][] | undefined,
  fuzziness: number | undefined,
  fieldMode: 'joined' | 'separate',
): void {
  const plan = planQuery(query);
  const fz = fuzziness ?? 0;
  const tokenPlans = separateTokenPlans(plan, keys, fieldMode);

  for (const meta of items) {
    if (keys && keyPaths) {
      if (meta._winDesc) {
        // Separate mode: rescore the recorded winning field(s)
        const desc = meta._winDesc;
        const fieldValues = keys.map((key, ki) => ({
          key,
          // biome-ignore lint/style/noNonNullAssertion: keys and keyPaths are parallel arrays
          values: collectValues(meta.item, keyPaths[ki]!, 0, []),
        }));

        if (desc.path === 'A') {
          // biome-ignore lint/style/noNonNullAssertion: desc.fieldIdx was set from a valid in-bounds index during scoring
          const field = fieldValues[desc.fieldIdx]!;
          // biome-ignore lint/style/noNonNullAssertion: desc.valueIdx was set from a valid in-bounds index during scoring
          const value = field.values[desc.valueIdx]!;
          const positions: number[] = [];
          const s = scoreString(plan, value, value.toLowerCase(), fz, positions);
          meta.matches = [
            { key: field.key, value, indices: positionsToRanges(positions), score: s },
          ];
        } else {
          // Path B: rescore each token against its winning field.
          // tokenPlans is non-null here: desc.path === 'B' is only set when
          // scoreItems Path B fired, which required token plans; the same
          // construction conditions hold here.
          // biome-ignore lint/style/noNonNullAssertion: see invariant above
          const tps = tokenPlans!;
          const tokenMatches: SeaqMatch[] = [];
          for (let t = 0; t < desc.fieldIndices.length; t++) {
            // biome-ignore lint/style/noNonNullAssertion: t < desc.fieldIndices.length by loop guard
            const { fieldIdx, valueIdx } = desc.fieldIndices[t]!;
            // biome-ignore lint/style/noNonNullAssertion: fieldIdx recorded as valid in-bounds index during scoring
            const field = fieldValues[fieldIdx]!;
            // biome-ignore lint/style/noNonNullAssertion: valueIdx recorded as valid in-bounds index during scoring
            const value = field.values[valueIdx]!;
            const positions: number[] = [];
            // biome-ignore lint/style/noNonNullAssertion: t in-bounds; one plan per token
            const s = scoreString(tps[t]!, value, value.toLowerCase(), fz, positions);
            tokenMatches.push({
              key: field.key,
              value,
              indices: positionsToRanges(positions),
              score: s,
            });
          }
          meta.matches = tokenMatches;
        }
        delete meta._winDesc;
      } else {
        // Joined mode: rebuild the joined string with its segment table,
        // rescore with positions, and split them back into per-field matches
        const { joined, segments } = buildJoinedSegments(meta.item, keys, keyPaths);
        const positions: number[] = [];
        scoreString(plan, joined, joined.toLowerCase(), fz, positions);
        meta.matches = mapPositionsToSegments(positions, segments, meta.score);
      }
    } else {
      // Keyless items: reconstruct the scored string
      const item = meta.item;
      const value =
        typeof item === 'string'
          ? item
          : typeof item === 'number'
            ? String(item)
            : JSON.stringify(item);
      const positions: number[] = [];
      scoreString(plan, value, value.toLowerCase(), fz, positions);
      meta.matches = [{ value, indices: positionsToRanges(positions), score: meta.score }];
    }
  }
}

/** Prepared (lowercased/masked) search strings cached per item. */
type PrepEntry =
  | { joined: string; lower: string; mask: number }
  | { fields: Array<{ key: string; values: string[]; lowerValues: string[]; masks: number[] }> };

/**
 * Cache of prepared search strings, keyed by item identity then by a
 * fieldMode+keys signature. Lives for the lifetime of the item objects.
 */
const prepCache = new WeakMap<object, Map<string, PrepEntry>>();

function scoreItems<T>(
  list: T[],
  query: string,
  keys: string[] | undefined,
  keyPaths: string[][] | undefined,
  fuzziness: number | undefined,
  fieldMode: 'joined' | 'separate',
  includeMatches: boolean,
  useCache: boolean,
): { items: Array<MetaDataItem<T>>; maxScore: number } {
  const plan = planQuery(query);
  const fz = fuzziness ?? 0;

  // Separate mode multi-word queries also score each word on its own field
  // (Path B), so "john smith" can match firstName + lastName
  const tokenPlans = separateTokenPlans(plan, keys, fieldMode);
  const tokens = tokenPlans ? plan.words : null;
  const lowerTokens = tokenPlans ? plan.lowerWords : null;

  // Words match independently, so whitespace in the query is never required
  const queryMask = charMask(plan.lowerWords.join(''));
  const tokenMasks = lowerTokens?.map((t) => charMask(t));

  const cacheSig = useCache && keys ? `${fieldMode}\u0000${keys.join('\u0000')}` : null;

  const result: Array<MetaDataItem<T>> = [];
  let maxScore = 0;

  for (const item of list) {
    // null/undefined entries (sparse arrays, optional data) never match
    if (item === null || item === undefined) continue;

    let score: number;
    let winDesc: WinDescriptor | undefined;

    // Per-item prep cache lookup (object items only — WeakMap keys)
    let itemMap: Map<string, PrepEntry> | undefined;
    let cachedPrep: PrepEntry | undefined;
    if (cacheSig && typeof item === 'object') {
      itemMap = prepCache.get(item);
      if (itemMap) {
        cachedPrep = itemMap.get(cacheSig);
      } else {
        itemMap = new Map();
        prepCache.set(item, itemMap);
      }
    }

    if (keys && keyPaths) {
      if (fieldMode === 'separate') {
        // Field values + lowercased versions + char masks, cached per item
        // when the cache is enabled, otherwise computed once per item
        let fieldValues: Array<{
          key: string;
          values: string[];
          lowerValues: string[];
          masks: number[];
        }>;
        if (cachedPrep && 'fields' in cachedPrep) {
          fieldValues = cachedPrep.fields;
        } else {
          fieldValues = keys.map((key, ki) => {
            // biome-ignore lint/style/noNonNullAssertion: keys and keyPaths are parallel arrays
            const values = collectValues(item, keyPaths[ki]!, 0, []);
            const lowerValues = values.map((v) => v.toLowerCase());
            const masks = lowerValues.map((lv) => charMask(lv));
            return { key, values, lowerValues, masks };
          });
          if (itemMap && cacheSig) itemMap.set(cacheSig, { fields: fieldValues });
        }

        // Path A: score full query against each field, take best
        let bestScore = 0;
        let winFieldIdx = 0;
        let winValueIdx = 0;
        for (let fi = 0; fi < fieldValues.length; fi++) {
          // biome-ignore lint/style/noNonNullAssertion: fi < fieldValues.length by loop guard; hot path
          const field = fieldValues[fi]!;
          for (let vi = 0; vi < field.values.length; vi++) {
            // Bitmask pre-filter: O(1) character-set rejection
            // Strict: reject if ANY query char type is missing from value
            // biome-ignore lint/style/noNonNullAssertion: vi < field.values.length === field.masks.length by construction
            if (!fuzziness && (queryMask & ~field.masks[vi]!) !== 0) continue;
            // Fuzzy: reject if ZERO char overlap (guaranteed score 0)
            // biome-ignore lint/style/noNonNullAssertion: parallel array access; vi in-bounds
            if (fuzziness && (queryMask & field.masks[vi]!) === 0) continue;
            const s = scoreString(
              plan,
              // biome-ignore lint/style/noNonNullAssertion: vi in-bounds for parallel field arrays
              field.values[vi]!,
              // biome-ignore lint/style/noNonNullAssertion: vi in-bounds for parallel field arrays
              field.lowerValues[vi]!,
              fz,
            );
            if (s > bestScore) {
              bestScore = s;
              winFieldIdx = fi;
              winValueIdx = vi;
            }
          }
        }

        // Path B: per-token best-field scoring (only for multi-word queries)
        if (tokens && lowerTokens) {
          // biome-ignore lint/style/noNonNullAssertion: tokenMasks is built from lowerTokens via optional chain; defined iff lowerTokens is
          const tm = tokenMasks!;
          // Cheap pre-filter: skip Path B unless every token is a subsequence
          // of at least one field value. This reduces Path B from ~10K items to
          // ~100-300 candidates, cutting string_score calls dramatically.
          let isCandidate = bestScore < 1; // perfect Path A ⇒ Path B can't win
          if (isCandidate) {
            for (let t = 0; t < lowerTokens.length; t++) {
              let tokenFound = false;
              for (let fi = 0; fi < fieldValues.length; fi++) {
                // biome-ignore lint/style/noNonNullAssertion: fi < fieldValues.length by loop guard; hot path
                const field = fieldValues[fi]!;
                for (let vi = 0; vi < field.lowerValues.length; vi++) {
                  // Bitmask gate: if any token char type is absent, subsequence is impossible
                  // biome-ignore lint/style/noNonNullAssertion: t and vi both in-bounds by loop guards
                  if ((tm[t]! & ~field.masks[vi]!) !== 0) continue;
                  // biome-ignore lint/style/noNonNullAssertion: parallel arrays; t and vi in-bounds
                  if (matchesStrict(field.lowerValues[vi]!, lowerTokens[t]!)) {
                    tokenFound = true;
                    break;
                  }
                }
                if (tokenFound) break;
              }
              if (!tokenFound) {
                isCandidate = false;
                break;
              }
            }
          }
          if (isCandidate) {
            let tokenScoreSum = 0;
            const tokenFieldIndices: Array<{ fieldIdx: number; valueIdx: number }> | undefined =
              includeMatches ? [] : undefined;
            let bailed = false;
            for (let t = 0; t < tokens.length; t++) {
              let bestTokenScore = 0;
              let bestTokenFieldIdx = 0;
              let bestTokenValueIdx = 0;
              for (let fi = 0; fi < fieldValues.length; fi++) {
                // biome-ignore lint/style/noNonNullAssertion: fi < fieldValues.length by loop guard; hot path
                const field = fieldValues[fi]!;
                for (let vi = 0; vi < field.values.length; vi++) {
                  // Bitmask pre-filter: O(1) character-set rejection
                  // biome-ignore lint/style/noNonNullAssertion: t and vi both in-bounds by loop guards
                  if (!fuzziness && (tm[t]! & ~field.masks[vi]!) !== 0) continue;
                  // biome-ignore lint/style/noNonNullAssertion: t and vi both in-bounds by loop guards
                  if (fuzziness && (tm[t]! & field.masks[vi]!) === 0) continue;
                  const s = scoreString(
                    // biome-ignore lint/style/noNonNullAssertion: t in-bounds; one plan per token
                    tokenPlans![t]!,
                    // biome-ignore lint/style/noNonNullAssertion: vi in-bounds for parallel field arrays
                    field.values[vi]!,
                    // biome-ignore lint/style/noNonNullAssertion: vi in-bounds for parallel field arrays
                    field.lowerValues[vi]!,
                    fz,
                  );
                  if (s > bestTokenScore) {
                    bestTokenScore = s;
                    bestTokenFieldIdx = fi;
                    bestTokenValueIdx = vi;
                  }
                }
              }
              tokenScoreSum += bestTokenScore;
              if (includeMatches) {
                // biome-ignore lint/style/noNonNullAssertion: tokenFieldIndices === [] when includeMatches (assigned above)
                tokenFieldIndices!.push({
                  fieldIdx: bestTokenFieldIdx,
                  valueIdx: bestTokenValueIdx,
                });
              }

              // Early bail: optimistic bound check
              const remaining = tokens.length - (t + 1);
              const optimisticAvg = (tokenScoreSum + remaining) / tokens.length;
              if (optimisticAvg <= bestScore) {
                bailed = true;
                break;
              }
            }
            if (!bailed) {
              // When !bailed, tokenAvg > bestScore is guaranteed: the bail check
              // on the final iteration (remaining=0) would have fired otherwise.
              bestScore = tokenScoreSum / tokens.length;
              if (tokenFieldIndices) {
                winDesc = { path: 'B', fieldIndices: tokenFieldIndices };
              }
            }
          }
        }

        score = bestScore;
        if (includeMatches && !winDesc) {
          winDesc = { path: 'A', fieldIdx: winFieldIdx, valueIdx: winValueIdx };
        }
      } else {
        // Joined mode: concatenate all field values and score as one string.
        // Match positions for includeMatches are computed later (finalists
        // only) by computeMatches via buildJoinedSegments.
        let searchString: string;
        let lowerSearch: string | undefined;
        let mask: number | undefined;
        if (cachedPrep && 'joined' in cachedPrep) {
          searchString = cachedPrep.joined;
          lowerSearch = cachedPrep.lower;
          mask = cachedPrep.mask;
        } else {
          searchString = buildJoinedString(item, keyPaths);
          if (itemMap && cacheSig) {
            lowerSearch = searchString.toLowerCase();
            mask = charMask(lowerSearch);
            itemMap.set(cacheSig, { joined: searchString, lower: lowerSearch, mask });
          } else if (!fuzziness) {
            // Strict mode: the mask gate rejects in O(len) what the scorer
            // rejects in O(query·len), so it pays for itself even uncached
            lowerSearch = searchString.toLowerCase();
            mask = charMask(lowerSearch);
          }
        }
        const rejected =
          mask !== undefined && (!fuzziness ? (queryMask & ~mask) !== 0 : (queryMask & mask) === 0);
        score = rejected
          ? 0
          : scoreString(plan, searchString, lowerSearch ?? searchString.toLowerCase(), fz);
      }
    } else {
      // Keyless items: strings, numbers, and objects as JSON
      const value =
        typeof item === 'string'
          ? item
          : typeof item === 'number'
            ? String(item)
            : JSON.stringify(item);
      score = scoreString(plan, value, value.toLowerCase(), fz);
    }

    // Only include items with score > 0
    if (score > 0) {
      if (score > maxScore) maxScore = score;
      const meta: MetaDataItem<T> = { item, score };
      if (winDesc) meta._winDesc = winDesc;
      result.push(meta);
    }
  }

  return { items: result, maxScore };
}

/**
 * Per-word query plans for separate mode's per-field token scoring (Path B),
 * or `null` when Path B doesn't apply (joined mode, no keys, one word).
 */
function separateTokenPlans(
  plan: QueryPlan,
  keys: string[] | undefined,
  fieldMode: 'joined' | 'separate',
): QueryPlan[] | null {
  if (fieldMode !== 'separate' || !keys || plan.words.length < 2) return null;
  return plan.words.map((w) => planQuery(w));
}

type WinDescriptor =
  | { path: 'A'; fieldIdx: number; valueIdx: number }
  | { path: 'B'; fieldIndices: Array<{ fieldIdx: number; valueIdx: number }> };

interface MetaDataItem<T> {
  item: T;
  score: number;
  matches?: SeaqMatch[];
  _winDesc?: WinDescriptor;
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

/**
 * Resolve a dot-notation path on an object, collecting all leaf values as strings.
 *
 * Handles nested objects, arrays (traversed automatically), and primitives.
 * For example, given `{ tags: [{ name: 'a' }, { name: 'b' }] }` and path
 * `'tags.name'`, returns `['a', 'b']`.
 *
 * @param obj - The object to read from
 * @param path - Dot-delimited property path, or `null` to stringify `obj` itself
 * @param list - Accumulator array (used internally for recursion)
 * @returns Array of string values found at the path
 */
export function getProperty(obj: unknown, path: string | null, list: string[] = []): string[] {
  if (!path) {
    collectLeaf(obj, list);
    return list;
  }
  return collectValues(obj, path.split('.'), 0, list);
}
