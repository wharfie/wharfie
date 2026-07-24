# V58 owned AWS deployment invocation checkpoint

Date: 2026-07-24

Parent:
[V57 production AWS provider assembly](./2026-07-24-v57-aws-provider-assembly.md)

## Restart summary

Wharfie's first golden path remains one approachable TypeScript/Node SEA that
can run locally, become a durable single-node AWS service through the user's
ordinary credential chain, and later be inspected, reconciled, updated, or
destroyed without a hosted orchestrator. Nodes are trusted. One coordinator is
acceptable initially, provided its durable authority is recoverable. V1,
backward compatibility, trustless mesh, general-purpose cloud IaC, and a web UI
remain outside the current scope.

V57 assembled the complete controller provider under one invocation-owned AWS
client family. V58 now owns that family through a CLI-free deployment
invocation, makes retained control-resource policy explicit, and adds true
existing-only reconciliation to both control lifecycles.

## Existing-only retained control reconciliation

The retained DynamoDB table and S3 bucket lifecycles now expose separate
`inspect`, `reconcile`, and `bootstrap` capabilities.

`inspect` remains one-shot and read-only. `reconcile` may wait for and safely
strengthen only a resource that already exists. It never calls `CreateTable` or
`CreateBucket`; authoritative absence at the initial read, a write, or any
readback becomes a fixed typed missing error. `bootstrap` remains the only
capability that may create either retained resource.

The table reconciler preserves its physical TableArn and TableId across
creating-state waits and PITR readback. It rejects deletion/recreation rather
than adopting a replacement, strengthens only the exact 35-day PITR contract,
and preserves deletion protection, the sole key, disabled TTL, ownership tags,
and all earlier fail-closed schema checks.

The bucket reconciler preserves the complete public-access, ownership,
encryption, versioning, service-health lifecycle, no-policy, no-replication,
and versioned-sentinel contract. It keeps the full versioning-propagation
barrier and response-loss readback. A `NoSuchBucket` observed during a
secondary read now produces truthful mid-inspection disappearance evidence
instead of claiming that the initial `HeadBucket` proved absence.

This distinction closes a real time-of-check/time-of-use hole. Calling
`inspect` and then `bootstrap` is not existing-only: the resource could be
deleted between those calls and bootstrap could recreate it. Lifecycle-native
`reconcile` keeps the no-create rule true across the entire operation.

## Owned deployment invocation

`createAwsSingleNodeDeploymentInvocationFromClientFamily` transfers a
successfully composed V57 client family into one exact frozen surface:

- `providerScope`;
- `inspectControl`, `requireControl`, `reconcileControl`, and
  `bootstrapControl`;
- controller `plan`, `converge`, and `resume`; and
- `close`.

Construction is pure. It composes the fixed table and bucket lifecycles, the
branded DynamoDB control store, S3 artifact stager, V57 provider, and durable
controller without issuing a client operation, bootstrapping a resource, or
closing anything. A family is claimed only after every constructor succeeds
and cannot be transferred into a second invocation.

`inspectControl` waits for both read-only inspections and returns one frozen
schema-v1 aggregate scoped to the canonical provider identity. `requireControl`
performs the same reads and fails with a fixed not-ready error unless both
resources are active. `reconcileControl` and `bootstrapControl` first complete
both inspections before starting either paired mutation. Every pair uses
all-settled ordering with deterministic table-before-bucket error precedence,
so one fast failure cannot return while the other started operation still owns
a client.

`plan`, `converge`, and `resume` each require a fresh active control aggregate
before delegating the exact input to the controller. None silently bootstraps,
maps an active operation to recovery, or chooses an operation for the caller.
Recovery remains the explicit `resume({deploymentInstanceId})` entry point.

Starting invocation close synchronously fences every new public call. Close
waits for all already-entered calls to settle, then closes the family exactly
once and returns one memoized Promise. The open helper validates one exact
regional request, performs the ordinary credential/STS family open, and
best-effort closes a newly opened family if pure invocation transfer fails.

## Explicit non-claims and next work

V58 does not yet provide:

- a controller read-only deployment inspection entry point that hydrates the
  exact durable head, active and predecessor plans, profile, ProviderSpec, and
  InspectionV6 without mutation;
- a one-shot operation runner that opens and closes the invocation in
  `try/finally` and defines primary-operation versus cleanup-error precedence;
- source or packaged `plan`, `apply`, `inspect`, `reconcile`, or `destroy`
  commands;
- source-mode selection and ownership of an exact built SEA artifact;
- guest formatting, mounting, quiescence, artifact installation, or resident
  service projection;
- the privileged host observer and publisher or live STS role/session proof;
- external-resource configuration;
- fresh apply from a retained-binding DESTROYED tombstone;
- clean-account lifecycle proof; or
- provider API-call or lifetime-effect exactly-once execution.

The current artifact stager still proves and stages the running executable and
its embedded revision. That is correct for a packaged target SEA, but a source
command running under Node cannot honestly stage the Node executable as the
application artifact. Source apply/reconcile must later own a selected built
SEA and its exact embedded metadata; V58 does not weaken this check.

Continue by adding the controller's read-only inspection envelope, then one
operation runner with explicit control policy, selected-artifact ownership, and
unconditional invocation cleanup. Only after that boundary is proven should
the reserved source and packaged deployment command namespaces be mounted.

## Verification and disk hygiene

Validation used pinned Node 24.13.1, serial Jest, no coverage, and no Jest
cache. Final counts after the complete V58 gate:

- focused V58 integration set: 4 suites and 135 tests passed;
- complete deployment regression gate: 77 suites and 2,691 tests passed;
- all four TypeScript configurations: passed;
- repository lint and formatting: passed;
- `git diff --check`: passed; and
- artifact scan excluding `node_modules`: empty.

The repository remains 523 MiB including the existing 249 MiB
`node_modules`; the gate left no coverage, build, distribution, Jest cache,
TypeScript build-info, or package-tarball artifact.

The historical `stash@{0}: WIP on master: 3dee66b work prompt` remains
untouched.
