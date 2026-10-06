/**
 * Real-world benchmark: Does seaq's "no index" approach hold up?
 *
 * Tests the scenario: you have a dataset, user types a search query.
 * For indexed libraries, index is pre-built (realistic for apps).
 * For seaq, it scans fresh each time (that's how it works).
 */

import uFuzzy from '@leeoniya/ufuzzy';
import Fuse from 'fuse.js';
import fuzzysort from 'fuzzysort';
import lunr from 'lunr';
import MiniSearch from 'minisearch';
import { bench, describe } from 'vitest';
import { seaq } from '../../src/index';
import { data } from './common';

const { ManyContacts } = data;

// Pre-build indexes (this is how real apps work - build once on load)
const fuseIndex = new Fuse(ManyContacts, {
  keys: ['givenName', 'familyName'],
});

const miniSearchIndex = new MiniSearch({
  fields: ['givenName', 'familyName'],
  storeFields: ['givenName', 'familyName'],
});
miniSearchIndex.addAll(
  ManyContacts.map((c, i) => ({ id: i, givenName: c.givenName, familyName: c.familyName })),
);

const lunrIndex = lunr(function () {
  this.field('givenName');
  this.field('familyName');
  ManyContacts.forEach((contact, i) => {
    this.add({ id: i, givenName: contact.givenName, familyName: contact.familyName });
  });
});

// fuzzysort's "index" is an immutable snapshot of prepared targets. Like seaq
// here, it runs with default options (limit: 10, threshold: 0.5). Note that a
// snapshot narrows candidates when a query extends the previous one, so
// repeating the same query benefits from that typing optimization.
const fuzzysortSnapshot = fuzzysort.snapshot(ManyContacts, { keys: ['givenName', 'familyName'] });

const ufuzzyInstance = new uFuzzy();
const ufuzzyHaystack = ManyContacts.map((c) => `${c.givenName} ${c.familyName}`);

// Test queries of different types
const queries = {
  short: 'na',
  medium: 'nath fe',
  long: 'natasha okeefe',
};

describe('10K contacts - search only (index pre-built)', () => {
  describe('short query "na"', () => {
    bench('seaq', () => {
      seaq(ManyContacts, queries.short, { keys: ['givenName', 'familyName'] });
    });

    bench('fuse.js', () => {
      fuseIndex.search(queries.short);
    });

    bench('fuzzysort', () => {
      fuzzysort.go(queries.short, fuzzysortSnapshot);
    });

    bench('minisearch', () => {
      miniSearchIndex.search(queries.short);
    });

    bench('lunr', () => {
      lunrIndex.search(queries.short);
    });

    bench('ufuzzy', () => {
      ufuzzyInstance.search(ufuzzyHaystack, queries.short);
    });
  });

  describe('medium query "nath fe"', () => {
    bench('seaq', () => {
      seaq(ManyContacts, queries.medium, { keys: ['givenName', 'familyName'] });
    });

    bench('fuse.js', () => {
      fuseIndex.search(queries.medium);
    });

    bench('fuzzysort', () => {
      fuzzysort.go(queries.medium, fuzzysortSnapshot);
    });

    bench('minisearch', () => {
      miniSearchIndex.search(queries.medium);
    });

    bench('lunr', () => {
      lunrIndex.search(queries.medium);
    });

    bench('ufuzzy', () => {
      ufuzzyInstance.search(ufuzzyHaystack, queries.medium);
    });
  });

  describe('long query "natasha okeefe"', () => {
    bench('seaq', () => {
      seaq(ManyContacts, queries.long, { keys: ['givenName', 'familyName'] });
    });

    bench('fuse.js', () => {
      fuseIndex.search(queries.long);
    });

    bench('fuzzysort', () => {
      fuzzysort.go(queries.long, fuzzysortSnapshot);
    });

    bench('minisearch', () => {
      miniSearchIndex.search(queries.long);
    });

    bench('lunr', () => {
      lunrIndex.search(queries.long);
    });

    bench('ufuzzy', () => {
      ufuzzyInstance.search(ufuzzyHaystack, queries.long);
    });
  });
});

// Simulate user typing - each keystroke triggers a new search
describe('10K contacts - simulated typing (index pre-built)', () => {
  const keystrokes = ['n', 'na', 'nat', 'nata', 'natas', 'natash', 'natasha'];

  bench('seaq', () => {
    for (const query of keystrokes) {
      seaq(ManyContacts, query, { keys: ['givenName', 'familyName'] });
    }
  });

  bench('fuse.js', () => {
    for (const query of keystrokes) {
      fuseIndex.search(query);
    }
  });

  bench('fuzzysort', () => {
    for (const query of keystrokes) {
      fuzzysort.go(query, fuzzysortSnapshot);
    }
  });

  bench('minisearch', () => {
    for (const query of keystrokes) {
      miniSearchIndex.search(query);
    }
  });

  bench('lunr', () => {
    for (const query of keystrokes) {
      lunrIndex.search(query);
    }
  });

  bench('ufuzzy', () => {
    for (const query of keystrokes) {
      ufuzzyInstance.search(ufuzzyHaystack, query);
    }
  });
});

// Cold start - no pre-built index, user searches immediately
describe('10K contacts - cold start (build + search)', () => {
  bench('seaq', () => {
    seaq(ManyContacts, queries.medium, { keys: ['givenName', 'familyName'] });
  });

  bench('fuse.js', () => {
    const fuse = new Fuse(ManyContacts, { keys: ['givenName', 'familyName'] });
    fuse.search(queries.medium);
  });

  bench('fuzzysort', () => {
    // go() on raw objects prepares targets lazily and caches them; clear the
    // cache so every iteration pays the prep cost
    fuzzysort.cleanup();
    fuzzysort.go(queries.medium, ManyContacts, { keys: ['givenName', 'familyName'] });
  });

  bench('minisearch', () => {
    const ms = new MiniSearch({ fields: ['givenName', 'familyName'] });
    ms.addAll(
      ManyContacts.map((c, i) => ({ id: i, givenName: c.givenName, familyName: c.familyName })),
    );
    ms.search(queries.medium);
  });

  bench('lunr', () => {
    const idx = lunr(function () {
      this.field('givenName');
      this.field('familyName');
      ManyContacts.forEach((contact, i) => {
        this.add({ id: i, givenName: contact.givenName, familyName: contact.familyName });
      });
    });
    idx.search(queries.medium);
  });

  bench('ufuzzy', () => {
    const uf = new uFuzzy();
    const haystack = ManyContacts.map((c) => `${c.givenName} ${c.familyName}`);
    uf.search(haystack, queries.medium);
  });
});
