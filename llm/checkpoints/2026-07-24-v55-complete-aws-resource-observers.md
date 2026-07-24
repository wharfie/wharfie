# V55 complete AWS resource observers checkpoint

Date: 2026-07-24

Parent:
[V54 runtime IAM observers](./2026-07-24-v54-runtime-iam-observers.md)

## Restart summary

Wharfie's first golden path remains one approachable TypeScript/Node SEA that
can run locally, become a durable single-node AWS service through the user's
ordinary credential chain, and later be inspected, reconciled, updated, or
destroyed without a hosted orchestrator. Nodes are trusted. One coordinator is
acceptable initially, provided its durable authority is recoverable. V1,
backward compatibility, trustless mesh, general-purpose cloud IaC, and a web UI
remain outside the current scope.

V54 completed the four runtime IAM observers. V55 adapts the final private read
kernels to V47's shared raw observation boundary:

- the deterministic managed-current artifact;
- the EC2 substrate node and its root volume; and
- both retained-volume attachments through one generic observer.

All 18 graph roles can now be routed through the 16 mutation-incapable observer
families defined by V47. This checkpoint deliberately stops before those
individual reads are assembled into one lossless InspectionV6 document. The
current V5 resource shape cannot carry V47's bounded execution advice.

## Pure evidence without mutation authority

Each completed mutation driver and observer shares only immutable provider
response, physical-state, lifecycle, identity, and digest evidence. Create,
update, delete, start, attach, detach, retention repair, mutation-response
handling, settlement, effect fencing, candidate memory, and client lifecycle
remain private to the mutation drivers.

Every observer:

- accepts only caller-owned read methods;
- recreates V48 target-local authority before provider I/O;
- revalidates the complete durable binding and dependency lineage appropriate
  to its graph role;
- distinguishes actual provider drift from ownership conflict;
- never adopts unbound provider state;
- returns deeply frozen V47 observations; and
- can recommend execution only where an exact current create reproduces a
  stable provider client token.

## Managed artifact

The artifact observer receives only `HeadObject` and `ListObjectVersions`. It
audits the complete bounded exact-key version namespace, including every
immutable content version and delete marker, before interpreting the current
alias. Duplicate opaque IDs, impossible latest flags, cycling or malformed
cursors, oversized history, missing immutable versions, foreign metadata, and
inconsistent aliases fail closed. A conclusive contradiction on an already
decoded page is retained even if a later page would fail.

Every immutable head recomputes ownership and state from normalized metadata,
checksum, length, encryption, storage, content type, cache policy, stage
references, and the compatible historical deployment/profile references. The
unversioned current head must be canonically identical to the audited latest
immutable head, not merely agree on VersionId, ETag, and length. Readable
content drift is verified with the actual metadata-derived digest.

A durable binding whose current alias is missing can be authoritatively absent
after a complete owned history audit, including when retained history ends in a
latest delete marker. That preserves V40's artifact-only
missing-with-binding update path; the controller's artifact destroy exception
must still execute and verify explicit-version purge until the namespace is
empty. Unbound history is never adopted. The exact current create may recover
only one desired version and no markers; empty current-create history remains
unknown. S3 conditional copy has no observer-side replay recommendation.

## Retained-volume attachments

One generic observer covers the application and control attachment roles using
only exact instance and volume reads. It re-derives the synthetic relationship
ID from the exact node, retained-volume, device, and card-zero endpoints and
re-proves both direct bindings plus their transitive graph lineage. It also
walks the complete retained-volume and substrate plan-receipt closure, including
action position, intent status, desired digest, provider identity, nonce,
create provenance, and apply-versus-destroy ordering, before provider I/O.

Presence requires the instance block-device view and volume attachment view to
agree on the same exact pair, device, and lifecycle. Exact desired state also
requires `DeleteOnTermination=false` in both views. Contradictory pairs,
devices, multiplicity, or foreign endpoint identity are conflicts; a readable
true, omitted, or disagreeing retention value remains verified with an actual
unequal digest so the existing driver can repair the attribute. The observer
itself has no modify port.

Current-delete dual-view absence is authoritative immediately when both exact
endpoints remain readable. A typed exact-ID endpoint loss can prove logical
absence only when the same instance/volume/both negative signature survives
every attempt in the configured two-through-ten retry window. One-sided views,
changing negative signatures, successful empty exact responses, transient
lifecycle, failed waits, and provider errors remain unknown. Current-create
emptiness remains unknown, and the observer never recommends attach replay or
forced detach.

## Substrate node

The substrate observer shares the node driver's immutable EC2 evidence while
retaining only read methods. It re-proves all eight direct dependency receipts
and the complete thirteen-resource upstream closure before any instance,
attribute, credit, or root-volume read.

Bound observation uses only the durable instance ID. Current-create recovery
uses complete stable-tag instance discovery followed by an independent exact-ID
read and never adopts a candidate outside the exact current action. Both paths
prove immutable instance identity, original stable client token, account,
ownership tags, dependency-bound VPC/subnet/security-group/profile topology,
Amazon-owned auto-assigned public-IPv4 provenance when required, and safe
non-root `DeleteOnTermination=false` mappings.

Readable presence joins the exact instance, all four separate instance
attributes, CPU-credit specification, and exact root volume. The actual digest
contains every readable plan-time launch field while excluding lifecycle,
ephemeral addresses, and provider-allocated instance, ENI, and root IDs. Exact
desired state reproduces the plan digest; owned physical drift remains verified
with a stable unequal digest. Instance lifecycle is projected separately:
pending is `starting`, running is raw `degraded`, stopping/stopped is `stopped`,
and shutting-down/terminated is `failed`. Only the later aggregate may join
service health and claim `healthy`.

Delete observation preserves V42's combined logical proof. The instance side
must be an exact owned terminated tombstone or typed exact-ID absence plus
complete empty instance-tag discovery. The root side must be complete empty
root-tag discovery or one exact owned unattached deleted tombstone; any retained
exact root ID additionally requires typed `InvalidVolume.NotFound` once its
tombstone is gone. When both provider tombstones have aged out, the same joint
instance/root negative signature must remain identical through every retry
attempt. A mutation response, successful empty exact response, one-sided
terminal sample, changed signature, failed page, or failed wait never proves
absence.

## Replay and exactly-once boundary

The node is the only V55 family that may emit `replay-safe-create`.

The observer recomputes the original create action's lowercase 64-hex
`RunInstances` client token from the exact action ID and ownership nonce. It may
recommend that byte-identical request only for the exact current managed/direct
create after every bounded locator attempt completes successfully and remains
empty. Any candidate, terminal tombstone, malformed or failed read,
contradiction, changing negative, pagination error, or failed wait suppresses
the recommendation. Provider truth remains unknown; the advice is separate and
does not manufacture absence or settlement.

Wharfie continues to claim evidence-backed convergence of logical resource
effects, not exactly-once provider API calls or lifetime external effects.

## Explicit non-claims and next work

V55 does not yet provide:

- aggregate InspectionV6;
- provider-complete controller composition;
- migration of stored plans and heads across future fixed-graph role additions;
- source or packaged `plan`, `apply`, `inspect`, `reconcile`, or `destroy`
  commands;
- guest formatting, mounting, quiescence, artifact installation, or resident
  service projection;
- the privileged host observer and publisher;
- one invocation-scoped caller-owned AWS client family;
- clean-account lifecycle proof; or
- provider API-call or lifetime effect exactly-once execution.

Continue by defining and assembling all 18 raw observations into the exact
InspectionV6 contract, including bounded execution advice, then compose
inspection, deterministic planning, execution, settlement, and controller
recovery behind one invocation-owned provider boundary.

## Verification and disk hygiene

Validation used pinned Node 24.13.1, serial Jest, no coverage, and no Jest
cache. The results were:

- the focused V55 gate passed 8 suites and 239 tests;
- the complete deployment regression gate passed 72 suites and 2,544 tests;
- all four TypeScript configurations passed with `--noEmit`;
- repository ESLint and JavaScript/JSON Prettier checks passed;
- changed Markdown Prettier and `git diff --check` passed; and
- the final scan excluding `node_modules` found no coverage, build, dist,
  cache, TypeScript incremental, tarball, or package output.

The historical `stash@{0}: WIP on master: 3dee66b work prompt` remained
untouched.
