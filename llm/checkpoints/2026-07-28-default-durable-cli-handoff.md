# Default durable CLI handoff checkpoint

- **Date:** 2026-07-28
- **Status:** **IMPLEMENTED AND BOUNDEDLY VALIDATED**
- **Branch:** `agent/strict-manifest`
- **Feature commit:**
  `94a9f4be2560a5c0826e8f77ac4b8e90f14b18c3`

## Restart summary

The first demonstrated `steady-file` interface problem is closed. A normal
application argument can now become durable workflow input without asking the
operator to repeat a workflow ID or hand-author JSON:

```text
node ./bin/wharfie ops start --dir <app> -- <application-args>
<packaged-app> wharfie start -- <application-args>
```

Wharfie remains a framework for trusted-node applications that begin as
approachable TypeScript CLIs and can become persistent, portable services. The
initial topology remains one coordinator with explicit recovery work still to
come. This slice does not expand Wharfie into general cloud IaC, a trustless
mesh, or a hosted orchestration service.

## Contract now in force

Application manifest schema version 4 is the only accepted contract. Version 3
has no compatibility reader or alias.

`cli` may name one default durable workflow and one adapter exported by its
ordinary CLI module:

```js
cli: {
  entrypoint: {
    kind: 'node',
    path: './cli.js',
    export: 'main',
  },
  durable: {
    workflow: 'verify-stable',
    export: 'toDurableInput',
  },
}
```

The durable workflow must be declared by the same manifest. TypeScript
`defineApp` declarations enforce the same reference constraint.

With neither `--workflow` nor `--input`, `start` requires `cli.durable`, passes
a copied frozen argument list to its adapter, validates and bounds the returned
JSON, and admits the fixed workflow. Explicit `--workflow` and `--input`
continue to provide an expert bypass and cannot be mixed with application
arguments.

`--idempotency-key` is optional. Omission generates a fresh
`manual-<uuid>` key and returns it in the receipt. A caller that may retry after
a lost response must still supply and reuse a stable key.

Starting work remains separate from running or installing the resident worker.

## Important implementation properties

- Source adapters load lazily from the sealed prepared-source snapshot.
- Source admission rejects an app-local Wharfie runtime different from the
  runtime locked into the revision and re-verifies runtime integrity after an
  asynchronous adapter returns.
- Packaged operator commands receive the already-generated lazy developer CLI
  loader; help and unrelated commands do not import application code.
- Application stdout during load, projection, admission, and cleanup is
  redirected to stderr so JSON stdout remains one receipt.
- Input and caller metadata are bounded before durable admission.
- Adapter failures, missing exports, non-JSON values, runtime drift, and
  invalid option combinations fail before a run is admitted.
- A cleanup failure after successful admission still prints the committed run
  receipt, then reports the cleanup failure and exits nonzero.
- Falsy thrown values are retained as failures rather than mistaken for
  success.

ADR
`docs/architecture/decisions/0032-default-durable-cli-handoff.md` records the
decision and rejected alternatives.

## Golden application

`scratch/examples/apps/steady-file/cli.js` now exports
`toDurableInput(args)`. It and the ordinary `main(argv)` share the same file
argument parser. The application manifest maps that adapter to
`verify-stable`, and the source golden-path test exercises the ordinary
argument handoff through the real prepared-source CLI loader.

The test also proves that a conflicting app-local `@wharfie/wharfie` runtime is
rejected. Its fixture removes only the fixture-owned symlink before installing
the fake package, so it cannot follow the link into and mutate this repository.

## Validation completed

All validation used Node 24.13.1 and npm 11.12.0.

- All four TypeScript projects passed:
  `tsconfig.json`, `tsconfig.app-implementation.json`,
  `tsconfig.test.json`, and `tsconfig.sea-verifier.json`.
- Full ESLint and Prettier checks passed after the final changes.
- The final workflow-start, packaged actor CLI, and steady-file focused group
  passed: 3 suites and 62 tests.
- The local package and SEA-verifier contract group passed: 2 suites and 43
  tests.
- The final source app-command regression rerun passed: 1 suite and 5 tests.
- Earlier manifest, loader, compiler, command, actor, steady-file, and example
  groups passed before the last runtime-guard refinements: 8 suites and 150
  tests; the affected final paths were rerun afterward.
- Package contents verification passed under the exact Node path:
  284 files in `wharfie-wharfie-0.0.15.tgz`.
- `git diff --check` passed, and `package.json` plus `package-lock.json`
  remained byte-for-byte unchanged from the parent commit.
- An independent final static audit found no blocker-level issue.

A broader native-adjacent Jest batch was attempted once and aborted with status
134 before Jest produced a suite report because a child `SIGABRT` was forwarded
to the runner itself. It provided no actionable test failure and was not
repeated. The real SEA/native build was deliberately not rerun for this
interface slice.

## Cleanup and repository state

Generated package archives cleaned themselves up. A stale 20 MiB
`wharfie-jest-*` directory from the prior day was removed. The final audit found
no `wharfie-jest-*` or `wharfie-package-*` roots in the system temporary
directories and no repository `.wharfie` directory outside dependencies.

The repository occupied about 530 MiB, `.git` about 28 MiB, and the host had
about 14 GiB available at checkpoint time. The two stable per-user Wharfie
temporary directories were empty. The historical
`stash@{0}: WIP on master: 3dee66b work prompt` remains untouched.

## Honest boundary

Unit wiring, source golden-path behavior, and package-verifier contracts cover
the new handoff. A newly built, relocated SEA has not yet exercised the default
adapter admission end to end. The previous SEA proof used the explicit
workflow/JSON path and remains valid for its recorded commit.

## Next work

Do not grow another roadmap tranche or add more workflow language now.

1. Prove the existing install and persistent-service lifecycle on a clean
   supported Linux host with a systemd user manager: install/converge,
   deliberate replacement, host restart, history and output reads, update,
   rollback, uninstall, and complete cleanup.
2. Exercise the default adapter through the relocated SEA during that bounded
   proof rather than running a separate heavyweight build solely for this
   checkpoint.
3. Reduce returned-run-ID or repeated app-scope friction only if the walkthrough
   demonstrates that it blocks the obvious command sequence.
4. Keep coordinator replacement and user-credential-driven cloud resource
   fulfillment as later, separately bounded product slices.
