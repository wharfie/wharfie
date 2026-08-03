# V54 runtime IAM observers checkpoint

Date: 2026-07-24

Parent:
[V53 derived network observers](./2026-07-23-v53-derived-network-observers.md)

## Restart summary

Wharfie's first golden path remains one approachable TypeScript/Node SEA that
can run locally, become a durable single-node AWS service through the user's
ordinary credential chain, and later be inspected, reconciled, updated, or
destroyed without a hosted orchestrator. Nodes are trusted. One coordinator is
acceptable initially, provided its durable authority is recoverable. V1,
backward compatibility, trustless mesh, general-purpose cloud IaC, and a web UI
remain outside the current scope.

V53 completed read-only observation of the fixed network path. V54 extends the
same raw observation boundary to all four runtime IAM graph roles:

- the direct runtime role;
- its derived inline policy;
- the direct instance profile; and
- the derived role/profile association.

This checkpoint stops before observation of the managed artifact, substrate
node, and retained-volume attachments. It also stops before aggregate
InspectionV5, controller composition, operator commands, and guest projection.

## Shared evidence without shared mutation authority

The four mutation drivers and observers now share strict, pure IAM response,
pagination, identity, tag, policy-document, and membership evidence. Mutation
requests, effect fences, response candidates, execution, settlement, and client
lifecycle stay private to the drivers.

Every observer:

- accepts only the caller-owned IAM and, for profile deletion evidence, EC2
  read methods it needs;
- recreates V48 observation authority and compares its factory scope, durable
  binding, current action, and exact dependency lineage before provider I/O;
- re-derives the deterministic account-global role and profile names;
- proves immutable AWS RoleId and InstanceProfileId values whenever a durable
  binding exists;
- retains page-local ownership conflicts even if a later page or parallel read
  fails;
- derives readable physical drift from actual provider state instead of
  relabeling it as ownership conflict; and
- returns only the shared raw observation contract with `execution: none`.

Both legacy `NoSuchEntity` and the AWS SDK's `NoSuchEntityException` spelling
are recognized where typed IAM absence is relevant.

## Direct runtime role

The role observer uses exact-name reads and complete bounded tag, inline-policy,
attached-policy, and profile-membership inventories. An owned readable role
must retain its immutable RoleId, path, ARN, description, session duration,
EC2-only trust, absent permissions boundary, complete ownership tags, and only
the graph-supported child surfaces.

Readable intrinsic differences produce a verified observation with an actual
digest. During the exact current create, a readable role whose state differs
from that create's desired state is a conflict rather than an adopted repair
target. Current delete accepts the supported descendants while they remain and
still rejects any foreign inline policy, managed policy, or profile.

Typed name absence beneath a durable binding remains unknown, including during
delete, because IAM name reads are eventually consistent and do not prove the
immutable bound identity was authoritatively removed. Only an unbound target
with no current action can become absent after every bounded attempt is clean.
Role creation has no client token, so the observer never recommends replay.

## Derived inline policy

The inline-policy observer re-proves the exact artifact and runtime-role
receipts before reading the role, inline-policy inventory, attached-policy
inventory, and fixed policy document. The synthetic policy ID remains a
RoleId-plus-policy-name receipt rather than provider evidence.

Presence requires the role's immutable identity and ownership plus complete
agreement between the policy list and exact document. Semantic document drift
is verified with an actual policy digest, except that drift during the exact
current create is a conflict. Foreign inline names, any managed policy, a
recreated role, or contradictory list/document evidence remains a conflict.

A completely clean bounded absence history can prove the derived slot absent
outside a current create. Current-create emptiness remains unknown. IAM inline
policy writes expose no stable replay token, so execution advice remains
`none`.

## Direct instance profile

The profile observer uses exact-name and tag reads plus complete regional EC2
use discovery. Readable presence re-proves the immutable InstanceProfileId,
path, ARN, ownership receipt, and the graph-supported zero-or-one role shape.
Membership itself stays a separate derived graph role and is excluded from the
profile's intrinsic digest.

Physical profile drift is returned as verified actual state, while the exact
current create treats a mismatched readable profile as a collision. A current
delete can be authoritatively absent only when the exact profile name is
unbound and regional instance-use discovery is also complete and empty.
Absence under a durable profile binding remains unknown. Profile creation has
no client token and receives no replay recommendation.

## Derived role/profile association

The association observer re-proves the role, policy, and profile receipts,
including the policy's transitive artifact lineage. It then joins the profile's
role membership with the role's complete profile inventory. Presence requires
both independent views to agree on the exact immutable endpoints. One-sided
membership propagation remains unknown; foreign or multiple endpoints are
conflicts.

Clean bidirectional empty membership proves absence after the full bounded
window. The same is true when every read projection agrees that one endpoint
has been deleted, the surviving exact endpoint remains owned and readable, and
its opposite membership view is empty: IAM cannot retain the relationship
without both endpoints, and requiring both deleted parents to remain readable
would strand an already-absent edge. Any asymmetric endpoint read, dirty
attempt, failed page, or nonempty surviving membership suppresses absence.
Current-create emptiness always stays unknown, and no replay advice is emitted.

## Explicit non-claims and next work

V54 does not yet provide:

- observers for the managed artifact, substrate node, or retained-volume
  attachments;
- aggregate InspectionV5;
- provider-complete controller composition;
- migration of stored plans and heads across future fixed-graph role additions;
- source or packaged `plan`, `apply`, `inspect`, `reconcile`, or `destroy`
  commands;
- guest formatting, mounting, quiescence, or service projection;
- one invocation-scoped caller-owned AWS client family;
- clean-account lifecycle proof; or
- provider API-call or lifetime effect exactly-once execution.

Continue with the managed artifact, substrate node, and generic
retained-volume attachment observers. Build aggregate InspectionV5 and
controller composition only after those final implementation families share
the raw observation boundary.

## Verification and disk hygiene

Validation used pinned Node 24.13.1, serial Jest, no coverage, and no Jest
cache. The results were:

- the 13 runtime-IAM evidence, mutation, and observer suites passed 290/290
  tests;
- all four TypeScript configurations passed with `--noEmit`;
- repository ESLint and JavaScript/JSON Prettier checks passed;
- changed Markdown Prettier and `git diff --check` passed; and
- the final scan excluding `node_modules` found no coverage, build, dist,
  cache, TypeScript incremental, tarball, or package output.

The historical `stash@{0}: WIP on master: 3dee66b work prompt` remained
untouched.
