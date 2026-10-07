/**
 * Scores query words independently, allowing reordered words and adjacent
 * swaps. Compares earliest and word-start alignments, rewarding consecutive
 * matches, word starts, matching capitals, and shorter targets.
 */

/**
 * Lowercase `s` without changing its length. `toLowerCase()` only lengthens
 * 'İ' (to 'i' plus a combining dot); such characters keep the first code
 * unit of their lowercase form. Everything else comes from lowercasing the
 * whole string, so context-dependent forms (final sigma 'ς') are kept.
 */
export function lowercase(s: string): string {
  const lower = s.toLowerCase();
  if (lower.length === s.length) return lower;
  let out = '';
  let at = 0;
  for (const ch of s) {
    out += lower.slice(at, at + ch.length);
    at += ch.toLowerCase().length;
  }
  return out;
}

/**
 * The character classes in a lowercased string: bits 0-25 for a-z, bits
 * 27-31 for digits in pairs (0-1, 2-3, …) so numeric queries still filter,
 * bit 26 for everything else.
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

export interface QueryPlan {
  /** The query as given, for the exact-match shortcut. */
  query: string;
  /** Words as typed (for case bonuses) and lowercased (for matching). */
  words: string[];
  lowerWords: string[];
  /** Characters (code points) across all words, not counting whitespace between them. */
  length: number;
  /** {@link charMask} of all words: whitespace in the query is never required. */
  mask: number;
}

export function planQuery(query: string): QueryPlan {
  const words = query.split(/\s+/).filter(Boolean);
  const lowerWords = words.map(lowercase);
  const joined = lowerWords.join('');
  let length = 0;
  for (const _ of joined) length++;
  return { query, words, lowerWords, length, mask: charMask(joined) };
}

// Per-character scores. Word starts (BASE + WORD_START = 0.9) count about
// like runs, so acronyms score well, but a bit more: a prefix ("san" →
// Sandy) still edges out initials ("san" → Sulz am Neckar) once the shorter
// target's coverage counts.
const BASE = 0.1;
const WORD_START = 0.8;
const CONSECUTIVE = 0.8;
const CASE = 0.1;
const MAX_CHAR = Math.max(BASE + WORD_START, CONSECUTIVE) + CASE;

// Whole-target adjustments
const FIRST_CHAR = 0.15;
const SWAP_PENALTY = 0.9;
const WORD_ORDER_PENALTY = 0.9;

/** One query word's placement in the target. */
interface Alignment {
  rs: number;
  misses: number;
  swaps: number;
  /** Position of the first placed character, or -1. */
  first: number;
  /** Classes of characters placed mid-word after skipping text, or swapped. */
  skippedMask: number;
  positions: number[];
}

const newAlignment = (): Alignment => ({
  rs: 0,
  misses: 0,
  swaps: 0,
  first: -1,
  skippedMask: 0,
  positions: [],
});
// Reused across calls (scoring is synchronous and never re-entered)
const earliest = newAlignment();
const starts = newAlignment();

/**
 * Does `pos` follow a space? (Position 0 is left to the caller.) The `pos > 0`
 * guard avoids `charCodeAt(-1)`, which measured slower in later calls on V8.
 */
const afterSpace = (lower: string, pos: number) => pos > 0 && lower.charCodeAt(pos - 1) === 32;

/** 2 at a surrogate pair (a character outside the BMP), otherwise 1. */
const unitsAt = (s: string, i: number) =>
  (s.charCodeAt(i) & 0xfc00) === 0xd800 &&
  i + 1 < s.length &&
  (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00
    ? 2
    : 1;

const charScore = (lower: string, pos: number, startAt: number, prevFound: boolean) =>
  pos === startAt && prevFound ? CONSECUTIVE : BASE + (afterSpace(lower, pos) ? WORD_START : 0);

// Only matching capitals typed in the query earn a case bonus.
function caseBonus(raw: string, pos: number, word: string, lowerWord: string, i: number): number {
  const typed = word.charCodeAt(i);
  return typed !== lowerWord.charCodeAt(i) && raw.charCodeAt(pos) === typed ? CASE : 0;
}

/**
 * Align one query word against the target into `a`, placing each character
 * at its earliest occurrence. Returns false when a character is missing and
 * fuzziness is off.
 *
 * A swapped pair ("ua" for "au") is taken whenever the earliest occurrence
 * of a character comes right after the next query character. Taking the
 * pair there never rules out a placement that a single character would
 * allow, so this places every character whenever that's possible at all.
 *
 * `preferStarts` instead jumps to a later word-start occurrence when a run
 * can't continue, and only takes pairs where the previous match left off.
 */
function align(
  a: Alignment,
  preferStarts: boolean,
  raw: string,
  lower: string,
  word: string,
  lowerWord: string,
  fuzzy: boolean,
  collect: boolean,
): boolean {
  let rs = 0;
  let misses = 0;
  let swaps = 0;
  let first = -1;
  let skippedMask = 0;
  let startAt = 0;
  let prevFound = true;
  if (collect) a.positions.length = 0;

  const wordLength = lowerWord.length;
  for (let i = 0; i < wordLength; ) {
    const n = unitsAt(lowerWord, i);
    const ch = n === 1 ? lowerWord.charAt(i) : lowerWord.slice(i, i + 2);
    let pos = lower.indexOf(ch, startAt);
    if (pos < 0) {
      if (!fuzzy) return false;
      misses++;
      prevFound = false;
      i += n;
      continue;
    }

    if (pos > startAt) {
      // The next query character, `m` units at `j`, right before this one
      const j = i + n;
      const m = j < wordLength ? unitsAt(lowerWord, j) : 0;
      if (
        m !== 0 &&
        pos - m >= startAt &&
        lower.charCodeAt(pos - 1) === lowerWord.charCodeAt(j + m - 1) &&
        (m === 1 || lower.charCodeAt(pos - 2) === lowerWord.charCodeAt(j)) &&
        (!preferStarts || pos === startAt + m)
      ) {
        const at = pos - m;
        rs +=
          charScore(lower, at, startAt, prevFound) +
          caseBonus(raw, at, word, lowerWord, j) +
          CONSECUTIVE +
          caseBonus(raw, pos, word, lowerWord, i);
        // The character may also start a word later on, unswapped ("smith"
        // in "Msith Smith"): let the word-start alignment try
        skippedMask |= charBit(lower.charCodeAt(pos));
        if (first < 0) first = at;
        if (collect) for (let p = at; p < pos + n; p++) a.positions.push(p);
        swaps++;
        startAt = pos + n;
        prevFound = true;
        i = j + m;
        continue;
      }
      if (!afterSpace(lower, pos)) {
        if (preferStarts) {
          for (let k = lower.indexOf(ch, pos + 1); k >= 0; k = lower.indexOf(ch, k + 1)) {
            if (afterSpace(lower, k)) {
              pos = k;
              break;
            }
          }
        }
        if (!afterSpace(lower, pos)) skippedMask |= charBit(lowerWord.charCodeAt(i));
      }
    }

    rs += charScore(lower, pos, startAt, prevFound) + caseBonus(raw, pos, word, lowerWord, i);
    if (first < 0) first = pos;
    if (collect) {
      a.positions.push(pos);
      if (n === 2) a.positions.push(pos + 1);
    }
    startAt = pos + n;
    prevFound = true;
    i += n;
  }

  a.rs = rs;
  a.misses = misses;
  a.swaps = swaps;
  a.first = first;
  a.skippedMask = skippedMask;
  return true;
}

/** Fewer misses wins, then the higher swap-penalized character score. */
function better(a: Alignment, b: Alignment): boolean {
  return (
    a.misses < b.misses ||
    (a.misses === b.misses && a.rs * SWAP_PENALTY ** a.swaps > b.rs * SWAP_PENALTY ** b.swaps)
  );
}

/**
 * Character classes that start a word in `lower`: position 0 or after a
 * space. Lets the word-start alignment be skipped when it can't differ.
 */
export function wordStartMask(lower: string): number {
  let mask = 0;
  for (let i = 0; i < lower.length; i++) {
    if (i === 0 || afterSpace(lower, i)) mask |= charBit(lower.charCodeAt(i));
  }
  return mask;
}

/**
 * Score `raw` (lowercased as `lower` by {@link lowercase}) against a query
 * plan. `wordStarts` is the target's {@link wordStartMask}, or -1 to work it
 * out when needed. When `positions` (empty) is given, it receives the
 * matched character positions, sorted and de-duplicated.
 */
export function scoreString(
  plan: QueryPlan,
  raw: string,
  lower: string,
  wordStarts: number,
  fuzziness: number,
  positions?: number[],
): number {
  if (raw === plan.query) {
    if (positions) for (let p = 0; p < raw.length; p++) positions.push(p);
    return 1;
  }

  const fuzzy = fuzziness > 0;
  const collect = positions !== undefined;
  const { words, lowerWords } = plan;
  let rs = 0;
  let misses = 0;
  let swaps = 0;
  let prevFirst = -1;
  let outOfOrder = false;

  for (let w = 0; w < lowerWords.length; w++) {
    const lowerWord = lowerWords[w]!;
    const word = words[w]!;
    // The earliest-occurrence alignment places every character whenever
    // any alignment can: if it fails, the word doesn't match
    if (!align(earliest, false, raw, lower, word, lowerWord, fuzzy, collect)) return 0;
    let best = earliest;

    // The word-start alignment can only differ where the earliest one placed
    // a character mid-word after skipping text, or swapped a pair, and that
    // character also starts a word somewhere. It's for ranking good matches,
    // so words with misses (most fuzzy rows) skip it.
    if (best.misses === 0 && best.skippedMask !== 0) {
      if (wordStarts === -1) wordStarts = wordStartMask(lower);
      if (
        (best.skippedMask & wordStarts) !== 0 &&
        align(starts, true, raw, lower, word, lowerWord, fuzzy, collect) &&
        better(starts, best)
      ) {
        best = starts;
      }
    }

    rs += best.rs;
    misses += best.misses;
    swaps += best.swaps;
    if (best.first >= 0) {
      if (best.first < prevFirst) outOfOrder = true;
      prevFirst = best.first;
    }
    if (positions) for (const p of best.positions) positions.push(p);
  }

  // Nothing found at all (fuzzy mode, an empty target or an empty query)
  if (misses >= plan.length) return 0;

  let fuzzies = 1;
  if (misses > 0) {
    // Quadratic degradation: 0% miss → 1.0×, 50% miss → 0.25×
    const kept = 1 - misses / plan.length;
    rs *= kept * kept;
    fuzzies = 1 + misses * (1 - fuzziness);
  }

  // Words may overlap in the target, so cap target coverage at 1
  let coverage = rs / raw.length;
  if (coverage > 1) coverage = 1;
  let score = (0.3 * coverage + 0.7 * (rs / plan.length)) / fuzzies;

  if (lowerWords[0]!.codePointAt(0) === lower.codePointAt(0) && score < 0.85) score += FIRST_CHAR;
  if (swaps > 0) score *= SWAP_PENALTY ** swaps;
  if (outOfOrder) score *= WORD_ORDER_PENALTY;

  if (positions) sortUnique(positions);
  return score;
}

function sortUnique(list: number[]): void {
  list.sort((a, b) => a - b);
  let n = 0;
  for (const p of list) if (n === 0 || p !== list[n - 1]) list[n++] = p;
  list.length = n;
}

/** Would `lowerWord` match `lower` with fuzziness 0? */
export function matchesStrict(lower: string, lowerWord: string): boolean {
  return align(earliest, false, lower, lower, lowerWord, lowerWord, false, false);
}

/**
 * Tables for an upper bound on {@link scoreString} for `plan` in fuzzy
 * mode, from a target's {@link charMask} and length ({@link scoreBound}): a
 * search can skip targets that can't reach its results without scoring
 * them. The bound is `Infinity` when the target has every class the query
 * uses.
 *
 * Every query character in a class the target lacks is a certain miss, and
 * more misses only lower the score. Following scoreString with `m` misses
 * out of `len` characters (kept k = 1 - m/len): each found character adds
 * at most MAX_CHAR and at most len - m are found, so rs ≤ MAX_CHAR·(len -
 * m)·k². Each word's found characters sit at distinct target positions, so
 * also rs ≤ MAX_CHAR·words·length·k², which bounds coverage. FIRST_CHAR is
 * added unconditionally; swap and word-order penalties only lower the score.
 */
export interface Ceiling {
  queryMask: number;
  length: number;
  /** Query characters per class. */
  classCount: Int32Array;
  // The bound split by miss count m, so the per-target part is one division
  fixed: Float64Array;
  coverageCap: Float64Array;
  coveragePerLength: Float64Array;
}

export function scoreCeiling(plan: QueryPlan, fuzziness: number): Ceiling {
  const len = plan.length;
  const words = plan.words.length;
  const classCount = new Int32Array(32);
  for (const word of plan.lowerWords) {
    for (const ch of word) classCount[31 - Math.clz32(charBit(ch.charCodeAt(0)))]!++;
  }
  const fixed = new Float64Array(len);
  const coverageCap = new Float64Array(len);
  const coveragePerLength = new Float64Array(len);
  fixed[0] = Number.POSITIVE_INFINITY;
  for (let m = 1; m < len; m++) {
    const kept = 1 - m / len;
    const rs = MAX_CHAR * (len - m) * kept * kept;
    const divisor = 1 + m * (1 - fuzziness);
    // The epsilon absorbs floating-point differences in the order of operations
    fixed[m] = (0.7 * rs) / len / divisor + FIRST_CHAR + 1e-9;
    coverageCap[m] = (0.3 * Math.min(1, MAX_CHAR * words * kept * kept)) / divisor;
    coveragePerLength[m] = (0.3 * rs) / divisor;
  }
  return { queryMask: plan.mask, length: len, classCount, fixed, coverageCap, coveragePerLength };
}

/** The bound for a target with classes `mask` and length `length`. */
export function scoreBound(c: Ceiling, mask: number, length: number): number {
  let misses = 0;
  for (let m = c.queryMask & ~mask; m !== 0; m &= m - 1) {
    misses += c.classCount[31 - Math.clz32(m & -m)]!;
  }
  if (misses === c.length) return 0; // nothing can be found
  const perLength = c.coveragePerLength[misses]! / length;
  return c.fixed[misses]! + Math.min(c.coverageCap[misses]!, perLength);
}
