import { describe, expect, test } from 'vitest';
import { lowercase, planQuery, scoreString } from '../src/score';

/** Score one target the way seaq scores an item's search string. */
function score(target: string, query: string, fuzziness = 0, positions?: number[]): number {
  return scoreString(planQuery(query), target, lowercase(target), -1, fuzziness, positions);
}

describe('scoreString', () => {
  describe('exact matches', () => {
    test('identical strings return 1', () => {
      expect(score('hello', 'hello')).toBe(1);
    });

    test('empty query returns 0', () => {
      expect(score('hello', '')).toBe(0);
    });

    test('empty target returns 0', () => {
      expect(score('', 'abc')).toBe(0);
      expect(score('', 'abc', 0.5)).toBe(0);
    });

    test('exact match fills positions with the full range', () => {
      const positions: number[] = [];
      expect(score('abc', 'abc', 0, positions)).toBe(1);
      expect(positions).toEqual([0, 1, 2]);
    });
  });

  describe('partial matches', () => {
    test('prefix match scores higher than mid-string', () => {
      const prefix = score('hello world', 'h');
      const mid = score('hello world', 'e');
      expect(prefix).toBeGreaterThan(mid);
    });

    test('longer match scores higher', () => {
      const short = score('hello world', 'hel');
      const long = score('hello world', 'hello');
      expect(long).toBeGreaterThan(short);
    });

    test('consecutive characters score higher than scattered', () => {
      const consecutive = score('hello world', 'hel');
      const scattered = score('hello world', 'hlo');
      expect(consecutive).toBeGreaterThan(scattered);
    });
  });

  describe('no match', () => {
    test('completely unrelated returns 0 in strict mode', () => {
      expect(score('hello world', 'xyz')).toBe(0);
    });

    test('single unmatched char returns 0 in strict mode', () => {
      expect(score('hello world', 'hello wor1')).toBe(0);
    });
  });

  describe('case sensitivity', () => {
    test('case-insensitive matching works', () => {
      expect(score('Hello', 'h')).toBeGreaterThan(0);
    });

    test('exact case match gets bonus', () => {
      const upper = score('Hello', 'H');
      const lower = score('Hello', 'h');
      expect(upper).toBeGreaterThan(lower);
    });
  });

  describe('acronym bonus', () => {
    test('acronym scores well against full words', () => {
      const acronym = score('Hillsdale Michigan', 'HiMi');
      const partial = score('Hillsdale Michigan', 'Hills');
      expect(acronym).toBeGreaterThan(partial);
    });

    test('acronym and longer partial are competitively scored', () => {
      const acronym = score('Hillsdale Michigan', 'HiMi');
      const longer = score('Hillsdale Michigan', 'Hillsd');
      // With 30/70 weighting (query satisfaction dominant), a 4-char acronym
      // matching both words scores close to a 6-char consecutive partial.
      // Both should be high-quality matches.
      expect(acronym).toBeGreaterThan(0.5);
      expect(longer).toBeGreaterThan(0.5);
    });
  });

  describe('string length impact', () => {
    test('shorter strings score higher for same query', () => {
      const short = score('He', 'h');
      const long = score('Hello', 'h');
      expect(short).toBeGreaterThan(long);
    });
  });

  describe('fuzziness', () => {
    test('unmatched char returns 0 without fuzziness', () => {
      expect(score('hello world', 'hello wor1')).toBe(0);
    });

    test('unmatched char scores > 0 with fuzziness', () => {
      expect(score('hello world', 'hello wor1', 0.5)).toBeGreaterThan(0);
    });

    test('higher fuzziness is more tolerant', () => {
      const lowFuzzy = score('hello world', 'hxllo', 0.2);
      const highFuzzy = score('hello world', 'hxllo', 0.8);
      expect(highFuzzy).toBeGreaterThan(lowFuzzy);
    });

    test('first-char miss yields > 0 in fuzzy mode', () => {
      // Guard: fuzzy mode must still score > 0 when first char is absent
      // but some later chars match. Prevents strict-mode first-char
      // pre-rejection from leaking into fuzzy mode.
      // 'x' misses, but 'b','c' match in 'abcdef'
      const s = score('abcdef', 'xbc', 0.5);
      expect(s).toBeGreaterThan(0);
    });
  });

  describe('consecutive bonus after fuzzy skip', () => {
    test('skipped char should not grant consecutive bonus to next match', () => {
      // "btn" vs "tsconfig.json": 'b' is not found (fuzzy skip), then 't' at
      // index 0 should NOT get the 0.7 consecutive bonus just because startAt
      // hasn't moved. This is a false positive — 't' is not consecutive with
      // any matched character.
      const tsconfig = score('tsconfig.json', 'btn', 0.2);
      const button = score('src/components/Button.tsx', 'btn', 0.2);
      // Button.tsx matches all 3 chars (b, t, n in "Button") — should outscore
      // tsconfig.json which misses 'b' entirely
      expect(button).toBeGreaterThan(tsconfig);
    });

    test('consecutive bonus still works for actually consecutive matches', () => {
      // "hel" vs "hello" — all chars found consecutively, should still get bonus
      const withFuzz = score('hello', 'hel', 0.2);
      const strict = score('hello', 'hel', 0);
      // Fuzzy with no skips should score the same as strict
      expect(withFuzz).toBe(strict);
    });

    test('genuine consecutive after a fuzzy skip is not penalized', () => {
      // "xbc" vs "abcd" — 'x' is skipped, then 'b','c' are genuinely
      // consecutive with each other. 'b' should NOT get consecutive bonus
      // (it follows a skip), but 'c' SHOULD (it follows matched 'b').
      const s = score('abcd', 'xbc', 0.5);
      expect(s).toBeGreaterThan(0);
      // Compare with "xbd" where 'b','d' are NOT consecutive
      const scattered = score('abcd', 'xbd', 0.5);
      expect(s).toBeGreaterThan(scattered);
    });
  });

  describe('quadratic miss degradation', () => {
    test('high miss ratio (67%) produces very low but non-zero score', () => {
      // "rocket" vs "check mark" — only 'c' and 'k' can match (4/6 = 67% miss)
      const s = score('check mark', 'rocket', 0.2);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThan(0.05); // quadratic penalty crushes this
    });

    test('moderate match (67% hit) returns decent score', () => {
      // "rocket" vs "rock" — 'r','o','c','k' all found (2/6 = 33% miss)
      expect(score('rock', 'rocket', 0.2)).toBeGreaterThan(0);
    });

    test('high miss ratio (67%) produces near-zero score', () => {
      // "btn" vs "test.ts" — only 't' found (2/3 = 67% miss)
      const s = score('test.ts', 'btn', 0.2);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThan(0.05);
    });

    test('perfect match ratio returns > 0', () => {
      // "btn" vs "Button.tsx" — all chars found (0% miss)
      expect(score('Button.tsx', 'btn', 0.2)).toBeGreaterThan(0);
    });

    test('50% miss degrades significantly', () => {
      // 4-char query with 2 missed = 50% miss → (1-0.5)^2 = 0.25× penalty
      const s = score('axcx', 'abcd', 0.5);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThan(0.25); // heavily penalized but non-zero
    });

    test('67% miss degrades heavily', () => {
      // 3-char query with 2 missed = 67% miss → (1-0.67)^2 ≈ 0.11× penalty
      const s = score('xaa', 'xyz', 0.5);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThan(0.2); // very low but not exactly zero
    });

    test('partial query match returns > 0 for cross-field use', () => {
      // This is the key regression fix: "helen green" scored against "Helen"
      // should return > 0 so token-aware scoring can combine field scores
      expect(score('Helen', 'helen green', 0.2)).toBeGreaterThan(0);
    });
  });

  describe('formula rebalancing (30/70 weighting)', () => {
    test('score gap between short and long targets is narrower', () => {
      // Same query matched in targets of different lengths
      // With 30/70 weighting, query satisfaction (70%) dominates over target coverage (30%)
      const short = score('btn.ts', 'btn');
      const long = score('src/components/Button.tsx', 'btn');
      // Both should score > 0
      expect(short).toBeGreaterThan(0);
      expect(long).toBeGreaterThan(0);
      // Short still wins by a bounded ratio. ("Button" follows "/", which isn't
      // a word start, and lowercase typing earns no case bonus — so ~10x)
      expect(short / long).toBeLessThan(12);
    });
  });

  describe('first character bonus', () => {
    test('matching first character boosts score', () => {
      // Query starting with same letter as target gets +0.15 bonus
      const matchFirst = score('hello', 'ho');
      const noMatchFirst = score('hello', 'eo');
      expect(matchFirst).toBeGreaterThan(noMatchFirst);
    });
  });
});
