# V86 disposable test-harness checkpoint

- **Date:** 2026-07-27
- **Status:** **COMMITTED, PUSHED, AND LOCALLY VERIFIED; NO FULL-SUITE OR
  PRODUCTION CLAIM**
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint commit:**
  `bcfdce0364276fc15099f51681ebc47cd0b657ff`
- **V86 implementation commit:**
  `586cd78db8b48559f7bb94032e57996b93225cc7`
- **Remote implementation tip before this checkpoint:**
  `586cd78db8b48559f7bb94032e57996b93225cc7`
- **Parent checkpoint:** [V85 verified durable run history](./2026-07-27-v85-verified-run-history.md)

## Restart summary

Wharfie's golden path remains a normal TypeScript/Node CLI that becomes one
approachable portable executable, runs locally or remains resident as a
durable service, and coordinates work across trusted machines without
requiring Node, containers, Kubernetes, or a hosted orchestration service on
the target machines.

The product exists to carry useful software beyond the coding session that
created it. It should preserve executable behavior and legible durable truth
so a person or later coding session can follow, recover, and evolve that work.

The settled project boundaries remain:

- nodes are trusted;
- one authoritative coordinator is acceptable initially when its durable
  authority is fenced and recoverable after coordinator loss;
- V1 and backward compatibility are abandoned;
- Wharfie is not general cloud IaC;
- finite Wharfie abstractions may use normal operator credentials to create
  only the resources they require;
- TypeScript/Node is the public authoring path, while measured Node-API, WASM,
  or other native hot paths remain possible behind versioned boundaries;
- exactly-once claims are made only where durable evidence and the managed
  destination's atomic effect semantics support them; and
- one executable and a machine-readable CLI remain the primary operator
  surface; a web UI is optional and later.

The standing working mode is local repository and Git CLI work rather than
PR/issue churn. Breaking changes are acceptable. Focused commits and pushes
are authorized. Use exact Node 24.13.1. Tests must remain proportionate,
disposable, and cleaned immediately. Never run native LMDB, native SEA
creation on this Mac, or block-device tools locally. Docker, live AWS,
disposable hosts/EBS, formatting, and other external mutation require explicit
approval.

V85 exposed verified, bounded run discovery and made malformed portable
control snapshots fail closed. V86 closes the immediate repository-hygiene
problem that ordinary Jest validation could retain cache and coverage output
in the worktree or another implicit location.

## What V86 closes

Commit `586cd78db8b48559f7bb94032e57996b93225cc7` makes ordinary local
testing coverage-free and makes runner-owned Jest artifacts disposable by
default.

The package commands now have distinct intent:

```text
npm test               ordinary coverage-free test run
npm run test:js        ordinary coverage-free JavaScript test run
npm run test:coverage  explicit configured coverage run
npm run test:ci        lint, typecheck, coverage gate, package gate, audit
```

`test` and `test:js` no longer enable coverage implicitly.
`test:coverage` is the explicit coverage command. `test:ci` calls that coverage
command, so the existing configured coverage thresholds remain part of the CI
gate rather than silently disappearing.

### One owned disposable root

For every invocation, `test/run-jest.js` creates one uniquely named
`wharfie-jest-*` root under the operating system's temporary directory. Unless
the caller supplied overrides, the runner places:

```text
Jest cache     <owned-root>/cache
coverage       <owned-root>/coverage
```

The coverage directory is preselected even for an ordinary coverage-free run
so enabling coverage through forwarded arguments still cannot fall back to a
repository-local default.

The runner removes its complete owned root:

- after a zero child status;
- after a nonzero child status;
- before propagating a reported spawn error;
- when the injected or native synchronous spawn throws; and
- after a child signal and before re-sending that signal to the wrapper
  process.

Child status remains the command status after successful cleanup. A child
signal is re-sent only after the owned root has been removed.

Explicit caller-supplied cache or coverage directories remain caller-owned.
The runner forwards them unchanged, does not redirect them under its root, and
does not remove them. The runner still removes its own separately created root.

### CLI compatibility boundary

Option parsing recognizes the supported Jest spellings without interpreting
positional arguments after the end-of-options separator.

Directory overrides support:

```text
--cacheDirectory <path>
--cacheDirectory=<path>
--cache-directory <path>
--cache-directory=<path>
--coverageDirectory <path>
--coverageDirectory=<path>
--coverage-directory <path>
--coverage-directory=<path>
```

Worker selection recognizes `--runInBand`, `--run-in-band`, camel-case and
kebab-case `--maxWorkers` variants, and `-w` forms. The default
`--maxWorkers=4` is added only when the caller supplied no worker mode.

Runner-owned cache, coverage, and worker arguments are inserted before `--`.
Everything after that separator remains positional and unchanged, even when
it resembles an option.

The runner is now import-safe: importing its functions for focused tests does
not execute Jest. Direct invocation still forwards the real environment and
stdio through the exact current Node executable.

## Verification completed

All validation used:

```text
/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node
```

Completed checks:

- targeted Prettier verification;
- targeted ESLint with cache disabled;
- `tsc -p tsconfig.test.json --noEmit`;
- one actual `npm test` invocation through the package script;
- 27 focused disposable-runner tests covering cleanup outcomes, package-script
  intent, caller ownership, option aliases, worker aliases, and the `--`
  boundary;
- and nine documentation command-surface tests after synchronizing the
  checkpoint lineage.

The focused validation used coverage-free/cache-free execution. Its outer
temporary root reached about 3.8 MB and was removed immediately. No
`wharfie-jest-*` root, repository coverage directory, or repository Jest cache
remained afterward.

Review found no remaining implementation blocker.

No native LMDB access, native SEA creation, native build, Docker operation,
AWS call, block-device operation, or live external-resource action occurred.
This checkpoint does not claim the complete test suite, native/package proof,
production readiness, or external-host evidence.

## Honest boundaries

The runner gives normal synchronous completion a strong cleanup path, but it
cannot make process lifetime transactional:

- `SIGKILL`, machine loss, or death of the wrapper process can prevent its
  `finally` cleanup from running;
- cleanup failure is not ignored; an exception from root removal can mask the
  child's original exit status, spawn error, or signal;
- caller-supplied output directories are intentionally outside runner cleanup
  and can consume disk until the caller removes them;
- operating-system temporary storage still needs normal host-level stale-file
  cleanup after uncatchable termination;
- this change does not align the mixed Jest 29/30 package versions;
- it does not prove the full dependency/package/native matrix; and
- it changes developer validation hygiene, not runtime durability,
  coordinator recovery, mesh placement, or cloud lifecycle.

The historical stash remains unrelated and untouched.

## Next safe work

Align the Jest dependency majors as a separate, cautious change. Pin the
desired version, inspect configuration and ESM behavior, update lockfile and
types together, and prove the focused runner contract before broader
validation. Keep every install and test artifact bounded and remove temporary
bytes immediately.

After the test toolchain is coherent, return to the local product surface and
design durable log append and acknowledgement before adding a reader. Logs
need explicit retention, ordering, redaction, crash recovery, and disclosure
semantics; a terminal-only reader over ephemeral output would not carry a
user's work beyond the original session.

V84 remains a separate approval-only external experiment. Neither its Docker
admission scan nor the V83 bounded proof should run automatically. Live
AWS/EBS and block-device work require separate explicit authorization.

## Repository state and resume instructions

The V86 implementation commit is:

```text
586cd78db8b48559f7bb94032e57996b93225cc7
```

It was pushed to `origin/agent/strict-manifest`. Immediately before this
checkpoint was written, local HEAD and that remote branch both resolved to
that commit. The commit containing this file and the synchronized lineage
documents is the V86 restart marker.

The historical stash remains untouched:

```text
stash@{0}: WIP on master: 3dee66b work prompt
```

Resume from the V86 checkpoint commit on `agent/strict-manifest`. Verify that
local HEAD equals the remote branch before new work. Preserve exact Node
24.13.1, disposable coverage-free ordinary tests, explicit coverage runs,
immediate cleanup, local Git CLI focus, and the approval boundaries above.
