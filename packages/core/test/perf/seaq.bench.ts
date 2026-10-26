import { bench, describe } from 'vitest';
// @ts-expect-error - direct import from node_modules to avoid workspace resolution
import { seaq as seaqV1 } from '../../../../node_modules/seaq/dist/seaq.esm.js';
import { type SeaqOptions, seaq } from '../../src/index';
import { CONSECUTIVE_COUNT, data } from './common';

const { Books, ManyContacts, Cities } = data;

// Engine benchmarks scan every call (cache: false), so they measure scoring,
// not the list index — the default index is measured separately below
function scan<T>(list: T[], query: string, options?: SeaqOptions<T>) {
  return seaq(list, query, { ...options, cache: false });
}

const contactKeys = ['givenName', 'familyName'];
const bookKeys = ['title', 'author.firstName'];
const stringArray = ManyContacts.map((c) => `${c.givenName} ${c.familyName}`);

describe('seaq v1 vs v2 - 10K contacts', () => {
  bench('v1 (published)', () => {
    seaqV1(ManyContacts, 'nath fe', contactKeys);
  });

  bench('v2', () => {
    scan(ManyContacts, 'nath fe', { keys: contactKeys, fuzziness: 0 });
  });
});

describe('seaq - single search', () => {
  bench('23-books', () => {
    scan(Books, 'hi', { keys: bookKeys, fuzziness: 0 });
  });

  bench('10,000-contacts', () => {
    scan(ManyContacts, 'nath fe', { keys: contactKeys, fuzziness: 0 });
  });
});

describe('seaq - single search (no keys - string array)', () => {
  bench('10,000-strings', () => {
    scan(stringArray, 'nath fe', { fuzziness: 0 });
  });
});

describe('seaq - single search (no keys - object array)', () => {
  bench('10,000-contacts', () => {
    scan(ManyContacts, 'nath fe', { fuzziness: 0 });
  });
});

describe(`seaq - ${CONSECUTIVE_COUNT} consecutive searches`, () => {
  bench('23-books', () => {
    for (let index = 0; index < CONSECUTIVE_COUNT; index++) {
      scan(Books, 'hi', { keys: bookKeys, fuzziness: 0 });
    }
  });

  bench('10,000-contacts', () => {
    for (let index = 0; index < CONSECUTIVE_COUNT; index++) {
      scan(ManyContacts, 'nath fe', { keys: contactKeys, fuzziness: 0 });
    }
  });
});

describe('seaq - includeMatches overhead', () => {
  bench('10K contacts - without includeMatches', () => {
    scan(ManyContacts, 'nath fe', { keys: contactKeys, fuzziness: 0 });
  });

  bench('10K contacts - with includeMatches', () => {
    scan(ManyContacts, 'nath fe', { keys: contactKeys, fuzziness: 0, includeMatches: true });
  });
});

describe('seaq - multi-word queries', () => {
  bench('10K contacts - "nath fe" (fuzzy 0.2)', () => {
    scan(ManyContacts, 'nath fe', { keys: contactKeys, fuzziness: 0.2 });
  });

  bench('10K contacts - "natasha okeefe" (fuzzy 0.2)', () => {
    scan(ManyContacts, 'natasha okeefe', { keys: contactKeys, fuzziness: 0.2 });
  });

  bench('10K contacts - "nath fe" (strict)', () => {
    scan(ManyContacts, 'nath fe', { keys: contactKeys, fuzziness: 0 });
  });

  bench('10K contacts - single word baseline "nath" (fuzzy 0.2)', () => {
    scan(ManyContacts, 'nath', { keys: contactKeys, fuzziness: 0.2 });
  });
});

describe('seaq - top 10 results (slice vs limit)', () => {
  bench('10,000-contacts - limit: Infinity, then slice(0,10)', () => {
    scan(ManyContacts, 'na', {
      keys: contactKeys,
      fuzziness: 0,
      limit: Number.POSITIVE_INFINITY,
    }).slice(0, 10);
  });

  bench('10,000-contacts - limit: 10', () => {
    scan(ManyContacts, 'na', { keys: contactKeys, fuzziness: 0, limit: 10 });
  });
});

describe('seaq v1 vs v2 - 20K cities (2 keys: name, state)', () => {
  const cityKeys = ['name', 'state'];
  for (const q of ['san', 'new york', 'los ang']) {
    bench(`v1 (published) - "${q}"`, () => {
      seaqV1(Cities, q, cityKeys);
    });

    bench(`v2 - "${q}"`, () => {
      scan(Cities, q, { keys: cityKeys, fuzziness: 0 });
    });
  }
});

describe('seaq - default options, index reused (typeahead on a static list)', () => {
  // Warm up: the second search of an array builds its index
  seaq(ManyContacts, 'x', { keys: contactKeys });
  seaq(ManyContacts, 'x', { keys: contactKeys });
  seaq(Cities, 'x', { keys: ['name', 'state'] });
  seaq(Cities, 'x', { keys: ['name', 'state'] });

  bench('10K contacts - "nath fe" (default fuzziness 0.2)', () => {
    seaq(ManyContacts, 'nath fe', { keys: contactKeys });
  });

  bench('10K contacts - "nath fe" (fuzziness 0)', () => {
    seaq(ManyContacts, 'nath fe', { keys: contactKeys, fuzziness: 0 });
  });

  bench('20K cities - "san" (default fuzziness 0.2)', () => {
    seaq(Cities, 'san', { keys: ['name', 'state'] });
  });

  bench('20K cities - "san" (fuzziness 0)', () => {
    seaq(Cities, 'san', { keys: ['name', 'state'], fuzziness: 0 });
  });
});
