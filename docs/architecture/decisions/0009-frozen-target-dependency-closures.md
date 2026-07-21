# 0009 — Frozen target dependency closures

**Status:** Accepted · **Date:** 2026-07-17

## Context

An immutable application revision already names a dependency-lock digest, but a
digest alone does not say how Wharfie turns that lock into the packages used by
one activity on one target. The initial packaging path asked npm tooling to
construct an install tree at build time. Registry state, optional-dependency
selection, package-manager heuristics, or ambient `node_modules` could therefore
change executed behavior without changing the logical revision.

Wharfie needs one deliberately narrow interpretation of a lock that can be used
for both source-revision execution and packaged SEA execution. The result must
fail closed when the lock cannot fully describe the selected packages. It does
not need to emulate every npm installation feature, support private registries,
or prove reproducible final executable bytes in this first version.

## Decision

### One sealed lock interpretation

Dependency input format `wharfie-npm-package-lock-v3-closure-v1` accepts one
application-local npm `package-lock.json` with `lockfileVersion: 3`. Wharfie
reads the sealed lock without following a final symbolic link, verifies stable
regular-file bytes, parses and canonically orders its JSON value, and checks the
resulting SHA-256 digest against the owning `ApplicationRevisionV1` before
planning or fetching a package.

Wharfie copies those canonical bytes into a private directory and uses
Arborist's `loadVirtual()` only to interpret npm's locked physical layout and
peer edges. It never constructs an ideal tree, consults package manifests to
resolve a range, updates the lock, or treats an ambient install as an input.

Each activity external is an explicitly authored exact `{ name, version }`
pair (or `name@version` shorthand). Bare package names are rejected rather than
resolved from the builder's installed tree. The external must be a root
production or optional dependency in the lock, resolve to the same package name
and exact semantic version, and support the requested target. Closure traversal
includes production, optional, peer, and optional-peer edges; development edges
are excluded. Target selection evaluates package `os`, `cpu`, `libc`, and Node
engine constraints. An incompatible required edge fails. An incompatible
optional edge is not selected, but failure to fetch, extract, or validate an
optional package that was selected is fatal.

The initial target surface remains Node/TypeScript, `x64` or `arm64`, and
`glibc` for Linux. Darwin and Windows target records remain supported by the
existing build-target contract. Source execution on Linux must positively
identify a glibc host; an unknown or musl host fails rather than being labelled
compatible.

### Registry and materialization boundary

Every selected package must have:

- a canonical package name and exact semantic version;
- a credential-free canonical HTTPS tarball URL with no query or fragment; and
- one canonical SHA-512 SRI value encoding exactly 64 bytes.

Npm aliases, workspace/file links, symbolic lock nodes, bundled dependencies,
non-registry dependency edges, unsupported target constraints, missing required
edges, and other unrepresented layouts fail closed. Closure v1 does not support
private-registry authentication. Supporting normal npm credential chains later
requires an explicit locator/authentication design that keeps secrets out of
revisions, plans, receipts, archives, and logs.

Wharfie fetches each exact locked tarball into memory with pacote and verifies
its SRI. Before extracting those same bytes, it requires canonical `package/`
paths, rejects traversal, duplicates, embedded `node_modules`, links,
hardlinks, and special entries, and permits only regular files and directories.
It then extracts those same validated bytes at the exact locked physical
`node_modules` location. The extracted manifest must match the lock-bound
dependency, peer, target, engine, bundle, and install-script contract; the
resulting tree may contain no unplanned roots, links, or special files. Wharfie
does not run lifecycle scripts and does not create package `bin` links. These
are explicit frozen-lock semantics, not a claim of complete `npm install`
compatibility. A package that requires an install script to become usable is
unsupported unless its published locked bytes are already usable for the
selected target.

### Receipts and consumption

The canonical activity/target plan records the exact lock descriptor, target,
roots, physical packages, edges, URLs, SRI values, target constraints, and the
fixed install semantics above. Its semantic receipt is:

```text
SHA-256(
  UTF-8("wharfie:frozen-dependency-closure:v2\0") ||
    canonicalJson(plan)
)
```

Plan schema v2 makes every dependency edge explicit. Required edges name one
exact physical package, while a target-incompatible optional dependency or an
absent optional peer retains a typed null-location omission and its reason.
The pure plan contract verifies exact edge coverage, reachability, target
constraints, package-manifest behavior, and the domain-separated digest
without importing registry or npm planning tools.

Wharfie archives the materialized closure and separately hashes the exact
archive bytes. Each strict function asset seals the activity name, target,
exact direct externals, owning dependency-lock descriptor, semantic closure
digest, archive digest, and archive bytes in one canonical receipt. Artifact
provenance consumes receipt evidence derived from the exact bytes selected for
SEA and only uses mutable resource outputs as fail-closed consistency checks.
Changing a producer field after SEA sealing therefore cannot relabel an
unchanged archive or closure. Activity closure plans remain represented by
their semantic digest in function assets. Wharfie's core local-durable-storage
closure additionally embeds its complete canonical plan in a strict v3 SEA
manifest so the packaged runtime can independently preflight the one extracted
LMDB tree shared by its separate control and application-data roots.

Before SEA generation, every configured asset is stably read and copied into a
private build directory. Function-asset digests and strict receipts are parsed
from the exact selected bytes and checked against the resource that produced
them. The successful generation evidence also freezes the exact pre-injection
Node bytes, its validated official archive receipt or explicit absence, every
embedded asset digest, the final SEA digest, and the validated signing
transition. Artifact provenance consumes that generation evidence rather than
rereading adjacent mutable receipts or build inputs later.
Runtime execution checks the embedded archive's raw digest before starting a
worker, extracts it into a fresh private mode-0700 root, rejects links and
special entries, never reuses a deterministic on-disk cache, and removes the
root when its worker or cache entry is destroyed.

Packaged core dependencies use a separate v2 temporary authority scoped by
effective UID and an opaque host identity. Every fresh root atomically names
its host, boot, PID namespace, PID, and (on Linux) kernel process-start time.
Normal exit removes the root. Before allocating another root, a successor
inspects at most 128 direct entries and removes at most eight roots whose owner
is positively dead. A different Linux boot proves death only when the stable
machine identity also matches; a reused PID is distinguished by its process
start time. Foreign-host, foreign-namespace, malformed, wrong-owner, and
otherwise uncertain claims are retained. More than eight stale roots converge
through explicit retries, while an oversized or ambiguous directory requires
manual inspection instead of unbounded startup work or speculative deletion.
Unrecognized entries are never deleted.

Before packaged core code is required, Wharfie verifies the exact planned
package-location set and every extracted package manifest. It resolves every
root and dependency edge from its real CommonJS caller and requires the entry
to belong to the exact planned package rather than an ancestor, parent,
nested-package, or other ambient location. An explicitly omitted optional edge
must resolve to `MODULE_NOT_FOUND`; finding an ambient implementation is a
hard failure. Runtime-computed non-package paths remain outside this static
preflight and do not make the SEA a hostile-code sandbox.

Revision-backed source activity execution uses the same closure planner,
materializer, archive verification, and private worker-root boundary for the
current host target. A declared external cannot fall back to ambient
`node_modules`; source execution requires the prepared revision and its sealed
dependency lock.

## Consequences

- Registry state and ambient installs can no longer silently select a different
  activity dependency graph for one accepted revision and target.
- A closure's semantic identity is distinct from its archive-byte identity.
  Both are inspectable and bound to artifact provenance.
- Optional dependencies become deterministic target-plan inputs. Once selected,
  their failure is visible rather than silently ignored.
- Packages that depend on lifecycle scripts, generated bin links, links,
  bundles, aliases, private registry credentials, or unsupported target layouts
  are intentionally rejected until those behaviors gain explicit contracts.
- Source and packaged external execution share the same revision and closure
  boundary instead of trusting the author's current `node_modules` tree.
- Exact final artifacts remain content-addressed, but this decision does not
  claim reproducible closures, archives, SEA bytes, signatures, or builds.

## Initial limitations and follow-up

- Only an application-local npm lock v3 is selected. Monorepo/workspace lock
  discovery and subproject selection need an explicit future rule.
- Private-registry authentication is not implemented.
- Linux closure targets are glibc-only; musl is not currently supported.
- Native packages must publish usable locked target bytes without requiring a
  lifecycle build. Cross-target compilation and a general native build system
  are out of scope.
- Archive ordering and the rest of the build toolchain have not been made a
  reproducible-build contract.
- A future function-asset schema should seal the canonical activity entrypoint
  and revision/source identity directly. The current official builder is
  trusted to derive both the revision and coherent FunctionResource inputs from
  one private prepared snapshot.
- Automatic stale-core cleanup assumes the supported resident process remains
  in one host PID namespace. A claim from another live or unverifiable
  namespace is intentionally retained; namespace-churned container deployment
  needs a future host-level lease authority or operator cleanup. Darwin lacks
  the Linux boot and process-start evidence, so PID reuse can conservatively
  retain a dead root until that PID is no longer live.

The frozen core closure has run from moved Darwin and clean hosted-Linux SEAs
with Node absent from `PATH`. Those portability proofs do not make final SEA
bytes reproducible or add Windows extraction support.
