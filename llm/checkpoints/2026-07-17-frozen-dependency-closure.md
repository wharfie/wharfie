# Wharfie checkpoint — frozen dependency closure

**Date:** 2026-07-17

**Branch:** `agent/strict-manifest`

**Published branch tip before this milestone:** `8f99d2e`
(`Refresh the post-cleanup restart checkpoint`)

**Umbrella review:** draft PR
[#125](https://github.com/wharfie/wharfie/pull/125)

This is the current restart point. Read `PROJECT.md`, `ROADMAP.md`, and every
accepted ADR in `docs/architecture/decisions/` first. In particular, ADR 0009
defines the frozen closure boundary added after the immutable identity spine in
ADR 0008. Older dated checkpoints are immutable history.

This checkpoint is intended to land in the same coherent commit as the frozen-
closure implementation. It deliberately does not contain a self-referential
commit hash. Resolve the exact owning commit and current published branch tip
with `git log`; do not infer them from this prose.

## Copy-paste resume prompt

> Continue the Wharfie reset from
> `llm/checkpoints/2026-07-17-frozen-dependency-closure.md`. Read `PROJECT.md`,
> `ROADMAP.md`, and all accepted ADRs before changing code. Breaking changes
> are allowed, v1 and backward compatibility are abandoned, and there are no
> known downstream users. Fetch `origin`, confirm draft PR #125 and the current
> working tree, and preserve unrelated local changes. Review and run the full
> frozen-closure verification before committing it. Do not repair the missing
> direct `@typescript-eslint/parser` declaration until the user explicitly
> approves that CI fix. The next product proof is a clean hosted-Linux SEA; the
> next major design task is the durable run → invocation → attempt → effect
> ledger. Create another dated checkpoint rather than rewriting this one.

## Product direction that remains authoritative

Wharfie carries executable intent beyond one local coding session:

> Wharfie is a local-first TypeScript application runtime that turns an
> ordinary CLI into a portable executable, then lets that same application
> become a durable, observable service across trusted machines without an
> architectural rewrite.

The intended progression remains:

```text
developer-owned TypeScript CLI
  → named local activities
  → self-contained target executable
  → resident durable service
  → coordinated execution across trusted nodes
```

The accepted constraints are unchanged: trusted nodes only; Node/TypeScript
first with explicit future component boundaries; one recoverable authoritative
coordinator; finite capability fulfillment rather than general IaC; at-least-
once physical work with exactly-once claims only at destinations that enforce
an effect identity atomically; application-owned CLI first; and SEA as the
initial portable backend rather than the permanent public abstraction.

## Preservation, branch, and tracker state

- Every original live GitHub branch tip is preserved under a verified annotated
  `archive/2026-07-16/remote/...` tag. The archived original remote `master` is
  `f31595a6048a2aa1593a4d9023c6d82cff01a823`; the complete 15-ref table is in
  `llm/checkpoints/2026-07-16-project-reset.md`.
- Reset staging tips remain published as
  `archive/2026-07-17/staging/agent-project-reset` (`0ac89a1`) and
  `archive/2026-07-17/staging/agent-cleanup-inventory` (`80c42a1`).
- `archive/2026-07-16/local/unpublished-master` and
  `archive/2026-07-16/local/stash` are intentionally local-only. They may
  contain never-published material. Do not push them without a separate content
  review and current authorization.
- The last verified live remote heads were only `master` and
  `agent/strict-manifest`. Draft PR #125 was the sole open PR. Replacement
  issues #126–#132 were the sole open issues and were assigned to milestones
  M1–M4.
- The closure work was being developed directly in the working tree of
  `agent/strict-manifest`. Other local-only or local-gone branches were retained
  for later review and were not part of this milestone.

Reverify these statements against the remote rather than treating a dated
checkpoint as live GitHub state.

## Frozen closure boundary implemented in the working tree

### Lock and semantic plan

- Application revision dependency input format
  `wharfie-npm-package-lock-v3-closure-v1` names the canonical SHA-256 digest of
  one application-local npm lock v3.
- The sealed lock is consumed with stable no-follow regular-file reads and must
  match the owning revision before package planning begins.
- Arborist is used through `loadVirtual()` only. No ideal-tree construction,
  manifest range resolution, lock update, or ambient installed tree can select
  packages.
- Each declared external is an explicitly authored exact root
  production/optional dependency and exact version. Bare names are rejected;
  ambient installed package versions are never normalized into build inputs.
  The complete production, optional, peer, and optional-peer closure is
  filtered for exact Node/platform/architecture and `os`, `cpu`, `libc`, and
  Node-engine constraints.
- The canonical plan records that lifecycle scripts are ignored, package bin
  links are not created, and failures of selected optional packages are fatal.
  Its domain-separated SHA-256 receipt uses
  `wharfie:frozen-dependency-closure:v1`.

### Exact materialization and fail-closed behavior

- Every selected package must have a credential-free canonical HTTPS tarball
  URL and one canonical SHA-512 SRI. Pacote fetches exact integrity-checked
  tarball bytes; Wharfie validates those bytes before extracting the same
  buffer at the exact locked physical package location.
- Aliases, links, bundled dependencies, non-registry edges, missing required
  edges, incompatible required targets, malformed integrity, noncanonical or
  duplicate tar paths, embedded `node_modules`, hardlinks, unplanned package
  roots, symbolic links, and special files fail closed. Extracted package
  manifests must match the lock-bound dependency, peer, target, engine, bundle,
  and install-script contract.
- Closure v1 does not support private-registry authentication. It also does not
  emulate packages that require lifecycle scripts or generated bin links.
  Native packages must publish usable locked target bytes.
- Only app-local lock selection is defined. Workspace/monorepo lock selection is
  future work.

### Revision, artifact, and runtime binding

- Function build resources carry the sealed dependency lock transiently, emit
  the semantic closure receipt, archive exact materialized bytes, and emit the
  archive's raw SHA-256 receipt.
- Strict function assets seal activity, target, exact direct externals,
  dependency lock, semantic closure digest, archive digest, and archive bytes
  together under schema v3. SEA generation stably reads configured assets,
  parses receipt evidence from the exact selected bytes, checks expected
  function-asset digests, and seals the bytes into its private build tree before
  invoking Node's SEA generator.
- Artifact provenance binds the revision dependency-lock descriptor, semantic
  closure receipts, and exact embedded archive receipts. It consumes immutable
  evidence derived during SEA byte selection and treats later mutable resource
  fields only as consistency checks, so those fields cannot relabel sealed
  bytes. Successful-generation evidence also freezes the exact pre-injection
  Node digest, the validated official Node archive receipt or explicit absence,
  every generic and function asset digest, the final executable digest, and the
  validated Darwin signing transition. The semantic closure plan is digested,
  not embedded.
- Runtime verifies archive bytes before a worker starts. External packages are
  extracted under a fresh private mode-0700 root, not a deterministic reusable
  cache path; links and special entries fail; roots are removed on worker/cache
  destruction.
- Revision-backed source activities with externals use the same host-target
  closure, archive, and worker boundary. They require the prepared revision and
  sealed lock and do not fall back to ambient `node_modules`. Linux source
  execution requires positive glibc detection.

## Scope and current limitations

- Node/TypeScript remains the sole authoring model. Supported architectures are
  `x64` and `arm64`; Linux targets are glibc-only.
- Lifecycle scripts are ignored, bin links are absent, and selected optional
  failures are fatal by design.
- Private registries and authenticated package URLs are unsupported.
- Workspace-lock discovery and selection are unsupported.
- No reproducible-build claim is made. The final artifact and its actual
  closure/archive bytes remain content-addressed and inspectable even when a
  second build might differ.
- A direct Node 24 Darwin proof packaged an app-local exact LMDB dependency,
  moved the SEA, removed Node from `PATH`, and successfully opened, wrote, and
  read LMDB. The equivalent clean hosted-Linux proof remains open.
- Runtime-computed module paths outside the static bundle graph still need an
  explicit declaration or rejection rule.
- Function-asset schema v3 does not directly seal the canonical entrypoint and
  revision/source digest. The official in-process builder currently derives
  both the revision and one coherent FunctionResource snapshot from the same
  private prepared source snapshot; a future schema should make that
  association independently inspectable.
- Durable execution remains an atomic revision-fenced snapshot, not the future
  append-only run → invocation → attempt → effect ledger.

## Milestone scope

The owning milestone commit contains the closure planner and materializer,
revision-lock plumbing, FunctionResource receipts and assets, SEA asset and
successful-generation evidence, runtime archive/private-root hardening,
source-revision external execution, artifact provenance validation, the real
LMDB SEA proof, examples, types, tests, and this documentation. Inspect the
owning commit rather than reconstructing its file set from this summary.

Do not include the unrelated clean-install lint repair in this milestone unless
the user explicitly approves it. `@typescript-eslint/parser` is used by the
lint configuration but is not a direct development dependency; the current
local `node_modules` contains an extraneous copy that can mask the clean-install
failure. The proposed repair is to declare the parser and align the ESLint 8
range with its peer requirement, then regenerate the npm lock under the pinned
toolchain. The external RWX check remained report-only because it exposed no
actionable GitHub log.

## Verification state and commands

The final local verification used Node `24.13.1` and npm `11.12.0`:

- TypeScript type-check passed.
- ESLint plus repository Prettier check passed.
- The full Jest run passed 57 suites and 514 tests, with one intentional skip.
- Package-content verification found the expected 133 published files.
- Diff whitespace validation passed.
- The real package verifier installed Wharfie into a clean temporary project,
  built and relocated a 140,052,048-byte Darwin SEA, removed Node from `PATH`,
  and opened, wrote, and read a lock-selected LMDB dependency successfully.

The full test command needs normal loopback-bind permissions for its gRPC and
HTTP suites. Rerun these gates rather than treating the dated counts above as
permanent evidence.

Use exactly Node `24.13.1` and npm `11.12.0`. In particular, a shell whose
`npm` resolves to another Node can run the verifier under the wrong runtime; the
SEA verifier now rejects that mismatch early.

```bash
git status --short --branch
git diff --check
. "$HOME/.nvm/nvm.sh"
nvm use 24.13.1
npm run typecheck
npm run lint
npm run test
npm run verify:package
npm run verify:package:sea
```

The real SEA proof may need network access for exact registry tarballs and
normal process/filesystem permissions. A truly clean `npm ci` still reproduces
the direct-parser CI blocker until that separate fix is approved and landed.

## Next work, in order

1. Confirm the milestone commit is published on `agent/strict-manifest`, update
   draft PR #125, and inspect its actionable checks.
2. With explicit user approval, declare the missing TypeScript ESLint parser,
   align the compatible ESLint range, regenerate the lock from the pinned npm,
   and reproduce CI from a clean install.
3. Run the content-addressed LMDB SEA proof on clean hosted Linux and retain the
   exact artifact/provenance evidence. Do not claim portable Linux completion
   from the Darwin result.
4. Prove normal argv, stdio, and exit-code behavior, then define the versioned
   activity protocol's serialization, cancellation, deadline, log, error, and
   host-effect boundaries.
5. Decide deterministic replay versus explicit persisted continuations/state
   machines, then define the append-only run → invocation → attempt → effect
   ledger before reintroducing schedules or workflows.

## Clean restart procedure

```bash
git switch agent/strict-manifest
git fetch --prune origin
git status --short --branch
git log --oneline --decorate -12
git diff --stat
git show-ref --tags | rg 'archive/2026-07-(16/remote|17/staging)'
```

If the milestone is still uncommitted, preserve the working tree and review it
in place. If it was committed, compare the branch against `8f99d2e` and inspect
the exact commit rather than reconstructing the work from this prose. If the
branch is absent in a later clone, recover the published stack from draft PR
#125 and the verified archive tags; the intentionally local-only tags will not
exist in that clone.
