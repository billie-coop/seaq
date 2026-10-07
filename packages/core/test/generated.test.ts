/**
 * Deterministic generated tests. Indexed searches must equal unindexed ones,
 * and both are checked against properties that don't depend on seaq's own
 * code paths agreeing with each other:
 *
 * - a brute-force strict matcher (every character in order, adjacent pairs
 *   may be swapped, words in any order),
 * - a reference selection (score > 0, relative threshold, stable sort by
 *   score, top `limit`),
 * - scores in (0, 1], highlight ranges inside the matched value and on
 *   characters the query contains,
 * - the fuzzy pruning bound never below a real score.
 */
import { describe, expect, test } from 'vitest';
import { type SeaqOptions, type SeaqResult, seaq } from '../src/index';
import {
  charMask,
  lowercase,
  planQuery,
  scoreBound,
  scoreCeiling,
  scoreString,
} from '../src/score';

// Deterministic PRNG so failures reproduce
let seed = 20261006;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;

// Repeated letters, capitals, a character whose lowercase form is longer
// (İ), Greek sigma (lowercased by context: final 'ς', otherwise 'σ'),
// (İ), accents, digits, punctuation and runs of whitespace
const chunks = [
  'a',
  'n',
  'na',
  'an',
  'th',
  's',
  'm',
  'i',
  'A',
  'N',
  'S',
  'İ',
  'Σ',
  'ΟΣ',
  'ς',
  'é',
  '1',
  '-',
  'x',
];
const randomWord = () => {
  let w = '';
  const n = 1 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) w += pick(chunks);
  return w;
};
const randomText = () => {
  let t = randomWord();
  const n = Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) t += pick([' ', ' ', '  ', '\t']) + randomWord();
  return t;
};

/** A query typed from `text`: a slice, then maybe a swap, a typo, a reorder or a case change. */
function randomQuery(text: string): string {
  if (rand() < 0.15) return randomText();
  const start = Math.floor(rand() * text.length);
  let q = text.slice(start, start + 1 + Math.floor(rand() * 8));
  const chars = [...q];
  const r = rand();
  if (r < 0.25 && chars.length > 2) {
    const i = Math.floor(rand() * (chars.length - 1));
    [chars[i], chars[i + 1]] = [chars[i + 1] as string, chars[i] as string];
    q = chars.join('');
  } else if (r < 0.4) {
    q += pick(chunks);
  } else if (r < 0.5) {
    q = q.split(/\s+/).reverse().join(' ');
  } else if (r < 0.6) {
    q = q.toUpperCase();
  }
  return q.trim() ? q : 'a';
}

/** Does `word` match `target` strictly? Tries every placement (exponential, small inputs only). */
function bruteMatches(target: string, word: string, from = 0): boolean {
  if (word === '') return true;
  for (let p = from; p < target.length; p++) {
    if (target[p] === word[0] && bruteMatches(target, word.slice(1), p + 1)) return true;
    if (
      word.length > 1 &&
      target[p] === word[1] &&
      target[p + 1] === word[0] &&
      bruteMatches(target, word.slice(2), p + 2)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Lowercasing for the reference checks, independent of seaq's: the whole
 * string at once (keeping context-dependent forms), minus the combining dot
 * that 'İ' gains — the alphabet has no combining marks of its own.
 */
const refLower = (s: string) => s.toLowerCase().replaceAll('\u0307', '');

const strictMatch = (raw: string, query: string) =>
  raw === query ||
  (query.trim() !== '' &&
    query
      .split(/\s+/)
      .filter(Boolean)
      .every((w) => bruteMatches(refLower(raw), refLower(w))));

/** What seaq should return for plain strings, from scores alone. */
function reference(
  list: string[],
  query: string,
  fuzziness: number,
  limit: number,
  threshold: number,
) {
  const plan = planQuery(query);
  const scored = list
    .map((item) => ({ item, score: scoreString(plan, item, lowercase(item), -1, fuzziness) }))
    .filter((r) => r.score > 0);
  const max = Math.max(0, ...scored.map((r) => r.score));
  return scored
    .filter((r) => r.score >= max * threshold)
    .sort((a, b) => b.score - a.score) // stable: ties keep list order
    .slice(0, Math.ceil(limit));
}

/** Check scores and highlights of `includeMatches` results. */
function checkResults(results: SeaqResult<unknown>[], query: string): void {
  // A character and its case partners (first code unit: 'İ' → 'i')
  const fold = (c: string) => [c, c.toLowerCase()[0], c.toUpperCase()[0]];
  const queryChars = new Set([...query].flatMap(fold));
  for (const { score, matches } of results) {
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
    expect(matches.length).toBeGreaterThan(0);
    for (const { value, indices } of matches) {
      let last = -2;
      for (const [start, end] of indices) {
        expect(start).toBeGreaterThan(last + 1); // sorted, separate ranges
        expect(end).toBeGreaterThanOrEqual(start);
        expect(end).toBeLessThan(value.length);
        for (let i = start; i <= end; i++) {
          // Query characters only (an exact match also covers its spaces)
          if (value !== query) {
            expect(fold(value[i] as string).some((c) => queryChars.has(c))).toBe(true);
          }
        }
        last = end;
      }
    }
  }
}

const fuzzinesses = [0, 0.2, 0.5, 1];
const limits = [1, 2.5, 4, 10, Number.POSITIVE_INFINITY];
const thresholds = [0, 0.3, 0.35, 0.9];

describe('generated string lists', () => {
  test('indexed = unindexed = reference; strict = brute force', () => {
    for (let round = 0; round < 150; round++) {
      const list = Array.from({ length: 1 + Math.floor(rand() * 40) }, randomText);
      // Ties: repeat some entries
      for (let i = 0; i < 3; i++) list.push(pick(list));
      for (let k = 0; k < 8; k++) {
        const query = randomQuery(pick(list));
        const fuzziness = pick(fuzzinesses);
        const limit = pick(limits);
        const threshold = pick(thresholds);
        const options = { fuzziness, limit, threshold, includeMatches: true } as const;

        const plain = seaq(list, query, { ...options, cache: false });
        const indexed = seaq(list, query, { ...options, cache: true });
        expect(indexed).toEqual(plain);
        expect(plain.map((r) => r.item)).toEqual(
          reference(list, query, fuzziness, limit, threshold).map((r) => r.item),
        );
        checkResults(plain, query);

        if (fuzziness === 0) {
          const all = seaq(list, query, { fuzziness: 0, limit: Infinity, threshold: 0 });
          expect(new Set(all)).toEqual(new Set(list.filter((s) => strictMatch(s, query))));
        }
      }
    }
  });

  test('typing and backspacing: narrowing stays exact', () => {
    for (let round = 0; round < 60; round++) {
      const list = Array.from({ length: 30 }, randomText);
      const target = pick(list);
      const typed = randomQuery(target);
      const steps: string[] = [];
      for (let i = 1; i <= typed.length; i++) steps.push(typed.slice(0, i));
      for (let i = typed.length - 1; i > 0; i--) steps.push(typed.slice(0, i));
      // A whole sequence per fuzziness: a fuzzy search in between would
      // reset the strict narrowing state
      for (const fuzziness of [0, 0.2]) {
        for (const q of steps) {
          if (!q.trim()) continue;
          const options = { fuzziness, limit: Infinity, threshold: 0 };
          expect(seaq(list, q, { ...options, cache: true })).toEqual(
            seaq(list, q, { ...options, cache: false }),
          );
        }
      }
    }
  });

  test('array edits between searches', () => {
    for (let round = 0; round < 40; round++) {
      const list = Array.from({ length: 25 }, randomText);
      for (let step = 0; step < 12; step++) {
        const r = rand();
        if (r < 0.4) list[Math.floor(rand() * list.length)] = randomText();
        else if (r < 0.6) list.push(randomText());
        else if (r < 0.7 && list.length > 1) list.pop();
        else if (r < 0.8) list.splice(Math.floor(rand() * list.length), 2, randomText());
        const query = randomQuery(pick(list));
        for (const fuzziness of [0, 0.2]) {
          const options = { fuzziness, limit: 5, threshold: 0.3 };
          expect(seaq(list, query, { ...options, cache: true })).toEqual(
            seaq(list, query, { ...options, cache: false }),
          );
        }
      }
    }
  });
});

describe('generated object lists', () => {
  const randomPerson = () => ({
    first: randomWord(),
    last: rand() < 0.1 ? null : randomWord(),
    tags: Array.from({ length: Math.floor(rand() * 3) }, randomWord),
    '': randomWord(),
  });
  const keySets: Array<string[] | undefined> = [
    undefined,
    [],
    [''],
    ['first'],
    ['first', 'last'],
    ['last', 'first'],
    ['tags'],
    ['first', 'tags', 'missing'],
  ];

  test('every key set, in both field modes, indexed and not; configuration changes', () => {
    for (let round = 0; round < 60; round++) {
      const list = Array.from({ length: 30 }, randomPerson);
      for (let k = 0; k < 10; k++) {
        const keys = pick(keySets);
        const fieldMode = pick(['joined', 'separate'] as const);
        const query = randomQuery(randomText());
        const options: SeaqOptions<unknown> = {
          keys,
          fieldMode,
          fuzziness: pick(fuzzinesses),
          limit: pick(limits),
          threshold: pick(thresholds),
          includeMatches: true,
        };
        // One list, searched with key sets in random order: indexes for
        // different keys must never be mixed up
        const plain = seaq<unknown>(list, query, { ...options, cache: false });
        expect(seaq<unknown>(list, query, { ...options, cache: true })).toEqual(plain);
        checkResults(plain as SeaqResult<unknown>[], query);
      }
    }
  });
});

describe('fuzzy pruning bound', () => {
  test('never below a real score', () => {
    for (let n = 0; n < 30000; n++) {
      const raw = randomText();
      const lower = lowercase(raw);
      const query = rand() < 0.5 ? randomQuery(raw) : randomText();
      const fuzziness = pick([0.05, 0.2, 0.5, 1]);
      const plan = planQuery(query);
      const score = scoreString(plan, raw, lower, -1, fuzziness);
      const bound = scoreBound(scoreCeiling(plan, fuzziness), charMask(lower), lower.length);
      if (score > bound) {
        throw new Error(
          `bound ${bound} < score ${score} for ${JSON.stringify({ raw, query, fuzziness })}`,
        );
      }
    }
  });
});
