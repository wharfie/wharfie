# V57 production AWS provider assembly checkpoint

Date: 2026-07-24

Parent:
[V56 InspectionV6 aggregate and controller](./2026-07-24-v56-inspection-aggregate-controller.md)

## Restart summary

Wharfie's first golden path remains one approachable TypeScript/Node SEA that
can run locally, become a durable single-node AWS service through the user's
ordinary credential chain, and later be inspected, reconciled, updated, or
destroyed without a hosted orchestrator. Nodes are trusted. One coordinator is
acceptable initially, provided its durable authority is recoverable. V1,
backward compatibility, trustless mesh, general-purpose cloud IaC, and a web UI
remain outside the current scope.

V56 completed the controller-facing seven-method provider contract. V57 now
assembles that contract from the real AWS scope, ProviderSpec, service-health,
16 observer-family, planning, and six mutation-client implementations under one
explicitly owned invocation lifetime.

## One ordinary-chain client family

`openAwsDeploymentClientFamily` resolves one credential-bound deployment
authority for one explicit region. That authority already snapshots the user's
ordinary AWS credential chain and resolves one redacted STS provider scope.
V57 transfers it exactly once into a frozen family containing:

- the canonical provider scope;
- one receiver-preserving scope resolver;
- the durable DynamoDB store adapter;
- DynamoDB and S3 control clients;
- the ProviderSpec reader; and
- the managed-artifact, volume, network, runtime-identity, node, and
  volume-attachment resource clients.

Raw clients are retained only as cleanup owners. Every public client is a
frozen exact-method projection, so injected SDK objects, credential fields,
factories, and unrelated methods cannot escape the family. The durable-store
projection retains its DynamoDB adapter identity. Every operation preserves
the raw owner's receiver, exact arguments, synchronous throw, return value, and
Promise identity.

The caller owns the complete family. Starting family close synchronously fences
scope resolution and every child operation. Child close is separately
memoized, all child closes are attempted in reverse acquisition order, and the
credential authority is closed only after every child attempt settles. Repeated
and concurrent close calls return the same Promise. Partial construction and
shutdown failures perform the same best-effort cleanup and expose only fixed,
redacted typed errors.

Family construction creates client objects but performs no table or bucket
bootstrap and no resource operation. Opening a family performs only the
credential resolution and caller-identity work already owned by the authority.

## Complete production provider composition

`createAwsSingleNodeDeploymentProviderFromClientFamily` is a pure constructor.
It validates the exact family surface, retains no lifecycle authority, and
returns only the frozen seven methods consumed by the deployment controller.
The caller remains responsible for closing the family.

The constructor narrows the full clients into 16 independent read projections
covering all 18 graph roles. Shared network and IAM clients are projected
separately for each observer, preserving each observer's least-capability
surface. Managed-artifact observation uses only object-head and version-history
reads; node observation uses the exact instance, attribute, credit, and volume
reads; and attachment observation uses only instance and volume reads.

The same assembly also narrows:

- the ProviderSpec reader to its five required SSM, EC2, and EBS reads;
- the S3 control client to the exact service-health object operations, and
  then narrows the resulting health capability to inspection only; and
- the six mutation-capable resource clients into the exhaustive action router.

All observers and effects share one bounded retry policy. ProviderSpec,
inspection, and health share the supplied clock. Construction performs no AWS
read, write, close, bootstrap, or controller action.

## Explicit non-claims and next work

V57 does not yet provide:

- an invocation/operator facade that chooses when to open, bootstrap, inspect,
  run the controller, and close the client family;
- source or packaged `plan`, `apply`, `inspect`, `reconcile`, or `destroy`
  commands;
- automatic creation or recovery policy for the retained control table and
  bucket;
- a controller read-only inspection entry point;
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

Continue with one explicit invocation facade. It must keep control-resource
bootstrap and recovery decisions visible, distinguish read-only inspection
from controller mutation, and own the client family through completion. Only
then mount the reserved source and packaged deployment command namespace.
Guest storage and resident-service projection remain the next service-readiness
proof; current AWS composition alone is not a deployed-service claim.

## Verification and disk hygiene

Validation used pinned Node 24.13.1, serial Jest, no coverage, and no Jest
cache. Final counts after the complete V57 gate:

- focused V57 integration set: 7 suites and 282 tests passed;
- complete deployment regression gate: 76 suites and 2,642 tests passed;
- all four TypeScript configurations: passed;
- repository lint and formatting: passed;
- `git diff --check`: passed; and
- artifact scan excluding `node_modules`: empty.

The repository remains 522 MiB including the existing 249 MiB
`node_modules`; the gate left no coverage, build, distribution, Jest cache,
TypeScript build-info, or package-tarball artifact.

The historical `stash@{0}: WIP on master: 3dee66b work prompt` remains
untouched.
