/**
 * The index behind repeated searches of one array: each entry's search
 * string, prepared once and kept per list and key set. Results are the same
 * as a scan's.
 */
import {
  charMask,
  lowercase,
  type QueryPlan,
  scoreBound,
  scoreCeiling,
  scoreString,
  wordStartMask,
} from './score';

export interface Scored<T> {
  item: T;
  score: number;
}

interface Row {
  item: unknown;
  text: string;
  lower: string;
  mask: number;
  starts: number;
}

interface ListIndex {
  rows: Row[];
  /**
   * The rows that matched the last strict query. A strict match for a longer
   * query is also one for its prefix, so typing only re-checks those.
   */
  lastQuery: string | null;
  lastHits: number[];
}

const indexes = new WeakMap<object, Map<string, ListIndex>>();

/**
 * Score `list` through its index, preparing new and replaced entries (an
 * entry mutated in place isn't noticed). Returns, in list order, the items
 * scoring at or above the final cutoff, and the best score.
 */
export function scoreIndexed<T>(
  list: T[],
  plan: QueryPlan,
  fuzziness: number,
  limit: number,
  threshold: number,
  signature: string,
  prep: (item: T) => string,
): { items: Scored<T>[]; maxScore: number } {
  let byKeys = indexes.get(list);
  if (!byKeys) {
    byKeys = new Map();
    indexes.set(list, byKeys);
  }
  let index = byKeys.get(signature);
  if (!index) {
    index = { rows: [], lastQuery: null, lastHits: [] };
    byKeys.set(signature, index);
  }
  const { rows } = index;
  const n = list.length;
  if (rows.length !== n) {
    rows.length = n;
    index.lastQuery = null;
  }
  for (let r = 0; r < n; r++) {
    const item = list[r];
    const row = rows[r];
    if (row === undefined || row.item !== item) {
      const text = prep(item as T);
      const lower = lowercase(text);
      rows[r] = { item, text, lower, mask: charMask(lower), starts: wordStartMask(lower) };
      index.lastQuery = null;
    }
  }

  // Typing a strict query: only the last one's matches can match. A prefix
  // ending inside a surrogate pair isn't a prefix of characters.
  const query = plan.lowerWords.join(' ');
  const last = index.lastQuery;
  const narrowed =
    !fuzziness &&
    last !== null &&
    query.startsWith(last) &&
    (query.length === last.length || (query.charCodeAt(last.length) & 0xfc00) !== 0xdc00)
      ? index.lastHits
      : null;

  // `bar` is the lowest score that can still make the result: the threshold
  // cutoff, or the weakest of a full top `limit` (a min-heap). It only rises.
  const cap = Math.ceil(limit);
  const heap = cap < n ? new Float64Array(cap) : null;
  let len = 0;
  let max = 0;
  let bar = 0;
  const hits: number[] = [];
  const scores: number[] = [];
  const queryMask = plan.mask;

  // Rows with every query character class first: they hold the best
  // matches, which raises the bar before the rest are considered
  const end = narrowed ? narrowed.length : n;
  for (let i = 0; i < end; i++) {
    const r = narrowed ? narrowed[i]! : i;
    const row = rows[r]!;
    if ((queryMask & ~row.mask) !== 0) continue;
    const s = scoreString(plan, row.text, row.lower, row.starts, fuzziness);
    if (s <= 0) continue;
    hits.push(r);
    scores.push(s);
    if (s > max) max = s;
    if (heap) {
      if (len < cap) heapPush(heap, len++, s);
      else if (s > heap[0]!) heapReplaceTop(heap, len, s);
    }
    bar = Math.max(max * threshold, heap && len === cap ? heap[0]! : 0);
  }

  // Fuzzy: then the rows sharing some class with the query whose bound
  // reaches the bar
  if (fuzziness) {
    const ceiling = scoreCeiling(plan, fuzziness);
    for (let r = 0; r < n; r++) {
      const row = rows[r]!;
      const mask = row.mask;
      if ((queryMask & mask) === 0 || (queryMask & ~mask) === 0) continue;
      if (scoreBound(ceiling, mask, row.lower.length) < bar) continue;
      const s = scoreString(plan, row.text, row.lower, row.starts, fuzziness);
      if (s <= 0) continue;
      hits.push(r);
      scores.push(s);
      if (s > max) max = s;
      if (heap) {
        if (len < cap) heapPush(heap, len++, s);
        else if (s > heap[0]!) heapReplaceTop(heap, len, s);
      }
      bar = Math.max(max * threshold, heap && len === cap ? heap[0]! : 0);
    }
  }
  index.lastQuery = fuzziness ? null : query;
  index.lastHits = hits;

  // Rows below the final bar would be cut by the threshold or the limit.
  // Ties keep list order, which the two passes each kept on their own.
  const keep: number[] = [];
  for (let i = 0; i < hits.length; i++) if (scores[i]! >= bar) keep.push(i);
  if (fuzziness) keep.sort((a, b) => hits[a]! - hits[b]!);
  return {
    items: keep.map((i) => ({ item: list[hits[i]!] as T, score: scores[i]! })),
    maxScore: max,
  };
}

function heapPush(heap: Float64Array, len: number, value: number): void {
  let i = len;
  heap[i] = value;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent]! <= heap[i]!) break;
    const tmp = heap[i]!;
    heap[i] = heap[parent]!;
    heap[parent] = tmp;
    i = parent;
  }
}

function heapReplaceTop(heap: Float64Array, len: number, value: number): void {
  heap[0] = value;
  let i = 0;
  for (;;) {
    const left = 2 * i + 1;
    const right = left + 1;
    let smallest = i;
    if (left < len && heap[left]! < heap[smallest]!) smallest = left;
    if (right < len && heap[right]! < heap[smallest]!) smallest = right;
    if (smallest === i) return;
    const tmp = heap[i]!;
    heap[i] = heap[smallest]!;
    heap[smallest] = tmp;
    i = smallest;
  }
}
