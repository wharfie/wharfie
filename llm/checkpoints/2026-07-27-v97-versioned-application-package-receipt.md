# V97 versioned application-package receipt checkpoint

- **Date:** 2026-07-27
- **Status:** **IMPLEMENTED, COMMITTED, AND LOCALLY VERIFIED**
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint commit:**
  `7990ab136da17f7192ae033263d4b0cec1aba7b1`
- **V97 implementation commit:**
  `868c27f229c5d1fd1478a5b16ce51c82990b95b6`
- **Parent checkpoint:** [V96 bounded local release pruning](./2026-07-27-v96-bounded-local-release-pruning.md)

## Restart summary

Wharfie's target remains a normal TypeScript/Node CLI that can become one
approachable portable executable, run locally, remain resident as a durable
service, and coordinate work across trusted machines without requiring Node,
containers, Kubernetes, or a hosted orchestration service on those machines.

V97 closes the public local handoff from source packaging.
`wharfie app package` no longer serializes the complete private
`packageLocalApp()` result. Successful source packaging emits one strict schema
version 1 JSON document with kind `wharfie.application.package`. It identifies
the application and revision, the normalized local output directory, and one
canonical target-sorted list of published artifact identities, targets,
digests, byte sizes, executable paths, and adjacent record paths.

The rich internal result remains unchanged. Source deployment code can still
use its exact revision, canonical artifact record, and fresh process-local
generation authority. The public receipt and its paths are only immediate
local discovery data; neither is artifact or deployment authority.

Breaking changes remain acceptable. Continue with Git CLI, exact Node 24.13.1
and npm 11.12.0, focused disposable tests, and immediate measurement and
cleanup of test roots.

## What V97 closes

### One exact stable command document

The public receipt has these top-level fields:

```text
schemaVersion
kind
appId
revisionId
outputDir
artifactCount
artifacts
```

Each artifact exposes only:

```text
artifactId
target
fileName
path
recordPath
byteDigest
size
```

The complete application revision, artifact record, provenance, embedded input
descriptors, build graph, and publication internals remain private. `--json`
continues to spell the default JSON behavior explicitly; `--no-pretty` emits
the same document compactly.

### Strict deterministic projection

The receipt constructor first clones the package result through Wharfie's
strict JSON boundary and then requires:

- exact top-level, application, and artifact-summary keys;
- one canonical logical application and canonical owning revision;
- one shared revision across every artifact;
- a nonempty unique target set exactly equal to the artifact target set;
- canonical artifact-record linkage to each summary;
- valid byte identities, SHA-256 digests, and nonnegative safe byte lengths;
- unique artifact identities, targets, and file names;
- one normalized absolute output directory;
- the exact shared content-addressed file name used by publication;
- executable paths that are direct children of that output directory; and
- record paths equal to the executable path plus `.artifact.json`.

Artifacts are sorted by canonical target identity. The projected receipt is an
independent recursively frozen JSON document. New internal fields fail the
boundary until the public projection is reviewed deliberately.

Publication and receipt projection now import the same filename derivation.
The prior private duplicate in `local-app.js` was removed, including its
application-name normalization.

### Stdout is reserved for the receipt

While packaging and receipt projection run, ordinary in-process writes through
`process.stdout` are routed to stderr. Wharfie-owned build and signing
subprocess stdout is also routed to the parent stderr instead of inheriting
machine-readable stdout. The original stream is restored before the final
receipt is written.

Application source and build extensions remain trusted in-process code, not a
sandbox. Code that deliberately writes directly to file descriptor 1, starts
its own stdout-inheriting subprocess, or leaves stdout-producing work unawaited
after packaging settles violates the command contract. The stream replacement
also assumes the normal CLI model of one package command at a time.

### Receipt verification is not artifact verification

`packageLocalApp()` has already associated the final published bytes with a
canonical sidecar record and owning logical revision before projection. V97
rechecks the internal summary against that record to prevent accidental
linkage drift, but the projection does not reread or rehash the output file.

Packaging does not inspect embedded revision/runtime metadata in the completed
executable. Packaged and selected-artifact consumer boundaries perform that
verification when they need artifact authority. A serialized receipt, absolute
path, or sidecar path cannot replace the verified association among exact
bytes, canonical record, owning revision, and embedded metadata.

The receipt deliberately makes no `created` or `reused` claim. Repeating an
exact successful publication can return the same semantic handoff without
inventing a durable response-replay journal.

## Verification completed

All checks used:

```text
/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node
Node 24.13.1
npm 11.12.0
```

Completed locally:

- all four TypeScript projects with no emitted output;
- full-repository ESLint with zero warnings;
- full JavaScript/JSON Prettier plus every modified Markdown file through
  Prettier;
- JavaScript syntax checks and `git diff --check`;
- 97 focused tests across receipt projection, real package-command integration,
  documentation, command spawning, SEA-build mocks, and macOS signing mocks;
- a final rerun of the 70 receipt/package/docs/command tests after stdout
  containment was extended through receipt projection; and
- independent reviews of package-result trust, artifact-authority claims,
  roadmap fit, stdout containment, postject-wrapper composition, and final
  documentation.

The focused Jest runs used the exact
`/private/tmp/wharfie-v97-final-tests` parent, in band and with coverage
disabled. After each run the parent measured 0 bytes and was removed. No
checkout-local coverage, cache, build, package, or `.wharfie` output was
generated.

Adversarial coverage includes:

- extra internal keys at every projected boundary;
- mixed application and revision identities;
- summary/record target, digest, and size disagreement;
- malformed digest, byte length, and output directory;
- noncanonical file names and out-of-directory or mismatched sidecar paths;
- duplicate targets and artifact identities;
- exact target-set disagreement;
- target-order-independent output;
- recursive immutability and independence from later source mutation;
- identical semantic projection on repeated publication results;
- pretty and compact command serialization with one write; and
- authored top-level stdout output being removed from command stdout and
  retained on stderr during a real fake-build package flow.

Not run locally:

- the full Jest suite;
- native SEA construction or execution;
- native LMDB execution;
- the relocated Linux V93 due-occurrence/`SIGKILL`/restart proof;
- real systemd service packaging or convergence;
- Docker;
- block-device operations; or
- live cloud/resource mutation.

## Boundaries that remain

- This is a local source-package receipt, not npm publication or a remote
  artifact-release protocol.
- The eventual npm package and Wharfie SEA release are not yet one validated
  artifact flow.
- Absolute paths are intentionally immediate-host conveniences and are not
  portable references.
- The receipt does not grant fresh selected-SEA generation authority.
- Projection validation is internal consistency over a previously verified
  package result, not an independent byte-authentication pass.
- Trusted authored code can violate stdout discipline; Wharfie does not claim
  to sandbox it.
- No native cross-platform SEA proof was added.
- V93's committed relocated Linux schedule/restart verifier still has not been
  executed in its required environment.

## Exact next work

1. Run the committed V93 verifier in an explicitly authorized disposable Linux
   environment and retain its exact result.
2. Only after that proof passes, add the narrow source/packaged schedule
   `list`, `inspect`, `pause`, and `resume` surface.
3. Run V84 against one already-present immutable local Linux/amd64 image. If
   its read-only report is attemptable, run V83 only with explicit approval and
   retain only its checksummed `whlp2` receipt.
4. Keep native LMDB/SEA, Docker, block-device, and live-cloud work behind their
   existing explicit approval boundaries.
5. If those environments remain unavailable, choose the next ungated bounded
   local protocol, cleanup, or observability slice without weakening the proof
   gates. The eventual npm/SEA release unification remains open.

## Resume state

- Branch: `agent/strict-manifest`
- V97 implementation:
  `868c27f229c5d1fd1478a5b16ce51c82990b95b6`
- Parent checkpoint:
  `7990ab136da17f7192ae033263d4b0cec1aba7b1`
- Historical stash to leave untouched:
  `stash@{0}: WIP on master: 3dee66b work prompt`
- Exact Node:
  `/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node`
- Continue with the authorized V93 relocated Linux proof if that environment
  becomes available. Otherwise choose the next ungated bounded local slice.
