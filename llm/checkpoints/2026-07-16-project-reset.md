# Checkpoint — Wharfie project reset

- **Captured:** 2026-07-16, America/Detroit
- **Purpose:** restart a future maintainer or coding-agent session from the product and repository decisions reached in the July 2026 reset conversation
- **Canonical scope:** [`PROJECT.md`](../../PROJECT.md)
- **Live plan:** [`ROADMAP.md`](../../ROADMAP.md)
- **Decision log:** [`docs/architecture/decisions/`](../../docs/architecture/decisions/README.md)

This is a distilled checkpoint, not a verbatim transcript. It records the intent, decisions, repository evidence, exact preservation refs, and next review boundary needed to continue without reconstructing the conversation. It is an immutable historical snapshot; future changes belong in the live roadmap, a superseding ADR, or a new dated checkpoint.

## Copy-paste resume prompt

> We are continuing the Wharfie project reset. Read `PROJECT.md`, `ROADMAP.md`, every accepted record in `docs/architecture/decisions/`, and `llm/checkpoints/2026-07-16-project-reset.md` before changing code. Fetch remote refs and verify the `archive/2026-07-16/remote/...` tags still exist. Breaking changes are allowed and v1 is abandoned. Resume at the checkpoint's "Next action" section, inspect any work merged since it was written, update the live roadmap as needed, and create a new dated checkpoint rather than rewriting this snapshot.

## Working agreement from the conversation

- The repository is not used by downstream applications, so breaking changes are acceptable.
- Optimize for speed toward a coherent eventual design, not v1 compatibility or incremental migration ceremony.
- Clean branches, PRs, issues, dead code, and partially finished paths before expanding the runtime.
- During the captured session the user permitted commits and pushes, but this checkpoint grants no authority to a future session. Act only within the current user's request, especially for external or destructive GitHub mutations.
- The current remote state had to be backed up before cleanup. That backup is complete and verified as described below.
- Pause for review when a coherent checkpoint is ready; the reset documentation is the first such checkpoint.

## Product intent reached in the conversation

The original motivation was expressed as:

> LLMs make writing software very easy. We are empowered to express and act upon our will locally within coding sessions, but it is hard to carry that out into the cloud or past the end of a chat session. Wharfie should carry that will forward into something we can follow along with and evolve.

The concrete product statement is:

> Wharfie is a local-first TypeScript application runtime that turns an ordinary CLI into a portable executable, then lets that same application become a durable, observable service across trusted machines without an architectural rewrite.

The key value is continuity from local authoring to unattended operation. Node SEA, provisioning, durable execution, and mesh coordination are mechanisms in support of that continuity.

Wharfie persists operator-approved executable intent—immutable revisions, triggers, capabilities, run state, attempts, effects, deployments, and decisions—not an abstract will or chat transcript. It should be especially legible to coding agents without becoming an agent framework.

## Agreed direction and initial decisions

1. **v1 is abandoned.** The Athena/table product, legacy APIs, and backward compatibility are not part of the new scope.
2. **The mesh contains trusted nodes only.** Trustless or Byzantine coordination is out of scope.
3. **Start with one authoritative coordinator at the durable-store boundary.** It is a recoverable role, not an irreplaceable machine. Lease acquisition, renewal, and epoch increment are linearizable store operations; all accepted mutations are fenced; and a replacement reconstructs state from the ledger. A stale process may keep issuing messages but cannot have stale control-state writes accepted.
4. **Automatic coordinator failover initially uses a linearizable provider-backed store.** SQLite/LMDB is appropriate for local and same-volume restart but cannot claim automatic recovery after host loss. Peer quorum can be evaluated later.
5. **TypeScript/Node is the sole authoring and orchestration model initially.** Preserve a serializable activity boundary that can later host WASI/WASM or persistent subprocess implementations. Target-specific Node-API modules remain dependencies behind JavaScript handlers. Wharfie packages outputs; it is not a multi-language build system.
6. **One authoritative terminal outcome, not one physical execution.** An invocation has at most one authoritative terminal outcome; a resolved invocation has exactly one. Retryable runnable work uses at-least-once dispatch and fenced attempts. External exactly-once behavior exists only when a managed adapter's destination atomically enforces the effect identity with the business mutation. Replay properties can include `pure`, `idempotent`, and `transactional`; unsupported operations are `unsafe`, and an ambiguous unsafe operation blocks in nonterminal `uncertain` state until reconciled or compensated.
7. **Cloud work is capability fulfillment, not general IaC.** A produced executable can use a user's normal provider credential chain to plan and create Wharfie nodes, application state, semantically stronger control state, artifacts, identity, networking, and ingress. It records ownership, distinguishes managed/external resources, creates narrow runtime identities, and destroys only what it owns.
8. **The developer-owned CLI remains the primary surface.** The same executable should run locally and later expose deploy, status, logs, intervention, upgrade, rollback, and destroy operations through an explicit non-colliding operator namespace. A web UI is not an initial priority.
9. **SEA is a backend, not the permanent abstraction.** The promise is an approachable portable, self-hosting executable with no required Node installation, container runtime, Kubernetes cluster, or hosted orchestration service on the target. Local and single-node use require no external Wharfie control plane; initial automatic coordinator replacement requires a linearizable durable store.
10. **Revisions and operational history are immutable and inspectable.** Runs pin logical revisions; revisions can own target-specific artifacts; changes create new revisions; upgrade and rollback behavior is explicit; CLI JSON output makes the system operable by people, scripts, and coding agents.

## Repository snapshot before reset work

### Primary refs

- GitHub repository: `wharfie/wharfie`
- Default remote branch: `master`
- Remote `master` before reset: `f31595a6048a2aa1593a4d9023c6d82cff01a823` (2026-04-15)
- Local `master` before reset: `73de463989c6800219992884e99f47d591ff0486` (three unpublished commits ahead of remote)
- `jvd/pr4`: `1425ba6f4bb32cc219c27b9e33ba2753683726c7`
- Old stash: `52ca16fa00dcef57be7fcc6da5446e18dab6a88d`, recorded as `WIP on master: 3dee66b work prompt` on 2026-03-12
- Reset documentation branch: `agent/project-reset`, created cleanly from the archived remote `master`

The unpublished local commits are:

```text
73de463 fixup
a1b645f test fix
2f1a4bb test
```

Together they change 26 files by roughly +1,460/-438, primarily improving self-build, Node SEA packaging, and packaged-app behavior. They passed the full local CI command under Node 24.13.1 before the reset branch was created. They have not yet been judged against the new scope.

### Verified remote backup

Every branch that existed on the remote on 2026-07-16 was preserved as an annotated Git tag on GitHub before working-tree changes began. The commit in the last column is the peeled tag target.

| Remote branch            | Archive tag                                        | Commit                                     |
| ------------------------ | -------------------------------------------------- | ------------------------------------------ |
| `master`                 | `archive/2026-07-16/remote/master`                 | `f31595a6048a2aa1593a4d9023c6d82cff01a823` |
| `jvd/cast-compaction`    | `archive/2026-07-16/remote/jvd/cast-compaction`    | `76ddfd4fbac1993d092478a4b67289d15ca586bf` |
| `jvd/chore-lint`         | `archive/2026-07-16/remote/jvd/chore-lint`         | `ff78940f348fc8b8cfc9ba4a982a27388f6c9416` |
| `jvd/entitlements`       | `archive/2026-07-16/remote/jvd/entitlements`       | `9c04b410e8cae85937a395ae0592d100c57570d1` |
| `jvd/examples`           | `archive/2026-07-16/remote/jvd/examples`           | `9d3153ee0dc40c493f53b02a54ead33ac31cb1a8` |
| `jvd/firecracker`        | `archive/2026-07-16/remote/jvd/firecracker`        | `2f33d0c858e2845a5715e01f5a9c5bab0e72d8c9` |
| `jvd/more-docs`          | `archive/2026-07-16/remote/jvd/more-docs`          | `e02e662d016eb3371adc4fe8afa9cf03ba2f09d8` |
| `jvd/new-wharfie-events` | `archive/2026-07-16/remote/jvd/new-wharfie-events` | `1767c12892c66721a296f81ef255eac9d143982e` |
| `jvd/op-tracking`        | `archive/2026-07-16/remote/jvd/op-tracking`        | `90ef89ea53c3946bcff45a4f5afe7e3fd7be4b1c` |
| `jvd/pr4`                | `archive/2026-07-16/remote/jvd/pr4`                | `1425ba6f4bb32cc219c27b9e33ba2753683726c7` |
| `jvd/rust-antlr`         | `archive/2026-07-16/remote/jvd/rust-antlr`         | `9de49b6af7cfb6c71e551cf0576dd2553b1785b7` |
| `jvd/rust-aws-sdk`       | `archive/2026-07-16/remote/jvd/rust-aws-sdk`       | `ca9401e267af5f2e3cd95405003541029016c2ff` |
| `jvd/side-effects`       | `archive/2026-07-16/remote/jvd/side-effects`       | `a1552d8859e316542845a38a63ead2690be01fbb` |
| `jvd/tsc`                | `archive/2026-07-16/remote/jvd/tsc`                | `ad8ada269596bdc1a42e78f9a1defa3375382b9a` |
| `jvd/tsc-lint`           | `archive/2026-07-16/remote/jvd/tsc-lint`           | `f85b5025dbfbbbbc5915f0e02623d56c2fa5114f` |

Verification used `git ls-remote --tags` after the push and returned all 15 tag objects and peeled targets.

Two additional annotated tags exist only in this checkout:

- `archive/2026-07-16/local/unpublished-master` → `73de463989c6800219992884e99f47d591ff0486`
- `archive/2026-07-16/local/stash` → `52ca16fa00dcef57be7fcc6da5446e18dab6a88d`

They were deliberately not pushed: publishing a stash or other never-published local work can disclose private material. Do not assume those refs exist in another clone. Review the content and obtain explicit approval before publishing; retain this checkout until they are reconciled or exported safely.

## GitHub tracker snapshot

The connected GitHub repository had three open PRs and 24 open issues when this checkpoint was written.

### Open PRs

| PR                                                  | Title                                                 | Head               | Initial disposition                                                                                     |
| --------------------------------------------------- | ----------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------- |
| [#100](https://github.com/wharfie/wharfie/pull/100) | actor system / graph refactor                         | `jvd/side-effects` | Preserve research, mine durable graph/effect work, then supersede; 166 commits and not mergeable as-is. |
| [#99](https://github.com/wharfie/wharfie/pull/99)   | change entitlements to match node doc recommendations | `jvd/entitlements` | Re-evaluate only if still required by the new SEA release path; otherwise supersede.                    |
| [#25](https://github.com/wharfie/wharfie/pull/25)   | [dnm] rust antlr implementation                       | `jvd/rust-antlr`   | Close as obsolete with v1/Athena; archive tag already preserves it.                                     |

No PR was closed during checkpoint creation.

### Open issues

All 24 issues were stale and appeared without labels or milestones. Most describe the abandoned Athena/v1 product; this is a condensed title list:

```text
#84 Refresh credentials on UnrecognizedClientException
#83 test project role has propagated as part of reconcile
#76 Add a SageMaker feature-store connector
#64 resource system name uniqueness
#58 Type casting
#55 include inter-region transfer in cost estimates
#53 on error remove progress bars
#51 tag resources
#50 release artifacts
#49 wharfie project init validate project name
#33 deployment destroy does not clean bucket logs
#23 handle deleting buckets with objects
#20 show predicted resource costs on creation
#17 avoid unexpected S3 path collisions
#14 tiered config system
#12 non-string return types for UDFs
#11 row and map type support for UDF inputs
#10 investigate using queue source for DLQs
#9 replace CloudWatch alarms with SNS topics
#8 end-to-end automation tests
#7 validate failed-query DLQ and replay behavior
#6 UDF build system
#5 make resource stacks nested
#2 publish GitHub release artifacts alongside npm
```

Likely surviving concerns should be rewritten as new-scope work rather than keeping misleading v1 tickets open: immutable release artifacts (#50/#2), logical resource identity (#64), ownership/tagging and safe destroy (#51/#23/#33), and real end-to-end tests (#8). The final classification belongs in the Milestone 1 decision table; no issue was changed during checkpoint creation.

## Codebase health at the checkpoint

### What works

- Commander CLI commands include `config`, `init`, `app`, `ops`, `list`, and `build-self`.
- The current loader compiles CLI surfaces, named activities, workflows, cron triggers, and resources into internal functions/actors.
- Plain-object applications can reach `ActorSystem` and Node SEA packaging paths.
- Runtime code contains node supervision, scheduling, queues, DB/lambda gRPC services, provider adapters, and shared resource references.
- Persisted `Operation`/`Action` DAG machinery already supplies useful durable-execution material.
- On the unpublished local `master` tip, lint, strict JS type checking, and all 46 Jest suites passed: 158 tests passed and one conditional native-external test was skipped.
- On `agent/project-reset` at the remote-master code plus documentation, the pinned full CI command passed: lint, type checking, 44 suites and 149 tests passed, and one suite/test was conditionally skipped.
- Latest remote `master` CI was green at the time of inspection.

### What is misleading or broken

- The pre-reset README, website, and older docs center the Athena/table v1 product and contradict the current v2 CLI implementation. This reset branch rewrites the root README; the other stale docs remain.
- The project is midway through a v1→v2 migration, with stale design checklists that mark already-implemented work as missing.
- The release workflow invokes nonexistent `./build.js` commands and has environment-name mismatches.
- On the unpublished local `master` tip, the npm tarball omits `apps/wharfie-cli/wharfie.app.js`, which that tip's revised `build-self` path requires. The reset branch's older `build-self` inputs are packaged.
- `package.json` says version `0.0.14`, runtime version reporting says `0.0.0`, package metadata says ISC, and the repository license is Apache-2.0.
- The unpublished local tip adds an app file that advertises `build:wharfie-cli`, but no such package script exists; the reset branch does not make that advertisement.
- Production dependency audit reported 14 fixable findings: 1 critical, 3 high, and 10 moderate, including the direct gRPC/protobuf path.
- Sixty-nine legacy suites are excluded. Type checking excludes AWS resources and record classes; lint excludes important areas; CI does not inspect the npm tarball, build a real SEA artifact, validate installers, build docs, or audit production dependencies.
- There is one unused duplicate manifest compiler and three active persisted-run implementations.
- The current CLI implementation has no coherent supported deploy/status/logs/upgrade/rollback path yet.
- `src/core/lib/mesh/node.js` is empty; first-class mesh membership and coordinator recovery are not implemented.

## Agreed delivery order

1. Preserve/reset and get the charter reviewed.
2. Clean the tracker and repository; reconcile unpublished work and `jvd/pr4`; remove all v1 code and claims; repair release/package/security correctness.
3. Prove one portable TypeScript CLI and activity boundary in one executable.
4. Prove a single durable node with the invocation/attempt/effect ledger and crash recovery.
5. Implement narrow self-deployment through capability fulfillment.
6. Add trusted-node placement and recoverable authoritative-coordinator operation.
7. Add explicit revision rollout, rollback, migrations, provenance, and agent-friendly operation.

Do not begin by building a new consensus layer, general IaC system, web UI, agent framework, or polyglot SDK.

## Next action and review boundary

The immediate action after this checkpoint is to review the `agent/project-reset` documentation changes and merge them if the scope reads correctly. Then create a complete branch/PR/issue decision table that identifies what to absorb before deletion.

The next destructive phase should:

1. inspect the local unpublished commits and `jvd/pr4` file by file against Milestones 1 and 2;
2. preserve or reimplement only work that advances the new charter;
3. close the three stale PRs with links to archive tags and a supersession explanation;
4. rewrite surviving issue concerns as milestone-scoped tickets and close the v1 issues; and
5. delete remote branches only after confirming their archived tag targets.

After tracker cleanup, remove the v1 application and legacy dependency surface, then fix distribution correctness before adding new runtime features.

## Restart verification commands

Run these from the repository root and investigate any unexpected output before proceeding:

```bash
git fetch --prune origin
git status --short --branch
git show-ref --tags | grep 'refs/tags/archive/2026-07-16/remote/'
git log --oneline --decorate -10 origin/master
npm run test:ci
```

Use Node `24.13.1` and npm `11.12.0`, matching `package.json`. Runtime tests bind localhost ports and can fail with `EPERM` in a restricted sandbox even when the code is healthy.
