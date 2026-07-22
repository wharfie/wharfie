# V47 AWS resource-observation boundary checkpoint

Date: 2026-07-22

Parent: [V46 deterministic AWS deployment planning](./2026-07-22-v46-deterministic-aws-deployment-planning.md)

## Restart summary

Wharfie's first golden path remains one approachable TypeScript/Node SEA that
can run locally, become a durable single-node AWS service through the user's
ordinary credential chain, and later be inspected, reconciled, updated, or
destroyed without a hosted orchestrator. Nodes are trusted. One coordinator is
acceptable initially, provided its durable authority is recoverable. V1,
backward compatibility, trustless mesh, general-purpose cloud IaC, and a web UI
are outside the current scope.

V46 completed deterministic plan derivation but deliberately consumed an
already validated InspectionV5. The 16 AWS action factories already contain
strict authoritative reads for all 18 graph roles, but those readers are
private and coupled to mutation-only plan, action, intent, action-index,
ownership-nonce, and artifact-stage authority. Calling settlement to inspect a
READY deployment would require fabricating an active operation and would also
collapse drift, conflict, propagation, and access failure into the wrong
settlement vocabulary.

V47 establishes the shared read-only result and routing boundary before those
read kernels are extracted. It is intentionally useful without claiming live
AWS inspection: the next slice now has one finite output contract and cannot
accidentally give aggregate inspection an execute, delete, settlement, or close
method.

## Canonical raw observation

`validateAwsSingleNodeResourceObservation` accepts exactly six fields:

- `resourceKey`;
- `presence`;
- `ownership`;
- `providerIdentity`;
- `observedDigest`;
- `health`.

The result is canonicalized and deeply frozen. The resource key must name one
of the fixed AWS single-node graph roles. Any provider identity must use that
role's exact provider type and a valid provider resource ID. Any state digest
must be a canonical SHA-256 digest.

The finite evidence combinations are:

- `absent`: missing ownership, null identity, null digest, and absent health;
- `unknown`: unknown ownership, null identity, null digest, and unknown health;
- `present`: a concrete provider identity and verified, external, or conflict
  ownership. Verified or external presence requires a normalized digest;
  conflict may omit it when state cannot be trusted safely.

The raw health vocabulary is `starting`, `degraded`, `stopped`, `failed`,
`absent`, `unknown`, or `not-applicable`. It deliberately excludes `healthy`.
Present non-substrate roles must use `not-applicable`. An exactly owned
substrate must use starting, degraded, stopped, or failed; a conflicting
substrate may additionally report unknown. Provider uncertainty about an
otherwise exact substrate uses the complete unknown observation rather than
an unprojectable present-owned/unknown-health combination. Only the later
aggregate may join the exact provider-visible service-health receipt and
upgrade the substrate and complete inspection to healthy and converged.

This boundary separates two claims that the current settlement APIs conflate:

- ownership conflict means the provider identity or ownership proof cannot be
  reconciled with authority;
- drift means ownership is exact but independently normalized observed state
  differs from desired state.

An observer must never copy a provider tag or metadata digest into
`observedDigest` merely because AWS returned it. The resource decoder must
derive the digest from the normalized provider state. The managed artifact is
the only current driver known to support a genuine owned observed digest that
may safely differ from desired; other unsupported configuration differences
remain unknown until their decoders gain an explicit normalized drift
representation, unless the difference also contradicts ownership authority.

## Exhaustive read-only router

`createAwsSingleNodeResourceObservationRouter` accepts exactly one
`observers` object with these 16 implementation families:

- managed artifact;
- retained volume;
- VPC;
- internet gateway;
- internet-gateway attachment;
- subnet;
- route table;
- default IPv4 route;
- subnet/route-table association;
- security group;
- runtime role;
- runtime role policy;
- instance profile;
- instance-profile/role association;
- substrate node;
- retained-volume attachment.

Every family value must be an exact one-method `{observe}` port. An extra
mutation, settlement, or lifecycle method is rejected at construction. The
two retained volume roles share the generic volume observer, and the two
attachment roles share the generic attachment observer; the remaining roles
have one family each.

The returned router is exactly `{observeResource}`. It resolves only
`context.target.resourceKey`, covers the complete graph in apply order, invokes
one selected observer once with the original context object, never fans out,
and validates the awaited observation against the selected resource key. A
malformed or unsupported route fails before observer I/O through one fixed,
non-echoing `AwsSingleNodeResourceObservationRouteUnsupportedError` with code
`AWS_SINGLE_NODE_RESOURCE_OBSERVATION_ROUTE_UNSUPPORTED`.

The router owns no credential, AWS client, retry loop, clock, or close method.
Those lifetimes belong to the future provider invocation composition. Each
resource observer will retain its role-specific bounded read policy; the
aggregate must not retry the whole 18-role scan or turn exhaustion into
absence.

## Driver inventory and next extraction

All six existing client families already contain the provider reads required
for observation. The remaining work is authority and decoder extraction, not
adding a broader credential client:

- artifact observation reuses exact object head and bounded version-history
  audit;
- retained volumes reuse exact-ID or tagged discovery and intrinsic EBS
  evidence;
- tagged EC2 resources reuse exact plus bounded locator discovery, with VPC
  attribute reads and subnet/security-group natural-slot corroboration;
- derived network roles reuse both endpoint projections;
- IAM roles reuse exact name/ID, tag, policy, and membership pagination;
- the substrate reuses instance, attribute, credit, and root-volume evidence,
  including its consecutive terminal-absence rule;
- attachments reuse independent instance and volume projections, including
  their consecutive endpoint-absence rule.

The next slice should introduce a separately validated observation authority
for either an exact durable binding or the one current intended create. It must
split read policy from mutation recovery, keep candidate IDs and crossed-effect
state mutation-only, preserve every strict decoder and bounded propagation
rule, and return the V47 union. It must not call `verifySettlement`, manufacture
an action or nonce for READY inspection, or adopt an unbound provider object.

After all 18 roles implement that port, aggregate inspection can:

1. independently prove the current control head;
2. build the V45 desired-target catalog;
3. observe the graph without mutation capability;
4. join the exact current service-health object only after node and runtime-role
   authority is established;
5. derive one canonical InspectionV5 in apply order; and
6. feed V46 planning and the existing controller.

## Explicit non-claims and contract gaps

V47 does not yet claim:

- any current action driver implements `{observe}`;
- aggregate InspectionV5 or a controller-complete AWS provider exists;
- source or packaged `plan`, `apply`, `inspect`, `reconcile`, or `destroy`
  commands exist;
- caller-owned AWS clients are constructed, fenced, or closed as one provider
  invocation;
- guest volumes are formatted, mounted, quiesced, or projected into a service;
- the privileged publisher proves its live STS role session; or
- a clean-account lifecycle or provider API-call exactly-once proof.

Three existing later-boundary gaps remain explicit:

- fresh apply over a DESTROYED tombstone conflicts with retained binding and
  reincarnation requirements;
- an empty DESTROYED head cannot satisfy InspectionV5's exact retained-resource
  proof; and
- InspectionV5 cannot represent absent, unknown, or conflicting external
  ownership cleanly. The first aggregate should reject external-management
  profiles or revise that schema before claiming support.

## Verification and disk hygiene

Use pinned Node 24.13.1, serial Jest, no coverage, and no Jest cache. Do not run
the repository's coverage-default test scripts for this slice.

The focused observation contract and router suite passes 59/59 tests:

```text
TZ=UTC /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node ./test/run-jest.js --runInBand --coverage=false --no-cache test/runtime/deployment-aws-resource-observation.test.js
```

The complete deployment regression passes 1,919/1,919 tests over 42 suites:

```text
TZ=UTC /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node ./test/run-jest.js --runInBand --coverage=false --no-cache test/runtime/deployment-*.test.js
```

All four TypeScript configurations pass under the pinned Node executable:

```text
node ./node_modules/typescript/bin/tsc -p tsconfig.json --pretty false
node ./node_modules/typescript/bin/tsc -p tsconfig.app-implementation.json --pretty false
node ./node_modules/typescript/bin/tsc -p tsconfig.test.json --pretty false
node ./node_modules/typescript/bin/tsc -p tsconfig.sea-verifier.json --pretty false
```

Full JavaScript lint and formatting pass, as does a targeted Markdown Prettier
check for every changed document. `git diff --check` is clean. The final
artifact scan excludes `node_modules` and finds no coverage, build, dist,
cache, TypeScript incremental, tarball, or package output. Generated artifacts
must remain absent after commit and push.

The historical stash `stash@{0}: WIP on master: 3dee66b work prompt` remains
untouched.
