# Development validation

Wharfie's merge authority starts from a clean checkout with the exact Node pin
in `.nvmrc`/`package.json#devEngines` and npm pin in
`package.json#packageManager`:

1. GitHub Actions runs `npm ci`, `npm run test:ci`, the preview release dry run,
   and the separate `npm run verify:package:sea` Linux portability proof. The
   SEA step uses `always()` so its result remains visible when another gate
   fails.
2. RWX independently clones the proposed commit, runs `npm ci`, and runs lint,
   the ordinary test suite, and all four TypeScript programs.
3. `test:ci` means lint, all four TypeScript programs, coverage thresholds,
   package-content and provider-boundary verification, and a production-only
   dependency audit. It is not shorthand for the host-native or generated-SEA proofs.

`npm run test:full` is the local aggregate, but a developer machine that cannot
build and load the target-native dependencies is not authoritative for the
Linux SEA result.

## Failure reports

The Jest runner and real SEA verifier automatically retain a small JSON report
when their setup, execution, or cleanup fails. They print its path under the
checkout's ignored `.wharfie/validation-failures/` directory and still clean
their owned temporary workspaces. Success creates no report. A report contains
the runner, execution phase, safe command identifier, elapsed milliseconds,
and known child exit status or signal. Arguments, environment variables,
stdout/stderr, error messages, and stacks are not retained; the normal console
output remains the detailed diagnostic source.

Reports are at most 2 KiB, with at most ten retained per runner. Publication
prunes only recognized report files, leaves unrelated files and links alone,
and uses a per-runner guard to serialize retention. An overlapping publication
or unavailable report directory warns and skips reporting without replacing
the original failure or preventing temporary cleanup. A killed child is
reported before Jest forwards its signal. Killing the supervising runner
itself can prevent reporting; if it is killed during publication, the empty
`.jest-report.lock` or `.package-sea-report.lock` directory can remain. After
confirming no corresponding validation process is running, remove only that
empty guard to allow future reports. Do not use recursive cleanup for a guard.

## Disposable Linux service proof

`npm run verify:remote-recovery:systemd:lima -- --snapshot` runs the focused
[packaged remote recovery proof](remote-recovery.md#reproduce-the-recovery-proof).
It uses real SSH, systemd and packaged executables with a synthetic provider
journal, and verifies recovery after SIGKILL plus safe replay against the healthy
replacement. Native x64 GitHub CI runs the same proof; the Mac driver uses an
owned Lima VM with Rosetta for the x64 payload on Apple Silicon.

`npm run verify:service:systemd:lima` is a separate destructive gate for one
newly owned Ubuntu VM on macOS with Lima 2.1 or newer and the pinned Node
24.13.1 host runtime. It builds the installed npm package's SEAs, kills the
resident, force-cycles the VM, and requires explicit inspected coordinator
takeover-and-release before fresh destination adoption and READY. Automatic
restart must fail closed while the crashed coordinator remains ACTIVE.
Two additional packaged-resident kills bracket destination-authority
advancement from a retained ADOPTED predecessor. Before the destination
advance, control and destination still carry the last confirmed ADOPTED floor;
after the destination advance but before its control CAS, the destination has
the new barrier while control still carries that exact floor. The handoff never
replaces confirmed ADOPTED control evidence with PREPARING. These cases use the
exact selected service executable and normal service entrypoint with the
systemd unit stopped. They are process-boundary proofs, not systemd MainPID
kills or additional host reboots.

The boot observer gives all read-only operations one shared 120-second
monotonic deadline under its 150-second systemd start bound. Each command gets
only the remaining budget and runs in a fresh POSIX process group; timeout
hard-kills the group and reaps the direct child, with a bounded synchronous
wrapper as the final backstop. Wall-clock time is used only for receipt
timestamps.

Both guest verifiers use the fixed canonical
`/var/tmp/wharfie-systemd-proof` direct leaf and reject
`WHARFIE_SYSTEMD_PROOF_ROOT`, symlinked path components, unmarked existing
directories, wrong ownership, or wrong modes. Recursive reset is allowed only
after validating the current UID's exact 0700 root and exclusive 0600 JSON
ownership marker.

Default source mode refuses a dirty checkout, tracked local-credential paths,
and local Git export overrides. For an unfinished worktree, explicitly use:

```sh
npm run verify:service:systemd:lima -- --snapshot
```

Both clean-commit and snapshot capture materialize their exact regular-file
allowlist in a new private Git repository, require its tree paths, modes, and
hashes to match the manifest, and archive only that synthetic tree within a
fixed size bound. Snapshot mode also includes selected nonignored new files;
it never commits, stages, or resets the original checkout. Pathname exclusions
remove local credentials such as `.npmrc`, ignored untracked files, and
generated/tool state from both manifest and archive, but are not a general
secret-content scanner. Review the selected source before running a proof.
The retained `source.tar` and `source-provenance.json` identify exact copied
bytes, exclusions, original HEAD/index/status, and the separate capture
commit. The helper executing host cleanup is itself bound to those captured
bytes. A snapshot result is not evidence for the original HEAD alone.

The driver creates an isolated Lima namespace, uses no host-folder mounts or
forwarded SSH agent, preserves the real HOME, and downloads the pinned image
into an owned private cache. Its absolute Node, host-helper, curl, and Lima
executions use purpose-specific clean environments: host JavaScript cannot
inherit `NODE_OPTIONS` or `NODE_PATH`, and image download cannot inherit proxy
or TLS credential variables.

The driver reserves commit-labelled staging before downloading or creating a
VM; existing or concurrent results are never overwritten. Publication first
validates that canonical `SHA256SUMS` covers the exact sorted regular-file set,
then exclusively creates the visible destination, copies every data file with
no-replace semantics, and rehashes the copies. It exposes `SHA256SUMS` last and
revalidates the complete published seal. By default, success removes the VM
and private image/state directory. A failed VM deletion retains its files for
diagnosis; `WHARFIE_SYSTEMD_PROOF_KEEP_VM=1` also deliberately retains the VM
and private root. Inspect `cleanup.json` before claiming complete cleanup.
Failures after receipt reservation normally receive separate checksummed
failure directories, not successful proof receipts. Pre-reservation refusals
produce no receipt; failed finalization retains staging and reports its path
instead.

## Deliberate boundaries

These are the complete repository-level validation exclusions and their exit
conditions. Inline ESLint suppressions inherit the scoped rationale below or
must state one adjacent to the directive; they leave with the parser or fixture
seam that requires them.

| Boundary | Exact scope and authority | Exit condition |
| --- | --- | --- |
| Generated lint/format roots | ESLint ignores `dist/`, `tmp/`, and `coverage/`; Prettier also ignores `build/` and `.llm_context_verify/`. They are generated output and may not contain tracked source. Prettier leaves the generated `package-lock.json` to npm. | Remove or narrow an ignore before tracked source is placed there. |
| Scratch lint root | ESLint ignores `scratch/` for unsupported experiments. Maintained application fixtures have moved to `test/fixtures/apps/`, where they are linted and included in the test TypeScript program. Tests must not depend on scratch files. | Move a maintained test input into `test/fixtures/`, or a supported user example into `examples/`, before relying on it. |
| Test lint rules | Files under `test/**` are still linted. Their override disables Jest assertion-count/conditional-test rules, dynamic-require rules, process-exit rules, and documentation requirements that conflict with fixtures and subprocess tests. | Remove each override when enabling that rule over all of `test/**` is clean and preserves the test's intended failure/readability boundary. |
| SEA verifier typing | The program rooted at the exact files in `tsconfig.sea-verifier.json` uses `noImplicitAny: false` and `strictNullChecks: false`. Those roots and their verifier-only imports are procedural host/proof harnesses, not shipped runtime modules; library declaration checking remains enabled. | Remove each override when that exact program passes with its inherited value. New runtime code must live in a strict source program rather than expanding this exception. |
| Native fixture declaration | Only the test TypeScript program maps the `lmdb` module to `test/types/lmdb-esm.d.ts`. The declaration checks the fixture's `open`, `get`, `put`, and `close` usage with unknown read values and explicit missing-value guards. LMDB 3.4.4's upstream declaration uses a CommonJS export assignment in an ESM package, which fails NodeNext checking. Runtime imports and the fixture's exact dependency lock are unchanged; `skipLibCheck` stays false. | Remove the test-only mapping when the pinned dependency supplies a valid NodeNext declaration, then check the fixture against that declaration. |
| Extensionless CLI launcher | TypeScript cannot admit the extensionless npm bin file `bin/wharfie`. ESLint, CLI tests, and packed-install verification cover its import-and-error-forwarding wrapper. | Move any additional launcher logic into checked `src/` code. If the wrapper becomes more than delegation, rename it to JavaScript and update the package `bin` mapping so it enters typecheck and coverage. |
| Native external test | `test/cli/app/kitchen-sink-native-externals.test.js` is opt-in during the ordinary Jest run and is authoritative through `npm run test:native`. | Fold it into the ordinary suite when every supported hosted runner can rebuild, load, close, and reopen the target-native dependency without host-specific process failure. |
| Platform-conditioned tests | The conditional cases in `test/run-jest.test.js`, `test/cli/cmds/ops-resident-worker-command.test.js`, `test/cli/cmds/ops-workflow-sigkill.test.js`, `test/runtime/application-state-readiness-crash-subprocess.test.js`, `test/runtime/core-runtime-dependencies.test.js`, `test/runtime/deployment-aws-host-activation-persistence.test.js`, `test/runtime/local-service-session.test.js`, `test/runtime/managed-effect-crash-subprocess.test.js`, `test/runtime/managed-effect-settlement-crash.test.js`, `test/runtime/managed-effect-successor-crash-subprocess.test.js`, and `test/runtime/services/systemd-user-service-manager.test.js` run only on the POSIX or Linux hosts whose kernel behavior they assert. GitHub's Linux gate is authoritative for Linux cases. | Remove a condition when the behavior becomes platform-independent; add that platform to hosted CI before claiming its conditioned behavior. |
| Coverage boundary | Jest collects coverage from `src/**/*.js`. Declarations, tests, examples, the extensionless `bin/wharfie` wrapper, and repository-only verification scripts do not count toward runtime coverage thresholds; their behavior is covered by their direct gates. | Expand the pattern or move code under `src/` before any additional JavaScript becomes part of the shipped runtime. |
| Separate SEA proof | `verify:package:sea` is outside `test:ci` because it installs a packed tarball, constructs native executables, and runs long crash matrices. It is still an unconditional GitHub merge result. | It may be folded into `test:ci` only if the separate timeout, failure visibility, clean packed install, and real Linux execution remain intact. |

The repository-wide lint exceptions are `jsdoc/check-types`, `camelcase`, and
`no-template-curly-in-string`. The `test/**` override additionally names
`jest/max-expects`, `jest/no-conditional-in-test`,
`jest/no-conditional-expect`, `jest/no-standalone-expect`,
`import/namespace`, `import/no-dynamic-require`,
`jsdoc/no-undefined-types`, `jsdoc/require-jsdoc`,
`jsdoc/require-param`, `jsdoc/require-param-description`,
`jsdoc/require-returns`, `jsdoc/require-returns-description`,
`jsdoc/tag-lines`, and `n/no-process-exit`. Each exception exits independently
when running ESLint with that rule enabled over its exact scope is clean and
does not weaken an intentional fixture or subprocess boundary.

Fourteen line-level `@ts-ignore` directives remain in nine files:

- `test/db/contract/db-adapters-contract.test.js` contains a table-driven
  assertion seam;
- `src/core/lib/code-execution/worker.js` contains the text-loader import and
  worker-option seams;
- `src/core/lib/db/adapters/dynamodb.js`,
  `src/core/resources/base-resource.js`, and
  `src/core/resources/reconcilable.js` contain legacy collection/object typing
  seams; and
- `src/core/resources/builds/build-resource.js`,
  `src/core/resources/builds/build-resource-group.js`,
  `src/core/resources/builds/actor-system.js`, and
  `src/core/resources/builds/lib/macos-signing-credentials.js` contain injected
  build globals or symbol-indexed private channels.

Their exit condition is a narrow declaration, guard, or typed test double that
makes the immediately following operation pass without suppression.

Six existing test files still use whole-file `@ts-nocheck`. They run in Jest
and are linted, but TypeScript does not check their bodies. The topology
capability suite no longer needs that exception: its request/response doubles
are typed. These remaining exclusions are explicit test-harness debt:

| File | Unchecked seam | Exit condition |
| --- | --- | --- |
| `test/helpers/db-adapters.js` | Recursive document maps, key schemas, and the in-memory transaction-expression emulator. | Type recursive stored values and expression evaluation, including empty/missing items. |
| `test/runtime/reconstructed-resident-work-crossing.test.js` | Partial payload, supervisor, application-state, and resident-process doubles. | Give the scenario builders explicit state and narrow contracts for the ports each scenario exercises. |
| `test/runtime/services/resident-coordinator-authority.test.js` | Deferred promises, timing controls, and a mutable authority protocol harness. | Type the deferred values, event states, and protocol transitions. |
| `test/runtime/services/resident-execution-reconstruction.test.js` | Heterogeneous history builders and intentionally partial ledger/distribution doubles. | Type history variants and the exact reconstruction ports supplied by each double. |
| `test/scripts/publish-preview-release.test.js` | Malformed package fixtures and a mutable npm/GitHub command emulator. | Separate invalid external input from validated records and type the emulator's state/results. |
| `test/scripts/run-dynamodb-coordinator-authority-live-proof.test.js` | Provider/protocol state machines and injected SDK/filesystem doubles. | Type the modeled states and the explicit provider/filesystem ports. |

New whole-file suppressions are not allowed. Any new line suppression requires
an adjacent rationale and should be removed in the same change that types its
seam. `@ts-expect-error` negative API tests are assertions, not exclusions.
Update this inventory when an exception is added or removed; a passing
TypeScript program does not prove that a suppressed test body was checked.

## TypeScript program coverage

The four checked programs have distinct jobs:

- `tsconfig.json` checks shipped source, supported examples, and ordinary
  repository scripts.
- `tsconfig.app-implementation.json` explicitly checks `src/app.js`; its
  same-basename declaration file would otherwise shadow the implementation.
- `tsconfig.test.json` checks the Jest and type-contract suites.
- `tsconfig.sea-verifier.json` checks the bounded native/host proof harnesses
  under the temporary strictness boundary above.

Apart from the extensionless `bin/wharfie` wrapper documented above, tracked
runtime, test, or verifier JavaScript outside `scratch/` must belong to one of
those programs. A same-name declaration is not evidence that its JavaScript
implementation was checked.
