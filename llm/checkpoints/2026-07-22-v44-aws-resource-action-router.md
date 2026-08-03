# V44 AWS resource action router checkpoint

Date: 2026-07-22
Branch: `agent/strict-manifest`
V43 parent preserved at:
`86ce9b25dff403fd938e85fbef0b9882a49c1826`

This checkpoint follows the
[V43 recoverable retained-volume attachments checkpoint](./2026-07-22-v43-recoverable-volume-attachments.md).
V43 completed the last resource-level effect driver in the fixed graph. V44
makes every implemented effect reachable through one strict controller action
boundary without pretending that aggregate AWS inspection or planning already
exists.

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

## One exhaustive action boundary

`deployment-aws-resource-router.js` constructs the 16 existing resource
factories once and maps all 18 resource keys in the canonical apply order. Six
caller-owned narrow clients are shared only within their intended family:

- managed artifact: `artifact`;
- retained volume: `application-state` and `control-state`;
- network: the eight VPC, gateway, relationship, subnet, route-table, route,
  association, and security-group roles;
- runtime identity: role, inline policy, instance profile, and role/profile
  association;
- node: `substrate`; and
- retained-volume attachment: `application-state-attachment` and
  `control-state-attachment`.

The router accepts one common bounded retry policy. Because the node and
volume-attachment observers require at least two samples for their terminal
absence proofs, a composed override must be from two through ten attempts.
Omitting it preserves each driver's own default.

## Authority is forwarded, not reconstructed

Both `executeAction` and `verifySettlement` select exactly one handler from
`context.action.resourceKey` and pass the original context object by identity.
The router does not rebuild the plan, action, intent, head, ownership nonce,
artifact-stage receipt, profile, or dependency bindings. The selected driver
continues to revalidate that complete authority before every provider read or
mutation.

Routing never fans out. A missing, malformed, empty, inherited, or unknown
resource key raises `AwsSingleNodeResourceRouteUnsupportedError` with the fixed
code `AWS_SINGLE_NODE_RESOURCE_ROUTE_UNSUPPORTED` and one non-echoing message
before any resource handler is called. Once a valid handler is selected, its
existing fixed provider error is preserved rather than being relabeled by the
router.

## Client ownership remains explicit

The router validates the exact six closable client families and their required
method unions before constructing any driver. It also validates every factory
result as the exact two-function execution/settlement port before accepting the
route table. It neither resolves credentials nor creates, replaces, exposes,
or closes a client. The future provider composition will obtain these clients
from one credential-bound invocation authority, own their lifecycle, fence
calls during shutdown, close every issued client even after partial failure,
and close the authority last.

This separation keeps deterministic dispatch independent from credential and
shutdown lifecycle while preventing accidental cross-family AWS access.

## What this slice does not claim

V44 does not yet claim:

- a shared read-only resource observation port or fresh aggregate AWS
  inspection;
- deterministic production `createPlan` derivation;
- a controller-complete provider exposing scope, ProviderSpec, inspection,
  planning, execution, settlement, and close together;
- source or packaged deployment commands;
- guest volume formatting, mounting, unmounting, quiescence, or application
  service activation;
- privileged health publisher identity, live STS caller proof, or successful
  bootstrap/IMDS enforcement; or
- a clean-account AWS lifecycle or API-call exactly-once semantics.

The next implementation seam is a pure 18-role desired-resource target catalog
using the state-digest helpers already shared with the effect drivers. Resource
drivers must then expose their existing authoritative read kernels through one
read-only observation contract; aggregate inspection should reuse those
kernels rather than duplicating provider decoders. Deterministic planning and
owned provider composition can sit on those two boundaries.

## Verification and disk hygiene

The isolated router suite uses ESM factory doubles and exercises all 36
dispatches: 18 resource keys across execution and settlement. It proves the
explicit key-to-factory map, single construction, shared-client boundaries,
unchanged context identity, no fanout, inherited-field rejection, fixed
unsupported-route failure, handler-error preservation, exact option/client
validation, factory-port validation, and the frozen two-port surface. A
separate smoke test constructs all 16 real production factories through the
same common option contract.

Run pinned Node 24.13.1, serial Jest, no coverage, and no Jest cache:

```sh
TZ=UTC /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node ./test/run-jest.js --runInBand --coverage=false --no-cache test/runtime/deployment-aws-resource-router.test.js test/runtime/deployment-aws-resource-router-real-factories.test.js

TZ=UTC /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node ./test/run-jest.js --runInBand --coverage=false --no-cache test/runtime/deployment-*.test.js

env PATH=/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin:/usr/local/bin:/usr/bin:/bin /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node /Users/josephvandrunen/.nvm/versions/node/v24.13.1/lib/node_modules/npm/bin/npm-cli.js run typecheck

/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node /Users/josephvandrunen/.nvm/versions/node/v24.13.1/lib/node_modules/npm/bin/npm-cli.js run lint:js

git diff --check

find . -path './node_modules' -prune -o \( -name coverage -o -name dist -o -name build -o -name .cache -o -name '*.tsbuildinfo' -o -name '*.tgz' \) -print
```

The two focused suites pass **11/11 tests**. The aggregate deployment gate
passes **1,789/1,789 tests** across 39 suites. No coverage, build, cache,
TypeScript incremental, tarball, or other generated repository artifact is
retained.
