# Wharfie checkpoint — hosted Linux SEA proof

- **Date:** 2026-07-17
- **Branch:** `agent/strict-manifest`
- **Published parent:** `58d5d29` (`Keep Linux SEA proof observable`)
- **Status:** the frozen-closure/content-addressed SEA proof has passed on a
  clean hosted Ubuntu runner. The only known PR gate failure is the explicitly
  deferred clean-install lint dependency declaration.

This is a historical handoff. Preserve prior checkpoints; update the live
roadmap or create another dated checkpoint for later work.

## Resume instructions

Read `PROJECT.md`, `ROADMAP.md`, accepted ADRs, this checkpoint, and the
preceding `2026-07-17-framed-worker-transport.md`. Inspect the current branch,
remote state, and draft PR before changing code. Breaking changes remain
authorized because there are no known downstream users.

The user authorized commits and pushes, but did **not** authorize changing
`package.json` or `package-lock.json` to repair the direct
`@typescript-eslint/parser` declaration. Do not make that dependency change
without explicit approval.

## Hosted proof completed

GitHub Actions run
[29600664061](https://github.com/wharfie/wharfie/actions/runs/29600664061)
executed on Ubuntu 24.04 x64 with Node `24.13.1` and pinned npm `11.12.0`.
The standalone `npm run verify:package:sea` step passed after a clean `npm ci`.

The verifier:

- packs and installs the published Wharfie tarball into a fresh directory;
- creates a TypeScript application with a locked native `lmdb` activity
  dependency;
- generates a target-specific Linux SEA, copies it into a clean directory, and
  proves `node` cannot be resolved on `PATH`;
- runs source and generated CLI/activity paths, including argv, stdin,
  stdout/stderr, exit status, and LMDB read/write behavior; and
- confirms the embedded revision, artifact ID, byte digest, size, and target
  against the build record.

The hosted generated artifact was `150146240` bytes. This establishes the
Milestone 2 frozen-closure/Linux portability proof, including the current
framed activity-attempt transport used by the packaged activity.

`npm run verify:package:sea` also passed locally under Node `24.13.1` before
the hosted run.

## CI independence and known failure

`.github/workflows/ci.yml` now marks the Linux SEA step with
`if: ${{ always() }}`. The step still follows the normal validation suite but
runs even when another validation gate fails, so a lint failure cannot hide
portable-artifact evidence. This does not make the CI job green when a prior
step fails.

The same hosted run correctly remains red because `npm run test:ci` fails at
lint: the root ESLint configuration enables `plugin:import/typescript`, but
the root manifest/lock do not directly install `@typescript-eslint/parser`.
The clean install therefore cannot resolve it. This is unrelated to package
contents, TypeScript checking, tests, or SEA generation, but it must be fixed
before treating the full PR gate as green. It requires the user's explicit
dependency-manifest approval.

## Next work

1. After explicit approval, add the direct parser/lock repair and make draft
   PR #125 green in GitHub Actions.
2. Implement the first append-only run → invocation → attempt → effect ledger
   slice before adding schedules or workflows.

The existing framed worker transport is verified, but not a durable ledger or
an exactly-once claim. Exactly-once remains valid only at managed destination
boundaries that atomically enforce effect identity with the destination
mutation.
