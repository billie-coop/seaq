/**
 * Matching that works at every fuzziness: shorthand, acronyms, adjacent
 * swaps and any word order. Missing characters additionally need fuzziness
 * (the default 0.2) — strict mode (fuzziness 0) rejects them.
 */
import { describe, expect, test } from 'vitest';
import { type SeaqResult, seaq } from '../src/index';

const people = [
  'Stephen Laughton',
  'Steve Lawson',
  'Stella Laurent',
  'Stephanie Hughes',
  'Lauren Stephens',
  'Stan Lee',
  'Sheila Pughton',
  'John Smith',
];

const techTerms = [
  'Application Programming Interface',
  'Graphical User Interface',
  'Command Line Interface',
  'Integrated Development Environment',
  'Test Driven Development',
  'User Experience Design',
];

describe('shorthand and acronyms', () => {
  test('word prefixes: "steplau" → Stephen Laughton', () => {
    expect(seaq(people, 'steplau')[0]).toBe('Stephen Laughton');
  });

  test('initials match', () => {
    expect(seaq(people, 'stla')).toContain('Stephen Laughton');
  });

  test('a prefix outranks scattered word starts', () => {
    expect(seaq(['Sulz am Neckar', 'Sandy'], 'san')[0]).toBe('Sandy');
    expect(seaq(['Nancy Thompson', 'Nathan Fox'], 'nath')[0]).toBe('Nathan Fox');
  });

  test('acronyms realign to word starts: "IDE"', () => {
    // The earliest "d" is the end of "Integrated"; jumping to the start of
    // "Development" earns the acronym bonus
    expect(seaq(techTerms, 'IDE')[0]).toBe('Integrated Development Environment');
  });
});

describe('adjacent swaps', () => {
  test('"laguht" → Laughton', () => {
    expect(seaq(people, 'laguht')[0]).toBe('Stephen Laughton');
  });

  test('"stpehen" ranks Stephen Laughton first', () => {
    expect(seaq(people, 'stpehen')[0]).toBe('Stephen Laughton');
  });

  test('"jonh" → John', () => {
    expect(seaq(people, 'jonh')).toContain('John Smith');
  });

  test('a swap scores lower than the correct spelling', () => {
    const exact = seaq(['Laughton'], 'laught', { includeMatches: true })[0];
    const swapped = seaq(['Laughton'], 'laguht', { includeMatches: true })[0];
    expect(exact?.score).toBeGreaterThan(swapped?.score ?? 0);
  });

  test('a moved letter (not adjacent) does not match strictly', () => {
    expect(seaq(['Laughton'], 'lugahton', { fuzziness: 0 })).toEqual([]);
  });

  test('swapped letters highlight as one run', () => {
    const [result] = seaq(['Stephen Laughton'], 'laguht', {
      includeMatches: true,
    }) as SeaqResult<string>[];
    expect(result?.matches[0]?.indices).toEqual([[8, 13]]);
  });
});

describe('word order', () => {
  test('"laughton stephen" → Stephen Laughton', () => {
    expect(seaq(people, 'laughton stephen')[0]).toBe('Stephen Laughton');
  });

  test('typed order scores higher than reversed', () => {
    const inOrder = seaq(['Stephen Laughton'], 'stephen laughton', { includeMatches: true })[0];
    const reversed = seaq(['Stephen Laughton'], 'laughton stephen', { includeMatches: true })[0];
    expect(inOrder?.score).toBeGreaterThan(reversed?.score ?? 0);
  });

  test('both words highlight', () => {
    const [result] = seaq(['Stephen Laughton'], 'laugh steph', {
      includeMatches: true,
    }) as SeaqResult<string>[];
    expect(result?.matches[0]?.indices).toEqual([
      [0, 4],
      [8, 12],
    ]);
  });

  test('works across keys in joined mode', () => {
    const contacts = [
      { first: 'Stephen', last: 'Laughton' },
      { first: 'Lauren', last: 'Stephens' },
    ];
    expect(seaq(contacts, 'laughton steph', { keys: ['first', 'last'] })[0]).toEqual({
      first: 'Stephen',
      last: 'Laughton',
    });
  });
});

describe('missing characters need fuzziness', () => {
  test('"stevelaguht" has a "v" Stephen Laughton lacks: no strict match', () => {
    expect(seaq(people, 'stevelaguht', { fuzziness: 0 })).not.toContain('Stephen Laughton');
  });

  test('the default fuzziness lets missing characters through', () => {
    expect(seaq(people, 'stevelaguht')).toContain('Stephen Laughton');
  });

  test('"stephin" (no "i" in Stephen Laughton) needs fuzziness', () => {
    expect(seaq(people, 'stephin', { fuzziness: 0 })).not.toContain('Stephen Laughton');
    expect(seaq(people, 'stephin')).toContain('Stephen Laughton');
  });

  test('letters that exist in order still match as shorthand', () => {
    // "stephan" → Steph·en L·a·ughto·n — every letter exists, in order
    expect(seaq(people, 'stephan')).toContain('Stephen Laughton');
    expect(seaq(people, 'stephan')[0]).toBe('Stephanie Hughes');
  });
});
