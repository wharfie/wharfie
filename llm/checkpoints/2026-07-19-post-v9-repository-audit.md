# Wharfie checkpoint — post-V9 repository and tracker audit

- **Date:** 2026-07-19
- **Status:** **WORKING CHECKPOINT — read-only audit and tracker reconciliation
  complete; destructive cleanup and public-surface changes await explicit
  review**
- **Branch:** `agent/strict-manifest`
- **Published branch receipt:**
  `c5455d9925cbb71a7b8d512116c7b4740708b56b`
- **Parent:** [V9 managed-effect successors](2026-07-19-v9-managed-effect-successors.md)
- **Pull request:** [#125](https://github.com/wharfie/wharfie/pull/125)

This checkpoint records the state after the post-V9 loose-end audit. It does
not authorize the proposed deletions or turn V9's hidden successor fixture into
a public contract.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-19-post-v9-repository-audit.md`. Read `PROJECT.md`,
> `ROADMAP.md`, ADR 0018, and the parent V9 checkpoint. Inspect the worktree and
> live remote before acting. The published branch receipt is `c5455d9`; the
> audit documentation may be an uncommitted or later local change. Only PR
> #125 should be open, only `master` and `agent/strict-manifest` should be live
> remote heads, and issues #126–#137 should be the open implementation tracker.
> Do not interpret an OpenAI sandbox/network approval as product approval. The
> user has not yet explicitly approved the combined cleanup tranche or the V9
> public `retry-effect` mount. If approved, prefer ideal-state deletion over
> compatibility: retire the stale docs wrapper, remove dead dependencies and
> validation exclusions, reject runtime-computed native module paths, and add
> the V9 public source/SEA parity proof. Validate dependency changes from a
> disposable `npm ci`; the current local `node_modules` contains extraneous
> packages.

## Product boundary retained

Wharfie turns a normal TypeScript CLI with named activities into an
approachable portable Node SEA that can run locally and later remain resident
as a durable service. It carries intent beyond an interactive coding session
and coordinates work across trusted nodes without requiring Node, containers,
Kubernetes, or a hosted orchestration service on target machines.

- One coordinator is sufficient initially only if durable truth survives its
  process and a replacement can recover with linearizable fenced ownership.
- Generated applications may use a user's normal provider credentials through
  finite Wharfie-owned capability abstractions. Wharfie is not general IaC.
- Node and TypeScript are the control plane. Native bindings or WASM remain
  available for measured hot paths without promising a general polyglot API.
- Exactly-once claims are destination-specific and require an atomic stable
  effect identity or mutually exclusive permanent negative closure.
- There is no v1 compatibility, trustless-mesh, or web-UI requirement.

## Preservation and tracker state

- The pre-reset remote state remains preserved under verified
  `archive/2026-07-16/remote/...` tags. Local unpublished tips and stash records
  remain local-only by design.
- The only live remote branches observed after cleanup are `master` and
  `agent/strict-manifest`.
- Draft PR #125 is the only open pull request. Its V9 head and description were
  reconciled during this audit.
- Issues #126–#132 preserve the reset roadmap. The audit added:
  - #133 — runtime-computed module path boundary;
  - #134 — clean-install CI, production audit, and validation exclusions;
  - #135 — persistent durable workflow worker;
  - #136 — recoverable coordinator and trusted mesh; and
  - #137 — stale v1 documentation site retirement.

## Evidence-backed loose ends

### Clean-install CI and validation

GitHub Actions fails lint because `plugin:import/typescript` asks
`eslint-plugin-import` to load `@typescript-eslint/parser`, but the parser is
not declared. Local lint was masked by an extraneous parser in `node_modules`.
The repository does not actually lint its TypeScript declarations, so the
smallest ideal-state repair is to remove the unused TypeScript import preset,
`eslint-import-resolver-typescript`, and its resolver settings rather than add
a dependency for dead configuration.

The broader validation surface is also misleading:

- ESLint ignores production `src/cli`, all tests, and `scratch`; its Jest
  override is therefore unreachable.
- TypeScript omits `src/cli`, shipped package/release scripts, the Jest runner,
  and one managed-effect successor crash child. `src/app.js` is shadowed by
  its same-basename declaration file.
- Coverage collects only three source subtrees, covers 58 of 107 source JS
  files, and has no threshold.
- The native-external package test is a hidden opt-in lane. Hosted Linux still
  provides the authoritative real SEA proof.

Keep generated `dist`, `tmp`, and `coverage` exclusions. Split source/public
API and test type-check configurations, lint active production/test code, and
introduce a deliberately low ratcheting coverage floor rather than claiming
whole-product coverage immediately.

### Production dependencies

The Node 24 production audit reported 12 findings: eight moderate, three high,
and one critical. The recommended order is:

1. Remove unused `@grpc/grpc-js` and `@aws-sdk/client-sqs`. Removing gRPC also
   removes the vulnerable protobuf branch.
2. Replace four build/temp `uuid.v4()` uses with Node 24 `randomUUID()` and
   remove `uuid`.
3. Update `tar`; upgrade `pacote` and `@npmcli/arborist` together and reprove
   dependency closure and SEA construction.
4. Keep DynamoDB SDKs and credential providers while the live database adapter
   uses them. Update the AWS family coherently.
5. Remove root `@aws-sdk/client-s3` with the obsolete docs deployer; its only
   current consumer is `docs/scripts/deploy.js` through the root S3 wrapper.

Use `package.json` and `package-lock.json` as authority. Validate the final
lockfile in a disposable clean install, not the dirty local dependency tree.

### Stale documentation and release promises

`docs.wharfie.dev` serves the obsolete v0.0.14 Athena/AWS product, recommends
missing installers, and documents deleted v1 commands. Its repository wrapper
is an abandoned React/PWA application with a separate lockfile, generated
reports/search assets, and a deploy script that deletes the hard-coded bucket's
entire empty-prefix namespace before upload. Preserve the useful Markdown
guides and stable assets, then retire that wrapper and root S3 dependency.
Replacing or taking down the live site is a separate external deployment
action.

The release workflow is intentionally fail-closed while `private: true`, but
it triggers after a GitHub release is published and only npm-publishes a newly
packed copy. It does not produce a Wharfie SEA release artifact. Reframe it as
a non-mutating preflight until #130 packs once, validates and publishes that
exact tarball, builds the actual Linux Wharfie SEA, and attaches checksums and
provenance.

### Runtime-computed module paths

The #133 audit reproduced two host escapes from a prepared immutable revision:

- `await import(input.moduleUrl)` loaded an outside `file:///private/tmp/...`
  module; and
- `require(input.modulePath)` loaded an outside absolute CommonJS module.

Esbuild's metafile cannot see opaque module specifiers, so the current static
graph audit cannot prove their closure. The recommended M2 rule is to reject
runtime-computed native module specifiers. Permit static imports/exports and
literal `import("...")` or `require("...")` only, with existing snapshot and
external-package closure checks still applying. Enforce this once at
`prepareApplicationRevision()` with an AST parser across every reachable app
source input. Also reject computed `require.resolve`, `module.require`,
`import.meta.resolve`, and behavior-source `createRequire` use.

This is a portability boundary, not a hostile-code sandbox. A future finite
runtime-module declaration must be a separately versioned design with a
Wharfie-controlled loader.

### V9 public surface

V9's internal source and relocated-SEA crash matrices are published through
`c5455d9`. The finite destination-specific successor policy is strong enough
to mount as the normal operator command, but that remains a product decision.
If approved, expose source `wharfie ops retry-effect` and packaged
`<app> wharfie retry-effect`, remove the unsupported environment-gated alias,
and add public command parity plus response-loss tests. Do not expose generic
compensation or rerun an authored source handler.

## Recommended implementation sequence

1. M1 cleanup: retire the docs wrapper/deployer and dead dependencies; repair
   clean-install lint, type-check, test, and coverage scope; make release
   automation an honest preflight.
2. M2 portability: hard-reject computed native module specifiers and migrate
   the kitchen-sink optional-native probe.
3. V9 surface: mount or explicitly defer the public successor operation and
   record the decision.
4. Revalidate from a disposable Node 24.13.1 `npm ci`, including lint,
   type-check, full tests, package contents, and the real relocated SEA gate.
5. Commit, push, update PR #125 and issues #133, #134, and #137, then review the
   reset stack for merge before beginning the persistent M3 worker.

## Decision boundary

The user broadly authorized repository cleanup, commits, and pushes, but the
assistant explicitly paused for review before the broad docs deletion, CI and
dependency rewrite, computed-module rejection, and V9 public mount. A platform
sandbox/network approval grants command capability only. Resume implementation
after the user clearly approves all or names the subset to take.
