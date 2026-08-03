# Wharfie checkpoint — AWS deployment control

- **Date:** 2026-07-20
- **Status:** **CREDENTIAL-BOUND AWS SCOPE AND RETAINED CONTROL TABLE PROVEN UNDER FOCUSED MOCKS**
- **Branch:** `agent/strict-manifest`
- **Parent/base head:** `76abd426c44ce0533ff8661efd17caa1148b3f38`
- **Parent checkpoint:** [recoverable deployment controller](2026-07-20-v20-recoverable-deployment-controller.md)
- **Design authority:** [project charter](../../PROJECT.md),
  [roadmap](../../ROADMAP.md), and [ADR 0021](../../docs/architecture/decisions/0021-provider-backed-single-node-deployment.md)

Wharfie's recovery protocol now reaches the first real AWS SDK boundary. One
invocation can resolve the operator's ordinary AWS credentials, prove the
exact account/partition/region through STS, create a retained DynamoDB control
table, and open the exact portable deployment store without serializing or
returning credentials.

This checkpoint proves request shape, state admission, credential binding, and
ambiguous-response recovery with focused SDK mocks. It does **not** claim that
a live AWS account has been mutated or that an application node can be
deployed yet.

## Product scope carried forward

- Nodes are trusted; a trustless mesh is out of scope.
- TypeScript/Node is the public model and SEA is the first portable packaging
  backend. Native Node-API or WASM components can later implement measured hot
  paths behind explicit boundaries.
- Wharfie exposes finite application-deployment abstractions, not a general
  cloud IaC language.
- One coordinator is sufficient initially because provider-backed durable
  truth and persisted intent let a later invocation recover.
- Exactly-once claims remain limited to managed effects with durable evidence;
  ambiguous provider calls converge through inspection.
- Breaking changes are expected, v1 is abandoned, and no downstream
  compatibility is required.

## Implemented boundary

`createAwsDeploymentAuthority({region})` now:

- requires one explicit canonical region and ignores ambient region selection;
- resolves the ordinary Node credential chain exactly once;
- copies only signing fields into one immutable, non-refreshing snapshot;
- uses that same snapshot for initial/repeated STS identity checks, the
  portable DynamoDB adapter, and a narrow DynamoDB control capability;
- derives the provider partition and account from a strict
  `GetCallerIdentity` response and refuses later identity drift;
- exposes no credential-bearing SDK configuration; and
- leaves issued data/control clients under explicit caller ownership while
  making authority and control-client closure idempotent.

The retained table lifecycle is fixed to
`wharfie-deployment-control-v1`. Read-only `inspect()` admits only:

- the exact provider-scope ARN, table name, and printable provider table ID;
- one String hash key named `record_key`;
- no local/global index, replica, or stream;
- on-demand billing and the standard table class;
- deletion protection and AWS-owned default encryption;
- the exact reserved Wharfie ownership/schema/retention/scope tags;
- disabled TTL; and
- valid point-in-time-recovery evidence.

Inspection labels the table `active` only when PITR already has the exact
35-day recovery period; otherwise it reports `bootstrap-required` without
mutating.

`bootstrap()` is the sole mutator. It creates the exact tagged table when
authoritative absence is observed and strengthens PITR to 35 days. It retries
bounded unknown/transitional reads, tolerates post-create tag propagation,
resolves lost create/update responses through exact readback of the same table
ARN and physical table ID, refuses every incompatible collision, and never
deletes or weakens the table.

The portable deployment control store remains independently strict: strong
reads, conditional immutable plan/profile insertion, full-record head CAS,
fixed versioned record keys, exact five-field envelopes, and 128 KiB record
caps.

## Explicit limitations and driver prerequisites

- No live AWS call has been made and no clean-account receipt exists.
- The fixed AWS resource driver and operator commands are not implemented.
- Recovery-safe artifact bytes need a provider control bucket and
  content-addressed staging before the controller begins mutating resources.
- The immutable plan must pin the exact regional machine image/provider spec;
  a recovering coordinator cannot safely reinterpret “latest.”
- The host runtime identity must narrowly permit artifact reads and health
  receipt writes in addition to management access.
- Final service convergence needs a read-only provider-visible receipt bound
  to instance/incarnation, SEA hash, artifact/revision, service health, and
  freshness. Inspection must not create a new command as its proof.
- The eventual AWS driver should use independently recoverable capabilities;
  one monolithic stack would create effects beyond the controller's current
  intended-action frontier.
- Provider-backed coordinator leases/fencing, multiple nodes, ingress,
  retained-state purge, and automatic coordinator replacement remain later
  milestones.

## Validation and artifact hygiene

With pinned Node 24.13.1, the two new authority/table suites pass 30 tests with
coverage disabled. The existing control-store suite passes 18 tests, the
DynamoDB read-only suite passes 1, and the DynamoDB portion of the adapter
contract passes 7. Source and test typechecks and targeted ESLint/Prettier
checks pass.

The unrelated LMDB portion of the mixed adapter-contract process currently
aborts natively with exit 134 in this workspace before Jest can report a test;
direct LMDB module import succeeds. No file in this slice changes LMDB. Every
temporary DB-contract directory left by diagnostic runs was removed. The
repository root contains no generated `coverage/`, `dist/`, `.nyc_output`, or
TypeScript build-info artifact.

Continue using direct focused Jest invocations with `--coverage=false`; the npm
test script hard-codes coverage and should not be used for iterative work.

## Preservation state

Before this slice, local and remote `agent/strict-manifest` both pointed to
`76abd426c44ce0533ff8661efd17caa1148b3f38`, preserving the durable-store
checkpoint. The historical local stash remains untouched as
`stash@{0}: WIP on master: 3dee66b work prompt`. The commit containing this
checkpoint becomes the next restart point after it is pushed and its exact
remote tip is verified.

## Ordered next work

1. Define the provider control-artifact bucket, content-addressed staging
   record, pinned machine-image/provider spec, narrow node identity, and
   provider-visible health receipt as one recovery-safe contract slice.
2. Implement the fixed AWS driver as independent network, identity, retained
   volume, artifact, and node capabilities with exact ownership evidence and
   response-loss recovery.
3. Compose the authority, table, store, driver, and controller behind source
   and packaged `plan`, `apply`, `inspect`, `reconcile`, and `destroy`
   commands, including running-SEA revision re-observation.
4. Prove create, interruption recovery, update/reconcile, and ownership-safe
   destroy in a disposable clean account, record exact receipts, and remove
   all purge resources.
5. Repair or explain the local LMDB native contract abort without allowing it
   to distract from the provider golden path.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-20-v21-aws-deployment-control.md` on branch
> `agent/strict-manifest`. Use only the local git CLI; do not spend time on PRs
> or issues. Breaking changes are fine, v1 is abandoned, and no downstream
> users exist. The exact credential-bound AWS authority, fixed retained
> DynamoDB table lifecycle, and portable deployment control store are
> implemented and pass focused no-coverage tests under SDK mocks; no live AWS
> claim has been made. Define recovery-safe artifact staging, pin the exact
> machine-image/provider spec, narrow the runtime identity and health receipt,
> then implement the independent-capability AWS driver and packaged commands.
> Preserve trusted-node scope, one-recoverable-coordinator semantics,
> evidence-backed effects, ordinary user credential chains, and exact
> ownership checks. Clean every generated test/build artifact immediately.
