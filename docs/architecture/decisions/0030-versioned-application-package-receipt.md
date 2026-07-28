# 0030 — Versioned application-package receipt

**Status:** Accepted · **Date:** 2026-07-27

## Context

`wharfie app package` already publishes immutable target-specific executable
bytes and an artifact-record sidecar after binding the record to those exact
bytes and the compiled logical application revision. Its command output,
however, was the complete internal `packageLocalApp()` return value. That value
contains the full application revision, complete artifact provenance records,
duplicated target state, and local paths. It had no document kind or schema
version.

The internal value is useful inside the process. Selected-SEA deployment code
uses its exact revision, record, and freshly verified artifact generation to
mint narrow process-local authority. It is not an appropriate public command
contract: changing an internal helper could silently change machine output,
and coding agents had no small stable document from which to select the
artifact they had just built.

This decision covers the local handoff after successful application packaging.
It does not define npm publication, remote release distribution, signing
policy, or independent artifact verification.

## Decision

### Keep the internal result; project a public receipt

`packageLocalApp()` continues to return its rich internal result. The source
package command alone projects that successful result into this schema-version
1 JSON document:

```json
{
  "schemaVersion": 1,
  "kind": "wharfie.application.package",
  "appId": "example-app",
  "revisionId": "wrv1_...",
  "outputDir": "/absolute/local/output",
  "artifactCount": 1,
  "artifacts": [
    {
      "artifactId": "waf1_...",
      "target": {
        "nodeVersion": "24.13.1",
        "platform": "linux",
        "architecture": "x64",
        "libc": "glibc"
      },
      "fileName": "example-app-sha256-...",
      "path": "/absolute/local/output/example-app-sha256-...",
      "recordPath": "/absolute/local/output/example-app-sha256-....artifact.json",
      "byteDigest": {
        "algorithm": "sha256",
        "value": "..."
      },
      "size": 123
    }
  ]
}
```

The public receipt deliberately omits the complete application revision,
artifact record, provenance, embedded inputs, build graph, and publication
internals. It repeats only the byte identity and target fields needed to
identify and invoke a freshly published local artifact.

### The projection is strict and deterministic

Before projection, the constructor requires the exact current
`packageLocalApp()` result shape:

- the top level contains exactly `app`, `revision`, `targets`, `outputDir`, and
  `artifacts`;
- `app` contains exactly its canonical logical ID;
- every artifact summary contains exactly its current nine internal fields;
- the application revision is canonical and owns the same application;
- every summary names that one revision and is consistent with its complete
  canonical artifact record;
- the target list and artifact target set are equal, finite, and unique;
- artifact IDs and file names are unique;
- the output directory is one normalized absolute local path;
- each artifact path is the exact direct child derived from the shared
  content-addressed filename function; and
- each record path is exactly the artifact path plus `.artifact.json`.

Artifacts in the public document are sorted by canonical target identity,
independent of manifest or build completion order. The constructor creates an
independent recursively frozen JSON value. Internal fields added later fail the
exact boundary until the projection is reviewed deliberately; they are never
silently leaked.

The filename derivation is one shared implementation used by both publication
and receipt projection. The receipt cannot describe a path that publication
would name differently.

### The receipt is a handoff, not artifact authority

The constructor runs only after `packageLocalApp()` has published the
executable bytes and validated the canonical artifact record against those
exact bytes and the owning logical revision. Rechecking the internal summary
against its record protects the projection from accidental linkage drift, but
it does not reread or rehash the published bytes.

Packaging also does not inspect embedded revision/runtime metadata in the
finished executable. Its build inputs request those assets, but the fake-build
test seam intentionally permits arbitrary final bytes. Packaged and
selected-artifact consumer boundaries separately verify embedded metadata when
they need that authority. The receipt therefore does not independently
authenticate an artifact.

At those consumer boundaries, the verified association among executable
bytes, canonical sidecar, owning revision, and embedded metadata supplies the
relevant artifact evidence. The receipt's `path`, `recordPath`, and `outputDir`
are local discovery conveniences for the process and filesystem that performed
packaging. They are not portable references, durable deployment authority, or
safe substitutes for byte verification.

### JSON remains the only package-command output

`wharfie app package` continues to emit JSON by default. `--json` remains an
explicit spelling of that behavior, while `--no-pretty` emits the same one
document compactly. A successful invocation writes exactly one receipt.
Packaging or projection failure writes no partial receipt.

While packaging runs, Wharfie reserves its process stdout for that final
document. Ordinary in-process writes through `process.stdout` and
Wharfie-owned build-subprocess output are routed to stderr as diagnostics.
Application source and build extensions are trusted code, not sandboxed code:
code that deliberately bypasses the streams or starts its own
stdout-inheriting subprocess, or leaves stdout-producing work unawaited after
packaging settles, violates the package-command contract.

The receipt intentionally does not say whether each immutable destination was
newly created or already contained the exact same bytes and sidecar. Repeated
successful publication projects the same semantic receipt.

## Consequences

- Humans, scripts, and coding agents receive one small stable document from
  local source packaging instead of an internal object graph.
- Deployment internals keep their existing fresh-generation authority; no
  path or serialized receipt gains it.
- Adding a target, artifact, revision, or internal result field cannot silently
  change public package output.
- Absolute paths make immediate local handoff approachable but prevent the
  receipt from pretending to be portable.
- Hermetic constructor, command-adapter, and fake-build tests cover the
  boundary without constructing or running a native SEA.

## Non-goals

- npm publication or a public Wharfie release workflow;
- remote artifact upload, discovery, download, or retention;
- independently rehashing the output files during receipt projection;
- claiming reproducible SEA bytes or cross-host target executability;
- exposing complete artifact provenance in command output;
- adding a human table mode, publication event journal, or `created`/`reused`
  outcome; and
- changing selected-SEA deployment authority or packaged operator commands.

## Rejected alternatives

### Keep serializing the internal result

Rejected because it couples machine output to private implementation shape and
discloses large duplicated records that are not needed for local handoff.

### Replace the internal result with the receipt

Rejected because source deployment needs the freshly verified revision,
artifact record, and process-local generation. A public path-based document
must not weaken or replace that authority.

### Treat the receipt or sidecar path as artifact authority

Rejected because paths and JSON can be copied or reconstructed. Artifact
verification requires the exact executable bytes, canonical record, and owning
revision association.

### Report whether publication created or reused each destination

Rejected because the current publication contract proves final immutable
availability, not a durable response-replay journal. A lost response followed
by exact reuse must not invent a stable creation outcome.
