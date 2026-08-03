# V93 relocated SEA schedule/restart proof checkpoint

- **Date:** 2026-07-27
- **Status:** **IMPLEMENTED, COMMITTED, AND HERMETICALLY VERIFIED; THE NATIVE
  LINUX PROOF HAS NOT BEEN RUN**
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint commit:**
  `552bb9812577dfea88df098e0fd7fb584132cf69`
- **V93 implementation commit:**
  `1cae060b9b935aa36cfff5525883043553e68bbd`
- **Parent checkpoint:** [V92 resident workflow schedules](./2026-07-27-v92-resident-workflow-schedules.md)
- **Decision:** [ADR 0027](../../docs/architecture/decisions/0027-relocated-sea-schedule-restart-proof.md)

## Restart summary

Wharfie's target remains a normal TypeScript/Node CLI that can become one
approachable portable executable, run locally, remain resident as a durable
service, and coordinate work across trusted machines without requiring Node,
containers, Kubernetes, or a hosted orchestration service on those machines.

V92 left one explicit schedule boundary: no relocated Linux SEA had observed a
due occurrence, completed its ordinary workflow, survived resident death, and
proved the same cursor/run plus one physical dispatch after replacement with
Node absent from `PATH`.

V93 implements that proof without silently running native SEA, LMDB, Docker,
block-device, or cloud work on the development Mac. A dependency-injected
orchestrator has 17 passing hermetic tests. The real adapter is gated to Linux
inside `scripts/verify-package-sea.js` and will run as part of
`npm run verify:package:sea` there.

Breaking changes remain acceptable. Continue with Git CLI, exact Node 24.13.1
and npm 11.12.0, focused disposable tests, and immediate temp cleanup.

## What V93 closes

### One bounded proof contract

`scripts/package-sea-schedule-restart-proof.js` is independent of native
tooling. It validates exact app, revision, schedule, definition, workflow,
plan, occurrence, run, and work-root identity before invoking side-effect
ports.

It enforces:

1. first resident start and exact `READY`;
2. one exact due completed snapshot;
3. real `SIGKILL`;
4. replacement `READY` at generation +1 with a new session;
5. one post-restart observation with an unchanged complete snapshot;
6. exact graceful process exit;
7. cleanup of every acquired resident and the owned work root; and
8. positive absence verification before returning evidence.

Primary, cleanup, and residual-root failures remain visible through deliberate
aggregation. An unsafe work root is rejected before a port runs.

### A dedicated scheduled artifact

The ordinary verifier artifact retains an inert leap-day schedule. Its static
input is now valid and targets a dedicated one-activity scheduled workflow.

On Linux only, the verifier builds a second revision with a canonical
every-two-minutes expression, copies the artifact, removes the build
publication, and executes only the moved bytes in the existing Node-absent
environment. This avoids introducing legitimate recurring work into the long
main crash/recovery matrix.

The occurrence minute is selected after packaging. The verifier reserves at
least 45 seconds for initial startup, allows 20 seconds for `READY`, and fails
closed if completion, replacement, and the 2.5-second post-restart observation
cannot remain inside the exact cursor minute.

### Exact restart evidence

Installed-package host observers derive the same sealed schedule/workflow
identities as the moved SEA and open LMDB only read-only, closing each
observation.

The pre-kill and post-restart snapshots contain and compare:

- the exact schedule cursor and occurrence;
- the rebuilt completed workflow run;
- every physical execution-ledger row for that run;
- the single completed run-directory item;
- empty ready work;
- byte-exact durable marker data; and
- the physical user-code entry count.

The scheduled activity appends and fsyncs a proof-only entry record before user
work. Both snapshots require exactly one exact record. A duplicate physical
entry is therefore visible even when it loses the activity's exclusive
write-once result marker.

The replacement also must publish durable `STOPPED` for its exact generation
and session and release resident ownership.

This is a bounded one-occurrence proof, not a general claim that application
code or unmanaged external effects execute exactly once.

### Verifier disk ownership is complete

The former package verifier created several roots before its finalizer and let
the package child resolve Node-binary/XDG storage outside those roots.

V93 creates one outer root first and points `HOME`, `TMPDIR`, XDG
cache/config/data, and npm cache beneath it. Tarball, install, application,
native binaries, publications, relocated runtime state, and nested schedule
proof state are therefore contained.

The main duplicate build publication is removed before the second artifact is
built. The second publication is removed before execution. Nested roots are
removed immediately, and the outer cleanup tries every action and checks that
the root is absent even when earlier work failed.

## Verification completed

All checks used:

```text
/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node
Node 24.13.1
npm 11.12.0
```

Completed locally:

- all four TypeScript projects with `--noEmit`;
- scoped ESLint with zero warnings;
- scoped JavaScript and documentation Prettier plus `git diff --check`;
- syntax checks for both verifier scripts;
- 17 hermetic schedule/restart proof tests covering success, identity
  conflicts, changed logical and physical snapshots, duplicate dispatch,
  generation/session replacement, cleanup ordering, unsafe roots, and
  aggregate failure; and
- independent review of timing, LMDB observation, identity, cwd, physical
  dispatch evidence, and cleanup boundaries with no remaining blocker.

Every Jest invocation used an exact owned `/private/tmp/wharfie-v93-*` root,
disabled coverage and cache, ran in band, was measured, and was deleted
immediately. The final root was 0 bytes before removal. No root-owned V93 temp
directory remains.

Not run locally:

- native SEA construction;
- native LMDB execution;
- the actual relocated Linux due-occurrence/SIGKILL/restart proof;
- Docker;
- block-device operations; or
- live cloud/resource mutation.

## What remains deliberately open

- The production proof is implemented but still needs one actual Linux run:

  ```text
  npm run verify:package:sea
  ```

- No schedule `list`, `inspect`, `pause`, or `resume` command exists. Manual
  fire, tail, search, dynamic input, direct activity targets, timezones,
  catch-up-all, and singleton policies remain outside this slice.
- Provider-backed coordinator recovery remains later work.
- No exactly-once external-effect claim is made.

## Exact next work

1. Run the committed V93 verifier in an explicitly authorized disposable
   Linux environment and retain the exact successful output or failure.
2. If and only if that proof passes, implement the narrow source/packaged
   schedule `list`, `inspect`, `pause`, and `resume` surface. Keep manual fire,
   tail, and search out.
3. Continue the separate privileged-host path only at its existing explicit
   Docker, block-device, and live-resource approval boundaries.
4. Begin provider-backed coordinator recovery only after the single-node
   service/control-store fencing and external restart proofs are complete.

## Resume state

- Branch: `agent/strict-manifest`
- V93 implementation:
  `1cae060b9b935aa36cfff5525883043553e68bbd`
- Parent checkpoint: `552bb9812577dfea88df098e0fd7fb584132cf69`
- Historical stash to leave untouched:
  `stash@{0}: WIP on master: 3dee66b work prompt`
- Exact Node:
  `/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node`
- Continue by running the real Linux proof. Do not claim it from local static
  or hermetic evidence, and do not reopen V1/V2 compatibility, general cloud
  IaC, trustless mesh, or a second public execution engine.
