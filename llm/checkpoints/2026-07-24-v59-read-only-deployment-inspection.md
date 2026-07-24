# V59 read-only deployment inspection checkpoint

Date: 2026-07-24

Parent:
[V58 owned AWS deployment invocation](./2026-07-24-v58-owned-aws-deployment-invocation.md)

## Restart summary

Wharfie's first golden path remains one approachable TypeScript/Node SEA that
can run locally, become a durable single-node AWS service through the user's
ordinary credential chain, and later be inspected, reconciled, updated, or
destroyed without a hosted orchestrator. Nodes are trusted. One coordinator is
acceptable initially, provided its durable authority is recoverable. V1,
backward compatibility, trustless mesh, general-purpose cloud IaC, and a web UI
remain outside the current scope.

V58 established one CLI-free invocation that owns the complete AWS client
family and separates retained-control inspection, existing-only
reconciliation, explicit bootstrap, controller operations, and close. V59 adds
the missing read-only deployment inspection boundary and makes a completed
destroy truthfully observable without granting new action authority.

## Exact controller inspection envelope

The deployment controller now exposes
`inspect({deploymentInstanceId})`. The request is an exact one-key surface. The
result is one exact frozen envelope with keys in this order:

- `schemaVersion`;
- `kind`;
- `deploymentInstanceId`;
- `status`;
- `head`;
- `activePlan`;
- `lastOperationPlan`;
- `profile`;
- `providerSpec`; and
- `inspection`.

Every result has `schemaVersion: 1` and
`kind: deploymentControllerInspection`.

An absent durable head returns `status: absent` and null for all six document
fields: `head`, `activePlan`, `lastOperationPlan`, `profile`, `providerSpec`,
and `inspection`. This fast path performs no provider operation. It does not
invent a desired revision, profile, provider specification, incarnation, or
resource observation from the opaque deployment-instance identity.

A live or destroyed head hydrates the exact active plan when an operation is
in flight and the exact plan named by `head.lastOperation` when present. It
independently validates both plans against the head, loads and validates their
stored profile, requires a common pinned ProviderSpec, and revalidates the
ambient provider scope. The active plan is inspection authority when present;
otherwise the last-operation plan is authority. The provider then produces
one fresh InspectionV6 from those exact documents.

The controller validates the inspection's immutable context and returns its
status unchanged. In particular, `unknown` and `conflict` remain
operator-visible data. They are not promoted to action authority and are not
rejected merely because mutation would fail closed.

Inspection performs no ProviderSpec selection, deterministic planning,
artifact staging or validation, durable write, compare-and-set, action
execution, or settlement. Missing or inconsistent stored lineage fails closed
instead of selecting replacement inputs.

## Completed-destroy observation

The final DESTROYED head previously could not enter the resource-observation
authority. It can now be inspected only through the exact destroy plan named
by its `lastOperation`. The destroy plan, head, profile, ProviderSpec,
incarnation, scope, action receipts, and resource bindings remain fully
correlated before any observer runs.

The completed destroy plan and its settled intent receipts can reconstruct
historical provider locators after purge bindings have been removed. Those
locators are read authority only: they do not prove ownership, presence, or
absence. The substrate and both retained-volume attachment relationships use
their locators for fresh exact and collision reads. Attachment absence requires
bounded stable evidence from both the historical instance and retained volume;
a surviving, detaching, busy, or unreadable attachment remains unknown.

Some provider relationships have no independently readable identity once an
endpoint is gone. Their absence can be inferred only through a finite,
contract-specific containment table and only from fresh authoritative absence
of an endpoint whose provider lifecycle necessarily contains that
relationship. This never replaces present, conflict, or other stronger
evidence.

InspectionV6 reports `destroyed` only after every resource role is resolved by
complete exact evidence:

- each retained resource remains present with the required verified or
  external ownership, binding, dependency lineage, and matching desired and
  observed state; and
- each purged resource is authoritatively absent with no residual provider
  identity, binding, dependency binding, or observed digest.

Conflict and uncertainty retain their stronger status precedence. Completed
destroy observation is read authority only. Fresh apply from a
retained-binding DESTROYED tombstone remains unsupported.

## Read barriers and exact request snapshots

Every concurrent deployment read fanout now uses a drain barrier. All admitted
siblings settle before the operation returns, and deterministic contract order
selects the canonical strongest error. A rejected sibling therefore cannot
leave another provider or store read running outside the invocation lifetime.

The controller's shared exact-object boundary accepts only plain or
null-prototype objects with the required enumerable own data properties. It
rejects symbols, accessors, non-enumerable properties, class instances, and
extras, then snapshots descriptor values into a frozen canonical request.
The owned invocation also takes an accessor-safe independent deep JSON
snapshot of every controller request before its control preflight begins.
Deferred work cannot later observe caller mutation or trigger a request getter.

## Owned invocation exposure and lifetime

The exact frozen AWS deployment invocation now exposes ten keys:

- `providerScope`;
- `inspectControl`, `requireControl`, `reconcileControl`, and
  `bootstrapControl`;
- controller `inspect`, `plan`, `converge`, and `resume`; and
- `close`.

Top-level `inspect` is intentionally distinct from `inspectControl`. The
former observes one durable deployment; the latter observes the retained
DynamoDB and S3 control resources themselves.

Every deployment inspection first performs a fresh read-only require-active
preflight for both controls. It never reconciles or bootstraps them. The
invocation delegates the admitted exact input snapshot with the controller
receiver and returns the exact controller envelope without wrapping or
rewriting it.

The control preflight and controller inspection are one admitted invocation
operation. Starting close synchronously fences all later public calls, waits
for an already-entered inspection to settle, and then closes the client family
once through the existing memoized close promise. The preflight is not an
atomic lock on retained resources; a later disappearance remains a truthful
store or provider failure.

## Explicit non-claims and next work

V59 does not yet provide:

- a one-shot operation runner that opens and unconditionally closes an
  invocation, selects explicit inspect/reconcile/bootstrap control policy, and
  defines primary-operation versus cleanup-error precedence;
- source-mode selection and ownership of one exact built SEA plus its embedded
  revision and runtime metadata;
- source or packaged `plan`, `apply`, `inspect`, `reconcile`, or `destroy`
  commands;
- guest formatting, mounting, quiescence, artifact installation, or resident
  service projection;
- the privileged host observer and publisher or live STS role/session proof;
- external-resource configuration;
- fresh apply from a retained-binding DESTROYED tombstone;
- clean-account lifecycle proof; or
- provider API-call or lifetime-effect exactly-once execution.

The current artifact stager still proves and stages the running executable and
its embedded revision. That remains correct for a packaged target SEA. A
source command running under Node cannot honestly stage the Node executable as
the application artifact; its future runner must own a selected built SEA and
validate its exact embedded metadata.

Continue by adding one operation runner with explicit control policy, exact
selected-SEA authority, unconditional cleanup, and defined operation-versus-
cleanup error precedence. Only after that boundary is proven should the
reserved source and packaged deployment command namespaces be mounted.

## Verification and disk hygiene

Final assembled verification passed:

- focused V59 integration set: **9 suites, 318 tests, 0 snapshots** in
  **166.126 seconds**;
- complete deployment regression gate: **77 suites, 2,734 tests, 0
  snapshots** in **308.491 seconds**;
- all four TypeScript configurations passed with `--noEmit`;
- full repository ESLint passed with zero warnings;
- repository JavaScript/JSON and changed-document Prettier checks passed;
- `git diff --check` passed; and
- the artifact scan excluding `node_modules` found no coverage, dist, build,
  cache, TypeScript build-info, or package archive output.

Both Jest gates used pinned Node 24.13.1, serial execution, no coverage, and no
Jest cache. The repository occupied **523 MB**, including **249 MB** for
`node_modules`, after verification. The historical
`stash@{0}: WIP on master: 3dee66b work prompt` remained untouched.
