/**
 * The timing tables in WHY-SEAQ.md: medians of 80 runs after 20 warmup runs.
 * Run with `yarn workspace seaq report test/reports/why-seaq.test.ts`.
 */
import uFuzzy from '@leeoniya/ufuzzy';
import type { Contact } from '@seaq/test-data';
import Fuse from 'fuse.js';
import fuzzysort from 'fuzzysort';
import lunr from 'lunr';
import MiniSearch from 'minisearch';
import { describe, expect, test } from 'vitest';
// @ts-expect-error - direct import from node_modules to avoid workspace resolution
import { seaq as seaqV1 } from '../../../../node_modules/seaq/dist/seaq.esm.js';
import { seaq } from '../../src/index';
import { data } from '../perf/common';

const { ManyContacts, Cities } = data;
const SAMPLES = 80;

function sampled<T>(fn: () => T): { result: T; ms: number } {
  for (let i = 0; i < 20; i++) fn();
  const times: number[] = [];
  let result!: T;
  for (let i = 0; i < SAMPLES; i++) {
    const t0 = performance.now();
    result = fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return { result, ms: times[SAMPLES >> 1] };
}

const fmt = (ms: number) => (ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(2)}ms`);

interface Row {
  lib: string;
  ms: number;
  count: number;
  top3: string[];
}

/** A library's search, timed; `label` names a result for the table. */
function run<R>(lib: string, search: () => readonly R[], label: (r: R) => string): Row {
  const { ms, result } = sampled(search);
  return { lib, ms, count: result.length, top3: result.slice(0, 3).map(label) };
}

/** Several searches per sample (typing, changing data): the total, and per search. */
function runEach(lib: string, searches: number, fn: () => void): Row {
  const { ms } = sampled(fn);
  return { lib, ms, count: searches, top3: [`(${fmt(ms / searches)} per search)`] };
}

function printTable(title: string, rows: Row[]) {
  const sorted = [...rows].sort((a, b) => a.ms - b.ms);
  const fastest = sorted[0].ms;
  console.log(`\n  ${title} (median of ${SAMPLES} runs)`);
  console.log(
    `  ${'Library'.padEnd(14)} ${'Time'.padStart(10)} ${'vs best'.padStart(8)} ${'Results'.padStart(8)}  Top 3`,
  );
  for (const r of sorted) {
    const ratio = r.ms / fastest;
    console.log(
      `  ${r.lib.padEnd(14)} ${fmt(r.ms).padStart(10)} ${`${ratio.toFixed(1)}x`.padStart(8)} ${String(r.count).padStart(8)}  ${r.top3.join(', ')}`,
    );
  }
}

// fuzzysort caches prepared targets across go() calls: clear them so a cold
// search pays for preparation, like the other libraries' index builds
const fuzzysortCold = <T>(fn: () => T): T => {
  fuzzysort.cleanup();
  return fn();
};

const contactName = (c: Contact) => `${c.givenName} ${c.familyName}`;
const contactKeys = ['givenName', 'familyName'];
const contactHaystack = ManyContacts.map(contactName);
const cityHaystack = Cities.map((c) => `${c.name} ${c.state ?? ''}`);
const contactDocs = (list: Contact[]) =>
  list.map((c) => ({ givenName: c.givenName, familyName: c.familyName }));
const cityDocs = () => Cities.map((c) => ({ name: c.name, state: c.state ?? '' }));
const textDocs = (texts: string[]) => texts.map((text) => ({ text }));

function miniSearchOf(docs: Record<string, string>[]) {
  const fields = Object.keys(docs[0]);
  const ms = new MiniSearch({ fields, storeFields: fields });
  ms.addAll(docs.map((d, id) => ({ id, ...d })));
  return ms;
}

function lunrOf(docs: Record<string, string>[]) {
  return lunr(function () {
    for (const field of Object.keys(docs[0])) this.field(field);
    for (let id = 0; id < docs.length; id++) this.add({ id, ...docs[id] });
  });
}

function uFuzzyRanked(haystack: string[], q: string): number[] {
  const [idxs, , order] = new uFuzzy().search(haystack, q);
  return (order ? order.map((o) => idxs?.[o] as number) : (idxs ?? [])).slice(0, 10);
}

/** Every library searching a plain string list, building any index per search. */
function stringRows(list: string[], q: string): Row[] {
  const self = (s: string) => s;
  return [
    run('seaq', () => seaq(list, q, { cache: false }), self),
    run(
      'fuzzysort',
      () => fuzzysortCold(() => fuzzysort.go(q, list)),
      (r) => r.target,
    ),
    run(
      'fuse.js',
      () => new Fuse(list).search(q),
      (r) => r.item,
    ),
    run(
      'minisearch',
      () => miniSearchOf(textDocs(list)).search(q, { prefix: true, fuzzy: 0.2 }),
      (r) => r.text as string,
    ),
    run(
      'ufuzzy',
      () => new uFuzzy().search(list, q)[0] ?? [],
      (i) => list[i],
    ),
  ];
}

describe('small lists', () => {
  test('command palette: 20 menu items', () => {
    const menu = [
      'Dashboard',
      'Settings',
      'User Management',
      'Billing & Payments',
      'API Keys',
      'Audit Log',
      'Team Settings',
      'Notifications',
      'Profile',
      'Security',
      'Integrations',
      'Webhooks',
      'Organization Settings',
      'Data Export',
      'Help & Support',
      'Developer Tools',
      'Access Control',
      'Single Sign-On',
      'Custom Fields',
      'Workflow Automation',
    ];
    const queries = ['set', 'api', 'not', 'dev', 'bill'];
    // Average per query; results shown for the last one
    const perQuery = queries.map((q) => stringRows(menu, q));
    const rows = perQuery[0].map((row, i) => ({
      ...perQuery[queries.length - 1][i],
      ms: perQuery.reduce((sum, rs) => sum + rs[i].ms, 0) / queries.length,
      lib: row.lib,
    }));
    printTable('Command palette (20 items, avg per query)', rows);
  });

  test('file picker: "btn" across 21 paths', () => {
    const files = [
      'src/index.ts',
      'src/App.tsx',
      'src/components/Button.tsx',
      'src/components/Modal.tsx',
      'src/components/SearchInput.tsx',
      'src/hooks/useAuth.ts',
      'src/hooks/useSearch.ts',
      'src/utils/string.ts',
      'src/utils/format.ts',
      'package.json',
      'tsconfig.json',
      'vite.config.ts',
      'README.md',
      'CHANGELOG.md',
      '.env.local',
      'src/api/client.ts',
      'src/api/endpoints.ts',
      'src/styles/globals.css',
      'src/styles/theme.ts',
      'tests/App.test.tsx',
      'tests/utils.test.ts',
    ];
    printTable('File picker: "btn" across 21 paths (cold start)', stringRows(files, 'btn'));
  });
});

test('acronyms: query → expected first result', () => {
  const terms = [
    'Application Programming Interface',
    'Graphical User Interface',
    'Command Line Interface',
    'Software Development Kit',
    'Integrated Development Environment',
    'Object Oriented Programming',
    'Test Driven Development',
    'Continuous Integration Deployment',
    'Single Page Application',
    'Progressive Web App',
    'Search Engine Optimization',
    'User Experience Design',
  ];
  const expected: Record<string, string> = {
    API: 'Application Programming Interface',
    CLI: 'Command Line Interface',
    IDE: 'Integrated Development Environment',
    TDD: 'Test Driven Development',
    SEO: 'Search Engine Optimization',
    SPA: 'Single Page Application',
  };
  const queries = Object.keys(expected);
  const libs: Array<[string, (q: string) => string[]]> = [
    ['seaq', (q) => seaq(terms, q)],
    ['fuzzysort', (q) => fuzzysort.go(q, terms).map((r) => r.target)],
    ['fuse.js', (q) => new Fuse(terms, { threshold: 0.6 }).search(q).map((r) => r.item)],
    [
      'minisearch',
      (q) =>
        miniSearchOf(textDocs(terms))
          .search(q, { prefix: true, fuzzy: 0.2 })
          .map((r) => r.text),
    ],
    ['ufuzzy', (q) => (new uFuzzy().search(terms, q)[0] ?? []).map((i) => terms[i])],
  ];

  console.log(`\n  ${'Query'.padEnd(6)} ${libs.map(([name]) => name.padEnd(16)).join(' ')}`);
  const correct = new Map<string, number>();
  for (const q of queries) {
    const cells = libs.map(([name, search]) => {
      const first = search(q)[0];
      if (first === expected[q]) correct.set(name, (correct.get(name) ?? 0) + 1);
      return first === expected[q] ? '✓' : first ? `✗ "${first.slice(0, 12)}…"` : '✗ (nothing)';
    });
    console.log(`  ${q.padEnd(6)} ${cells.map((c) => c.padEnd(16)).join(' ')}`);
  }
  console.log(
    `\n  ${libs.map(([name]) => `${name}: ${correct.get(name) ?? 0}/${queries.length}`).join('  |  ')}`,
  );
  expect(correct.get('seaq')).toBe(queries.length);
});

describe('cold start', { timeout: 60_000 }, () => {
  test('10K contacts, "nath"', () => {
    const q = 'nath';
    printTable('10K contacts, cold start for "nath"', [
      run('seaq', () => seaq(ManyContacts, q, { keys: contactKeys, cache: false }), contactName),
      run(
        'fuzzysort',
        () => fuzzysortCold(() => fuzzysort.go(q, ManyContacts, { keys: contactKeys })),
        (r) => contactName(r.obj),
      ),
      run(
        'fuse.js',
        () => new Fuse(ManyContacts, { keys: contactKeys }).search(q).slice(0, 10),
        (r) => contactName(r.item),
      ),
      run(
        'minisearch',
        () => miniSearchOf(contactDocs(ManyContacts)).search(q, { prefix: true }).slice(0, 10),
        (r) => `${r.givenName} ${r.familyName}`,
      ),
      run(
        'lunr',
        () => lunrOf(contactDocs(ManyContacts)).search(`${q}*`).slice(0, 10),
        (r) => contactHaystack[Number(r.ref)],
      ),
      run(
        'ufuzzy',
        () => uFuzzyRanked(contactHaystack, q),
        (i) => contactHaystack[i],
      ),
    ]);
  });

  test('20K cities, "san"', () => {
    const q = 'san';
    const cityKeys = ['name', 'state'];
    printTable('20K cities, cold start for "san"', [
      run(
        'seaq',
        () => seaq(Cities, q, { keys: cityKeys, cache: false }),
        (c) => c.name,
      ),
      run(
        'fuzzysort',
        () => fuzzysortCold(() => fuzzysort.go(q, Cities, { keys: cityKeys })),
        (r) => r.obj.name,
      ),
      run(
        'fuse.js',
        () => new Fuse(Cities, { keys: cityKeys }).search(q).slice(0, 10),
        (r) => r.item.name,
      ),
      run(
        'minisearch',
        () => miniSearchOf(cityDocs()).search(q, { prefix: true }).slice(0, 10),
        (r) => r.name as string,
      ),
      run(
        'lunr',
        () => lunrOf(cityDocs()).search(`${q}*`).slice(0, 10),
        (r) => Cities[Number(r.ref)].name,
      ),
      run(
        'ufuzzy',
        () => uFuzzyRanked(cityHaystack, q),
        (i) => Cities[i].name,
      ),
    ]);
  });
});

test('scaling: the same call from 20 to 20K cities', () => {
  console.log(
    `\n  seaq(cities, "san", { keys: ["name", "state"], cache: false }) (median of ${SAMPLES} runs)`,
  );
  for (const n of [20, 200, 2000, 20000]) {
    const list = Cities.slice(0, n);
    const { ms, result } = sampled(() =>
      seaq(list, 'san', { keys: ['name', 'state'], cache: false }),
    );
    console.log(
      `  ${`${n} cities`.padEnd(14)} ${fmt(ms).padStart(10)} ${String(result.length).padStart(8)}`,
    );
  }
});

test('nested objects: "acme" in company.name and emails.address', () => {
  const crm = [
    { name: 'Alice Chen', company: { name: 'Acme Corp' }, emails: [{ address: 'alice@acme.com' }] },
    {
      name: 'Bob Martinez',
      company: { name: 'TechStart' },
      emails: [{ address: 'bob@techstart.io' }, { address: 'bobm@gmail.com' }],
    },
    {
      name: 'Carol Williams',
      company: { name: 'DataSystems' },
      emails: [{ address: 'carol@datasys.com' }],
    },
    {
      name: 'David Kim',
      company: { name: 'CloudNine' },
      emails: [{ address: 'dkim@cloudnine.dev' }],
    },
    {
      name: 'Eva Johnson',
      company: { name: 'MegaInc' },
      emails: [{ address: 'eva.j@megainc.com' }, { address: 'evaj@yahoo.com' }],
    },
    { name: 'Frank Liu', company: { name: 'Acme Corp' }, emails: [{ address: 'frank@acme.com' }] },
    {
      name: 'Grace Park',
      company: { name: 'StartupCo' },
      emails: [{ address: 'grace@startupco.health' }],
    },
    {
      name: 'Henry Zhang',
      company: { name: 'BigCorp' },
      emails: [{ address: 'hzhang@bigcorp.com' }],
    },
  ];
  const emails = (c: (typeof crm)[number]) => c.emails.map((e) => e.address).join(' ');
  const flat = crm.map((c) => `${c.company.name} ${emails(c)}`);

  const found: Array<[string, string[], string]> = [
    [
      'seaq',
      seaq(crm, 'acme', { keys: ['company.name', 'emails.address'] }).map((c) => c.name),
      '',
    ],
    [
      'fuse.js',
      new Fuse(crm, { keys: ['company.name', 'emails.address'] })
        .search('acme')
        .map((r) => r.item.name),
      '',
    ],
    [
      'fuzzysort',
      fuzzysort.go('acme', crm, { keys: ['company.name', emails] }).map((r) => r.obj.name),
      '[array needs a getter]',
    ],
    [
      'minisearch',
      miniSearchOf(crm.map((c) => ({ companyName: c.company.name, emails: emails(c) })))
        .search('acme', { prefix: true, fuzzy: 0.2 })
        .map((r) => crm[r.id].name),
      '[flattened in this example]',
    ],
    [
      'ufuzzy',
      (new uFuzzy().search(flat, 'acme')[0] ?? []).map((i) => crm[i].name),
      '[string per item]',
    ],
  ];
  console.log('');
  for (const [lib, names, note] of found) {
    console.log(`  ${`${lib}:`.padEnd(12)}${names.join(', ')} (${names.length} results) ${note}`);
  }
  expect(found[0][1]).toEqual(['Alice Chen', 'Frank Liu']);
});

test('changing data: 500 items, the dataset alternates each search', () => {
  const a = ManyContacts.slice(0, 500);
  const b = ManyContacts.slice(500, 1000);
  const datasets = [a, b, a, b, a];
  const n = datasets.length;
  printTable('500 items, dataset changes each search (5 searches)', [
    // cache: false: data that changes every search usually arrives as a new array
    runEach('seaq', n, () => {
      for (const ds of datasets) seaq(ds, 'john', { keys: contactKeys, cache: false });
    }),
    runEach('fuzzysort', n, () => {
      for (const ds of datasets)
        fuzzysortCold(() => fuzzysort.go('john', ds, { keys: contactKeys }));
    }),
    runEach('fuse.js', n, () => {
      for (const ds of datasets) new Fuse(ds, { keys: contactKeys }).search('john');
    }),
    runEach('minisearch', n, () => {
      for (const ds of datasets) miniSearchOf(contactDocs(ds)).search('john', { prefix: true });
    }),
    runEach('ufuzzy', n, () => {
      for (const ds of datasets) new uFuzzy().search(ds.map(contactName), 'john');
    }),
  ]);
});

describe('10K contacts with indexes built', { timeout: 60_000 }, () => {
  const fuse = new Fuse(ManyContacts, { keys: contactKeys });
  const mini = miniSearchOf(contactDocs(ManyContacts));
  const lunrIndex = lunrOf(contactDocs(ManyContacts));
  const snapshot = fuzzysort.snapshot(ManyContacts, { keys: contactKeys });
  const uf = new uFuzzy();
  const first = (c: Contact) => c.givenName;

  test('one search, "nath"', () => {
    const q = 'nath';
    printTable('10K contacts, index built, search "nath"', [
      // The default indexes an array on its second search, so this reuses it
      run('seaq', () => seaq(ManyContacts, q, { keys: contactKeys }), first),
      run('seaq no index', () => seaq(ManyContacts, q, { keys: contactKeys, cache: false }), first),
      run(
        'fuzzysort',
        () => fuzzysort.go(q, snapshot),
        (r) => r.obj.givenName,
      ),
      run(
        'fuse.js',
        () => fuse.search(q),
        (r) => r.item.givenName,
      ),
      run(
        'minisearch',
        () => mini.search(q, { prefix: true }),
        (r) => r.givenName as string,
      ),
      run(
        'lunr',
        () => lunrIndex.search(`${q}*`),
        (r) => ManyContacts[Number(r.ref)].givenName,
      ),
      run(
        'ufuzzy',
        () => uf.search(contactHaystack, q)[0] ?? [],
        (i) => ManyContacts[i].givenName,
      ),
    ]);
  });

  test('typing: 7 keystrokes', () => {
    const keys = ['n', 'na', 'nat', 'nata', 'natas', 'natash', 'natasha'];
    const n = keys.length;
    printTable('7 keystrokes on 10K contacts, index built', [
      runEach('seaq', n, () => {
        for (const q of keys) seaq(ManyContacts, q, { keys: contactKeys });
      }),
      runEach('seaq no index', n, () => {
        for (const q of keys) seaq(ManyContacts, q, { keys: contactKeys, cache: false });
      }),
      runEach('fuzzysort', n, () => {
        for (const q of keys) fuzzysort.go(q, snapshot);
      }),
      runEach('fuse.js', n, () => {
        for (const q of keys) fuse.search(q);
      }),
      runEach('minisearch', n, () => {
        for (const q of keys) mini.search(q, { prefix: true });
      }),
      runEach('lunr', n, () => {
        for (const q of keys) lunrIndex.search(`${q}*`);
      }),
      runEach('ufuzzy', n, () => {
        for (const q of keys) uf.search(contactHaystack, q);
      }),
    ]);
  });
});

describe('v1 vs v2, 20K cities, fuzziness 0, no index', () => {
  const keys = ['name', 'state'];
  const header = (title: string, cols: string[]) => {
    console.log(`\n  ${title} (median of ${SAMPLES} runs)`);
    console.log(`  ${'Query'.padEnd(14)} ${cols.map((c) => c.padStart(10)).join(' ')}`);
  };
  const line = (q: string, cells: Array<string | number>) =>
    console.log(`  ${`"${q}"`.padEnd(14)} ${cells.map((c) => String(c).padStart(10)).join(' ')}`);

  test('scoring every match', () => {
    header('Scoring engine', ['v1 time', 'v1 #', 'v2 time', 'v2 #', 'speedup']);
    for (const q of ['san', 'new york', 'los ang']) {
      const v1 = sampled(() => seaqV1(Cities, q, keys) as unknown[]);
      const v2 = sampled(() =>
        seaq(Cities, q, { keys, fuzziness: 0, limit: Infinity, threshold: 0, cache: false }),
      );
      line(q, [
        fmt(v1.ms),
        v1.result.length,
        fmt(v2.ms),
        v2.result.length,
        `${(v1.ms / v2.ms).toFixed(1)}x`,
      ]);
    }
  });

  test('top 10: v1 sorts everything, v2 uses limit and threshold', () => {
    header('v1 sort + slice(10) vs v2 { limit: 10, threshold: 0.3 }', [
      'v1+slice',
      'v1 all #',
      'v2 limit',
      'v2 #',
      'speedup',
    ]);
    for (const q of ['san', 'na', 'los ang']) {
      const v1 = sampled(() => (seaqV1(Cities, q, keys) as unknown[]).slice(0, 10));
      const v1All = (seaqV1(Cities, q, keys) as unknown[]).length;
      const v2 = sampled(() => seaq(Cities, q, { keys, fuzziness: 0, cache: false }));
      line(q, [fmt(v1.ms), v1All, fmt(v2.ms), v2.result.length, `${(v1.ms / v2.ms).toFixed(1)}x`]);
    }
  });
});
