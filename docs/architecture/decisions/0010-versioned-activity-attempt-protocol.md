# 0010 — Versioned activity-attempt protocol

**Status:** Accepted · **Date:** 2026-07-17

## Context

Wharfie has two deliberately different execution surfaces. The developer CLI
owns ordinary process behavior: argv, stdin, stdout, stderr, CLI-library choice,
and exit status. A named activity is instead a durable and placeable component
boundary. It must eventually behave the same whether its handler is JavaScript,
WASI/WASM, or a persistent subprocess and whether transport is a worker thread,
a local process, or an authenticated remote connection.

The current implementation has several incompatible calling conventions. The
public API passes `(event, context)` and returns a JSON value; worker threads use
unversioned internal `exec` and `rpc` messages; queue and gRPC requests use
another JSON shape; logs are raw stdout/stderr chunks; gRPC drops activity
results; and neither cancellation nor a deadline reaches the handler. Caller
metadata, attempt metadata, and host capabilities also share one mutable
`context` namespace. Those conventions cannot support honest recovery or a
future component implementation.

## Decision

### One protocol per physical attempt

Wharfie activity protocol version 1 is a transport-independent, strict-JSON,
ordered transcript for one physical activity attempt. Every frame names the
protocol and exact integer version. Unknown versions, frame types, fields, and
invalid values fail closed rather than being ignored or coerced.

The host starts exactly one attempt with a `start` frame. That frame binds:

- the immutable application revision and canonical activity ID;
- `runId`, stable `invocationId`, unique `attemptId`, and an opaque fencing
  token;
- one strict JSON input value;
- caller-owned stable metadata in a namespace separate from Wharfie runtime
  identity and capabilities; and
- an optional absolute deadline.

Local non-durable invocation still uses this boundary. Its host allocates
ephemeral run, invocation, attempt, and fencing identities and binds the exact
prepared or embedded revision. Ephemeral identity means the invocation has no
recovery claim; it does not permit a second handler calling convention.

After `start`, the host may send `cancel` and correlated `effect-result` frames.
The component may emit monotonically sequenced `log` and `effect-request`
frames, followed by exactly one terminal frame. The terminal outcome is one of:

- `completed`, with a required strict JSON result, including scalar, array, or
  null results;
- `failed`, with a structured error;
- `cancelled`;
- `deadline-exceeded`; or
- `protocol-failed`.

Only the first valid terminal frame can resolve the attempt. Duplicate frames
and frames after a terminal are rejected. A cancellation accepted before the
deadline owns its bounded grace: cleanup logs and a `cancelled` or
`protocol-failed` terminal may arrive after the clock crosses that deadline.
It cannot be replaced by `completed`, `failed`, or `deadline-exceeded`. Without
such a prior cancellation, a post-deadline component frame must be
`deadline-exceeded`; a deadline terminal before its absolute deadline is
invalid. This protocol outcome is evidence about one physical attempt; the
durable ledger separately decides whether it can become the invocation's one
authoritative outcome.

### Cancellation and deadlines

Cancellation is explicit protocol input, not an inference from a closed
transport. A deadline is an absolute instant in the start frame, not merely a
client RPC timeout. The first host interruption wins: a cancellation accepted
before the deadline owns its bounded cooperative shutdown interval; at or after
the deadline a new cancellation does not displace the deadline-owned outcome.
The host exposes interruption through a Wharfie-owned runtime context and an
`AbortSignal`, rejects new managed effects after interruption, and terminates
the adapter's attempt boundary when the relevant grace interval expires.

Every host-owned operation that can stall an attempt—component-frame delivery,
managed-effect handling, and forced termination—has a finite adapter timeout.
A host cannot turn a deadline or cancellation into an unbounded wait. Failure
to confirm delivery is explicit attempt-delivery uncertainty: the adapter
retains the locally accepted transcript and its last contiguous acknowledged
component sequence, but it must not claim that an unacknowledged terminal or
side effect became durable.

Stopping an adapter does not prove that unmanaged JavaScript or an external
effect did not run. Durable recovery continues to apply the accepted unsafe and
`uncertain` rules; cancellation only fences later Wharfie-managed commits unless
separate effect evidence establishes more.

### Logs and errors

Activity logs are ordered structured frames with level, message, and optional
strict JSON fields. They never share the result channel and cannot corrupt
machine-readable CLI output. Interactive execution may render them to stderr;
durable execution records them against the attempt before rendering or
forwarding them.

Failures use a stable structured error containing a name, code, message, and
optional strict JSON details. Adapter crashes and malformed protocol behavior
become `protocol-failed`; they are not rewritten as arbitrary handler failures.
Transport implementations preserve this structure rather than embedding a
stack trace inside a new generic error message. Stack traces may be attached as
diagnostic observations but are not portable error identity.

### Host-mediated effects

Components request managed effects with a stable effect ID, adapter and
operation IDs, strict JSON input, and a declared replay-property request. The
host correlates the response to the same attempt and effect ID. Provider
clients, coordinator credentials, and resource objects never cross the
component protocol. Binary and large values use an explicit future blob
capability rather than transport-specific buffer revival.

An effect request does not establish idempotence, transactional behavior, or
exactly-once execution. A host adapter and destination must substantiate the
properties recorded in the durable effect ledger. Direct SDK calls remain
possible for trusted in-process Node handlers, but they are unmanaged and make
an interrupted attempt unsafe under decision 0004.

### Node handler boundary

Node remains the first handler implementation. Its protocol adapter supplies
the input and a Wharfie-owned runtime context containing frozen invocation
identity, stable caller metadata, abort state, structured logging, and managed
effect access. Caller metadata cannot replace runtime identity, fencing, or
capabilities. An activity cannot use process exit status as its outcome;
`process.exit`, abort, or process termination inside an adapter is protocol
failure.

Source and packaged activities use the same adapter and transcript rules. The
packaged/external path uses a one-shot worker and a framed private MessagePort:
the host owns `start`, `cancel`, transcript validation, acknowledgements,
deadlines, a finite readiness watchdog, and returned evidence. Runner lifecycle messages require a
per-attempt opaque authenticator captured before bundle evaluation, so ordinary
in-isolate code cannot forge direct port traffic. Legacy `exec`/RPC messages
remain confined to legacy execution paths and are not Activity Protocol
effects. This is an integrity boundary for Wharfie's trusted application code,
not a hostile-code sandbox; adversarial bundles require a separate
process/OS-level boundary.

A cancellation that predates runner readiness prevents the activity handler
from being entered, but cannot prevent module/bundle top-level initialization:
the runner must evaluate the bundle to install and report that boundary. The
ready watchdog bounds that initialization; suppressing all bundle side effects
would require a different loading architecture.

The selected protocol version is part of Wharfie's target-independent runtime
lock and therefore the immutable application revision. Function assets and
artifact provenance bind the revision and exact runtime bytes. A protocol
semantic change requires a new protocol version and runtime input, never an
in-place reinterpretation of an existing revision.

## Consequences

- The developer CLI keeps ordinary process semantics; activities have framed
  attempt outcomes instead of argv, stdio, or exit codes.
- Source, SEA, worker, and network paths can share one serialization and error
  contract.
- Durable IDs and fencing enter the handler boundary before the ledger relies
  on them.
- Cancellation and deadline behavior is explicit while remaining honest about
  unmanaged effects.
- Structured logs remain compatible with human stderr and machine-readable
  result output.
- WASI/WASM and subprocess adapters can be added later without defining a
  second workflow or effect model.

## Non-goals

This decision does not yet define or implement:

- the durable run → invocation → attempt → effect ledger, retry policy,
  coordinator leases, or authoritative outcome selection;
- a WASI/WASM or subprocess adapter;
- authenticated network transport, framing bytes, streaming, backpressure, or
  transport negotiation;
- payload externalization, a blob store, or a complete managed-effect catalog;
  or
- exactly-once behavior for arbitrary handler code or an effect whose
  destination does not atomically enforce its identity.
