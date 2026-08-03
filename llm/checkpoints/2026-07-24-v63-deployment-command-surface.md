# V63 deployment command surface checkpoint

Date: 2026-07-24

Parent:
[V62 durable selected SEA plan](./2026-07-24-v62-durable-selected-sea-plan.md)
(`3d5a424`)

## Restart summary

Wharfie's first golden path remains one approachable TypeScript/Node SEA that
can run locally, become a durable single-node AWS service through the user's
ordinary credential chain, and later be inspected, reconciled, updated, or
destroyed without a hosted orchestrator. Nodes are trusted. One coordinator is
acceptable initially, provided its durable authority is recoverable. V1,
backward compatibility, trustless mesh, general-purpose cloud IaC, and a web UI
remain outside the current scope.

V62 completed the CLI-free source path that packages one selected SEA, durably
stages its exact held bytes, and converges from explicit pre-staged evidence.
It deliberately stopped before mounting deployment commands. V63 mounts that
lifecycle in both the source CLI and every generated SEA while preserving the
different artifact-authority rules of those two environments.

The result is the first approachable end-to-end operator shape for the current
deployment architecture. It is still an experimental surface, not a claim that
a clean AWS account can yet reach a ready resident Wharfie service.

## Exact deployment command surface

The source CLI now mounts one fresh `deployment` parent with exactly five
leaves:

```text
wharfie deployment plan <deployment> --profile <canonical-profile.json> --control-policy <policy> [--dir <app-dir>] [--output-dir <package-dir>] [--json]
wharfie deployment apply <deployment> --profile <canonical-profile.json> [--dir <app-dir>] [--output-dir <package-dir>] [--control-policy <policy>] [--json]
wharfie deployment apply --plan <plan.json> [--control-policy <policy>] [--json]
wharfie deployment inspect <deployment-instance> --region <region> [--control-policy <policy>] [--json]
wharfie deployment reconcile <deployment-instance> --region <region> [--confirm-coordinator-stopped] [--control-policy <policy>] [--json]
wharfie deployment destroy <deployment-instance> --region <region> [--control-policy <policy>] [--json]
```

Every generated SEA mounts the same five leaves beneath
`<app> wharfie deployment ...`. Its grammar omits `--dir` and `--output-dir`
from plan and direct apply because a packaged command may authorize only the
SEA executable that is actually running. No artifact path override exists in
the packaged surface.

The finite control policies remain `require-active`, `reconcile-existing`, and
`bootstrap`. Plan requires an explicit `--control-policy`: source planning
packages and stages bytes, and `bootstrap` may create retained control
resources, so plan is not represented as universally read-only. Direct apply
defaults to `bootstrap`. Prepared apply, inspect, reconcile, and destroy default
to `require-active`.

Prepared apply accepts either the complete plan envelope or the direct
deployment/profile selection, never both. Source `apply --plan` also rejects
`--dir` and `--output-dir` instead of silently ignoring artifact selectors.
Profile, plan, region, control policy, source directory, and output directory
are single-occurrence scalar authorities; repeated values fail during command
admission before file or lifecycle I/O.

Human output is a compact non-secret table. `--json` writes the complete
JSON-safe result needed for later exact reuse. Operation failures set a nonzero
process exit code through the injected or real process port.

## Public deployment-profile authoring

DeploymentProfileV2 remains operator input outside `wharfie.app.js`. V63 adds a
public Node authoring subpath:

```js
import {
  DEPLOYMENT_MODE,
  createAwsSingleNodeProvider,
  createDeploymentProfile,
} from '@wharfie/wharfie/deployment-profile';
```

That subpath exports exactly `DEPLOYMENT_MODE`,
`createAwsSingleNodeProvider`, and `createDeploymentProfile`. It gives users a
supported way to construct the content-addressed canonical profile JSON that
both source and packaged deployment commands accept, without manually deriving
schema IDs. There is no sixth deployment CLI leaf and no provider-native
resource-graph escape hatch.

Profiles bind the application, exact Linux SEA target, fixed single-node mode,
AWS region, and capability fulfillment. They never contain AWS credentials.
Commands resolve credentials from the operator's ordinary AWS credential chain
at execution time.

## Artifact authority and plan-envelope locality

The two command mounts deliberately share grammar without pretending that
their prepared plan envelopes are interchangeable.

Source plan and direct apply call the V62 selected-SEA boundary. They package a
fresh target, retain one descriptor-backed byte authority, create an exact
apply plan, durably stage those same bytes, and use or return the frozen
`{plan, profile, artifactStage}` envelope. A later source `apply --plan`
validates only that exact durable intent, object version, and receipt. It does
not rebuild the app, reopen an artifact path, or substitute the Node executable
running the source CLI.

Packaged plan returns `{plan, profile}`. Packaged direct and prepared apply use
ordinary convergence, which re-observes and stages the currently running SEA.
The packaged command accepts no arbitrary source path and cannot consume a
source pre-staged envelope as if it proved the running executable.

Exact prepared-object key sets make this locality fail closed:

- a source envelope includes required `artifactStage` authority and is rejected
  by the packaged prepared-running path;
- a packaged envelope lacks `artifactStage` and is rejected by the source
  prepared-staged path; and
- each envelope remains JSON-safe and reusable by a later invocation of its
  own command surface.

Inspection and destroy require no executable bytes. Source reconcile uses
durable staged authority. Packaged reconcile proves the running SEA before a
new reconcile or a non-destroy recovery.

## Lifecycle orchestration and recovery fencing

The shared command factory captures one exact six-method lifecycle port:
`prepare`, `apply`, `applyPrepared`, `inspect`, `reconcile`, and `destroy`.
The AWS lifecycle layer validates exact request shapes before runtime
observation or credential opening, then uses the finite one-shot runner from
V60 for plan, inspect, staged validation, convergence, and recovery.

Located reconciliation first obtains a complete controller inspection. A new
reconcile is permitted only from exact READY authority. Running-SEA reconcile
recreates and compares the complete running DeploymentRevision with the exact
settled revision before planning. Staged reconcile validates durable artifact
evidence and uses only pre-staged convergence.

Recovery never resumes an unspecified current operation. It requires:

1. an inspection that fully correlates the active plan and durable head;
2. explicit `--confirm-coordinator-stopped`;
3. controller input exactly
   `{deploymentInstanceId, expectedPlanId}`;
4. an active or just-completed operation whose plan ID equals that inspected
   plan; and
5. all existing provider-scope, artifact-stage, intent, settlement, and CAS
   fences.

The expected plan ID is checked before profile reads, artifact validation,
recovery CAS, or provider mutation. If another operation replaces the inspected
one, recovery fails as a conflict. If the inspected operation completes during
the race, only the terminal head whose last operation carries that exact plan
ID is an idempotent success.

Packaged recovery of active create, update, or reconcile work also re-observes
the current SEA and requires the complete running revision to equal the active
plan revision before resume. Source recovery stays durable-only because its
authority is the exact staged receipt. Active destroy is the intentional
exception in both surfaces: destroy has no executable artifact authority, so
its confirmed recovery is driven only by the exact durable destroy plan,
bindings, provider evidence, and expected plan ID.

## Result and inspection correlation

Lifecycle results are not accepted merely because they are structurally valid
heads. Every returned head is correlated with the exact authorizing plan:

- deployment instance, incarnation, and provider scope must match;
- operation kind must follow the plan operation and settled basis;
- plan ID and ordered action IDs must equal the durable operation;
- plan basis generation must precede the returned head;
- settled and target revision identities must match create, update, reconcile,
  or destroy semantics; and
- successful apply/reconcile and destroy results must be terminal READY and
  DESTROYED heads respectively.

The same active-plan and last-operation-plan checks apply to controller
inspection envelopes before they can authorize reconcile, destroy, or an
already-destroyed read-through. Profile, pinned ProviderSpec, revision, scope,
incarnation, generation, and inspection status remain correlated.

A valid controller result can still be durably unfinished because provider
evidence caused the controller to publish a blocked CONVERGING or DESTROYING
head. V63 represents that case with
`AwsDeploymentOperationIncompleteError` and code
`AWS_DEPLOYMENT_OPERATION_INCOMPLETE`. Commands exit nonzero and direct the
operator to inspect state and use confirmed recovery only after the former
coordinator is known stopped.

## Bounded files and fail-closed command seams

Profile and prepared-plan files pass through one shared operator JSON reader.
It:

- opens one held descriptor with nonblocking read semantics;
- accepts only regular files;
- enforces a 4 MiB size bound before allocation;
- reads exactly the descriptor's observed size and probes for an extra byte;
- compares device, inode, mode, link count, size, modification time, and change
  time before and after the read;
- decodes fatal UTF-8 and accepts exactly one JSON object; and
- closes the descriptor on every path with ordered primary/cleanup failure
  preservation.

Path replacement cannot redirect an admitted read, FIFOs fail without waiting
for a writer, growth and ordinary same-size mutation fail closed, malformed
content is never echoed, and no test/build artifact is retained by this
boundary.

The shared command constructor captures all six operation methods as own
enumerable functions and preserves their receiver. Adapter overrides are an
exact partial own-data surface: inherited methods, accessors, symbols,
unsupported keys, and non-functions fail before falling through to production
AWS operations. Output, process, and file-reader dependencies are captured and
validated before any command action. Lifecycle results are cloned through the
strict JSON boundary before output, so accessors and non-JSON values cannot
escape through presentation.

## Mounts and packaged verification

The source `createProgram()` mounts a fresh source deployment tree beside
`app` and `ops`. The generated application's reserved operator program mounts a
fresh packaged deployment tree beside its existing manifest, metadata, durable
workflow, worker, signal, and service commands. Nested deployment names do not
replace the existing flat ledger `inspect` and `reconcile` leaves.

The packaged-process seam is forwarded to the deployment command so failures
set the selected process port rather than accidentally mutating global process
state. The SEA verifier now checks the deployment parent and all five nested
leaves in the generated executable. It also checks that packaged plan/apply
help does not advertise source-only directory or output-path authority and
executes those help surfaces with Node absent from `PATH`.

## Deliberate remaining boundary

V63 makes the intended operator workflow visible, but it does not complete the
deployment product. The next work should continue toward the compelling
project-level test: express a normal local TypeScript program, turn it into a
self-contained durable service, let it continue after the authoring session,
and keep its state and evolution approachable without requiring Node,
containers, Kubernetes, or a hosted orchestrator on the target.

The principal remaining boundaries are:

- guest storage projection into the resident node;
- resident-service activation and lifecycle integration;
- the privileged host observer and artifact/service publisher;
- exact live STS role and session proof;
- a complete clean-account AWS lifecycle;
- end-to-end deployed-service readiness evidence;
- safe reapply from a DESTROYED tombstone with retained control state; and
- exactly-once provider-effect execution semantics where an abstraction
  requires them.

External capability fulfillment remains represented but unreachable through
the fixed all-managed AWS profile and planner. Multi-node coordination,
coordinator failover beyond the current durable recovery contract, and optional
faster-language hot paths remain later work. None of those boundaries should
reintroduce V1 compatibility, general cloud IaC, trustless-mesh semantics, or a
web UI ahead of the CLI golden path.

## Verification and disk hygiene

Final assembled verification passed:

- focused V63 command, lifecycle, source-orchestration, and mount gate:
  **12 suites, 364 tests, 0 snapshots** in **90.395 seconds**;
- complete deployment regression gate: **87 suites, 3,027 tests, 0
  snapshots** in **311.909 seconds**;
- all four TypeScript configurations passed with `--noEmit`;
- full repository ESLint passed with zero warnings;
- repository JavaScript/JSON and changed-document Prettier checks passed;
- package verification retained exactly **240 files**;
- the generated-SEA verifier passed source, installed-package, clean generated
  CLI, relocated executable, managed-effect, workflow, recovery,
  reconciliation, cancellation, service, and Node-absent runtime proofs
  (**161,435,088 bytes**;
  `sha256:e8e3bf92ca087948943b1f7a06baa33afe6e3c6edacb8ac73a47bf75db67d717`);
- `git diff --check` passed; and
- post-verification repository and temporary-directory scans found no coverage,
  dist, build, cache, TypeScript build-info, package archive, generated SEA,
  package-verification directory, operator JSON directory, or stale Wharfie
  socket output.

Both Jest gates used pinned Node 24.13.1, strict serial execution, no coverage,
and no Jest cache. Generated SEA, package, dependency-install, and temporary
runtime output was removed after verification. The final repository occupied
**525 MB**, including **249 MB** for `node_modules`. The historical
`stash@{0}: WIP on master: 3dee66b work prompt` remained untouched.
