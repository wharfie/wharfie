# 0012 — No manifest resource injection

**Status:** Accepted · **Date:** 2026-07-17

## Context

The initial strict version 2 manifest admitted finite `db`, `queue`, and
`objectStorage` declarations. No supported execution path could fulfill that
contract honestly. Source, packaged, and ledger-backed activity paths rejected
nonempty declarations; function assets carried redundant `resourceSpecs`; and
the remaining generic worker RPC could expose arbitrary in-process objects
without durable identity, fencing, replay, or effect semantics.

Keeping a schema for behavior Wharfie always rejects makes the public model
look more capable than the runtime. It also conflates three different concerns:
portable deployment requirements, host-mediated durable effects, and private
control-store implementations.

## Decision

- Version 2 application and activity definitions do not accept `resources`.
  The exact-key validator rejects the field rather than preserving an empty or
  dormant compatibility shape.
- A property named `resources` inside caller metadata is ordinary cloned JSON.
  It has no reserved meaning and cannot request host object injection.
- Function-asset schema version 4 removes `resourceSpecs`. Version 3 assets and
  extra resource fields are rejected without migration during the reset.
- Activity execution uses the authenticated framed Activity Protocol attempt
  transport. The generic worker `exec` and resource-RPC interface is removed.
- Portable capability requirements, provider fulfillment, and managed effects
  will receive separate versioned contracts. Components will use explicit
  host-mediated effect messages rather than injected provider clients.
- Internal DB adapters needed by the ledger and control store remain private
  implementation machinery. The unused shared-resource registry and queue/
  object-storage injection adapters are deleted rather than treated as a
  provisional public capability system.

## Consequences

- The source manifest, embedded manifest, function asset, and worker transport
  now describe only behavior that current execution paths can perform.
- Applications can still use normal Node modules and target-specific Node-API
  packages. Direct SDK calls are unmanaged effects under ADR 0004.
- Milestone 4 can design portable deployment capabilities without inheriting
  adapter names or option shapes from an unshipped runtime-object API.
- This is an intentional breaking schema change with no backward-compatibility
  or development-artifact migration requirement.
