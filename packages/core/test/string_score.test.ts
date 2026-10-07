import { describe, expect, test } from 'vitest';
import { string_score } from '../src/string_score';

describe('string_score', () => {
  describe('exact matches', () => {
    test('identical strings return 1', () => {
      expect(string_score('hello', 'hello')).toBe(1);
    });

    test('empty query returns 0', () => {
      expect(string_score('hello', '')).toBe(0);
    });

    test('empty target returns 0', () => {
      expect(string_score('', 'abc')).toBe(0);
      expect(string_score('', 'abc', 0.5)).toBe(0);
    });

    test('exact match fills positions with the full range', () => {
      const positions: number[] = [];
      expect(string_score('abc', 'abc', 0, undefined, positions)).toBe(1);
      expect(positions).toEqual([0, 1, 2]);
    });
  });

  describe('partial matches', () => {
    test('prefix match scores higher than mid-string', () => {
      const prefix = string_score('hello world', 'h');
      const mid = string_score('hello world', 'e');
      expect(prefix).toBeGreaterThan(mid);
    });

    test('longer match scores higher', () => {
      const short = string_score('hello world', 'hel');
      const long = string_score('hello world', 'hello');
      expect(long).toBeGreaterThan(short);
    });

    test('consecutive characters score higher than scattered', () => {
      const consecutive = string_score('hello world', 'hel');
      const scattered = string_score('hello world', 'hlo');
      expect(consecutive).toBeGreaterThan(scattered);
    });
  });

  describe('no match', () => {
    test('completely unrelated returns 0 in strict mode', () => {
      expect(string_score('hello world', 'xyz')).toBe(0);
    });

    test('single unmatched char returns 0 in strict mode', () => {
      expect(string_score('hello world', 'hello wor1')).toBe(0);
    });
  });

  describe('case sensitivity', () => {
    test('case-insensitive matching works', () => {
      expect(string_score('Hello', 'h')).toBeGreaterThan(0);
    });

    test('exact case match gets bonus', () => {
      const upper = string_score('Hello', 'H');
      const lower = string_score('Hello', 'h');
      expect(upper).toBeGreaterThan(lower);
    });
  });

  describe('acronym bonus', () => {
    test('acronym scores well against full words', () => {
      const acronym = string_score('Hillsdale Michigan', 'HiMi');
      const partial = string_score('Hillsdale Michigan', 'Hills');
      expect(acronym).toBeGreaterThan(partial);
    });

    test('acronym and longer partial are competitively scored', () => {
      const acronym = string_score('Hillsdale Michigan', 'HiMi');
      const longer = string_score('Hillsdale Michigan', 'Hillsd');
      // With 30/70 weighting (query satisfaction dominant), a 4-char acronym
      // matching both words scores close to a 6-char consecutive partial.
      // Both should be high-quality matches.
      expect(acronym).toBeGreaterThan(0.5);
      expect(longer).toBeGreaterThan(0.5);
    });
  });

  describe('string length impact', () => {
    test('shorter strings score higher for same query', () => {
      const short = string_score('He', 'h');
      const long = string_score('Hello', 'h');
      expect(short).toBeGreaterThan(long);
    });
  });

  describe('fuzziness', () => {
    test('unmatched char returns 0 without fuzziness', () => {
      expect(string_score('hello world', 'hello wor1')).toBe(0);
    });

    test('unmatched char scores > 0 with fuzziness', () => {
      expect(string_score('hello world', 'hello wor1', 0.5)).toBeGreaterThan(0);
    });

    test('higher fuzziness is more tolerant', () => {
      const lowFuzzy = string_score('hello world', 'hxllo', 0.2);
      const highFuzzy = string_score('hello world', 'hxllo', 0.8);
      expect(highFuzzy).toBeGreaterThan(lowFuzzy);
    });

    test('first-char miss yields > 0 in fuzzy mode', () => {
      // Guard: fuzzy mode must still score > 0 when first char is absent
      // but some later chars match. Prevents strict-mode first-char
      // pre-rejection from leaking into fuzzy mode.
      // 'x' misses, but 'b','c' match in 'abcdef'
      const score = string_score('abcdef', 'xbc', 0.5);
      expect(score).toBeGreaterThan(0);
    });
  });

  describe('pre-lowered query optimization', () => {
    test('passing lowerQuery produces same result', () => {
      const query = 'HeLLo';
      const without = string_score('hello world', query);
      const withLower = string_score('hello world', query, undefined, query.toLowerCase());
      expect(withLower).toBe(without);
    });

    test('works with fuzziness and lowerQuery', () => {
      const query = 'HxLLo';
      const without = string_score('hello world', query, 0.5);
      const withLower = string_score('hello world', query, 0.5, query.toLowerCase());
      expect(withLower).toBe(without);
    });
  });

  describe('pre-lowered target', () => {
    test('passing lowerTarget produces same result (strict)', () => {
      const target = 'Hello World';
      const query = 'hel';
      const without = string_score(target, query);
      const withLower = string_score(
        target,
        query,
        undefined,
        query.toLowerCase(),
        undefined,
        target.toLowerCase(),
      );
      expect(withLower).toBe(without);
    });

    test('passing lowerTarget produces same result (fuzzy)', () => {
      const target = 'Hello World';
      const query = 'hxl';
      const without = string_score(target, query, 0.5);
      const withLower = string_score(
        target,
        query,
        0.5,
        query.toLowerCase(),
        undefined,
        target.toLowerCase(),
      );
      expect(withLower).toBe(without);
    });

    test('works with mixed case and acronyms', () => {
      const target = 'Hillsdale Michigan';
      const query = 'HiMi';
      const without = string_score(target, query, 0);
      const withLower = string_score(
        target,
        query,
        0,
        query.toLowerCase(),
        undefined,
        target.toLowerCase(),
      );
      expect(withLower).toBe(without);
    });

    test('works with positions array', () => {
      const target = 'Hello World';
      const query = 'hel';
      const pos1: number[] = [];
      const pos2: number[] = [];
      const s1 = string_score(target, query, 0, undefined, pos1);
      const s2 = string_score(target, query, 0, query.toLowerCase(), pos2, target.toLowerCase());
      expect(s2).toBe(s1);
      expect(pos2).toEqual(pos1);
    });
  });

  describe('consecutive bonus after fuzzy skip', () => {
    test('skipped char should not grant consecutive bonus to next match', () => {
      // "btn" vs "tsconfig.json": 'b' is not found (fuzzy skip), then 't' at
      // index 0 should NOT get the 0.7 consecutive bonus just because startAt
      // hasn't moved. This is a false positive — 't' is not consecutive with
      // any matched character.
      const tsconfig = string_score('tsconfig.json', 'btn', 0.2);
      const button = string_score('src/components/Button.tsx', 'btn', 0.2);
      // Button.tsx matches all 3 chars (b, t, n in "Button") — should outscore
      // tsconfig.json which misses 'b' entirely
      expect(button).toBeGreaterThan(tsconfig);
    });

    test('consecutive bonus still works for actually consecutive matches', () => {
      // "hel" vs "hello" — all chars found consecutively, should still get bonus
      const withFuzz = string_score('hello', 'hel', 0.2);
      const strict = string_score('hello', 'hel', 0);
      // Fuzzy with no skips should score the same as strict
      expect(withFuzz).toBe(strict);
    });

    test('genuine consecutive after a fuzzy skip is not penalized', () => {
      // "xbc" vs "abcd" — 'x' is skipped, then 'b','c' are genuinely
      // consecutive with each other. 'b' should NOT get consecutive bonus
      // (it follows a skip), but 'c' SHOULD (it follows matched 'b').
      const score = string_score('abcd', 'xbc', 0.5);
      expect(score).toBeGreaterThan(0);
      // Compare with "xbd" where 'b','d' are NOT consecutive
      const scattered = string_score('abcd', 'xbd', 0.5);
      expect(score).toBeGreaterThan(scattered);
    });
  });

  describe('quadratic miss degradation', () => {
    test('high miss ratio (67%) produces very low but non-zero score', () => {
      // "rocket" vs "check mark" — only 'c' and 'k' can match (4/6 = 67% miss)
      const score = string_score('check mark', 'rocket', 0.2);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(0.05); // quadratic penalty crushes this
    });

    test('moderate match (67% hit) returns decent score', () => {
      // "rocket" vs "rock" — 'r','o','c','k' all found (2/6 = 33% miss)
      expect(string_score('rock', 'rocket', 0.2)).toBeGreaterThan(0);
    });

    test('high miss ratio (67%) produces near-zero score', () => {
      // "btn" vs "test.ts" — only 't' found (2/3 = 67% miss)
      const score = string_score('test.ts', 'btn', 0.2);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(0.05);
    });

    test('perfect match ratio returns > 0', () => {
      // "btn" vs "Button.tsx" — all chars found (0% miss)
      expect(string_score('Button.tsx', 'btn', 0.2)).toBeGreaterThan(0);
    });

    test('50% miss degrades significantly', () => {
      // 4-char query with 2 missed = 50% miss → (1-0.5)^2 = 0.25× penalty
      const score = string_score('axcx', 'abcd', 0.5);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(0.25); // heavily penalized but non-zero
    });

    test('67% miss degrades heavily', () => {
      // 3-char query with 2 missed = 67% miss → (1-0.67)^2 ≈ 0.11× penalty
      const score = string_score('xaa', 'xyz', 0.5);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(0.2); // very low but not exactly zero
    });

    test('partial query match returns > 0 for cross-field use', () => {
      // This is the key regression fix: "helen green" scored against "Helen"
      // should return > 0 so token-aware scoring can combine field scores
      expect(string_score('Helen', 'helen green', 0.2)).toBeGreaterThan(0);
    });
  });

  describe('formula rebalancing (30/70 weighting)', () => {
    test('score gap between short and long targets is narrower', () => {
      // Same query matched in targets of different lengths
      // With 30/70 weighting, query satisfaction (70%) dominates over target coverage (30%)
      const short = string_score('btn.ts', 'btn');
      const long = string_score('src/components/Button.tsx', 'btn');
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
      const matchFirst = string_score('hello', 'ho');
      const noMatchFirst = string_score('hello', 'eo');
      expect(matchFirst).toBeGreaterThan(noMatchFirst);
    });
  });
});
