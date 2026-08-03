# Wharfie checkpoint — hardened attempt adapter and revision gateway

**Date:** 2026-07-17

**Branch:** `agent/strict-manifest`

**Published parent:** `d2b9121` (`Define the activity attempt protocol`)

**Umbrella review:** draft PR
[#125](https://github.com/wharfie/wharfie/pull/125)

Read `PROJECT.md`, `ROADMAP.md`, and every accepted ADR in
`docs/architecture/decisions/` before making the next change. This checkpoint
is the continuation point after hardening the physical Activity Protocol v1
attempt primitive. It deliberately contains no self-referential commit hash;
resolve its owning commit with `git log` after it is committed.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-17-attempt-adapter-and-revision-gateway.md`.
> Breaking changes are allowed; v1 and backward compatibility are abandoned;
> there are no known downstream users. Fetch `origin`, verify draft PR #125,
> and preserve unrelated local changes. Confirm the checkpoint's focused
> verification on Node 24.13.1. Do not repair the missing direct
> `@typescript-eslint/parser` declaration until the user explicitly approves
> that separate CI dependency change. The next implementation slice is to
> route source and embedded SEA activities through this adapter while keeping
> ordinary developer CLI argv/stdin/stdout/stderr behavior outside it. Do not
> add durable recovery semantics to the transitional Operation/Action snapshot
> store.

## What is complete here

`src/core/runtime/activity-attempt.js` now runs one Node handler as a bounded,
strict Activity Protocol v1 physical attempt. It supplies immutable invocation
identity, caller metadata, an `AbortSignal`, structured logger, and a managed
effect client. It records a frozen transcript with a single terminal outcome.

The adapter is intentionally fail-closed:

- malformed component output and malformed host effect responses latch a
  protocol failure even when application code catches their thrown exception;
- component output seals permanently once a handler settles or forced
  termination begins, so late output cannot reopen an attempt;
- cancellation and deadline paths have bounded grace and host-operation waits;
- host frame delivery stops after the first failed frame and records the last
  contiguous acknowledged component sequence;
- hanging delivery, effect, and termination callbacks become explicit bounded
  uncertainty instead of hanging the caller forever; and
- oversized or hostile cancellation reasons are normalized to safe, bounded
  structured protocol errors.

`ActivityAttemptDeliveryError` intentionally carries locally accepted attempt
evidence, terminal (if locally accepted), first unacknowledged sequence, and
acknowledged prefix. It does **not** claim that an unacknowledged terminal is
durable. This is the required seam for the later append-only ledger.

The protocol now caps opaque identity fields at 512 UTF-8 bytes, preventing a
valid start frame from making subsequent correlated frames impossible to emit.
The common strict JSON boundary rejects negative zero because JSON transport
would silently normalize it.

The direct Lambda gRPC gateway is also revision-bound and value-correct as a
bounded pre-Protocol transport improvement:

- every service must bind one immutable `revisionId`, and direct requests must
  provide the exact same revision before `execute` is called;
- valid null, scalar, array, and object results round-trip unchanged;
- invalid JSON results fail as structured `activity-result-invalid` errors
  before generic JSON encoding can coerce or drop data; and
- errors use stack-free `{code, name, message, details}` structure rather than
  sending stack traces or host paths across gRPC.

The packaged Lambda command always loads and cross-checks the embedded
revision, including direct-only serving, and returns `Function.run`'s value.
This gateway is **not** yet the Activity Protocol transport: it has no start
frame, streaming transcript, protocol cancellation, or deadline propagation.

## Explicitly incomplete

- `invokeActivity`/`invokeManifestActivity` still use the old `(event,
  context)` handler ABI.
- Source activities without externals still run in process; external-bearing
  source and embedded activities still use private worker `exec` messages.
- The worker still uses unversioned `exec`/`rpc` messages and raw stdout/stderr
  forwarding. It is not yet the forced-termination Protocol v1 boundary.
- Managed effects currently fail honestly as unavailable unless the adapter is
  supplied a host effect handler; no generic resource-method broker should be
  introduced.
- The gRPC Lambda envelope is a strict revision/value improvement, not a
  versioned attempt transcript.
- No append-only execution ledger, projection rebuild, coordinator lease,
  recovery scan, or uncertain-work reconciliation exists yet.
- The hosted Linux SEA proof remains blocked by the separately unapproved
  clean-install parser declaration repair.

## Suggested next slice

Compile a private Protocol v1 attempt symbol into every function bundle, while
retaining the existing raw symbol temporarily for legacy Lambda/ActorSystem
paths. Add `Function` APIs that execute and revalidate that private attempt
symbol; route source and embedded manifest invocation through an
`invokeManifestActivityAttempt` helper that allocates ephemeral identities,
binds the prepared/embedded revision, and unwraps only a `completed` terminal.
Then convert the worker and gRPC transport to actual protocol frames.

Do not fake managed effects with the existing arbitrary resource RPC bridge;
that would make replay guarantees look real before an effect catalog and ledger
exist.

## Verification recorded for this checkpoint

Node `24.13.1`, npm `11.12.0`:

- `npm run typecheck` passed.
- Focused protocol/attempt/JSON/packaged-Lambda tests passed: 4 suites,
  146 tests.
- Focused real loopback Lambda tests passed outside the sandbox: 3 suites,
  52 tests.
- The attempt adapter suite passed 35 tests, including adversarial caught
  protocol errors, late output, delivery prefix failure, hanging callbacks,
  cooperative deadline, in-flight effect cancellation, and hostile
  cancellation reason cases.

Before committing or extending this milestone, run:

```bash
git status --short --branch
git diff --check
. "$HOME/.nvm/nvm.sh"
nvm use 24.13.1
npm run typecheck
npm run lint
npm run test
npm run verify:package
```

Run `npm run verify:package:sea` outside the sandbox when its ordinary
filesystem/process/network requirements are available.
