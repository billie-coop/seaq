/**
 * List-level search index used by `cache: true` in joined mode and for
 * keyless lists.
 *
 * Each list (by array identity) gets one prepared row per item — the search
 * string, its lowercased form and a character-class mask — plus one bitmap
 * per character class recording which rows contain that class. Searches use
 * the bitmaps to reach candidate rows without touching the others:
 *
 * - Strict (`fuzziness: 0`): candidates are the AND of the bitmaps for the
 *   query's character classes. When the query extends the previous one
 *   (typing), only the previous query's matches are re-checked.
 * - Fuzzy: every character class missing from a row is a guaranteed miss,
 *   and misses cap the score string_score can return. Rows whose cap can't
 *   reach the current bar (relative threshold, or the weakest of the top
 *   `limit` scores so far) are skipped without being scored.
 *
 * Both paths return exactly the items and order the unindexed scan would.
 */
import { string_score } from './string_score';

/**
 * Build a bitmask of the character classes present in a string:
 * - bits 0-25: a-z presence
 * - bits 27-31: digit presence, bucketed in pairs (0-1, 2-3, 4-5, 6-7, 8-9)
 *   so numeric queries (phone numbers, ids) get real pre-filter selectivity
 * - bit 26: everything else
 *
 * Enables O(1) character-set containment checks before expensive scoring.
 */
export function charMask(lower: string): number {
  let mask = 0;
  for (let i = 0; i < lower.length; i++) {
    mask |= charBit(lower.charCodeAt(i));
  }
  return mask;
}

function charBit(code: number): number {
  if (code >= 97 && code <= 122) return 1 << (code - 97);
  if (code >= 48 && code <= 57) return 1 << (27 + ((code - 48) >> 1));
  return 1 << 26;
}

interface ListIndex {
  /** The list entries each row was prepared from, for change detection. */
  items: unknown[];
  /** Search string per row; `null` for entries that never match. */
  strings: Array<string | null>;
  lowers: string[];
  masks: Uint32Array;
  /** 32 bitmaps of `words` 32-bit words each: bit r of bitmap b ⇔ row r has class b. */
  bits: Uint32Array;
  words: number;
  /** Strict-mode narrowing state: rows that scored > 0 for `lastLower`. */
  lastLower: string | null;
  lastRows: Int32Array;
  lastRowsLen: number;
  /** Fuzzy-mode score scratch space, reused across searches. */
  scores: Float64Array;
}

/** Indexes per list, then per prep signature (the joined keys). */
const listIndexes = new WeakMap<object, Map<string, ListIndex>>();

export interface IndexedScore<T> {
  item: T;
  score: number;
}

/**
 * Score `list` against `query` through its list index, building or
 * repairing the index first. Returns items with score > 0 in list order,
 * exactly as an unindexed scan would — except that rows proven unable to
 * reach the final result set (given `limit` and `threshold`) are omitted.
 */
export function scoreIndexed<T>(
  list: T[],
  query: string,
  fuzziness: number,
  limit: number,
  threshold: number,
  signature: string,
  prep: (item: T) => string | null,
): { items: IndexedScore<T>[]; maxScore: number } {
  const index = getIndex(list, signature, prep);
  const lowerQuery = query.toLowerCase();
  const queryMask = charMask(lowerQuery);
  return fuzziness
    ? scoreFuzzy(index, list, query, lowerQuery, queryMask, fuzziness, limit, threshold)
    : scoreStrict(index, list, query, lowerQuery, queryMask);
}

function getIndex<T>(list: T[], signature: string, prep: (item: T) => string | null): ListIndex {
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
  // Same length: re-prepare any row whose entry was replaced. Mutating an
  // entry in place is not detected (same contract as the per-item cache).
  const items = index.items;
  let repaired = false;
  for (let r = 0; r < list.length; r++) {
    if (list[r] !== items[r]) {
      prepRow(index, r, list[r] as T, prep);
      repaired = true;
    }
  }
  if (repaired) index.lastLower = null;
  return index;
}

function buildIndex<T>(list: T[], prep: (item: T) => string | null): ListIndex {
  const n = list.length;
  const words = (n + 31) >> 5;
  const index: ListIndex = {
    items: new Array(n),
    strings: new Array(n),
    lowers: new Array(n),
    masks: new Uint32Array(n),
    bits: new Uint32Array(32 * words),
    words,
    lastLower: null,
    lastRows: new Int32Array(n),
    lastRowsLen: 0,
    scores: new Float64Array(n),
  };
  for (let r = 0; r < n; r++) prepRow(index, r, list[r] as T, prep);
  return index;
}

function prepRow<T>(index: ListIndex, r: number, item: T, prep: (item: T) => string | null): void {
  const { bits, words } = index;
  const word = r >> 5;
  const bit = 1 << (r & 31);
  // Clear the row from every class bitmap (no-op for fresh rows)
  for (let b = 0; b < 32; b++) {
    const at = b * words + word;
    // biome-ignore lint/style/noNonNullAssertion: at < 32 * words
    bits[at] = bits[at]! & ~bit;
  }

  index.items[r] = item;
  const str = item === null || item === undefined ? null : prep(item);
  index.strings[r] = str;
  const lower = str === null ? '' : str.toLowerCase();
  index.lowers[r] = lower;
  const mask = charMask(lower);
  index.masks[r] = mask;
  for (let m = mask; m !== 0; m &= m - 1) {
    const at = (31 - Math.clz32(m & -m)) * words + word;
    // biome-ignore lint/style/noNonNullAssertion: at < 32 * words
    bits[at] = bits[at]! | bit;
  }
}

function scoreStrict<T>(
  index: ListIndex,
  list: T[],
  query: string,
  lowerQuery: string,
  queryMask: number,
): { items: IndexedScore<T>[]; maxScore: number } {
  const { strings, lowers, masks } = index;
  const out: IndexedScore<T>[] = [];
  let maxScore = 0;

  // Rows that score > 0 for this query, for narrowing the next keystroke
  const matched = index.lastRows;
  let matchedLen = 0;

  const score = (r: number) => {
    // biome-ignore lint/style/noNonNullAssertion: candidates are rows with a non-empty mask, so strings[r] is set
    const s = string_score(strings[r]!, query, 0, lowerQuery, undefined, lowers[r]);
    if (s > 0) {
      matched[matchedLen++] = r;
      if (s > maxScore) maxScore = s;
      out.push({ item: list[r] as T, score: s });
    }
  };

  const last = index.lastLower;
  if (last !== null && lowerQuery.startsWith(last)) {
    // Typing: a strict match for the longer query is also a strict match for
    // its prefix, so only the prefix's matches can match now. `matched` is
    // written in place — it never overtakes the read position.
    const prevLen = index.lastRowsLen;
    for (let i = 0; i < prevLen; i++) {
      // biome-ignore lint/style/noNonNullAssertion: i < prevLen ≤ length
      const r = matched[i]!;
      // biome-ignore lint/style/noNonNullAssertion: r is a valid row
      if ((queryMask & ~masks[r]!) === 0) score(r);
    }
  } else {
    // AND together the bitmaps of every class the query uses
    const { bits, words } = index;
    const offsets: number[] = [];
    for (let m = queryMask; m !== 0; m &= m - 1) {
      offsets.push((31 - Math.clz32(m & -m)) * words);
    }
    for (let w = 0; w < words; w++) {
      // biome-ignore lint/style/noNonNullAssertion: queryMask is non-zero for a non-blank query
      let hits = bits[offsets[0]! + w]!;
      for (let o = 1; o < offsets.length && hits !== 0; o++) {
        // biome-ignore lint/style/noNonNullAssertion: offsets in-bounds by loop guard
        hits &= bits[offsets[o]! + w]!;
      }
      while (hits !== 0) {
        score((w << 5) + 31 - Math.clz32(hits & -hits));
        hits &= hits - 1;
      }
    }
  }

  index.lastLower = lowerQuery;
  index.lastRowsLen = matchedLen;
  return { items: out, maxScore };
}

function scoreFuzzy<T>(
  index: ListIndex,
  list: T[],
  query: string,
  lowerQuery: string,
  queryMask: number,
  fuzziness: number,
  limit: number,
  threshold: number,
): { items: IndexedScore<T>[]; maxScore: number } {
  // Narrowing state only holds for strict scores
  index.lastLower = null;

  const { strings, lowers, masks } = index;
  const n = masks.length;
  const len = query.length;

  // How many query characters fall in each class: a class missing from a
  // row guarantees at least that many misses
  const classCount = new Uint8Array(32);
  for (let i = 0; i < len; i++) {
    const b = 31 - Math.clz32(charBit(lowerQuery.charCodeAt(i)));
    // biome-ignore lint/style/noNonNullAssertion: b in [0, 31]
    if (classCount[b]! < 255) classCount[b]!++;
  }
  const ceiling = scoreCeilings(len, 1 - fuzziness);

  // Track the top `limit` scores so far. The final top-N selection keeps up
  // to ceil(limit) items; a heap that can never fill (limit ≥ rows) is skipped.
  const cap = Number.isFinite(limit) ? Math.ceil(limit) : n;
  const heap = cap < n ? new Float64Array(cap) : null;
  let heapLen = 0;
  let maxScore = 0;

  // Every slot read below was written earlier in this search, so the
  // buffer needs no clearing between searches
  const scores = index.scores;
  const record = (r: number, s: number) => {
    scores[r] = s;
    if (s > maxScore) maxScore = s;
    if (heap) {
      if (heapLen < cap) heapPush(heap, heapLen++, s);
      // biome-ignore lint/style/noNonNullAssertion: heap is full here
      else if (s > heap[0]!) heapReplaceTop(heap, heapLen, s);
    }
  };
  const scoreRow = (r: number) =>
    // biome-ignore lint/style/noNonNullAssertion: only called for rows with a search string
    string_score(strings[r]!, query, fuzziness, lowerQuery, undefined, lowers[r]);

  // Pass 1: rows containing every query class. They hold the best matches,
  // which raises the bar before the rest are considered.
  for (let r = 0; r < n; r++) {
    // biome-ignore lint/style/noNonNullAssertion: r < n
    const mask = masks[r]!;
    if (mask !== 0 && (queryMask & ~mask) === 0) record(r, scoreRow(r));
  }

  // Pass 2: everything else, in list order, skipping rows that can't beat
  // the bar. The bar only rises, and every skipped row scores below it.
  const out: IndexedScore<T>[] = [];
  for (let r = 0; r < n; r++) {
    // biome-ignore lint/style/noNonNullAssertion: r < n
    const mask = masks[r]!;
    if (mask === 0) continue;
    const missing = queryMask & ~mask;
    if (missing !== 0) {
      let misses = 0;
      for (let m = missing; m !== 0; m &= m - 1) {
        // biome-ignore lint/style/noNonNullAssertion: class index in [0, 31]
        misses += classCount[31 - Math.clz32(m & -m)]!;
      }
      if (misses >= len) continue; // no query character present: score 0
      const bar = Math.max(
        maxScore * threshold,
        // biome-ignore lint/style/noNonNullAssertion: heap is full here
        heap && heapLen === cap ? heap[0]! : 0,
      );
      // biome-ignore lint/style/noNonNullAssertion: misses < len
      if (ceiling[misses]! < bar) continue;
      record(r, scoreRow(r));
    }
    // biome-ignore lint/style/noNonNullAssertion: r < n
    const s = scores[r]!;
    if (s > 0) out.push({ item: list[r] as T, score: s });
  }
  return { items: out, maxScore };
}

/**
 * Upper bound on string_score's fuzzy-mode result for a query of length
 * `len` with at least `m` misses, for m in [0, len). Per found character the
 * score is at most 1.0 (0.1 base + 0.8 acronym + 0.1 case), found ≤ len - m
 * and found ≤ target length; misses scale the running score by
 * (1 - m/len)² and divide the result by 1 + m·(1 - fuzziness); the
 * first-character bonus adds at most 0.15. A small epsilon absorbs
 * floating-point differences.
 */
function scoreCeilings(len: number, fuzzyFactor: number): Float64Array {
  const ceiling = new Float64Array(len);
  ceiling[0] = Infinity; // exact matches and bonuses: never prune
  for (let m = 1; m < len; m++) {
    const kept = 1 - m / len;
    const base = (0.3 * kept * kept + 0.7 * kept * kept * kept) / (1 + m * fuzzyFactor);
    ceiling[m] = base + 0.15 + 1e-9;
  }
  return ceiling;
}

// Min-heap of scores (smallest at index 0)
function heapPush(heap: Float64Array, len: number, value: number): void {
  let i = len;
  heap[i] = value;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    // biome-ignore lint/style/noNonNullAssertion: indices in-bounds
    if (heap[parent]! <= heap[i]!) break;
    // biome-ignore lint/style/noNonNullAssertion: indices in-bounds
    const tmp = heap[i]!;
    // biome-ignore lint/style/noNonNullAssertion: indices in-bounds
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
    // biome-ignore lint/style/noNonNullAssertion: left < len guard
    if (left < len && heap[left]! < heap[smallest]!) smallest = left;
    // biome-ignore lint/style/noNonNullAssertion: right < len guard
    if (right < len && heap[right]! < heap[smallest]!) smallest = right;
    if (smallest === i) return;
    // biome-ignore lint/style/noNonNullAssertion: indices in-bounds
    const tmp = heap[i]!;
    // biome-ignore lint/style/noNonNullAssertion: indices in-bounds
    heap[i] = heap[smallest]!;
    heap[smallest] = tmp;
    i = smallest;
  }
}
