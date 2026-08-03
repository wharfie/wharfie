# V61 selected SEA artifact authority checkpoint

Date: 2026-07-24

Parent:
[V60 one-shot deployment operation runner](./2026-07-24-v60-one-shot-deployment-operation-runner.md)

## Restart summary

Wharfie's first golden path remains one approachable TypeScript/Node SEA that
can run locally, become a durable single-node AWS service through the user's
ordinary credential chain, and later be inspected, reconciled, updated, or
destroyed without a hosted orchestrator. Nodes are trusted. One coordinator is
acceptable initially, provided its durable authority is recoverable. V1,
backward compatibility, trustless mesh, general-purpose cloud IaC, and a web UI
remain outside the current scope.

V60 added a finite, invocation-owning AWS operation runner but deliberately
left source-mode artifact selection closed. V61 adds the process-local
authority that joins one fresh package generation to one exact held SEA. It
does not yet expose deployment commands or claim that this ephemeral
capability is durable.

## Closed fresh-generation mint

`packageSelectedSeaArtifact()` is the only mint. It validates and snapshots the
complete request before crossing an await, resolves source and output
directories immediately, and calls the closed `packageLocalApp()` dependency
itself. A caller cannot inject a package result, artifact path, record sidecar,
or descriptor opener.

The mint requests one canonical target, including the required libc identity
for Linux, and accepts exactly one returned target and artifact. The returned
app, application revision, target, output directory, file name, artifact path,
record path, artifact identity, revision identity, digest, size, complete
artifact record, and requested target must all agree. Nested build assets and
signing credentials are independently descriptor-snapshotted before
packaging. The fresh result's complete generation evidence is
deep-snapshotted before descriptor opening can await.

The artifact-record sidecar path is checked as package-result consistency but
is never read as authority. Arbitrary paths and unsigned sidecars therefore
cannot mint this capability.

## Exact held-byte evidence

The mint opens the final artifact path once with
`openHeldArtifactSource()`. That source hashes through one retained file
descriptor and later streams through the same descriptor, so pathname
replacement cannot redirect the claimed bytes.

`validateArtifactRecordObservation()` now validates a complete ArtifactRecord
against a trusted held-descriptor observation plus its application revision.
It shares the same normalized record construction as the existing in-memory
byte validator while avoiding a second whole-artifact Buffer. Artifact ID,
SHA-256 digest, size, app, revision, target, target ID, format, and provenance
remain independently cross-checked.

`createDeploymentRevisionFromArtifactObservation()` creates reference identity
from the same application revision, embedded runtime projection, and exact
held-byte observation. The JSON document is evidence, not staging authority.
The existing running-SEA constructor now shares this path while preserving its
original guarantee that deployment/profile input is validated and frozen
before artifact observation begins.

## Linear process-local authority

The public authority is an empty frozen null-prototype object branded only by
a module-private WeakMap. Its revision, runtime, record, held source,
deployment binding, and lifecycle never appear on the token. Spreads, JSON
round trips, proxies, reconstructed objects, duplicate module instances,
workers, IPC, and later processes cannot recreate or transport the brand.

While ready, the authority can:

- expose a frozen non-authorizing identity summary;
- bind exactly one deployment/profile tuple and return its deployment
  revision; and
- synchronously transfer the source exactly once after the complete bound
  deployment revision, profile, and provider scope validate.

An invalid claim does not cross an await or transfer ownership, so the caller
may correct it. A successful claim atomically changes the state before
returning a self-contained bundle with those canonical deployment values,
generation evidence, and the held source. Downstream staging never needs to
reuse mutable caller input. An unclaimed authority may instead be discarded;
repeated discard returns the same close promise, including the same rejection.
Claimed and discarded authorities cannot be inspected, rebound, reclaimed, or
switched to the other terminal operation.

## Cleanup precedence

Descriptor opening, selected-artifact mint validation, and running-artifact
staging now retain deterministic cleanup failures:

- primary failure plus successful close throws the original primary value;
- successful work plus close failure throws the original close value; and
- simultaneous primary and close failures throw one ordered AggregateError
  with `[primaryError, closeError]`.

Explicit settlement booleans preserve `undefined` and other non-Error
rejection reasons. Held descriptors are closed exactly once on every
attempted-mint failure and explicit discard path. A caller that abandons a
ready authority without claiming or discarding it has violated the ownership
contract; V61 does not claim GC-driven descriptor cleanup.

## Deliberate remaining boundary

V61 authority is process-local by design. The next slice must consume it during
a source-mode plan and durably stage the exact selected bytes before that plan
returns. The resulting immutable intent, exact provider object version, and
receipt must be enough for a later-process converge to validate and use the
pre-staged artifact.

That converge path must not rebuild the application, reopen a caller path,
trust a sidecar, or silently fall back to the Node executable running a source
command. The staging integration must consume the claim's already validated
deployment/profile/provider-scope context and unconditionally close the
claimed source after transfer.

Only after that sequencing is proven should source and packaged `plan`,
`apply`, `inspect`, `reconcile`, and `destroy` commands be mounted. Guest
storage projection, resident-service activation, privileged host observation
and publishing, live STS role/session proof, DESTROYED-tombstone reapply,
clean-account proof, and provider-effect exactly-once execution also remain
unfinished.

## Verification and disk hygiene

Final assembled verification passed:

- focused V61 authority and supporting-runtime gate: **5 suites, 123 tests, 0
  snapshots** in **0.925 seconds**;
- complete deployment regression gate: **78 suites, 2,796 tests, 0
  snapshots** in **297.892 seconds**;
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
