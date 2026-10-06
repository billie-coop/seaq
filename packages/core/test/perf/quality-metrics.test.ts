/**
 * Quality Metrics: Do libraries find the RIGHT results?
 *
 * Tests precision, recall, and ranking quality across search libraries.
 * This answers "which library gives the best results?" not "which is fastest?"
 */

import uFuzzy from '@leeoniya/ufuzzy';
import Fuse from 'fuse.js';
import fuzzysort from 'fuzzysort';
import MiniSearch from 'minisearch';
import { describe, expect, test } from 'vitest';
import { seaq } from '../../src/index';

// ============================================================================
// Test Data: Known ground truth for quality measurement
// ============================================================================

interface Person {
  id: number;
  name: string;
  email: string;
  company: string;
  city: string;
}

// Dataset with known "correct" answers for various queries
const people: Person[] = [
  {
    id: 1,
    name: 'John Smith',
    email: 'john.smith@acme.com',
    company: 'Acme Corp',
    city: 'New York',
  },
  {
    id: 2,
    name: 'John Johnson',
    email: 'jj@techstart.io',
    company: 'TechStart',
    city: 'San Francisco',
  },
  {
    id: 3,
    name: 'Johnny Appleseed',
    email: 'johnny@apple.com',
    company: 'Apple Inc',
    city: 'Cupertino',
  },
  { id: 4, name: 'Jane Smith', email: 'jane@acme.com', company: 'Acme Corp', city: 'New York' },
  {
    id: 5,
    name: 'Jonathan Winters',
    email: 'jwinters@comedy.com',
    company: 'Comedy Central',
    city: 'Los Angeles',
  },
  {
    id: 6,
    name: 'Sarah Connor',
    email: 'sarah@skynet.com',
    company: 'Cyberdyne',
    city: 'Los Angeles',
  },
  { id: 7, name: 'Mike Johnson', email: 'mike.j@bigcorp.com', company: 'BigCorp', city: 'Chicago' },
  { id: 8, name: 'Emily Zhang', email: 'ezhang@startup.co', company: 'Startup Co', city: 'Boston' },
  {
    id: 9,
    name: 'Robert Brown',
    email: 'rbrown@finance.com',
    company: 'Finance Inc',
    city: 'New York',
  },
  {
    id: 10,
    name: 'Lisa Anderson',
    email: 'lisa@design.studio',
    company: 'Design Studio',
    city: 'Seattle',
  },
];

// Ground truth: for each query, which IDs should be returned (in ideal order)
const groundTruth: Record<
  string,
  { query: string; keys: string[]; expected: number[]; description: string }
> = {
  exactName: {
    query: 'John Smith',
    keys: ['name'],
    expected: [1], // Exact match should be first
    description: 'Exact name match',
  },
  partialName: {
    query: 'John',
    keys: ['name'],
    expected: [1, 2, 3, 5, 7], // All Johns, then Johnson, Jonathan
    description: 'Partial name "John" should find all Johns',
  },
  typoName: {
    query: 'Jonh', // typo
    keys: ['name'],
    expected: [1, 2, 3, 5, 7], // Should still find Johns with fuzzy
    description: 'Typo "Jonh" should find Johns with fuzzy matching',
  },
  emailDomain: {
    query: 'acme',
    keys: ['email', 'company'],
    expected: [1, 4], // Both Acme employees
    description: 'Search "acme" in email/company',
  },
  citySearch: {
    query: 'New York',
    keys: ['city'],
    expected: [1, 4, 9], // All NYC people
    description: 'City search "New York"',
  },
  multiField: {
    query: 'john new',
    keys: ['name', 'city'],
    expected: [1], // John Smith in New York
    description: 'Multi-field: "john new" should find John in New York',
  },
  prefixSearch: {
    query: 'sar',
    keys: ['name'],
    expected: [6], // Sarah
    description: 'Prefix "sar" should find Sarah',
  },
};

// ============================================================================
// Helper: Calculate precision and recall
// ============================================================================

function calculateMetrics(retrieved: number[], expected: number[]) {
  const expectedSet = new Set(expected);

  const truePositives = retrieved.filter((id) => expectedSet.has(id)).length;
  const precision = retrieved.length > 0 ? truePositives / retrieved.length : 0;
  const recall = expected.length > 0 ? truePositives / expected.length : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  // Mean Reciprocal Rank: position of first relevant result
  const firstRelevantIdx = retrieved.findIndex((id) => expectedSet.has(id));
  const mrr = firstRelevantIdx >= 0 ? 1 / (firstRelevantIdx + 1) : 0;

  // Is the top result correct?
  const topCorrect = retrieved.length > 0 && expectedSet.has(retrieved[0]);

  return { precision, recall, f1, mrr, topCorrect, truePositives };
}

// ============================================================================
// Search wrappers for each library
// ============================================================================

function searchSeaq(query: string, keys: string[], fuzzy = false): number[] {
  const results = seaq(people, query, { keys, fuzziness: fuzzy ? 0.5 : undefined });
  return results.map((p) => p.id);
}

function searchFuse(query: string, keys: string[], threshold = 0.4): number[] {
  const fuse = new Fuse(people, { keys, threshold, includeScore: true });
  return fuse.search(query).map((r) => r.item.id);
}

function searchFuzzysort(query: string, keys: string[]): number[] {
  return fuzzysort.go(query, people, { keys, limit: 0 }).map((r) => r.obj.id);
}

function searchMiniSearch(query: string, keys: string[]): number[] {
  const ms = new MiniSearch({ fields: keys, storeFields: ['id'] });
  ms.addAll(people);
  return ms.search(query, { prefix: true, fuzzy: 0.2 }).map((r) => r.id as number);
}

function searchUFuzzy(query: string, keys: string[]): number[] {
  // uFuzzy needs flat strings, so combine the fields
  const haystack = people.map((p) => keys.map((k) => p[k as keyof Person]).join(' '));
  const uf = new uFuzzy();
  const [idxs] = uf.search(haystack, query);
  return idxs?.map((i) => people[i].id) ?? [];
}

// ============================================================================
// Quality Tests
// ============================================================================

describe('Quality Metrics: Precision & Recall', () => {
  const testCases = Object.entries(groundTruth);

  describe('seaq (no fuzzy)', () => {
    test.each(testCases)('%s: %s', (_name, { query, keys, expected }) => {
      const retrieved = searchSeaq(query, keys, false);
      const metrics = calculateMetrics(retrieved, expected);

      console.log(
        `seaq "${query}": found [${retrieved.join(', ')}], expected [${expected.join(', ')}]`,
      );
      console.log(
        `  Precision: ${(metrics.precision * 100).toFixed(0)}%, Recall: ${(metrics.recall * 100).toFixed(0)}%, MRR: ${metrics.mrr.toFixed(2)}`,
      );

      // We just document behavior, don't fail on low scores
      expect(true).toBe(true);
    });
  });

  describe('seaq (fuzzy)', () => {
    test.each(testCases)('%s: %s', (_name, { query, keys, expected }) => {
      const retrieved = searchSeaq(query, keys, true);
      const metrics = calculateMetrics(retrieved, expected);

      console.log(
        `seaq-fuzzy "${query}": found [${retrieved.join(', ')}], expected [${expected.join(', ')}]`,
      );
      console.log(
        `  Precision: ${(metrics.precision * 100).toFixed(0)}%, Recall: ${(metrics.recall * 100).toFixed(0)}%, MRR: ${metrics.mrr.toFixed(2)}`,
      );

      expect(true).toBe(true);
    });
  });

  describe('fuse.js', () => {
    test.each(testCases)('%s: %s', (_name, { query, keys, expected }) => {
      const retrieved = searchFuse(query, keys);
      const metrics = calculateMetrics(retrieved, expected);

      console.log(
        `fuse "${query}": found [${retrieved.join(', ')}], expected [${expected.join(', ')}]`,
      );
      console.log(
        `  Precision: ${(metrics.precision * 100).toFixed(0)}%, Recall: ${(metrics.recall * 100).toFixed(0)}%, MRR: ${metrics.mrr.toFixed(2)}`,
      );

      expect(true).toBe(true);
    });
  });

  describe('fuzzysort', () => {
    test.each(testCases)('%s: %s', (_name, { query, keys, expected }) => {
      const retrieved = searchFuzzysort(query, keys);
      const metrics = calculateMetrics(retrieved, expected);

      console.log(
        `fuzzysort "${query}": found [${retrieved.join(', ')}], expected [${expected.join(', ')}]`,
      );
      console.log(
        `  Precision: ${(metrics.precision * 100).toFixed(0)}%, Recall: ${(metrics.recall * 100).toFixed(0)}%, MRR: ${metrics.mrr.toFixed(2)}`,
      );

      expect(true).toBe(true);
    });
  });

  describe('minisearch', () => {
    test.each(testCases)('%s: %s', (_name, { query, keys, expected }) => {
      const retrieved = searchMiniSearch(query, keys);
      const metrics = calculateMetrics(retrieved, expected);

      console.log(
        `minisearch "${query}": found [${retrieved.join(', ')}], expected [${expected.join(', ')}]`,
      );
      console.log(
        `  Precision: ${(metrics.precision * 100).toFixed(0)}%, Recall: ${(metrics.recall * 100).toFixed(0)}%, MRR: ${metrics.mrr.toFixed(2)}`,
      );

      expect(true).toBe(true);
    });
  });

  describe('ufuzzy', () => {
    test.each(testCases)('%s: %s', (_name, { query, keys, expected }) => {
      const retrieved = searchUFuzzy(query, keys);
      const metrics = calculateMetrics(retrieved, expected);

      console.log(
        `ufuzzy "${query}": found [${retrieved.join(', ')}], expected [${expected.join(', ')}]`,
      );
      console.log(
        `  Precision: ${(metrics.precision * 100).toFixed(0)}%, Recall: ${(metrics.recall * 100).toFixed(0)}%, MRR: ${metrics.mrr.toFixed(2)}`,
      );

      expect(true).toBe(true);
    });
  });
});

// ============================================================================
// Summary comparison
// ============================================================================

describe('Quality Summary', () => {
  test('compare all libraries across all queries', () => {
    const libraries = [
      { name: 'seaq', search: (q: string, k: string[]) => searchSeaq(q, k, false) },
      { name: 'seaq-fuzzy', search: (q: string, k: string[]) => searchSeaq(q, k, true) },
      { name: 'fuse.js', search: searchFuse },
      { name: 'fuzzysort', search: searchFuzzysort },
      { name: 'minisearch', search: searchMiniSearch },
      { name: 'ufuzzy', search: searchUFuzzy },
    ];

    const results: Record<
      string,
      { avgPrecision: number; avgRecall: number; avgMRR: number; topCorrect: number }
    > = {};

    for (const lib of libraries) {
      let totalPrecision = 0;
      let totalRecall = 0;
      let totalMRR = 0;
      let topCorrectCount = 0;
      const testCount = Object.keys(groundTruth).length;

      for (const { query, keys, expected } of Object.values(groundTruth)) {
        const retrieved = lib.search(query, keys);
        const metrics = calculateMetrics(retrieved, expected);
        totalPrecision += metrics.precision;
        totalRecall += metrics.recall;
        totalMRR += metrics.mrr;
        if (metrics.topCorrect) topCorrectCount++;
      }

      results[lib.name] = {
        avgPrecision: totalPrecision / testCount,
        avgRecall: totalRecall / testCount,
        avgMRR: totalMRR / testCount,
        topCorrect: topCorrectCount,
      };
    }

    console.log('\n=== Quality Summary (higher is better) ===\n');
    console.log('Library      | Precision | Recall | MRR  | Top-1 Correct');
    console.log('-------------|-----------|--------|------|---------------');
    for (const [name, r] of Object.entries(results)) {
      console.log(
        `${name.padEnd(12)} | ${(r.avgPrecision * 100).toFixed(0).padStart(8)}% | ${(r.avgRecall * 100).toFixed(0).padStart(5)}% | ${r.avgMRR.toFixed(2)} | ${r.topCorrect}/${Object.keys(groundTruth).length}`,
      );
    }

    expect(true).toBe(true);
  });
});
