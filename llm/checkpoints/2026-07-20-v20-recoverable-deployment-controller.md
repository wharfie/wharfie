# Wharfie checkpoint — recoverable deployment controller

- **Date:** 2026-07-20
- **Status:** **STRICT SINGLE-NODE DEPLOYMENT RECOVERY PROTOCOL PROVEN WITH A DETERMINISTIC PROVIDER**
- **Branch:** `agent/strict-manifest`
- **Parent/base head:** `6707ca0de77ee51a664811abc2cc3aa1c6138d98`
- **Parent checkpoint:** [bounded packaged runtime extraction](2026-07-20-v19-bounded-runtime-extraction.md)
- **Design authority:** [project charter](../../PROJECT.md),
  [roadmap](../../ROADMAP.md), and [ADR 0021](../../docs/architecture/decisions/0021-provider-backed-single-node-deployment.md)

Wharfie's next product proof is now bounded precisely. A packaged TypeScript
CLI should be able to become a persistent service on one AWS node using the
operator's ordinary credentials, while a later process can inspect and resume
the deployment without trusting the original chat, laptop, plan document, or
coordinator process.

This slice deliberately proves the identity and recovery protocol before
making cloud calls. It does **not** claim that Wharfie can deploy to AWS yet.
The AWS control-store adapter, fixed resource driver, packaged operator
commands, and clean-account proof remain next.

## Product scope carried forward

- Nodes are trusted; a trustless mesh is out of scope.
- Node/TypeScript is the public application model and SEA is the first portable
  packaging backend. Hot paths may later use Node-API or WASM behind explicit
  boundaries.
- Wharfie is not a general IaC language. It offers finite versioned deployment
  shapes whose implementations may use private provider mechanisms.
- One coordinator is enough initially because provider-backed truth, CAS, and
  persisted intent let another coordinator recover after it fails.
- Exactly-once claims require Wharfie-managed effects and durable destination
  evidence. Arbitrary provider calls remain potentially ambiguous and recover
  by inspection and convergence.
- Breaking changes are expected: there are no known downstream users and v1
  compatibility is deliberately abandoned.

The motivating experience remains: write a small local CLI, package it as one
approachable executable, turn it into a durable cloud service, and let later
human or coding-agent sessions inspect and evolve the same intent.

## Implemented contract

The pure runtime now defines:

- `DeploymentProfileV2` in the fresh `wpr2` namespace for exactly one
  `single-node-systemd-user` AWS fulfillment, one explicit region, Linux
  glibc x64/arm64, encrypted retained application/control volumes, private
  purged artifact storage, SSM-only host management, public egress without
  ingress, and no serialized credentials or arbitrary provider graph;
- `DeploymentRevisionV1`, binding a human deployment ID to one exact
  application revision, SEA artifact, and deployment profile;
- production revision construction from embedded records and the held running
  executable bytes rather than a caller-selected path or sidecar;
- a secret-free AWS provider scope and stable deployment-instance identity
  that include partition, account, and region;
- fresh incarnation IDs plus owned resource bindings carrying exact provider
  identity, scope, logical key, creating action, and an independent random
  ownership nonce;
- bounded provider inspections that distinguish authoritative absence from
  unknown access failure and identity conflict, and require exact healthy
  artifact/revision service evidence before reporting convergence;
- deterministic bounded plans whose structural validity is explicitly not
  mutation authority; and
- a content-addressed, generation-CAS deployment head with positive-generation
  tombstones and an ordered `pending -> intended -> settled` action frontier.

The provider-neutral controller persists the immutable profile and accepted
plan before the head references them. Immediately before any mutation it
re-resolves ambient provider scope, freshly reads the head, reinspects provider
state, and requires the driver to regenerate the exact plan. It CAS-publishes
an action intent before the physical effect, freshly rechecks scope and exact
ownership immediately before each action, reuses the same action ID and
ownership nonce on retry, requires a post-effect inspection with matching
desired and observed state before settlement, and requires another final fresh
inspection before `READY` or `DESTROYED`.

Every non-create action names and preserves one exact physical provider
identity. Fresh conflict or unknown ownership evidence cannot authorize an
effect, final-inspection ambiguity remains visibly blocked, and explicit
`resume` CAS-claims the stopped coordinator's operation so two successors do
not execute the same intended action concurrently.

Recovery needs only the deployment-instance ID. It reloads the stored head,
plan, and profile. If a coordinator died after publishing intent or after the
provider effect but before settlement, the successor verifies the same action
and resumes without inventing new authority. Scope drift, stale plans, binding
drift, access uncertainty, and losing CAS races fail closed.

## Explicit limitations

- The durable store and provider are test doubles; no AWS API is called.
- No source or packaged `deployment` command is mounted yet.
- Apply/reconcile command wiring must re-observe the exact running SEA revision
  before invoking this controller.
- The first AWS resource topology and service bootstrap are not implemented.
- Provider-backed coordinator leasing/fencing, multiple nodes, node
  replacement, ingress, external/adopted nodes, and retained-state purge are
  outside this slice.
- Fresh apply after destroy is refused while retained bindings exist; safe
  retained-state adoption needs its own future authority protocol.
- A stored plan or resource tag never authorizes a mutation by itself.

## Validation and artifact hygiene

With pinned Node 24.13.1, the focused deployment profile, revision, provider
contract, head, and controller suites pass 92 tests with coverage disabled.
Source and test typechecks, ESLint for every changed JavaScript file, Prettier, and
`git diff --check` pass. No full repository suite or package build was run for
this pure-contract slice; the parent checkpoint records the last full baseline
of 109 suites and 1,819 passing tests.

The repository root contains no generated `coverage/`, `dist/`, or test
temporary directory after validation. Continue using focused
`--coverage=false` tests and remove generated artifacts immediately.

## Preservation state

Before this slice, local and remote `agent/strict-manifest` both pointed to
`6707ca0de77ee51a664811abc2cc3aa1c6138d98`, so the remote already preserved
the complete prior state. The historical local stash remains untouched as
`stash@{0}: WIP on master: 3dee66b work prompt`. The commit containing this
checkpoint is the implementation restart point; after pushing, the remote
branch is its exact backup.

## Ordered next work

1. Implement a provider-backed linearizable deployment store with immutable
   plan/profile documents and full-record generation CAS.
2. Implement the fixed AWS single-node inspection/planning/effect driver and
   exact ownership evidence, then test its ambiguous-response recovery against
   deterministic AWS boundaries.
3. Mount source and packaged `deployment plan/apply/inspect/reconcile/destroy`
   commands, including running-SEA revision re-observation.
4. Prove create, crash recovery, update/reconcile, and ownership-safe destroy
   in a disposable clean AWS account while recording and then removing test
   resources.
5. Begin provider-backed coordinator replacement only after the single-node
   lifecycle and store fencing are real.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-20-v20-recoverable-deployment-controller.md` on
> branch `agent/strict-manifest`. Use only the local git CLI; do not spend time
> on PRs or issues. Breaking changes are fine, v1 is abandoned, and there are
> no downstream users, so optimize for the smallest path to the ideal design.
> The strict AWS-shaped deployment profile, exact running-SEA revision,
> provider scope, owned bindings, inspection, deterministic plan, durable head,
> and provider-neutral crash-resumable controller are implemented and focused
> tests pass. They use a fake store/provider and make no cloud claim. Build the
> smallest provider-backed linearizable control store and fixed AWS driver
> next, then mount packaged commands. Preserve trusted-node scope,
> one-recoverable-coordinator semantics, evidence-backed effects, and ordinary
> user credential chains. Use focused tests with `--coverage=false` and clean
> generated artifacts immediately.
