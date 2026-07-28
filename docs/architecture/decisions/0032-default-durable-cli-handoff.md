# 0032 — Default durable CLI handoff

**Status:** Accepted · **Date:** 2026-07-28

## Context

Wharfie starts with a normal developer-owned CLI, but the first durable
workflow surface required callers to repeat a workflow ID, translate ordinary
arguments into JSON, and invent an idempotency key. The `steady-file` golden
path demonstrated that this was framework friction rather than application
complexity.

The framework should make one common handoff small without taking ownership of
application argument parsing, inventing a general command-mapping language, or
coupling workflow admission to resident-process lifecycle.

## Decision

### Manifest version 4 is the only accepted application contract

The source compiler, runtime validator, revision compiler, embedded manifest,
packager, examples, and public TypeScript declarations accept only
`schemaVersion: 4`. Version 3 is rejected without a compatibility alias,
downgrade, or dual-read path. The workflow and schedule behavior introduced by
version 3 remains part of version 4.

`cli` may declare one exact optional handoff beside its existing entrypoint:

```js
cli: {
  entrypoint: { kind: 'node', path: './cli.js', export: 'main' },
  durable: { workflow: 'verify-stable', export: 'toDurableInput' },
}
```

`workflow` must name a workflow declared by the same manifest. `export` names a
function on the CLI entrypoint module. Both fields, including the durable
declaration itself, are part of immutable application revision identity.

### The adapter is a pre-admission JSON projection

The adapter receives a copied, frozen list of application arguments without
Node argv. It may return a JSON value or a promise of one. Wharfie validates
and bounds the result before creating durable state.

The adapter is trusted application code, not durable work. Its contract is to
validate and project arguments without external mutations. The framework does
not claim that it is pure, retried exactly once, or protected from process
environment and filesystem access. Applications should share its parser with
their ordinary CLI so local and durable input semantics stay aligned.

Source admission imports the adapter from the sealed prepared-source snapshot,
rejects an app-local Wharfie runtime that differs from the runtime locked into
the revision, and re-verifies that runtime around both module import and async
projection. Packaged admission lazily imports the developer CLI module already
embedded in the artifact. Help and unrelated operator commands do not load it.
Application stdout during admission is redirected to stderr so a JSON command
still emits one receipt document.

### Default and expert command paths remain distinct

The source and packaged forms accept application arguments after the standard
`--` separator:

```text
wharfie ops start --dir <app> -- <application-args>
<app> wharfie start -- <application-args>
```

With no `--workflow` or `--input` override, Wharfie requires `cli.durable`,
projects the application arguments, and starts its fixed workflow. Explicit
`--workflow` and `--input` remain an expert path and cannot be combined with
application arguments.

`--idempotency-key` is optional. Omission creates a fresh `manual-<uuid>` key
which is returned in the ordinary start receipt. Callers that may retry after
a lost response must provide and reuse a stable key; Wharfie does not derive a
key from arguments or input.

Starting a workflow admits durable work only. It does not start, daemonize, or
install a resident worker.

## Consequences

- A normal application parser can define both immediate local behavior and one
  obvious durable handoff without duplicated JSON construction.
- The source and portable-SEA operator surfaces select the same revision-bound
  workflow and adapter contract.
- Reusing an explicit key with identical projected input returns the retained
  run; changed input under the same key conflicts in the durable ledger.
- Adapter import, projection, JSON validation, runtime drift, and missing
  exports fail before workflow admission.
- A cleanup failure after successful admission does not hide the committed run
  receipt; the command reports the cleanup failure and exits nonzero.
- Applications with multiple unrelated workflows keep using the explicit
  expert surface until a demonstrated need earns a larger mapping abstraction.

## Rejected alternatives

### Map every application command in the manifest

Rejected because it would duplicate the developer CLI's parser and create a
second command language before one application demonstrated the need.

### Pass Node argv or unknown operator options through

Rejected because it would couple application parsing to Wharfie's executable
layout and make option ownership ambiguous. `--` preserves exact application
tokens explicitly.

### Derive idempotency from arguments or projected input

Rejected because equivalent invocations are an application decision and
content-derived keys can accidentally collapse intentional repeated work.

### Start or daemonize the resident from `start`

Rejected because durable admission and service lifecycle have different
failure, ownership, and recovery semantics. The worker remains an explicit
foreground or managed-service operation.
