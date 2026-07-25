# V62 durable selected SEA plan checkpoint

Date: 2026-07-24

Parent:
[V61 selected SEA artifact authority](./2026-07-24-v61-selected-sea-artifact-authority.md)

## Restart summary

Wharfie's first golden path remains one approachable TypeScript/Node SEA that
can run locally, become a durable single-node AWS service through the user's
ordinary credential chain, and later be inspected, reconciled, updated, or
destroyed without a hosted orchestrator. Nodes are trusted. One coordinator is
acceptable initially, provided its durable authority is recoverable. V1,
backward compatibility, trustless mesh, general-purpose cloud IaC, and a web UI
remain outside the current scope.

V61 created one process-local, linear authority over a freshly packaged and
held SEA but stopped before transferring that authority into durable provider
state. V62 closes that gap. A source process can now package, plan, durably
stage, and either return portable pre-staged evidence or directly converge it
without rebuilding, reopening a path, or substituting its running Node
executable.

Deployment commands are deliberately not mounted yet.

## Claimed-source staging

`createDeploymentArtifactStager()` now exposes the exact frozen surface
`{stageClaimedArtifact, stageRunningArtifact, validateStagedArtifact}`.

`stageClaimedArtifact()` consumes the seven-field V61 claim. Before durable or
provider mutation it:

- descriptor-snapshots the transferred claim while retaining any source it has
  already acquired for cleanup;
- snapshots the held source's observation and captures its stream,
  unchanged-verification, and close methods with their receiver;
- validates the complete generation-backed ArtifactRecord against the held
  observation and ApplicationRevision;
- recreates the DeploymentRevision from that same observation, embedded
  runtime, deployment, and profile and requires exact equality with the bound
  revision; and
- cross-checks artifact, application, revision, target, profile, and provider
  scope identity.

Claimed and running staging then share the same durable core: immutable intent
creation/adoption, exact-version receipt reuse, checksum-enforced upload,
post-upload held-source verification, provider readback, and durable receipt
creation/adoption. Claimed staging never opens a path or reads running or
embedded process identity.

The stager owns a claimed source once its call returns normally and closes it
exactly once on every success or failure path. Primary and close failures
retain their original values; simultaneous failures produce one ordered
AggregateError with primary first. If a later claim descriptor trap fails after
the source descriptor was captured, that source is still closed.

## Source preparation and direct apply

`prepareAwsSelectedSeaPlan()` and `applyAwsSelectedSea()` accept the exact
`{packageRequest, deployment, profile, controlPolicy}` request. Admission
validates the deployment logical ID, profile, and explicit
`require-active`/`reconcile-existing`/`bootstrap` policy before packaging.
Packaging is entered synchronously so the V61 boundary snapshots its request
in the caller's current turn.

The source orchestrator then:

1. binds the selected authority to the admitted deployment and profile;
2. opens one owned AWS invocation in the profile's region;
3. applies the selected control policy;
4. creates and validates one exact `apply` plan;
5. atomically claims the source for that plan's exact provider scope;
6. enters invocation staging with no intervening await;
7. validates the returned durable intent and receipt; and
8. closes the invocation after staging has settled.

Before claim, failure cleanup discards the selected authority and then closes
the invocation. After claim, the stager owns asynchronous cleanup. The
orchestrator retains fallback source cleanup only until the invocation accepts
the synchronous transfer, closing it before the invocation if transfer throws.
Non-Error primary, source-cleanup, discard, and invocation-cleanup failures are
preserved in occurrence order.

`prepareAwsSelectedSeaPlan()` returns only the deeply frozen, JSON-safe
`{plan, profile, artifactStage}` after the exact immutable intent, non-null
object version, and receipt are durable and revalidated. No descriptor, path,
token, credential authority, or invocation escapes.

`applyAwsSelectedSea()` uses the same invocation and stage result, stages once,
and directly calls `convergePreStaged()` with that exact prepared bundle.

## Explicit pre-staged convergence

The controller now exposes a distinct
`convergePreStaged({plan, profile, artifactStage})` contract. It shares fresh
plan acceptance and operation execution with ordinary converge, but artifact
acceptance is mode-specific:

- ordinary `converge` calls only `stageRunningArtifact` and remains the
  packaged, currently running SEA path;
- pre-staged converge calls only `validateStagedArtifact`;
- the canonical durable stage must exactly equal the canonical submitted
  intent and receipt before controller plan/profile persistence, CAS, or
  provider effects; and
- destroy requires literal `artifactStage: null` and bypasses both stager
  methods.

There is no running-executable fallback in the pre-staged path.

The invocation exposes both modes and retains claimed-source staging as a
non-JSON capability. The one-shot operation runner adds only the explicit
external `converge-pre-staged` operation, mapped to
`invocation.convergePreStaged`. A later process can therefore consume the
portable prepared result after independently establishing control and opening
fresh credentials, while arbitrary JSON can never dispatch a source claim.

## Deliberate remaining boundary

The next slice should mount source and packaged `plan`, `apply`, `inspect`,
`reconcile`, and `destroy` commands while preserving the artifact-authority
split:

- source plan/apply selects and pre-stages a freshly packaged SEA;
- packaged apply/reconcile continues to prove the currently running SEA; and
- later-process source convergence consumes only explicit pre-staged evidence.

Command design must not package an artifact for operations that do not require
one, silently switch converge modes, or expose the invocation and selected
authority as general callback seams.

After commands, the priority remains guest storage projection,
resident-service activation, privileged host observation and publishing, and a
clean-account lifecycle proof through the user's ordinary credential chain.
Live STS role/session proof, DESTROYED-tombstone reapply, and provider-effect
exactly-once execution also remain unfinished.

## Verification and disk hygiene

Final assembled verification passed:

- selected-authority and source-orchestration gate: **2 suites, 65 tests, 0
  snapshots** in **0.596 seconds**;
- complete deployment regression gate: **78 suites, 2,823 tests, 0
  snapshots** in **314.798 seconds**;
- all four TypeScript configurations passed with `--noEmit`;
- full repository ESLint passed with zero warnings;
- repository JavaScript/JSON and changed-document Prettier checks passed;
- `git diff --check` passed; and
- the artifact scan excluding `node_modules` found no coverage, dist, build,
  cache, TypeScript build-info, or package archive output.

Both Jest gates used pinned Node 24.13.1, serial execution, no coverage, and no
Jest cache. The repository occupied **524 MB**, including **249 MB** for
`node_modules`, after verification. The historical
`stash@{0}: WIP on master: 3dee66b work prompt` remained untouched.
