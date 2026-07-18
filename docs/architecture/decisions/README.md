# Architecture decision log

These records capture product-level decisions that should survive implementation rewrites. A decision can be superseded by a later record, but should not be silently edited into a different choice.

| Decision                                                                                                                   | Status                                         |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [0001 — Trusted nodes only](0001-trusted-nodes-only.md)                                                                    | Accepted                                       |
| [0002 — One recoverable authoritative coordinator](0002-one-recoverable-active-coordinator.md)                             | Accepted                                       |
| [0003 — Capability fulfillment, not general IaC](0003-capability-fulfillment.md)                                           | Accepted                                       |
| [0004 — One authoritative terminal outcome and explicit effects](0004-logical-outcomes-and-effects.md)                     | Accepted                                       |
| [0005 — TypeScript control plane with a component boundary](0005-typescript-and-component-boundary.md)                     | Accepted                                       |
| [0006 — One strict version 2 application manifest](0006-strict-v2-app-manifest.md)                                         | Accepted; resources superseded by 0012         |
| [0007 — Atomic, fenced operation snapshots](0007-atomic-operation-snapshots.md)                                            | Superseded by 0011                             |
| [0008 — Immutable revision, artifact, and deployment-profile identities](0008-immutable-identity-spine.md)                 | Accepted                                       |
| [0009 — Frozen target dependency closures](0009-frozen-target-dependency-closures.md)                                      | Accepted                                       |
| [0010 — Versioned activity-attempt protocol](0010-versioned-activity-attempt-protocol.md)                                  | Accepted                                       |
| [0011 — Persisted state-machine execution ledger](0011-persisted-state-machine-execution-ledger.md)                        | Accepted                                       |
| [0012 — No manifest resource injection](0012-no-manifest-resource-injection.md)                                            | Accepted                                       |
| [0013 — Durable cancellation and evidence-backed reconciliation](0013-durable-cancellation-and-evidence-reconciliation.md) | Accepted; V4 cancellation, local-owner, and evidence-reconciliation slices implemented |

The canonical product scope is [PROJECT.md](../../../PROJECT.md). The delivery order is [ROADMAP.md](../../../ROADMAP.md).
