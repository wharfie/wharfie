# 0028 — Versioned durable-operation receipts

**Status:** Accepted · **Date:** 2026-07-27

## Context

Wharfie's durable `run`, `submit`, and workflow `start` commands currently
write unversioned snake_case objects shaped for `console.table`. The workflow
`signal` command already writes a versioned camelCase receipt. Source and
packaged commands share their mutation implementations, but a program consuming
their JSON has no declared contract for three of the four primary ways to
create or advance work.

That ambiguity is especially costly for Wharfie's intended use. A local coding
agent should be able to launch durable work, retain the returned identity after
the session ends, and follow or evolve it later without scraping prose or
depending on the current table layout. Machine output therefore needs explicit
versioning, source/packaged parity, strict redaction, and honest failure
semantics. It does not need a hosted API or a generic RPC envelope.

## Decision

### Each durable operation has one namespaced schema-v1 receipt

Successful durable decisions use these kinds:

- `wharfie.execution-ledger.activity-run`;
- `wharfie.execution-ledger.activity-submit`;
- `wharfie.execution-ledger.workflow-start`; and
- the existing `wharfie.execution-ledger.signal`.

Every receipt has integer `schemaVersion: 1`, a namespaced `kind`, camelCase
fields, and a fixed constructor-owned property order. `run`, `submit`, and
`start` include the immutable application, revision, run, and public request
identity known to both source and packaged execution. A signal receipt retains
its existing shape: an unknown run cannot honestly supply application or
revision scope.

An activity-run receipt additionally carries its durable disposition, replay
bit, run and invocation statuses, and either a bounded `{generation, status}`
attempt summary or `null`. An activity-submit receipt carries its replay bit
and accepted run/invocation statuses; it does not invent an attempt. A
workflow-start receipt carries its replay bit, run status, current
`{disposition, stepId, stepIndex}` cursor, and either the next activation
kind/status or `null` after terminalization.
Signal receipts continue to expose accepted, rejected, or unknown-run outcome,
stable delivery identity, replay state, and only the safe current lifecycle
summary available for that outcome. Accepted and rejected decisions are
retained; unknown-run is an explicit read-time absence refusal and does not
claim a persisted delivery decision.

The schemas deliberately omit input, caller metadata, signal payload, terminal
value or error, actor, plan and continuation IDs, invocation and activation
IDs, timestamps, sequence/version counters, payload references, digests,
evidence, fencing data, storage paths, and transition receipts.

### Constructors validate first and project by allowlist

Pure receipt constructors receive the complete trusted service result plus the
command-derived expected identity. They validate every caller-known immutable
identity, relevant nested run/invocation/cursor/activation linkage, supported
status, and replay field before creating a new allowlisted object. They never
spread backend results into public output. Returned receipts and nested objects
are recursively frozen.

The submit constructor accepts only the current compact service receipt.
Compatibility with older internal `{outcome|accepted}` projection shapes is
deleted instead of becoming part of the public schema.

Malformed JSON option failures use fixed messages. Parser diagnostics are not
included because current runtimes can quote the malformed, potentially
secret-bearing input.

### Human output is a separate view

The canonical receipt is the `--json` contract. Human output is derived from
it through an explicit formatter and may retain concise snake_case columns and
empty table sentinels. No machine consumer should treat those rows or success
messages as a schema.

Source `wharfie ops ...` and packaged `<app> wharfie ...` commands must emit
the exact same receipt for the same immutable execution and service result.
Their only selection difference remains source `--dir`; a packaged executable
cannot redirect authority to host source.

### A durable negative decision or explicit absence is still a receipt

A foreground run that is failed, blocked, or already in progress emits its
valid durable run receipt and then exits nonzero with a redacted diagnostic.
A rejected workflow signal likewise emits its retained decision and exits
nonzero. An unknown workflow run emits a stable read-time absence refusal and
exits nonzero without inventing or persisting a delivery. These documents
report durable state or explicit absence; they are not equivalent to process
success.

Input, loading, identity, service, or malformed-result failures that occur
before a durable decision emit no JSON document. Cleanup runs after the
decision is rendered, so a cleanup-only failure can still produce a valid
receipt followed by stderr and a nonzero exit. Wharfie does not claim atomic
stdout delivery or exactly-once display.

## Consequences

- Local agents and scripts can retain stable app/run/request identities without
  parsing human tables.
- Source and packaged applications have one machine contract even though their
  execution loaders differ.
- Adding or changing a documented field requires a new schema version rather
  than silently changing a table-shaped object.
- Backend result drift fails closed before output, and private extra fields
  cannot leak through object spreading.
- Human presentation can evolve independently from the machine document.
- This decision adds no remote API, event stream, result-value disclosure,
  hosted coordinator, or stronger exactly-once execution claim.

## Rejected alternatives

### Keep serializing the table row

Rejected because presentation placeholders such as generation `0` and an empty
attempt status are not an honest machine model, and snake_case table columns
have no version or discriminator.

### Use one generic command-result envelope

Rejected because operation-specific kinds form a clearer discriminated union
and can evolve independently without pretending Wharfie exposes a general RPC
protocol.

### Include all verified ledger projections

Rejected because `inspect` already owns the broader redacted run view. Mutation
receipts need only enough stable identity and lifecycle state to retain and
follow the decision.

### Emit structured error documents for every failure

Rejected for this slice. Pre-decision failures remain stderr plus nonzero exit;
designing a stable machine-error family is separate work.
