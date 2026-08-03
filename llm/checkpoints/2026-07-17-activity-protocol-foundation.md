# Wharfie checkpoint — activity protocol foundation

**Date:** 2026-07-17

**Branch:** `agent/strict-manifest`

**Published branch tip before this milestone:** `c66a9c5`
(`Freeze target dependency closures`)

**Umbrella review:** draft PR
[#125](https://github.com/wharfie/wharfie/pull/125)

This is the current restart point after the frozen dependency-closure
milestone. Read `PROJECT.md`, `ROADMAP.md`, and every accepted ADR in
`docs/architecture/decisions/` before changing code. ADR 0010 defines the
versioned activity-attempt protocol, and ADR 0011 chooses the future persisted
state-machine execution ledger. Older dated checkpoints are immutable history.

This checkpoint belongs in the same coherent commit as the CLI-equivalence
proof, protocol codec/transcript validator, and ADRs 0010–0011. It deliberately
contains no self-referential commit hash. Resolve its owning commit with
`git log`.

## Copy-paste resume prompt

> Continue the Wharfie reset from
> `llm/checkpoints/2026-07-17-activity-protocol-foundation.md`. Read
> `PROJECT.md`, `ROADMAP.md`, and all accepted ADRs before changing code.
> Breaking changes are allowed, v1 and backward compatibility are abandoned,
> and there are no known downstream users. Fetch `origin`, verify draft PR
> #125 and the current worktree, and preserve unrelated local changes. Confirm
> the owning milestone's full verification under Node 24.13.1. Do not repair
> the missing direct `@typescript-eslint/parser` declaration until the user
> explicitly approves that separate CI fix. The next implementation task is
> to make source, SEA worker, and network activity execution consume Activity
> Protocol v1 without changing ordinary developer CLI process semantics. The
> append-only execution ledger follows that bounded attempt primitive; do not
> add recovery semantics to the transitional Operation/Action snapshot store.
> Create another dated checkpoint rather than rewriting this one.

## Product direction and preservation state

The authoritative product progression remains:

```text
developer-owned TypeScript CLI
  → named local activities
  → self-contained target executable
  → resident durable service
  → coordinated execution across trusted nodes
```

The accepted boundaries remain unchanged: trusted nodes only; Node/TypeScript
first; one recoverable authoritative coordinator; finite Wharfie capability
fulfillment rather than general IaC; explicit unsafe/uncertain behavior for
unmanaged effects; and exactly-once claims only where a destination atomically
enforces a stable effect identity.

Every original GitHub branch tip remains preserved under verified annotated
`archive/2026-07-16/remote/...` tags. The last verified live remote heads were
`master` and `agent/strict-manifest`; draft PR #125 was the only open PR.
Staging archive tags and intentionally local-only unpublished/stash tags retain
the meanings recorded in the preceding frozen-closure checkpoint. Reverify
live GitHub state rather than relying on this dated statement, and never push
the local-only archive tags without a separate content review.

## Completed in this milestone

### Ordinary CLI process contract

The real package verifier now executes one authored TypeScript CLI directly and
from a relocated generated SEA with identical difficult application arguments,
including spaces, Unicode, and an empty argument. Both executions consume the
same multiline stdin without a final newline, write independent exact stdout
and stderr, and select nonzero exit code 23. The generated SEA continues to run
the locked LMDB Node-API activity with Node absent from `PATH`.

This proves that the application owns ordinary argv, stdio, parsing approach,
and exit status. The reserved top-level `wharfie` operator namespace and hidden
service bootstrap remain separate. Named activities do not inherit CLI process
semantics.

### Activity Protocol v1 foundation

`src/core/runtime/activity-protocol.js` defines strict immutable JSON frames
for one physical attempt:

- fixed protocol name `wharfie.activity` and integer version 1;
- a 1 MiB compact UTF-8 JSON frame limit;
- host `start`, `cancel`, and `effect-result` frames;
- component `log`, `effect-request`, and exactly one terminal outcome;
- start identity binding for revision, activity, run, invocation, attempt, and
  opaque fencing token, plus input, caller metadata, and optional deadline;
- completed, failed, cancelled, deadline-exceeded, and protocol-failed terminal
  outcomes with strict result/error unions;
- ordered component sequence validation, attempt correlation, one start, one
  terminal, and no late frames;
- stable effect identity, canonical requested and substantiated replay
  properties, explicit evidence, no new effects after cancellation, and no
  successful completion with unresolved effects; and
- a successful effect result cannot silently omit a requested safe replay
  guarantee.

Validation rejects unknown versions, types, fields, malformed identities,
non-transport JSON values, replay-property ambiguity, oversized frames, effect
reuse, sequence gaps, and invalid transcript transitions. Accepted frames are
independent deeply frozen clones.

ADR 0010 fixes the architectural boundary: ordinary CLI execution stays
outside the protocol; Node handlers receive a Wharfie-owned runtime context;
logs and errors become structured frames; cancellation and deadlines are
explicit but cannot erase unmanaged-effect ambiguity; and component effects
are host mediated without provider or coordinator credentials crossing the
boundary.

### Durable execution model decision

ADR 0011 chooses explicitly persisted state machines and continuations rather
than deterministic replay of arbitrary TypeScript/Node handlers. It defines:

- run → invocation → attempt → effect identities and states;
- one per-run append-only sequenced event stream plus transactionally updated,
  rebuildable projections;
- immutable revision binding, timers, signals, scheduling decisions,
  cancellation, retry decisions, and operator actions as ledger data;
- claimed-versus-started attempt boundaries, leases, generations, coordinator
  epochs, and fencing;
- managed replay properties, default unsafe handlers, durable `UNCERTAIN`,
  reconciliation evidence, and distinct compensating work;
- content-addressed payload externalization; and
- the boundary between a local LMDB ledger and a later provider-backed
  store-authoritative `ControlStore` required for automatic coordinator
  replacement.

The transitional mutable Operation/Action snapshot store is not the ledger and
must not be extended into a second execution model. Once manual and
queue-triggered named activities use the new ledger with equivalent atomicity
and stronger crash coverage, delete the graph runner and snapshot store.

## Explicitly incomplete

Activity Protocol v1 is currently a codec and transcript state machine, not the
live execution path.

- Source activities without declared externals still execute directly in the
  caller process; external-bearing and embedded activities use the existing
  worker calling convention.
- The worker still sends private unversioned `exec`, `rpc`, and result messages,
  forwards raw chunk-prefixed stdout/stderr, and has no cancel/deadline frames.
- Caller context, attempt metadata, and resource capabilities are not yet fully
  separated into the ADR 0010 runtime context.
- gRPC invocation currently drops the activity result, does not enforce the
  request's revision identity, and treats its fixed deadline as transport-only.
- Durable cancellation fences a late snapshot commit but does not interrupt a
  handler or prevent a subsequent unmanaged effect.
- No append-only execution-ledger code, projection store, recovery scan,
  uncertain reconciliation command, or crash-boundary proof exists yet.
- The clean hosted-Linux SEA proof remains skipped because clean-install lint
  fails before it: `@typescript-eslint/parser` is used but not directly
  declared. That dependency/tooling repair still requires explicit approval.

Do not mark the roadmap's full activity-protocol milestone complete until
source, packaged SEA, and network execution produce the same validated attempt
transcripts for success, structured failure, cooperative and forced
cancellation, deadline expiry, ordered logs, managed effects, and late-frame
rejection.

## Verification state

Final verification used Node `24.13.1` and npm `11.12.0`:

- TypeScript type-check passed.
- ESLint and repository Prettier passed.
- Package-content verification found 134 expected files.
- The focused protocol suite passed 77 tests with approximately 99.5% statement
  and 98.6% branch coverage for the codec.
- The full suite passed 58 suites and 591 tests, with one intentional skip.
- Diff whitespace validation passed.
- The real package/SEA verifier installed the packed Wharfie package, proved
  source and generated CLI argv/stdio/exit equivalence, relocated the
  140,052,048-byte Darwin SEA, removed Node from `PATH`, and successfully used
  the locked LMDB dependency.

The full suite needs normal loopback permissions for gRPC and HTTP tests. The
real SEA verifier needs the exact pinned Node/npm pair, network access for
package material, and ordinary process/filesystem permissions.

```bash
git status --short --branch
git diff --check
. "$HOME/.nvm/nvm.sh"
nvm use 24.13.1
npm run typecheck
npm run lint
npm run test
npm run verify:package
npm run verify:package:sea
```

## Next work, in order

1. Commit and publish this milestone on `agent/strict-manifest`, update draft PR
   #125, and preserve the exact restart point.
2. Introduce one Node activity adapter around Protocol v1 and route both source
   and embedded handlers through it. Supply frozen invocation identity, caller
   metadata, `AbortSignal`, structured logger, and host effect client without
   exposing provider credentials.
3. Replace or wrap the worker's private execution messages with validated
   frames; enforce one terminal, structured errors/logs, cancel/deadline grace,
   forced worker termination, and late-frame rejection.
4. Make gRPC return the actual terminal envelope, enforce exact revision
   identity, and propagate cancellation/deadline into the same adapter.
5. Extend the real relocated-SEA proof to compare complete source and packaged
   attempt transcripts.
6. Implement the first append-only ledger slice from ADR 0011 for one manual
   named activity, then route queue delivery through it and expose JSON
   inspection.
7. With explicit user approval, repair the clean-install parser declaration,
   obtain a green hosted-Linux SEA proof, and review/merge umbrella PR #125.
