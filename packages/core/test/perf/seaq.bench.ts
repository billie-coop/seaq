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

// Simple string array for no-keys testing
const stringArray = ManyContacts.map((c) => `${c.givenName} ${c.familyName}`);

describe('seaq v1 vs v2 - 10K contacts', () => {
  bench('v1 (published)', () => {
    seaqV1(ManyContacts, 'nath fe', ['givenName', 'familyName']);
  });

  bench('v2 (joined)', () => {
    scan(ManyContacts, 'nath fe', {
      keys: ['givenName', 'familyName'],
      fieldMode: 'joined',
      fuzziness: 0,
    });
  });

  bench('v2 (separate)', () => {
    scan(ManyContacts, 'nath fe', {
      keys: ['givenName', 'familyName'],
      fieldMode: 'separate',
      fuzziness: 0,
    });
  });
});

describe('seaq - single search (joined mode)', () => {
  bench('23-books', () => {
    scan(Books, 'hi', { keys: ['title', 'author.firstName'], fieldMode: 'joined', fuzziness: 0 });
  });

  bench('10,000-contacts', () => {
    scan(ManyContacts, 'nath fe', {
      keys: ['givenName', 'familyName'],
      fieldMode: 'joined',
      fuzziness: 0,
    });
  });
});

describe('seaq - single search (separate mode)', () => {
  bench('23-books', () => {
    scan(Books, 'hi', { keys: ['title', 'author.firstName'], fieldMode: 'separate', fuzziness: 0 });
  });

  bench('10,000-contacts', () => {
    scan(ManyContacts, 'nath fe', {
      keys: ['givenName', 'familyName'],
      fieldMode: 'separate',
      fuzziness: 0,
    });
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

describe(`seaq - ${CONSECUTIVE_COUNT} consecutive searches (joined mode)`, () => {
  bench('23-books', () => {
    for (let index = 0; index < CONSECUTIVE_COUNT; index++) {
      scan(Books, 'hi', { keys: ['title', 'author.firstName'], fieldMode: 'joined', fuzziness: 0 });
    }
  });

  bench('10,000-contacts', () => {
    for (let index = 0; index < CONSECUTIVE_COUNT; index++) {
      scan(ManyContacts, 'nath fe', {
        keys: ['givenName', 'familyName'],
        fieldMode: 'joined',
        fuzziness: 0,
      });
    }
  });
});

describe('seaq - includeMatches overhead (joined)', () => {
  bench('10K contacts - without includeMatches', () => {
    scan(ManyContacts, 'nath fe', {
      keys: ['givenName', 'familyName'],
      fieldMode: 'joined',
      fuzziness: 0,
    });
  });

  bench('10K contacts - with includeMatches', () => {
    scan(ManyContacts, 'nath fe', {
      keys: ['givenName', 'familyName'],
      fieldMode: 'joined',
      fuzziness: 0,
      includeMatches: true,
    });
  });
});

describe('seaq - includeMatches overhead (separate)', () => {
  bench('10K contacts - without includeMatches', () => {
    scan(ManyContacts, 'nath fe', {
      keys: ['givenName', 'familyName'],
      fieldMode: 'separate',
      fuzziness: 0,
    });
  });

  bench('10K contacts - with includeMatches', () => {
    scan(ManyContacts, 'nath fe', {
      keys: ['givenName', 'familyName'],
      fieldMode: 'separate',
      fuzziness: 0,
      includeMatches: true,
    });
  });
});

describe('seaq - multi-word separate mode (regression target)', () => {
  bench('10K contacts - "nath fe" (separate, fuzzy 0.2)', () => {
    scan(ManyContacts, 'nath fe', {
      keys: ['givenName', 'familyName'],
      fieldMode: 'separate',
      fuzziness: 0.2,
    });
  });

  bench('10K contacts - "natasha okeefe" (separate, fuzzy 0.2)', () => {
    scan(ManyContacts, 'natasha okeefe', {
      keys: ['givenName', 'familyName'],
      fieldMode: 'separate',
      fuzziness: 0.2,
    });
  });

  bench('10K contacts - "nath fe" (separate, strict)', () => {
    scan(ManyContacts, 'nath fe', {
      keys: ['givenName', 'familyName'],
      fieldMode: 'separate',
      fuzziness: 0,
    });
  });

  bench('10K contacts - single word baseline "nath" (separate, fuzzy 0.2)', () => {
    scan(ManyContacts, 'nath', {
      keys: ['givenName', 'familyName'],
      fieldMode: 'separate',
      fuzziness: 0.2,
    });
  });
});

describe('seaq - top 10 results (slice vs limit)', () => {
  bench('10,000-contacts - slice(0,10) [current way]', () => {
    scan(ManyContacts, 'na', {
      keys: ['givenName', 'familyName'],
      fieldMode: 'joined',
      fuzziness: 0,
    }).slice(0, 10);
  });

  bench('10,000-contacts - limit: 10 [optimized]', () => {
    scan(ManyContacts, 'na', {
      keys: ['givenName', 'familyName'],
      fieldMode: 'joined',
      fuzziness: 0,
      limit: 10,
    });
  });
});

describe('seaq v1 vs v2 - 20K cities (2 keys: name, state)', () => {
  const cityKeys = ['name', 'state'] as const;

  bench('v1 (published) - "san"', () => {
    seaqV1(Cities, 'san', cityKeys);
  });

  bench('v2 joined - "san"', () => {
    scan(Cities, 'san', { keys: [...cityKeys], fieldMode: 'joined', fuzziness: 0 });
  });

  bench('v2 separate - "san"', () => {
    scan(Cities, 'san', { keys: [...cityKeys], fieldMode: 'separate', fuzziness: 0 });
  });

  bench('v1 (published) - "new york"', () => {
    seaqV1(Cities, 'new york', cityKeys);
  });

  bench('v2 joined - "new york"', () => {
    scan(Cities, 'new york', { keys: [...cityKeys], fieldMode: 'joined', fuzziness: 0 });
  });

  bench('v2 separate - "new york"', () => {
    scan(Cities, 'new york', { keys: [...cityKeys], fieldMode: 'separate', fuzziness: 0 });
  });

  bench('v1 (published) - "los ang"', () => {
    seaqV1(Cities, 'los ang', cityKeys);
  });

  bench('v2 joined - "los ang"', () => {
    scan(Cities, 'los ang', { keys: [...cityKeys], fieldMode: 'joined', fuzziness: 0 });
  });

  bench('v2 separate - "los ang"', () => {
    scan(Cities, 'los ang', { keys: [...cityKeys], fieldMode: 'separate', fuzziness: 0 });
  });
});

describe('seaq - default options, index reused (typeahead on a static list)', () => {
  const contactKeys = ['givenName', 'familyName'];
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
