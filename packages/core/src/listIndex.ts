/**
 * List-level search index for joined mode and keyless lists.
 *
 * Each list (by array identity) gets one prepared row per item — the search
 * string, its lowercased form and a character-class mask — plus one bitmap
 * per character class recording which rows contain that class. Searches use
 * the bitmaps to reach candidate rows without touching the others:
 *
 * - Strict (`fuzziness: 0`): candidates are the AND of the bitmaps for the
 *   query's character classes. When the query extends the previous one
 *   (typing), only the previous query's matches are re-checked.
 * - Fuzzy: rows are skipped when their {@link scoreBound} can't reach the
 *   current bar (relative threshold, or the weakest of the top `limit`
 *   scores so far).
 *
 * Both paths return exactly the items and order the unindexed scan would.
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

interface ListIndex {
  /** The entries the rows were prepared from, to detect replaced entries. */
  items: unknown[];
  /** Search string per row, and its lowercased form; '' never matches. */
  strings: string[];
  lowers: string[];
  masks: Uint32Array;
  wordStarts: Uint32Array;
  /** 32 bitmaps of `words` 32-bit words each: bit r of bitmap b ⇔ row r has class b. */
  bits: Uint32Array;
  words: number;
  /** Strict-mode narrowing state: rows that scored > 0 for `lastQuery`. */
  lastQuery: string | null;
  lastRows: Int32Array;
  lastRowsLen: number;
  scores: Float64Array;
}

/** Indexes per list, then per search-string signature. */
const listIndexes = new WeakMap<object, Map<string, ListIndex>>();

export interface Scored<T> {
  item: T;
  score: number;
}

/**
 * Score `list` against `plan` through its list index, building or repairing
 * the index first. Returns items with score > 0 in list order, exactly as an
 * unindexed scan would — except that rows proven unable to reach the final
 * result set (given `limit` and `threshold`) are omitted. `maxScore` is
 * always the true best score.
 *
 * `prep` gives an item's search string; `signature` identifies `prep`, so
 * one list can hold indexes for several key sets.
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
  const index = getIndex(list, signature, prep);
  const top = new TopScores(limit, threshold, list.length);
  const rowsLen = fuzziness
    ? scoreFuzzy(index, plan, fuzziness, top)
    : scoreStrict(index, plan, top);

  // Rows below the final bar would be cut by the threshold or the limit
  const bar = top.bar();
  const { lastRows: rows, scores } = index;
  const items: Scored<T>[] = [];
  for (let i = 0; i < rowsLen; i++) {
    const r = rows[i]!;
    const s = scores[r]!;
    if (s >= bar) items.push({ item: list[r] as T, score: s });
  }
  return { items, maxScore: top.max };
}

/**
 * Running best score plus the top `limit` scores seen so far (min-heap).
 * `bar()` is the lowest score that can still appear in the final result:
 * the relative threshold cutoff, or the weakest of a full top-N, whichever
 * is higher. It only rises as more scores are recorded.
 */
class TopScores {
  max = 0;
  private heap: Float64Array | null;
  private len = 0;
  private cap: number;

  constructor(
    limit: number,
    private threshold: number,
    rows: number,
  ) {
    // A heap that can never fill doesn't raise the bar
    this.cap = Math.ceil(limit);
    this.heap = this.cap < rows ? new Float64Array(this.cap) : null;
  }

  record(s: number): void {
    if (s > this.max) this.max = s;
    const heap = this.heap;
    if (!heap) return;
    if (this.len < this.cap) heapPush(heap, this.len++, s);
    else if (s > heap[0]!) heapReplaceTop(heap, this.len, s);
  }

  bar(): number {
    const cutoff = this.max * this.threshold;
    const weakest = this.heap && this.len === this.cap ? this.heap[0]! : 0;
    return cutoff > weakest ? cutoff : weakest;
  }
}

function getIndex<T>(list: T[], signature: string, prep: (item: T) => string): ListIndex {
  let byList = listIndexes.get(list);
  if (!byList) {
    byList = new Map();
    listIndexes.set(list, byList);
  }
  let index = byList.get(signature);
  if (!index || index.items.length !== list.length) {
    index = buildIndex(list, prep);
    byList.set(signature, index);
    return index;
  }
  const items = index.items;
  for (let r = 0; r < list.length; r++) {
    if (list[r] !== items[r]) {
      prepRow(index, r, list[r] as T, prep);
      index.lastQuery = null;
    }
  }
  return index;
}

function buildIndex<T>(list: T[], prep: (item: T) => string): ListIndex {
  const n = list.length;
  const words = (n + 31) >> 5;
  const index: ListIndex = {
    items: new Array(n),
    strings: new Array(n),
    lowers: new Array(n),
    masks: new Uint32Array(n),
    wordStarts: new Uint32Array(n),
    bits: new Uint32Array(32 * words),
    words,
    lastQuery: null,
    lastRows: new Int32Array(n),
    lastRowsLen: 0,
    scores: new Float64Array(n),
  };
  for (let r = 0; r < n; r++) prepRow(index, r, list[r] as T, prep);
  return index;
}

function prepRow<T>(index: ListIndex, r: number, item: T, prep: (item: T) => string): void {
  const { bits, words } = index;
  const word = r >> 5;
  const bit = 1 << (r & 31);
  // Clear the row's old classes (none for a fresh row)
  for (let m = index.masks[r]!; m !== 0; m &= m - 1) {
    const at = (31 - Math.clz32(m & -m)) * words + word;
    bits[at] = bits[at]! & ~bit;
  }

  index.items[r] = item;
  const str = prep(item);
  const lower = lowercase(str);
  index.strings[r] = str;
  index.lowers[r] = lower;
  const mask = charMask(lower);
  index.masks[r] = mask;
  index.wordStarts[r] = wordStartMask(lower);
  for (let m = mask; m !== 0; m &= m - 1) {
    const at = (31 - Math.clz32(m & -m)) * words + word;
    bits[at] = bits[at]! | bit;
  }
}

/**
 * Strict scoring. Writes every row scoring > 0 to `index.lastRows` in list
 * order (also the narrowing state for the next keystroke) and returns how
 * many there are.
 */
function scoreStrict(index: ListIndex, plan: QueryPlan, top: TopScores): number {
  const { strings, lowers, masks, scores, wordStarts } = index;
  const matched = index.lastRows;
  let matchedLen = 0;

  const score = (r: number) => {
    const s = scoreString(plan, strings[r]!, lowers[r]!, wordStarts[r]!, 0);
    if (s > 0) {
      matched[matchedLen++] = r;
      scores[r] = s;
      top.record(s);
    }
  };

  const query = plan.lowerWords.join(' ');
  const last = index.lastQuery;
  if (
    last !== null &&
    query.startsWith(last) &&
    // A prefix ending inside a surrogate pair isn't a prefix of characters
    (query.length === last.length || (query.charCodeAt(last.length) & 0xfc00) !== 0xdc00)
  ) {
    // Typing: a strict match for the longer query is also a strict match for
    // its prefix, so only the prefix's matches can match now. `matched` is
    // written in place — it never overtakes the read position.
    const prevLen = index.lastRowsLen;
    for (let i = 0; i < prevLen; i++) {
      const r = matched[i]!;
      if ((plan.mask & ~masks[r]!) === 0) score(r);
    }
  } else {
    // AND together the bitmaps of every class the query uses
    const { bits, words } = index;
    const offsets: number[] = [];
    for (let m = plan.mask; m !== 0; m &= m - 1) {
      offsets.push((31 - Math.clz32(m & -m)) * words);
    }
    for (let w = 0; w < words; w++) {
      let hits = bits[offsets[0]! + w]!;
      for (let o = 1; o < offsets.length && hits !== 0; o++) {
        hits &= bits[offsets[o]! + w]!;
      }
      while (hits !== 0) {
        score((w << 5) + 31 - Math.clz32(hits & -hits));
        hits &= hits - 1;
      }
    }
  }

  index.lastQuery = query;
  index.lastRowsLen = matchedLen;
  return matchedLen;
}

/**
 * Fuzzy scoring. Writes every scored row with score > 0 to
 * `index.lastRows` in list order and returns how many there are.
 */
function scoreFuzzy(index: ListIndex, plan: QueryPlan, fuzziness: number, top: TopScores): number {
  // Narrowing state only holds for strict scores; lastRows is reused below
  index.lastQuery = null;

  const { strings, lowers, masks, scores, wordStarts } = index;
  const rows = index.lastRows;
  let rowsLen = 0;
  const n = masks.length;
  const ceiling = scoreCeiling(plan, fuzziness);
  const queryMask = plan.mask;
  // Every scores[] slot read below was written earlier in this search, so
  // the buffer needs no clearing between searches
  const score = (r: number) => {
    const s = scoreString(plan, strings[r]!, lowers[r]!, wordStarts[r]!, fuzziness);
    scores[r] = s;
    top.record(s);
  };

  // Pass 1: rows containing every query class. They hold the best matches,
  // which raises the bar before the rest are considered.
  for (let r = 0; r < n; r++) {
    const mask = masks[r]!;
    if (mask !== 0 && (queryMask & ~mask) === 0) score(r);
  }

  // Pass 2: everything else, in list order, skipping rows that can't score
  // or can't reach the bar. The bar only rises, so every skipped row ends
  // below it.
  for (let r = 0; r < n; r++) {
    const mask = masks[r]!;
    // No query class at all scores 0; checked before reading the row's string
    if ((queryMask & mask) === 0) continue;
    if ((queryMask & ~mask) !== 0) {
      if (scoreBound(ceiling, mask, lowers[r]!.length) < top.bar()) continue;
      score(r);
    }
    if (scores[r]! > 0) rows[rowsLen++] = r;
  }
  return rowsLen;
}

// Min-heap of scores, smallest first
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
