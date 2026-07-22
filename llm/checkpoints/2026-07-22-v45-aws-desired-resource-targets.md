# V45 AWS desired-resource targets checkpoint

Date: 2026-07-22
Branch: `agent/strict-manifest`
V44 parent preserved at:
`49b0b9578f9a0745538e47da1274a37012ad0cf2`

This checkpoint follows the
[V44 AWS resource action router checkpoint](./2026-07-22-v44-aws-resource-action-router.md).
V44 made all 18 graph effects reachable through one strict dispatch boundary.
V45 adds the pure desired-resource input needed before production planning,
without claiming that Wharfie can yet inspect or deploy the aggregate graph.

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

## One exact pure input

`createAwsSingleNodeDesiredResourceTargetCatalog` accepts exactly seven own
fields:

- `deploymentRevision`;
- `profile`;
- `providerScope`;
- `providerSpec`;
- `deploymentInstanceId`;
- `incarnationId`; and
- `head`, which may be null.

The revision, profile, provider scope, ProviderSpec, deployment-instance ID,
incarnation, and any head must describe one exact authority. A different
incarnation is admitted only after an empty destroyed head. Operation state,
pending bindings, clocks, and provider observations are not accepted inputs.

## One deterministic 18-role catalog

The result is a deeply frozen array in the resource graph's canonical apply
order. Its 18 entries retain each role's exact resource key, capability, role,
management mode, ownership mode, dependencies, destroy policy, and provider
type. Every target state digest is freshly derived by the existing effect
helper for that role from the supplied immutable authority; no persisted or
observed digest is copied into desired state.

The managed-current artifact is the one identity known before provider
mutation, so its stable
`artifact/v1/<deploymentInstanceId>/<incarnationId>/current` ARN is always
present. Every other unbound `providerResourceId` is null. Even when all of a
derived role's dependencies are bound, the catalog does not invent that role's
missing durable binding.

## Durable bindings are re-proved

The catalog carries a binding's provider ID forward only after revalidating
its complete resource-graph markers, profile-derived management mode,
ownership and destroy policy, provider type, deployment context, incarnation,
and exact dependency-binding receipts. Direct EBS, EC2 network, IAM, and node
IDs are rechecked against their resource families. All seven derived provider
identities are recomputed from their exact bound endpoints and, where
applicable, fixed ProviderSpec inputs.

The pre-existing relationship-ID formulas for the internet-gateway
attachment, default IPv4 route, and subnet/route-table association are now
exported for this shared proof. Their domains, prefixes, input ordering, and ID
algorithms are unchanged, while their newly public boundaries now reject
malformed fixed-CIDR and EC2 identifiers before hashing. The downstream route
and association drivers use those exported helpers instead of retaining private
copies. Runtime policy, role/profile association, and both retained-volume
attachment formulas already provided the other four derived identities.

This is validation of durable controller lineage, not provider discovery. The
catalog has no observation parameter, adopts nothing from AWS, and never
guesses a provider-allocated non-artifact ID.

## What this slice does not claim

V45 does not yet claim:

- deterministic production `createPlan` derivation;
- a shared read-only resource observation port or aggregate AWS inspection;
- controller-complete credential/client/provider composition;
- source or packaged deployment commands;
- guest volume formatting, mounting, unmounting, quiescence, or application
  service activation;
- privileged health publisher identity, live STS caller proof, or successful
  bootstrap/IMDS enforcement; or
- a clean-account AWS lifecycle or API-call exactly-once semantics.

The next seam is deterministic `createPlan` derivation from this target catalog
and validated fresh inspection. The resource drivers must also expose their
existing authoritative read kernels through one shared observation contract so
aggregate inspection does not duplicate provider decoders. Owned provider and
controller composition can then join target derivation, inspection, routing,
settlement, and client lifecycle.

## Verification and disk hygiene

Run pinned Node 24.13.1, serial Jest, no coverage, and no Jest cache:

```sh
TZ=UTC /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node ./test/run-jest.js --runInBand --coverage=false --no-cache test/runtime/deployment-aws-desired-resource-targets.test.js test/runtime/deployment-aws-default-ipv4-route-resource.test.js test/runtime/deployment-aws-internet-gateway-attachment-resource.test.js test/runtime/deployment-aws-subnet-route-table-association-resource.test.js

TZ=UTC /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node ./test/run-jest.js --runInBand --coverage=false --no-cache 'test/runtime/deployment-.*\.test\.js'

env PATH=/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin:/usr/local/bin:/usr/bin:/bin /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node /Users/josephvandrunen/.nvm/versions/node/v24.13.1/lib/node_modules/npm/bin/npm-cli.js run typecheck

/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node /Users/josephvandrunen/.nvm/versions/node/v24.13.1/lib/node_modules/npm/bin/npm-cli.js run lint:js

/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node /Users/josephvandrunen/.nvm/versions/node/v24.13.1/lib/node_modules/npm/bin/npm-cli.js exec -- prettier --check README.md ROADMAP.md docs/README.md docs/architecture/decisions/0021-provider-backed-single-node-deployment.md llm/checkpoints/2026-07-22-v45-aws-desired-resource-targets.md

git diff --check

find . -path './node_modules' -prune -o \( -name coverage -o -name dist -o -name build -o -name .cache -o -name '*.tsbuildinfo' -o -name '*.tgz' \) -print
```

The focused target-catalog suite passes **42/42 tests**. With the three affected
relationship drivers, the focused gate passes **288/288 tests** across four
suites. The catalog cases prove exact input and output shapes, canonical order
and deep immutability, fresh deterministic digests, null/partial/complete and
active/destroyed head behavior, phase-specific revision authority, incarnation
projection, strict context and graph validation, ten direct-ID families, all
seven derived identity formulas, malformed exported-helper input rejection,
and rejection of observation or other unsupported inputs. The aggregate
deployment gate passes **1,831/1,831 tests** across 40 suites. No coverage,
build, cache, TypeScript incremental, tarball, or other generated repository
artifact is retained.
