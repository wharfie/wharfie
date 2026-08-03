# V56 InspectionV6 aggregate and controller checkpoint

Date: 2026-07-24

Parent:
[V55 complete AWS resource observers](./2026-07-24-v55-complete-aws-resource-observers.md)

## Restart summary

Wharfie's first golden path remains one approachable TypeScript/Node SEA that
can run locally, become a durable single-node AWS service through the user's
ordinary credential chain, and later be inspected, reconciled, updated, or
destroyed without a hosted orchestrator. Nodes are trusted. One coordinator is
acceptable initially, provided its durable authority is recoverable. V1,
backward compatibility, trustless mesh, general-purpose cloud IaC, and a web UI
remain outside the current scope.

V55 completed mutation-incapable raw observation for all 18 AWS graph roles.
V56 replaces the lossy aggregate InspectionV5 contract with InspectionV6,
assembles those role reads behind one exact read-only provider, separates
definite first execution from crash recovery in the controller, and composes
the controller's provider port from capability-only owners.

## Breaking InspectionV6

InspectionV6 uses schema version 6, content domain
`wharfie:deployment-inspection:v6`, and the `win6` prefix. PlanV3 now accepts
only `win6` basis identities; stored V5 documents are rejected rather than
migrated.

Every resource contains an `execution` field. `none` is ordinary evidence.
`replay-safe-create` retains the exact raw unknown/access-failure union and
therefore cannot carry an invented provider identity, observed digest, binding,
dependency lineage, absence claim, or service proof. The value is restricted
to application state, control state, the route table, and the substrate because
only those four current drivers reproduce a stable provider client token.

At most one role may recommend replay. The whole inspection must be
`in-flight`, the exact non-null head and active PlanV3 must identify that same
managed/direct `intended` create, and its action ID, desired digest, ownership
nonce, and empty durable binding slot must all agree. Any ownership conflict
forces aggregate conflict and removes all advice. Advice is never settlement
evidence.

Context validation now requires an own `head` discriminator: present control
state requires the exact non-null durable head, authoritative absence requires
`null`, and uncertain or conflicting control state requires explicit
`undefined`. A present active head also requires its exact PlanV3. An optional
just-settled binding is not serialized or content-addressed; it may project
lineage only for the exact current managed create or future external verify
action and excludes replay advice.

The generic V6 resource union now represents external absence, uncertainty,
conflict, and transient unbound exact identity without forcing false external
ownership onto non-present evidence. Unbound external identity is non-final
drift and cannot prove convergence, destruction, or settlement. The current
fixed AWS profile remains all-managed, however, and the AWS planner has no
supported external-profile producer. External verification is therefore a
future contract path, not a current golden-path claim.

## Lossless AWS aggregate

`createAwsSingleNodeDeploymentInspectionProvider` accepts only one exact
resource-observation router, one exact service-health reader, and an optional
clock. Its inspection context binds the operation, desired revision, profile,
provider scope, ProviderSpec, deployment instance, incarnation, nullable head,
nullable active and last-settled plans, and nullable pending binding.

A null head is an authoritative, zero-provider-I/O absent fast path. For a live
head, the aggregate creates the complete 18-role desired catalog once and
recreates every V48 observation authority before starting any provider read.
Malformed target, head, plan, predecessor, binding, dependency, or pending
settlement authority therefore fails before observer I/O.

The aggregate routes all 18 roles once in canonical apply order and revalidates
every raw result against its exact resource key. It projects only exact durable
or pending binding lineage, preserves raw provider identity, actual digest,
uncertainty, conflict, health, and execution advice, and never adopts an
unbound managed resource. Pending settlement suppresses replay.

Resident health remains a separate narrow read. It is attempted only after
exact substrate and runtime-role authority and only when the raw node lifecycle
is compatible with a running instance. Stopped, failed, or starting EC2 state
cannot be overwritten by an older healthy S3 receipt. The final aggregate
derives absent, in-flight, unknown, conflict, drifted, degraded, converged, or
destroyed from the complete evidence; no resource observer may claim aggregate
readiness. While an active action frontier is not final, unrelated future
resources with unavailable dependencies remain locally unknown but the
aggregate stays in-flight, allowing the current action's separately validated
evidence to make progress.

## Definite first execution and bounded recovery replay

The controller previously changed a pending intent to `intended` before
obtaining ordinary execution evidence, then used the same absence proof to
execute during recovery. That made a durable `intended` frontier unable to
distinguish "definitely never called" from "the coordinator may have called
the provider."

V56 inspects and validates ordinary action evidence while the intent is still
`pending`. It then performs the exact `pending -> intended` compare-and-set and
calls the provider only when that transition definitely returned applied. An
ambiguous write that is merely read back as the expected successor is not
first-call authority.

Recovery always verifies settlement first. If an `intended` action remains
unconverged, the controller may call the provider again only for an exact V6
unknown resource carrying `replay-safe-create` for that same create action.
Dependencies are freshly re-proved before replay. A create without a stable
provider token receives at most one definitely authorized first call and is
blocked after ambiguous intent persistence; update, delete, no-op, verify, and
no-token create are never generalized into replay-safe work.

Settlement inspection receives the exact returned create binding before it is
published in the durable head. V6 validates its complete metadata, provider
identity, ownership nonce, creation receipt, and settled dependency lineage,
then forbids replay advice for that inspection.

## Exact provider composition

`createAwsSingleNodeDeploymentProvider` exposes exactly the seven methods the
controller consumes:

- scope resolution;
- ProviderSpec resolution and validation;
- aggregate inspection;
- deterministic plan creation; and
- resource action execution and settlement verification.

Each capability owner must expose only its exact methods. The inspection port
cannot carry execution or settlement methods, and the mutation router cannot
be installed as the observer. Delegates preserve their original receiver,
argument, synchronous throw, return value, and Promise identity. The built-in
planner adapter selects only its exact nine fields so active/settled plans and
pending bindings used by aggregate inspection cannot leak into planning.

## Explicit non-claims and next work

V56 does not yet provide:

- production assembly of the 16 concrete observer families, service-health
  reader, planner, mutation router, and one invocation-owned AWS client family;
- source or packaged `plan`, `apply`, `inspect`, `reconcile`, or `destroy`
  commands;
- guest formatting, mounting, quiescence, artifact installation, or resident
  service projection;
- external-resource configuration or an AWS planner/controller producer for
  external verification;
- migration of stored plans and heads across future fixed-graph role changes;
- the privileged host observer and publisher;
- live STS caller/session proof;
- fresh apply from a retained-binding DESTROYED tombstone;
- clean-account lifecycle proof; or
- provider API-call or lifetime-effect exactly-once execution.

Continue by wiring the aggregate and strict provider composer to the complete
observer, service-health, planner, mutation, scope, and ProviderSpec ports under
one invocation-owned AWS client family. Then expose the deployment lifecycle
through the reserved operator namespace and begin the guest
storage/service-projection proof.

## Verification and disk hygiene

Validation used pinned Node 24.13.1, serial Jest, no coverage, and no Jest
cache. Final counts are recorded after the complete V56 gate:

- focused V56 integration set: 8 suites and 275 tests passed, with the final
  16-test aggregate suite rerun after receiver-preservation hardening;
- complete deployment regression gate: 74 suites and 2,597 tests passed;
- all four TypeScript configurations: passed;
- repository lint and formatting: passed;
- `git diff --check`: passed; and
- artifact scan excluding `node_modules`: empty.

The historical `stash@{0}: WIP on master: 3dee66b work prompt` remains
untouched.
