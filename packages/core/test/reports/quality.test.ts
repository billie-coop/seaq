/** Precision, recall and first-result accuracy across libraries on a small labelled set. */
import uFuzzy from '@leeoniya/ufuzzy';
import Fuse from 'fuse.js';
import fuzzysort from 'fuzzysort';
import MiniSearch from 'minisearch';
import { test } from 'vitest';
import { seaq } from '../../src/index';

interface Person {
  id: number;
  name: string;
  email: string;
  company: string;
  city: string;
}

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

// The ids each query should find
const cases = [
  { query: 'John Smith', keys: ['name'], expected: [1] },
  { query: 'John', keys: ['name'], expected: [1, 2, 3, 5, 7] },
  { query: 'Jonh', keys: ['name'], expected: [1, 2, 3, 5, 7] },
  { query: 'acme', keys: ['email', 'company'], expected: [1, 4] },
  { query: 'New York', keys: ['city'], expected: [1, 4, 9] },
  { query: 'john new', keys: ['name', 'city'], expected: [1] },
  { query: 'sar', keys: ['name'], expected: [6] },
];

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
  const haystack = people.map((p) => keys.map((k) => p[k as keyof Person]).join(' '));
  const uf = new uFuzzy();
  const [idxs] = uf.search(haystack, query);
  return idxs?.map((i) => people[i].id) ?? [];
}

const libraries: Array<[string, (query: string, keys: string[]) => number[]]> = [
  ['seaq', (q, keys) => seaq(people, q, { keys }).map((p) => p.id)],
  ['seaq fuzz 0.5', (q, keys) => seaq(people, q, { keys, fuzziness: 0.5 }).map((p) => p.id)],
  ['fuse.js', searchFuse],
  ['fuzzysort', searchFuzzysort],
  ['minisearch', searchMiniSearch],
  ['ufuzzy', searchUFuzzy],
];

test('result quality', () => {
  console.log('\n  Library        Precision  Recall   MRR  Top-1');
  for (const [name, search] of libraries) {
    let precision = 0;
    let recall = 0;
    let mrr = 0;
    let top = 0;
    for (const { query, keys, expected } of cases) {
      const found = search(query, keys);
      const hits = found.filter((id) => expected.includes(id)).length;
      const first = found.findIndex((id) => expected.includes(id));
      precision += found.length ? hits / found.length : 0;
      recall += hits / expected.length;
      mrr += first >= 0 ? 1 / (first + 1) : 0;
      if (first === 0) top++;
    }
    const pct = (sum: number) => `${((sum / cases.length) * 100).toFixed(0)}%`.padStart(9);
    console.log(
      `  ${name.padEnd(14)} ${pct(precision)} ${pct(recall)} ${(mrr / cases.length).toFixed(2).padStart(5)}  ${top}/${cases.length}`,
    );
  }
});
