/**
 * The list index (cache: true in joined mode / keyless lists) must return
 * exactly what the unindexed scan returns — same items, same order, same
 * match metadata — for every option combination.
 */
import type { City, Contact } from '@seaq/test-data';
import Books from '@seaq/test-data/books.json';
import Cities from '@seaq/test-data/cities.json';
import Contacts from '@seaq/test-data/contacts-1k.json';
import { describe, expect, test } from 'vitest';
import { type SeaqOptions, seaq } from '../src/index';

const contacts = Contacts as Contact[];
const cities = (Cities as City[]).slice(0, 3000);
const names = contacts.map((c) => `${c.givenName} ${c.familyName}`);

const queries = [
  'n',
  'na',
  'nath',
  'nath fe',
  'jonh',
  'Smith',
  'xq',
  'zzzz',
  'NYC',
  'san jose',
  '555',
  '12',
  'o@',
  'élan',
  'a b c d e f',
  'natasha okeefe',
];

function compare<T>(list: T[], query: string, options: SeaqOptions<T>) {
  const plain = seaq(list, query, { ...options, cache: false });
  const indexed = seaq(list, query, { ...options, cache: true });
  expect(indexed).toEqual(plain);
  // Same objects, not just equal ones
  const unwrap = (r: unknown) =>
    options.includeMatches ? (r as { item: unknown }).item : (r as unknown);
  expect(indexed.map(unwrap)).toStrictEqual(plain.map(unwrap));
}

const optionGrid: Array<Partial<SeaqOptions<unknown>>> = [];
for (const fuzziness of [0, 0.2, 0.5, 1]) {
  for (const limit of [1, 3, 10, 2.5, Number.POSITIVE_INFINITY]) {
    for (const threshold of [0, 0.3, 0.9]) {
      optionGrid.push({ fuzziness, limit, threshold });
    }
  }
}

describe('list index matches the unindexed scan', () => {
  test.each(optionGrid)('contacts joined %o', (opts) => {
    for (const q of queries) {
      compare(contacts, q, { ...opts, keys: ['givenName', 'familyName', 'emailAddresses.email'] });
    }
  });

  test.each(optionGrid)('cities joined %o', (opts) => {
    for (const q of queries) compare(cities, q, { ...opts, keys: ['name', 'state'] });
  });

  test.each(optionGrid)('string array %o', (opts) => {
    for (const q of queries) compare(names, q, opts as SeaqOptions<string>);
  });

  test('books with nested keys and includeMatches', () => {
    for (const fuzziness of [0, 0.2]) {
      for (const q of ['hi', 'old man', 'jk', 'tolkein']) {
        compare(Books, q, {
          keys: ['title', 'author.firstName', 'author.lastName'],
          fuzziness,
          includeMatches: true,
        });
      }
    }
  });

  test('keyless mixed values (numbers, objects, null holes)', () => {
    const mixed: unknown[] = [12345, 'alpha', null, { a: 'beta' }, undefined, 'alphabet', 999, ''];
    for (const fuzziness of [0, 0.3]) {
      for (const q of ['alp', '99', 'beta', 'b']) compare(mixed, q, { fuzziness });
    }
  });
});

describe('typing (strict narrowing) stays exact', () => {
  test('keystroke sequences, including backspaces and jumps', () => {
    const list = contacts.slice();
    const sequence = ['n', 'na', 'nat', 'nata', 'nat', 'nath', 'nath ', 'nath f', 'x', 'na', 'NA'];
    for (const fuzziness of [0, 0.2]) {
      for (const q of sequence) {
        compare(list, q, { keys: ['givenName', 'familyName'], fuzziness, limit: Infinity });
        compare(list, q, { keys: ['givenName', 'familyName'], fuzziness });
      }
    }
  });

  test('narrowing is not reused across different keys', () => {
    const list = contacts.slice();
    compare(list, 'na', { keys: ['givenName'], fuzziness: 0, limit: Infinity });
    compare(list, 'nat', { keys: ['familyName'], fuzziness: 0, limit: Infinity });
    compare(list, 'nath', { keys: ['givenName'], fuzziness: 0, limit: Infinity });
  });
});

describe('list changes are picked up', () => {
  const keys = ['givenName', 'familyName'];

  test('replacing an item at the same index', () => {
    const list = contacts.slice(0, 200);
    compare(list, 'nat', { keys, fuzziness: 0 });
    list[5] = { ...(list[5] as Contact), givenName: 'Natalia' };
    compare(list, 'nat', { keys, fuzziness: 0 });
    compare(list, 'nata', { keys, fuzziness: 0 }); // narrowing after a repair
    compare(list, 'natal', { keys, fuzziness: 0.2 });
  });

  test('push, pop and splice', () => {
    const list = contacts.slice(0, 200);
    compare(list, 'ma', { keys, fuzziness: 0 });
    list.push({ ...(contacts[300] as Contact), givenName: 'Mabel' });
    compare(list, 'mab', { keys, fuzziness: 0 });
    list.pop();
    compare(list, 'mab', { keys, fuzziness: 0 });
    list.splice(10, 3);
    compare(list, 'ma', { keys, fuzziness: 0.2 });
  });

  test('many replacements', () => {
    const list = names.slice(0, 60);
    for (let round = 0; round < 40; round++) {
      for (let i = 0; i < list.length; i += 3)
        list[i] = `${names[(i + round * 7) % names.length]} ${round}`;
      compare(list, 'na', { fuzziness: 0 });
      compare(list, 'an 1', { fuzziness: 0.2 });
    }
  });

  test('string arrays where a value changes', () => {
    const list = names.slice(0, 100);
    compare(list, 'an', { fuzziness: 0 });
    list[0] = 'Andromeda Anderson';
    compare(list, 'and', { fuzziness: 0 });
  });
});

describe('default caching', () => {
  const keys = ['givenName', 'familyName'];

  test('default results match an unindexed scan on every search', () => {
    const list = contacts.slice();
    for (const q of ['nath', 'nath fe', 'jonh', 'evans nath', 'xq']) {
      const plain = seaq(list, q, { keys, cache: false });
      // first default search scans, later ones use the index
      expect(seaq(list, q, { keys })).toEqual(plain);
      expect(seaq(list, q, { keys })).toEqual(plain);
    }
  });

  test('the first search of an array does not index it', () => {
    const list = contacts.slice(0, 50).map((c) => ({ ...c }));
    seaq(list, 'zz', { keys }); // first search: scan only
    (list[0] as Contact).givenName = 'Zelda'; // mutate in place
    // Second search builds the index from current data, so it sees the edit
    expect(seaq(list, 'zelda', { keys })[0]).toBe(list[0]);
  });

  test('in-place edits after indexing are not seen (documented); cache: false sees them', () => {
    const list = contacts.slice(0, 50).map((c) => ({ ...c }));
    seaq(list, 'zz', { keys });
    seaq(list, 'zz', { keys }); // index built
    (list[1] as Contact).givenName = 'Zelda';
    expect(seaq(list, 'zelda', { keys, fuzziness: 0 })).toEqual([]);
    expect(seaq(list, 'zelda', { keys, cache: false })[0]).toBe(list[1]);
    // Replacing the object is detected
    list[1] = { ...(list[1] as Contact) };
    expect(seaq(list, 'zelda', { keys })[0]).toBe(list[1]);
  });

  test('separate mode does not cache by default', () => {
    const list = contacts.slice(0, 50).map((c) => ({ ...c }));
    seaq(list, 'zz', { keys, fieldMode: 'separate' });
    seaq(list, 'zz', { keys, fieldMode: 'separate' });
    (list[2] as Contact).givenName = 'Zelda';
    expect(seaq(list, 'zelda', { keys, fieldMode: 'separate' })[0]).toBe(list[2]);
  });
});
