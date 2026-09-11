# Maintained application test fixtures

These applications are test inputs. Supported application starters live in
[`examples`](../../../examples).

- `authored-hello-world` exercises manifest-syntax authoring, a CLI, one activity,
  a finite workflow, a UTC schedule, and exact package targets.
- `native-kitchen-sink` exercises multiple package targets and an exact LMDB
  native dependency closure. Its lockfile and `config.js` dependency pin travel
  with the application when tests copy it into temporary storage.
- `workflow-crash`, `resident-authored-crash`, and `systemd-service` exercise
  workflow recovery, resident recovery, and service supervision.

All fixture JavaScript is included in the normal repository lint run and in
`npm run typecheck:test`. Tests that load or run an authored application must
use [`createIsolatedAuthoredAppFixture`](../../helpers/isolated-authored-app.js)
so generated revisions and dependency files stay in an owned temporary copy.
The helper verifies that tracked source stayed unchanged and cleans its copy.

Run the ordinary fixture and command tests with the pinned checkout tools:

```bash
npm run test:js -- --runInBand \
  test/helpers/isolated-authored-app.test.js \
  test/cli/app/app-commands.test.js \
  test/cli/cmds/ops-list-command.test.js
```

The native fixture uses a narrow test-only declaration in
[`test/types/lmdb-esm.d.ts`](../../types/lmdb-esm.d.ts) because LMDB 3.4.4 ships
a CommonJS export assignment in its ESM declaration. `tsconfig.test.json` maps
only the `lmdb` type import to this file; runtime resolution still uses the
exact native package. Remove that declaration and path mapping
when the dependency supports NodeNext checking directly.

The host-native dependency proof remains opt-in because it rebuilds and loads
LMDB for the host platform:

```bash
npm run test:native
```

Fixture moves must preserve app IDs, manifest behavior, and exact dependency
pins; update every test import and directory reference when relocating one.
