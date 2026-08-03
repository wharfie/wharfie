# V88 durable attempt logs checkpoint

- **Date:** 2026-07-27
- **Status:** **COMMITTED, PUSHED, AND LOCALLY VERIFIED; NO PUBLIC READER,
  FULL-SUITE, OR PRODUCTION CLAIM**
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint commit:**
  `391111e04fb04dba301a62646578eb2ca55972df`
- **V88 transport commit:**
  `cc75ae64f8472ea0d49eb0aeed742d6cd3899c59`
- **V88 storage commit:**
  `170a4cdd662c51268ad33dc109a36cea53af75fe`
- **V88 runtime-wiring commit:**
  `fd01e955f0f0bf1fc647869eeda688228ac4e50b`
- **Remote implementation tip before this checkpoint:**
  `fd01e955f0f0bf1fc647869eeda688228ac4e50b`
- **Parent checkpoint:** [V87 Jest 30 alignment](./2026-07-27-v87-jest-30-alignment.md)

## Restart summary

Wharfie's golden path remains a normal TypeScript/Node CLI that becomes one
approachable portable executable, runs locally or remains resident as a
durable service, and coordinates work across trusted machines without
requiring Node, containers, Kubernetes, or a hosted orchestration service on
the target machines.

The product exists to carry useful software beyond the coding session that
created it. It should preserve executable behavior and legible durable truth
so a person or later coding session can follow, recover, and evolve that work.

The settled project boundaries remain:

- nodes are trusted;
- one authoritative coordinator is acceptable initially when its durable
  authority is fenced and recoverable after coordinator loss;
- V1 and backward compatibility are abandoned;
- Wharfie is not general cloud IaC;
- finite Wharfie abstractions may use normal operator credentials to create
  only the resources they require;
- TypeScript/Node is the public authoring path, while measured Node-API, WASM,
  or other native hot paths remain possible behind versioned boundaries;
- exactly-once claims are made only where durable evidence and the managed
  destination's atomic effect semantics support them; and
- one executable and a machine-readable CLI remain the primary operator
  surface; a web UI is optional and later.

The standing working mode is local repository and Git CLI work rather than
PR/issue churn. Breaking changes are acceptable. Focused commits and pushes
are authorized. Use exact Node 24.13.1 and npm 11.12.0. Tests must remain
proportionate, disposable, and cleaned immediately. Never run native LMDB,
native SEA creation on this Mac, or block-device tools locally. Docker, live
AWS, disposable hosts/EBS, formatting, and other external mutation require
explicit approval.

V86 made ordinary Jest execution coverage-free and disposable. V87 aligned
the Jest runtime, imported globals, and test types on major 30. V88 returns to
the product path: a log that a durable activity is told the host accepted is
now retained under that exact physical attempt before the transport sends a
positive acknowledgement.

## What V88 closes

### Component acknowledgement waits for the host sink

Commit `cc75ae64f8472ea0d49eb0aeed742d6cd3899c59` carries the optional ordered
component-frame sink through the worker's direct and prepared execution paths
and the app runtime's source, embedded, and external-bearing dispatch seams.
The later runtime-wiring commit connects the durable manual, workflow, and
resident hosts.

The worker transport permits one component delivery to await settlement. It:

- positively acknowledges only after the selected sink resolves;
- negatively acknowledges and fails the physical attempt when the sink
  rejects;
- does not begin a managed effect before its effect-request sink barrier
  settles;
- suppresses effect dispatch when cancellation or a deadline wins that race;
- fails closed if another component frame overtakes the pending delivery; and
- makes settlement after worker cleanup inert.

Callers without a sink retain the synchronous in-memory behavior needed by
non-durable execution. This commit changes transport ordering; it does not by
itself make a frame durable.

### One bounded fenced append belongs to one physical attempt

Commit `170a4cdd662c51268ad33dc109a36cea53af75fe` accepts a validated Activity
Protocol v1 `log` frame only under the exact application, revision, activity,
run, invocation, physical attempt, generation, coordinator epoch, and fencing
token that durably reached `STARTED`.

ADR 0022 records the contract. The implementation derives one fixed-length,
domain-separated auxiliary partition identity from the complete scope. The
raw fencing token influences that identity but is not duplicated into the
auxiliary records.

The auxiliary partition contains:

- one conditional head with the non-secret scope, last log sequence, entry
  count, cumulative canonical payload bytes, and local version; and
- immutable sparse sequence entries containing the scope, protocol sequence
  and level, acceptance time, content-addressed payload reference, previous
  entry identity, and content-derived entry identity.

The normal run partition is not changed by a log append. Its head, lifecycle
version, event sequence, projections, ready-work locator, and logical outcome
remain the authority for execution state.

Before a positive result, the append publishes the canonical frame, rereads
and re-hashes it, then uses one three-item transaction to:

1. condition-check the exact ordinary attempt projection as `STARTED`,
   including its revision, invocation, attempt, generation, epoch, fence, and
   version;
2. put the immutable log entry; and
3. create or exactly advance the auxiliary head.

The implementation obtains a stable strong head/query/head snapshot and
validates every retained entry, hash link, sparse sequence, payload reference,
canonical payload, byte total, count, and head tip before an append or replay.
Missing intermediate rows and corrupt retained bytes therefore fail closed.

An exact same-sequence replay is checked before current lifecycle state. It can
return idempotent success after the attempt became terminal, which closes the
ordinary transaction-response-loss case. Reusing a sequence for different
content, submitting a new out-of-order sequence, losing the exact fence, or
encountering a corrupt partition is refused.

Each physical attempt is limited to:

```text
log entries:             256
canonical log bytes:     8 MiB
single protocol frame:   1 MiB
```

Crossing a limit rejects the append. There is no silent truncation, eviction,
sampling, or retention-time claim.

### Durable runners select the append before acknowledgement

Commit `fd01e955f0f0bf1fc647869eeda688228ac4e50b` constructs a host-owned sink
only after manual or workflow execution wins durable `STARTED`. The sink
snapshots the exact returned attempt authority and awaits
`appendActivityAttemptLog` for each log frame.

The durable activity and workflow hosts forward that runner-owned sink through
the manifest activity runtime. Non-log component frames remain ordering
barriers but are not copied into the auxiliary log store. Terminal evidence
continues through the existing authoritative manual/workflow terminal
transactions rather than becoming a log record.

No package export, authored manifest field, public host option, reader, or CLI
surface was added.

## Independent review

The storage review found no remaining correctness or safety blocker after the
append was strengthened to verify a stable complete chain and every retained
payload. It specifically checked response-loss replay, terminal and fence
races, sparse ordering, limits, DynamoDB pagination, aliased transaction
conditions, distinct transaction items, and raw-fence exclusion.

The runtime review found no production wiring blocker. It traced both runner
paths from exact `STARTED` authority through the durable hosts and every
embedded/direct/prepared/external app-runtime branch, and confirmed that
terminal persistence remains separate.

The main nonblocking cost is deliberate: one append or replay performs an
O(number of retained entries) full-chain read and payload verification. Across
a full attempt this can become quadratic work, although the 256-entry/8 MiB
limits keep it finite. This is a correctness-first initial implementation, not
a final high-throughput log index.

## Verification completed

All validation used:

```text
/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node
Node 24.13.1
npm 11.12.0
```

Completed checks:

- targeted Prettier verification;
- targeted ESLint with zero allowed warnings;
- `git diff --check`;
- `tsc -p tsconfig.json --noEmit`;
- `tsc -p tsconfig.app-implementation.json --noEmit`;
- `tsc -p tsconfig.test.json --noEmit`;
- `tsc -p tsconfig.sea-verifier.json --noEmit`; and
- nine focused, coverage-free, cache-disabled Jest suites with 152 passing
  tests.

Those suites cover the pure attempt-log contract, vanilla-store integration,
missing-middle corruption, a terminalization race, post-commit response loss,
the durable sink, manual/workflow runners, and direct/prepared/external worker
transport. After test-only type/style cleanup, the two affected suites were
rerun with 48 passing tests.

The final consolidated Jest runs used exact owned `/private/tmp/wharfie-*`
parents. The runner removed its inner cache/coverage root automatically; both
final parents measured 0 B afterward and were removed immediately. An earlier
focused storage root peaked at about 1.9 MiB and was also removed. No owned
temporary root, repository coverage directory, or repository Jest cache
remained.

No full suite, coverage-threshold run, native LMDB operation, native SEA
creation, native build, Docker operation, AWS call, block-device operation, or
live external-resource action occurred.

## Honest boundaries

V88 makes retained append authority a prerequisite for a positive durable log
acknowledgement, but:

- it does not claim exactly-once activity execution, log emission, operator
  display, or unmanaged external effects;
- raw log messages and fields are application-controlled sensitive data, and
  no authorization, reader, tail, search, rendering, redaction, export, or new
  encryption contract exists yet;
- content-addressed payloads published before a losing transaction may remain
  unreferenced until a later garbage-collection contract exists;
- the current sink does not retry an ambiguous append rejection, so a
  committed log can still lead to conservative physical-attempt failure until
  an exact caller retry is added;
- direct internal/test executor seams can ignore their supplied sink; the
  production durable hosts do not;
- dedicated tests do not yet guard each durable-host-to-app-runtime forwarding
  bridge independently;
- full-chain verification favors fail-closed recovery over high-throughput
  logging near the retained limits;
- no public log reader or end-to-end packaged log-inspection proof exists; and
- no full-suite or production deployment claim is made.

The unresolved V87 local exit 134 remains outside this passing matrix. The
historical stash remains unrelated and untouched.

## Next safe work — V89

The next product slice should let an operator follow retained work without
weakening its sensitive-data boundary.

First add focused guards for both durable-host forwarding bridges and consider
one bounded exact append retry for transaction response loss. Then define and
implement a verified, bounded historical log-page contract before exposing
raw payloads. It should:

- require an exact app/run/attempt scope and explicit local operator authority;
- verify the complete retained partition and every payload before returning
  data;
- use bounded pages and scope-bound opaque cursors;
- label diagnostic logs as sensitive, non-authoritative execution evidence;
- define corruption, authorization, disclosure, and rendering failures
  explicitly;
- preserve source and packaged operator-command parity; and
- avoid promising live tail, search, global ordering, redaction, or
  exactly-once display in the first reader.

Keep tests coverage-free, cache-disposable, proportionate, and immediately
cleaned. Do not use the unresolved operations-command-errors suite as an
implicit local gate. V84's Docker proof and all live AWS/EBS or block-device
work remain separate approval-only experiments.

## Repository state and resume instructions

The V88 implementation tip is:

```text
fd01e955f0f0bf1fc647869eeda688228ac4e50b
```

It was pushed to `origin/agent/strict-manifest`. Immediately before this
checkpoint was written, local HEAD and that remote branch both resolved to
that commit. The commit containing this file and the synchronized lineage
documents is the V88 restart marker.

The historical stash remains untouched:

```text
stash@{0}: WIP on master: 3dee66b work prompt
```

Resume from the V88 checkpoint commit on `agent/strict-manifest`. Verify that
local HEAD equals the remote branch before new work. Preserve exact Node
24.13.1/npm 11.12.0, disposable coverage-free ordinary tests, explicit
coverage runs, immediate disk cleanup, local Git CLI focus, and the approval
boundaries above.
