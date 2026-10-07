/**
 * seaq's scorer. A query is split into words; every word is matched against
 * the target on its own (so words can be typed in any order) and the word
 * scores are combined into one 0–1 score.
 *
 * Within a word, characters are matched left to right with bonuses for:
 * - **Consecutive characters** — "hel" in "hello" beats "h_e_l"
 * - **Start-of-word / acronym** — "HiMi" strongly matches "Hillsdale Michigan"
 * - **Capitals** — a capital typed in the query that matches a capital in
 *   the target adds a small bonus (lowercase typing is neutral)
 * - **Shorter targets** — matching in a short string is worth more
 *
 * Two alignments are tried per word — earliest occurrences, and one that
 * jumps to word starts ("IDE" → Integrated Development Environment) — and
 * the better one counts. Adjacent swapped characters ("laguht" → Laughton,
 * "msith" → John Smith) match at a small penalty per swap.
 *
 * With `fuzziness` 0 every query character must be found. With fuzziness > 0
 * (seaq's default is 0.2), missing characters are allowed but degrade the
 * score.
 *
 * Targets and query words are lowercased with {@link lowercase}, which keeps
 * every character in place: a position in the lowercased string is the same
 * position in the original.
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

/** The character-class bit for one lowercase UTF-16 code unit. */
function charBit(code: number): number {
  if (code >= 97 && code <= 122) return 1 << (code - 97);
  if (code >= 48 && code <= 57) return 1 << (27 + ((code - 48) >> 1));
  return 1 << 26;
}

/** A query split into words, prepared once per search. */
export interface QueryPlan {
  /** The query as given, for the exact-match shortcut. */
  query: string;
  /** Words as typed (for case bonuses) and lowercased (for matching). */
  words: string[];
  lowerWords: string[];
  /** Total characters across all words. */
  length: number;
  /** {@link charMask} of all words: whitespace in the query is never required. */
  mask: number;
}

export function planQuery(query: string): QueryPlan {
  const words = query.split(/\s+/).filter(Boolean);
  const lowerWords = words.map(lowercase);
  const joined = lowerWords.join('');
  return { query, words, lowerWords, length: joined.length, mask: charMask(joined) };
}

// Per-character scores
/** A match that doesn't continue a run. */
const BASE = 0.1;
/** Extra for a match at the start of a word, so acronyms count like runs. */
const WORD_START = 0.8;
/**
 * A character that continues a run. A word-start match earns 0.9, so a
 * prefix ("san" → Sandy) still edges out initials ("san" → Sulz am Neckar)
 * once the shorter target's coverage counts.
 */
const CONSECUTIVE = 0.8;
/** Extra for a capital typed in the query that matches the same capital. */
const CASE = 0.1;
/** The most one found character can add. */
const MAX_CHAR = Math.max(BASE + WORD_START, CONSECUTIVE) + CASE;

// Whole-target adjustments
/** Added when the first query character matches the target's first character. */
const FIRST_CHAR = 0.15;
/** Score multiplier per adjacent swap ("laguht" for "laught"). */
const SWAP_PENALTY = 0.9;
/** Score multiplier when query words match out of order. */
const WORD_ORDER_PENALTY = 0.9;

/** One query word's placement in the target. */
interface Alignment {
  /** Sum of the per-character scores. */
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
 * Does `pos` follow a space? (Position 0 starts a word too, but is handled
 * by the caller.) Never reads out of bounds: that sends V8 down a slow path
 * for every later call.
 */
const afterSpace = (lower: string, pos: number) => pos > 0 && lower.charCodeAt(pos - 1) === 32;

/** Score for a character placed at `pos`, before any case bonus. */
const charScore = (lower: string, pos: number, startAt: number, prevFound: boolean) =>
  pos === startAt && prevFound ? CONSECUTIVE : BASE + (afterSpace(lower, pos) ? WORD_START : 0);

/**
 * Small bonus when the query character was typed as a capital and the
 * target has the same capital there ("HiMi" → Hillsdale Michigan). Lowercase
 * typing earns nothing, so it doesn't favour lowercase targets.
 */
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

  for (let i = 0; i < lowerWord.length; i++) {
    const ch = lowerWord.charAt(i);
    let pos = lower.indexOf(ch, startAt);
    if (pos < 0) {
      if (!fuzzy) return false;
      misses++;
      prevFound = false;
      continue;
    }

    if (pos > startAt) {
      if (
        i + 1 < lowerWord.length &&
        lower.charCodeAt(pos - 1) === lowerWord.charCodeAt(i + 1) &&
        (!preferStarts || pos === startAt + 1)
      ) {
        const at = pos - 1;
        rs +=
          charScore(lower, at, startAt, prevFound) +
          caseBonus(raw, at, word, lowerWord, i + 1) +
          CONSECUTIVE +
          caseBonus(raw, pos, word, lowerWord, i);
        // The character may also start a word later on, unswapped ("smith"
        // in "Msith Smith"): let the word-start alignment try
        skippedMask |= charBit(lower.charCodeAt(pos));
        if (first < 0) first = at;
        if (collect) a.positions.push(at, pos);
        swaps++;
        startAt = pos + 1;
        prevFound = true;
        i++;
        continue;
      }
      if (!afterSpace(lower, pos)) {
        if (preferStarts) {
          for (let j = lower.indexOf(ch, pos + 1); j >= 0; j = lower.indexOf(ch, j + 1)) {
            if (afterSpace(lower, j)) {
              pos = j;
              break;
            }
          }
        }
        if (!afterSpace(lower, pos)) skippedMask |= charBit(lowerWord.charCodeAt(i));
      }
    }

    rs += charScore(lower, pos, startAt, prevFound) + caseBonus(raw, pos, word, lowerWord, i);
    if (first < 0) first = pos;
    if (collect) a.positions.push(pos);
    startAt = pos + 1;
    prevFound = true;
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
    // biome-ignore lint/style/noNonNullAssertion: w < lowerWords.length
    const lowerWord = lowerWords[w]!;
    // biome-ignore lint/style/noNonNullAssertion: words and lowerWords are parallel
    const word = words[w]!;
    // The earliest-occurrence alignment places every character whenever
    // any alignment can: if it fails, the word doesn't match
    if (!align(earliest, false, raw, lower, word, lowerWord, fuzzy, collect)) return 0;
    let best = earliest;

    // The word-start alignment only differs if the first one jumped mid-word
    // to a character that also starts a word somewhere. It's about ranking
    // good matches (acronyms), so skip it for words with misses — in fuzzy
    // mode that's most rows, and they rank low anyway.
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

  // biome-ignore lint/style/noNonNullAssertion: plan.length > 0 ⇒ a non-empty word exists
  if (lowerWords[0]!.charCodeAt(0) === lower.charCodeAt(0) && score < 0.85) score += FIRST_CHAR;
  if (swaps > 0) score *= SWAP_PENALTY ** swaps;
  if (outOfOrder) score *= WORD_ORDER_PENALTY;

  if (positions) sortUnique(positions);
  return score;
}

/** Sort `list` ascending and drop duplicates, in place. */
function sortUnique(list: number[]): void {
  list.sort((a, b) => a - b);
  let n = 0;
  for (const p of list) if (n === 0 || p !== list[n - 1]) list[n++] = p;
  list.length = n;
}

/**
 * Does `lowerWord` match `lower` with fuzziness off (every character, left
 * to right, adjacent swaps allowed)? A cheap pre-check, no scoring.
 */
export function matchesStrict(lower: string, lowerWord: string): boolean {
  return align(earliest, false, lower, lower, lowerWord, lowerWord, false, false);
}

/**
 * An upper bound on {@link scoreString} for `plan` in fuzzy mode, from a
 * target's {@link charMask} and length: a search can skip targets that
 * can't reach its results without scoring them. `Infinity` when the target
 * has every class the query uses.
 *
 * Every query character in a class the target lacks is a certain miss, and
 * more misses only lower the score. Following scoreString with `m` misses
 * out of `len` characters (kept k = 1 - m/len): each found character adds
 * at most MAX_CHAR and at most len - m are found, so rs ≤ MAX_CHAR·(len -
 * m)·k². Each word's found characters sit at distinct target positions, so
 * also rs ≤ MAX_CHAR·words·length·k², which bounds coverage. FIRST_CHAR is
 * added unconditionally; swap and word-order penalties only lower the score.
 */
export function scoreCeiling(
  plan: QueryPlan,
  fuzziness: number,
): (mask: number, length: number) => number {
  const len = plan.length;
  const words = plan.words.length;
  // How many query characters fall in each class
  const classCount = new Array<number>(32).fill(0);
  for (const word of plan.lowerWords) {
    for (let i = 0; i < word.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: class index in [0, 31]
      classCount[31 - Math.clz32(charBit(word.charCodeAt(i)))]!++;
    }
  }

  // The bound split by miss count m, so the per-target part is one division
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

  return (mask, length) => {
    let misses = 0;
    for (let m = plan.mask & ~mask; m !== 0; m &= m - 1) {
      // biome-ignore lint/style/noNonNullAssertion: class index in [0, 31]
      misses += classCount[31 - Math.clz32(m & -m)]!;
    }
    if (misses === len) return 0; // nothing can be found
    // biome-ignore lint/style/noNonNullAssertion: misses < len
    const perLength = coveragePerLength[misses]! / length;
    // biome-ignore lint/style/noNonNullAssertion: misses < len
    return fixed[misses]! + Math.min(coverageCap[misses]!, perLength);
  };
}
