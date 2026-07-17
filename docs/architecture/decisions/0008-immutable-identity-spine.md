# 0008 — Immutable revision, artifact, and deployment-profile identities

**Status:** Accepted · **Date:** 2026-07-17

## Context

The strict version 2 application manifest defines one inspectable application
contract, but a manifest is not yet an immutable revision. Its target list is a
packaging request, source and lockfile changes can alter behavior without
changing the manifest, and one logical application version can produce several
platform-specific executables. Conversely, a signed executable cannot contain
its own final content hash: adding that hash changes the bytes being hashed, and
platform signing can change them again.

Wharfie needs a small identity spine before adding deployment or durable-run
schemas. It must distinguish logical application behavior, the exact bytes
installed on one target, and the operator-selected environment bindings. Those
identities must be immutable and cross-checkable so a later deployment or
operation cannot silently move to different code, bytes, or bindings.

## Decision

### Logical revisions

A logical revision is target-independent. Its canonical JSON-compatible
identity payload is exactly:

```text
{
  schemaVersion: 1,
  kind: "applicationRevision",
  contract: <strict target-free application contract>,
  inputs: <versioned source, dependencies, runtime, and optional asset locks>
}
```

Together, `contract` and `inputs` contain:

- the strict canonical application contract projected without `targets` or
  other target, signing, build-host, deployment, or provider choices;
- a digest of the complete behavior-bearing source set;
- a digest of the dependency lock and its versioned interpretation rules;
- a digest of the target-independent Wharfie runtime and loader behavior used
  to interpret the application contract; and
- canonically ordered digests for every additional behavior-bearing asset.

The target-free contract retains the application ID, CLI, activities, and
portable resource requirements. A file or input that can change observable
application behavior must be represented by one of the source, lock, runtime,
or behavior-asset digests. Signing credentials, timestamps, build logs, target
selection, and provider configuration are not revision inputs.

Every digest role and digest algorithm is named in the identity payload; raw
digests are not concatenated without structure. The revision identifier is:

```text
revisionId = "wrv1_" + base64url(
  SHA-256(
    UTF-8("wharfie:revision:v1\0") ||
      canonicalJson(identity payload excluding revisionId)
  )
)
```

The fixed prefix and hash-domain string prevent a revision digest from being
accepted as another Wharfie identity type. Canonical JSON, source-tree, lock,
runtime, and asset-digest algorithms are versioned inputs to this contract; an
algorithm change that can change the preimage requires a new revision identity
version rather than an in-place reinterpretation.

An application can have many revisions. Changing the target-free contract,
behavior-bearing source, lock, target-independent runtime, or behavior asset
always creates a different `revisionId`. Adding another build target or changing
only signing and build-host inputs does not.

Revision compilation consumes a private application snapshot rather than
hashing one tree and later building from a mutable authoring tree. Source and
behavior-asset files are opened without following final symbolic links, checked
as regular files, read twice through the same descriptor, and checked for
metadata changes around the read. Wharfie rejects symbolic links, special
files, excluded output/state paths, and source paths that escape the application
root. It then seals the copied snapshot and uses those paths for packaging and
durable local execution.

Source activity bundles are audited against the bundler's static module graph.
Every bundled application input must be inside the sealed snapshot. The
Wharfie public API and exactly declared activity externals remain external to
that source graph. An undeclared package or transitive source escape fails the
revision build instead of becoming an unrecorded behavior input.

### Target artifacts and provenance

An artifact is the exact final executable or component byte sequence for one
exact target. Its byte digest is computed only after every mutation, including
SEA injection, platform metadata changes, and signing:

```text
byteDigest = SHA-256(finalArtifactBytes)
artifactId = "waf1_" + base64url(byteDigest)
```

The `waf1_` namespace makes the textual identity type explicit while the digest
directly addresses the final bytes. Any byte change, including a different
signature or signing timestamp, creates a different artifact. One logical
revision and target may therefore have more than one artifact record.

An immutable `ArtifactRecordV1` binds exactly:

- `artifactId`, byte-digest algorithm and value, and byte length;
- the owning application ID and `revisionId`;
- the exact Node version, platform, architecture, Linux libc target, and
  canonical target ID;
- the versioned artifact format; and
- one strict provenance object containing the builder identity/version,
  runtime/toolchain digests, exact Node binary and optional official archive,
  target dependency-closure digest, and signing mode plus non-secret signer
  identity when applicable.

`ArtifactRecordV1` contains exactly one strict inline provenance object and
rejects build time, host description, logs, and other observational fields.
Those observations belong in a separate log or envelope. One published
content-addressed executable/sidecar pair is one immutable v1 association; the
same bytes paired with different v1 provenance conflicts rather than rewriting
the sidecar. A future registry may attach several append-only provenance
statements to the same byte-derived `artifactId`, but it cannot rewrite an
earlier statement or change an accepted revision or target association.

The initial SEA provenance records the exact Node executable digest, an
official Node download receipt when one is available, the exact embedded target
dependency-archive digest, installed packaging-tool versions, and any non-secret
platform-signing result. Published executables use a content-derived filename:
`<app>-sha256-<64 lowercase hexadecimal digits>[.exe]`. Each executable is
paired with a canonical `<filename>.artifact.json` record sidecar. Publication
uses create-if-absent filesystem links, validates and reuses an existing exact
pair, rejects a conflicting or incomplete pair, and never overwrites an
existing content-addressed destination.

The final `artifactId` is not required or permitted as an identity-bearing field
inside the bytes it names. The SEA reserves
`<WHARFIE_APP>/revision.json` for the complete validated
`ApplicationRevisionV1` and `<WHARFIE_APP>/runtime.json` for this exact strict
runtime record:

```text
{
  schemaVersion: 1,
  kind: "artifactRuntime",
  appId,
  revisionId,
  target
}
```

The embedded pair is cross-validated for application and revision agreement.
It deliberately contains neither `artifactId` nor provenance. Artifact
verification compares downloaded bytes with the external immutable artifact
record. This avoids a self-hash cycle and ensures verification covers the
signature and every post-build mutation.

The reserved `wharfie metadata` command reports the embedded revision and
runtime records and computes the identity of the executable bytes actually
running; it does not treat that runtime observation as an embedded self-claim.

### Deployment profiles

`DeploymentProfileV1` is deliberately narrow. It contains only:

- a human-authored `profile.id` using Wharfie's canonical logical-ID grammar;
- the application ID the profile is allowed to deploy;
- one exact target using the same Node, platform, architecture, and libc fields
  as an artifact record; and
- optional `db`, `queue`, and `objectStorage` bindings, each with the exact shape
  `{ kind: "external", ref: <canonical logical ID> }` and referring to an
  already-existing resource.

An external binding is a reference, not desired infrastructure. It contains no
embedded credential or secret, grants Wharfie no ownership claim, and cannot
authorize create, mutate, or destroy behavior. Current profile revisions cannot
contain managed-resource bindings, credentials, environment values, provider
configuration, topology, or unknown binding kinds.

The complete strict canonical profile content, excluding
`profileRevisionId` itself, produces an immutable domain-separated identity:

```text
profileRevisionId = "wpr1_" + base64url(
  SHA-256(
    UTF-8("wharfie:deployment-profile:v1\0") ||
      canonicalJson(DeploymentProfileV1 without profileRevisionId)
  )
)
```

`profile.id` is a stable human name and may have many immutable profile
revisions. Changing the app ID, target, or any external binding creates a new
`profileRevisionId`; a mutable `profile.id` or a `latest` alias is never a
sufficient durable binding.

### Future deployments and operations

A future `Deployment` binds an exact `revisionId`, `artifactId`, and
`profileRevisionId`, not only their human names. Validation requires all three
to name the same application, requires the artifact to belong to the revision,
and requires the artifact target to equal the profile-revision target. Changing
any member of that tuple is a new deployment revision or an explicit deployment
transition, never an in-place reinterpretation of history.

Durable operation identity is fenced by revision. Persisted operations and the
future run/invocation ledger bind `appId` and `revisionId`. Provider-message
operation IDs remain revision-independent so deploying a new revision cannot
turn one provider delivery into new work. A worker that observes the same
provider message under a different revision fails closed and leaves it
undeleted until old-revision routing or recovery can handle it. Caller-supplied
operation IDs are likewise checked against the persisted revision and conflict
visibly rather than deduplicating or continuing work under different code.
Other derived trigger identities decide whether revision is part of their
domain-separated preimage according to the trigger's replay semantics. Claims,
retries, and result commits validate the mandatory persisted `revisionId` along
with their other fencing values.

The immutable operation association also contains the activity event and stable
user-supplied activity context. Provider receipts, delivery observations, and
other current-attempt metadata are excluded from durable identity and supplied
separately as volatile `attemptContext`. Retrying may change attempt metadata;
reusing the same operation ID with different stable context fails visibly.

### Initial implementation boundary

The first implementation records the package-lock digest in the logical
revision and validates declared direct external versions, but target packaging
still constructs the external dependency closure through the installed package
toolchain instead of consuming and fail-checking one frozen complete transitive
closure from that lock. Artifact provenance records the exact resulting target
archive digest, so every produced executable remains exactly identifiable, but
the same logical revision could currently produce a different artifact if that
resolution changes. Closing this gap is a release blocker, not a relaxation of
the revision contract above.

The source-graph audit follows statically discoverable bundler inputs. Runtime-
computed module paths require a future explicit declaration or rejection rule
before Wharfie can claim that all such behavior is represented by the revision.

## Consequences

- One target-independent revision can own Linux, macOS, and Windows artifacts
  without turning target selection into application behavior.
- The exact installed and executed bytes are independently verifiable, including
  their platform signature, without asking a binary to contain its own hash.
- Non-reproducible builds or signing timestamps may produce several artifact
  IDs for one revision and target. A deployment still selects one exact artifact
  and can be audited against its provenance.
- Human profile names remain approachable, while durable state binds an
  immutable profile revision. Rebinding an external database or queue is an
  explicit new profile revision.
- Runs and operations cannot silently cross an application revision during a
  retry, deduplication decision, upgrade, or stale-worker commit.
- Revision hashing, source bundling, packaging, and durable local invocation
  consume the same sealed application snapshot instead of racing the mutable
  authoring tree.
- Content-addressed artifact publication is monotonic: an exact executable and
  sidecar can be reused, while conflicts and partial pairs fail visibly rather
  than replacing prior output.
- Deployment, run history, and retained revision records become roots for later
  artifact and revision garbage collection; moving aliases are never roots by
  themselves.

## Non-goals

This decision does not define or implement:

- cloud planning, provisioning, reconciliation, or destruction;
- managed-resource bindings or ownership receipts in deployment profiles;
- provider credential handling or a general infrastructure-as-code schema;
- the future `Deployment` lifecycle, rollout, rollback, or node-enrollment
  state machine;
- the run → invocation → attempt → effect ledger;
- a reproducible-build claim. Provenance and final-byte addressing make the
  actual output inspectable even when independently rebuilding identical bytes
  has not yet been proven; or
- a remote artifact/provenance registry or multi-statement provenance storage
  model.
