# Architecture decision log

These records capture product-level decisions that should survive implementation rewrites. A decision can be superseded by a later record, but should not be silently edited into a different choice.

| Decision                                                                                                                         | Status                                             |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| [0001 — Trusted nodes only](0001-trusted-nodes-only.md)                                                                          | Accepted                                           |
| [0002 — One recoverable authoritative coordinator](0002-one-recoverable-active-coordinator.md)                                   | Accepted; automatic replacement amended by 0037    |
| [0003 — Capability fulfillment, not general IaC](0003-capability-fulfillment.md)                                                 | Accepted                                           |
| [0004 — One authoritative terminal outcome and explicit effects](0004-logical-outcomes-and-effects.md)                           | Accepted                                           |
| [0005 — TypeScript control plane with a component boundary](0005-typescript-and-component-boundary.md)                           | Accepted                                           |
| [0006 — One strict version 2 application manifest](0006-strict-v2-app-manifest.md)                                               | Superseded by 0026                                 |
| [0007 — Atomic, fenced operation snapshots](0007-atomic-operation-snapshots.md)                                                  | Superseded by 0011                                 |
| [0008 — Immutable revision, artifact, and deployment-profile identities](0008-immutable-identity-spine.md)                       | Accepted; profile V1 superseded by 0021            |
| [0009 — Frozen target dependency closures](0009-frozen-target-dependency-closures.md)                                            | Accepted                                           |
| [0010 — Versioned activity-attempt protocol](0010-versioned-activity-attempt-protocol.md)                                        | Accepted                                           |
| [0011 — Persisted state-machine execution ledger](0011-persisted-state-machine-execution-ledger.md)                              | Accepted; amended by 0036–0038                     |
| [0012 — No manifest resource injection](0012-no-manifest-resource-injection.md)                                                  | Accepted                                           |
| [0013 — Durable cancellation and evidence-backed reconciliation](0013-durable-cancellation-and-evidence-reconciliation.md)       | Accepted; V4 slice carried forward by 0014         |
| [0014 — Verifier-backed persisted managed effects](0014-verifier-backed-managed-effects.md)                                      | Accepted; internal V5 foundation implemented       |
| [0015 — Destination-bound managed effects and finite host catalogs](0015-destination-bound-managed-effects.md)                   | Accepted; V6 foundation superseded by 0016         |
| [0016 — Atomic stopped-attempt managed-effect settlement](0016-atomic-stopped-attempt-effect-settlement.md)                      | Accepted; V7 namespace superseded by 0017          |
| [0017 — Destination-finalized uncertain-effect reconciliation](0017-destination-finalized-effect-reconciliation.md)              | Accepted; V8 reconciliation boundary               |
| [0018 — Causally linked managed-effect successor work](0018-causally-linked-managed-effect-successors.md)                        | Accepted; finite V9 retry policy                   |
| [0019 — Persisted linear workflow continuations](0019-persisted-linear-workflow-continuations.md)                                | Accepted; linear activity/timer/signal slice       |
| [0020 — Linux systemd user-service lifecycle](0020-systemd-user-service-lifecycle.md)                                            | Accepted; amended 2026-08-06                       |
| [0021 — Provider-backed single-node deployment](0021-provider-backed-single-node-deployment.md)                                  | Superseded by 0035                                 |
| [0022 — Durable activity-log append before acknowledgement](0022-durable-activity-log-append.md)                                 | Accepted                                           |
| [0023 — Verified sensitive activity-log disclosure](0023-sensitive-activity-log-disclosure.md)                                   | Accepted                                           |
| [0024 — Revision-bound workflow schedules](0024-revision-bound-workflow-schedules.md)                                            | Accepted; pending admission superseded by 0025     |
| [0025 — Atomic scheduled-workflow admission](0025-atomic-scheduled-workflow-admission.md)                                        | Accepted; internal kernel carried forward by 0026  |
| [0026 — Resident revision-bound workflow schedules](0026-resident-workflow-schedules.md)                                         | Accepted; amended 2026-08-27                       |
| [0027 — Relocated SEA schedule/restart proof](0027-relocated-sea-schedule-restart-proof.md)                                      | Accepted; Linux execution evidence remains pending |
| [0028 — Versioned durable-operation receipts](0028-versioned-durable-operation-receipts.md)                                      | Accepted                                           |
| [0029 — Explicit bounded local release pruning](0029-local-release-pruning.md)                                                   | Accepted                                           |
| [0030 — Versioned application-package receipt](0030-versioned-application-package-receipt.md)                                    | Accepted; amended 2026-08-01                       |
| [0031 — Verified sensitive durable run-output disclosure](0031-verified-sensitive-run-output.md)                                 | Accepted                                           |
| [0032 — Default durable CLI handoff](0032-default-durable-cli-handoff.md)                                                        | Accepted; replaces strict V3 with executable V4    |
| [0033 — Explicit coordinator epoch authority](0033-explicit-coordinator-epoch-authority.md)                                      | Accepted; automatic replacement amended by 0037    |
| [0034 — Explicit local application-data purge](0034-explicit-local-application-data-purge.md)                                    | Accepted; bounded developer-preview cleanup        |
| [0035 — Two-provider single-node self-deployment](0035-two-provider-single-node-self-deployment.md)                              | Accepted                                           |
| [0036 — Durable coordinator admission provenance](0036-durable-coordinator-admission-provenance.md)                              | Accepted; bounded historical attribution           |
| [0037 — Single-region DynamoDB RVN-observed coordinator replacement](0037-single-region-dynamodb-rvn-coordinator-replacement.md) | Accepted; internal reconstruction composed        |
| [0038 — Authority-bound replacement reconstruction](0038-authority-bound-replacement-reconstruction.md)                         | Accepted; internal reconstruction slice complete  |

The canonical product scope is [PROJECT.md](../../../PROJECT.md). The delivery order is [ROADMAP.md](../../../ROADMAP.md).
