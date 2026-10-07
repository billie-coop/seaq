/**
 * WHY SEAQ? — Honest use-case exploration
 *
 * seaq's value: competitive performance at any scale without an index.
 * Your data can grow from 20 items to 20K and you never refactor.
 *
 * Run with: yarn workspace seaq vitest run test/perf/why-seaq.test.ts
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
import { data } from './common';

const { ManyContacts, Cities } = data;

// ── Helpers ──────────────────────────────────────────────────────────────

const WARMUP = 20;
const SAMPLES = 80;

/** Run fn with warmup + samples, return median time and last result. */
function sampled<T>(fn: () => T): { result: T; ms: number } {
  for (let i = 0; i < WARMUP; i++) fn();
  const times: number[] = [];
  let result!: T;
  for (let i = 0; i < SAMPLES; i++) {
    const t0 = performance.now();
    result = fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return { result, ms: times[Math.floor(times.length / 2)] };
}

function fmt(ms: number): string {
  return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(2)}ms`;
}

type Row = { lib: string; ms: number; count: number; top3: string[] };

function printTable(title: string, rows: Row[]) {
  const sorted = [...rows].sort((a, b) => a.ms - b.ms);
  const fastest = sorted[0].ms;
  console.log(`\n  ${title} (median of ${SAMPLES} runs)`);
  console.log(
    `  ${'Library'.padEnd(14)} ${'Time'.padStart(10)} ${'vs best'.padStart(8)} ${'Results'.padStart(8)}  Top 3`,
  );
  console.log(
    `  ${'─'.repeat(14)} ${'─'.repeat(10)} ${'─'.repeat(8)} ${'─'.repeat(8)}  ${'─'.repeat(30)}`,
  );
  for (const r of sorted) {
    const ratio = fastest > 0 ? r.ms / fastest : 1;
    const ratioStr = ratio < 1.05 ? '  1.0x' : `${ratio.toFixed(1)}x`.padStart(6);
    console.log(
      `  ${r.lib.padEnd(14)} ${fmt(r.ms).padStart(10)} ${ratioStr.padStart(8)} ${String(r.count).padStart(8)}  ${r.top3.join(', ')}`,
    );
  }
}

// ── Shared data ──────────────────────────────────────────────────────────

// fuzzysort caches prepared targets across go() calls. Cold-start timings call
// this first so every sample pays the prep cost, like an index build would.
function fuzzysortCold<T>(fn: () => T): T {
  fuzzysort.cleanup();
  return fn();
}

// Flat haystacks for uFuzzy (it only searches string[])
const contactHaystack = ManyContacts.map((c) => `${c.givenName} ${c.familyName}`);
const cityHaystack = Cities.map((c) => `${c.name} ${c.state ?? ''}`);

// Small lists — the kind you'd actually filter in a UI component
const menuItems = [
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

// ============================================================================
// SCENARIO 1: Small list filtering (command palette, autocomplete, emoji picker)
// ============================================================================

describe('SCENARIO 1: Small list filtering (< 50 items)', () => {
  test('Command palette — filter 20 menu items', () => {
    const queries = ['set', 'api', 'not', 'dev', 'bill'];
    const rows: Row[] = [];

    for (const lib of ['seaq', 'fuzzysort', 'fuse.js', 'minisearch', 'ufuzzy'] as const) {
      let total = 0;
      let lastResults: string[] = [];
      for (const q of queries) {
        const { ms, result } = (() => {
          switch (lib) {
            case 'seaq':
              // cache: false — the other libraries rebuild per search here too
              return sampled(() => seaq(menuItems, q, { cache: false }));
            case 'fuzzysort':
              return sampled(() =>
                fuzzysortCold(() => fuzzysort.go(q, menuItems).map((r) => r.target)),
              );
            case 'fuse.js':
              return sampled(() => {
                const fuse = new Fuse(menuItems);
                return fuse.search(q).map((r) => r.item);
              });
            case 'minisearch':
              return sampled(() => {
                const ms = new MiniSearch({ fields: ['text'], storeFields: ['text'] });
                ms.addAll(menuItems.map((text, id) => ({ id, text })));
                return ms.search(q, { prefix: true, fuzzy: 0.2 }).map((r) => r.text as string);
              });
            case 'ufuzzy':
              return sampled(() => {
                const uf = new uFuzzy();
                const [idxs] = uf.search(menuItems, q);
                return idxs?.map((i) => menuItems[i]) ?? [];
              });
          }
        })();
        total += ms;
        lastResults = result;
      }
      rows.push({
        lib,
        ms: total / queries.length,
        count: lastResults.length,
        top3: lastResults.slice(0, 3),
      });
    }

    printTable('Command palette (20 items, avg per query)', rows);
    expect(true).toBe(true);
  });

  test('File picker — fuzzy match 21 file paths', () => {
    const rows: Row[] = [];

    const { ms: seaqMs, result: seaqR } = sampled(() => seaq(files, 'btn', { cache: false }));
    rows.push({ lib: 'seaq', ms: seaqMs, count: seaqR.length, top3: seaqR.slice(0, 3) });

    const { ms: fsMs, result: fsR } = sampled(() =>
      fuzzysortCold(() => fuzzysort.go('btn', files).map((r) => r.target)),
    );
    rows.push({ lib: 'fuzzysort', ms: fsMs, count: fsR.length, top3: fsR.slice(0, 3) });

    const { ms: fuseMs, result: fuseR } = sampled(() => {
      const f = new Fuse(files);
      return f.search('btn').map((r) => r.item);
    });
    rows.push({ lib: 'fuse.js', ms: fuseMs, count: fuseR.length, top3: fuseR.slice(0, 3) });

    const { ms: miniMs, result: miniR } = sampled(() => {
      const ms = new MiniSearch({ fields: ['path'], storeFields: ['path'] });
      ms.addAll(files.map((path, id) => ({ id, path })));
      return ms.search('btn', { prefix: true, fuzzy: 0.2 }).map((r) => r.path as string);
    });
    rows.push({ lib: 'minisearch', ms: miniMs, count: miniR.length, top3: miniR.slice(0, 3) });

    const { ms: ufMs, result: ufR } = sampled(() => {
      const uf = new uFuzzy();
      const [idxs] = uf.search(files, 'btn');
      return idxs?.map((i) => files[i]) ?? [];
    });
    rows.push({ lib: 'ufuzzy', ms: ufMs, count: ufR.length, top3: ufR.slice(0, 3) });

    printTable('File picker: "btn" across 21 paths (cold start)', rows);
    expect(true).toBe(true);
  });
});

// ============================================================================
// SCENARIO 2: Acronym / abbreviation matching
// ============================================================================

describe('SCENARIO 2: Acronym matching', () => {
  const techTerms = [
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

  const acronymQueries = [
    { abbr: 'API', expected: 'Application Programming Interface' },
    { abbr: 'CLI', expected: 'Command Line Interface' },
    { abbr: 'IDE', expected: 'Integrated Development Environment' },
    { abbr: 'TDD', expected: 'Test Driven Development' },
    { abbr: 'SEO', expected: 'Search Engine Optimization' },
    { abbr: 'SPA', expected: 'Single Page Application' },
  ];

  test('seaq vs others on acronym detection', () => {
    const libs = [
      { name: 'seaq', search: (q: string) => seaq(techTerms, q) },
      {
        name: 'fuzzysort',
        search: (q: string) => fuzzysort.go(q, techTerms).map((r) => r.target),
      },
      {
        name: 'fuse.js',
        search: (q: string) => new Fuse(techTerms, { threshold: 0.6 }).search(q).map((r) => r.item),
      },
      {
        name: 'minisearch',
        search: (q: string) => {
          const ms = new MiniSearch({ fields: ['text'], storeFields: ['text'] });
          ms.addAll(techTerms.map((text, id) => ({ id, text })));
          return ms.search(q, { prefix: true, fuzzy: 0.2 }).map((r) => r.text as string);
        },
      },
      {
        name: 'ufuzzy',
        search: (q: string) => {
          const uf = new uFuzzy();
          const [idxs] = uf.search(techTerms, q);
          return idxs?.map((i) => techTerms[i]) ?? [];
        },
      },
    ];

    console.log('\n  Acronym Detection: query → expected #1 result');
    console.log(`  ${'Query'.padEnd(6)} ${libs.map((l) => l.name.padEnd(16)).join(' ')}`);
    console.log(`  ${'─'.repeat(6)} ${libs.map(() => '─'.repeat(16)).join(' ')}`);

    const scores: Record<string, number> = {};

    for (const { abbr, expected } of acronymQueries) {
      const cells: string[] = [];
      for (const lib of libs) {
        const results = lib.search(abbr);
        const found = results[0] === expected;
        if (found) scores[lib.name] = (scores[lib.name] ?? 0) + 1;
        cells.push(
          found ? '✓ correct' : results[0] ? `✗ "${results[0].slice(0, 12)}…"` : '✗ (nothing)',
        );
      }
      console.log(`  ${abbr.padEnd(6)} ${cells.map((c) => c.padEnd(16)).join(' ')}`);
    }

    console.log(
      `\n  Score:  ${libs.map((l) => `${l.name}: ${scores[l.name] ?? 0}/${acronymQueries.length}`).join('  |  ')}`,
    );

    expect(scores.seaq).toBeGreaterThanOrEqual(4);
  });
});

// ============================================================================
// SCENARIO 3: Cold start — one-shot search, no index
// ============================================================================

describe('SCENARIO 3: Cold start (no index, data just arrived)', () => {
  test('10K contacts — "nath"', { timeout: 60_000 }, () => {
    const rows: Row[] = [];
    const contactName = (c: Contact) => `${c.givenName} ${c.familyName}`;

    const { ms: seaqMs, result: seaqR } = sampled(() =>
      // cache: false — cold; a repeated array would otherwise get indexed
      seaq(ManyContacts, 'nath', { keys: ['givenName', 'familyName'], cache: false }),
    );
    rows.push({
      lib: 'seaq',
      ms: seaqMs,
      count: seaqR.length,
      top3: seaqR.slice(0, 3).map(contactName),
    });

    const { ms: fsMs, result: fsR } = sampled(() =>
      fuzzysortCold(() =>
        fuzzysort.go('nath', ManyContacts, { keys: ['givenName', 'familyName'] }),
      ),
    );
    rows.push({
      lib: 'fuzzysort',
      ms: fsMs,
      count: fsR.length,
      top3: fsR.slice(0, 3).map((r) => contactName(r.obj)),
    });

    const { ms: fuseMs, result: fuseR } = sampled(() => {
      const f = new Fuse(ManyContacts, { keys: ['givenName', 'familyName'] });
      return f.search('nath').slice(0, 10);
    });
    rows.push({
      lib: 'fuse.js',
      ms: fuseMs,
      count: fuseR.length,
      top3: fuseR.slice(0, 3).map((r) => contactName(r.item)),
    });

    const { ms: miniMs, result: miniR } = sampled(() => {
      const ms = new MiniSearch({
        fields: ['givenName', 'familyName'],
        storeFields: ['givenName', 'familyName'],
      });
      ms.addAll(
        ManyContacts.map((c, i) => ({ id: i, givenName: c.givenName, familyName: c.familyName })),
      );
      return ms.search('nath', { prefix: true }).slice(0, 10);
    });
    rows.push({
      lib: 'minisearch',
      ms: miniMs,
      count: miniR.length,
      top3: miniR.slice(0, 3).map((r) => `${r.givenName} ${r.familyName}`),
    });

    const { ms: lunrMs, result: lunrR } = sampled(() => {
      const idx = lunr(function () {
        this.field('givenName');
        this.field('familyName');
        for (let i = 0; i < ManyContacts.length; i++) {
          const c = ManyContacts[i];
          this.add({ id: i, givenName: c.givenName, familyName: c.familyName });
        }
      });
      return idx.search('nath*').slice(0, 10);
    });
    rows.push({
      lib: 'lunr',
      ms: lunrMs,
      count: lunrR.length,
      top3: lunrR.slice(0, 3).map((r) => contactName(ManyContacts[Number(r.ref)])),
    });

    const { ms: ufMs, result: ufR } = sampled(() => {
      const uf = new uFuzzy();
      const [idxs, , order] = uf.search(contactHaystack, 'nath');
      const sorted = order ? order.map((oi) => idxs?.[oi]) : (idxs ?? []);
      return sorted.slice(0, 10);
    });
    rows.push({
      lib: 'ufuzzy',
      ms: ufMs,
      count: ufR.length,
      top3: ufR.slice(0, 3).map((i) => (i !== undefined ? contactName(ManyContacts[i]) : '')),
    });

    printTable('10K contacts, cold start for "nath"', rows);
    expect(true).toBe(true);
  });

  test('20K cities — "san"', { timeout: 60_000 }, () => {
    const rows: Row[] = [];

    const { ms: seaqMs, result: seaqR } = sampled(() =>
      seaq(Cities, 'san', { keys: ['name', 'state'], cache: false }),
    );
    rows.push({
      lib: 'seaq',
      ms: seaqMs,
      count: seaqR.length,
      top3: seaqR.slice(0, 3).map((c) => c.name),
    });

    const { ms: fsMs, result: fsR } = sampled(() =>
      fuzzysortCold(() => fuzzysort.go('san', Cities, { keys: ['name', 'state'] })),
    );
    rows.push({
      lib: 'fuzzysort',
      ms: fsMs,
      count: fsR.length,
      top3: fsR.slice(0, 3).map((r) => r.obj.name),
    });

    const { ms: fuseMs, result: fuseR } = sampled(() => {
      const f = new Fuse(Cities, { keys: ['name', 'state'] });
      return f.search('san').slice(0, 10);
    });
    rows.push({
      lib: 'fuse.js',
      ms: fuseMs,
      count: fuseR.length,
      top3: fuseR.slice(0, 3).map((r) => r.item.name),
    });

    const { ms: miniMs, result: miniR } = sampled(() => {
      const ms = new MiniSearch({ fields: ['name', 'state'], storeFields: ['name'] });
      ms.addAll(Cities.map((c, i) => ({ id: i, name: c.name, state: c.state ?? '' })));
      return ms.search('san', { prefix: true }).slice(0, 10);
    });
    rows.push({
      lib: 'minisearch',
      ms: miniMs,
      count: miniR.length,
      top3: miniR.slice(0, 3).map((r) => r.name as string),
    });

    const { ms: lunrMs, result: lunrR } = sampled(() => {
      const idx = lunr(function () {
        this.field('name');
        this.field('state');
        for (let i = 0; i < Cities.length; i++) {
          const c = Cities[i];
          this.add({ id: i, name: c.name, state: c.state ?? '' });
        }
      });
      return idx.search('san*').slice(0, 10);
    });
    rows.push({
      lib: 'lunr',
      ms: lunrMs,
      count: lunrR.length,
      top3: lunrR.slice(0, 3).map((r) => Cities[Number(r.ref)].name),
    });

    const { ms: ufMs, result: ufR } = sampled(() => {
      const uf = new uFuzzy();
      const [idxs, , order] = uf.search(cityHaystack, 'san');
      const sorted = order ? order.map((oi) => idxs?.[oi]) : (idxs ?? []);
      return sorted.slice(0, 10);
    });
    rows.push({
      lib: 'ufuzzy',
      ms: ufMs,
      count: ufR.length,
      top3: ufR.slice(0, 3).map((i) => (i !== undefined ? Cities[i].name : '')),
    });

    printTable('20K cities, cold start for "san"', rows);
    expect(true).toBe(true);
  });
});

// ============================================================================
// SCENARIO 4: Scaling — same code, 20 items to 20K items
// The point: you never refactor. It just works.
// ============================================================================

describe('SCENARIO 4: Scaling without refactoring', () => {
  const slices = [
    { label: '20 cities', data: Cities.slice(0, 20) },
    { label: '200 cities', data: Cities.slice(0, 200) },
    { label: '2K cities', data: Cities.slice(0, 2000) },
    { label: '20K cities', data: Cities },
  ];

  test('same seaq() call from 20 → 20K items', () => {
    console.log(
      `\n  Scaling: seaq(cities, "san", { keys: ["name", "state"], cache: false }) (median of ${SAMPLES} runs)`,
    );
    console.log(`  ${'Size'.padEnd(14)} ${'Time'.padStart(10)} ${'Results'.padStart(8)}`);
    console.log(`  ${'─'.repeat(14)} ${'─'.repeat(10)} ${'─'.repeat(8)}`);

    for (const { label, data: ds } of slices) {
      const { ms, result } = sampled(() =>
        seaq(ds, 'san', { keys: ['name', 'state'], cache: false }),
      );
      console.log(
        `  ${label.padEnd(14)} ${fmt(ms).padStart(10)} ${String(result.length).padStart(8)}`,
      );
    }

    console.log('\n  ^ Same function call. Nothing to build, rebuild, or invalidate —');
    console.log('    repeat searches of a list index it automatically. Your list grew');
    console.log('    1000x and you changed zero lines of code.');
    expect(true).toBe(true);
  });
});

// ============================================================================
// SCENARIO 5: Nested objects / array traversal — zero prep
// ============================================================================

describe('SCENARIO 5: Nested object search (zero prep)', () => {
  interface CrmContact {
    name: string;
    company: { name: string; industry: string };
    emails: { type: string; address: string }[];
    tags: string[];
  }

  const crmContacts: CrmContact[] = [
    {
      name: 'Alice Chen',
      company: { name: 'Acme Corp', industry: 'SaaS' },
      emails: [{ type: 'work', address: 'alice@acme.com' }],
      tags: ['vip', 'enterprise'],
    },
    {
      name: 'Bob Martinez',
      company: { name: 'TechStart', industry: 'Fintech' },
      emails: [
        { type: 'work', address: 'bob@techstart.io' },
        { type: 'personal', address: 'bobm@gmail.com' },
      ],
      tags: ['lead'],
    },
    {
      name: 'Carol Williams',
      company: { name: 'DataSystems', industry: 'Analytics' },
      emails: [{ type: 'work', address: 'carol@datasys.com' }],
      tags: ['customer', 'enterprise'],
    },
    {
      name: 'David Kim',
      company: { name: 'CloudNine', industry: 'Infrastructure' },
      emails: [{ type: 'work', address: 'dkim@cloudnine.dev' }],
      tags: ['partner'],
    },
    {
      name: 'Eva Johnson',
      company: { name: 'MegaInc', industry: 'E-commerce' },
      emails: [
        { type: 'work', address: 'eva.j@megainc.com' },
        { type: 'personal', address: 'evaj@yahoo.com' },
      ],
      tags: ['vip', 'customer'],
    },
    {
      name: 'Frank Liu',
      company: { name: 'Acme Corp', industry: 'SaaS' },
      emails: [{ type: 'work', address: 'frank@acme.com' }],
      tags: ['internal'],
    },
    {
      name: 'Grace Park',
      company: { name: 'StartupCo', industry: 'HealthTech' },
      emails: [{ type: 'work', address: 'grace@startupco.health' }],
      tags: ['prospect'],
    },
    {
      name: 'Henry Zhang',
      company: { name: 'BigCorp', industry: 'Manufacturing' },
      emails: [{ type: 'work', address: 'hzhang@bigcorp.com' }],
      tags: ['customer'],
    },
  ];

  test('search nested company.name and emails.address — no flattening needed', () => {
    console.log('\n  Search CRM contacts for "acme" across company.name + emails.address:\n');

    // seaq — just works
    const seaqR = seaq(crmContacts, 'acme', { keys: ['company.name', 'emails.address'] });
    console.log(`  seaq:       ${seaqR.map((c) => c.name).join(', ')} (${seaqR.length} results)`);

    // fuse — also supports nested keys natively
    const fuseR = new Fuse(crmContacts, { keys: ['company.name', 'emails.address'] }).search(
      'acme',
    );
    console.log(
      `  fuse.js:    ${fuseR.map((r) => r.item.name).join(', ')} (${fuseR.length} results)`,
    );

    // fuzzysort — dot paths work, but arrays need a getter
    const fsR = fuzzysort.go('acme', crmContacts, {
      keys: ['company.name', (c) => c.emails.map((e) => e.address).join(' ')],
    });
    console.log(
      `  fuzzysort:  ${fsR.map((r) => r.obj.name).join(', ')} (${fsR.length} results) [array needs getter]`,
    );

    // minisearch — must flatten first
    const flatCrm = crmContacts.map((c, id) => ({
      id,
      companyName: c.company.name,
      emails: c.emails.map((e) => e.address).join(' '),
    }));
    const ms = new MiniSearch({ fields: ['companyName', 'emails'], storeFields: ['id'] });
    ms.addAll(flatCrm);
    const miniR = ms.search('acme', { prefix: true, fuzzy: 0.2 });
    console.log(
      `  minisearch: ${miniR.map((r) => crmContacts[r.id as number].name).join(', ')} (${miniR.length} results) [required flattening]`,
    );

    // ufuzzy — must build a haystack string
    const hay = crmContacts.map(
      (c) => `${c.company.name} ${c.emails.map((e) => e.address).join(' ')}`,
    );
    const uf = new uFuzzy();
    const [idxs] = uf.search(hay, 'acme');
    const ufR = idxs?.map((i) => crmContacts[i].name) ?? [];
    console.log(`  ufuzzy:     ${ufR.join(', ')} (${ufR.length} results) [required string concat]`);

    console.log('\n  seaq: 1 line.  Others: 3-8 lines + data transformation.');

    expect(seaqR.length).toBeGreaterThanOrEqual(2);
    expect(seaqR.map((c) => c.name)).toContain('Alice Chen');
    expect(seaqR.map((c) => c.name)).toContain('Frank Liu');
  });
});

// ============================================================================
// SCENARIO 6: Dynamic data — index is wasted work
// ============================================================================

describe('SCENARIO 6: Dynamic data (index = wasted work)', () => {
  const slice500 = ManyContacts.slice(0, 500);
  const slice500b = ManyContacts.slice(500, 1000);

  test('alternating datasets — index must be rebuilt each time', () => {
    const datasets = [slice500, slice500b, slice500, slice500b, slice500];
    const rows: Row[] = [];

    const { ms: seaqMs } = sampled(() => {
      // Data that changes every search arrives as a new array each time, which
      // seaq never indexes by default — the same as cache: false
      for (const ds of datasets)
        seaq(ds, 'john', { keys: ['givenName', 'familyName'], cache: false });
    });
    rows.push({
      lib: 'seaq',
      ms: seaqMs / datasets.length,
      count: datasets.length,
      top3: ['(avg per search)'],
    });

    const { ms: fsMs } = sampled(() => {
      for (const ds of datasets) {
        fuzzysortCold(() => fuzzysort.go('john', ds, { keys: ['givenName', 'familyName'] }));
      }
    });
    rows.push({
      lib: 'fuzzysort',
      ms: fsMs / datasets.length,
      count: datasets.length,
      top3: ['(avg per search)'],
    });

    const { ms: fuseMs } = sampled(() => {
      for (const ds of datasets) {
        const f = new Fuse(ds, { keys: ['givenName', 'familyName'] });
        f.search('john');
      }
    });
    rows.push({
      lib: 'fuse.js',
      ms: fuseMs / datasets.length,
      count: datasets.length,
      top3: ['(avg per search)'],
    });

    const { ms: miniMs } = sampled(() => {
      for (const ds of datasets) {
        const m = new MiniSearch({ fields: ['givenName', 'familyName'] });
        m.addAll(ds.map((c, i) => ({ id: i, givenName: c.givenName, familyName: c.familyName })));
        m.search('john', { prefix: true });
      }
    });
    rows.push({
      lib: 'minisearch',
      ms: miniMs / datasets.length,
      count: datasets.length,
      top3: ['(avg per search)'],
    });

    const { ms: ufMs } = sampled(() => {
      for (const ds of datasets) {
        const uf = new uFuzzy();
        const hay = ds.map((c) => `${c.givenName} ${c.familyName}`);
        uf.search(hay, 'john');
      }
    });
    rows.push({
      lib: 'ufuzzy',
      ms: ufMs / datasets.length,
      count: datasets.length,
      top3: ['(avg per search)'],
    });

    printTable('500 items, dataset changes each time (index = wasted work)', rows);
    console.log('\n  ^ When data changes between searches, index-based libraries pay the');
    console.log('    build cost every time. seaq only indexes an array it sees twice, so');
    console.log('    new data is simply scanned.');
    expect(true).toBe(true);
  });
});

// ============================================================================
// SCENARIO 7: The tradeoff — repeated search on large static data
// seaq is slower here, but with v2 defaults it's not catastrophic.
// ============================================================================

describe('SCENARIO 7: The tradeoff — repeated search on pre-indexed data', () => {
  // Pre-build indexes (simulates: app loaded, user is typing)
  const fuseIdx = new Fuse(ManyContacts, { keys: ['givenName', 'familyName'] });

  const miniIdx = new MiniSearch({
    fields: ['givenName', 'familyName'],
    storeFields: ['givenName', 'familyName'],
  });
  miniIdx.addAll(
    ManyContacts.map((c, i) => ({ id: i, givenName: c.givenName, familyName: c.familyName })),
  );

  const lunrIdx = lunr(function () {
    this.field('givenName');
    this.field('familyName');
    for (let i = 0; i < ManyContacts.length; i++) {
      const c = ManyContacts[i];
      this.add({ id: i, givenName: c.givenName, familyName: c.familyName });
    }
  });

  const fsSnapshot = fuzzysort.snapshot(ManyContacts, { keys: ['givenName', 'familyName'] });

  const ufInst = new uFuzzy();

  test('single search on pre-indexed 10K contacts', () => {
    const rows: Row[] = [];

    // seaq's default indexes an array on its second search, so this reuses it
    const { ms: seaqMs, result: seaqR } = sampled(() =>
      seaq(ManyContacts, 'nath', { keys: ['givenName', 'familyName'] }),
    );
    rows.push({
      lib: 'seaq',
      ms: seaqMs,
      count: seaqR.length,
      top3: seaqR.slice(0, 3).map((c) => c.givenName),
    });

    const { ms: scanMs, result: scanR } = sampled(() =>
      seaq(ManyContacts, 'nath', { keys: ['givenName', 'familyName'], cache: false }),
    );
    rows.push({
      lib: 'seaq no index',
      ms: scanMs,
      count: scanR.length,
      top3: scanR.slice(0, 3).map((c) => c.givenName),
    });

    const { ms: fsMs, result: fsR } = sampled(() => fuzzysort.go('nath', fsSnapshot));
    rows.push({
      lib: 'fuzzysort',
      ms: fsMs,
      count: fsR.length,
      top3: fsR.slice(0, 3).map((r) => r.obj.givenName),
    });

    const { ms: fuseMs, result: fuseR } = sampled(() => fuseIdx.search('nath'));
    rows.push({
      lib: 'fuse.js',
      ms: fuseMs,
      count: fuseR.length,
      top3: fuseR.slice(0, 3).map((r) => r.item.givenName),
    });

    const { ms: miniMs, result: miniR } = sampled(() => miniIdx.search('nath', { prefix: true }));
    rows.push({
      lib: 'minisearch',
      ms: miniMs,
      count: miniR.length,
      top3: miniR.slice(0, 3).map((r) => String(r.givenName)),
    });

    const { ms: lunrMs, result: lunrR } = sampled(() => lunrIdx.search('nath*'));
    rows.push({
      lib: 'lunr',
      ms: lunrMs,
      count: lunrR.length,
      top3: lunrR.slice(0, 3).map((r) => ManyContacts[Number(r.ref)].givenName),
    });

    const { ms: ufMs, result: ufR } = sampled(() => {
      const [idxs] = ufInst.search(contactHaystack, 'nath');
      return idxs ?? [];
    });
    rows.push({
      lib: 'ufuzzy',
      ms: ufMs,
      count: ufR.length,
      top3: ufR.slice(0, 3).map((i) => (i !== undefined ? ManyContacts[i].givenName : '')),
    });

    printTable('10K contacts, INDEX PRE-BUILT, search "nath"', rows);
    console.log('\n  ^ seaq indexes a list on its second search, so repeated queries on');
    console.log('    static data reuse it. "seaq no index" (cache: false) rescans each time.');
    expect(true).toBe(true);
  });

  test('simulated typing: 7 keystrokes on 10K contacts', { timeout: 60_000 }, () => {
    const keystrokes = ['n', 'na', 'nat', 'nata', 'natas', 'natash', 'natasha'];
    const rows: Row[] = [];

    const { ms: seaqMs } = sampled(() => {
      for (const q of keystrokes) seaq(ManyContacts, q, { keys: ['givenName', 'familyName'] });
    });
    rows.push({ lib: 'seaq', ms: seaqMs, count: 7, top3: [`(${fmt(seaqMs / 7)}/keystroke)`] });

    const { ms: scanMs } = sampled(() => {
      for (const q of keystrokes)
        seaq(ManyContacts, q, { keys: ['givenName', 'familyName'], cache: false });
    });
    rows.push({
      lib: 'seaq no index',
      ms: scanMs,
      count: 7,
      top3: [`(${fmt(scanMs / 7)}/keystroke)`],
    });

    const { ms: fsMs } = sampled(() => {
      for (const q of keystrokes) fuzzysort.go(q, fsSnapshot);
    });
    rows.push({ lib: 'fuzzysort', ms: fsMs, count: 7, top3: [`(${fmt(fsMs / 7)}/keystroke)`] });

    const { ms: fuseMs } = sampled(() => {
      for (const q of keystrokes) fuseIdx.search(q);
    });
    rows.push({ lib: 'fuse.js', ms: fuseMs, count: 7, top3: [`(${fmt(fuseMs / 7)}/keystroke)`] });

    const { ms: miniMs } = sampled(() => {
      for (const q of keystrokes) miniIdx.search(q, { prefix: true });
    });
    rows.push({
      lib: 'minisearch',
      ms: miniMs,
      count: 7,
      top3: [`(${fmt(miniMs / 7)}/keystroke)`],
    });

    const { ms: lunrMs } = sampled(() => {
      for (const q of keystrokes) lunrIdx.search(`${q}*`);
    });
    rows.push({ lib: 'lunr', ms: lunrMs, count: 7, top3: [`(${fmt(lunrMs / 7)}/keystroke)`] });

    const { ms: ufMs } = sampled(() => {
      for (const q of keystrokes) ufInst.search(contactHaystack, q);
    });
    rows.push({ lib: 'ufuzzy', ms: ufMs, count: 7, top3: [`(${fmt(ufMs / 7)}/keystroke)`] });

    printTable('7 keystrokes on 10K pre-indexed', rows);
    console.log('\n  ^ seaq reuses its index across keystrokes; with cache: false it');
    console.log('    rescans every keystroke.');
    expect(true).toBe(true);
  });
});

// ============================================================================
// SCENARIO 8: v1 → v2 improvement
// ============================================================================

describe('SCENARIO 8: seaq v1 → v2', () => {
  test('scoring engine: v1 vs v2 (fuzziness 0, apples-to-apples)', () => {
    const queries = ['san', 'new york', 'los ang'];
    const cityKeys = ['name', 'state'];

    console.log(
      `\n  Scoring engine: v1 vs v2 on 20K cities, fuzziness: 0 (median of ${SAMPLES} runs)`,
    );
    console.log(
      `  ${'Query'.padEnd(14)} ${'v1 time'.padStart(10)} ${'v1 #'.padStart(6)} ${'v2 time'.padStart(10)} ${'v2 #'.padStart(6)} ${'speedup'.padStart(8)}`,
    );
    console.log(
      `  ${'─'.repeat(14)} ${'─'.repeat(10)} ${'─'.repeat(6)} ${'─'.repeat(10)} ${'─'.repeat(6)} ${'─'.repeat(8)}`,
    );

    for (const q of queries) {
      const { ms: v1Ms, result: v1R } = sampled(() => seaqV1(Cities, q, cityKeys));
      const { ms: v2Ms, result: v2R } = sampled(() =>
        seaq(Cities, q, {
          keys: cityKeys,
          fuzziness: 0,
          limit: Infinity,
          threshold: 0,
          cache: false,
        }),
      );
      const speedup = v1Ms / v2Ms;
      console.log(
        `  ${`"${q}"`.padEnd(14)} ${fmt(v1Ms).padStart(10)} ${String(v1R.length).padStart(6)} ${fmt(v2Ms).padStart(10)} ${String(v2R.length).padStart(6)} ${`${speedup.toFixed(1)}x`.padStart(8)}`,
      );
    }

    console.log('\n  No fuzziness, no index — engine improvements:');
    console.log(
      '  pre-lowered targets, bitmask pre-filter, quadratic miss penalty. v2 also matches swaps and any word order.',
    );
    expect(true).toBe(true);
  });

  test('limit + threshold: v1 sort+slice vs v2 heap+threshold', () => {
    const queries = ['san', 'na', 'los ang'];
    const cityKeys = ['name', 'state'];

    console.log(
      `\n  v1 sort+slice(10) vs v2 { limit: 10, threshold: 0.3 } — fuzz 0 (median of ${SAMPLES} runs)`,
    );
    console.log(
      `  ${'Query'.padEnd(14)} ${'v1+slice'.padStart(10)} ${'v1 raw#'.padStart(8)} ${'v2 limit'.padStart(10)} ${'v2 #'.padStart(6)} ${'speedup'.padStart(8)}`,
    );
    console.log(
      `  ${'─'.repeat(14)} ${'─'.repeat(10)} ${'─'.repeat(8)} ${'─'.repeat(10)} ${'─'.repeat(6)} ${'─'.repeat(8)}`,
    );

    for (const q of queries) {
      // v1: score all → sort all → slice to 10
      const { ms: v1Ms } = sampled(() => seaqV1(Cities, q, cityKeys));
      const v1RawCount = seaqV1(Cities, q, cityKeys).length;
      // v2: same scoring engine (fuzz 0), but threshold drops garbage + heap avoids full sort
      const { ms: v2Ms, result: v2R } = sampled(() =>
        seaq(Cities, q, { keys: cityKeys, fuzziness: 0, limit: 10, threshold: 0.3, cache: false }),
      );
      const speedup = v1Ms / v2Ms;
      console.log(
        `  ${`"${q}"`.padEnd(14)} ${fmt(v1Ms).padStart(10)} ${String(v1RawCount).padStart(8)} ${fmt(v2Ms).padStart(10)} ${String(v2R.length).padStart(6)} ${`${speedup.toFixed(1)}x`.padStart(8)}`,
      );
    }

    console.log('\n  v1 scores and sorts ALL items (even garbage), then .slice(0,10).');
    console.log('  v2 threshold drops low-quality matches early, heap keeps only top N.');
    console.log('  The more items threshold can discard, the bigger the win.');
    expect(true).toBe(true);
  });
});

// ============================================================================
// SUMMARY
// ============================================================================

describe('SUMMARY', () => {
  test('print verdict', () => {
    console.log(`
  ╔═════════════════════════════════════════════════════════════════════╗
  ║                        WHEN TO USE SEAQ                           ║
  ╠═════════════════════════════════════════════════════════════════════╣
  ║                                                                   ║
  ║  seaq is competitive at any scale with zero setup.                ║
  ║  Your list can grow from 20 items to 20K — you change nothing.    ║
  ║                                                                   ║
  ║  ✓ USE seaq when:                                                 ║
  ║    • You don't want to manage an index (seaq keeps its own)       ║
  ║    • Data is dynamic — changes each render, arrives from an API   ║
  ║    • List size is unpredictable (20 today, 20K tomorrow)          ║
  ║    • You need nested object / array traversal                     ║
  ║    • Users type shorthand, acronyms, swapped letters or typos     ║
  ║    • You want 1 function call, 0 setup, 0 dependencies           ║
  ║                                                                   ║
  ║  ✗ Consider MiniSearch/Lunr when:                                 ║
  ║    • You need full-text features (stemming, stop words)           ║
  ║    • Lists are huge and microseconds per keystroke matter         ║
  ║                                                                   ║
  ║  The mental model:                                                ║
  ║    seaq = Array.filter() with smart fuzzy scoring                 ║
  ║    One-off searches just scan; a list you search again gets an    ║
  ║    index automatically. Fast enough for any UI.                   ║
  ║                                                                   ║
  ╚═════════════════════════════════════════════════════════════════════╝`);

    expect(true).toBe(true);
  });
});
