# Publishing: decisions and log

## Decided

- **seaq 2.0 is published as `@billie-coop/seaq`** (decided 2026-11-03 by Stephen). 2.0 is
  the breaking release, so the rename happens with it. The unscoped `seaq` stays at 1.1.5
  (plus the old `2.0.0-rc.1` / `rc.2` on `next`) and every version is deprecated with a
  pointer to `@billie-coop/seaq`. Nothing is unpublished, and 2.0.0 is not published under
  the bare name.
- The docs site and the comparison tests still use seaq 1.1.5 from npm, as `seaq-v1`
  (`npm:seaq@1.1.5`), so the playground can compare v1 and v2.
- **Releases go through `.github/workflows/release.yml`** with npm trusted publishing (OIDC,
  no token) and provenance. Manual only, from `main`, dry run by default.
- The docs deploy to GitHub Pages at `https://billie-coop.github.io/seaq/`
  (`.github/workflows/docs.yml`, base `/seaq/`).

## First release under the scoped name

npm only allows a trusted publisher once a package exists, so the name is claimed by hand
with a prerelease, and 2.0.0 itself goes through the workflow.

1. Rename on `main`: package name, READMEs, docs site, workflows, CHANGELOG.
2. Claim the name from Stephen's machine: `2.0.0-rc.0` with `--tag next` (version set
   locally, not committed).
3. Trusted publisher:
   `npm trust github @billie-coop/seaq --file release.yml --repo billie-coop/seaq --allow-publish`.
   A new trusted publisher expires after 48 hours unless a workflow publish uses it.
4. Release 2.0.0 with the workflow: a dry run, then `dry-run` unticked.
5. Deprecate npm's `0.0.0-stage` placeholder on `@billie-coop/seaq`, and every version of
   the bare `seaq`.
6. Stephen sets publishing access on
   `https://www.npmjs.com/package/@billie-coop/seaq/access`: "Require two-factor
   authentication and disallow tokens".

## Log
