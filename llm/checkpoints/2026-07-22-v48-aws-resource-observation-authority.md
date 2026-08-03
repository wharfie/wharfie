# V48 AWS resource-observation authority checkpoint

Date: 2026-07-22

Parent: [V47 AWS resource-observation boundary](./2026-07-22-v47-aws-resource-observation-boundary.md)

## Restart summary

Wharfie's first golden path remains a normal TypeScript/Node CLI that can run
locally, become a durable single-node AWS service through the user's ordinary
credentials, and later be inspected, reconciled, updated, or destroyed without
a hosted orchestration service. The eventual executable is a portable Node SEA.
Nodes are trusted. One coordinator is acceptable initially when its durable
authority can be recovered. V1 compatibility, trustless mesh, general-purpose
cloud IaC, and a web UI are outside the current scope.

V47 defined a strict seven-field raw resource observation and an exhaustive
read-only router for the fixed 18-role graph. It intentionally did not define
how one driver receives ownership authority. The existing action contexts are
not suitable: they require an already active mutation plan, current action
index, and caller-supplied ownership nonce, so using them for READY inspection
would require inventing mutation state.

V48 supplies a pure target-local observation authority. It derives every
redundant field that a provider reader needs from content-addressed deployment
documents and never accepts a binding, action, action index, or nonce directly.
It also requires the last-settled plan whenever the durable head has a completed
operation, preventing a caller from substituting a different but structurally
valid ProviderSpec. No AWS read is implemented by this checkpoint; the next
driver adapter now has one safe input contract.

## Exact input and output

`createAwsSingleNodeResourceObservationAuthority` accepts exactly eleven
fields:

- `operation`;
- `deploymentRevision`;
- `profile`;
- `providerScope`;
- `providerSpec`;
- `deploymentInstanceId`;
- `incarnationId`;
- `head`;
- `plan`;
- `settledPlan`;
- `target`.

The operation is `apply`, `reconcile`, or `destroy`. The durable head must be
non-null. `plan` is the exact active PlanV3 or null. `settledPlan` is the exact
PlanV3 named by `head.lastOperation` or null. The target is one entry from V45's
desired-resource catalog.

The returned deeply frozen canonical authority contains those eleven canonical
fields plus two derived values:

- `binding`: the target's exact durable head binding or null;
- `currentAction`: null or `{actionIndex, action, ownershipNonce}` for the one
  target-local CAS-claimed intended frontier.

The constructor performs no provider I/O, clock sampling, random generation,
candidate discovery, or adoption.

## Deployment tuple and target proof

The constructor validates the revision, profile, provider scope, ProviderSpec,
deployment-instance ID, incarnation ID, head, and nullable active and settled
plans through their existing versioned contracts. It then independently proves:

- revision profile and application identity match the exact profile;
- the instance ID is freshly derived from the revision and provider scope;
- head instance, scope, and incarnation equal the requested tuple;
- reconcile and destroy name the exact settled deployment revision; and
- apply may name the settled or one prospective revision while retaining the
  same application/profile/instance identity.

It recreates the complete V45 desired-resource target catalog from the exact
tuple and head, then requires the supplied target to equal exactly one member.
The caller cannot submit a role-shaped approximation, stale digest, observed
provider ID, or target from another revision. Once the target is selected, its
binding is looked up in the validated head. There is no input binding field to
forge or partially revalidate.

## Settled and active-plan authority

Plan presence follows the head's durable provenance:

- READY requires `plan: null` and the exact `settledPlan` named by
  `head.lastOperation`;
- an initial active create requires the exact active `plan` and
  `settledPlan: null`; and
- a resident active update, reconcile, or destroy requires both documents.

The settled plan mirrors the controller's ProviderSpec-selection proof. Its
plan ID, derived completed-operation kind, instance, incarnation, settled
revision, provider scope, strictly older basis generation, action count, and
indexed action IDs must match `head.lastOperation`. Its ProviderSpec must equal
the requested ProviderSpec and validate against the requested profile and
scope. This preserves pinned machine-image, placement, and storage choices even
when apply projects a prospective application or compatible profile revision.

A CONVERGING or DESTROYING head also requires the exact active PlanV3. V48
mirrors the controller's active-plan proof:

- plan operation, deployment revision, provider scope, ProviderSpec, instance,
  and incarnation equal the requested tuple;
- durable `planId` equals the plan document;
- operation kind is derived as create, update, reconcile, or destroy from the
  plan and head revision state;
- the plan basis generation is strictly older than the current head;
- the plan basis settled revision equals the head's settled revision;
- the head target revision is null for destroy and otherwise equals the plan
  revision; and
- intents and actions have identical cardinality and indexed action IDs.

Both running and blocked active operations remain observable. A blocked
operation is not mutation authority, but its durable intended action may need
provider readback to determine whether an effect occurred before the block.

## Frontier semantics and reachability

Only an `intended` current intent represents a completed coordinator CAS claim.
Before exposing it, V48 requires its resource key, capability, role, management,
ownership mode, dependencies, destroy policy, and desired state to match the
exact V45 target. A create must still be unbound. A managed create requires its
fresh persisted nonce; managed noncreates require the exact binding and its
nonce; external intents require null nonce. Binding identity and dependency
lineage reproduce the controller's reachability checks. Create dependencies
must have earlier settled intents and matching binding receipts, while earlier
destroy purges must be settled and unbound. Live dependency presence and purge
absence remain provider-observation evidence, not pure authority claims.

If that proven action resource key equals the selected target, V48 returns the
exact action index, action document, and persisted ownership nonce. All other
target authorities return `currentAction: null`.

A valid current `pending` intent is deliberately accepted. This is the state a
read-only operator may encounter after the operation head was created but
before a coordinator claimed the action. It exposes no current action for any
target and therefore cannot be mistaken for permission to recognize a new
create receipt. If `nextActionIndex` equals the action count, every intent must
be settled and no current action exists.

These distinctions support the next driver's three safe read modes:

- exact durable binding authority;
- one exact current intended create authority; or
- unbound observation with no adoption authority.

## Unsupported lifecycle boundary

Null head inspection belongs to the future aggregate's authoritative-absent
fast path: it produces generation zero and no resource observations, so calling
a resource observer is structurally invalid.

A syntactically valid DESTROYED head fails through the fixed non-echoing
`AwsSingleNodeResourceObservationAuthorityUnsupportedError` with code
`AWS_SINGLE_NODE_RESOURCE_OBSERVATION_AUTHORITY_UNSUPPORTED`. The controller
currently requires a fresh incarnation and empty retained bindings for reapply,
while InspectionV5 requires retained resources to remain exactly bound. V48
does not weaken or paper over that unresolved lifecycle contract.

## What remains

V48 does not yet claim:

- any of the 16 AWS action drivers exposes a read-only observer;
- raw AWS state is normalized into the V47 union;
- aggregate InspectionV5 or a controller-complete provider exists;
- a provider invocation constructs, fences, or closes the six narrow client
  families;
- source or packaged deployment commands exist;
- guest storage or service activation is wired; or
- a clean-account lifecycle or provider API-call exactly-once proof exists.

The next implementation seam is the retained-volume observer. It can reuse the
existing exact-ID `DescribeVolumes`, bounded locator-tag discovery, strict tag
and intrinsic EBS decoders, and retry policy. It must distinguish bound,
current-intended-create, and unbound authority; prove typed absence without
turning propagation failure into absence; and return conflict rather than adopt
an unbound discovered volume. That extraction should become the repeatable
pattern for the remaining direct and derived resource families.

## Verification and disk hygiene

The focused authority regression passes 23/23 tests in one suite under pinned
Node 24.13.1, serial Jest, no coverage, and no Jest cache:

```text
TZ=UTC /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node ./test/run-jest.js --runInBand --coverage=false --no-cache test/runtime/deployment-aws-resource-observation-authority.test.js
```

The complete deployment regression passes 1,942/1,942 tests over 43 suites:

```text
TZ=UTC /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node ./test/run-jest.js --runInBand --coverage=false --no-cache test/runtime/deployment-*.test.js
```

All four TypeScript configurations pass under the pinned Node executable:

```text
node ./node_modules/typescript/bin/tsc -p tsconfig.json
node ./node_modules/typescript/bin/tsc -p tsconfig.app-implementation.json
node ./node_modules/typescript/bin/tsc -p tsconfig.test.json
node ./node_modules/typescript/bin/tsc -p tsconfig.sea-verifier.json
```

Full JavaScript lint and formatting pass, as does a targeted Markdown Prettier
check for every changed document. `git diff --check` is clean. The final
artifact scan excludes `node_modules` and finds no coverage, build, dist,
cache, TypeScript incremental, tarball, or package output.

Generated coverage, build, dist, cache, TypeScript incremental, tarball, and
package artifacts must be absent before commit and after push. The historical
`stash@{0}: WIP on master: 3dee66b work prompt` remains untouched.
