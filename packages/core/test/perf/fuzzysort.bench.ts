import fuzzysort from 'fuzzysort';
import { bench, describe } from 'vitest';
import { CONSECUTIVE_COUNT, data } from './common';

const { Books, ManyContacts } = data;

// Default options (limit: 10, threshold: 0.5), like seaq's benches use its
// defaults. fuzzysort caches prepared targets across go() calls; cleanup()
// clears that so each iteration starts cold, like the index-build iterations
// of Fuse.js/MiniSearch/Lunr.
const bookOpts = { keys: ['title', 'author.firstName'] };
const contactOpts = { keys: ['givenName', 'familyName'] };

describe('fuzzysort - single search', () => {
  bench('23-books', () => {
    fuzzysort.cleanup();
    fuzzysort.go('hi', Books, bookOpts);
  });

  bench('10,000-contacts', () => {
    fuzzysort.cleanup();
    fuzzysort.go('nath fe', ManyContacts, contactOpts);
  });
});

describe(`fuzzysort - ${CONSECUTIVE_COUNT} consecutive searches`, () => {
  bench('23-books', () => {
    fuzzysort.cleanup();
    for (let index = 0; index < CONSECUTIVE_COUNT; index++) {
      fuzzysort.go('hi', Books, bookOpts);
    }
  });

  bench('10,000-contacts', () => {
    fuzzysort.cleanup();
    for (let index = 0; index < CONSECUTIVE_COUNT; index++) {
      fuzzysort.go('nath fe', ManyContacts, contactOpts);
    }
  });
});
