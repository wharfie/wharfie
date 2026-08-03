# V98 local-contract integrity checkpoint

- **Date:** 2026-07-27
- **Status:** **IMPLEMENTED, COMMITTED, AND LOCALLY VERIFIED**
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint commit:**
  `7cfc75d8f98f08d46ca16c0361b8924e48aa1b7d`
- **V98 receipt-consumer commit:**
  `8357ae7fc3f8e2578f8a7e10a382e9f92a3faa7b`
- **V98 Commander-ownership commit:**
  `77d5e48a9319ff408c9cf46979fe45b92b869fb4`
- **V98 test-cleanup commit:**
  `1186589980ce3aa0886520615d6b0fd66405aa3a`
- **Parent checkpoint:**
  [V97 versioned application-package receipt](./2026-07-27-v97-versioned-application-package-receipt.md)

## Restart summary

Wharfie's intended experience remains:

> Start with a normal TypeScript/Node CLI, turn it into one approachable
> portable executable, let it remain resident as a durable service, and
> coordinate work across trusted machines without requiring Node, containers,
> Kubernetes, or a hosted orchestration service on those machines.

V98 is a cleanup and integrity tranche, not a new deployment claim. It repairs
the V97 native-verifier consumer, removes mutable Commander singleton sharing,
and hardens disposable test cleanup after a real read-only snapshot exposed a
leak. Breaking internal API changes remain acceptable.

Continue with Git CLI, exact Node 24.13.1 and npm 11.12.0, focused disposable
tests, and immediate measurement and removal of every owned test/build root.

## What V98 closes

### The native verifier consumes the public receipt

V97 changed successful `wharfie app package` stdout from the rich internal
`packageLocalApp()` result to one strict schema-version 1
`wharfie.application.package` receipt. Two call sites in the committed native
SEA verifier still expected private fields such as the complete revision and
embedded artifact record. A later native run would therefore have failed.

V98 adds one public receipt validator and one complete-stdout parser. The
validator requires:

- exact receipt and artifact keys;
- schema version and document kind;
- canonical application and revision identities;
- a normalized absolute output directory;
- a positive exact artifact count;
- unique artifact, target, and filename identities;
- canonical target order;
- artifact ID/digest agreement;
- canonical content-addressed filenames; and
- executable and sidecar paths that are exact direct children of the output
  directory.

The parser passes the whole stdout string to `JSON.parse()`. Whitespace is
allowed, but a diagnostic prefix, trailing diagnostic, second JSON document,
or old rich result fails the boundary.

The native verifier now treats the receipt as discovery only. For each
relocated executable it independently reads and joins:

- the exact executable bytes;
- the complete canonical artifact sidecar;
- embedded revision/runtime metadata printed by the running artifact; and
- the embedded application manifest.

The join recomputes byte authority through the sidecar, validates the embedded
revision/runtime pair, compares target-independent manifest behavior with the
logical revision, requires one exact runtime target, and rejects every
application, revision, artifact, digest, size, target, metadata-observation, or
manifest disagreement. Neither receipt paths nor receipt identities become
artifact or deployment authority.

Both native package-verifier call sites now use this boundary. The stale
private-field reads are absent. The native verifier itself was not executed in
V98; its consumer behavior is covered hermetically with synthetic bytes,
records, revisions, metadata, manifests, and static call-site regression
checks.

### Every Commander program owns its complete tree

Commander `Command` instances retain mutable parent, configuration, hook, and
parse state. Source `createProgram()` previously mounted module-level
application and operations singletons. Constructing a second program reparented
the first program's children, so parsing the first program could execute the
second program's hook and configuration. Packaged manifest and metadata leaves
had the same ownership problem.

V98 replaces those composition points with factories:

- source application, manifest, activity-run, and package commands;
- source operations, history, logs, durable run, workflow start/signal,
  submission, and worker commands; and
- packaged manifest and metadata commands.

Existing core and packaged command factories remain the other leaves. The
unused eager default singleton exports were removed instead of retained for
compatibility.

Recursive tests build two source programs and two packaged programs, compare
their complete command-name trees, require disjoint object identities and
exact parent pointers, and prove mutation isolation. A source parse also proves
that the first program retains its own pre-action path initializer,
`CONFIG_DIR`, and action after a second program exists.

### Owned test cleanup handles read-only snapshots

The disposable Jest wrapper previously used one plain recursive `rmSync()`.
Revision snapshots intentionally contain read-only directories and files; an
intermediate run showed that the wrapper could leave the owned root behind.

V98 now:

- retries bounded recursive removal;
- detects filesystem error codes across Jest VM realms without relying on
  `instanceof Error`;
- restores owner access only on real directories;
- never chmods files, so multiply linked external inodes are unchanged;
- does not traverse stable symlink entries;
- handles entries that vanish during cleanup; and
- preserves a child spawn error, thrown spawn failure, signal, or nonzero exit
  together with a cleanup failure through `AggregateError`.

When a child signal and cleanup both fail, diagnostic retention takes
precedence and the wrapper does not self-signal; a successful self-signal would
terminate the process before the aggregate could surface. With successful
cleanup, ordinary signal forwarding is unchanged.

Permission repair assumes the synchronous Jest child has exited and trusted
tests leave the owned tree quiescent. It is disk-hygiene containment, not a
sandbox against a concurrent malicious process swapping filesystem entries.
Uncatchable wrapper death can still leave a temporary root for later external
cleanup.

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
- full JavaScript/JSON Prettier plus the modified Markdown files through
  Prettier;
- `git diff --check` and stale-consumer/singleton scans;
- 312 focused tests across 12 suites covering public receipt projection,
  package-command integration, receipt/byte/sidecar/metadata/manifest joining,
  complete source and packaged Commander ownership, durable command parity,
  packaged runtime composition, and test-runner cleanup;
- a final 37-test runner rerun after signal/cleanup precedence was made
  explicit; and
- independent reviews of the receipt authority boundary, remaining private
  consumer assumptions, full command-tree ownership, hard-link and symlink
  behavior, cleanup failure precedence, and roadmap fit.

The final 12-suite matrix used
`/private/tmp/wharfie-v98-final-integration`, in band and with coverage
disabled. It measured 0 bytes after the runner exited and was removed. Every
other V98-specific parent was likewise measured and removed. No
checkout-local coverage, cache, build, package, or `.wharfie` output remains
from V98.

### Intermediate LMDB-marked test selection

One intermediate combined command accidentally included the existing
`test/cli/cmds/operations-command-errors.test.js` suite. Its final case
explicitly selects the LMDB application-state adapter. The runner failed while
removing a read-only revision snapshot, before a useful test result was
retained; native LMDB may therefore have executed despite the intended safe
selection.

That run used only the exact disposable
`/private/tmp/wharfie-v98-integration-tests` parent. Inspection found 16 KiB of
read-only snapshot data. Owner access was restored on that exact parent, it was
removed, and later inspection confirmed no V98 root remained. No result from
that run is used as native proof. Every subsequent final matrix excluded that
suite. The incident directly motivated the cleanup hardening above.

Not run or claimed locally:

- the full Jest suite;
- native SEA construction or execution;
- an intentional native LMDB proof;
- the committed V93 relocated Linux schedule/restart proof;
- real systemd service packaging, pruning, or convergence;
- Docker;
- block-device operations; or
- live cloud/resource reads or mutation.

## Boundaries that remain

- The V97 receipt remains an immediate local discovery handoff, not artifact
  authority, a remote release protocol, or an npm publication receipt.
- The synthetic verifier tests do not replace the explicitly gated native SEA
  execution.
- Commander factory exports are intentionally breaking internal changes; no
  compatibility singleton remains.
- The cleanup helper owns only the directory created by the runner and assumes
  a quiescent trusted tree after synchronous child exit.
- V93's Linux due-occurrence/`SIGKILL`/restart evidence remains uncollected.
- V84/V83 Docker proof tooling remains gated, and no AL2023/EBS lifecycle proof
  exists.
- Durable run history and raw attempt logs exist, but the actual persisted
  workflow outputs and terminal result/error do not yet have one bounded public
  retrieval document.

## Exact next work

1. Add a verified, explicitly confirmed sensitive durable run-output snapshot:
   source `wharfie ops output --app-id <app-id> --run-id <run-id>` and packaged
   `<app> wharfie output --run-id <run-id>`, both requiring
   `--confirm-sensitive-output`.
2. Emit one strict schema-version 1
   `wharfie.execution-ledger.run-output` document with verified partial
   workflow step values, nullable terminal result or structured error, and
   polling version/sequence state. It must claim no authority and expose no
   payload references, evidence, fences, actors, or storage paths. Keep
   redacted `inspect` unchanged.
3. When an explicitly authorized disposable Linux environment is available,
   run the committed V93 relocated schedule/restart proof. Only after it passes
   add schedule `list`, `inspect`, `pause`, and `resume`.
4. Keep native LMDB/SEA, Docker, real systemd, block-device, and cloud work
   behind their existing explicit approval and proof boundaries.

## Resume state

- Branch: `agent/strict-manifest`
- V98 receipt consumer:
  `8357ae7fc3f8e2578f8a7e10a382e9f92a3faa7b`
- V98 Commander ownership:
  `77d5e48a9319ff408c9cf46979fe45b92b869fb4`
- V98 read-only test cleanup:
  `1186589980ce3aa0886520615d6b0fd66405aa3a`
- Parent checkpoint:
  `7cfc75d8f98f08d46ca16c0361b8924e48aa1b7d`
- Historical stash to leave untouched:
  `stash@{0}: WIP on master: 3dee66b work prompt`
- Exact Node:
  `/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node`
- Next ungated slice: V99 verified sensitive durable run-output snapshots.
