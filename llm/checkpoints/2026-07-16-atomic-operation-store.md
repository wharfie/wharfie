# Wharfie checkpoint — atomic operation-store boundary

**Date:** 2026-07-16

**Code commit:** `16003d0106b88f153f30e1068151aaa4d42a1863`
(`Make operation persistence atomic and explicit`)

**Branch at checkpoint:** `agent/strict-manifest`

**Base:** `db95fe2` (`Checkpoint the strict v2 manifest boundary`)

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
  a linearizable durable store and every decision and commit is fenced so a
  replacement coordinator can recover safely.
- Physical work is at-least-once. Exactly-once may be claimed only for a managed
  effect whose destination atomically enforces the effect identity with the
  business mutation. Arbitrary in-process code cannot make that claim.
- Applications declare finite portable needs. Deployment profiles and provider
  drivers may use the user's normal credential chain to create only Wharfie
  substrate; provider-native application topology remains outside Wharfie.

## Preservation and publication state

- Every branch live on the remote at the start of the reset was backed up under
  a verified annotated `archive/2026-07-16/remote/...` tag on GitHub. The
  archived remote `master` tip is `f31595a`.
- The exact tag-to-commit table is retained in
  `llm/checkpoints/2026-07-16-project-reset.md`.
- The unpublished local `master` tip and old stash are preserved only in this
  checkout as `archive/2026-07-16/local/unpublished-master` and
  `archive/2026-07-16/local/stash`; they were deliberately not published.
- Reset documentation is published on `agent/project-reset` at `0ac89a1`
  (draft PR #123), and the cleanup inventory is published on
  `agent/cleanup-inventory` at `80c42a1` (draft PR #124).
- The packaging, v1-deletion, strict-manifest, and atomic-operation-store stack
  is local through `16003d0`.
- GitHub writes are blocked because both the injected `GITHUB_TOKEN` and stored
  `gh` authentication are invalid. Restore authentication before pushing or
  changing the tracker:

  ```bash
  unset GITHUB_TOKEN
  gh auth login -h github.com
  gh auth status
  ```

Do not delete remote branches, close PRs or issues, or rewrite the preserved
stack until authentication is restored and the archive tags are rechecked.

## What `16003d0` establishes

- Manual and queue-triggered named activities enter one canonical persisted-run
  constructor and shared graph runner. The duplicate graph app-run path is
  deleted.
- The shared database contract has one conditional transaction primitive with
  aligned validation and pre-state semantics across vanilla, LMDB, and
  DynamoDB; DynamoDB uses `TransactWriteItems` and retries only pure transaction
  conflicts.
- Typed base64url record keys make valid operation/action identities injective.
- The operation store exposes explicit create, replace, retry, cancel, claim,
  and result-commit transitions instead of generic upsert and hard deletion.
- Exact metadata/query/metadata reads validate one complete current-generation
  action graph, including record identity, membership, edge agreement, and
  acyclicity, and fail closed when a stable snapshot cannot be obtained.
- Operation generations and versions fence graph changes. Every action mutation
  also compares and increments its own monotonic revision, including protection
  against same-generation, same-status ABA races.
- Cancellation persists operator metadata and current records, retries around
  concurrent action changes, and fences stale results. It does not claim to
  interrupt executing JavaScript.
- Stable operation IDs deduplicate only an identical app, activity, trigger,
  input, and action definition. Reusing an ID for different work fails visibly,
  and validation is bound to the exact generation/version claimed by the
  runner.
- Queue IDs are stable hashes of the exact queue URL and provider message ID;
  provider identifiers, activities, receipts, inputs, and handler results are
  not silently normalized or shared by reference.
- Operation-control storage has explicit configuration. Tests use vanilla,
  normal local execution defaults to dedicated LMDB, and packaged Lambda queue
  polling refuses to run without a durable operation store.

ADR 0007 records this boundary and its consequences.

## Verification evidence

Verification used Node `24.13.1` and npm `11.12.0`.

- `npm run lint` — passed.
- `npm run typecheck` — passed.
- The final action-revision audit passed 38 focused tests covering the
  DynamoDB-fake and vanilla lifecycle matrices, the same-status ABA regression,
  runner and record-model behavior, and selected database transaction
  contracts.
- Immediately before the final action-revision hardening, the focused database
  adapter, full lifecycle (including LMDB), graph-runner, and Lambda-polling
  group passed 55 tests.
- An earlier pinned full run passed 47 suites and 269 tests, with one skipped;
  it predates the final action-revision hardening.
- A final native-LMDB/full-suite rerun could not be completed: the native test
  process aborted in the restricted sandbox, and the environment rejected the
  required elevated rerun after reaching its execution quota. No assertion
  failed, but the exact code commit is not full-suite-certified.

## Deliberate limitations and open risk

- This is a mutable current snapshot, not the final
  run → invocation → attempt → effect ledger or an append-only history. Prior
  graph generations are not retained.
- There are no leases, heartbeats, coordinator epochs, stuck-work recovery, or
  effect reconciliation yet.
- Cancellation fences later Wharfie control-state commits; it does not stop
  JavaScript, undo an external effect, or establish whether an uncertain effect
  happened.
- Wharfie makes no exactly-once claim for arbitrary handlers.
- DynamoDB transactions are fake-tested only; there has been no live DynamoDB
  conformance run. DynamoDB item/transaction byte limits still apply, and an
  operation is capped at 49 actions.
- Vanilla storage is diagnostic/test-only and is not crash durable.
- Schedules and workflows remain prohibited until the ledger and recovery
  semantics are designed.
- Hosted Linux SEA CI, the production audit policy, remaining explicit test
  exclusions, and GitHub tracker cleanup are still open.

## Next work, in order

1. Restore GitHub authentication, recheck the archive tags, publish the current
   stack, and execute the already-inventoried PR/branch/issue cleanup plan.
2. Rerun the full suite and the moved-SEA proof in hosted Linux CI.
3. Define immutable logical revisions, target-specific artifacts, deployment
   profiles, and their stable identities.
4. Decide the durable workflow model and define the
   run → invocation → attempt → effect ledger before reintroducing schedules or
   workflows.
5. Add leases, recovery, reconciliation, and coordinator fencing only on top of
   that ledger rather than extending the mutable snapshot into a false history.

## Clean restart procedure

```bash
git switch agent/strict-manifest
git status --short
git log --oneline --decorate -10
. "$HOME/.nvm/nvm.sh"
nvm use 24.13.1
npm run lint
npm run typecheck
```

After authentication is restored, fetch and verify every
`archive/2026-07-16/remote/...` ref before destructive tracker cleanup. If
`16003d0` is absent, recover it from this checkout's local branch before doing
new implementation work.
