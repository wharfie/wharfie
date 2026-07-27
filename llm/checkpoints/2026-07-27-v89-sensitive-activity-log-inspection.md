# V89 sensitive activity-log inspection checkpoint

- **Date:** 2026-07-27
- **Status:** **COMMITTED, PUSHED, AND LOCALLY VERIFIED; RAW LOGS REMAIN
  SENSITIVE; NO FULL-SUITE OR PRODUCTION CLAIM**
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint commit:**
  `ee43362f796698c2e346cdef3633d028e7fa2d8d`
- **Forwarding/exact-retry commit:**
  `f137c10bfc1bd7556d3fb387efb4ed613395a782`
- **Ambiguous-abort retry correction:**
  `cef735b32a465e7cd223de08c460afa2d43d76ad`
- **Retry test typing correction:**
  `3d9711e19411c1f2f6f3809a650de6578b36486c`
- **Verified page-reader commit:**
  `6cd177aa71ae45b2a09bae6688f12d5a0627d831`
- **Source/packaged CLI and disclosure commit:**
  `68a72ab88ca1ba40cc743bc5e54a85ee77d930c0`
- **Remote implementation tip before this checkpoint:**
  `68a72ab88ca1ba40cc743bc5e54a85ee77d930c0`
- **Parent checkpoint:** [V88 durable attempt logs](./2026-07-27-v88-durable-attempt-logs.md)

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

V88 made durable retention a prerequisite for positively acknowledging a log
frame but intentionally exposed no reader. V89 adds a narrow historical read
path so a person or later coding session can inspect the raw retained evidence
for one exact physical attempt.

## What V89 closes

### Ambiguous append outcomes receive one exact replay

Commit `f137c10bfc1bd7556d3fb387efb4ed613395a782` adds independent guards for
the durable activity/workflow host forwarding seams and gives the durable log
sink one immediate exact replay after an unclassified operational rejection.
The second call uses the same frozen attempt scope and frame. Either a fresh
append or the storage layer's `applied:false` retained replay is success; a
second rejection propagates without a third attempt.

Typed input, budget, stale-fence, and retained-corruption errors remain
definitive. Commit `cef735b32a465e7cd223de08c460afa2d43d76ad`
corrects the taxonomy for generic provider errors named `AbortError` or coded
`ABORT_ERR`: the append API has no proven pre-dispatch cancellation contract,
so those errors can still represent “commit succeeded, response was lost.”
The exact replay is safe and is the only way to reconcile that ambiguity.
Late sink settlement remains transport-inert after attempt cleanup.

### The ledger exposes a verified frozen-prefix page

Commit `6cd177aa71ae45b2a09bae6688f12d5a0627d831` adds
`readActivityAttemptLogPage` without depending on a particular control-store
adapter.

One request contains only:

```text
application ID
run ID
physical attempt ID
page limit (default 50, maximum 100)
optional opaque cursor
```

The ledger rebuilds and verifies the complete run, checks the application,
finds one unique historical attempt, validates its invocation relationship,
and derives the private auxiliary-log scope and fence internally. Callers
never provide a fence, generation, epoch, revision, invocation, activity,
partition key, hash, or payload reference.

Before returning any item, the reader:

- obtains a bounded stable head/query/head observation;
- verifies the complete current auxiliary chain;
- checks entry count, sparse increasing sequence, previous-entry links,
  cumulative canonical payload bytes, and head tip;
- rereads and rehashes every referenced payload;
- validates every payload as the exact Activity Protocol log frame named by
  its entry; and
- refuses retained logs for an attempt that never reached `STARTED`.

A missing run, cross-application request, or missing attempt returns no page.
An existing attempt with no retained logs returns an explicit empty snapshot
whose `lastSequence` is `null`. Terminal attempts remain readable.

The first page freezes the fully verified prefix observed by that request.
Each continuation verifies the complete current chain again, proves the
captured prefix coordinates and page boundary still match, and ignores valid
later appends. Starting again without a cursor observes the newer prefix.

The cursor is canonical bounded base64url JSON containing only safe attempt
scope, frozen count/last-sequence/byte-count coordinates, the next array
index, and the preceding protocol sequence. It contains no Wharfie-owned
fence-derived partition, entry/content hash, payload identity, message, or
field value.

The page/cursor contract is exact-keyed, deeply frozen, aggregate-bounded, and
checked independently of the adapter. Integration tests use only the vanilla
store and prove frozen continuation after a later append, terminal reads,
read-only behavior, missing/cross-app scope, forged cursors, missing-middle
corruption, payload corruption, and never-started corruption.

### Source and packaged CLIs share one disclosure command

Commit `68a72ab88ca1ba40cc743bc5e54a85ee77d930c0` mounts:

```text
wharfie ops logs --app-id <app-id> --run-id <run-id> --attempt-id <attempt-id> --confirm-sensitive-output [--limit <1..100>] [--cursor <opaque>] [--json]
<app> wharfie logs --run-id <run-id> --attempt-id <attempt-id> --confirm-sensitive-output [--limit <1..100>] [--cursor <opaque>] [--json]
```

Source mode takes an exact app ID and never loads current application source.
Packaged mode lazily binds the embedded immutable app identity and exposes no
app override. Mandatory confirmation is checked before identity resolution or
storage access.

The command normalizes the complete raw page through the aggregate-bounded
page contract before output. It parses both incoming and outgoing cursors,
binds their safe scope and frozen snapshot, requires exact page membership,
prevents skipped/repeated/truncated pages, and requires a terminal page to
reach the snapshot's last sequence. A malformed reader cannot smuggle
arbitrary cursor text into an output still labelled verified.

Schema-v1 JSON kind
`wharfie.execution-ledger.activity-log-page` declares:

```text
authority: none
authoritative: false
disclosure: application-sensitive-unredacted
integrity.verified: true
```

Messages and fields preserve their raw values when JSON is parsed. Default
serialized JSON and human rows escape C0/C1, Unicode format, line/paragraph
separator, and surrogate control classes before writing to a terminal.
Verification and rendering complete before an output port receives a page or
row set. Any read, integrity, scope, cursor, or render failure produces one
fixed redacted error and no partial page.

The source CLI end-to-end test seeds real vanilla control/payload stores,
reads two pages through `bin/wharfie`, confirms an invalid authored app file is
never loaded, confirms raw secret-bearing values survive JSON, confirms the
fence is absent from Wharfie-owned metadata, and proves every durable byte is
unchanged. A missing read-only store produces only the fixed error and is not
created.

## Disclosure and authorization boundaries

Raw messages and fields are arbitrary application-controlled data. They can
contain credentials, personal data, storage paths, fences, hashes, payload
references, terminal-looking content, or any other value. The page adds no
Wharfie-owned private storage metadata outside those raw fields; it does not
redact or certify their contents.

`--confirm-sensitive-output` records disclosure intent. It is not
authentication. The first reader is a locally invoked CLI with no served log
API or resident-owner log socket. Local control/payload stores rely on
operating-system access. If the ambient configured control adapter is
provider-backed, that provider's ordinary credentials and IAM also authorize
the control read.

Cursor coordinates are pagination state, not authorization, a signature, or
a content commitment. Frozen pagination inherits Wharfie's trusted
append-only writer model. An administrator able to replace the entire prefix
with a different, internally self-consistent chain having the same public
coordinates is outside this cursor's integrity claim.

## Independent review

The storage review found no correctness blocker after the reader was required
to verify the current complete chain and all payloads before slicing a frozen
prefix.

The CLI/security review initially found:

- unparsed cursor output and insufficient page-position binding;
- terminal-active C1/Unicode format characters in default JSON serialization;
- documentation that could be read as redacting private-looking values inside
  raw app fields;
- an inaccurate OS-only authorization statement for configured provider
  adapters; and
- a terminal-page check that did not bind the final item to the frozen last
  sequence.

All were corrected before commit. Re-review found no remaining blocker after
the final snapshot-tip check.

The main nonblocking cost remains deliberate: each page performs
O(number-of-retained-entries) full-chain and payload verification. Walking
many small pages can therefore repeat bounded work. The 256-entry/8 MiB
attempt limits keep it finite; this is a correctness-first historical reader,
not a high-throughput log service.

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
- `tsc -p tsconfig.json`;
- `tsc -p tsconfig.app-implementation.json`;
- `tsc -p tsconfig.test.json`;
- `tsc -p tsconfig.sea-verifier.json`; and
- nine focused, coverage-free, cache-disabled Jest suites with 81 passing
  tests in the final consolidated run.

The final suites cover the page/cursor contract, vanilla reader integration,
the existing durable append path, sink retry taxonomy, shared command
validation and terminal-safe output, actual source CLI reads, source/packaged
mount parity, docs, and both durable-host forwarding bridges.

Every test run used an exact owned `/private/tmp/wharfie-v89-*` parent. Each
parent was measured and removed immediately. The final consolidated parent
measured 0 B before removal. No owned temporary root, repository coverage
directory, or repository Jest cache remained.

No full suite, coverage-threshold run, native LMDB operation, native SEA
creation, native build, Docker operation, AWS call, block-device operation, or
live external-resource action occurred.

## Honest boundaries

V89 makes retained logs inspectable, but:

- it does not claim exactly-once activity execution, log emission, operator
  display, or unmanaged external effects;
- confirmation is not authentication and raw values are deliberately
  unredacted;
- the reader has no follow/tail polling, search, filtering, aggregation,
  cross-attempt order, secret scanning, export, remote API, web UI, read
  receipt, retention, or garbage-collection contract;
- the cursor freezes page membership only under the trusted append-only writer
  assumption and is not a signature or content commitment;
- content-addressed payloads published before a losing transaction may remain
  unreferenced until a later garbage-collection contract exists;
- repeated full-chain verification favors fail-closed disclosure over
  high-throughput serving;
- a process or output stream can fail after bytes begin leaving the process,
  so atomic or exactly-once display is impossible;
- no full-suite or production deployment claim is made; and
- the unresolved V87 local exit 134 remains outside this passing matrix.

The historical stash remains unrelated and untouched.

## Next safe work — V90

Do not broaden the first log reader into an observability platform yet. The
larger remaining north-star gap is scheduled durable work: manual and
workflow-triggered runs already share the V10 ledger, while cron/scheduled
starts remain unsupported.

First replace the roadmap's vague “remaining operator surfaces” item with an
explicit inventory so absence is intentional and testable. Then design the
smallest schedule-trigger contract that:

- belongs to an immutable application revision;
- derives a stable scheduled occurrence identity and durable run request;
- enters the same existing run/invocation/attempt path as manual work;
- catches up or skips missed occurrences under an explicit bounded policy;
- permits only the current fenced coordinator/resident to claim one
  occurrence;
- exposes redacted schedule/occurrence state through source and packaged
  machine-readable commands; and
- makes no wall-clock exactly-once or multi-host failover claim before leases,
  heartbeats, and coordinator replacement exist.

Before implementation, audit the current public command inventory and resident
timer code so V90 reuses the V10 path rather than introducing another scheduler
or writable run model.

Keep tests coverage-free, cache-disposable, proportionate, and immediately
cleaned. V84's Docker proof and all live AWS/EBS or block-device work remain
separate approval-only experiments.

## Repository state and resume instructions

The V89 implementation tip is:

```text
68a72ab88ca1ba40cc743bc5e54a85ee77d930c0
```

It was pushed to `origin/agent/strict-manifest`. Immediately before this
checkpoint was written, local HEAD and that remote branch both resolved to
that commit, and the implementation worktree was clean. The commit containing
this file and the synchronized lineage documents is the V89 restart marker.

The historical stash remains untouched:

```text
stash@{0}: WIP on master: 3dee66b work prompt
```

Resume from the V89 checkpoint commit on `agent/strict-manifest`. Verify that
local HEAD equals the remote branch before new work. Preserve exact Node
24.13.1/npm 11.12.0, disposable coverage-free ordinary tests, explicit
coverage runs, immediate disk cleanup, local Git CLI focus, and the approval
boundaries above.
