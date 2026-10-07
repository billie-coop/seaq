import { planQuery, scoreString } from './score';

/**
 * Score how well `query` matches `target`, returning a value between 0 and 1.
 *
 * Convenience wrapper around seaq's scorer (see `score.ts`) for scoring a
 * single string: `1` for an exact match, `0` for no match (or an empty
 * `query`). With no `fuzziness`, every query character must be found
 * (adjacent swaps allowed); with fuzziness, misses degrade the score.
 *
 * @param target - The string being scored against
 * @param query - The search query (words may match in any order)
 * @param fuzziness - Optional fuzziness factor (0–1)
 * @param _lowerQuery - Unused; kept for call-site compatibility
 * @param positions - Optional array to collect matched character positions
 * @param lowerTarget - Pre-lowercased target (computed automatically if omitted)
 */
export function string_score(
  target: string,
  query: string,
  fuzziness?: number,
  _lowerQuery?: string,
  positions?: number[],
  lowerTarget?: string,
): number {
  return scoreString(
    planQuery(query),
    target,
    lowerTarget ?? target.toLowerCase(),
    fuzziness ?? 0,
    positions,
  );
}
