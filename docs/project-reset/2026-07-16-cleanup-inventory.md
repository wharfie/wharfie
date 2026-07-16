# Cleanup inventory and execution plan

**Status:** approved and partially executed · **Captured:** 2026-07-16 · **Execution update:** 2026-07-17

This document turns the preserved pre-reset repository and tracker state into explicit keep, supersede, replace, and delete decisions. It is deliberately non-destructive: no legacy PR or issue was closed and no remote branch was deleted while producing it.

This inventory records proposed actions; it grants no authority to a future session. Confirm that the current user request authorizes external GitHub mutations before executing them.

## Execution update — 2026-07-17

The user authorized the current session to commit, push, and work through this cleanup after preserving the remote state. The original inventory below remains the evidence for each decision; [the live roadmap](../../ROADMAP.md) and [the latest checkpoint](../../llm/checkpoints/2026-07-17-immutable-identity-spine.md) now control ordering.

- All 15 remote archive tags were reverified immediately before publication; every peeled target still matches the preservation checkpoint.
- The three unpublished packaging commits were salvaged and cleaned, the useful `jvd/pr4` behavior was reimplemented, v1 was deleted, and the strict manifest, atomic operation boundary, type-safety salvage, and immutable identity/provenance spine were completed on `agent/strict-manifest`.
- `agent/strict-manifest` was published through checkpoint commit `692b198` before this inventory was reconciled into the stack.
- The legacy PRs/issues and remote branches had not yet been closed or deleted at the moment of this update. Create replacement issues before closing their predecessors, and verify each live branch against its archive tag immediately before deletion.

- Reset base: `f31595a6048a2aa1593a4d9023c6d82cff01a823`
- Project-reset commit: `0ac89a181114c1e3c6bd2130b0cef08145dbc7c2`
- Reset PR: [#123](https://github.com/wharfie/wharfie/pull/123)
- Preservation record: [the July project checkpoint](../../llm/checkpoints/2026-07-16-project-reset.md)
- Remote archive namespace: `archive/2026-07-16/remote/...`

Every branch listed below has an annotated remote archive tag whose peeled commit matches the branch tip captured in the checkpoint. The unpublished local `master` tip and stash have local-only tags and must not be assumed to exist in another clone.

## Decision vocabulary

- **Contained:** the branch has no graph-unique commits; delete the branch after verifying its archive tag.
- **Absorbed:** the useful behavior exists in current `master`, even if history was rewritten; delete after recording the evidence.
- **Selective salvage:** reimplement or cherry-pick only the named pieces, validate them on current code, then delete the source branch.
- **Supersede:** retain the archive tag as research history but carry no code forward.
- **Obsolete:** the work belongs only to abandoned v1 or conflicts with the accepted project boundaries.

## Executive decision

1. Use the three unpublished local packaging commits as the tested implementation baseline for a future salvage branch.
2. Reimplement the useful package, release, and self-hosting details from `jvd/pr4`; do not cherry-pick that mixed branch.
3. Port only a tiny set of safe type-narrowing ideas from `jvd/tsc-lint`, and only after v1 deletion shows which provider files remain.
4. Close PRs #100, #99, and #25 with preservation/supersession notes.
5. Delete every other legacy remote branch after verifying its archive tag.
6. Replace 12 old issues with seven scope-correct issues, close two as subsumed, and close ten as obsolete.

## Remote branch decisions

`Behind/ahead` is the graph divergence from the pre-reset `origin/master`; an ahead count does not imply that a rewritten patch is absent from `master`.

| Branch                   | Behind/ahead | Evidence                                                                                                                                                                                                                         | Decision and action                                                                                                                                                                        |
| ------------------------ | -----------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `jvd/cast-compaction`    |         97/1 | One v1 Athena compaction edit; the new selector can return an empty query fragment.                                                                                                                                              | **Obsolete.** Carry nothing; delete after tag verification.                                                                                                                                |
| `jvd/chore-lint`         |         13/0 | Tip is an ancestor of `master`; operation timestamp/lint behavior is present.                                                                                                                                                    | **Contained.** Delete.                                                                                                                                                                     |
| `jvd/entitlements`       |         22/1 | Modifies the old `build.js`, which current `master` later removed; the identical five entitlements already exist in `MacOSBinarySignature.DEFAULT_ENTITLEMENTS`.                                                                 | **Absorbed.** Delete; separately audit least privilege during release hardening.                                                                                                           |
| `jvd/examples`           |          5/1 | Its only change removes the final newline from a scratch README.                                                                                                                                                                 | **Obsolete.** Delete.                                                                                                                                                                      |
| `jvd/firecracker`        |        126/1 | Pinned Ubuntu 20.04 VMware/Vagrant setup, committed `.vagrant` internals, and unimplemented Firecracker/Nanos claims.                                                                                                            | **Supersede.** Isolation belongs behind later component/capability contracts; delete.                                                                                                      |
| `jvd/more-docs`          |         22/0 | Tip is an ancestor of `master`; content is also superseded by the reset docs.                                                                                                                                                    | **Contained.** Delete.                                                                                                                                                                     |
| `jvd/new-wharfie-events` |         72/0 | Resource-tagging commit is an ancestor of `master`.                                                                                                                                                                              | **Contained.** Delete.                                                                                                                                                                     |
| `jvd/op-tracking`        |         78/4 | One patch-equivalent and three squash-absorbed commits; current operation DAG/run code is the evolved path.                                                                                                                      | **Absorbed.** Audit current ledger semantics instead of cherry-picking; delete.                                                                                                            |
| `jvd/pr4`                |          0/5 | Self-host app, packaging assets/tests, v2 initializer, release fixes, docs, and a stale protobuf bump; overlaps the later local packaging line.                                                                                  | **Selective salvage.** Follow the exact reconciliation plan below, then delete.                                                                                                            |
| `jvd/rust-antlr`         |        130/1 | About 30,000 generated lines for the abandoned Athena parser; `parse()` returns `"hello"`.                                                                                                                                       | **Obsolete.** Delete.                                                                                                                                                                      |
| `jvd/rust-aws-sdk`       |        130/1 | Non-compiling, hard-coded S3 Node-addon experiment with undefined Lambda types.                                                                                                                                                  | **Obsolete.** Delete.                                                                                                                                                                      |
| `jvd/side-effects`       |      155/166 | Parallel history from the initial commit; 133 patches are equivalent to mainline and later v2 work hardened its useful actor/SEA/worker concepts. Remaining Raft/Pear experiments conflict with the accepted coordinator design. | **Supersede.** Carry no code directly; close PR #100 and delete.                                                                                                                           |
| `jvd/tsc`                |          5/5 | Old-path type/dependency work; useful operation and import-meta fixes already landed, while lock changes and v1 edits are stale.                                                                                                 | **Absorbed/superseded.** Delete.                                                                                                                                                           |
| `jvd/tsc-lint`           |         11/6 | Broad pre-`src/` typing experiment; current `master` adopted strict `checkJs` but not every safe narrowing.                                                                                                                      | **Selective manual salvage.** Later port only worker-global typing, AWS tag-map accumulator typing, and safe AWS error narrowing; reject broad `any` shims and v1/mock churn, then delete. |

## Unpublished local work and `jvd/pr4`

### Local implementation baseline

The local-only tag `archive/2026-07-16/local/unpublished-master` points to these three commits, which apply cleanly in order on the reset source tree and passed the full pinned CI suite before the reset:

```text
2f1a4bb test
a1b645f test fix
73de463 fixup
```

They are the later implementation of the shared packaging work and include:

- the self-hosted `apps/wharfie-cli` application;
- generic `packageLocalApp()` and `build-self` plumbing;
- true-SEA enforcement and target Node-version handling;
- packaged manifest/activity execution and activity return propagation; and
- substantial SEA, packaging, embedded-manifest, build-self, and runtime tests.

### Required cleanup after cherry-picking

Do not treat the three commits as merge-ready without one focused cleanup commit:

1. Keep the deletion of generated `scratch/.hello-world/**` state, but revert unrelated diagnostic edits to `scratch/test.js`.
2. Remove `APP_SOURCE_ASSET_NAME`, `readEmbeddedAppSource`, raw `wharfie.app.js` source embedding, and the corresponding test; nothing consumes that embedded source.
3. Replace packaged-entry CLI ownership with the accepted explicit, reserved operator namespace. Neither April line implements that boundary.
4. Keep `packaging.actorSystemProperties` internal/temporary or replace it with explicit target/signing settings; do not make `ActorSystem` an accidental public contract.
5. Remove the hard-coded statement that the repository is pinned to Node 24.13.1 from generic SEA capability errors.
6. Break the self-host app's dependency on v1 init templates before deleting them. Either implement a v2-only scaffold or explicitly omit packaged `init` support until Milestone 2; remove template embedding and update `hasWharfieSources()`/build-self source detection accordingly.

### Unique `jvd/pr4` work to reimplement

Do not cherry-pick any `jvd/pr4` commit wholesale. Its shared runtime code is older than the local line and its README, v1 compatibility, and initializer changes conflict with the reset.

- Update `package.json` manually to include the self-host app, expose the correct build script, use a charter-aligned description, and declare the repository's actual Apache-2.0 license. Replace the hard-coded runtime version with one authoritative source derived from package/release metadata. Add a tarball pack/install test so the allowlist cannot regress.
- Rewrite `.github/workflows/release.yml` using the corrected supported commands, `WHARFIE_MACOS_*` signing variables, and `win32` artifact names as a checklist. The new workflow must run `test:ci`, install the packed tarball, and build/run a real Linux SEA.
- Defer the v2 initializer until the Milestone 2 manifest is fixed. Preserve its scaffold-test approach, but discard the legacy-v1 option and old workflow/resource schema.
- Do not take commit `1425ba6`. It only moves `protobufjs` 7.5.4 to 7.5.5; regenerate the current dependency graph and audit after v1/AWS deletion.
- Discard all legacy-v1 docs, compatibility configuration, and migration-path tests.

### Salvage validation order

1. `npm run test:ci`
2. Inspect `npm pack`, install that tarball in a clean directory, and invoke the supported self-build path from the installation.
3. Build the real Linux SEA from that clean tarball installation rather than from the repository checkout.
4. Run the built SEA's `--help`, then assert that `--version` exactly equals the package/release version.
5. Record the production-audit result as a no-regression baseline; do not require removal of dependencies that the imminent v1 deletion will eliminate. After v1 removal, regenerate the graph and enforce the clean audit policy.

Do not remove this checkout's local archive tags until the salvaged implementation is pushed and all five gates pass.

## Pull request decisions

| PR                                                                                  | Decision                                           | Evidence and closure action                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#123](https://github.com/wharfie/wharfie/pull/123) — project reset                 | **Keep; resolve checks, then merge after review.** | Clean one-commit scope and mergeable. The GitHub Actions `build` passes; external `RWX: push.yaml (push)` currently fails, and its logs are not available through GitHub. This plan is stacked on it.                   |
| [#100](https://github.com/wharfie/wharfie/pull/100) — actor system / graph refactor | **Close superseded.**                              | Conflicted 166-commit/570-file parallel history; 133 patch-equivalent commits and the useful tail was subsequently moved/hardened by #101, #105, #121, and #122. Archive: `archive/2026-07-16/remote/jvd/side-effects`. |
| [#99](https://github.com/wharfie/wharfie/pull/99) — Node entitlements               | **Close already absorbed/superseded.**             | Its deleted-`build.js` change is already present in the current macOS signer. Archive: `archive/2026-07-16/remote/jvd/entitlements`.                                                                                    |
| [#25](https://github.com/wharfie/wharfie/pull/25) — Rust ANTLR                      | **Close obsolete/DNM.**                            | Entirely abandoned Athena parser code; ADR 0005 preserves the valid component-boundary idea without this implementation. Archive: `archive/2026-07-16/remote/jvd/rust-antlr`.                                           |

Suggested PR closure notes:

> Closing as superseded by the Wharfie project reset and subsequent mainline implementation. The branch tip remains preserved at `ARCHIVE_TAG`; no direct merge is planned because `RATIONALE`. Any surviving requirement is tracked in the reset roadmap.

For #25, replace the final sentence with:

> The Athena parser is being removed with v1. Future WASM/native activity support is governed by ADR 0005 and does not reuse this generated implementation.

## Issue decisions

The tracker contained 24 open issues with no labels or milestones. The proposed result is seven new scope-correct issues and no remaining v1 issues.

| Old issue                                                                     | Decision       | Destination or rationale                                                                       |
| ----------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------- |
| [#84](https://github.com/wharfie/wharfie/issues/84) credential refresh        | Replace        | **N1.** Preserve refreshable runtime identity, not the v1 Lambda/Glue path.                    |
| [#83](https://github.com/wharfie/wharfie/issues/83) role propagation          | Replace        | **N1.** Preserve provider identity readiness and bounded reconciliation.                       |
| [#76](https://github.com/wharfie/wharfie/issues/76) SageMaker connector       | Close obsolete | A Wharfie activity can call SageMaker; it is not a framework capability.                       |
| [#64](https://github.com/wharfie/wharfie/issues/64) resource-name uniqueness  | Replace        | **N2.** Preserve stable logical identity, not the old IaC resource model.                      |
| [#58](https://github.com/wharfie/wharfie/issues/58) Athena type casting       | Close obsolete | Athena SerDe/table ingestion is removed.                                                       |
| [#55](https://github.com/wharfie/wharfie/issues/55) transfer cost estimates   | Close obsolete | General cloud cost estimation is outside capability fulfillment.                               |
| [#53](https://github.com/wharfie/wharfie/issues/53) error progress bars       | Close subsumed | M2/M3 own ordinary stdio plus clean human/JSON errors; the old renderer does not survive.      |
| [#51](https://github.com/wharfie/wharfie/issues/51) resource tags             | Replace        | **N3.** Tags become a provider mechanism under ownership receipts.                             |
| [#50](https://github.com/wharfie/wharfie/issues/50) release artifacts         | Replace        | **N4.** Preserve build-once/deploy-by-digest behavior.                                         |
| [#49](https://github.com/wharfie/wharfie/issues/49) project-name validation   | Replace        | **N2.** Recast as canonical logical-ID validation.                                             |
| [#33](https://github.com/wharfie/wharfie/issues/33) bucket-log cleanup        | Replace        | **N3.** Preserve explicit retained/non-empty state semantics.                                  |
| [#23](https://github.com/wharfie/wharfie/issues/23) non-empty bucket deletion | Replace        | **N3.** Preserve data-safe explicit destroy behavior.                                          |
| [#20](https://github.com/wharfie/wharfie/issues/20) predicted costs           | Close obsolete | `plan` previews mutations, not unreliable spend estimates.                                     |
| [#17](https://github.com/wharfie/wharfie/issues/17) S3 path collisions        | Replace        | **N2.** Generalize into collision-free managed namespaces.                                     |
| [#14](https://github.com/wharfie/wharfie/issues/14) tiered config             | Close subsumed | CLI/no-Node progression is now canonical; generic CFN/Terraform tiers conflict with the scope. |
| [#12](https://github.com/wharfie/wharfie/issues/12) UDF return types          | Close obsolete | Athena UDFs are removed.                                                                       |
| [#11](https://github.com/wharfie/wharfie/issues/11) UDF row/map inputs        | Close obsolete | Athena UDFs are removed.                                                                       |
| [#10](https://github.com/wharfie/wharfie/issues/10) SQS DLQ topology          | Close obsolete | Provider topology is not public durable-failure semantics; N5 covers the general concern.      |
| [#9](https://github.com/wharfie/wharfie/issues/9) CloudWatch/SNS alarms       | Close obsolete | Provider-specific v1 notifications belong in application activities if needed.                 |
| [#8](https://github.com/wharfie/wharfie/issues/8) real E2E tests              | Replace        | **N6.** Preserve real-provider validation around the new golden path.                          |
| [#7](https://github.com/wharfie/wharfie/issues/7) DLQ/replay correctness      | Replace        | **N5.** Preserve failure/replay validation through invocation/effect semantics.                |
| [#6](https://github.com/wharfie/wharfie/issues/6) UDF build system            | Close obsolete | UDFs are removed; Wharfie must not become a general polyglot build system.                     |
| [#5](https://github.com/wharfie/wharfie/issues/5) nested CFN stacks           | Close obsolete | CloudFormation topology is outside the provider abstraction.                                   |
| [#2](https://github.com/wharfie/wharfie/issues/2) GitHub release artifacts    | Replace        | **N7.** Preserve release distribution around Wharfie SEA assets, not Lambda bundles.           |

## Replacement issue specifications

Create replacements before closing any issue that points to them.

### N1 — Make provider identity bootstrap and credential refresh resilient

- **Milestone:** M4 — self-deployment and capability fulfillment
- **Replaces:** #83 and #84
- **Acceptance:** operator credentials come only from normal provider chains and are never embedded; runtime identity is least-privilege and refreshable; reconciliation handles identity propagation with bounded observable retries; expiry/rotation tests prove recovery without duplicate provisioning.

### N2 — Define canonical logical IDs and collision-free managed namespaces

- **Milestone:** M2 — one portable application
- **Replaces:** #64, #49, and #17
- **Acceptance:** define grammar, normalization, scope, and uniqueness for application/activity/deployment IDs; reject duplicates; separate logical IDs from provider physical names; make managed artifact/control-state keys provably disjoint from user-owned namespaces; test collisions and stable serialization round trips.

### N3 — Make managed-resource ownership and destroy behavior data-safe

- **Milestone:** M4 — self-deployment and capability fulfillment
- **Replaces:** #51, #33, and #23
- **Acceptance:** record ownership receipts and provider markings; distinguish managed from external resources; never destroy unproven/external resources; make reconcile/destroy retry-safe; require explicit retention or purge policy for non-empty state; verify cleanup without silent data loss.

### N4 — Deploy immutable application revision artifacts without rebuilding

- **Milestone:** M4 — self-deployment and capability fulfillment, with an M2 artifact-identity prerequisite
- **Replaces:** #50
- **Acceptance:** M2 produces one content-addressed artifact per revision/target, binds digest/provenance to revision metadata, and verifies it locally. M4 package/deploy/install consumes and verifies that exact digest without rebuilding; changed inputs require a new revision/artifact.

### N5 — Prove durable failure, retry, and uncertain-effect recovery

- **Milestone:** M3 — one durable node
- **Replaces:** #7; subsumes the general durable-failure concern behind #10
- **Acceptance:** deterministic crash/lease-loss tests cover every commit boundary; replay-safe work retries by policy; begun unsafe work blocks as `uncertain`; no durably accepted invocation is lost and no conflicting terminal outcome commits; human and JSON operations expose retry/reconciliation decisions.

### N6 — Add a clean-account self-deployment end-to-end test

- **Milestone:** M4 — self-deployment and capability fulfillment
- **Replaces:** #8
- **Acceptance:** in a real golden-provider account, build the SEA, plan/apply, install and boot the service, execute and inspect durable work, prove restart recovery, exercise quiescent upgrade/rollback, destroy, and assert that only owned resources changed. There are no unexpected leftovers; under an explicit purge profile, no owned resources remain.

### N7 — Publish version-aligned Wharfie SEA assets with npm releases

- **Milestone:** M1 — remove ambiguity and loose ends
- **Replaces:** #2
- **Acceptance:** a tag uses the supported packaging path to publish the npm package and initial Linux SEA; GitHub/npm/runtime versions agree; checksum/provenance are attached; a clean target smoke-tests `--help` and `--version`; the workflow references no missing commands or files.

N4 governs artifacts produced for user applications. N7 governs distribution of Wharfie itself; they should remain separate.

## Issue closure notes

For an obsolete v1 implementation, close as not planned:

> Closing as obsolete in the Wharfie project reset. This issue targets the v1 `MECHANISM`, which is being removed without compatibility requirements. The accepted project charter does not carry this mechanism forward; the issue remains available as historical context.

For work outside the new boundary, close as not planned:

> Closing as outside the reset scope. Wharfie provisions only the finite substrate required by first-class capabilities; it is not a general IaC, cloud-cost, or provider-native application-service connector framework. This behavior can live in application code or external tooling if needed.

For a subsumed implementation detail, close as not planned rather than completed:

> Closing this implementation-specific issue as subsumed by `PROJECT/ROADMAP SECTION`. The underlying requirement—`REQUIREMENT`—remains, but the v1 mechanism described here will be deleted and does not need a compatibility issue.

For a replacement, create the new issue first and close the old issue as a duplicate:

> Superseded by #NEW, which preserves the valid concern in Wharfie's new application model and defines current acceptance criteria. This issue's v1-specific implementation is being removed, so further work should be tracked on #NEW.

## Execution order

1. Review and merge project-reset PR #123.
2. Review this inventory, correct it, and confirm that the current task authorizes each external mutation.
3. Create or verify GitHub milestones corresponding to the roadmap stages used by N1–N7.
4. Create N1–N7 with those milestones, then close the 24 old issues using the mapped reason and note.
5. Close PRs #100, #99, and #25 with archive links.
6. Verify each live branch tip still equals its peeled archive target, then delete every legacy branch except `jvd/pr4` and, temporarily, `jvd/tsc-lint`.
7. Create a packaging-salvage branch from reset `master`, cherry-pick the three local commits, apply the required cleanup, and manually reimplement the named `jvd/pr4` pieces.
8. After all salvage validation gates pass and the work is pushed, delete `jvd/pr4` and retain the local archive refs until the implementation is merged.
9. Delete v1 and its dependency/test/documentation surface, including the self-build template dependency addressed during salvage.
10. Re-evaluate the three narrow `jvd/tsc-lint` ideas against the surviving provider code, port only justified changes, then delete that branch.
11. Regenerate the dependency graph, enforce the production audit policy, and repair release distribution before adding new durable-runtime features.

## Mutation verification gates

- Before deleting a branch, compare its live tip with the peeled `archive/2026-07-16/remote/<branch>` tag.
- Never publish the local stash or local-only archive tag without an explicit content review and current authorization.
- Create replacement issues before closing their predecessors so closure notes can link a real issue number.
- After tracker cleanup, expect no open v1 issue and no open legacy PR; N1–N7 become the implementation tracker beneath `ROADMAP.md`.
- After branch cleanup, expect only `master`, current active work branches, and any deliberately retained salvage branch.
- Run the full validation sequence again after v1 removal; the current green suite does not prove that the reduced package, release workflow, or real SEA artifact works.
