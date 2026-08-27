# Wharfie checkpoint — shared packaged durable-run host

- **Date:** 2026-07-18
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint:** [real-process managed-effect crash matrix](2026-07-18-real-process-managed-effect-crash-matrix.md)
- **Parent remote tip before this milestone:**
  `68283d381185015103bee6d9746b4d3c3e8f9fdd`
- **Implementation commit:**
  `45cdf95a8da1eb33828e184bfaeb0e41405a2520`
- **Checkpoint receipt commit:** resolve with
  `git log -1 --format=%H -- llm/checkpoints/2026-07-18-shared-packaged-durable-run-host.md`
- **Scope:** make source and packaged foreground durable activities use one
  host/state model, then prove that the relocated SEA itself can originate and
  exactly replay a managed-effect run with Node absent

This is an immutable handoff. Update the live roadmap or add a later dated
checkpoint instead of rewriting it after publication. Wharfie still has no
known downstream users: breaking changes and fresh durable namespaces remain
acceptable when they shorten the path to the intended design. V1 and
V1-through-V6 execution compatibility remain abandoned.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-18-shared-packaged-durable-run-host.md`. Read
> `PROJECT.md`, `ROADMAP.md`, ADRs 0001 through 0016, and this checkpoint before
> changing durable execution. Verify implementation commit
> `45cdf95a8da1eb33828e184bfaeb0e41405a2520` and this checkpoint receipt on
> `origin/agent/strict-manifest`, refresh draft PR #125 and issue #129, and use
> exact Node 24.13.1. Source `wharfie ops run` and packaged `<app> wharfie run`
> now share one V7 durable host; the moved SEA completes and exactly replays one
> managed application-state effect with Node absent. Do not call this complete
> packaged crash parity: next repeat the full request/start/destination/outcome/
> aggregate-settlement/response `SIGKILL` matrix through the actual moved SEA.
> Never split the application-state business mutation from its permanent
> receipt, never redispatch retained stopped-attempt work, and claim
> exactly-once only where a destination atomically enforces the stable effect
> identity with its business mutation.

## Product boundary retained

The project still aims to carry intent beyond a local coding session: author a
normal TypeScript CLI, package it as one approachable executable, promote it to
a durable resident service, and later place work across trusted machines
without requiring Node, containers, Kubernetes, or a hosted orchestration
service on the target.

This milestone adds one foreground durable execution surface to the packaged
artifact. It does not add a resident scheduler, workflow continuations,
automatic recovery or retry, coordinator leases, multi-host routing, provider
fulfillment, compensation, or a broader effect catalog. The private
`ledger-service` remains lifecycle-only.

Wharfie continues to promise one authoritative logical terminal, not one
physical handler execution. Arbitrary activity code and unmanaged SDK calls
remain at-least-once or ambiguous. The built-in `application-state` /
`put-if-absent` operation supports its narrow exactly-once-at-destination
statement only because one LMDB transaction commits the stable destination
effect ID, business value, and permanent receipt.

## Shared durable host

`src/core/runtime/durable-activity-host.js` now owns the composition that was
previously embedded in the source Commander action:

1. validate and snapshot the source or embedded execution descriptor before
   opening durable state;
2. derive app, revision, activity, and V7 run identity only from that descriptor
   and the stable idempotency key;
3. snapshot control, payload, session, and application-state routing;
4. acquire the app-scoped local mutation owner and authenticated exact-run
   cancellation endpoint;
5. create/claim/start through `runManualLedgerActivity`;
6. open isolated LMDB application state only for a newly dispatchable claim;
7. initialize the finite managed-effect catalog only after durable `STARTED`;
8. dispatch the exact host start frame through
   `invokeManifestActivityAttemptWithStart`; and
9. close application state and the command endpoint before releasing ownership
   and the control store.

The exported lower `runDurableManifestActivity` seam accepts an already-open
ledger and control context, so a future resident owner can reuse the same
kernel without reacquiring its own long-lived ownership. The current
`runLocalDurableManifestActivity` wrapper remains the only foreground adapter.

`resolveManifestActivityExecutionBinding` cross-checks and normalizes both
execution forms before mutation. Prepared source retains its sealed revision,
dependency lock, runtime verifier, and cleanup handle. Packaged execution
retains only the validated embedded manifest and revision/runtime pair. No
packaged option accepts an app directory, source manifest, revision, run ID,
attempt, fence, adapter, or destination override.

All caller JSON, actor authority, cancellation signal, and injected
application-state configuration are validated before the host can open or own
control state. Cleanup preserves both a primary run error and a command-server
close error rather than allowing one to erase the other.

## Shared command and packaged dispatch

`createDurableRunCommand` owns the common `run` options, JSON parsing, stable or
generated idempotency key, redacted row, foreground signal handling, and
cleanup. The installed CLI mounts it as `wharfie ops run --dir ...`; the
packaged operator mounts it as `<app> wharfie run` without `--dir`. A packaged
run uses actor `{kind: "packaged-operator", id: <embedded revision>}` for the
manual lifecycle. Managed-effect events retain the more precise host actor
`{kind: "runtime", id: "managed-effect"}`.

The generated SEA bootstrap now passes an authored-CLI loader instead of
evaluating it eagerly. Hidden runtime and reserved operator dispatch complete
their selection before authored CLI top-level code can run. Ordinary developer
argv still loads the module once and preserves its existing argv/stdin/stdout/
stderr/exit semantics.

Both command forms support `--json`. A successful row contains only
`idempotency_key`, `run_id`, `revision`, `activity`, `status`,
`invocation_status`, `attempt_generation`, and `attempt_status`. Request input,
caller metadata, effect contents, activity output, and terminal evidence remain
in immutable referenced payloads and are not printed.

## Relocated SEA proof

The installed-package verifier now packages `persist-once`, an authored
TypeScript activity that requests `application-state` / `put-if-absent` and
returns only after the framed effect result reaches user code. It moves the SEA
to a clean directory, supplies LMDB control/application roots, removes Node from
`PATH`, and invokes:

```text
<app> wharfie activity run --activity persist-once \
  --idempotency-key packaged-durable-managed-effect \
  --input <json> --caller-metadata <json> --json
```

The proof establishes:

- the redacted row names the derived V7 run and exact embedded revision;
- the retained run has one invocation, one completed physical attempt, one
  completed effect, and exactly seven lifecycle/effect events;
- the effect requested and substantiated `idempotent` and `transactional`;
- the permanent application-state receipt names the same destination effect;
- immutable terminal evidence proves `continuedAfterEffectDelivery: true`;
- manual events use packaged revision authority while effect events use runtime
  managed-effect authority; and
- repeating the exact command/key returns the byte-identical row while the
  complete run, attempt, effect, evidence, event history, business receipt, and
  ownership state remain unchanged.

The artifact then continues through the existing packaged inspect, recover,
reconcile, cancellation, mixed-effect settlement, response-loss `SIGKILL`, and
resident lifecycle crash/restart proofs.

## Verification status

All final local gates passed under exact Node 24.13.1 with npm 11.12.0:

- **Focused shared-host/command/source regressions:** the new preflight and
  command suites plus the full source `ops run`, foreground cancellation,
  packaged dispatch, activity binding, and package-construction selections
  passed.
- **Complete Jest gate:** 75 suites and all 981 enabled tests passed; one
  opt-in suite/test remained skipped (76 suites / 982 tests total).
- **Static gates:** repository lint/format, TypeScript checking, verifier
  syntax, and `git diff --check` passed.
- **Package-content verification:** all 120 expected files passed.
- **Installed exact-tree tarball and relocated SEA:** passed end to end with
  locked LMDB and Node absent from `PATH`, including SEA-originated durable
  managed-effect execution, exact replay, packaged operator recovery response
  loss, and resident crash/restart. The moved Darwin artifact was 141,653,712
  bytes.
- **Package metadata:** `package.json` and the lockfile were intentionally
  untouched; the known direct parser declaration remains pending explicit user
  approval.
- **Publication check:** after pushing the implementation and checkpoint
  commits, require
  `git rev-list --left-right --count HEAD...origin/agent/strict-manifest` to
  print `0 0`.

## Honest remaining boundary

The shared packaged host prerequisite is complete, but the prior seven
source/core activity crash cases have not yet been externally killed through
the actual moved SEA. The next slice must repeat request-payload publication,
request-ledger commit, effect `STARTED`, atomic destination business-and-receipt
commit, outcome-payload publication, outcome-ledger commit, and real framed
effect-result/user continuation boundaries. It must also repeat the three
mixed-set settlement boundaries from the packaged process where applicable.

Every case must kill and reap the actual SEA, restart through ordinary packaged
commands, verify stale ownership cleanup, payload reachability/orphan rules,
adapter-entry counts, exact business/receipt state, no conflicting terminal,
no redispatch, and idempotent second recovery. Test-only boundary observation
must not become an ambient production crash hook or weaken the immutable
artifact/revision binding.

After packaged crash parity, design destination-specific reconciliation and
compensation for retained `UNCERTAIN` effects before enabling automatic retry.
A retry or compensation must be new causally linked append-only work; it must
not reopen settled V7 history.
