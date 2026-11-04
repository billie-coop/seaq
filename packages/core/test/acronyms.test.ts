import { expect, test } from 'vitest';
import { seaq } from '../src/index';
import { acronymCases, companies, places } from './fixtures/acronyms';

test.each(acronymCases)('$query ranks $expected first', ({ query, list, expected }) => {
  expect(seaq(list, query)[0]).toBe(expected);
});

test('the capitalization of an acronym makes no difference to the top result', () => {
  for (const q of ['nyc', 'NYC', 'Nyc']) expect(seaq(places, q)[0]).toBe('New York City');
});

test('a partial acronym ("NAS") still finds its match', () => {
  expect(seaq(companies, 'NAS')[0]).toBe('National Aeronautics Space Administration');
});
