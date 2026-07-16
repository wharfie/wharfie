# 0001 — Trusted nodes only

**Status:** Accepted · **Date:** 2026-07-16

## Context

Wharfie needs to place and recover work across machines. A design that assumes mutually suspicious nodes would require Byzantine consensus, adversarial sandboxing, economic or cryptographic identity, and a substantially larger security protocol. None of that helps the initial use case: one operator extending an application from a laptop to machines and accounts that operator controls.

## Decision

All nodes enrolled in a Wharfie deployment are trusted members of that deployment.

Enrollment is authenticated and explicit. Nodes receive narrowly scoped application identities, and transport and stored control data must still be protected. "Trusted" means the coordination protocol does not attempt to remain correct when an enrolled node acts maliciously; it does not mean nodes get broad cloud credentials or that network input is accepted without authentication.

The mesh is an optional progression after local and single-node operation. Applications should not need mesh concepts until they request additional placement, capacity, or recovery.

## Consequences

- Wharfie can use ordinary authenticated coordination, leases, and fencing instead of Byzantine consensus.
- The threat model remains responsible for outsiders, credential theft, replay, stale members, and compromised transport.
- Revocation and re-enrollment are required operational features.
- Running mutually untrusted tenants on the same mesh is out of scope unless a later decision introduces a separate isolation model.
