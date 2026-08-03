# V46 deterministic AWS deployment planning checkpoint

Date: 2026-07-22
Branch: `agent/strict-manifest`
V45 parent preserved at:
`16372b6a2bf13656fe03d2751fbc137953b18211`

This checkpoint follows the
[V45 AWS desired-resource targets checkpoint](./2026-07-22-v45-aws-desired-resource-targets.md).
V45 made every desired role and durable provider identity available through one
pure catalog. V46 deterministically joins that catalog to fresh InspectionV5
evidence and emits the complete controller-compatible PlanV3. It does not yet
claim aggregate AWS inspection, complete provider composition, operator
commands, or a live AWS lifecycle.

## Product direction remains unchanged

Wharfie is a Node-first framework for turning approachable TypeScript CLI
programs with named activities into portable Node SEA executables that can run
locally, remain resident as durable workers, and coordinate work across trusted
machines without requiring Node, containers, Kubernetes, or a hosted
orchestration service at the destination.

The executable may use the operator's ordinary provider credentials to create
the resources required by Wharfie's fixed abstractions. This is not general
cloud IaC, v1 compatibility is abandoned, and there are no known downstream
users. Breaking internal APIs are allowed when they shorten the path to the
intended design. One coordinator is acceptable initially if durable state and
fencing permit robust recovery after coordinator loss.

## Exact pure planner boundary

`createAwsSingleNodeDeploymentPlan` accepts exactly the nine own fields passed
by the deployment controller's `createPlan` port:

- `operation`;
- `deploymentRevision`;
- `profile`;
- `providerScope`;
- `providerSpec`;
- `deploymentInstanceId`;
- `incarnationId`;
- `head`, which may be null; and
- `inspection`.

The function performs no provider I/O, samples no clock, allocates no nonce or
other random value, and adopts no provider state. It returns the deeply frozen,
content-addressed DeploymentPlanV3 produced by the existing canonical plan
boundary. Every result covers all 18 graph roles in topological apply order or
exact reverse destroy order. Its basis names the exact inspection ID, durable
head generation, and settled deployment revision.

The controller context- and freshness-validates InspectionV5 with its sampled
clock before invoking `createPlan`. That exact provider call deliberately does
not carry the clock. The pure planner therefore revalidates the serialized
inspection structure and content ID, then independently checks the deployment
tuple, provider-spec identity, head and control-state authority, graph order,
roles, desired digests, provider identities, and binding receipts that affect
planning. It must not invoke the full contextual freshness validator a second
time without the controller's clock.

## Deterministic apply and reconcile

An absent head requires authoritative absent control-state evidence with
generation zero, a null inspection incarnation, and no resource observations.
The plan nevertheless uses the controller's fresh requested incarnation and
creates all 18 roles in graph order. The managed-current artifact carries its
preallocated stable ARN; every other unbound target leaves its future
provider-allocated ID null.

A READY head may plan the settled deployment revision or a prospective
different revision. V45's target catalog was corrected so READY no longer pins the future
request to the head's previous `targetDeploymentRevisionId`; reconcile and
destroy equality remain explicit planner and controller lifecycle rules.

For each READY resource:

- an exact owned present resource whose observed digest equals the freshly
  derived desired digest becomes `noop` with reason `already-converged`;
- an authoritatively absent unbound resource becomes `create` with reason
  `missing`;
- the bound managed-current artifact alone may become `update`, preserving its
  ARN and durable binding, with reason `drift` for reconcile or
  `deployment-change` for a prospective apply; and
- every unbound present resource, non-artifact bound absence, unsupported
  non-artifact drift, ownership mismatch, unknown/conflicting observation, or
  desired-digest mismatch fails closed through the fixed non-echoing
  `AWS_SINGLE_NODE_DEPLOYMENT_PLAN_UNSUPPORTED` error.

The planner never emits `verify` under the fixed all-managed AWS profile and
never uses an observed provider identity to fill a missing durable binding.
Missing unbound leaf roles can be recreated only because the durable binding
graph already forbids a bound descendant with dangling dependency lineage.

## Reverse destroy and effect-ahead recovery

Destroy requires a READY head with the complete exact 18-binding graph. Actions
follow reverse dependency order:

- the 16 purge roles receive `delete` with reason `destroy-requested`; and
- the application-state and control-state volumes receive identical
  before/after `noop` actions with reason `retained-data`.

An authoritatively absent purge resource still gets a delete action with its
canonical desired target as `before`, allowing verification to remove the
durable binding. Non-artifact effects already absent are not unnecessarily
repeated. The artifact delete still executes because absence of its current
object does not prove that noncurrent versions and delete markers are gone.

A present purge role binds `before` to the fresh observed digest so the
controller can re-prove the exact inspection before mutation. The artifact and
both retained-volume attachment relationships must equal desired state before
delete because those three current drivers require the canonical digest. The
other thirteen purge drivers accept any non-null freshly observed digest after
exact ownership proof. This explicit matrix preserves current driver
compatibility without claiming a general in-place repair mechanism.

InspectionV5 may report `destroyed` while the durable head is still READY when
provider effects completed ahead of controller persistence. V46 admits that
evidence for destroy: absent purge actions settle their bindings away, retained
volumes remain exact, and the controller can publish the DESTROYED tombstone.
The same status does not authorize apply or reconcile.

## Known DESTROYED reapply gap

Fresh apply from a DESTROYED tombstone remains unreachable under the present
fixed retained-volume contract. The controller permits a new incarnation only
when the destroyed head has no retained bindings. InspectionV5 simultaneously
requires both retained roles to remain present with verified ownership, which
requires those exact head bindings. Keeping the bindings makes the controller
refuse reapply; removing them makes a contextual destroyed inspection
impossible.

V46 rejects this state instead of inventing evidence, adopting retained
resources, or weakening controller ownership. A future lifecycle version must
explicitly decide whether retained state is abandoned, deleted, exported, or
adopted into a fresh incarnation.

## What this slice does not claim

V46 does not yet claim:

- shared authoritative read-only resource observation or aggregate AWS
  inspection;
- owned credential, client, planner, router, settlement, and controller
  composition;
- source or packaged `plan`, `apply`, `inspect`, `reconcile`, or `destroy`
  commands;
- guest volume formatting, mounting, unmounting, quiescence, or application
  service activation;
- privileged health publisher identity, live STS caller proof, successful
  bootstrap/IMDS enforcement, or a pinned-host smoke test;
- repair or replacement of drifted provider-allocated resources; or
- a clean-account AWS lifecycle or API-call exactly-once semantics.

The next seam is to expose the existing driver read kernels through one shared
authoritative observation contract and compose all 18 observations into
InspectionV5 without duplicating provider decoders. Owned provider/controller
composition can then join inspection, deterministic planning, action routing,
settlement, credentials, and client lifecycle before command wiring and live
proof.

## Verification and disk hygiene

Run pinned Node 24.13.1, serial Jest, no coverage, and no Jest cache:

```sh
TZ=UTC /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node ./test/run-jest.js --runInBand --coverage=false --no-cache test/runtime/deployment-aws-plan.test.js

TZ=UTC /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node ./test/run-jest.js --runInBand --coverage=false --no-cache test/runtime/deployment-aws-plan.test.js test/runtime/deployment-aws-desired-resource-targets.test.js

TZ=UTC /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node ./test/run-jest.js --runInBand --coverage=false --no-cache 'test/runtime/deployment-.*\.test\.js'

env PATH=/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin:/usr/local/bin:/usr/bin:/bin /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node /Users/josephvandrunen/.nvm/versions/node/v24.13.1/lib/node_modules/npm/bin/npm-cli.js run typecheck

/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node /Users/josephvandrunen/.nvm/versions/node/v24.13.1/lib/node_modules/npm/bin/npm-cli.js run lint:js

/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node /Users/josephvandrunen/.nvm/versions/node/v24.13.1/lib/node_modules/npm/bin/npm-cli.js exec -- prettier --check README.md ROADMAP.md docs/README.md docs/architecture/decisions/0021-provider-backed-single-node-deployment.md llm/checkpoints/2026-07-22-v46-deterministic-aws-deployment-planning.md

git diff --check

find . -path './node_modules' -prune -o \( -name coverage -o -name dist -o -name build -o -name .cache -o -name '*.tsbuildinfo' -o -name '*.tgz' \) -print
```

The focused planner suite passes **29/29 tests**. The planner and desired-target
catalog together pass **71/71 tests** across two suites. These cases cover exact
input and output contracts, canonical determinism and deep immutability,
null-head creation, READY same- and different-revision projection, artifact drift
and missing-object update, partial graph creation, no adoption, fail-closed
unsupported evidence, complete reverse destroy, retained resources,
already-absent and effect-ahead destroy recovery, and the driver-specific
drift-delete matrix. The aggregate deployment gate passes **1,860/1,860
tests** across 41 suites. No coverage, build, cache, TypeScript incremental,
tarball, or other generated repository artifact is retained.
