# Checkpoint — portable application packaging salvage

- **Captured:** 2026-07-16, America/Detroit
- **Branch:** `agent/packaging-salvage`, stacked on `agent/project-reset`
- **Purpose:** record the first implementation slice after the project reset and
  the exact boundary before v1 deletion
- **Canonical scope:** [`PROJECT.md`](../../PROJECT.md)
- **Live plan:** [`ROADMAP.md`](../../ROADMAP.md)
- **Earlier reset snapshot:**
  [`2026-07-16-project-reset.md`](2026-07-16-project-reset.md)

This checkpoint supersedes only the earlier snapshot's next-action section. It
does not rewrite the product decisions or preservation evidence in that
historical checkpoint.

## Copy-paste resume prompt

> Continue the Wharfie reset from
> `llm/checkpoints/2026-07-16-packaging-salvage.md`. Read `PROJECT.md`,
> `ROADMAP.md`, the accepted ADRs, and the earlier project-reset checkpoint.
> Fetch the remote and inspect the current state of the stacked reset, cleanup,
> and packaging PRs before changing code. Breaking changes are allowed and v1
> is abandoned. Do not publish a release: `package.json` is deliberately private
> and `npm run verify:release-ready` must remain blocked until the named v1 paths
> and dependencies are deleted. Resume with the ordered next slice below.

## What this slice established

- The supported builder is the npm/source Node toolchain. The standalone
  self-hosting Wharfie binary and its release jobs were removed from the public
  surface because build-host modules are not embedded.
- A small public `@wharfie/wharfie/app` API now supplies `defineApp`,
  `invokeActivity`, and TypeScript declarations. A TypeScript CLI and activity
  can run from source and through the generated executable without changing the
  invocation API.
- Packaged argv belongs to the developer application except for the single
  reserved operator namespace `<app> wharfie <command>`. The embedded public
  operator currently exposes only `manifest`; service bootstrap remains hidden
  internal wiring.
- Activity event, context, and result values cross the same strict JSON boundary
  in source and embedded execution. Unsupported values, accessors, special
  objects, sparse arrays, cycles, and non-finite numbers fail rather than being
  silently coerced.
- Per-activity environment maps were removed from the contract. Empty legacy
  declarations are stripped; non-empty declarations fail without rendering
  their values.
- SEA targets require the exact builder Node version, normalize Linux to glibc,
  reject unsupported targets, verify downloaded Node archives against official
  checksums, and keep signing credentials ephemeral.
- Activity bundles use exact external versions and cache workers by activity
  code plus external payload identity. Concurrent activities no longer share
  the wrong worker or teardown lifecycle.
- Artifact publication stages the complete output set privately, serializes
  publishers with an output lock, rolls back ordinary failures, preserves
  readable backups when rollback is incomplete, and cleans private build
  outputs. It is exception-safe, not a claim of crash-atomic multi-file
  publication; a process crash can leave a stale lock or recovery directory for
  operator inspection.
- Packaging rejects host LMDB adapters, unreviewed resource adapters/options,
  workflows, and scheduler triggers until their portable public/durable schemas
  are implemented. This prevents arbitrary configuration or workflow payloads
  from being embedded as if they were a reviewed secret-safe contract.
- Release metadata, version reporting, license, tarball verification, target
  names, and the npm-only release workflow now agree. Publication is
  intentionally blocked while v1 remains.

## Executable evidence

With Node `24.13.1` and npm `11.12.0`:

- `npm run test:ci` passed: 53 suites passed, one suite skipped; 242 tests passed
  and one test skipped. Lint, strict JS/TS type checking, coverage execution, and
  the npm tarball check all completed successfully.
- The package verifier accepted a 209-file npm tarball.
- The real Linux ARM64 proof packed the repository, installed that tarball into
  an isolated project, ran an authored TypeScript CLI/activity from source,
  generated a glibc Node SEA, copied it away from the project, removed Node from
  `PATH`, invoked the packaged activity, and read the immutable embedded
  manifest. The resulting proof artifact was `129,961,088` bytes.
- `npm run verify:release-ready` failed by design and enumerated the remaining
  v1 source, tests, and dependencies.

## Deliberately unresolved

This branch is not a releasable v2 product.

1. `src/core/**` still contains and the tarball still ships Athena, DuckDB,
   legacy AWS/resource paths, and their large dependency graph. The package is
   private specifically to prevent a misleading release.
2. `load-app.js` is a permissive compatibility compiler. It silently drops or
   defaults malformed targets, activities, workflows, schedulers, and resource
   shapes. Replace it with one explicit fail-fast v2 schema before expanding the
   authoring contract.
3. Durable workflows, schedules, service installation, run/attempt/effect
   semantics, deployment, and trusted mesh coordination remain roadmap work.
4. The JSON activity value contract is proven, but cancellation, deadlines,
   structured errors, logs, effects, and protocol version negotiation are not.
5. A real moved-SEA Node-API addon has not been proven. Existing `.node` text
   fixtures are not evidence; do not claim native-addon portability yet.
6. Artifact publication is serialized and rollback-safe for handled errors, but
   a crash-recoverable version-directory/pointer design remains future
   hardening.

## Ordered next slice

1. Review and merge or restack the project-reset and cleanup-inventory PRs.
2. Delete v1 source, `test/legacy`, and v1-only production dependencies. Update
   package verification so it requires only the narrow builder/runtime graph.
3. Keep `private: true` until `npm run verify:release-ready` passes because the
   actual blockers are gone, not because the gate was weakened.
4. Replace the compatibility manifest compiler with one strict, versioned v2
   application schema and negative tests for every malformed public field.
5. Re-run the full CI and clean Linux SEA proof, then review the resulting
   package dependency graph and production audit.
6. Only after that boundary, perform the already-inventoried destructive GitHub
   cleanup or begin the single durable-node ledger.

Pause for user review before weakening the release block, closing/deleting
GitHub work, or beginning the durable execution model.
