# Development validation

Wharfie's merge authority starts from a clean checkout with the exact Node and
npm versions in `package.json`:

1. GitHub Actions runs `npm ci`, `npm run test:ci`, and the separate
   `npm run verify:package:sea` Linux portability proof. The SEA step uses
   `always()` so its result remains visible when another gate fails.
2. RWX independently clones the proposed commit, runs `npm ci`, and runs lint,
   the ordinary test suite, and all four TypeScript programs.
3. `test:ci` means lint, all four TypeScript programs, coverage thresholds,
   package-content verification, and a production-only dependency audit. It
   is not shorthand for the host-native or generated-SEA proofs.

`npm run test:full` is the local aggregate, but a developer machine that cannot
build and load the target-native dependencies is not authoritative for the
Linux SEA result.

## Deliberate boundaries

These are the complete repository-level validation exclusions and their exit
conditions. Inline ESLint suppressions inherit the scoped rationale below or
must state one adjacent to the directive; they leave with the parser or fixture
seam that requires them.

| Boundary | Exact scope and authority | Exit condition |
| --- | --- | --- |
| Generated lint/format roots | ESLint ignores `dist/`, `tmp/`, and `coverage/`; Prettier also ignores `build/` and `.llm_context_verify/`. They are generated output and may not contain tracked source. Prettier leaves the generated `package-lock.json` to npm. | Remove or narrow an ignore before tracked source is placed there. |
| Scratch lint root | ESLint ignores `scratch/`. Its examples are unsupported, excluded from the npm package, and have no product authority. | Delete a scratch example or promote it into `examples/` with lint, typecheck, and tests before treating it as supported. |
| Test lint rules | Files under `test/**` are still linted. Their override disables Jest assertion-count/conditional-test rules, dynamic-require rules, process-exit rules, and documentation requirements that conflict with fixtures and subprocess tests. | Remove each override when enabling that rule over all of `test/**` is clean and preserves the test's intended failure/readability boundary. |
| SEA verifier typing | The program rooted at the exact files in `tsconfig.sea-verifier.json` uses `noImplicitAny: false` and `strictNullChecks: false`. Those roots and their verifier-only imports are procedural host/proof harnesses, not shipped runtime modules; library declaration checking remains enabled. | Remove each override when that exact program passes with its inherited value. New runtime code must live in a strict source program rather than expanding this exception. |
| Extensionless CLI launcher | TypeScript cannot admit the extensionless npm bin file `bin/wharfie`. ESLint, CLI tests, and packed-install verification cover its import-and-error-forwarding wrapper. | Move any additional launcher logic into checked `src/` code. If the wrapper becomes more than delegation, rename it to JavaScript and update the package `bin` mapping so it enters typecheck and coverage. |
| Native external test | `test/cli/app/kitchen-sink-native-externals.test.js` is opt-in during the ordinary Jest run and is authoritative through `npm run test:native`. | Fold it into the ordinary suite when every supported hosted runner can rebuild, load, close, and reopen the target-native dependency without host-specific process failure. |
| Platform-conditioned tests | The conditional cases in `test/run-jest.test.js`, `test/cli/cmds/ops-resident-worker-command.test.js`, `test/cli/cmds/ops-workflow-sigkill.test.js`, `test/runtime/core-runtime-dependencies.test.js`, `test/runtime/deployment-aws-host-activation-persistence.test.js`, `test/runtime/local-service-session.test.js`, `test/runtime/managed-effect-crash-subprocess.test.js`, `test/runtime/managed-effect-settlement-crash.test.js`, `test/runtime/managed-effect-successor-crash-subprocess.test.js`, and `test/runtime/services/systemd-user-service-manager.test.js` run only on the POSIX or Linux hosts whose kernel behavior they assert. GitHub's Linux gate is authoritative for Linux cases. | Remove a condition when the behavior becomes platform-independent; add that platform to hosted CI before claiming its conditioned behavior. |
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

Fifteen TypeScript suppression directives remain in ten files:

- `test/helpers/db-adapters.js` and
  `test/db/contract/db-adapters-contract.test.js` contain test-double and
  table-driven assertion seams;
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
makes the immediately following operation pass without suppression. New
whole-file suppressions are not allowed; any new line suppression requires an
adjacent rationale and should be removed in the same change that types its
seam. `@ts-expect-error` negative API tests are assertions, not exclusions.

## TypeScript program coverage

The four checked programs have distinct jobs:

- `tsconfig.json` checks shipped source, supported examples, and ordinary
  repository scripts.
- `tsconfig.app-implementation.json` explicitly checks `src/app.js` and
  `src/deployment-profile.js`; their same-basename declaration files would
  otherwise shadow the JavaScript implementations.
- `tsconfig.test.json` checks the Jest and type-contract suites.
- `tsconfig.sea-verifier.json` checks the bounded native/host proof harnesses
  under the temporary strictness boundary above.

Apart from the extensionless `bin/wharfie` wrapper documented above, tracked
runtime, test, or verifier JavaScript outside `scratch/` must belong to one of
those programs. A same-name declaration is not evidence that its JavaScript
implementation was checked.
