# Wharfie checkpoint — immutable identity spine

**Date:** 2026-07-17

**Implementation commit:** `5c2516cb58a9f8fe0c051edd9bf830bdeec5a9ce`
(`Establish immutable revision and artifact identity`)

**Branch at checkpoint:** `agent/strict-manifest`

**Base:** `5ed3988` (`Finish the archived type-safety salvage`)

This is the current restart point. Read `PROJECT.md`, the accepted ADRs in
`docs/architecture/decisions/`, and `ROADMAP.md` first. Older dated checkpoints
are immutable history and may describe code that has since been deleted or
superseded.

The commit containing this file is the checkpoint/roadmap follow-up to
`5c2516c`. Resolve its exact hash in any clone with:

~~~bash
git log -1 --format=%H -- llm/checkpoints/2026-07-17-immutable-identity-spine.md
~~~

## Copy-paste resume prompt

> Continue the Wharfie reset from
> `llm/checkpoints/2026-07-17-immutable-identity-spine.md`. Read `PROJECT.md`,
> `ROADMAP.md`, and all accepted ADRs before changing code. Breaking changes
> are allowed, v1 is abandoned, and there are no known downstream users.
> Verify the `archive/2026-07-16/remote/...` tags before any destructive GitHub
> cleanup. First restore GitHub authentication and publish the local stack if
> that is now possible. The next release-blocking code task is to make target
> external installation consume and fail-check one frozen complete transitive
> dependency closure. Create a new dated checkpoint rather than rewriting old
> ones.

## Product direction that remains authoritative

Wharfie carries executable intent beyond one local coding session:

> Wharfie is a local-first TypeScript application runtime that turns an
> ordinary CLI into a portable executable, then lets that same application
> become a durable, observable service across trusted machines without an
> architectural rewrite.

The intended progression is one programming model:

~~~text
developer-owned TypeScript CLI
  → named local activities
  → self-contained target executable
  → resident durable service
  → coordinated execution across trusted nodes
~~~

The following decisions remain binding:

- v1 and backward compatibility are abandoned. Optimize for the coherent
  eventual design and delete misleading alternatives.
- Nodes are trusted. A trustless mesh, Byzantine consensus, Kubernetes,
  containers, a hosted Wharfie control plane, and a web UI are not initial
  product requirements.
- TypeScript/Node is the sole initial authoring and orchestration model.
  Target-specific Node-API dependencies are supported for hot paths. A future
  versioned activity boundary may admit WASI/WASM or subprocess components
  without making Wharfie a general multi-language build system.
- One authoritative coordinator is sufficient initially. Its durable truth
  must live behind linearizable conditional operations, and coordinator epochs
  plus attempt generations must fence every accepted mutation so a replacement
  can recover after process or machine loss.
- Physical work is at-least-once. Wharfie may claim exactly-once behavior only
  for a managed effect whose destination atomically enforces the effect
  identity with the business mutation. Arbitrary in-process code cannot make
  that claim; ambiguous unsafe effects eventually require a durable
  `uncertain` state and reconciliation or compensation.
- Wharfie fulfills a finite capability model rather than becoming general
  cloud IaC. Produced executables may use the operator's normal credential
  chain to create Wharfie nodes, control/application state, artifact storage,
  runtime identity, networking, and optional ingress. They must record
  ownership and destroy only what Wharfie owns.
- The application-owned CLI is primary. Wharfie reserves
  `<app> wharfie <command>` for inspectable operator behavior.
- SEA is the first packaging backend, not the permanent public abstraction.
  The user-facing promise is an approachable portable application that does not
  require Node, a container runtime, Kubernetes, or a hosted orchestrator on
  the target.

## Preservation and publication state

- Every branch that was live on GitHub at the start of the reset is preserved
  by a verified annotated `archive/2026-07-16/remote/...` tag. The archived
  remote `master` tip is
  `f31595a6048a2aa1593a4d9023c6d82cff01a823`.
- The exact 15-branch tag-to-commit table and original tracker inventory are in
  `llm/checkpoints/2026-07-16-project-reset.md`.
- The unpublished local `master` tip and old stash remain preserved only in
  this checkout as `archive/2026-07-16/local/unpublished-master` and
  `archive/2026-07-16/local/stash`. They were deliberately not pushed because
  never-published local material may be private.
- Reset documentation is published on `agent/project-reset` at `0ac89a1` in
  draft PR #123. The cleanup inventory is published on
  `agent/cleanup-inventory` at `80c42a1` in draft PR #124.
- The packaging, v1 deletion, strict-manifest, atomic-operation, type-safety,
  and immutable-identity stack is local through `5c2516c` on
  `agent/strict-manifest`.
- GitHub writes remain blocked because the injected `GITHUB_TOKEN` and stored
  `gh` authentication were invalid at the last attempt. Restore authentication
  before pushing or changing the tracker:

  ~~~bash
  unset GITHUB_TOKEN
  gh auth login -h github.com
  gh auth status -h github.com
  ~~~

Do not delete remote branches, close PRs or issues, or rewrite the preserved
stack until authentication is restored and the remote archive tags are
rechecked against the preserved table.

## What `5c2516c` establishes

### Canonical identity spine

- ADR 0008 defines three distinct immutable identities:
  - `wrv1_...` for a target-independent application revision;
  - `waf1_...` for the exact final bytes of one target artifact; and
  - `wpr1_...` for an immutable deployment-profile revision.
- Domain-separated SHA-256 identifiers use strict canonical base64url.
  Decoding validates the exact byte length and re-encodes the value, so alternate
  or noncanonical text cannot alias an accepted identity.
- Build targets canonically bind an exact release Node version, platform,
  architecture, and Linux libc where applicable. Node prerelease and build
  metadata are rejected.
- `ApplicationRevisionV1` contains the target-free strict application contract,
  source-tree digest, package-lock digest plus interpretation format, Wharfie
  runtime digest, and canonically ordered behavior-asset digests.
- `ArtifactRecordV1` binds exact byte identity and length to one application
  revision, exact target, builder/toolchain provenance, Node binary receipt,
  target external archive digests, and non-secret signing results.
- `DeploymentProfileV1` has a human logical name but an immutable content
  identity. The initial schema supports only `db`, `queue`, and `objectStorage`
  bindings shaped as `{ kind: "external", ref: <logical ID> }`; it does not
  pretend to define managed infrastructure or ownership yet.

### Immutable revision compilation

- Revision preparation creates a private application-local snapshot under
  `.wharfie/revision-snapshots/revision-*/app`.
- Every source and behavior-asset file is opened without following its final
  symlink, required to be a regular file, read twice through the same descriptor,
  and checked with before/after bigint metadata. Symlinks, special files,
  excluded state/output paths, path escapes, and concurrent mutations fail
  closed.
- Snapshot files are sealed read-only and directories non-writable. Packaging
  and durable local `ops run` execution consume snapshot paths instead of the
  mutable authoring tree.
- Esbuild's static module graph is audited. Every bundled application input
  must be inside the snapshot; the Wharfie public API and exactly declared
  activity externals remain external to that graph. Transitive source escapes,
  undeclared bundled packages, and excluded entrypoints are rejected.
- Target-independent Wharfie runtime input is reverified around consumption.

### Exact target artifacts

- Packaging embeds canonical `<WHARFIE_APP>/revision.json` and
  `<WHARFIE_APP>/runtime.json` assets before final-byte addressing.
- The reserved `wharfie metadata --no-pretty` command reports the embedded
  revision/runtime records and computes the identity and length of the exact
  executable bytes currently running.
- Package-time provenance records the exact Node executable digest, an official
  Node download receipt when available, installed Wharfie packaging-tool
  versions, each embedded target external archive digest, and any non-secret
  platform-signing result.
- Final executables are named
  `<safe-app>-sha256-<64 lowercase hexadecimal digits>[.exe]` and paired with
  canonical `<filename>.artifact.json` sidecars.
- Publication is monotonic. It uses create-if-absent hard links, validates and
  reuses an existing exact executable/record pair, refuses conflicting or
  incomplete pairs, never overwrites a content-addressed destination, and rolls
  back only files created by its own transaction.

### Revision-fenced execution

- Persisted operation metadata now includes a top-level `revision_id`
  concurrency mirror that must equal `data.revision_id`.
- Create, replacement, claim, retry, cancellation, and result-commit paths
  validate the immutable revision association. A revision-changing replacement
  is rejected before constructing a new snapshot, and provider-neutral compare-
  and-swap conditions include the revision.
- A provider delivery identity remains revision-independent. Observing the same
  delivery under different code fails visibly rather than turning one delivery
  into new work or silently continuing under the new revision.
- Stable user activity context is persisted as part of operation identity and
  configuration. Volatile delivery receipt and attempt metadata are kept in a
  separate unpersisted `attemptContext`.

### Executable proof

- The scratch hello-world application is self-contained within its app
  directory and imports the public `@wharfie/wharfie/app` surface.
- The real SEA verifier installs the packed npm tarball, retains the package
  lock, builds and moves a real executable, removes Node from `PATH`, invokes
  the source CLI activity and packaged activity, invokes embedded metadata, and
  compares the observed executable identity with both the packaging result and
  published artifact-record sidecar.

## Verification evidence

Verification used Node `24.13.1` and npm `11.12.0`.

- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm run verify:package` — passed and verified 131 packed files.
- Full Jest run — 53 suites passed and one skipped; 425 tests passed and one
  skipped (54 suites and 426 tests total).
- `npm run verify:package:sea` — passed against an installed tarball and a
  moved Darwin SEA with Node absent from `PATH`. It proved activity execution,
  embedded revision/runtime metadata, returned package metadata, sidecar
  association, and exact running-executable identity. The final executable was
  129,038,544 bytes.
- `git diff --check` — passed immediately before the implementation commit.

The real SEA proof is stronger than the earlier bundle-only gate, but it ran on
Darwin. The clean hosted-Linux target remains an explicit roadmap item.

## Known gaps and open risks

1. **Frozen external dependency closure is incomplete.** The logical revision
   records the package-lock digest and validates declared direct external
   versions, but target installation still constructs a fresh transitive
   closure with Arborist/pacote rather than consuming and fail-checking the
   frozen lock's complete closure. The artifact record truthfully captures the
   exact resulting target archive digest, so every executable is identifiable,
   but the same logical revision could currently produce different artifacts as
   external resolution changes. This is the next release blocker.
2. **Static graph limits need a public rule.** Nonliteral dynamic
   `import()`/`require()` paths may evade the bundler graph. Wharfie must either
   reject them or require an explicit declaration before claiming complete
   behavior closure.
3. **Runtime consumption can be tightened.** Runtime inputs are verified before
   and after consumption, while application source/assets use a sealed snapshot.
   An exact prebuilt or snapshotted runtime-input pipeline would further reduce
   the remaining mutable-runtime race surface.
4. **Portable CLI semantics are not fully proven.** Normal argv, stdio, exit
   codes, cancellation/deadline/log/error serialization, and arbitrary CLI-
   library choice still need an explicit versioned activity-protocol test
   matrix.
5. **The native hot-path promise lacks real evidence.** No moved SEA test yet
   loads a real target-specific Node-API activity dependency.
6. **Durability is still a snapshot, not the final ledger.** Current operation
   persistence has useful atomicity and revision fencing, but no append-only
   run → invocation → attempt → effect history, leases, heartbeats,
   coordinator epochs, crash recovery, transactional effects, or durable
   `uncertain` reconciliation state.
7. **Deployment profiles are identity scaffolding only.** Managed capability
   fulfillment, ownership receipts, provider credential use, deployment state,
   rollout, rollback, and service installation are future milestones.
8. **Repository cleanup remains externally blocked.** The implementation stack
   is not published and the stale GitHub PR/issue/branch cleanup has not run
   because authentication is invalid.
9. **Milestone 1 hygiene remains open.** Production dependency-audit policy,
   explicit lint/type/test exclusions, hosted Linux verification, and tracker
   truth still need closure.

## Next work, in order

1. Restore GitHub authentication, fetch remote state, verify all 15 remote
   archive tags against the table in the project-reset checkpoint, and publish
   the current stack without rewriting preserved refs.
2. Update or open the draft PR for the full stack, then execute the cleanup
   inventory: leave preservation notes, close obsolete PRs/issues, rewrite only
   genuinely surviving concerns, and delete remote branches only after checking
   their archive tag targets.
3. Make target external installation consume and fail-check one frozen complete
   transitive dependency closure. Add adversarial tests that the lock, declared
   externals, installed closure, archive digest, and revision association cannot
   drift independently.
4. Run the content-addressed artifact proof on clean hosted Linux. Then prove
   argv/stdio/exit behavior, formalize the activity protocol, and load one real
   target-specific Node-API dependency from a moved SEA.
5. Decide deterministic replay versus explicit persisted continuation/state
   machines, then define the append-only run → invocation → attempt → effect
   ledger before reintroducing schedules or workflows.
6. Add leases, recovery, effect reconciliation, and coordinator fencing only on
   top of that ledger.

## GitHub cleanup sequence after authentication

~~~bash
unset GITHUB_TOKEN
gh auth login -h github.com
gh auth status -h github.com
git fetch --prune origin
git ls-remote --tags origin 'archive/2026-07-16/remote/*'
~~~

Compare every peeled remote tag target with
`llm/checkpoints/2026-07-16-project-reset.md`. Then push
`agent/strict-manifest` and update/open a draft PR. Do not publish the local-only
stash or unpublished-master archive tags without separately reviewing their
contents and obtaining explicit approval.

Only after the implementation stack is safely published:

1. close stale PRs with a short supersession note and their exact archive link;
2. classify each issue as current roadmap work, useful research, or obsolete;
3. rewrite surviving v1 concerns into the new product language and close the
   misleading originals;
4. delete a remote branch only after confirming its archived peeled target; and
5. update the roadmap when tracker state, not merely the intended decision, has
   changed.

## Clean restart procedure

~~~bash
git switch agent/strict-manifest
git status --short --branch
git log --oneline --decorate -12
git show --stat 5c2516c
. "$HOME/.nvm/nvm.sh"
nvm use 24.13.1
npm run test:ci
npm run verify:package:sea
~~~

The full test and real SEA commands need normal localhost/process/filesystem
permissions and may need network access for exact target dependencies. If this
branch is absent in a future clone, recover the stack from its published draft
PR once authentication has been repaired; until then, retain this checkout.
