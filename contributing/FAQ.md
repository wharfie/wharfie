# FAQ

## What is Wharfie?

Wharfie is an experimental, local-first TypeScript application runtime. It aims
to turn an ordinary CLI into a portable executable and then promote the same
application to a durable, observable service across trusted machines.

The deeper motivation is continuity: software created in a coding session
should be able to keep carrying out its operator-approved behavior after the
session or laptop is gone, while leaving enough durable history to understand
and evolve it later.

## What works today?

The shipped source CLI exposes three top-level command groups: `wharfie app`,
`wharfie ops`, and experimental `wharfie deployment`. The repository contains
working foundations for loading manifests, invoking activities locally,
persisting an append-only manual run → invocation → attempt ledger,
inspecting/recovering exact runs from source or a packaged artifact, asking an
exact live owner to cancel a foreground run, packaging target-specific Node SEA
executables, and driving the finite AWS deployment lifecycle through focused
automated evidence. The deployment path has not yet been proven through a
clean account or completed guest service projection. A standalone Wharfie
builder binary is withheld until its build-host dependencies can be embedded.
It is not production ready.

## How do `inspect`, `recover`, and `cancel` differ?

`wharfie ops inspect --run-id <run-id>` (or `<app> wharfie inspect`) is a
read-only verified view of one existing run; it never creates a control volume
or durable run. `recover` is a deliberate mutation after every prior runner
has stopped and requires `--confirm-runner-stopped`. It can release an
unstarted claim or mark a begun, abandoned attempt `UNCERTAIN`; it does not
replay user code. A packaged recovery uses the local LMDB ownership protocol.

`wharfie ops cancel --run-id <run-id> --request-id <stable-request-id>` (or
`<app> wharfie cancel`) is narrower still. It is not a generic ledger write:
it reaches only the same-principal, LMDB-backed foreground `ops run` owner of
that exact `STARTED` manual attempt. The request ID is required and must be
reused after a lost response. The owner durably records intent before beginning
physical delivery; absent, stale, unreachable, unstarted, or merely resident
owners cannot be bypassed with a direct write. The local command transport is
not yet available on Windows.

## Is this the old Athena and table framework?

No. Wharfie v1 is abandoned. Its Athena, table, source, model, and ETL APIs are
not part of the current product, and no backward compatibility is promised.

## Is Wharfie a general cloud infrastructure-as-code tool?

No. The experimental deployment commands use the operator's normal AWS
credential chain to preview and create the fixed substrate required by Wharfie
capabilities, such as a node, durable control state, or artifact storage.
Provider-native application infrastructure remains application code or
external IaC.

The command tree has exactly five leaves: `plan`, `apply`, `inspect`,
`reconcile`, and `destroy`. Plan and direct apply take a canonical
DeploymentProfileV2 JSON file through `--profile`; that operator document is
outside the app manifest and contains no credentials. Source plan and direct
apply package and pre-stage a selected SEA; source prepared apply and reconcile
use durable staged evidence. Packaged plan, apply, and non-destroy reconcile
prove their running SEA and do not accept `--dir` or `--output-dir`; active
destroy recovery remains durable-only. This is an experimental operator
surface, not a clean-account or service-readiness claim.

## Does Wharfie require a hosted control plane?

No. Local and single-node operation should not require an external Wharfie
service. Automatic coordinator replacement in a future multi-node deployment
will initially require a provider-backed linearizable durable store.

## What does “mesh” mean here?

A Wharfie mesh is a small set of explicitly enrolled, mutually trusted nodes.
It is not a trustless, Byzantine, or internet-scale peer-to-peer network. The
multi-node mesh is roadmap work, not part of the current product proof.

## Does Wharfie guarantee exactly-once execution?

It cannot honestly guarantee that arbitrary user code physically executes only
once. Durable work can use at-least-once dispatch while fencing which attempt
may commit Wharfie-managed state. An external exactly-once claim is possible
only when a managed effect adapter and its destination atomically enforce a
stable effect identity. Ambiguous unmanaged effects must be exposed for
reconciliation instead of silently retried.

## Which languages are supported?

TypeScript and Node are the initial authoring and orchestration model. The
intended activity boundary leaves room for target-specific Node-API
dependencies, WASI/WASM, or persistent subprocess workers later. Clean moved
Darwin and hosted Linux SEA proofs already exercise a real target-specific
LMDB Node-API dependency with Node absent from `PATH`. Wharfie is not a general
multi-language build system.

## Do target machines need Node installed?

Not for packaged applications. Wharfie currently uses Node SEA to produce one
executable for each selected platform and architecture. Authors still use Node
and the repository's pinned toolchain while developing and packaging.

## Where is the canonical scope?

Read the [project charter](../PROJECT.md) for the public concepts, boundaries,
and semantics, then the [roadmap](../ROADMAP.md) for the delivery sequence.
