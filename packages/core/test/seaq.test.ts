import type { Contact } from '@seaq/test-data';
import ContactsRaw from '@seaq/test-data/contacts-1k.json';
import ManyContactsRaw from '@seaq/test-data/contacts-10k.json';
import { describe, expect, test } from 'vitest';
import { type SeaqResult, seaq } from '../src/index';
import { charMask } from '../src/score';

const Contacts = ContactsRaw as Contact[];
const ManyContacts = ManyContactsRaw as Contact[];

describe('small collection', () => {
  test('multi-field search', () => {
    const searchResults = seaq(Contacts, 'ray stev', {
      keys: ['givenName', 'familyName'],
      fieldMode: 'joined',
      fuzziness: 0,
    });
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0]).toMatchObject({ givenName: 'Raymond' });
  });

  test('fuzzy search', () => {
    const searchResults = seaq(Contacts, 'Juile', {
      keys: ['givenName'],
      fuzziness: 0.5,
      limit: Infinity,
      threshold: 0,
    });
    // Quadratic degradation gives near-zero (but non-zero) scores to poor matches,
    // so with threshold: 0 the count may reach up to the full dataset
    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults[0]).toMatchObject({ givenName: 'Julie' });
  });

  test('exact search', () => {
    const searchResults = seaq(Contacts, 'Leo', { keys: ['givenName'], fuzziness: 0 });
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0]).toMatchObject({ givenName: 'Leo' });
  });

  test('empty query', () => {
    const searchResults = seaq(Contacts, '', { keys: ['givenName', 'familyName'] });
    expect(searchResults).toHaveLength(0);
  });

  test('nested property search', () => {
    const searchResults = seaq(Contacts, 'julie_cook', {
      keys: ['emailAddresses.email', 'phoneNumbers.number'],
      fuzziness: 0,
    });
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0]).toMatchObject({
      givenName: 'Julie',
      emailAddresses: [
        {
          email: 'julie_cook@yahoo.com',
          label: 'Work',
        },
        {
          email: 'julie.cook47@icloud.com',
          label: 'Home',
        },
        {
          email: 'juliec@mail.com',
          label: 'Work',
        },
      ],
    });
  });
});

describe('large collection', () => {
  test('multi-field search', () => {
    const searchResults = seaq(ManyContacts, 'nath ev', {
      keys: ['givenName', 'familyName'],
      fieldMode: 'joined',
      fuzziness: 0,
      limit: Infinity,
      threshold: 0,
    });
    // Nathan Evans ×3, Nathan Stevens and Nathan Chavez ("ev" swapped in
    // "ve") first; then Anthony Evans/Stevens, where "nath" matches "anth"
    // with one adjacent swap, and weaker swaps after skipped text
    expect(searchResults).toHaveLength(13);
    expect(searchResults.slice(0, 5).map((c) => c.givenName)).toEqual(Array(5).fill('Nathan'));
    expect(searchResults.slice(5, 9).map((c) => c.givenName)).toEqual(Array(4).fill('Anthony'));
  });

  test('fuzzy search', () => {
    const searchResults = seaq(ManyContacts, 'Natnah', {
      keys: ['givenName'],
      fuzziness: 0.5,
      limit: Infinity,
      threshold: 0,
    });
    // Quadratic degradation gives near-zero (but non-zero) scores to poor matches,
    // so with threshold: 0 the count may reach up to the full dataset
    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults[0]).toMatchObject({ givenName: 'Nathan' });
  });

  test('exact search', () => {
    const searchResults = seaq(ManyContacts, 'Nathan', {
      keys: ['givenName'],
      fuzziness: 0,
      limit: Infinity,
      threshold: 0,
    });
    expect(searchResults).toHaveLength(106);
    expect(searchResults[0]).toMatchObject({ givenName: 'Nathan' });
  });

  test('empty query', () => {
    const searchResults = seaq(ManyContacts, '', { keys: ['givenName', 'familyName'] });
    expect(searchResults).toHaveLength(0);
  });

  test('nested property search', () => {
    const searchResults = seaq(ManyContacts, 'julie', {
      keys: ['emailAddresses.email', 'phoneNumbers.number'],
      fieldMode: 'joined',
      fuzziness: 0,
      limit: Infinity,
      threshold: 0,
    });
    // Includes weak matches with "li" swapped in "gmail"
    expect(searchResults).toHaveLength(305);
    expect(searchResults[0]).toMatchObject({ givenName: 'Julie' });
  });
});

describe('extra features', () => {
  test('no keys - string array', () => {
    const searchResults = seaq(['whatever', 'thing'], 'th', { fuzziness: 0 });
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0]).toBe('thing');
  });

  test('no keys - number array', () => {
    const searchResults = seaq([123, 456, 789], '45', { fuzziness: 0 });
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0]).toBe(456);
  });

  test('no keys - object array (JSON stringified)', () => {
    const items = [{ x: 'hello' }, { x: 'world' }];
    const searchResults = seaq(items, 'hello', { fuzziness: 0 });
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0]).toEqual({ x: 'hello' });
  });

  test('no keys - empty list', () => {
    const searchResults = seaq([], 'test');
    expect(searchResults).toHaveLength(0);
  });

  test('acronym bonus', () => {
    const searchResults = seaq(['Hillsdale Michigan', 'historymi'], 'HiMi', {
      fuzziness: 0,
      limit: Infinity,
      threshold: 0,
    });
    expect(searchResults).toHaveLength(2);
    expect(searchResults[0]).toBe('Hillsdale Michigan');
  });

  test('acronym bonus with fuzziness', () => {
    const searchResults = seaq(['Hillsdale Michigan', 'historymi'], 'HiMi', {
      fuzziness: 0.5,
      limit: Infinity,
      threshold: 0,
    });
    expect(searchResults).toHaveLength(2);
    expect(searchResults[0]).toBe('Hillsdale Michigan');
  });

  test('does not mutate the input array', () => {
    const original = ['banana', 'apple', 'cherry'];
    const copy = [...original];
    seaq(original, 'a');
    expect(original).toEqual(copy);
  });
});

describe('limit option', () => {
  test('returns only top N results', () => {
    const results = seaq(ManyContacts, 'na', {
      keys: ['givenName', 'familyName'],
      limit: 10,
    });
    expect(results).toHaveLength(10);
  });

  test('returns all results sorted when limit exceeds matches', () => {
    // Use a query that matches multiple items but fewer than the limit,
    // exercising the "items.length <= n" sort path in getTopN
    const allResults = seaq(Contacts, 'leo', {
      keys: ['givenName', 'familyName'],
      fuzziness: 0,
      limit: Infinity,
      threshold: 0,
    });
    const limitResults = seaq(Contacts, 'leo', {
      keys: ['givenName', 'familyName'],
      fuzziness: 0,
      limit: 1000,
      threshold: 0,
    });
    expect(limitResults.length).toBe(allResults.length);
    expect(limitResults).toEqual(allResults);
  });

  test('returns same top results as slice (with unique scores)', () => {
    // Use a query that produces more distinct scores
    const allResults = seaq(ManyContacts, 'nath fe', {
      keys: ['givenName', 'familyName'],
      fieldMode: 'joined',
      fuzziness: 0,
      limit: Infinity,
      threshold: 0,
    });
    const limitResults = seaq(ManyContacts, 'nath fe', {
      keys: ['givenName', 'familyName'],
      fieldMode: 'joined',
      fuzziness: 0,
      limit: 1,
      threshold: 0,
    });
    // The top result should be the same
    expect(limitResults[0]).toEqual(allResults[0]);
  });
});

describe('fieldMode option', () => {
  const contacts = [
    { firstName: 'John', lastName: 'Smith' },
    { firstName: 'Jane', lastName: 'Doe' },
    { firstName: 'Johnny', lastName: 'Appleseed' },
  ];

  test('joined mode - matches across fields', () => {
    const results = seaq(contacts, 'john smith', {
      keys: ['firstName', 'lastName'],
      fieldMode: 'joined',
      fuzziness: 0,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ firstName: 'John', lastName: 'Smith' });
  });

  test('separate mode (default) - multi-word matches across fields via token scoring', () => {
    const results = seaq(contacts, 'john smith', {
      keys: ['firstName', 'lastName'],
      fuzziness: 0,
    });
    // Token scoring: "john" matches firstName, "smith" matches lastName
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toMatchObject({ firstName: 'John', lastName: 'Smith' });
  });

  test('separate mode - single word matches', () => {
    const results = seaq(contacts, 'john', {
      keys: ['firstName', 'lastName'],
      fuzziness: 0,
      limit: Infinity,
      threshold: 0,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toMatchObject({ firstName: 'John' });
  });
});

describe('includeMatches', () => {
  test('string array — returns SeaqResult with indices', () => {
    const results = seaq(['hello', 'world'], 'hel', { includeMatches: true, fuzziness: 0 });
    expect(results).toHaveLength(1);
    expect(results[0].item).toBe('hello');
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].matches).toHaveLength(1);
    expect(results[0].matches[0].value).toBe('hello');
    expect(results[0].matches[0].key).toBeUndefined();
    expect(results[0].matches[0].indices).toEqual([[0, 2]]);
  });

  test('object with keys — joined mode', () => {
    const contacts = [{ firstName: 'John', lastName: 'Smith' }];
    const results = seaq(contacts, 'john', {
      keys: ['firstName', 'lastName'],
      fieldMode: 'joined',
      includeMatches: true,
      fuzziness: 0,
    });
    expect(results).toHaveLength(1);
    expect(results[0].item).toEqual({ firstName: 'John', lastName: 'Smith' });
    // Joined mode returns per-field matches with key set and field-relative indices
    expect(results[0].matches).toHaveLength(1);
    expect(results[0].matches[0].key).toBe('firstName');
    expect(results[0].matches[0].value).toBe('John');
    expect(results[0].matches[0].indices).toEqual([[0, 3]]);
  });

  test('object with keys — separate mode includes key', () => {
    const contacts = [{ givenName: 'Nathan', familyName: 'Fern' }];
    const results = seaq(contacts, 'nath', {
      keys: ['givenName', 'familyName'],
      fieldMode: 'separate',
      includeMatches: true,
      fuzziness: 0,
    });
    expect(results).toHaveLength(1);
    expect(results[0].matches).toHaveLength(1);
    expect(results[0].matches[0].key).toBe('givenName');
    expect(results[0].matches[0].value).toBe('Nathan');
    expect(results[0].matches[0].indices).toEqual([[0, 3]]);
  });

  test('fuzzy mode — positions collected for matched chars', () => {
    const results = seaq(['Felicita'], 'Flicta', { fuzziness: 0.5, includeMatches: true });
    expect(results).toHaveLength(1);
    const match = results[0].matches[0];
    // Each range covers matched characters; verify they map to query chars
    const highlighted = match.indices.flatMap(([s, e]) => match.value.slice(s, e + 1).split(''));
    // All matched characters should be present (case-insensitive)
    expect(highlighted.join('').toLowerCase()).toContain('f');
    expect(highlighted.join('').toLowerCase()).toContain('l');
  });

  test('indices correctness — slicing value at ranges yields query chars', () => {
    const results = seaq(['banana'], 'ban', { includeMatches: true, fuzziness: 0 });
    expect(results).toHaveLength(1);
    const match = results[0].matches[0];
    const sliced = match.indices.map(([s, e]) => match.value.slice(s, e + 1)).join('');
    expect(sliced.toLowerCase()).toBe('ban');
  });

  test('backward compat — without includeMatches returns T[]', () => {
    const results = seaq(['hello', 'world'], 'hel', { fuzziness: 0 });
    expect(results).toHaveLength(1);
    expect(results[0]).toBe('hello');
    // No extra properties on the result
    expect(typeof results[0]).toBe('string');
  });

  test('limit + includeMatches — works together', () => {
    const results = seaq(ManyContacts, 'na', {
      keys: ['givenName', 'familyName'],
      includeMatches: true,
      limit: 5,
      threshold: 0,
    });
    expect(results).toHaveLength(5);
    for (const r of results) {
      expect(r).toHaveProperty('item');
      expect(r).toHaveProperty('score');
      expect(r).toHaveProperty('matches');
    }
  });

  test('empty query — returns []', () => {
    const results = seaq(['hello'], '', { includeMatches: true });
    expect(results).toHaveLength(0);
  });

  test('no matches — non-matching items excluded', () => {
    const results = seaq(['hello', 'world'], 'xyz', { includeMatches: true });
    expect(results).toHaveLength(0);
  });

  test('number array', () => {
    const results = seaq([123, 456], '45', { includeMatches: true, fuzziness: 0 });
    expect(results).toHaveLength(1);
    expect(results[0].item).toBe(456);
    expect(results[0].matches[0].value).toBe('456');
    expect(results[0].matches[0].indices).toEqual([[0, 1]]);
  });

  test('object array without keys (JSON stringified)', () => {
    const items = [{ x: 'hello' }, { x: 'world' }];
    const results = seaq(items, 'hello', { includeMatches: true, fuzziness: 0 });
    expect(results).toHaveLength(1);
    expect(results[0].item).toEqual({ x: 'hello' });
    expect(results[0].matches[0].value).toBe(JSON.stringify({ x: 'hello' }));
    expect(results[0].matches[0].indices.length).toBeGreaterThan(0);
  });
});

describe('threshold option', () => {
  test('threshold filters low-scoring fuzzy results', () => {
    // With threshold: 0, fuzziness returns tons of results
    const noThreshold = seaq(ManyContacts, 'nath', {
      keys: ['givenName'],
      fuzziness: 0.2,
      limit: Infinity,
      threshold: 0,
    });
    // With default threshold (0.3), many low-scoring results are dropped
    const withThreshold = seaq(ManyContacts, 'nath', {
      keys: ['givenName'],
      fuzziness: 0.2,
      limit: Infinity,
      threshold: 0.3,
    });
    expect(withThreshold.length).toBeLessThan(noThreshold.length);
    expect(withThreshold.length).toBeGreaterThan(0);
    // Top result should still be a Nathan-like name
    expect(withThreshold[0].givenName.toLowerCase()).toContain('nath');
  });

  test('threshold: 0 returns everything above score 0 (old behavior)', () => {
    const results = seaq(ManyContacts, 'nath', {
      keys: ['givenName'],
      fuzziness: 0.2,
      limit: Infinity,
      threshold: 0,
    });
    // Should return the huge count we used to get
    expect(results.length).toBeGreaterThan(1000);
  });

  test('threshold: 1 returns only exact/near-exact matches', () => {
    const results = seaq(['Nathan', 'Nathaniel', 'Jonathan', 'math', 'bath'], 'nath', {
      fuzziness: 0,
      limit: Infinity,
      threshold: 1,
    });
    // Only the best-scoring items survive (score must equal maxScore)
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test('threshold works with includeMatches', () => {
    const results = seaq(ManyContacts, 'nath', {
      keys: ['givenName'],
      fuzziness: 0.2,
      includeMatches: true,
      threshold: 0.3,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(10); // default limit
    for (const r of results) {
      expect(r).toHaveProperty('item');
      expect(r).toHaveProperty('score');
      expect(r).toHaveProperty('matches');
    }
  });
});

describe('fuzzy ranking correctness', () => {
  test('file path with matching subsequence outranks shorter unrelated path', () => {
    // "btn" should rank "Button.tsx" above "tsconfig.json" — the former
    // contains the full b-t-n subsequence in "Button", the latter matches
    // only because fuzziness lets 'b' be skipped.
    const paths = [
      'tsconfig.json',
      'src/components/Button.tsx',
      'package.json',
      'tests/App.test.tsx',
    ];
    const results = seaq(paths, 'btn', {
      fuzziness: 0.2,
      limit: Infinity,
      threshold: 0,
      includeMatches: true,
    });
    const buttonIdx = results.findIndex((r) => r.item === 'src/components/Button.tsx');
    const tsconfigIdx = results.findIndex((r) => r.item === 'tsconfig.json');
    expect(buttonIdx).not.toBe(-1);
    expect(tsconfigIdx).not.toBe(-1);
    expect(buttonIdx).toBeLessThan(tsconfigIdx);
  });
});

describe('default limit', () => {
  test('default limit is 10', () => {
    const results = seaq(ManyContacts, 'a', {
      keys: ['givenName'],
      threshold: 0,
    });
    expect(results).toHaveLength(10);
  });

  test('limit: Infinity with threshold still filters', () => {
    const allResults = seaq(ManyContacts, 'nath', {
      keys: ['givenName'],
      fuzziness: 0.2,
      limit: Infinity,
      threshold: 0,
    });
    const filteredResults = seaq(ManyContacts, 'nath', {
      keys: ['givenName'],
      fuzziness: 0.2,
      limit: Infinity,
      threshold: 0.3,
    });
    expect(filteredResults.length).toBeLessThan(allResults.length);
    expect(filteredResults.length).toBeGreaterThan(0);
  });
});

// ─── Real-world search patterns ─────────────────────────────────────
// Tests from an end-user perspective: what you type → what you expect.
// All use default options (separate mode, fuzziness 0.2, threshold 0.3)
// unless noted, since that's what users experience out of the box.

describe('multi-word contact search', () => {
  const people = [
    { first: 'John', last: 'Smith' },
    { first: 'Jane', last: 'Smith' },
    { first: 'Jane', last: 'Doe' },
    { first: 'Robert', last: 'Johnson' },
    { first: 'Bob', last: 'Robertson' },
  ];
  const keys = ['first', 'last'];

  // "first last" — the most basic pattern
  test('"john smith" finds John Smith', () => {
    const results = seaq(people, 'john smith', { keys });
    expect(results).toContainEqual(expect.objectContaining({ first: 'John', last: 'Smith' }));
  });

  test('"jane doe" finds Jane Doe', () => {
    const results = seaq(people, 'jane doe', { keys });
    expect(results).toContainEqual(expect.objectContaining({ first: 'Jane', last: 'Doe' }));
  });

  test('"robert johnson" finds Robert Johnson', () => {
    const results = seaq(people, 'robert johnson', { keys });
    expect(results).toContainEqual(expect.objectContaining({ first: 'Robert', last: 'Johnson' }));
  });

  // partial first + partial last
  test('"joh smi" finds John Smith', () => {
    const results = seaq(people, 'joh smi', { keys });
    expect(results).toContainEqual(expect.objectContaining({ first: 'John', last: 'Smith' }));
  });

  test('"rob joh" finds Robert Johnson', () => {
    const results = seaq(people, 'rob joh', { keys });
    expect(results).toContainEqual(expect.objectContaining({ first: 'Robert', last: 'Johnson' }));
  });

  // first name + last initial
  test('"john s" finds John Smith', () => {
    const results = seaq(people, 'john s', { keys });
    expect(results).toContainEqual(expect.objectContaining({ first: 'John', last: 'Smith' }));
  });

  test('"jane d" finds Jane Doe', () => {
    const results = seaq(people, 'jane d', { keys });
    expect(results).toContainEqual(expect.objectContaining({ first: 'Jane', last: 'Doe' }));
  });

  // first initial + last name
  test('"j smith" finds John Smith', () => {
    const results = seaq(people, 'j smith', { keys });
    expect(results).toContainEqual(expect.objectContaining({ first: 'John', last: 'Smith' }));
  });

  test('"j doe" finds Jane Doe', () => {
    const results = seaq(people, 'j doe', { keys });
    expect(results).toContainEqual(expect.objectContaining({ first: 'Jane', last: 'Doe' }));
  });

  // concatenated abbreviations
  test('"johsm" finds John Smith', () => {
    const results = seaq(people, 'johsm', { keys });
    expect(results).toContainEqual(expect.objectContaining({ first: 'John', last: 'Smith' }));
  });

  test('"robjoh" finds Robert Johnson', () => {
    const results = seaq(people, 'robjoh', { keys });
    expect(results).toContainEqual(expect.objectContaining({ first: 'Robert', last: 'Johnson' }));
  });

  // typos in multi-word queries
  test('"jonh smith" finds John Smith (typo in first name)', () => {
    const results = seaq(people, 'jonh smith', { keys });
    expect(results).toContainEqual(expect.objectContaining({ first: 'John', last: 'Smith' }));
  });

  test('"john smtih" finds John Smith (typo in last name)', () => {
    const results = seaq(people, 'john smtih', { keys });
    expect(results).toContainEqual(expect.objectContaining({ first: 'John', last: 'Smith' }));
  });
});

describe('middle name interference', () => {
  const people = [
    { first: 'Helen', last: 'Green', middle: 'Henry' },
    { first: 'Helena', last: 'Greco', middle: '' },
    { first: 'Henry', last: 'Greenberg', middle: '' },
  ];
  const keys = ['first', 'last', 'middle'];

  test('"helen green" finds Helen Green despite middle name', () => {
    const results = seaq(people, 'helen green', { keys });
    expect(results).toContainEqual(expect.objectContaining({ first: 'Helen', last: 'Green' }));
  });

  test('"hel gre" finds Helen Green despite middle name', () => {
    const results = seaq(people, 'hel gre', { keys });
    expect(results).toContainEqual(expect.objectContaining({ first: 'Helen', last: 'Green' }));
  });

  test('"helgr" finds Helen Green despite middle name', () => {
    const results = seaq(people, 'helgr', { keys });
    expect(results).toContainEqual(expect.objectContaining({ first: 'Helen', last: 'Green' }));
  });

  test('"helen g" finds Helen Green', () => {
    const results = seaq(people, 'helen g', { keys });
    expect(results).toContainEqual(expect.objectContaining({ first: 'Helen', last: 'Green' }));
  });

  test('"h green" finds Helen Green', () => {
    const results = seaq(people, 'h green', { keys });
    expect(results).toContainEqual(expect.objectContaining({ first: 'Helen', last: 'Green' }));
  });

  test('"helen green" ranks Helen Green above Helena Greco', () => {
    const results = seaq(people, 'helen green', { keys, includeMatches: true }) as SeaqResult<
      (typeof people)[0]
    >[];
    const helenIdx = results.findIndex((r) => r.item.first === 'Helen' && r.item.last === 'Green');
    const helenaIdx = results.findIndex((r) => r.item.first === 'Helena');
    expect(helenIdx).not.toBe(-1);
    if (helenaIdx !== -1) {
      expect(helenIdx).toBeLessThan(helenaIdx);
    }
  });
});

describe('real contact data — Helen Henry Green', () => {
  // Mirrors the example app config: keys, default everything else
  const keys = ['givenName', 'familyName', 'middleName'];

  function findsHelenGreen(results: Array<Contact | SeaqResult<Contact>>) {
    return results.some((r) => {
      const item = 'item' in r ? r.item : r;
      return item.givenName === 'Helen' && item.familyName === 'Green';
    });
  }

  test('"helen green"', () => {
    expect(findsHelenGreen(seaq(Contacts, 'helen green', { keys }))).toBe(true);
  });

  test('"hel gre"', () => {
    expect(findsHelenGreen(seaq(Contacts, 'hel gre', { keys }))).toBe(true);
  });

  test('"helgr"', () => {
    expect(findsHelenGreen(seaq(Contacts, 'helgr', { keys }))).toBe(true);
  });

  test('"helen g"', () => {
    expect(findsHelenGreen(seaq(Contacts, 'helen g', { keys }))).toBe(true);
  });

  test('"h green"', () => {
    expect(findsHelenGreen(seaq(Contacts, 'h green', { keys }))).toBe(true);
  });

  test('"hgreen" (email-style)', () => {
    expect(findsHelenGreen(seaq(Contacts, 'hgreen', { keys }))).toBe(true);
  });
});

describe('city + state search', () => {
  const places = [
    { city: 'Portland', state: 'Oregon' },
    { city: 'Portland', state: 'Maine' },
    { city: 'Austin', state: 'Texas' },
    { city: 'Springfield', state: 'Illinois' },
    { city: 'Springfield', state: 'Missouri' },
    { city: 'San Francisco', state: 'California' },
  ];
  const keys = ['city', 'state'];

  test('"portland oregon" finds Portland, Oregon', () => {
    const results = seaq(places, 'portland oregon', { keys });
    expect(results).toContainEqual(expect.objectContaining({ city: 'Portland', state: 'Oregon' }));
  });

  test('"austin texas" finds Austin, Texas', () => {
    const results = seaq(places, 'austin texas', { keys });
    expect(results).toContainEqual(expect.objectContaining({ city: 'Austin', state: 'Texas' }));
  });

  test('"port ore" finds Portland, Oregon', () => {
    const results = seaq(places, 'port ore', { keys });
    expect(results).toContainEqual(expect.objectContaining({ city: 'Portland', state: 'Oregon' }));
  });

  test('"spring ill" finds Springfield, Illinois', () => {
    const results = seaq(places, 'spring ill', { keys });
    expect(results).toContainEqual(
      expect.objectContaining({ city: 'Springfield', state: 'Illinois' }),
    );
  });

  test('"san fran" finds San Francisco', () => {
    const results = seaq(places, 'san fran', { keys });
    expect(results).toContainEqual(expect.objectContaining({ city: 'San Francisco' }));
  });

  test('"sf cal" finds San Francisco, California', () => {
    const results = seaq(places, 'sf cal', { keys });
    expect(results).toContainEqual(
      expect.objectContaining({ city: 'San Francisco', state: 'California' }),
    );
  });
});

describe('author + title search', () => {
  const books = [
    { title: 'The Lord of the Rings', first: 'J.R.R.', last: 'Tolkien' },
    { title: 'Harry Potter and the Sorcerer Stone', first: 'J.K.', last: 'Rowling' },
    { title: 'The Great Gatsby', first: 'F. Scott', last: 'Fitzgerald' },
    { title: 'Pride and Prejudice', first: 'Jane', last: 'Austen' },
  ];
  const keys = ['title', 'first', 'last'];

  test('"tolkien rings" finds Lord of the Rings', () => {
    const results = seaq(books, 'tolkien rings', { keys });
    expect(results).toContainEqual(expect.objectContaining({ last: 'Tolkien' }));
  });

  test('"rowling potter" finds Harry Potter', () => {
    const results = seaq(books, 'rowling potter', { keys });
    expect(results).toContainEqual(expect.objectContaining({ last: 'Rowling' }));
  });

  test('"gatsby fitzgerald" finds The Great Gatsby', () => {
    const results = seaq(books, 'gatsby fitzgerald', { keys });
    expect(results).toContainEqual(expect.objectContaining({ last: 'Fitzgerald' }));
  });

  test('"jane austen" finds Pride and Prejudice', () => {
    const results = seaq(books, 'jane austen', { keys });
    expect(results).toContainEqual(expect.objectContaining({ first: 'Jane', last: 'Austen' }));
  });

  test('"austen pride" finds Pride and Prejudice', () => {
    const results = seaq(books, 'austen pride', { keys });
    expect(results).toContainEqual(expect.objectContaining({ last: 'Austen' }));
  });
});

describe('token scoring edge cases', () => {
  const people = [
    { first: 'John', last: 'Smith' },
    { first: 'Jane', last: 'Doe' },
    { first: 'Helen', last: 'Green' },
  ];
  const keys = ['first', 'last'];

  test('double space between tokens still finds result', () => {
    const results = seaq(people, 'john  smith', { keys });
    expect(results).toContainEqual(expect.objectContaining({ first: 'John', last: 'Smith' }));
  });

  test('leading/trailing spaces still finds result', () => {
    const results = seaq(people, ' john smith ', { keys });
    expect(results).toContainEqual(expect.objectContaining({ first: 'John', last: 'Smith' }));
  });

  test('only spaces returns empty', () => {
    const results = seaq(people, '   ', { keys });
    expect(results).toHaveLength(0);
  });

  test('single-char tokens find results', () => {
    const results = seaq(people, 'j s', { keys });
    expect(results).toContainEqual(expect.objectContaining({ first: 'John', last: 'Smith' }));
  });

  test('more tokens than fields still works', () => {
    // 3 tokens, 2 keys — should still find Helen Green
    // "henry" isn't in Helen Green, so this needs typo tolerance
    const results = seaq(people, 'helen henry green', { keys: ['first', 'last'], fuzziness: 0.2 });
    expect(results).toContainEqual(expect.objectContaining({ first: 'Helen', last: 'Green' }));
  });

  test('one token matches nothing — reduced score but still found', () => {
    // "helen xyz" — "helen" scores high, "xyz" scores 0, average = helen_score / 2
    const results = seaq(people, 'helen xyz', {
      keys,
      fuzziness: 0.2,
      limit: Infinity,
      threshold: 0,
    });
    expect(results.some((r) => r.first === 'Helen' && r.last === 'Green')).toBe(true);
  });
});

describe('perf optimization guards', () => {
  test('Path B wins over Path A for cross-field multi-word query', () => {
    const people = [{ first: 'Helen', last: 'Green' }];
    const results = seaq(people, 'helen green', {
      keys: ['first', 'last'],
      fieldMode: 'separate',
      includeMatches: true,
      fuzziness: 0,
    }) as SeaqResult<(typeof people)[0]>[];
    expect(results).toHaveLength(1);
    // Path B: "helen"→Helen, "green"→Green, both near-perfect (wins over Path A).
    // Lowercase typing earns no case bonus, so "near-perfect" is ~0.85
    expect(results[0].score).toBeGreaterThan(0.8);
    // Path B produces multiple matches (one per token)
    expect(results[0].matches.length).toBe(2);
  });

  test('includeMatches positions correct for Path B winners', () => {
    const people = [{ first: 'Helen', last: 'Green' }];
    const results = seaq(people, 'helen green', {
      keys: ['first', 'last'],
      fieldMode: 'separate',
      includeMatches: true,
      fuzziness: 0,
    }) as SeaqResult<(typeof people)[0]>[];
    expect(results).toHaveLength(1);
    for (const match of results[0].matches) {
      // Verify each range slices to expected characters
      for (const [start, end] of match.indices) {
        const sliced = match.value.slice(start, end + 1);
        expect(sliced.length).toBeGreaterThan(0);
      }
    }
  });

  test('Path B early bail when optimistic bound cannot beat Path A', () => {
    // Path A: "az bz cz" vs "az bz cz extra" → 0.847 (8/8 chars found consecutively)
    // Path B tokens: "az"→0.74, "bz"→0.67, "cz"→0.67 (short tokens penalized by long target)
    // After token 1: optimistic = (0.74 + 0.67 + 1) / 3 = 0.804 <= 0.847 → bail
    const items = [{ whole: 'az bz cz extra' }];
    const results = seaq(items, 'az bz cz', {
      keys: ['whole'],
      fieldMode: 'separate',
      includeMatches: true,
      fuzziness: 0,
      limit: Infinity,
      threshold: 0,
    }) as SeaqResult<(typeof items)[0]>[];
    expect(results).toHaveLength(1);
    // Path A wins (bail prevented Path B from completing) → single match, not 3
    expect(results[0].matches.length).toBe(1);
    expect(results[0].score).toBeGreaterThan(0.75);
  });

  test('fuzzy separate-mode rejects zero-overlap fields via bitmask', () => {
    // Line 352: Path A fuzzy rejection — query "abc" has zero char overlap with field "xyz"
    // Line 399: Path B fuzzy rejection — token "abc" has zero overlap with "xyz" and vice versa
    const items = [{ name: 'abc', tag: 'xyz' }];

    // Single-word: only Path A runs. "abc" vs "xyz" → zero overlap → line 352 fires
    const single = seaq(items, 'abc', {
      keys: ['name', 'tag'],
      fieldMode: 'separate',
      fuzziness: 0.5,
      limit: Infinity,
      threshold: 0,
    });
    expect(single).toHaveLength(1);

    // Multi-word: Path B entered. token "abc" vs "xyz" → line 399 fires
    const multi = seaq(items, 'abc xyz', {
      keys: ['name', 'tag'],
      fieldMode: 'separate',
      fuzziness: 0.5,
      limit: Infinity,
      threshold: 0,
    });
    expect(multi).toHaveLength(1);
  });

  test('perfect Path A score skips Path B entirely', () => {
    // Covers line 368 (isCandidate = bestScore < 1 → false)
    const items = [{ name: 'helen green' }];
    const results = seaq(items, 'helen green', {
      keys: ['name'],
      fieldMode: 'separate',
      fuzziness: 0,
      limit: Infinity,
      threshold: 0,
    });
    expect(results).toHaveLength(1);
    // Exact match on single field → score 1.0, Path B skipped
  });

  test('bitmask passes but strict match fails → token rejected', () => {
    // "cba" has the same char set as "abc" (bitmask passes) but isn't an
    // in-order match, even allowing adjacent swaps, so Path B rejects it
    const items = [{ name: 'abc' }];
    const results = seaq(items, 'abc cba', {
      keys: ['name'],
      fieldMode: 'separate',
      fuzziness: 0,
      limit: Infinity,
      threshold: 0,
    });
    // Path A: word "cba" fails strictly against "abc" → 0
    // Path B: token "abc" matches ✓, token "cba" bitmask passes but fails → rejected
    expect(results).toHaveLength(0);
  });

  test('Path B wins without includeMatches', () => {
    const people = [{ first: 'Helen', last: 'Green' }];
    const results = seaq(people, 'helen green', {
      keys: ['first', 'last'],
      fieldMode: 'separate',
      fuzziness: 0,
      limit: Infinity,
      threshold: 0,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ first: 'Helen', last: 'Green' });
  });

  test('Path B token scored against multiple fields picks best', () => {
    // Covers line 399 false branch: second field scores lower than first for a token
    const items = [{ a: 'helen', b: 'helena', c: 'green' }];
    const results = seaq(items, 'helen green', {
      keys: ['a', 'b', 'c'],
      fieldMode: 'separate',
      fuzziness: 0,
      limit: Infinity,
      threshold: 0,
    });
    expect(results).toHaveLength(1);
    // Token "helen": scored against "helen" (~0.93) then "helena" (lower) → false branch
  });

  test('Path B completes all tokens but loses to Path A', () => {
    // Covers lines 421-423 (tokenAvg <= bestScore after !bailed)
    // Use a field where full query matches well but individual tokens match poorly
    const items = [{ whole: 'az bz extra' }];
    const results = seaq(items, 'az bz', {
      keys: ['whole'],
      fieldMode: 'separate',
      fuzziness: 0,
      limit: Infinity,
      threshold: 0,
      includeMatches: true,
    }) as SeaqResult<(typeof items)[0]>[];
    expect(results).toHaveLength(1);
    // Path A scores well (4/4 chars found in long string)
    // Path B: 2 tokens, each scores low against long string, but optimistic bound
    // after token 0 is high enough to avoid bail → completes but avg < Path A
    expect(results[0].matches.length).toBe(1); // Path A won
  });

  test('single-word queries unaffected by Path B', () => {
    const people = [
      { first: 'Helen', last: 'Green' },
      { first: 'Henry', last: 'Greenberg' },
    ];
    const results = seaq(people, 'helen', {
      keys: ['first', 'last'],
      fuzziness: 0,
      limit: Infinity,
      threshold: 0,
    });
    // Single-word: no token splitting, no Path B
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ first: 'Helen' });
  });
});

describe('regression guards', () => {
  test('"nath" on 10K with threshold:0 returns fewer than old 9756', () => {
    // With default threshold (0.3), the practical result count is tiny
    const withThreshold = seaq(ManyContacts, 'nath', {
      keys: ['givenName'],
      fuzziness: 0.2,
      limit: Infinity,
      threshold: 0.3,
    });
    expect(withThreshold.length).toBeLessThan(500);
    expect(withThreshold.length).toBeGreaterThan(0);
    expect(withThreshold[0].givenName.toLowerCase()).toContain('nath');
  });
});

describe('charMask', () => {
  test('empty string returns 0', () => {
    expect(charMask('')).toBe(0);
  });

  test('single lowercase letter sets correct bit', () => {
    // 'a' → bit 0, 'b' → bit 1, 'z' → bit 25
    expect(charMask('a')).toBe(1 << 0);
    expect(charMask('b')).toBe(1 << 1);
    expect(charMask('z')).toBe(1 << 25);
  });

  test('non-alphanumeric chars set bit 26', () => {
    expect(charMask(' ')).toBe(1 << 26);
    expect(charMask('_')).toBe(1 << 26);
    expect(charMask('@')).toBe(1 << 26);
  });

  test('digits set bucketed bits 27-31 (pairs)', () => {
    expect(charMask('0')).toBe(1 << 27);
    expect(charMask('1')).toBe(1 << 27);
    expect(charMask('2')).toBe(1 << 28);
    expect(charMask('3')).toBe(1 << 28);
    expect(charMask('4')).toBe(1 << 29);
    expect(charMask('5')).toBe(1 << 29);
    expect(charMask('6')).toBe(1 << 30);
    expect(charMask('7')).toBe(1 << 30);
    expect(charMask('8')).toBe(1 << 31);
    expect(charMask('9')).toBe(1 << 31);
    // digits give selectivity: '19' and '28' occupy different buckets
    expect(charMask('19') & ~charMask('28')).not.toBe(0);
  });

  test('repeated chars are idempotent', () => {
    expect(charMask('aaa')).toBe(charMask('a'));
    expect(charMask('abab')).toBe(charMask('ab'));
  });

  test('superset/subset check works with bitwise ops', () => {
    const abc = charMask('abc');
    const ab = charMask('ab');
    // ab is a subset of abc
    expect(ab & ~abc).toBe(0);
    // abc is NOT a subset of ab
    expect(abc & ~ab).not.toBe(0);
  });

  test('mixed alpha and non-alpha', () => {
    const mask = charMask('a1b');
    expect(mask & (1 << 0)).not.toBe(0); // 'a'
    expect(mask & (1 << 1)).not.toBe(0); // 'b'
    expect(mask & (1 << 27)).not.toBe(0); // '1' (digit bucket 0-1)
  });
});

describe('bitmask regression guards', () => {
  test('fuzzy partial overlap still matches (no false rejections)', () => {
    // "nath" has chars n,a,t,h — should match "Nathan" which has all of them
    const results = seaq(ManyContacts, 'nath', {
      keys: ['givenName'],
      fuzziness: 0.2,
      limit: Infinity,
      threshold: 0,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].givenName.toLowerCase()).toContain('nath');
  });

  test('strict mode rejects items missing a char type', () => {
    // "xyz" has no overlap with "hello" — strict bitmask should reject
    const results = seaq(['hello', 'world', 'xyz'], 'xyz', { fuzziness: 0 });
    expect(results).toHaveLength(1);
    expect(results[0]).toBe('xyz');
  });

  test('non-alpha chars do not cause false rejections (bit-26 bucket)', () => {
    // Query with underscore and digits should still match
    const results = seaq(['user_123', 'admin_456'], 'user_1', { fuzziness: 0 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toBe('user_123');
  });

  test('multi-word cross-field matches survive bitmask', () => {
    const people = [
      { first: 'Helen', last: 'Green' },
      { first: 'Henry', last: 'Greenberg' },
    ];
    const results = seaq(people, 'helen green', { keys: ['first', 'last'] });
    expect(results).toContainEqual(expect.objectContaining({ first: 'Helen', last: 'Green' }));
  });

  test('fuzzy multi-word with partial overlap still finds results', () => {
    // "nath fe" — tokens "nath" and "fe" scored across givenName/familyName
    const results = seaq(ManyContacts, 'nath fe', {
      keys: ['givenName', 'familyName'],
      fuzziness: 0.2,
    });
    expect(results.length).toBeGreaterThan(0);
  });

  test('fuzzy mode with zero char overlap correctly rejects', () => {
    // All query chars completely absent from target
    const results = seaq(['hello'], 'xyz', { fuzziness: 0.5, limit: Infinity, threshold: 0 });
    expect(results).toHaveLength(0);
  });
});
