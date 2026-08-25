# SEA packaging reproducibility checkpoint

- **Date:** 2026-07-30
- **Status:** default Linux and ad-hoc macOS SEA packaging is byte-reproducible
  on the pinned builder; cloud cleanup independently rechecked
- **Branch:** `agent/two-provider-deploy`
- **Starting commit:** `a42bc890a8332637dbb85c646189b6364a7f2e03`
- **Implementation commit:** the commit containing this checkpoint
- **Parent checkpoint:**
  [two-provider self-deployment](2026-07-29-two-provider-self-deployment-scope.md)

## Goal

Close the recovery gap exposed by the live two-provider proof: rebuilding one
unchanged application revision must reproduce the exact operator SEA bytes
needed by its durable deployment journal. Do that without leaving cloud
resources or large test artifacts behind.

## Cloud cleanup recheck

Before changing packaging, fresh read-only provider inventories independently
rechecked the live proof scopes:

- AWS was searched across all 17 enabled regions for the exact Wharfie
  ownership tags `wharfie:managed-by=wharfie` and
  `wharfie:single-node-schema=1`. It contained zero live instances, terminated
  tombstones, EBS volumes, or security groups matching those tags.
- The Hetzner project was searched through the production provider client for
  `wharfie.dev/managed-by=wharfie` and `wharfie.dev/schema=1`. It contained zero
  servers, Primary IPs, or firewalls matching those labels.

No resource needed another delete. Credential values were never printed or
written into the repository, and packaging verification received no cloud
credentials.

## Reproduced failure

Two clean Linux x64 package runs of the unchanged hello-world revision
`wrv1_bBSIekn9naRflT1JJhpH4LGuvflSQoTUEHVph1XstG4` produced executables with
the same 156,961,984-byte length but different artifact IDs:

```text
waf1_zN1GGxGJSkA3s-Y2xXIV0qoAPxA2tIAccXMAHSALcWg
waf1_JRLsVeYAHwjfJeyxxGx5LvmhFLW7jPlIdbHN0ub0AQ8
```

The mismatch was therefore final-byte nondeterminism, not a changed
application revision.

## Root causes and fixes

Four host-private inputs could affect final bytes:

1. Node serialized absolute temporary `main` and asset paths into the SEA blob.
   Wharfie now writes canonical build-relative config paths and generates the
   blob with the private build directory as the child working directory.
2. Inline source maps named random revision-snapshot paths. Packaged activity
   and core bundles now omit source maps, and the unused
   `source-map-support` runtime dependency and entrypoint wiring are gone.
3. macOS `codesign` derived its default CodeDirectory identifier from the
   random private executable basename. Wharfie now supplies a stable
   `io.wharfie.sea.sha256.<digest>` identifier derived from the exact unsigned
   executable bytes.
4. Nested SEA injection temporarily replaced Node's sentinel fuse with a
   random marker. The collision-checked marker is now derived from a
   domain-separated digest of the SEA blob and attempt number.

The runtime input lock also excludes only the three known repository runtime
README files. Those documentation-only files no longer churn application
revision identity, while any other future Markdown runtime input remains
identity-bearing.

Focused tests cover relative SEA config paths, source-map policy, deterministic
nested masking, stable ad-hoc and identity-signing identifiers, packaged
entrypoint wiring, and the narrow runtime-documentation exclusion.

## Final byte proof

From a clean hello-world copy with no `dist` or `.wharfie` state, the final
source tree ran this command twice under Node 24.13.1:

```text
node <checkout>/bin/wharfie app package . --self-deployable \
  --target node24.13.1-darwin-arm64 \
  --output-dir ./dist \
  --json --no-pretty
```

The first artifact was executed successfully and returned `Hello, Ada!`. Its
entire output directory was then deleted before the second build. Both runs
returned the same:

```text
revisionId:  wrv1_WIlAf9zO90emR2EBKuXxJTQpVndTbmAUfAuhcMavoj4
artifactId:  waf1_wIUtV-BRm13g3Fr7TS8OonPpjWU06NrSbl-TZ834fpw
size:        259978704
sha256:      c0852d57e0519b5de0dc5afb4d2f0ea273e98d6534e8dad26e5f9367cdf87e9c
```

This is the complete ad-hoc-signed macOS arm64 operator SEA, including its
embedded Linux x64 application SEA and deployment payload. Equality of the
outer executable therefore includes equality of the nested recovery artifact.

An earlier post-fix standalone Linux x64 check also produced the same
133,631,168-byte artifact in two independent runs. The full nested proof above
is the final-source acceptance result.

## Contract boundary

The demonstrated guarantee is repeated packaging on the pinned Node 24.13.1
builder with identical sealed inputs, using unsigned Linux output or Wharfie's
default ad-hoc macOS signature. A certificate/identity-signed distribution may
still contain signing-service timestamps and is not claimed byte-reproducible.
Cross-host reproducibility is also not claimed by this same-host proof.

Artifact content addressing remains authoritative in every mode. Existing
deployment journals still name exact historical artifact bytes; this change
makes a future unchanged default build reproduce those bytes rather than
weakening journal verification.

## Cleanup

- The temporary hello-world copy and every generated 133–260 MB executable
  were removed.
- Test-owned Jest cache and empty Wharfie temporary directories were removed.
- Persistent Wharfie `builds`, `applications`, and `actor_binaries`
  directories are empty.
- The pre-existing 230 MB verified Node-binary cache was retained to avoid
  needless downloads.
- The original 293 MB hello-world demo artifact remains intentionally retained
  in the sibling demo directory; it was not produced by this verification.
- No AWS or Hetzner resource remains from the live proofs.

## Work next

1. Build the repeatable redacted two-provider acceptance harness for the
   remaining ADR 0035 evidence.
2. Add approachable credential-check, preview, status, update, and recovery
   commands around the proven apply/destroy slice.
3. Decide the retained-data capability before claiming durability beyond a
   node root disk.
