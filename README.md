<h1 align="center">
  <img src="./docs/assets/beanie.svg" alt="Wharfie Beanie Logo" width="200">
  <br>
  Wharfie
  <br>
  <br>
</h1>

<p align="center">
  <a href="https://github.com/wharfie/wharfie/actions/workflows/ci.yml"><img src="https://github.com/wharfie/wharfie/actions/workflows/ci.yml/badge.svg" alt="Wharfie CI"></a>
</p>

> **Project reset:** Wharfie's v1 Athena/table implementation has been removed. Wharfie remains experimental, and breaking changes are expected while the new application model is made coherent.

Wharfie is a local-first TypeScript application runtime that turns an ordinary CLI into a portable executable, then lets that same application become a durable, observable service across trusted machines without an architectural rewrite.

The product goal is continuity:

1. Write and run a normal CLI locally.
2. Mark named operations as durable activities.
3. Package the application as one approachable executable.
4. Promote it to a persistent service on one machine.
5. Add schedules, workflows, retries, and durable state.
6. Enroll more trusted nodes when placement or resilience requires them.
7. Inspect, intervene in, update, and roll back the application through the same executable.

No separate service rewrite, preinstalled Node runtime, Dockerfile, Kubernetes cluster, or hosted orchestration service should be required on the target machine.

Inside a packaged application, normal argv belongs to the application. Wharfie
reserves only `<app> wharfie <command>` for operator commands; internal service
startup uses a private environment-selected runtime command instead of
consuming public commands.

Local and single-node use should require no external Wharfie control plane. The initial automatic coordinator-failover design does depend on a linearizable durable store.

The abandoned v1 source and dependency graph have been deleted. The strict v2
manifest and the append-only V9 manual run → invocation → attempt → effect
ledger are now defined; the superseded mutable Operation/Action snapshot store
is gone. Its redacted per-service history directory is transactionally bound to
each run transition, while revision-backed source and SEA activities consume
one frozen target dependency closure instead of ambient `node_modules` or a
newly resolved npm tree. Exact-run inspection, confirmed recovery, and
authenticated current-owner cancellation use one shared source/SEA operator
layer; packaged commands bind authority to their embedded application identity.
Source `wharfie ops run` and packaged `<app> wharfie run` now also use one
durable activity host. The source adapter supplies a sealed prepared revision;
the packaged adapter accepts only its cross-checked embedded manifest and
revision/runtime pair and exposes no source-directory override. Operator and
private runtime dispatch choose their path before authored CLI code is loaded.

Foreground durable `ops run` execution has an authenticated current-owner
cancellation path. Source `wharfie ops cancel` and packaged `<app> wharfie
cancel` can reach only the exact live, same-principal LMDB foreground owner of
a `STARTED` manual attempt. The required stable `--request-id` is reused after
a lost response. That owner persists intent before beginning physical delivery;
an inactive, stale, unreachable, or merely resident owner never triggers a
direct-write fallback. A verified completion or failure may still win the
ledger race, while ambiguous post-cancellation termination becomes blocked
`UNCERTAIN` work. Blocked work can now be resolved only through an explicit,
evidence-backed reconciliation event: a complete bounded Activity Protocol
transcript proves one retained abandoned attempt's terminal outcome, while the
physical attempt itself stays `ABANDONED`. The local command transport is not
yet supported on Windows. V9 carries forward verifier-backed managed effects
through the framed source/SEA worker boundary and exposes one finite public
operation: `application-state` / `put-if-absent`. Its LMDB destination
atomically commits the business value with a permanent effect receipt.
Confirmed source/SEA
recovery now settles the complete active-effect set—at most 16 unresolved
effects—for one stopped attempt under the held LMDB owner. A retained `PENDING`
request becomes `CANCELLED` without opening application state; every `STARTED`
sibling is probed read-only, with an exact receipt becoming `COMPLETED` or
`FAILED` and strict absence becoming `UNCERTAIN`. One append-only transaction
applies all sibling dispositions and blocks the arbitrary stopped activity
attempt. Unsupported, missing, or corrupt destination evidence leaves the whole
set unchanged. Recovery never reruns application or adapter code. Destination-
finalized reconciliation can now resolve one retained `UNCERTAIN` built-in
effect without resolving the abandoned activity. One narrow public successor
policy can authorize a fresh application-state V2 `put-if-absent` target only
after the exact source effect is permanently `NOT_APPLIED`. Its dedicated
effect-only lifecycle starts fresh target identities and never redispatches the
abandoned authored activity. The source stays `BLOCKED` / `UNCERTAIN`.

The public packaged command's Node-absent relocated-SEA crash/recovery matrix
passes across every successor publication and transaction boundary, including
redaction and response-loss replay. Generic handler retries, compensation,
persistent scheduling, and wider exactly-once claims remain unfinished.
Earlier V8 real-child coverage exercises seven source/core durable-run
`SIGKILL` boundaries and three mixed-set recovery
boundaries. A relocated SEA with Node absent from `PATH` proves the complete
eight-boundary managed-effect matrix, three-boundary mixed-settlement matrix,
and four-disposition effect-reconciliation matrix, including exact orphan-
payload reuse and LMDB owner recovery. Those paths never dispatch authored
app/CLI/activity code or the normal adapter. Persistent scheduling, workflow
continuations, resident-service lifecycle, and public run history/listing are
the next durable-service work. The npm package remains deliberately private.
It is not ready for production use.

## Start here

- [Project charter](PROJECT.md) — the canonical problem, scope, public concepts, boundaries, and success test.
- [Documentation](docs/README.md) — source-first installation, quickstart, application structure, design decisions, and project-reset history.
- [Architecture decisions](docs/architecture/decisions/README.md) — accepted constraints on trusted nodes, coordination, provisioning, effects, and language boundaries.
- [Roadmap](ROADMAP.md) — the live ordered cleanup and implementation plan.
- [V9 managed-effect successor checkpoint](llm/checkpoints/2026-07-19-v9-managed-effect-successors.md) — the historical pre-mount restart point for the first causally linked fresh-identity retry policy and its internal relocated-SEA proof.
- [V8 destination-effect reconciliation checkpoint](llm/checkpoints/2026-07-18-v8-destination-effect-reconciliation.md) — the preceding restart point after destination-finalized uncertain-effect reconciliation and its relocated-SEA crash matrix.
- [Relocated-SEA mixed-settlement checkpoint](llm/checkpoints/2026-07-18-relocated-sea-mixed-settlement-sigkill-matrix.md) — the preceding restart point after proving packaged stopped-attempt settlement across mixed sibling dispositions.
- [Relocated-SEA managed-effect checkpoint](llm/checkpoints/2026-07-18-relocated-sea-managed-effect-sigkill-matrix.md) — the preceding restart point after repeating managed-effect crash recovery through the moved SEA.
- [Shared packaged durable-run checkpoint](llm/checkpoints/2026-07-18-shared-packaged-durable-run-host.md) — the historical point that unified source and packaged foreground durable execution and proved a moved-SEA managed effect with exact replay.
- [Real-process managed-effect crash checkpoint](llm/checkpoints/2026-07-18-real-process-managed-effect-crash-matrix.md) — the preceding restart point after proving the source/core and compound-recovery `SIGKILL` matrices and the narrower packaged-operator response-loss boundary.
- [V7 atomic effect-settlement checkpoint](llm/checkpoints/2026-07-18-v7-atomic-effect-settlement.md) — the preceding restart point after closing stopped-attempt sibling sets in one bounded transaction.
- [Public effects and receipt-recovery checkpoint](llm/checkpoints/2026-07-18-public-effects-and-receipt-recovery.md) — the preceding restart point after exposing finite application state and closing its first singular stopped-runner recovery window.
- [July 2026 checkpoint](llm/checkpoints/2026-07-16-project-reset.md) — immutable historical evidence of the pre-reset state and conversation handoff.
- [Packaging salvage checkpoint](llm/checkpoints/2026-07-16-packaging-salvage.md) — historical first implementation proof and the release blockers that existed before v1 deletion.
- [V1 deletion checkpoint](llm/checkpoints/2026-07-16-v1-deletion.md) — historical deletion boundary and evidence.
- [Strict v2 manifest checkpoint](llm/checkpoints/2026-07-16-strict-v2-manifest.md) — historical strict public-boundary handoff.
- [Atomic operation-store checkpoint](llm/checkpoints/2026-07-16-atomic-operation-store.md) — historical atomic snapshot and fencing boundary.
- [Immutable identity-spine checkpoint](llm/checkpoints/2026-07-17-immutable-identity-spine.md) — historical identity and artifact boundary.
- [Mutable Operation/Action retirement checkpoint](llm/checkpoints/2026-07-17-mutable-operation-retirement.md) — historical deletion boundary after making the append-only V3 ledger the only writable durable run model.
- [V5 managed-effect foundation checkpoint](llm/checkpoints/2026-07-18-v5-managed-effect-foundation.md) — historical internal persisted-effect boundary before destination binding and public application state.
- [Evidence-backed uncertain-reconciliation checkpoint](llm/checkpoints/2026-07-18-evidence-backed-uncertain-reconciliation.md) — historical predecessor for the V4 terminal-resolution event, shared source/SEA operator command, and final local branch cleanup.
- [Authenticated current-owner cancellation checkpoint](llm/checkpoints/2026-07-18-authenticated-current-owner-cancellation.md) — parent checkpoint for the narrow external cancellation contract.
- [V4 durable-cancellation checkpoint](llm/checkpoints/2026-07-17-durable-cancellation-v4.md) — historical foreground durable-before-signal boundary.
- [Shared source/SEA ledger-operator checkpoint](llm/checkpoints/2026-07-17-shared-source-sea-ledger-operator.md) — historical boundary after unifying exact-run inspection/recovery and binding packaged operators to embedded app identity.
- [Resource-injection retirement checkpoint](llm/checkpoints/2026-07-17-resource-injection-retirement.md) — historical boundary after narrowing activities to the framed protocol and deleting the unusable injected-resource/runtime-RPC island.
- [Obsolete runtime retirement checkpoint](llm/checkpoints/2026-07-17-obsolete-runtime-retirement.md) — historical deletion boundary for the disconnected NodeAgent/systemd/private-gRPC runtime island.
- [Atomic run-directory checkpoint](llm/checkpoints/2026-07-17-run-directory-index.md) — historical hosted SEA evidence, verified V3 history index, and the cleanup boundary that preceded the runtime deletion.

The charter and accepted decisions are authoritative; the roadmap is expected
to evolve, and dated checkpoints and project-reset records are historical
snapshots. The repository-native guides under `docs/guides/` track the current
public command surface. Older material under `llm/design/` can be stale.

## Current application contract

A source application is a default-exported plain object in `wharfie.app.js`.
The v2 boundary is deliberately small and strict:

```js
import { defineApp } from '@wharfie/wharfie/app';

export default defineApp({
  schemaVersion: 2,
  app: { id: 'my-app' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './src/cli.js',
      export: 'main',
    },
  },
  activities: {
    greet: {
      entrypoint: {
        kind: 'node',
        path: './src/activities/greet.js',
        export: 'greet',
      },
    },
  },
});
```

Application and activity IDs are lowercase kebab identifiers matching
`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`, with a maximum of 63 ASCII bytes. Wharfie
does not trim or rewrite them. The CLI is required; activities and package
targets are optional. Application- and activity-level `resources` are not part
of the schema and are rejected as unknown fields. A caller-metadata object may
contain a property named `resources`, but it is ordinary inert JSON—not an
injection request. Managed effects are a separate finite API on
`runtime.effects`; the first exact request is `application-state` /
`put-if-absent` with `['idempotent', 'transactional']` replay properties.
Durable `ops run` fulfills that request, while ephemeral invocation rejects it
with `effect-handler-unavailable`. Workflows and schedules are intentionally not
in this schema until their durable semantics are ready. Build credentials,
signing material, and extra asset configuration are also outside the public
manifest.

See the [quickstart](docs/guides/quickstart.md) and [application
structure](docs/guides/application-structure.md) for the complete
authoring rules.

## Reconcile one uncertain managed effect

The source and packaged operator surfaces can resolve one retained
`UNCERTAIN` application-state effect from a permanent destination decision:

```bash
wharfie ops reconcile-effect --run-id <run-id> --effect-id <effect-id> --reconciliation-id <stable-id> --confirm-runner-stopped
<app> wharfie reconcile-effect --run-id <run-id> --effect-id <effect-id> --reconciliation-id <stable-id> --confirm-runner-stopped
```

All four options are required. Reuse the same `--reconciliation-id` and exact
request after a lost response; an exact replay returns the retained decision
without another destination or ledger transition. Both forms are trusted local
mutations: they require the held app-scoped LMDB local-owner protocol, refuse
to race a live resident session or prior runner, and do not provide remote
operator routing. The packaged form additionally binds the run to the app
identity embedded in the artifact.

The command can retain a late verifier-backed positive receipt or atomically
finalize the exact destination effect as permanently `NOT_APPLIED`. It never
loads application source, redispatches the effect, or unblocks the enclosing
`UNCERTAIN` invocation. Human and `--json` output are redacted: they expose the
stable reconciliation/effect identities, resulting effect status, replay
state, and safe lifecycle view, but not request values, destination/store
details, receipts, finalizations, evidence, private reason text, or fences.

## Managed-effect successor retry

After an exact application-state V2 effect has been verified permanently
`NOT_APPLIED`, a trusted local operator can authorize and run its one finite
causally linked successor:

```sh
wharfie ops retry-effect --run-id <run-id> --effect-id <effect-id> --successor-id <stable-id> --confirm-runner-stopped
```

The packaged equivalent is:

```sh
<app> wharfie retry-effect --run-id <run-id> --effect-id <effect-id> --successor-id <stable-id> --confirm-runner-stopped
```

Both forms accept an optional private `--reason <text>` and redacted `--json`
output. Reuse the exact source run, effect, successor ID, actor, and reason
after a lost response. Exact replay returns or advances the one retained target;
it cannot authorize a sibling or enter an already-started adapter again.

The successor receives fresh run, invocation, attempt, effect, destination,
and fence identities through a dedicated effect-only lifecycle. It never
redispatches the abandoned authored activity, and the source remains `BLOCKED`
/ `UNCERTAIN` even when the target completes. This is only the finite
application-state V2 `put-if-absent` retry policy; it is not generic handler
retry or compensation.

## Current external dependency boundary

An activity can declare exact npm package names and versions that are direct
production or optional dependencies in its application's local npm lock v3.
Wharfie derives the complete target closure from that sealed lock without ideal-
tree resolution, extracts exact credential-free HTTPS tarballs under canonical
SHA-512 integrity, and binds semantic closure plus archive receipts to the
application revision and artifact provenance. Revision-backed source execution
uses the same closure rather than the author's ambient install.

The frozen-lock contract deliberately ignores package lifecycle scripts,
creates no package `bin` links, and treats failure of a selected optional
package as fatal. It rejects aliases, links, bundled dependencies, unsupported
targets, and non-registry edges. Private-registry authentication, workspace-lock
selection, musl Linux, and reproducible builds are not yet supported. Published native
packages must already contain usable locked target bytes. Windows SEA targets
are deliberately deferred until private runtime extraction has a tested ACL and
reparse-point design. Moved Darwin SEAs and the clean hosted-Linux verifier
exercise a real LMDB dependency with Node absent from `PATH`.

Prepared revisions also fail closed when reachable JavaScript or TypeScript
uses a runtime-computed native module path or aliases a native loader. Portable
code must use literal module specifiers so the frozen dependency closure and
artifact provenance describe everything the application can load.

## Current development checks

Use the Node version in `engines` and the contributor npm version in
`packageManager` (currently Node 24.13.1 and npm 11.12.0), install dependencies,
and run:

```bash
npm ci
npm run test:ci
```

`npm run test:ci` covers lint, source and test type checks, the full unit and
integration suite, package-tarball verification, and the production dependency
audit. The parser used by the portable-module audit is a direct runtime
dependency, and clean-install validation no longer relies on the unused
TypeScript ESLint import preset or resolver. Native LMDB and generated-SEA
proofs are available through `npm run test:native` and the SEA verifier.

Current source is organized as follows:

- `src/cli/` — the current developer and operator CLI implementation.
- `src/core/` — activity runtime, durable ledger, provider, and packaging foundations.
- `docs/` — the small repository-native guide and accepted architecture decisions.
- `llm/` — design notes, prompt templates, and dated project checkpoints.
