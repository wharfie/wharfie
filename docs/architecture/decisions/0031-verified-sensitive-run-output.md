# 0031 — Verified sensitive durable run-output disclosure

**Status:** Accepted · **Date:** 2026-07-27

## Context

The redacted run-history and exact-run inspection surfaces expose durable
lifecycle state without application inputs, workflow values, or terminal
results. ADR 0023 separately permits an explicitly confirmed operator to read
one physical attempt's raw retained logs. Neither surface answers the simpler
logical question: what values has this durable run produced, and what was its
final result or error?

Those values may contain credentials, personal information, terminal control
characters, or any other application-controlled data. They also live behind
private content-addressed payload references and, for failed activities,
verified terminal evidence. A public reader must therefore rebuild and rehash
the durable run, project only logical values, require deliberate disclosure,
and fail before output if the complete snapshot cannot be verified and
rendered safely.

## Decision

### Add one explicitly confirmed logical snapshot

The local-only source and packaged surfaces are:

```text
wharfie ops output --app-id <app-id> --run-id <run-id> --confirm-sensitive-output [--json]
<app> wharfie output --run-id <run-id> --confirm-sensitive-output [--json]
```

Source mode takes the exact application ID directly and does not load or
execute current application source. Packaged mode resolves only the
executable's embedded application identity and accepts no application
override. It may inspect an older persisted revision of that same logical
application; the result reports the revision retained by the run.

Both modes require `--confirm-sensitive-output` before packaged identity
resolution or storage access. The flag records disclosure consent. It is not
authentication and grants no filesystem, control-store, payload-store,
provider, scheduling, cancellation, reconciliation, or execution authority.
Those access decisions remain with the operating system and configured storage
provider.

The reader opens existing control and payload storage read-only. If the local
store has never been created, the command returns the fixed safe failure
without creating either directory.

### Publish one strict schema-version 1 document

Machine output is exactly one
`wharfie.execution-ledger.run-output` document:

```json
{
  "schemaVersion": 1,
  "kind": "wharfie.execution-ledger.run-output",
  "authority": "none",
  "authoritative": false,
  "disclosure": "application-sensitive-unredacted",
  "integrity": { "verified": true },
  "scope": {
    "appId": "example-app",
    "revisionId": "wrv1_...",
    "runId": "run-id"
  },
  "snapshot": {
    "runKind": "workflow",
    "status": "RUNNING",
    "version": 7,
    "lastSequence": 12
  },
  "outputs": [
    {
      "stepId": "fetch",
      "stepIndex": 0,
      "value": { "secret": "unredacted" }
    }
  ],
  "terminal": null
}
```

The document is non-authoritative and grants no authority.

`runKind` is `manual`, `workflow`, or `effect-successor`. Every snapshot has an
`outputs` array. Only workflow snapshots may have non-empty outputs; the other
kinds contain an empty array. Workflow entries form the complete verified,
zero-indexed cursor prefix in step order, with unique step IDs. Timer and signal
values are included like activity values once they become retained workflow
outputs.

`terminal` is `null` while the aggregate is `RUNNING` or `BLOCKED`. A terminal
aggregate contains either `{type: "completed", result}` or
`{type, error}`. Activity result and error values come from reverified Activity
Protocol evidence. A completed workflow repeats its final output as the
aggregate result. A cancelled run exposes the exact structured reason from its
durable cancellation request, including when later physical settlement
contains different transport evidence. An effect-successor exposes its
reverified managed-effect outcome; a verified `NOT_APPLIED` disposition has a
fixed framework error because no application outcome exists.

The aggregate/terminal matrix is exact: only `COMPLETED` accepts a
`completed` terminal; manual and workflow `FAILED` accept `failed` or
`protocol-failed`; `CANCELLED` accepts `cancelled`; and effect-successor
failure accepts only `failed`. `deadline-exceeded` is rejected and remains
unsupported by this disclosure surface.

The polling `version` and `lastSequence` describe this exact rebuilt
projection. A caller observes later progress by running the command again.
There is no cursor, follow mode, watch stream, or read receipt.

### Verify private evidence and project by allowlist

The ledger fully folds and verifies the requested run, checks its application
scope, creates one fresh immutable payload reader, and rehashes every workflow
output reachable from the retained cursor. Terminal activity evidence and
managed-effect outcomes are rehashed and checked against their retained
summaries. Missing, cross-application, corrupt, internally inconsistent, or
oversized state fails the complete read.

The private ledger reader returns only scope, polling state, logical outputs,
and the nullable logical terminal. The command boundary validates that exact
shape again, enforces cross-field invariants, constructs an independent
allowlisted envelope, bounds the whole encoded document to 64 MiB, and
recursively freezes it. Outside raw application-controlled values—which may
themselves contain any secret or internal-looking value—Wharfie adds no private
framework metadata: no request, caller metadata, payload reference, digest,
evidence, transcript, fence, coordinator epoch, generation, attempt or
invocation identity, actor, auxiliary key, or storage path crosses the
boundary.

The size limit is for one complete v1 snapshot. A workflow whose full output
prefix and repeated final result do not fit receives the fixed safe failure.
Paging or exporting logical values requires a later versioned contract.

### Render the entire snapshot before output

JSON preserves exact application values when parsed, while its serialized form
escapes terminal control and Unicode control/format characters. Human rows
render every scope, polling, step identity, value, and terminal as
terminal-inert JSON text.

The complete document is validated, bounded, frozen, and rendered before the
first output-port call. Any read, verification, projection, bound, or rendering
failure emits one fixed redacted diagnostic and no snapshot rows. The process
or output stream may still fail after bytes begin leaving the process, so this
surface makes no atomic-display or exactly-once-display claim.

### Keep redacted inspection unchanged

Ordinary `inspect`, run listing, durable-operation receipts, recovery, and
reconciliation remain redacted. The new command is the only logical
run-output disclosure and must be named and confirmed explicitly. It adds no
remote API, resident RPC, web UI, secret scanning, heuristic redaction,
cross-run query, search, tail, export file, retention change, or stronger
exactly-once execution guarantee.

## Consequences

- A local operator or coding agent can recover durable logical results after
  the authored directory or chat session disappears.
- Source and packaged programs share one schema while packaged identity stays
  bound to the executable.
- Partial workflow progress is observable as a stable verified prefix, and
  aggregate completion has an explicit logical terminal.
- Raw application secrets can be printed only after deliberate confirmation,
  but ambient store access remains the real authorization boundary.
- Polling observes progress, but a snapshot larger than 64 MiB fails every
  read; retrieving it requires a future paged or export contract.

## Rejected alternatives

### Add values to redacted `inspect`

Rejected because a broadly useful lifecycle surface must not begin leaking
arbitrary application-controlled values.

### Return payload or evidence references

Rejected because those are private storage and integrity mechanics, not
portable application results, and would create an unnecessary disclosure
oracle.

### Read only the current or terminal value

Rejected because a durable workflow's completed prefix is the useful logical
history for understanding and continuing work after an authoring session.

### Claim exactly-once result delivery

Rejected because the command is an ordinary read and stdout is not a durable
acknowledgement protocol. Repeated polling may display the same values again.
