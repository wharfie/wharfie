# 0023 — Verified sensitive activity-log disclosure

**Status:** Accepted · **Date:** 2026-07-27

## Context

ADR 0022 makes durable retention a prerequisite for positively acknowledging
an activity log. It deliberately adds no reader. Log messages and structured
fields are arbitrary application-controlled data: they can contain credentials,
personal information, terminal control characters, or other content that the
ordinary redacted run inspection surface must never expose accidentally.

Wharfie's purpose also requires useful work to remain understandable after the
authoring session ends. Retaining logs without a narrow way for the local
operator to inspect them leaves that part of the durable truth inaccessible.
A first reader therefore needs an explicit disclosure decision, complete
integrity verification, stable pagination, and source/packaged parity without
claiming that logs authorize execution state.

## Decision

### Configured store access and exact application scope authorize the read

The first log reader is a locally invoked CLI only: Wharfie exposes no served
log API and does not route the read through a resident owner socket. It uses
the ambient configured control adapter and local payload store. Local adapters
rely on operating-system store access; a configured provider-backed adapter
also relies on that provider's ordinary credential and IAM authorization.
Exact application, run, and physical-attempt scope remains a defense against
accidental cross-application disclosure, not a replacement for store access
control.

Source mode requires the operator to provide the application logical ID
directly. It does not load or execute current application source: historical
logs remain inspectable if the authored directory has moved or disappeared.
Packaged mode binds the application ID to the executable's embedded immutable
identity and accepts no application override. Both modes require the exact
persisted run and attempt IDs.

The command additionally requires an explicit sensitive-output confirmation
before resolving identity or opening storage. That confirmation records
disclosure intent; it is not authentication and grants no store or provider
access.

The initial surfaces are:

```text
wharfie ops logs --app-id <app-id> --run-id <run-id> --attempt-id <attempt-id> --confirm-sensitive-output [--limit <1..100>] [--cursor <opaque>] [--json]
<app> wharfie logs --run-id <run-id> --attempt-id <attempt-id> --confirm-sensitive-output [--limit <1..100>] [--cursor <opaque>] [--json]
```

### The reader derives private attempt authority from verified history

Callers never provide a fencing token, coordinator epoch, generation,
invocation, activity, revision, auxiliary partition ID, entry ID, hash, or
payload reference.

The ledger fully rebuilds and verifies the requested run, checks its application
scope, locates the exact historical attempt and invocation, and derives the
private auxiliary-log scope from the retained attempt projection. A missing
run, cross-application request, or missing attempt is not an empty log. An
existing attempt with no retained logs has an honest empty page. Retained logs
for an attempt that never crossed `STARTED` are corruption.

Before returning any item, each read obtains a stable bounded auxiliary
head/query/head observation and verifies the complete retained hash chain,
sparse sequence order, entry count, cumulative byte count, head tip, every
content-addressed payload, and every Activity Protocol frame. Any mismatch
fails the complete page. No partial verified prefix is emitted.

### Pages freeze one verified prefix

Pages are ascending by attempt-local Activity Protocol sequence. The first page
freezes the complete verified prefix observed by that request. A continuation
reads and verifies the current complete chain again, proves that the captured
prefix coordinates still match in count, last sequence, cumulative bytes, and
page boundary, and ignores valid entries appended after that prefix. A fresh
request without a cursor can observe a later prefix.

The default page size is 50 and the maximum is 100. The existing attempt limits
remain 256 entries, 8 MiB of canonical log frames, and 1 MiB per protocol
frame.

The opaque cursor is canonical base64url JSON of at most 4096 bytes. It contains
only its schema version, the non-secret application/revision/run/invocation/
activity/attempt/generation/epoch scope, frozen prefix count/last sequence/byte
count, next array index, and preceding protocol sequence. It contains no raw
fence, fence-derived partition ID, entry/content hash, payload identity,
message, or field value. It is revalidated against verified retained state on
every use. A cursor is pagination state, not authorization, authority, a
signature, or a durable read receipt.

This freeze inherits the execution ledger's trusted append-only writer model.
The cursor is not a content commitment and cannot authenticate against an
administrator replacing the whole prefix with a different, internally
self-consistent chain that has the same published coordinates.

### Public output is explicitly raw and non-authoritative

Machine-readable output uses schema-v1 kind
`wharfie.execution-ledger.activity-log-page` and states:

- `authority: "none"` and `authoritative: false`;
- `disclosure: "application-sensitive-unredacted"`;
- verified integrity;
- the non-secret exact attempt scope;
- the frozen entry-count, cumulative-byte, and last-sequence snapshot;
- ordered items containing sequence, host acceptance observation, level,
  message, and fields; and
- the nullable next cursor.

Outside the raw application message and fields—which may themselves contain
any secret or internal-looking value—the page adds no Wharfie-owned fence,
auxiliary partition key, entry/hash identity, payload reference, storage path,
or lifecycle/effect evidence.

JSON output preserves the raw application message and fields when parsed.
Serialized JSON and human output escape terminal controls and Unicode
control/format characters before writing; human rows otherwise use only
sequence, acceptance time, level, and JSON-rendered message/fields. The
complete page is verified and rendered before the first row is handed to the
output port.

Verification, scope, cursor, or rendering failure produces one fixed redacted
error and no page rows. A process or output stream can still fail after bytes
begin leaving the process, so Wharfie makes no atomic-display or exactly-once
display claim.

### The first reader is historical inspection, not observability infrastructure

This decision adds no follow/tail polling, global or cross-attempt order,
search, filtering, aggregation, secret scanning, redaction guarantee, export
file, remote API, web UI, encryption change, retention/garbage collection, or
read receipt. Re-running a fresh first page is the only way to observe logs
appended after a frozen page sequence.

Retained logs remain diagnostic evidence. They grant no lifecycle, scheduling,
terminal, reconciliation, managed-effect, or exactly-once execution authority.
Acceptance timestamps are host observations and need not be monotonic.

## Consequences

- A local operator can follow durable work even after the application source
  directory or original coding session disappears.
- Packaged and source commands disclose the same verified schema without
  allowing a packaged executable to inspect another application.
- A continuation is stable while an active attempt appends later logs.
- Every page re-verifies the bounded complete chain, favoring fail-closed
  disclosure over high-throughput log serving.
- Raw secrets can be printed only after an explicit command-line disclosure
  confirmation, but operating-system store access and, where configured,
  provider credentials/IAM remain the actual authorization boundaries.
- Public run inspection remains redacted; sensitive log disclosure stays on a
  separate named command and schema.

## Rejected alternatives

### Add raw logs to ordinary run inspection

Rejected because a command documented as redacted must not begin emitting
arbitrary application-controlled values.

### Infer the application from the run ID alone

Rejected because exact application scope is a cheap defense against accidental
cross-application disclosure in a shared local control store.

### Require current application source in source mode

Rejected because durable history should survive moved or deleted authoring
source and because inspection must not execute current app code.

### Let continuations include newly appended entries

Rejected for the first reader because page membership would change during one
walk and blur historical inspection into undocumented tail semantics.

### Put content or fence-derived hashes in the cursor

Rejected because the cursor needs only safe scope and verified prefix
coordinates. Reversible low-entropy content or fence-derived identifiers add
an unnecessary oracle and public storage detail.

### Redact fields heuristically

Rejected because Wharfie cannot infer which arbitrary application values are
safe. The initial contract is explicit raw disclosure or no disclosure.
