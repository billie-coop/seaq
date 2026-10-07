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
 * the better one counts. Adjacent swapped characters ("laguht" → Laughton)
 * still match, at a small penalty.
 *
 * With `fuzziness` 0 every query character must be found. With fuzziness > 0
 * (seaq's default is 0.2), missing characters are allowed but degrade the
 * score.
 *
 * The target is read as lowercase UTF-16 code units (`codes[start..end)`)
 * alongside the original string for case and word-start checks.
 */

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
export function charBit(code: number): number {
  if (code >= 97 && code <= 122) return 1 << (code - 97);
  if (code >= 48 && code <= 57) return 1 << (27 + ((code - 48) >> 1));
  return 1 << 26;
}

/**
 * Character classes (see {@link charMask}) that appear at the start of a
 * word: position 0 or right after a space, the same rule the acronym bonus
 * uses. `lower` is `raw` lowercased.
 */
export function wordStartMask(raw: string, lower: string): number {
  let mask = 0;
  for (let i = 0; i < lower.length; i++) {
    if (i === 0 || raw.charCodeAt(i - 1) === 32) mask |= charBit(lower.charCodeAt(i));
  }
  return mask;
}

/** A query split into words, prepared once per search. */
export interface QueryPlan {
  /** The query as given, for the exact-match shortcut. */
  query: string;
  /** Words as typed (for case bonuses) and lowercased (for matching). */
  words: string[];
  lowerWords: string[];
  /** Total lowercase characters across all words. */
  length: number;
}

/**
 * Score for a character that continues a run. A word-start match earns 0.9,
 * so a prefix ("san" → Sandy) still edges out initials ("san" → Sulz am
 * Neckar) once the shorter target's coverage counts.
 */
const CONSECUTIVE = 0.8;

/** Score multiplier per adjacent swap ("laguht" for "laught"). */
export const SWAP_PENALTY = 0.9;
/** Score multiplier when query words match out of order. */
export const WORD_ORDER_PENALTY = 0.9;

export function planQuery(query: string): QueryPlan {
  const words = query.split(/\s+/).filter(Boolean);
  const lowerWords = words.map((w) => w.toLowerCase());
  let length = 0;
  for (const w of lowerWords) length += w.length;
  return { query, words, lowerWords, length };
}

// Result of the last align() call (module scratch avoids allocating per call)
let alignRs = 0;
let alignMisses = 0;
let alignSwaps = 0;
let alignFirst = -1;
/** Classes of characters align() placed mid-word after a jump. */
let alignSkippedMask = 0;
const positionsA: number[] = [];
const positionsB: number[] = [];

/**
 * Small bonus when the query character was typed as a capital and the
 * target has the same capital there ("HiMi" → Hillsdale Michigan). Lowercase
 * typing earns nothing, so it doesn't favour lowercase targets.
 */
function caseBonus(raw: string, pos: number, word: string, lowerWord: string, i: number): number {
  const typed = word.charCodeAt(i);
  return typed !== lowerWord.charCodeAt(i) && raw.charCodeAt(pos) === typed ? 0.1 : 0;
}

/**
 * Align one query word against the target. `preferStarts` jumps to the next
 * word-start occurrence of a character when it can't continue consecutively.
 * Returns false when a character is missing and fuzziness is off.
 *
 * The lowercased target is read from `lower` when given (native indexOf, no
 * copying), otherwise from `codes[start..end)` (the list index's buffer).
 */
function align(
  preferStarts: boolean,
  raw: string,
  codes: Uint16Array,
  start: number,
  end: number,
  lower: string | null,
  lowerWord: string,
  word: string,
  fuzzy: boolean,
  out: number[] | null,
): boolean {
  const len = end - start;
  const wordLen = lowerWord.length;
  let rs = 0;
  let misses = 0;
  let swaps = 0;
  let first = -1;
  let skippedMask = 0;
  let startAt = 0;
  let prevFound = true;
  let i = 0;

  while (i < wordLen) {
    const code = lowerWord.charCodeAt(i);
    const here = codeAt(lower, codes, start, len, startAt);

    // Adjacent swap: the target continues with word[i+1] word[i]
    if (
      i + 1 < wordLen &&
      here !== code &&
      here === lowerWord.charCodeAt(i + 1) &&
      codeAt(lower, codes, start, len, startAt + 1) === code
    ) {
      let cs = prevFound ? CONSECUTIVE : 0.1 + (raw.charCodeAt(startAt - 1) === 32 ? 0.8 : 0);
      cs += caseBonus(raw, startAt, word, lowerWord, i + 1);
      rs += cs;
      cs = CONSECUTIVE;
      cs += caseBonus(raw, startAt + 1, word, lowerWord, i);
      rs += cs;
      if (first < 0) first = startAt;
      if (out) out.push(startAt, startAt + 1);
      swaps++;
      startAt += 2;
      prevFound = true;
      i += 2;
      continue;
    }

    let pos = -1;
    if (here === code) {
      pos = startAt;
    } else {
      const next = nextIndex(lower, codes, start, len, lowerWord, i, code, startAt);
      if (preferStarts) {
        for (
          let j = next;
          j >= 0;
          j = nextIndex(lower, codes, start, len, lowerWord, i, code, j + 1)
        ) {
          if (j === 0 || raw.charCodeAt(j - 1) === 32) {
            pos = j;
            break;
          }
        }
      }
      if (pos < 0) {
        pos = next;
        if (pos > 0 && raw.charCodeAt(pos - 1) !== 32) skippedMask |= charBit(code);
      }
    }

    if (pos < 0) {
      if (!fuzzy) return false;
      misses++;
      prevFound = false;
      i++;
      continue;
    }

    let cs: number;
    if (pos === startAt && prevFound) {
      cs = CONSECUTIVE;
    } else {
      cs = 0.1;
      // Acronym bonus: a word-start match counts like two consecutive ones
      if (raw.charCodeAt(pos - 1) === 32) cs += 0.8;
    }
    cs += caseBonus(raw, pos, word, lowerWord, i);
    rs += cs;
    if (first < 0) first = pos;
    if (out) out.push(pos);
    startAt = pos + 1;
    prevFound = true;
    i++;
  }

  alignRs = rs;
  alignMisses = misses;
  alignSwaps = swaps;
  alignFirst = first;
  alignSkippedMask = skippedMask;
  return true;
}

/** The lowercase code unit at `j` of the target, or -1 past its end. */
function codeAt(
  lower: string | null,
  codes: Uint16Array,
  start: number,
  len: number,
  j: number,
): number {
  if (j >= len) return -1;
  return lower !== null ? lower.charCodeAt(j) : (codes[start + j] as number);
}

/** Next index ≥ `from` of `code` (= lowerWord[i]) in the target, or -1. */
function nextIndex(
  lower: string | null,
  codes: Uint16Array,
  start: number,
  len: number,
  lowerWord: string,
  i: number,
  code: number,
  from: number,
): number {
  if (lower !== null) return lower.indexOf(lowerWord.charAt(i), from);
  for (let j = from; j < len; j++) if (codes[start + j] === code) return j;
  return -1;
}

/**
 * Score `raw` (lowercased as `codes[start..end)`) against a query plan.
 * When `positions` is given, the matched character positions are appended,
 * sorted and de-duplicated. `wordStarts` is the target's
 * {@link wordStartMask}; it lets the word-start alignment be skipped when it
 * can't differ (-1 = unknown: computed on demand from `lower`, or with
 * packed codes, always try it).
 */
export function scoreTarget(
  plan: QueryPlan,
  raw: string,
  codes: Uint16Array,
  start: number,
  end: number,
  fuzziness: number,
  positions?: number[],
  wordStarts = -1,
  lower: string | null = null,
): number {
  if (raw === plan.query) {
    if (positions) for (let p = 0; p < raw.length; p++) positions.push(p);
    return 1;
  }
  if (plan.length === 0 || raw === '' || end === start) return 0;

  const fuzzy = fuzziness > 0;
  const { words, lowerWords } = plan;
  let rs = 0;
  let misses = 0;
  let swaps = 0;
  let prevFirst = -1;
  let outOfOrder = false;
  const start0 = positions ? positions.length : 0;

  for (let w = 0; w < lowerWords.length; w++) {
    // biome-ignore lint/style/noNonNullAssertion: w < lowerWords.length
    const lowerWord = lowerWords[w]!;
    // biome-ignore lint/style/noNonNullAssertion: words and lowerWords are parallel
    const word = words[w]!;
    if (positions) positionsA.length = 0;
    if (
      !align(
        false,
        raw,
        codes,
        start,
        end,
        lower,
        lowerWord,
        word,
        fuzzy,
        positions ? positionsA : null,
      )
    ) {
      // The earliest-occurrence alignment is the most permissive one: if it
      // can't place every character, the word doesn't match
      return 0;
    }
    let bestRs = alignRs;
    let bestMisses = alignMisses;
    let bestSwaps = alignSwaps;
    let bestFirst = alignFirst;
    let bestPositions = positionsA;

    // Word-start alignment only differs if the first one jumped mid-word to
    // a character that also starts a word somewhere. It's about ranking good
    // matches (acronyms), so skip it for words with misses — in fuzzy mode
    // that's most rows, and they rank low anyway.
    if (alignSkippedMask !== 0 && alignMisses === 0) {
      // Reading a plain string, the word-start mask isn't precomputed: work
      // it out once per target, only when it's needed
      if (wordStarts === -1 && lower !== null) wordStarts = wordStartMask(raw, lower);
    }
    if ((alignSkippedMask & wordStarts) !== 0 && alignMisses === 0) {
      if (positions) positionsB.length = 0;
      if (
        align(
          true,
          raw,
          codes,
          start,
          end,
          lower,
          lowerWord,
          word,
          fuzzy,
          positions ? positionsB : null,
        )
      ) {
        const better =
          alignMisses < bestMisses ||
          (alignMisses === bestMisses &&
            alignRs * SWAP_PENALTY ** alignSwaps > bestRs * SWAP_PENALTY ** bestSwaps);
        if (better) {
          bestRs = alignRs;
          bestMisses = alignMisses;
          bestSwaps = alignSwaps;
          bestFirst = alignFirst;
          bestPositions = positionsB;
        }
      }
    }

    rs += bestRs;
    misses += bestMisses;
    swaps += bestSwaps;
    if (bestFirst >= 0) {
      if (bestFirst < prevFirst) outOfOrder = true;
      prevFirst = bestFirst;
    }
    if (positions) for (const p of bestPositions) positions.push(p);
  }

  // Nothing found at all (fuzzy mode)
  if (misses >= plan.length) {
    if (positions) positions.length = start0;
    return 0;
  }

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

  const firstCode = lower !== null ? lower.charCodeAt(0) : codes[start];
  // biome-ignore lint/style/noNonNullAssertion: plan.length > 0 ⇒ a non-empty word exists
  if (lowerWords[0]!.charCodeAt(0) === firstCode && score < 0.85) score += 0.15;
  if (swaps > 0) score *= SWAP_PENALTY ** swaps;
  if (outOfOrder) score *= WORD_ORDER_PENALTY;

  if (positions) sortUnique(positions, start0);
  return score;
}

/** Sort `list[from..]` ascending and drop duplicates, in place. */
function sortUnique(list: number[], from: number): void {
  const tail = list.splice(from).sort((a, b) => a - b);
  let last = -1;
  for (const p of tail) {
    if (p !== last) list.push(p);
    last = p;
  }
}

const noCodes = new Uint16Array(0);

/** Score a target given its lowercased form as a string. */
export function scoreString(
  plan: QueryPlan,
  raw: string,
  lower: string,
  fuzziness: number,
  positions?: number[],
): number {
  return scoreTarget(plan, raw, noCodes, 0, lower.length, fuzziness, positions, -1, lower);
}

/**
 * Does `lowerToken` match `lowerValue` with fuzziness off (every character,
 * left to right, adjacent swaps allowed)? A cheap pre-check, no scoring.
 */
export function matchesStrict(lowerValue: string, lowerToken: string): boolean {
  const len = lowerValue.length;
  const tokenLen = lowerToken.length;
  let startAt = 0;
  let i = 0;
  while (i < tokenLen) {
    const code = lowerToken.charCodeAt(i);
    if (
      startAt + 1 < len &&
      i + 1 < tokenLen &&
      lowerValue.charCodeAt(startAt) !== code &&
      lowerValue.charCodeAt(startAt) === lowerToken.charCodeAt(i + 1) &&
      lowerValue.charCodeAt(startAt + 1) === code
    ) {
      startAt += 2;
      i += 2;
      continue;
    }
    const pos = lowerValue.indexOf(lowerToken[i] as string, startAt);
    if (pos < 0) return false;
    startAt = pos + 1;
    i++;
  }
  return true;
}
