# Wharfie checkpoint — strict version 2 application boundary

**Date:** 2026-07-16

**Code commit:** `58a18dc` (`Define the strict v2 application boundary`)

**Branch at checkpoint:** `agent/strict-manifest`

**Base:** `4b3f13a` (`Checkpoint the v1 deletion boundary`)

This is the current restart point. Read `PROJECT.md`, the accepted ADRs in
`docs/architecture/decisions/`, and `ROADMAP.md` first. Older dated checkpoints
are immutable history and may describe code that has since been deleted.

## Product decisions that remain authoritative

- Wharfie turns a normal local TypeScript CLI into a portable SEA, then lets
  that same application become a durable service and later run across trusted
  nodes without an application rewrite.
- Nodes are trusted. A trustless mesh, Kubernetes, containers, a hosted control
  plane, general cloud IaC, and v1 compatibility are out of scope.
- TypeScript/Node is the only initial authoring model. Exact Node-API packages
  are supported for hot paths; a future versioned activity protocol may add
  WASI/WASM or subprocess components.
- One coordinator is sufficient initially, provided coordination truth lives in
  a linearizable durable store and every decision/commit is fenced so another
  coordinator can recover safely.
- Physical work is at-least-once. Exactly-once may be claimed only for a managed
  effect whose destination atomically enforces the effect identity with the
  business mutation. Arbitrary in-process code cannot make that claim.
- Applications declare finite portable needs. Deployment profiles and provider
  drivers may use the user's normal credential chain to create only Wharfie
  substrate; provider-native application topology remains outside Wharfie.

## Preservation and publication state

- Every branch that was live on the remote at the start of the reset was backed
  up under annotated `archive/2026-07-16/remote/...` tags and verified. The
  archived remote `master` tip is `f31595a`.
- The unpublished local `master` commits and the old stash also have local
  archive tags.
- Reset documentation is on `agent/project-reset` (`0ac89a1`, draft PR #123).
- Cleanup inventory is on `agent/cleanup-inventory` (`80c42a1`, draft PR #124).
- The packaging/v1-deletion/strict-manifest stack is local through `58a18dc`.
- GitHub writes are currently blocked because the injected `GITHUB_TOKEN` and
  `gh` authentication are invalid. Restore them before pushing or changing the
  tracker:

  ```bash
  unset GITHUB_TOKEN
  gh auth login -h github.com
  gh auth status
  ```

Do not delete remote branches, close PRs/issues, or rewrite the preserved stack
until authentication is restored and the archive tags have been rechecked.

## What `58a18dc` establishes

- `wharfie.app.js` default-exports one plain-data `schemaVersion: 2` definition.
  There is one compiler and one canonical runtime/embedded/provided manifest.
- The public shape is exactly `app.id`, required `cli.entrypoint`, optional exact
  `targets`, portable `resources`, and named `activities`. Unknown keys and the
  old `ActorSystem`, `name`, `functions`, `capabilities`, workflow, scheduler,
  and packaging aliases are rejected.
- Application and activity IDs are canonical lowercase kebab IDs of 1–63 ASCII
  bytes. Wharfie rejects rather than trims or case-folds them.
- Node entrypoints are explicit `{ kind: 'node', path, export }`. Source paths
  must exist inside the app root without symlink escape; canonical manifests
  contain normalized relative forward-slash paths.
- Targets use exact Node versions and explicit supported platform/architecture
  fields; Linux requires `libc: 'glibc'`. Packaging refuses an absent target.
- Resource adapters/options and external packages have exact versioned shapes.
  Source execution verifies that locally resolved external package versions
  match the pins that an SEA would install.
- Canonical JSON ordering is locale-independent. Source, provided, embedded,
  printed, and deployed manifests use the same validator and reject inline
  secrets without echoing their values.
- Build signing and extra assets are packaging inputs, not runtime-manifest
  fields. Public TypeScript declarations reject extra nested keys while
  retaining literal inference.
- Examples now live under `scratch/examples/apps/` and use the public v2 model.
  Internal `ActorSystem` objects remain packaging machinery only.
- The unreachable best-effort scheduler, its duplicate persisted-run wrapper,
  and its test-only invalid manifest path were deleted. Durable schedules must
  later enter the unified operation path with stable fire IDs, persisted
  cursors/deduplication, coordinator epochs, and fencing.
- Source ESM activity imports use file URLs, including Windows-safe handling of
  drive letters and filenames containing URL metacharacters.
- The real package SEA verifier now runs on Linux or macOS and forces every
  subprocess to use the exact Node binary used by the SEA blob generator.

ADR 0006 records the public boundary and its consequences.

## Verification evidence

All verification used Node `24.13.1` and npm `11.12.0` unless the command invoked
Node directly.

- `npm run lint` — passed.
- `npm run typecheck` — passed.
- Full Jest coverage run outside the restricted sandbox — 45 suites passed,
  241 tests passed, one intentionally opt-in native-externals test skipped.
- `npm run verify:package` — verified 122 files in the packed npm tarball.
- `node scripts/verify-package-sea.js` on macOS arm64 — installed the tarball,
  ran the authored source CLI/activity, built and ad-hoc-signed a real
  Node 24.13.1 SEA, moved it to a clean directory, proved `node` was unavailable
  on `PATH`, ran the packaged CLI/activity, and read its embedded strict
  manifest. Artifact size was 128,724,816 bytes.

The same moved-SEA verifier still needs to run on Linux in CI for the release
golden path. The opt-in multi-native-package smoke remains intentionally outside
normal CI; the checked-in kitchen-sink portability claim is currently the exact
LMDB package pin only.

## Next work, in order

1. Restore GitHub authentication; push `agent/strict-manifest`; open/review its
   stacked PR; then execute the already-preserved PR/branch/issue cleanup plan.
2. Run the strict stack through hosted Linux CI and review the narrow public
   boundary before expanding it.
3. Choose one persisted-run implementation. Today
   `src/core/runtime/app-runs.js` serves manifest activities while
   `src/core/lib/graph/app-run.js` still serves queued event runs.
4. Fix operation-store semantics before claiming durability: use an injective
   record key (the current delimiter encoding collides for operation `a#b` and
   action `b` of operation `a`), make create versus replace explicit, remove
   stale actions transactionally on replacement, and make cancellation a
   durable state transition rather than a hard delete.
5. Then define immutable revisions/artifacts/deployment profiles and the
   run → invocation → attempt → effect ledger before reintroducing schedules or
   workflows.

Other honest loose ends include the private packaged-CLI fallback aliases, the
internal Lambda `functionName` protocol terminology, explicit test/lint
exclusions, and the production audit gate. None should be preserved for
backward compatibility; simplify them when their owning slice is addressed.

## Clean restart procedure

```bash
git switch agent/strict-manifest
git status --short
git log --oneline --decorate -8
. "$HOME/.nvm/nvm.sh"
nvm use 24.13.1
npm run lint
npm run typecheck
```

After authentication is restored, fetch and verify the archived refs before
any destructive tracker cleanup. If `58a18dc` is not present, recover it from
the local branch/archive before doing new implementation work.
