/** Acronym detection across libraries, for WHY-SEAQ.md. */
import uFuzzy from '@leeoniya/ufuzzy';
import Fuse from 'fuse.js';
import fuzzysort from 'fuzzysort';
import MiniSearch from 'minisearch';
import { test } from 'vitest';
import { seaq } from '../../src/index';
import { acronymCases } from '../fixtures/acronyms';

const libraries: Array<[string, (list: string[], q: string) => string[]]> = [
  ['seaq', (list, q) => seaq(list, q)],
  ['fuse.js', (list, q) => new Fuse(list, { threshold: 0.6 }).search(q).map((r) => r.item)],
  ['fuzzysort', (list, q) => fuzzysort.go(q, list, { limit: 0 }).map((r) => r.target)],
  [
    'minisearch',
    (list, q) => {
      const ms = new MiniSearch({ fields: ['text'], storeFields: ['text'] });
      ms.addAll(list.map((text, id) => ({ id, text })));
      return ms.search(q, { prefix: true, fuzzy: 0.2 }).map((r) => r.text as string);
    },
  ],
  ['ufuzzy', (list, q) => (new uFuzzy().search(list, q)[0] ?? []).map((i) => list[i])],
];

test('acronym detection', () => {
  console.log(`\n  ${acronymCases.length} acronym queries`);
  console.log('  Library      Found  Top-1  Top-3');
  for (const [name, search] of libraries) {
    const ranks = acronymCases.map(({ query, list, expected }) =>
      search(list, query).indexOf(expected),
    );
    const count = (ok: (rank: number) => boolean) => String(ranks.filter(ok).length).padStart(5);
    console.log(
      `  ${name.padEnd(12)} ${count((r) => r >= 0)}  ${count((r) => r === 0)}  ${count((r) => r >= 0 && r < 3)}`,
    );
  }
});
