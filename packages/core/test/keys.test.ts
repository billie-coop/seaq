/**
 * How `keys` read values out of items: dot paths, arrays at any level,
 * numbers and booleans as strings, objects as JSON, null/undefined skipped.
 */
import { describe, expect, test } from 'vitest';
import { seaq } from '../src/index';

const person = {
  name: 'joe',
  age: 30,
  active: true,
  emails: [
    { email: 'joe@test.com', meta: { provider: 'test.com', confirmed: false } },
    { email: 'joey@tester.com', meta: { provider: 'tester.com', confirmed: true } },
  ],
  address: { line1: '1234 Main Street', line2: 'Vancouver BC' },
  tags: ['developer', 'admin'],
  extra: null,
  empty: undefined,
};

/** The field values `key` yields for `item` that exactly match `query`. */
function found(item: unknown, key: string, query: string): string[] {
  return seaq([item], query, { keys: [key], fieldMode: 'separate', includeMatches: true }).flatMap(
    (r) => r.matches.map((m) => m.value),
  );
}

describe('keys', () => {
  test('strings, numbers and booleans', () => {
    expect(found(person, 'name', 'joe')).toEqual(['joe']);
    expect(found(person, 'age', '30')).toEqual(['30']);
    expect(found(person, 'active', 'true')).toEqual(['true']);
  });

  test('null, undefined and missing values never match', () => {
    for (const key of ['extra', 'empty', 'nothing', 'name.deeper']) {
      for (const query of ['null', 'undefined', 'n']) {
        expect(seaq([person], query, { keys: [key], fuzziness: 0 })).toEqual([]);
        expect(seaq([person], query, { keys: [key], fieldMode: 'separate', fuzziness: 0 })).toEqual(
          [],
        );
      }
    }
  });

  test('dot paths into nested objects', () => {
    expect(found(person, 'address.line1', '1234 Main Street')).toEqual(['1234 Main Street']);
  });

  test('an object at the end of the path is matched as JSON', () => {
    const json = JSON.stringify(person.address);
    expect(found(person, 'address', json)).toEqual([json]);
    expect(seaq([person], 'line2', { keys: ['address'] })).toEqual([person]);
  });

  test('arrays are walked at any level', () => {
    expect(found(person, 'emails.email', 'joey@tester.com')).toEqual(['joey@tester.com']);
    expect(found(person, 'emails.meta.provider', 'test.com')).toEqual(['test.com']);
    expect(found(person, 'emails.meta.confirmed', 'false')).toEqual(['false']);
    expect(found(person, 'tags', 'admin')).toEqual(['admin']);
  });

  test('null entries inside arrays are skipped', () => {
    const item = { tags: [null, { name: 'admin' }, undefined] };
    expect(found(item, 'tags.name', 'admin')).toEqual(['admin']);
    expect(seaq([item], 'null', { keys: ['tags.name'], fuzziness: 0 })).toEqual([]);
    expect(seaq([item], 'null', { keys: ['tags'], fuzziness: 0 })).toEqual([]);
  });

  test('an array at the end of the path yields each element; nested arrays as JSON', () => {
    const item = { grid: [['a1', 'b2'], 'c3', { d: 4 }] };
    expect(found(item, 'grid', 'c3')).toEqual(['c3']);
    expect(found(item, 'grid', '["a1","b2"]')).toEqual(['["a1","b2"]']);
    expect(found(item, 'grid', '{"d":4}')).toEqual(['{"d":4}']);
  });

  test('null and undefined items never match, with or without keys', () => {
    const list = [null, undefined, person];
    expect(seaq(list, 'joe', { keys: ['name'] })).toEqual([person]);
    expect(seaq(list, 'joe', { keys: ['name'], fieldMode: 'separate' })).toEqual([person]);
    for (const cache of [false, true]) {
      expect(seaq([null, undefined], 'null', { cache, fuzziness: 0 })).toEqual([]);
      expect(seaq([null, undefined], 'undefined', { cache, fuzziness: 0 })).toEqual([]);
    }
  });

  test('without keys: strings as they are, numbers as strings, objects as JSON', () => {
    expect(seaq([42, 'forty-two'], '42')).toEqual([42]);
    expect(seaq([{ a: 1 }], '{"a":1}')).toEqual([{ a: 1 }]);
    expect(seaq([true, false], 'true')).toEqual([true]);
  });
});
