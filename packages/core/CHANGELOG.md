# Changelog

## 2.0.0

First release under the new name **`@billie-coop/seaq`**. The `seaq` package on npm stays at
1.1.5 and is deprecated; new versions are published only as `@billie-coop/seaq`.

### Migrating from `seaq` 1.x

1. Swap the package:

   ```bash
   npm uninstall seaq
   npm install @billie-coop/seaq
   ```

2. Change imports:

   ```typescript
   // before
   import { seaq } from 'seaq';
   // after
   import { seaq } from '@billie-coop/seaq';
   ```

3. Move `keys` and `fuzzy` into an options object:

   ```typescript
   // 1.x
   seaq(contacts, 'john', ['name', 'email'], 0.5);
   // 2.0
   seaq(contacts, 'john', { keys: ['name', 'email'], fuzziness: 0.5 });
   ```

4. Check the new defaults:
   - **At most 10 results** (`limit: 10`), and results scoring below 30% of the best one are
     dropped (`threshold: 0.3`). 1.x returned every match. For that, pass
     `{ limit: Infinity, threshold: 0 }`.
   - **Light typo tolerance** (`fuzziness: 0.2`). In 1.x, leaving out `fuzzy` rejected typos.
     Pass `fuzziness: 0` to reject them.
   - **Scores and ranking come from a new scorer**, so the order of results changes.

If you tried `seaq@2.0.0-rc.1` or `rc.2`: the `fieldMode` option is removed. An item's
values are always joined with spaces and scored as one string, so a query can span fields.
Highlights are still reported per field value.

### What's new since 1.x

- **New API:** `seaq(list, query, options)` with `keys`, `fuzziness`, `limit`, `threshold`,
  `includeMatches` (per-field highlight ranges and scores) and `cache`.
- **A scorer built for search boxes:** shorthand (`steplau`), acronyms (`IDE` → Integrated
  Development Environment), words in any order, swapped letters (`laguht` → Laughton) and,
  with `fuzziness` above 0, typos. Capitals the user typed earn a case bonus. Characters
  outside the BMP (emoji, rare CJK) are matched and highlighted as whole characters.
- **Automatic list index:** searching the same array a second time indexes it, so repeated
  searches (typeahead) are faster with no setup. `cache: true` indexes on the first search
  and `cache: false` never does. Results are the same either way. Items mutated in place
  aren't detected once an array is indexed; replace them instead.
- **Nested keys and arrays:** dot notation (`'address.city'`) and automatic array traversal
  (`'emails.address'`).
- **ESM and CommonJS builds** with TypeScript types, zero dependencies. Node 22 or later.
- **Docs and a live playground** at <https://billie-coop.github.io/seaq/>, comparing seaq with
  fuzzysort, Fuse.js, MiniSearch, uFuzzy and Lunr on your own JSON.
- Published from GitHub Actions with npm provenance.
