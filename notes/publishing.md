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

All on 2026-11-03 (US time; 2026-11-04 UTC):

- PR #27 (2.0) squash-merged as `28f7790`. Dependabot PRs #28 (vite 6.4.5) and #30
  (ip-address 10.7.6) rebased and merged. PR #31 (the rename) merged as `7f7e7a6`. CI and
  the docs deploy passed on `main`.
- Claimed the name from Stephen's machine: `@billie-coop/seaq@2.0.0-rc.0` on `next`
  (browser 2FA). npm also created `0.0.0-stage`.
- Trusted publisher added with `npm trust github` (step 3 above): "publish, stage publish".
- Release workflow dry run (run 41760183559), then the real run (run 41761058901):
  `@billie-coop/seaq@2.0.0` is `latest` with an SLSA v1 provenance attestation, and GitHub
  release `v2.0.0` has the CHANGELOG entry plus generated notes. This validated the trusted
  publisher. An install from the registry imports in both ESM and CommonJS, and
  `npm audit signatures` verifies the attestation.
- Deprecated `@billie-coop/seaq@0.0.0-stage` ("npm staging placeholder; use 2.0.0 or later")
  and every `seaq` version ("Moved to @billie-coop/seaq: npm install @billie-coop/seaq").
  The first deprecate attempt failed with a 404 on `-/v1/done` because the browser approval
  expired; approving within a few minutes works.
- Still open: the publishing access setting (step 6), which only Stephen can set.
  `next` still points at `2.0.0-rc.0`.
