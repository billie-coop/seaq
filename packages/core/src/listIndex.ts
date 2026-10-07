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
import { charBit, charMask, planQuery, type QueryPlan, scoreTarget, wordStartMask } from './score';

interface ListIndex {
  /** The list entries each row was prepared from, for change detection. */
  items: unknown[];
  /** Search string per row; `null` for entries that never match. */
  strings: Array<string | null>;
  /**
   * Lowercased search strings as UTF-16 code units, packed into one buffer:
   * row r occupies codes[codeStart[r] .. codeEnd[r]). Replaced rows are
   * appended at the end; the buffer is compacted when dead space dominates.
   */
  codes: Uint16Array;
  codesLen: number;
  liveCodes: number;
  codeStart: Uint32Array;
  codeEnd: Uint32Array;
  masks: Uint32Array;
  /** Per-row {@link wordStartMask}, to skip pointless word-start alignments. */
  wordStarts: Uint32Array;
  /** 32 bitmaps of `words` 32-bit words each: bit r of bitmap b ⇔ row r has class b. */
  bits: Uint32Array;
  words: number;
  /** Strict-mode narrowing state: rows that scored > 0 for `lastLower`. */
  lastLower: string | null;
  lastRows: Int32Array;
  lastRowsLen: number;
  /** Per-row score scratch space, reused across searches. */
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
 * `maxScore` is always the true best score.
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
  const plan = planQuery(query);
  const lowerQuery = query.toLowerCase();
  // Words match independently, so whitespace in the query is never required
  const queryMask = charMask(plan.lowerWords.join(''));
  const top = new TopScores(limit, threshold, list.length);
  const rowsLen = fuzziness
    ? scoreFuzzy(index, plan, queryMask, fuzziness, top)
    : scoreStrict(index, plan, lowerQuery, queryMask, top);

  // Materialize only rows that can still make the result: anything below
  // the final bar is cut by the threshold or by the top-N selection
  const bar = top.bar();
  const { lastRows: rows, scores } = index;
  const items: IndexedScore<T>[] = [];
  for (let i = 0; i < rowsLen; i++) {
    // biome-ignore lint/style/noNonNullAssertion: i < rowsLen ≤ rows.length
    const r = rows[i]!;
    // biome-ignore lint/style/noNonNullAssertion: r is a valid row
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
    // The final top-N keeps up to ceil(limit) items; a heap that can never
    // fill (limit ≥ rows) is skipped
    this.cap = Number.isFinite(limit) ? Math.ceil(limit) : rows;
    this.heap = this.cap < rows ? new Float64Array(this.cap) : null;
  }

  record(s: number): void {
    if (s > this.max) this.max = s;
    const heap = this.heap;
    if (!heap) return;
    if (this.len < this.cap) heapPush(heap, this.len++, s);
    // biome-ignore lint/style/noNonNullAssertion: heap is full here
    else if (s > heap[0]!) heapReplaceTop(heap, this.len, s);
  }

  bar(): number {
    const cutoff = this.max * this.threshold;
    // biome-ignore lint/style/noNonNullAssertion: heap is full here
    const weakest = this.heap && this.len === this.cap ? this.heap[0]! : 0;
    return cutoff > weakest ? cutoff : weakest;
  }
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
  if (repaired) {
    index.lastLower = null;
    if (index.codesLen > 2 * index.liveCodes + 1024) compactCodes(index);
  }
  return index;
}

function buildIndex<T>(list: T[], prep: (item: T) => string | null): ListIndex {
  const n = list.length;
  const words = (n + 31) >> 5;
  const index: ListIndex = {
    items: new Array(n),
    strings: new Array(n),
    codes: new Uint16Array(n * 16),
    codesLen: 0,
    liveCodes: 0,
    codeStart: new Uint32Array(n),
    codeEnd: new Uint32Array(n),
    masks: new Uint32Array(n),
    wordStarts: new Uint32Array(n),
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
  writeCodes(index, r, lower);
  const mask = charMask(lower);
  index.masks[r] = mask;
  index.wordStarts[r] = str === null ? 0 : wordStartMask(str, lower);
  for (let m = mask; m !== 0; m &= m - 1) {
    const at = (31 - Math.clz32(m & -m)) * words + word;
    // biome-ignore lint/style/noNonNullAssertion: at < 32 * words
    bits[at] = bits[at]! | bit;
  }
}

/** Append a row's lowercase code units to the packed buffer. */
function writeCodes(index: ListIndex, r: number, lower: string): void {
  const len = lower.length;
  if (index.codesLen + len > index.codes.length) {
    const grown = new Uint16Array(Math.max(index.codes.length * 2, index.codesLen + len));
    grown.set(index.codes.subarray(0, index.codesLen));
    index.codes = grown;
  }
  // biome-ignore lint/style/noNonNullAssertion: r < row count
  index.liveCodes += len - (index.codeEnd[r]! - index.codeStart[r]!);
  const codes = index.codes;
  let at = index.codesLen;
  index.codeStart[r] = at;
  for (let i = 0; i < len; i++) codes[at++] = lower.charCodeAt(i);
  index.codeEnd[r] = at;
  index.codesLen = at;
}

/** Rewrite the packed buffer without the slots of replaced rows. */
function compactCodes(index: ListIndex): void {
  const { codes, codeStart, codeEnd } = index;
  const packed = new Uint16Array(Math.max(index.liveCodes, 16));
  let at = 0;
  for (let r = 0; r < codeStart.length; r++) {
    // biome-ignore lint/style/noNonNullAssertion: r < row count
    const start = codeStart[r]!;
    // biome-ignore lint/style/noNonNullAssertion: r < row count
    const end = codeEnd[r]!;
    packed.set(codes.subarray(start, end), at);
    codeStart[r] = at;
    at += end - start;
    codeEnd[r] = at;
  }
  index.codes = packed;
  index.codesLen = at;
}

/**
 * Strict scoring. Writes every row scoring > 0 to `index.lastRows` in list
 * order (also the narrowing state for the next keystroke) and returns how
 * many there are.
 */
function scoreStrict(
  index: ListIndex,
  plan: QueryPlan,
  lowerQuery: string,
  queryMask: number,
  top: TopScores,
): number {
  const { strings, codes, codeStart, codeEnd, masks, wordStarts, scores } = index;
  const matched = index.lastRows;
  let matchedLen = 0;

  const score = (r: number) => {
    const s = scoreTarget(
      plan,
      // biome-ignore lint/style/noNonNullAssertion: candidates are rows with a non-empty mask, so strings[r] is set
      strings[r]!,
      codes,
      // biome-ignore lint/style/noNonNullAssertion: r is a valid row
      codeStart[r]!,
      // biome-ignore lint/style/noNonNullAssertion: r is a valid row
      codeEnd[r]!,
      0,
      undefined,
      wordStarts[r],
    );
    if (s > 0) {
      matched[matchedLen++] = r;
      scores[r] = s;
      top.record(s);
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
  return matchedLen;
}

/**
 * Fuzzy scoring. Writes every scored row with score > 0 to
 * `index.lastRows` in list order and returns how many there are.
 */
function scoreFuzzy(
  index: ListIndex,
  plan: QueryPlan,
  queryMask: number,
  fuzziness: number,
  top: TopScores,
): number {
  // Narrowing state only holds for strict scores; lastRows is reused below
  index.lastLower = null;

  const { strings, codes, codeStart, codeEnd, masks, wordStarts, scores } = index;
  const rows = index.lastRows;
  let rowsLen = 0;
  const n = masks.length;
  const len = plan.length;

  // How many query characters fall in each class: a class missing from a
  // row guarantees at least that many misses
  const classCount = new Uint8Array(32);
  for (const word of plan.lowerWords) {
    for (let i = 0; i < word.length; i++) {
      const b = 31 - Math.clz32(charBit(word.charCodeAt(i)));
      // biome-ignore lint/style/noNonNullAssertion: b in [0, 31]
      if (classCount[b]! < 255) classCount[b]!++;
    }
  }
  const ceiling = scoreCeilings(len, plan.words.length, 1 - fuzziness);

  // Every scores[] slot read below was written earlier in this search, so
  // the buffer needs no clearing between searches
  const record = (r: number, s: number) => {
    scores[r] = s;
    top.record(s);
  };
  const scoreRow = (r: number) =>
    scoreTarget(
      plan,
      // biome-ignore lint/style/noNonNullAssertion: only called for rows with a search string
      strings[r]!,
      codes,
      // biome-ignore lint/style/noNonNullAssertion: r is a valid row
      codeStart[r]!,
      // biome-ignore lint/style/noNonNullAssertion: r is a valid row
      codeEnd[r]!,
      fuzziness,
      undefined,
      wordStarts[r],
    );

  // Pass 1: rows containing every query class. They hold the best matches,
  // which raises the bar before the rest are considered.
  for (let r = 0; r < n; r++) {
    // biome-ignore lint/style/noNonNullAssertion: r < n
    const mask = masks[r]!;
    if (mask !== 0 && (queryMask & ~mask) === 0) record(r, scoreRow(r));
  }

  // Pass 2: everything else, in list order, skipping rows that can't beat
  // the bar. The bar only rises, and every skipped row scores below it.
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
      // biome-ignore lint/style/noNonNullAssertion: only rows with a search string have a mask
      const targetLen = strings[r]!.length;
      // biome-ignore lint/style/noNonNullAssertion: misses < len
      const coverage = Math.min(
        ceiling.coverage[misses]!,
        ceiling.coveragePerChar[misses]! / targetLen,
      );
      // biome-ignore lint/style/noNonNullAssertion: misses < len
      if (ceiling.rest[misses]! + coverage < top.bar()) continue;
      record(r, scoreRow(r));
    }
    // biome-ignore lint/style/noNonNullAssertion: r < n
    const s = scores[r]!;
    if (s > 0) rows[rowsLen++] = r;
  }
  return rowsLen;
}

/**
 * Upper bound on the scorer's fuzzy-mode result (see score.ts) for a query
 * of `len` characters in `words` words with at least `m` misses (m in
 * [1, len)), split so the target length can tighten it per row:
 *
 *   score ≤ rest[m] + min(coverage[m], coveragePerChar[m] / targetLength)
 *
 * Per found character the running score gains at most 1.0 (0.1 base + 0.8
 * acronym + 0.1 case) and found ≤ len - m; misses scale it by k²
 * (k = 1 - m/len) and divide the result by 1 + m·(1 - fuzziness). So the
 * query term 0.7·rs/len ≤ 0.7·k³. The coverage term 0.3·min(1, rs/target)
 * is ≤ 0.3·(len - m)·k² / target, and also ≤ 0.3·min(1, words·k²) because
 * each word's found characters fit in the target. The first-character bonus
 * adds at most 0.15; swap and word-order penalties only lower the score. A
 * small epsilon absorbs floating-point differences. m = 0 is never pruned.
 */
function scoreCeilings(
  len: number,
  words: number,
  fuzzyFactor: number,
): { rest: Float64Array; coverage: Float64Array; coveragePerChar: Float64Array } {
  const rest = new Float64Array(len);
  const coverage = new Float64Array(len);
  const coveragePerChar = new Float64Array(len);
  rest[0] = Infinity; // exact matches and bonuses: never prune
  for (let m = 1; m < len; m++) {
    const kept = 1 - m / len;
    const divisor = 1 + m * fuzzyFactor;
    rest[m] = (0.7 * kept * kept * kept) / divisor + 0.15 + 1e-9;
    coverage[m] = (0.3 * Math.min(1, words * kept * kept)) / divisor;
    coveragePerChar[m] = (0.3 * (len - m) * kept * kept) / divisor;
  }
  return { rest, coverage, coveragePerChar };
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
