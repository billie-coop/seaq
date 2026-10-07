# seaq

[![npm](https://img.shields.io/npm/v/seaq?label=npm)](https://www.npmjs.com/package/seaq)

Zero-dependency fuzzy search for JavaScript and TypeScript. One function, no setup, no index to manage. Works the same whether your list has 20 items or 20,000.

```typescript
import { seaq } from 'seaq';

seaq(contacts, 'john', { keys: ['name', 'email'] });
```

**[Docs & live playground →](https://billie-coop.github.io/seaq/)**

For installation, usage, and the full API see **[`packages/core/README.md`](./packages/core/README.md)** — that's also what ships on npm.

## Repo layout

This is a yarn workspaces monorepo.

| Package | Description |
|---------|-------------|
| [`packages/core`](./packages/core) | The published `seaq` library. |
| [`packages/test-data`](./packages/test-data) | Shared fixtures (contacts, cities, books) consumed by tests and the docs site. Not published. |
| [`packages/docs`](./packages/docs) | Docs site with an interactive playground comparing seaq against fuzzysort, Fuse.js, MiniSearch, uFuzzy, and Lunr — including bring-your-own-JSON data. Live at [billie-coop.github.io/seaq](https://billie-coop.github.io/seaq/). |

Other docs:

- [BENCHMARKS.md](./BENCHMARKS.md) — performance methodology and numbers
- [WHY-SEAQ.md](./WHY-SEAQ.md) — when seaq is the right tool (and when it isn't)

## Development

Prerequisites: Node 24 (pinned in `.prototools`; the published package supports Node 22+), yarn 4 (managed via `packageManager` in `package.json`).

```bash
yarn install
yarn build          # build all packages
yarn test           # run all tests
yarn coverage       # core unit tests; fails below 100% coverage of packages/core/src
yarn ts-check       # type-check the whole repo
yarn check          # biome lint
yarn dev            # build core in watch mode + run docs site
```

Benchmarks live in `packages/core/test/perf`:

```bash
yarn workspace seaq benchmark
yarn bench:save     # save benchmark JSON keyed by commit short SHA
```

## Releasing

Releases publish from GitHub Actions via [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) — no npm token.

1. In a PR, bump `version` in `packages/core/package.json` (and the root `package.json` to match). Run `yarn release:verify` and `yarn release:pack` to check what ships.
2. Merge to `main`.
3. Run the **Release** workflow (`.github/workflows/release.yml`) from `main`. Tick **dry-run** first if you want to check it.

The workflow publishes the committed version and never bumps it. It refuses to run if the tag `v<version>` or the npm version already exists. Prereleases (`x.y.z-rc.1`) go to the `next` dist-tag and stable versions to `latest`. Before publishing it strips `devDependencies`, which use yarn's `workspace:` protocol, from the package. Then it creates the GitHub release with generated notes.

## License

MIT
