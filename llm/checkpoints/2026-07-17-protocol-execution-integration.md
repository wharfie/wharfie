# Wharfie checkpoint — Protocol execution integration

**Date:** 2026-07-17
**Branch:** `agent/strict-manifest`
**Published parent:** `8d5e4a3` (`Harden activity attempts and revision-bound invocation`)
**Status:** implementation and verification are complete locally; commit and push this checkpointed slice before starting the worker transport replacement.

This checkpoint captures the continuation point after routing the ordinary
source and packaged-SEA application paths through Activity Protocol v1. It is
written without a self-referential final commit hash.

## Resume instructions

Read `PROJECT.md`, `ROADMAP.md`, the accepted records in
`docs/architecture/decisions/`, this file, and the preceding
`2026-07-17-attempt-adapter-and-revision-gateway.md` checkpoint. Then inspect
the current branch and remote state before changing code.

Breaking changes are authorized. There are no known downstream users. Do not
restore Wharfie product v1 compatibility, generic resource injection, or
unqualified exactly-once claims. The user authorized commits and pushes, but
did **not** authorize modifying `package.json` or `package-lock.json` to repair
the known clean-install direct `@typescript-eslint/parser` dependency issue.

## Product decisions carried forward

- Wharfie is a Node/TypeScript-first framework that turns a normal CLI into a
  portable SEA, then a durable resident service, and ultimately a trusted-node
  mesh.
- Nodes are trusted; there is no trustless mesh goal. One coordinator is fine
  initially only with a robust recovery path.
- Cloud integration is capability fulfillment using the operator's ordinary
  credentials, not general cloud IaC.
- A physical handler execution is not an exactly-once claim. Exactly-once is
  possible only at managed destination boundaries that atomically enforce an
  effect identity with the business mutation.
- Node is the authoring/runtime baseline. Future native bindings, WASM, or
  managed subprocess workers may accelerate hot paths without changing the
  durable activity boundary.

## What this slice changes

### One public activity ABI

Activities now use:

```ts
async function activity(input, runtime) { /* ... */ }
```

- `runtime.invocation` has immutable revision, activity, run, invocation,
  attempt, fencing, and optional deadline identity.
- `runtime.caller.metadata` is strict JSON metadata separate from `input`.
- `runtime.logger` and `runtime.signal` are present at the adapter boundary.
- The public `invokeActivity` fields are only `input`, `callerMetadata`,
  `deadlineUnixMs`, and `dir`. Old `event`, `context`, and `signal` aliases
  reject.
- Built-in `app run` and `ops run` use `--input`; both accept
  `--caller-metadata`. `ops run` persists caller metadata in its operation
  snapshot and overlays host-owned operation identity at execution time.

### Sealed execution identity

- Source execution accepts only an explicit
  `{ kind: 'prepared-source', prepared }` handle. It validates the immutable
  revision/manifest/lock binding and checks the sealed source snapshot before
  and after every attempt.
- Packaged execution accepts only an explicit
  `{ kind: 'embedded', manifest, embeddedRevision }` identity and validates
  the embedded revision/runtime pair and manifest contract.
- Local adapter-generated IDs are fresh on every physical attempt. They do not
  pretend to be durable run, lease, generation, or recovery identities.

### Bundle and evidence boundary

- `FunctionResource` emits a private symbol
  `wharfie.activity-attempt.v1/<activity-id>` beside the retained legacy raw
  entrypoint. The private wrapper accepts exactly `{ startFrame }`, selects its
  fixed export, and invokes `runNodeActivityAttempt`.
- `Function.runPreparedActivityAttempt` and `Function.runActivityAttempt`
  select that private symbol, never create legacy resources/RPC, and
  revalidate a restricted returned transcript (`start`, `log*`, terminal).
- Fabricated effects/cancellation frames, a mismatched start, malformed
  transcript, missing wrapper, and worker cleanup/transport failures fail
  closed. A worker transport failure intentionally invents no terminal result.
- A real non-completed terminal becomes `ActivityAttemptOutcomeError`; a
  completed terminal returns a cloned strict JSON result.

### Explicit non-goals in this code path

- Nonempty manifest/activity resource declarations and
  `callerMetadata.resources` reject on the Activity Protocol path. The old
  actor/resource RPC code remains legacy internals only; it is not a durable
  effect API.
- The kitchen-sink external-dependency fixture is now resource-free and uses
  the new ABI. Obsolete resource demos and stale scratch spikes were removed.
- The worker still uses private unversioned `exec`/result bytes underneath the
  wrapper. That is the next bounded replacement, not a completed protocol
  transport.

## Verification completed locally

- `npm run lint`
- `npm run typecheck`
- `npm test` — 62 passing suites, 1 intentionally skipped; 653 passing tests
  at the final local run for this slice.
- `npm run verify:package:sea` — passed: clean generated app, source CLI,
  relocated generated Darwin SEA, locked LMDB activity, and Node unavailable
  on `PATH`.

Run the full suite again after committing any edits made after this checkpoint.
The SEA verifier needs an unsandboxed/local-executable environment.

## Next bounded task

Replace the worker's unversioned private execution transport with framed
Activity Protocol transport. Preserve these boundaries:

1. Host validates and emits `start`; component frames are ordered and
   correlated to the attempt.
2. Cancellation/deadlines have a bounded grace interval, forced worker
   termination, and late-frame rejection.
3. The host accepts only verified transcripts and never fabricates an outcome
   after transport loss.
4. Do not expose generic resource RPC as effects. Managed effects wait for the
   ledger/effect-destination work.

After that, take the hosted-Linux frozen-closure SEA proof, then begin the
append-only run → invocation → attempt → effect ledger before adding workflows
or schedules.
