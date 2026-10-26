/**
 * Covering tests for the 2.0.0-final fixes and perf changes.
 *
 * Each describe block maps to one fix; these were verified red against the
 * rc.2 implementation before the fixes landed (except the "unchanged
 * behavior" guards, which protect the perf refactors from regressions).
 */
import type { Contact } from '@seaq/test-data';
import ManyContactsRaw from '@seaq/test-data/contacts-10k.json';
import { describe, expect, test } from 'vitest';
import { seaq } from '../src/index';

const ManyContacts = ManyContactsRaw as Contact[];

describe('fix: limit <= 0 returns []', () => {
  const list = ['apple', 'applet', 'apply', 'appliance', 'app'];

  test('limit: 0 returns no results', () => {
    expect(seaq(list, 'app', { limit: 0 })).toEqual([]);
  });

  test('negative limit returns no results', () => {
    expect(seaq(list, 'app', { limit: -5 })).toEqual([]);
  });

  test('limit: 1 still returns the top result', () => {
    expect(seaq(list, 'app', { limit: 1 })).toHaveLength(1);
  });
});

describe('fix: null/undefined list entries are skipped, not crashed on', () => {
  test('undefined entries in a keyless list do not throw', () => {
    expect(seaq(['alpha', undefined as unknown as string, 'beta'], 'alp')).toEqual(['alpha']);
  });

  test('null entries never match (not even the query "null")', () => {
    expect(seaq([null as unknown as string, 'null hypothesis'], 'null')).toEqual([
      'null hypothesis',
    ]);
  });

  test('sparse arrays work', () => {
    // eslint-style sparse array — hole reads as undefined
    const sparse: (string | undefined)[] = ['alpha', 'beta'];
    sparse[5] = 'alphabet';
    expect(seaq(sparse as string[], 'alpha', { fuzziness: 0 })).toEqual(['alpha', 'alphabet']);
  });

  test('null/undefined entries skipped in keyed object lists', () => {
    const items = [{ name: 'Ada' }, null, undefined, { name: 'Adam' }] as Array<{ name: string }>;
    const results = seaq(items, 'ada', { keys: ['name'], fuzziness: 0 });
    expect(results).toEqual([{ name: 'Ada' }, { name: 'Adam' }]);
  });
});

describe('fix: fuzziness is clamped to [0, 1]', () => {
  test('fuzziness > 1 no longer inflates scores', () => {
    // Unclamped fuzziness 1.5 made the fuzzies divisor hit zero on two
    // misses, producing an Infinity score for a near-garbage match
    const results = seaq(['apply'], 'xyz', {
      fuzziness: 1.5,
      includeMatches: true,
      threshold: 0,
    });
    for (const r of results) {
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  test('fuzziness 1.5 behaves identically to fuzziness 1', () => {
    const list = ['apple', 'grape', 'pineapple'];
    expect(seaq(list, 'aple', { fuzziness: 1.5 })).toEqual(seaq(list, 'aple', { fuzziness: 1 }));
  });

  test('negative fuzziness behaves like strict mode', () => {
    const list = ['hello', 'help'];
    expect(seaq(list, 'helx', { fuzziness: -1 })).toEqual(seaq(list, 'helx', { fuzziness: 0 }));
  });
});

describe('fix: joined-mode includeMatches returns per-field matches', () => {
  const contacts = [{ firstName: 'John', middleName: '', lastName: 'Smith' }];
  const keys = ['firstName', 'middleName', 'lastName'];

  test('cross-field query produces one match per matched field', () => {
    const results = seaq(contacts, 'john smith', {
      keys,
      includeMatches: true,
      fuzziness: 0,
    });
    expect(results).toHaveLength(1);
    const matches = results[0].matches;
    expect(matches.map((m) => m.key)).toEqual(['firstName', 'lastName']);
    expect(matches.map((m) => m.value)).toEqual(['John', 'Smith']);
  });

  test('indices are relative to each field value and slice back to the query', () => {
    const results = seaq(contacts, 'john smith', {
      keys,
      includeMatches: true,
      fuzziness: 0,
    });
    const sliced = results[0].matches
      .map((m) => m.indices.map(([s, e]) => m.value.slice(s, e + 1)).join(''))
      .join('');
    // the space in the query matched the field separator, which is dropped
    expect(sliced.toLowerCase()).toBe('johnsmith');
  });

  test('non-matching fields are omitted from matches', () => {
    const results = seaq(contacts, 'smith', {
      keys,
      includeMatches: true,
      fuzziness: 0,
    });
    expect(results[0].matches.map((m) => m.key)).toEqual(['lastName']);
  });

  test('each joined match carries the overall item score', () => {
    const results = seaq(contacts, 'john smith', {
      keys,
      includeMatches: true,
      fuzziness: 0,
    });
    for (const m of results[0].matches) {
      expect(m.score).toBe(results[0].score);
    }
  });

  test('dot-notation keys are reported with the full key path', () => {
    const users = [{ name: 'Alice', address: { city: 'New York' } }];
    const results = seaq(users, 'york', {
      keys: ['name', 'address.city'],
      includeMatches: true,
      fuzziness: 0,
    });
    expect(results[0].matches).toHaveLength(1);
    expect(results[0].matches[0].key).toBe('address.city');
    expect(results[0].matches[0].value).toBe('New York');
  });

  test('array-traversal keys produce one match per matched value', () => {
    const people = [
      { name: 'Charlie', emails: [{ address: 'charlie@work.com' }, { address: 'c@home.com' }] },
    ];
    const results = seaq(people, 'work', {
      keys: ['emails.address'],
      includeMatches: true,
      fuzziness: 0,
    });
    expect(results[0].matches).toHaveLength(1);
    expect(results[0].matches[0].value).toBe('charlie@work.com');
  });
});

describe('fix: exact matches highlight the full value', () => {
  test('string array exact match gets a full-range index', () => {
    const results = seaq(['hello', 'help'], 'hello', { includeMatches: true });
    expect(results[0].item).toBe('hello');
    expect(results[0].matches[0].indices).toEqual([[0, 4]]);
  });
});

describe('unchanged behavior: deferred position collection (perf refactor guards)', () => {
  test('string array matches unchanged', () => {
    const results = seaq(['hello', 'world'], 'hel', { includeMatches: true, fuzziness: 0 });
    expect(results[0].matches[0].value).toBe('hello');
    expect(results[0].matches[0].key).toBeUndefined();
    expect(results[0].matches[0].indices).toEqual([[0, 2]]);
  });

  test('number array matches unchanged', () => {
    const results = seaq([123, 456], '45', { includeMatches: true, fuzziness: 0 });
    expect(results[0].matches[0].value).toBe('456');
    expect(results[0].matches[0].indices).toEqual([[0, 1]]);
  });

  test('keyless object (JSON) matches unchanged', () => {
    const results = seaq([{ x: 'hello' }], 'hello', { includeMatches: true, fuzziness: 0 });
    expect(results[0].matches[0].value).toBe(JSON.stringify({ x: 'hello' }));
    expect(results[0].matches[0].indices.length).toBeGreaterThan(0);
  });
});

describe('unchanged behavior: empty and tiny values (early-exit guards)', () => {
  test('items with all-empty field values never match or crash', () => {
    const items = [
      { a: '', b: '' },
      { a: 'match me', b: '' },
    ];
    const results = seaq(items, 'match', { keys: ['a', 'b'], fuzziness: 0.2 });
    expect(results).toEqual([{ a: 'match me', b: '' }]);
  });

  test('strict mode: query longer than target cannot match', () => {
    expect(seaq(['ab'], 'abc', { fuzziness: 0 })).toEqual([]);
  });

  test('fuzzy mode: query longer than target can still match', () => {
    const results = seaq(['john'], 'johnn', { fuzziness: 0.5, threshold: 0 });
    expect(results).toEqual(['john']);
  });
});

describe('digit-bucketed charMask: numeric queries stay correct', () => {
  test('phone-number search finds exact-prefix matches (strict)', () => {
    const target = ManyContacts[0];
    const number = target.phoneNumbers[0].number;
    const results = seaq(ManyContacts, number.slice(0, 9), {
      keys: ['phoneNumbers.number'],
      fuzziness: 0,
    });
    expect(results).toContain(target);
  });

  test('full phone-number search finds its contact (fuzzy default)', () => {
    const target = ManyContacts[42];
    const results = seaq(ManyContacts, target.phoneNumbers[0].number, {
      keys: ['phoneNumbers.number'],
    });
    expect(results).toContain(target);
  });
});

describe('cache option', () => {
  const keys = ['givenName', 'familyName'];

  test('cached results are identical to uncached', () => {
    const uncached = seaq(ManyContacts, 'nath', { keys });
    // run twice: first populates the cache, second reads it
    seaq(ManyContacts, 'nath', { keys, cache: true });
    const cached = seaq(ManyContacts, 'nath', { keys, cache: true });
    expect(cached).toEqual(uncached);
  });

  test('cached results are identical across strict and fuzzy', () => {
    const uncachedStrict = seaq(ManyContacts, 'helen', { keys, fuzziness: 0 });
    seaq(ManyContacts, 'helen', { keys, fuzziness: 0, cache: true });
    const cachedStrict = seaq(ManyContacts, 'helen', { keys, fuzziness: 0, cache: true });
    expect(cachedStrict).toEqual(uncachedStrict);
  });

  test('different key sets do not collide in the cache', () => {
    const items = [{ a: 'apple', b: 'zebra' }];
    expect(seaq(items, 'apple', { keys: ['a'], cache: true, fuzziness: 0 })).toHaveLength(1);
    expect(seaq(items, 'apple', { keys: ['b'], cache: true, fuzziness: 0 })).toHaveLength(0);
    expect(seaq(items, 'zebra', { keys: ['b'], cache: true, fuzziness: 0 })).toHaveLength(1);
  });

  test('cache works together with includeMatches', () => {
    const items = [{ firstName: 'John', lastName: 'Smith' }];
    seaq(items, 'john', { keys: ['firstName', 'lastName'], cache: true });
    const results = seaq(items, 'john', {
      keys: ['firstName', 'lastName'],
      cache: true,
      includeMatches: true,
      fuzziness: 0,
    });
    expect(results[0].matches[0].key).toBe('firstName');
    expect(results[0].matches[0].value).toBe('John');
  });

  test('plain string lists ignore the cache option safely', () => {
    expect(seaq(['apple', 'banana'], 'app', { cache: true })).toEqual(['apple']);
  });
});
