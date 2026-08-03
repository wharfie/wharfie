# 0004 — One authoritative terminal outcome and explicit effects

**Status:** Accepted · **Date:** 2026-07-16

## Context

Durable workers must retry after crashes and lease loss. A process can perform an external action and die before recording success, so no coordinator can truthfully promise that arbitrary handler code or arbitrary external side effects physically execute once.

Wharfie still needs strong abstractions: application authors should not hand-build deduplication for every durable operation, and a stale or duplicate attempt must not be able to commit a second logical result.

## Decision

An invocation has at most one authoritative terminal ledger outcome; a resolved invocation has exactly one. Retryable runnable work uses at-least-once dispatch, and multiple physical attempts can overlap around a failure. Work that is cancelled, blocked, or never made runnable is not promised a physical execution. Each attempt has a unique ID, lease, and fencing token; only the current fenced attempt can commit Wharfie-managed state.

Every activity context exposes stable and attempt-specific identity:

- `runId`;
- `invocationId`, stable across retries;
- `attemptId`, unique per physical execution; and
- `fencingToken`.

Operations routed through Wharfie's effect API are explicit ledger entries with stable effect IDs and one or more substantiated replay properties:

- `pure` — the operation has no externally visible consequence;
- `idempotent` — the destination deduplicates a stable key;
- `transactional` — the business mutation and effect record commit atomically.

These properties can compose. Without a supported replay guarantee, an operation is `unsafe`: its destination cannot establish the result after an interrupted attempt.

Trusted in-process JavaScript can bypass the effect API and call an SDK directly, and Wharfie cannot detect whether such a call completed before a crash. Therefore an in-process handler is `unsafe` by default once it begins: if its attempt is interrupted before a terminal commit, the invocation blocks in `uncertain` rather than being retried automatically. An author can opt into a substantiated handler-level `pure` or `idempotent` contract to permit retry. Direct side effects remain unmanaged, and Wharfie makes no deduplication claim for them.

An adapter may claim exactly-once effect behavior only when the destination atomically enforces a stable effect identity with the business mutation. A uniqueness constraint or fencing token must be validated by that destination. A provider idempotency key is sufficient only within its documented scope and retention window. A transactional outbox makes intent atomic and supports at-least-once delivery; exactly-once processing additionally requires destination deduplication, such as an inbox record committed atomically with the consumer mutation.

After an interrupted unsafe operation, `uncertain` is a durable blocked, nonterminal invocation state. Reconciliation either establishes the invocation's single terminal outcome or creates a distinct compensating invocation. It never rewrites an already committed terminal outcome, silently retries the ambiguous operation, or claims success without evidence.

## Consequences

- Documentation and APIs must distinguish invocation outcome, physical attempt, and external effect.
- There will be no magical `execution: exactly-once` flag for arbitrary code.
- Adapters carry evidence for the guarantees they expose.
- The ledger must retain ambiguous states, evidence, and operator reconciliation decisions.
- Crash tests at commit and effect boundaries are part of the product contract, not only implementation tests.
