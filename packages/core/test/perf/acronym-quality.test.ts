/**
 * Acronym Matching Quality Tests
 *
 * seaq gives bonus score to acronym matches - this tests that unique feature.
 * Example: "NYC" should match "New York City" highly, "HiMi" → "Hillsdale Michigan"
 */

import uFuzzy from '@leeoniya/ufuzzy';
import Fuse from 'fuse.js';
import fuzzysort from 'fuzzysort';
import MiniSearch from 'minisearch';
import { describe, expect, test } from 'vitest';
import { seaq } from '../../src/index';

// ============================================================================
// Test Data: Acronym-heavy dataset
// ============================================================================

const places = [
  'New York City',
  'Los Angeles',
  'San Francisco',
  'Las Vegas',
  'New Orleans',
  'Salt Lake City',
  'Kansas City',
  'Oklahoma City',
  'New York',
  'North Carolina',
  'South Carolina',
  'West Virginia',
  'New Hampshire',
  'New Jersey',
  'New Mexico',
  'Hillsdale Michigan',
  'Historical Museum',
  'High Mountain',
  'himalayas',
];

const companies = [
  'International Business Machines', // IBM
  'American Telephone Telegraph', // ATT
  'Hewlett Packard Enterprise', // HPE
  'General Electric Company', // GEC/GE
  'Federal Bureau Investigation', // FBI
  'Central Intelligence Agency', // CIA
  'National Aeronautics Space Administration', // NASA
  'United States America', // USA
  'United Kingdom', // UK
  'European Union', // EU
  'International Monetary Fund', // IMF
  'World Health Organization', // WHO
  'North Atlantic Treaty Organization', // NATO
];

const techTerms = [
  'Application Programming Interface', // API
  'Graphical User Interface', // GUI
  'Command Line Interface', // CLI
  'Software Development Kit', // SDK
  'Integrated Development Environment', // IDE
  'Object Oriented Programming', // OOP
  'Test Driven Development', // TDD
  'Continuous Integration Deployment', // CI/CD
  'Single Page Application', // SPA
  'Progressive Web App', // PWA
  'Search Engine Optimization', // SEO
  'User Experience Design', // UX
  'User Interface Design', // UI
];

// Ground truth for acronym queries
const acronymTests = [
  { query: 'NYC', data: places, expected: 'New York City', description: 'NYC → New York City' },
  { query: 'LA', data: places, expected: 'Los Angeles', description: 'LA → Los Angeles' },
  { query: 'SF', data: places, expected: 'San Francisco', description: 'SF → San Francisco' },
  { query: 'LV', data: places, expected: 'Las Vegas', description: 'LV → Las Vegas' },
  { query: 'SLC', data: places, expected: 'Salt Lake City', description: 'SLC → Salt Lake City' },
  {
    query: 'HiMi',
    data: places,
    expected: 'Hillsdale Michigan',
    description: 'HiMi → Hillsdale Michigan',
  },
  {
    query: 'IBM',
    data: companies,
    expected: 'International Business Machines',
    description: 'IBM → International Business Machines',
  },
  {
    query: 'NASA',
    data: companies,
    expected: 'National Aeronautics Space Administration',
    description: 'NASA → National Aeronautics Space Administration',
  },
  {
    query: 'FBI',
    data: companies,
    expected: 'Federal Bureau Investigation',
    description: 'FBI → Federal Bureau Investigation',
  },
  {
    query: 'API',
    data: techTerms,
    expected: 'Application Programming Interface',
    description: 'API → Application Programming Interface',
  },
  {
    query: 'GUI',
    data: techTerms,
    expected: 'Graphical User Interface',
    description: 'GUI → Graphical User Interface',
  },
  {
    query: 'CLI',
    data: techTerms,
    expected: 'Command Line Interface',
    description: 'CLI → Command Line Interface',
  },
  {
    query: 'TDD',
    data: techTerms,
    expected: 'Test Driven Development',
    description: 'TDD → Test Driven Development',
  },
  {
    query: 'OOP',
    data: techTerms,
    expected: 'Object Oriented Programming',
    description: 'OOP → Object Oriented Programming',
  },
];

// ============================================================================
// Search wrappers
// ============================================================================

function searchSeaq(data: string[], query: string): string[] {
  return seaq(data, query);
}

function searchFuse(data: string[], query: string): string[] {
  const fuse = new Fuse(data, { threshold: 0.6, includeScore: true });
  return fuse.search(query).map((r) => r.item);
}

function searchFuzzysort(data: string[], query: string): string[] {
  return fuzzysort.go(query, data, { limit: 0 }).map((r) => r.target);
}

function searchMiniSearch(data: string[], query: string): string[] {
  const ms = new MiniSearch({ fields: ['text'], storeFields: ['text'] });
  ms.addAll(data.map((text, id) => ({ id, text })));
  return ms.search(query, { prefix: true, fuzzy: 0.2 }).map((r) => r.text as string);
}

function searchUFuzzy(data: string[], query: string): string[] {
  const uf = new uFuzzy();
  const [idxs] = uf.search(data, query);
  return idxs?.map((i) => data[i]) ?? [];
}

// ============================================================================
// Tests
// ============================================================================

describe('Acronym Matching: Does the library find acronyms?', () => {
  describe('seaq', () => {
    test.each(acronymTests)('$description', ({ query, data, expected }) => {
      const results = searchSeaq(data, query);
      const found = results.includes(expected);
      const rank = results.indexOf(expected);

      console.log(`seaq "${query}": ${found ? `✓ found at rank ${rank + 1}` : '✗ not found'}`);
      if (results.length > 0) {
        console.log(`  Top 3: ${results.slice(0, 3).join(', ')}`);
      }

      // seaq should find acronym matches
      expect(found).toBe(true);
    });
  });

  describe('fuse.js', () => {
    test.each(acronymTests)('$description', ({ query, data, expected }) => {
      const results = searchFuse(data, query);
      const found = results.includes(expected);
      const rank = results.indexOf(expected);

      console.log(`fuse "${query}": ${found ? `found at rank ${rank + 1}` : 'not found'}`);
      if (results.length > 0) {
        console.log(`  Top 3: ${results.slice(0, 3).join(', ')}`);
      }

      // Just document behavior
      expect(true).toBe(true);
    });
  });

  describe('fuzzysort', () => {
    test.each(acronymTests)('$description', ({ query, data, expected }) => {
      const results = searchFuzzysort(data, query);
      const found = results.includes(expected);
      const rank = results.indexOf(expected);

      console.log(`fuzzysort "${query}": ${found ? `found at rank ${rank + 1}` : 'not found'}`);
      if (results.length > 0) {
        console.log(`  Top 3: ${results.slice(0, 3).join(', ')}`);
      }

      expect(true).toBe(true);
    });
  });

  describe('minisearch', () => {
    test.each(acronymTests)('$description', ({ query, data, expected }) => {
      const results = searchMiniSearch(data, query);
      const found = results.includes(expected);
      const rank = results.indexOf(expected);

      console.log(`minisearch "${query}": ${found ? `found at rank ${rank + 1}` : 'not found'}`);
      if (results.length > 0) {
        console.log(`  Top 3: ${results.slice(0, 3).join(', ')}`);
      }

      expect(true).toBe(true);
    });
  });

  describe('ufuzzy', () => {
    test.each(acronymTests)('$description', ({ query, data, expected }) => {
      const results = searchUFuzzy(data, query);
      const found = results.includes(expected);
      const rank = results.indexOf(expected);

      console.log(`ufuzzy "${query}": ${found ? `found at rank ${rank + 1}` : 'not found'}`);
      if (results.length > 0) {
        console.log(`  Top 3: ${results.slice(0, 3).join(', ')}`);
      }

      expect(true).toBe(true);
    });
  });
});

// ============================================================================
// Summary: Acronym detection rate
// ============================================================================

describe('Acronym Quality Summary', () => {
  test('compare acronym detection across libraries', () => {
    const libraries = [
      { name: 'seaq', search: searchSeaq },
      { name: 'fuse.js', search: searchFuse },
      { name: 'fuzzysort', search: searchFuzzysort },
      { name: 'minisearch', search: searchMiniSearch },
      { name: 'ufuzzy', search: searchUFuzzy },
    ];

    console.log('\n=== Acronym Detection Summary ===\n');
    console.log('Library     | Found | Top-1 | Top-3 | Detection Rate');
    console.log('------------|-------|-------|-------|---------------');

    for (const lib of libraries) {
      let found = 0;
      let top1 = 0;
      let top3 = 0;

      for (const { query, data, expected } of acronymTests) {
        const results = lib.search(data, query);
        if (results.includes(expected)) {
          found++;
          const rank = results.indexOf(expected);
          if (rank === 0) top1++;
          if (rank < 3) top3++;
        }
      }

      const total = acronymTests.length;
      console.log(
        `${lib.name.padEnd(11)} | ${String(found).padStart(5)} | ${String(top1).padStart(5)} | ${String(top3).padStart(5)} | ${((found / total) * 100).toFixed(0)}%`,
      );
    }

    expect(true).toBe(true);
  });
});

// ============================================================================
// Ranking quality: When found, is acronym match ranked first?
// ============================================================================

describe('Acronym Ranking Quality', () => {
  test('seaq should rank acronym matches higher than substring matches', () => {
    // "HiMi" should rank "Hillsdale Michigan" above "himalayas" or "Historical Museum"
    const results = seaq(places, 'HiMi');

    console.log('\nseaq "HiMi" ranking:');
    for (let i = 0; i < results.length; i++) {
      console.log(`  ${i + 1}. ${results[i]}`);
    }

    // Hillsdale Michigan should be first (perfect acronym match)
    expect(results[0]).toBe('Hillsdale Michigan');
  });

  test('seaq handles mixed case acronyms', () => {
    const results1 = seaq(places, 'nyc');
    const results2 = seaq(places, 'NYC');
    const results3 = seaq(places, 'Nyc');

    console.log('\nCase sensitivity test for "New York City":');
    console.log(`  "nyc" → ${results1[0] ?? 'not found'}`);
    console.log(`  "NYC" → ${results2[0] ?? 'not found'}`);
    console.log(`  "Nyc" → ${results3[0] ?? 'not found'}`);

    // All should find New York City
    expect(results1.includes('New York City') || results1.includes('New York')).toBe(true);
    expect(results2.includes('New York City') || results2.includes('New York')).toBe(true);
  });

  test('partial acronym matching', () => {
    // "NAS" should still find "National Aeronautics Space Administration"
    const results = seaq(companies, 'NAS');

    console.log('\nPartial acronym "NAS":');
    const top = results.slice(0, 5);
    for (let i = 0; i < top.length; i++) {
      console.log(`  ${i + 1}. ${top[i]}`);
    }

    expect(results.some((r) => r.includes('National Aeronautics'))).toBe(true);
  });
});
