/** What each library finds, backing the README's feature comparison. */

import uFuzzy from '@leeoniya/ufuzzy';
import Fuse from 'fuse.js';
import fuzzysort from 'fuzzysort';
import MiniSearch from 'minisearch';
import { describe, expect, test } from 'vitest';
import { seaq } from '../../src/index';

const people = [
  {
    id: 1,
    name: 'John Smith',
    email: 'john@example.com',
    address: { city: 'New York', zip: '10001' },
  },
  {
    id: 2,
    name: 'Jane Doe',
    email: 'jane@test.com',
    address: { city: 'Los Angeles', zip: '90001' },
  },
  {
    id: 3,
    name: 'Johnny Appleseed',
    email: 'johnny@apple.com',
    address: { city: 'Seattle', zip: '98101' },
  },
  {
    id: 4,
    name: 'Jon Snow',
    email: 'jon@winterfell.com',
    address: { city: 'Denver', zip: '80201' },
  },
  {
    id: 5,
    name: 'Johnathan Winters',
    email: 'jwinters@comedy.com',
    address: { city: 'Chicago', zip: '60601' },
  },
  {
    id: 6,
    name: 'Sarah Connor',
    email: 'sarah@skynet.com',
    address: { city: 'Los Angeles', zip: '90002' },
  },
  {
    id: 7,
    name: 'Mike Johnson',
    email: 'mike.j@work.com',
    address: { city: 'New York', zip: '10002' },
  },
];

const acronymData = [
  'Hillsdale Michigan',
  'Historical Museum',
  'High Mountain',
  'himalayas',
  'something else',
];

const nestedData = [
  {
    name: 'Alice',
    emails: [
      { type: 'work', address: 'alice@work.com' },
      { type: 'personal', address: 'alice@gmail.com' },
    ],
    tags: ['developer', 'manager'],
  },
  {
    name: 'Bob',
    emails: [{ type: 'work', address: 'bob@company.org' }],
    tags: ['designer'],
  },
  {
    name: 'Charlie',
    emails: [
      { type: 'personal', address: 'charlie@yahoo.com' },
      { type: 'work', address: 'c.brown@bigcorp.com' },
    ],
    tags: ['developer', 'lead'],
  },
];

describe('Feature: Exact Match', () => {
  test('seaq finds exact match', () => {
    const results = seaq(people, 'John Smith', { keys: ['name'] });
    expect(results[0]?.name).toBe('John Smith');
  });

  test('fuse.js finds exact match', () => {
    const fuse = new Fuse(people, { keys: ['name'], threshold: 0.0 });
    const results = fuse.search('John Smith');
    expect(results[0]?.item.name).toBe('John Smith');
  });

  test('minisearch finds exact match', () => {
    const ms = new MiniSearch({ fields: ['name'], storeFields: ['name'] });
    ms.addAll(people);
    const results = ms.search('John Smith');
    expect(results[0]?.name).toBe('John Smith');
  });

  test('fuzzysort finds exact match', () => {
    const results = fuzzysort.go('John Smith', people, { key: 'name' });
    expect(results[0]?.obj.name).toBe('John Smith');
  });

  test('ufuzzy finds exact match', () => {
    const uf = new uFuzzy();
    const haystack = people.map((p) => p.name);
    const [idxs] = uf.search(haystack, 'John Smith');
    expect(idxs?.[0]).toBe(0);
  });
});

describe('Feature: Fuzzy/Typo Tolerance', () => {
  test('seaq with fuzziness finds typo', () => {
    const results = seaq(people, 'jonh', { keys: ['name'], fuzziness: 0.5 });
    const names = results.map((r) => r.name);
    expect(names.some((n) => n.includes('John'))).toBe(true);
  });

  test('seaq finds the swap "jonh" even with fuzziness 0', () => {
    const names = seaq(people, 'jonh', { keys: ['name'], fuzziness: 0 }).map((r) => r.name);
    expect(names.some((n) => n.includes('John'))).toBe(true);
  });

  test('fuse.js finds typo (default threshold)', () => {
    const fuse = new Fuse(people, { keys: ['name'] });
    const results = fuse.search('jonh');
    const names = results.map((r) => r.item.name);
    expect(names.some((n) => n.includes('John'))).toBe(true);
  });

  test('minisearch fuzzy matching is per word, by edit distance', () => {
    const ms = new MiniSearch({ fields: ['name'], storeFields: ['name'] });
    ms.addAll(people);
    // "jonh" is one edit from "jon", two from "john"
    expect(ms.search('jonh', { fuzzy: 0.3 }).map((r) => r.name)).toEqual(['Jon Snow']);
  });

  test('fuzzysort matches characters in order only, so not "jonh"', () => {
    expect(fuzzysort.go('jonh', people, { key: 'name' })).toHaveLength(0);
  });

  test('ufuzzy in fuzzy mode finds typo', () => {
    const uf = new uFuzzy({ intraMode: 1 });
    const haystack = people.map((p) => p.name);
    const [idxs] = uf.search(haystack, 'jonh');
    const foundNames = idxs?.map((i) => haystack[i]) ?? [];
    expect(foundNames.some((n) => n?.includes('John'))).toBe(true);
  });
});

describe('Feature: Partial/Prefix Matching', () => {
  const names = ['Natasha', 'Nathan', 'Nathaniel', 'Bob', 'Nancy'];

  test('seaq finds partial matches', () => {
    const results = seaq(names, 'nat');
    expect(results).toContain('Natasha');
    expect(results).toContain('Nathan');
    expect(results).toContain('Nathaniel');
    expect(results).not.toContain('Bob');
  });

  test('fuse.js finds partial matches', () => {
    const fuse = new Fuse(names);
    const results = fuse.search('nat').map((r) => r.item);
    expect(results).toContain('Natasha');
    expect(results).toContain('Nathan');
  });

  test('minisearch finds prefix matches', () => {
    const ms = new MiniSearch({ fields: ['name'], storeFields: ['name'] });
    ms.addAll(names.map((name, id) => ({ id, name })));
    const results = ms.search('nat', { prefix: true }).map((r) => r.name);
    expect(results).toContain('Natasha');
    expect(results).toContain('Nathan');
  });

  test('fuzzysort finds partial matches', () => {
    const results = fuzzysort.go('nat', names).map((r) => r.target);
    expect(results).toContain('Natasha');
    expect(results).toContain('Nathan');
    expect(results).not.toContain('Bob');
  });

  test('ufuzzy finds partial matches', () => {
    const uf = new uFuzzy();
    const [idxs] = uf.search(names, 'nat');
    const results = idxs?.map((i) => names[i]) ?? [];
    expect(results).toContain('Natasha');
    expect(results).toContain('Nathan');
  });
});

describe('Feature: Acronym Matching', () => {
  test('seaq prioritizes acronym matches', () => {
    const results = seaq(acronymData, 'HiMi');
    expect(results[0]).toBe('Hillsdale Michigan');
  });

  test('fuse.js ranks a substring match above the acronym', () => {
    const results = new Fuse(acronymData).search('HiMi').map((r) => r.item);
    expect(results.slice(0, 2)).toEqual(['himalayas', 'Hillsdale Michigan']);
  });

  test('fuzzysort prioritizes acronym matches', () => {
    const results = fuzzysort.go('HiMi', acronymData).map((r) => r.target);
    expect(results[0]).toBe('Hillsdale Michigan');
  });

  test('ufuzzy finds no acronym match', () => {
    const [idxs] = new uFuzzy().search(acronymData, 'HiMi');
    expect(idxs ?? []).toHaveLength(0);
  });
});

describe('Feature: Nested Object Access', () => {
  test('seaq searches nested properties', () => {
    const results = seaq(people, 'New York', { keys: ['address.city'], fuzziness: 0 });
    expect(results.length).toBe(2);
    expect(results.every((r) => r.address.city === 'New York')).toBe(true);
  });

  test('seaq searches deeply nested arrays', () => {
    const results = seaq(nestedData, 'bigcorp', { keys: ['emails.address'], fuzziness: 0 });
    expect(results.length).toBe(1);
    expect(results[0]?.name).toBe('Charlie');
  });

  test('fuse.js searches nested properties', () => {
    const fuse = new Fuse(people, { keys: ['address.city'] });
    const results = fuse.search('New York');
    expect(results.length).toBe(2);
  });

  test('fuse.js searches array fields', () => {
    const results = new Fuse(nestedData, { keys: ['emails.address'] }).search('bigcorp');
    expect(results.some((r) => r.item.name === 'Charlie')).toBe(true);
  });

  test('minisearch reads nested fields through extractField', () => {
    const ms = new MiniSearch({
      fields: ['city'],
      storeFields: ['name'],
      extractField: (doc, field) => (field === 'city' ? doc.address.city : doc[field]),
    });
    ms.addAll(people);
    expect(ms.search('New York')).toHaveLength(2);
  });

  test('fuzzysort searches nested properties', () => {
    const results = fuzzysort.go('New York', people, { key: 'address.city' });
    expect(results.length).toBe(2);
  });

  test('fuzzysort needs a getter for array fields', () => {
    expect(fuzzysort.go('bigcorp', nestedData, { key: 'emails.address' }).length).toBe(0);
    const results = fuzzysort.go('bigcorp', nestedData, {
      key: (d) => d.emails.map((e) => e.address).join(' '),
    });
    expect(results.map((r) => r.obj.name)).toEqual(['Charlie']);
  });

  test('ufuzzy searches strings, not objects', () => {
    const haystack = people.map((p) => p.address.city);
    const uf = new uFuzzy();
    const [idxs] = uf.search(haystack, 'New York');
    expect(idxs?.length).toBe(2);
  });
});

describe('Feature: Multi-word Queries', () => {
  test('seaq handles multi-word across fields', () => {
    const results = seaq(people, 'john new', { keys: ['name', 'address.city'] });
    expect(results.some((r) => r.name.includes('John') && r.address.city === 'New York')).toBe(
      true,
    );
  });

  test('fuse.js scores the whole query against each field', () => {
    const results = new Fuse(people, { keys: ['name', 'address.city'] }).search('john new');
    expect(results[0]?.item.name).toBe('John Smith');
  });

  test('fuzzysort handles multi-word across fields', () => {
    const results = fuzzysort.go('john new', people, { keys: ['name', 'address.city'] });
    expect(
      results.some((r) => r.obj.name.includes('John') && r.obj.address.city === 'New York'),
    ).toBe(true);
  });

  test('minisearch matches each word in any field', () => {
    const flattened = people.map((p) => ({ ...p, city: p.address.city }));
    const ms = new MiniSearch({ fields: ['name', 'city'], storeFields: ['name', 'city'] });
    ms.addAll(flattened);
    expect(ms.search('john new')[0]?.name).toBe('John Smith');
  });
});

describe('Quality: Ranking', () => {
  test('seaq ranks exact match first', () => {
    const results = seaq(people, 'John Smith', { keys: ['name'] });
    expect(results[0]?.name).toBe('John Smith');
  });

  test('seaq ranks by relevance', () => {
    const results = seaq(people, 'John', { keys: ['name'] });
    const johnSmithIdx = results.findIndex((r) => r.name === 'John Smith');
    const mikeJohnsonIdx = results.findIndex((r) => r.name === 'Mike Johnson');
    expect(johnSmithIdx).toBeLessThan(mikeJohnsonIdx);
  });

  test('fuse.js ranks by score', () => {
    const results = new Fuse(people, { keys: ['name'] }).search('John');
    expect(results[0]?.item.name).toBe('John Smith');
  });
});

describe('Quality: Ranking (fuzzysort)', () => {
  test('fuzzysort ranks by relevance', () => {
    const results = fuzzysort.go('John', people, { key: 'name' });
    expect(results[0]?.obj.name).toBe('John Smith');
  });
});
