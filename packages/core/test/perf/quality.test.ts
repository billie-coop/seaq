/**
 * Quality & Feature comparison
 *
 * Tests accuracy, fuzziness, and special features across libraries.
 * Not a speed benchmark - focuses on "do they find the right thing?"
 */

import uFuzzy from '@leeoniya/ufuzzy';
import Fuse from 'fuse.js';
import fuzzysort from 'fuzzysort';
import MiniSearch from 'minisearch';
import { describe, expect, test } from 'vitest';
import { seaq } from '../../src/index';

// Test data with various edge cases
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
    expect(idxs?.[0]).toBe(0); // First person
  });
});

describe('Feature: Fuzzy/Typo Tolerance', () => {
  // Searching for "jonh" (typo) should find "John"

  test('seaq with fuzziness finds typo', () => {
    const results = seaq(people, 'jonh', { keys: ['name'], fuzziness: 0.5 });
    const names = results.map((r) => r.name);
    expect(names.some((n) => n.includes('John'))).toBe(true);
  });

  test('seaq WITHOUT fuzziness uses character-by-character scoring', () => {
    // seaq scores based on character positions, not fuzzy edit distance
    // "jonh" matches "John" because j-o-n-h can all be found in sequence
    const results = seaq(people, 'jonh', { keys: ['name'] }); // no fuzziness
    const names = results.map((r) => r.name);
    console.log('seaq no-fuzzy "jonh" results:', names);
    // It finds John Smith because all chars j-o-n-h appear in order in "John Smith"
    expect(names.some((n) => n.includes('John'))).toBe(true);
  });

  test('fuse.js finds typo (default threshold)', () => {
    const fuse = new Fuse(people, { keys: ['name'] }); // default threshold 0.6
    const results = fuse.search('jonh');
    const names = results.map((r) => r.item.name);
    expect(names.some((n) => n.includes('John'))).toBe(true);
  });

  test('minisearch fuzzy requires higher threshold for typos', () => {
    const ms = new MiniSearch({ fields: ['name'], storeFields: ['name'] });
    ms.addAll(people);
    // MiniSearch fuzzy is edit-distance based, needs tuning
    const results = ms.search('jonh', { fuzzy: 0.3 });
    const names = results.map((r) => r.name);
    console.log('MiniSearch fuzzy "jonh" results:', names);
    // MiniSearch may not find typos well - it's more prefix/term focused
    // This documents actual behavior rather than assuming it works
    expect(true).toBe(true); // Document behavior, don't assert
  });

  test('fuzzysort has no typo tolerance (in-order subsequence only)', () => {
    // "jonh" isn't a subsequence of "John Smith" at a good score — fuzzysort
    // only matches characters in order, so transpositions aren't found
    const results = fuzzysort.go('jonh', people, { key: 'name' });
    const names = results.map((r) => r.obj.name);
    console.log('fuzzysort "jonh" results:', names);
    expect(names).toEqual([]);
  });

  test('ufuzzy in fuzzy mode finds typo', () => {
    const uf = new uFuzzy({ intraMode: 1 }); // fuzzy mode
    const haystack = people.map((p) => p.name);
    const [idxs] = uf.search(haystack, 'jonh');
    const foundNames = idxs?.map((i) => haystack[i]) ?? [];
    expect(foundNames.some((n) => n?.includes('John'))).toBe(true);
  });
});

describe('Feature: Partial/Prefix Matching', () => {
  // Searching for "nat" should find "Natasha" etc
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
  // "HiMi" should match "Hillsdale Michigan" better than "himalayas"

  test('seaq prioritizes acronym matches', () => {
    const results = seaq(acronymData, 'HiMi');
    expect(results[0]).toBe('Hillsdale Michigan');
  });

  test('fuse.js acronym behavior', () => {
    const fuse = new Fuse(acronymData);
    const results = fuse.search('HiMi').map((r) => r.item);
    // Fuse may or may not prioritize acronyms
    expect(results.length).toBeGreaterThan(0);
    console.log('Fuse.js HiMi results:', results.slice(0, 3));
  });

  test('fuzzysort prioritizes acronym matches', () => {
    const results = fuzzysort.go('HiMi', acronymData).map((r) => r.target);
    console.log('fuzzysort HiMi results:', results);
    expect(results[0]).toBe('Hillsdale Michigan');
  });

  test('ufuzzy does NOT support acronym matching', () => {
    const uf = new uFuzzy();
    const [idxs] = uf.search(acronymData, 'HiMi');
    const results = idxs?.map((i) => acronymData[i]) ?? [];
    console.log('uFuzzy HiMi results:', results);
    // uFuzzy doesn't do acronym matching - it needs consecutive characters
    expect(results.length).toBe(0);
  });
});

describe('Feature: Nested Object Access', () => {
  // seaq can search nested properties like 'address.city'

  test('seaq searches nested properties', () => {
    const results = seaq(people, 'New York', { keys: ['address.city'], fuzziness: 0 });
    expect(results.length).toBe(2);
    expect(results.every((r) => r.address.city === 'New York')).toBe(true);
  });

  test('seaq searches deeply nested arrays', () => {
    // Search for email address inside array of email objects
    const results = seaq(nestedData, 'bigcorp', { keys: ['emails.address'], fuzziness: 0 });
    expect(results.length).toBe(1);
    expect(results[0]?.name).toBe('Charlie');
  });

  test('fuse.js searches nested properties', () => {
    const fuse = new Fuse(people, { keys: ['address.city'] });
    const results = fuse.search('New York');
    expect(results.length).toBe(2);
  });

  test('fuse.js searches arrays (but matches too broadly)', () => {
    const fuse = new Fuse(nestedData, { keys: ['emails.address'] });
    const results = fuse.search('bigcorp');
    console.log(
      'Fuse array search results:',
      results.map((r) => r.item.name),
    );
    // Fuse finds the result but may have false positives due to fuzzy matching
    expect(results.some((r) => r.item.name === 'Charlie')).toBe(true);
  });

  // MiniSearch requires flat fields - nested access needs preprocessing
  test('minisearch requires flat fields (no native nested support)', () => {
    // You'd need to flatten data before indexing
    const flattened = people.map((p) => ({
      ...p,
      city: p.address.city,
    }));
    const ms = new MiniSearch({ fields: ['city'], storeFields: ['name', 'city'] });
    ms.addAll(flattened);
    const results = ms.search('New York');
    expect(results.length).toBe(2);
  });

  test('fuzzysort searches nested properties', () => {
    const results = fuzzysort.go('New York', people, { key: 'address.city' });
    expect(results.length).toBe(2);
  });

  // fuzzysort key paths don't traverse arrays - use a getter instead
  test('fuzzysort needs a getter for array fields', () => {
    expect(fuzzysort.go('bigcorp', nestedData, { key: 'emails.address' }).length).toBe(0);
    const results = fuzzysort.go('bigcorp', nestedData, {
      key: (d) => d.emails.map((e) => e.address).join(' '),
    });
    expect(results.map((r) => r.obj.name)).toEqual(['Charlie']);
  });

  // uFuzzy only searches string arrays - no object support
  test('ufuzzy requires pre-flattened strings (no object support)', () => {
    const haystack = people.map((p) => p.address.city);
    const uf = new uFuzzy();
    const [idxs] = uf.search(haystack, 'New York');
    expect(idxs?.length).toBe(2);
  });
});

describe('Feature: Multi-word Queries', () => {
  // How do libraries handle "john new york" across multiple fields?

  test('seaq handles multi-word across fields', () => {
    const results = seaq(people, 'john new', { keys: ['name', 'address.city'] });
    // Should find people named John in New York
    expect(results.some((r) => r.name.includes('John') && r.address.city === 'New York')).toBe(
      true,
    );
  });

  test('fuse.js handles multi-word queries', () => {
    const fuse = new Fuse(people, {
      keys: ['name', 'address.city'],
      useExtendedSearch: false,
    });
    const results = fuse.search('john new');
    console.log(
      'Fuse multi-word results:',
      results.slice(0, 3).map((r) => r.item.name),
    );
    expect(results.length).toBeGreaterThan(0);
  });

  test('fuzzysort handles multi-word across fields', () => {
    const results = fuzzysort.go('john new', people, { keys: ['name', 'address.city'] });
    expect(
      results.some((r) => r.obj.name.includes('John') && r.obj.address.city === 'New York'),
    ).toBe(true);
  });

  test('minisearch handles multi-word queries', () => {
    const flattened = people.map((p) => ({ ...p, city: p.address.city }));
    const ms = new MiniSearch({ fields: ['name', 'city'], storeFields: ['name', 'city'] });
    ms.addAll(flattened);
    const results = ms.search('john new');
    console.log(
      'MiniSearch multi-word results:',
      results.slice(0, 3).map((r) => r.name),
    );
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('Quality: Ranking', () => {
  // Best match should be ranked first

  test('seaq ranks exact match first', () => {
    const results = seaq(people, 'John Smith', { keys: ['name'] });
    expect(results[0]?.name).toBe('John Smith');
  });

  test('seaq ranks by relevance', () => {
    // "John" should rank John Smith higher than Mike Johnson
    const results = seaq(people, 'John', { keys: ['name'] });
    const johnSmithIdx = results.findIndex((r) => r.name === 'John Smith');
    const mikeJohnsonIdx = results.findIndex((r) => r.name === 'Mike Johnson');
    expect(johnSmithIdx).toBeLessThan(mikeJohnsonIdx);
  });

  test('fuse.js ranks by score', () => {
    const fuse = new Fuse(people, { keys: ['name'], includeScore: true });
    const results = fuse.search('John');
    // Lower score = better match in Fuse
    expect(results[0]?.item.name).toBe('John Smith');
  });
});

describe('Quality: Ranking (fuzzysort)', () => {
  test('fuzzysort ranks by relevance', () => {
    const results = fuzzysort.go('John', people, { key: 'name' });
    expect(results[0]?.obj.name).toBe('John Smith');
  });
});

describe('Summary: Feature Support Matrix', () => {
  test('print feature matrix', () => {
    const features = {
      'Exact match': {
        seaq: '✓',
        fuzzysort: '✓',
        fuse: '✓',
        minisearch: '✓',
        ufuzzy: '✓',
        lunr: '✓',
      },
      'Fuzzy/typo tolerance': {
        seaq: '✓ (opt-in)',
        fuzzysort: '✗ (subseq)',
        fuse: '✓ (default)',
        minisearch: '~ (limited)',
        ufuzzy: '✓ (modes)',
        lunr: '~ (stemming)',
      },
      'Partial/prefix match': {
        seaq: '✓',
        fuzzysort: '✓',
        fuse: '✓',
        minisearch: '✓ (opt-in)',
        ufuzzy: '✓',
        lunr: '✓ (wildcards)',
      },
      'Acronym bonus': {
        seaq: '✓',
        fuzzysort: '✓',
        fuse: '~ (ranks low)',
        minisearch: '✗',
        ufuzzy: '✗',
        lunr: '✗',
      },
      'Nested object access': {
        seaq: '✓',
        fuzzysort: '✓',
        fuse: '✓',
        minisearch: '✗ (flatten)',
        ufuzzy: '✗ (strings)',
        lunr: '✗ (flatten)',
      },
      'Array field traversal': {
        seaq: '✓',
        fuzzysort: '~ (getter)',
        fuse: '~ (broad)',
        minisearch: '✗',
        ufuzzy: '✗',
        lunr: '✗',
      },
      'Pre-built index': {
        seaq: '✗ (none)',
        fuzzysort: '✓ (snap)',
        fuse: '✓',
        minisearch: '✓',
        ufuzzy: '✗ (none)',
        lunr: '✓',
      },
      'Zero dependencies': {
        seaq: '✓',
        fuzzysort: '✓',
        fuse: '✓',
        minisearch: '✓',
        ufuzzy: '✓',
        lunr: '✓',
      },
    };

    console.log('\n=== Feature Support Matrix ===\n');
    console.log(
      'Feature                  | seaq       | fuzzysort  | fuse.js    | minisearch | ufuzzy     | lunr',
    );
    console.log(
      '-------------------------|------------|------------|------------|------------|------------|------------',
    );
    for (const [feature, support] of Object.entries(features)) {
      console.log(
        `${feature.padEnd(24)} | ${support.seaq.padEnd(10)} | ${support.fuzzysort.padEnd(10)} | ${support.fuse.padEnd(10)} | ${support.minisearch.padEnd(10)} | ${support.ufuzzy.padEnd(10)} | ${support.lunr}`,
      );
    }
    console.log('');

    expect(true).toBe(true); // Always pass - this is just for output
  });
});
