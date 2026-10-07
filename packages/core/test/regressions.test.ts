import { describe, expect, test } from 'vitest';
import { seaq } from '../src/index';

describe('characters whose lowercase form is longer (İ)', () => {
  test('indexed and unindexed searches agree (the pruning bound holds)', () => {
    const options = { threshold: 0.35, includeMatches: true } as const;
    const plain = seaq(['İ', 'İx'], 'İx', { ...options, cache: false });
    expect(seaq(['İ', 'İx'], 'İx', { ...options, cache: true })).toEqual(plain);
    expect(plain.map((r) => r.item)).toEqual(['İx']);
  });

  test('highlights stay inside the original value', () => {
    const [result] = seaq(['xİİİy'], 'İİy', { includeMatches: true });
    expect(result?.matches[0]?.indices).toEqual([
      [1, 2],
      [4, 4],
    ]);
  });

  test('İ matches i, as with toLowerCase()', () => {
    expect(seaq(['İstanbul', 'Paris'], 'ist', { fuzziness: 0 })).toEqual(['İstanbul']);
  });

  test('other characters keep their context-dependent lowercase (final sigma)', () => {
    for (const cache of [false, true]) {
      expect(seaq(['ΝΙΚΟΣ İ'], 'νικος', { fuzziness: 0, cache })).toEqual(['ΝΙΚΟΣ İ']);
      // An unrelated field with İ doesn't change how the name is matched
      const people = [{ name: 'ΝΙΚΟΣ', city: 'İzmir' }];
      expect(seaq(people, 'νικος', { keys: ['name', 'city'], fuzziness: 0, cache })).toEqual(
        people,
      );
    }
  });
});

describe('swapped pairs after skipped text', () => {
  const people = [
    { first: 'John', last: 'Smith' },
    { first: 'Jane', last: 'Doe' },
  ];

  test('strict "msith" and "john msith" match John Smith, with highlights', () => {
    for (const cache of [false, true]) {
      expect(seaq(['John Smith'], 'msith', { fuzziness: 0, cache, includeMatches: true })).toEqual([
        {
          item: 'John Smith',
          score: expect.any(Number),
          matches: [expect.objectContaining({ indices: [[5, 9]] })],
        },
      ]);
      const [joined] = seaq(people, 'john msith', {
        keys: ['first', 'last'],
        fuzziness: 0,
        cache,
        includeMatches: true,
      });
      expect(joined?.item).toBe(people[0]);
      expect(joined?.matches).toEqual([
        { key: 'first', value: 'John', indices: [[0, 3]], score: joined?.score },
        { key: 'last', value: 'Smith', indices: [[0, 4]], score: joined?.score },
      ]);
    }
  });

  test('a swap costs a little score', () => {
    const [swapped] = seaq(['John Smith'], 'msith', { includeMatches: true });
    const [typed] = seaq(['John Smith'], 'smith', { includeMatches: true });
    expect(swapped?.score).toBeLessThan(typed?.score ?? 0);
    expect(swapped?.score).toBeGreaterThan(0.5);
  });

  test('a correctly spelled word later on beats an earlier swap', () => {
    const [swapFirst] = seaq(['John Msith Smith'], 'smith', { includeMatches: true });
    const [smithFirst] = seaq(['John Smith Msith'], 'smith', { includeMatches: true });
    expect(swapFirst?.matches[0]?.indices).toEqual([[11, 15]]);
    expect(smithFirst?.matches[0]?.indices).toEqual([[5, 9]]);
    expect(swapFirst?.score).toBe(smithFirst?.score);
  });

  test('a word start still beats a swap mid-word ("ma" → Mathews, not s-AM)', () => {
    const [result] = seaq(['Sam Mathews'], 'ma', { includeMatches: true });
    expect(result?.matches[0]?.indices).toEqual([[4, 5]]);
  });

  test('typing through a swap narrows correctly', () => {
    const list = ['John Smith', 'Jon Mist', 'Sam Ith', 'Mitch'];
    for (const q of ['m', 'ms', 'msi', 'msit', 'msith', 'msit', 'ms']) {
      const options = { fuzziness: 0, limit: Infinity, threshold: 0 };
      expect(seaq(list, q, { ...options, cache: true })).toEqual(
        seaq(list, q, { ...options, cache: false }),
      );
    }
    expect(seaq(list, 'msith', { fuzziness: 0, cache: true })).toEqual(['John Smith']);
  });
});

describe('index signatures', () => {
  const item = { '': 'alpha', a: 'beta' };
  // Expected results per key set: omitted keys search the JSON, [] searches
  // nothing, [''] searches the '' property
  const cases: Array<[string[] | undefined, number]> = [
    [undefined, 1],
    [[], 0],
    [[''], 1],
    [['a'], 0],
  ];

  test('omitted keys, [] and [""] keep separate indexes, in either order', () => {
    for (const order of [cases, [...cases].reverse()]) {
      const list = [item];
      for (const [keys, expected] of [...order, ...order]) {
        expect(seaq(list, 'alpha', { keys, fuzziness: 0, cache: true })).toHaveLength(expected);
      }
    }
  });
});

describe('joined matches', () => {
  test('an exact query highlights every field but not the spaces between them', () => {
    const [result] = seaq([{ first: 'John', last: 'Smith' }], 'John Smith', {
      keys: ['first', 'last'],
      includeMatches: true,
    });
    expect(result?.score).toBe(1);
    expect(result?.matches.map((m) => m.indices)).toEqual([[[0, 3]], [[0, 4]]]);
  });
});
