# Installation

Wharfie is experimental and is not ready for production use. There is no
release-ready binary installer. Run the current code from a source checkout:

```bash
git clone https://github.com/wharfie/wharfie.git
cd wharfie
npm ci
node ./bin/wharfie --help
```

Use the exact Node version declared in `package.json#engines` and the npm version
declared in `package.json#packageManager`.

Wharfie's builder currently runs through Node from a source checkout or a
locally packed npm tarball. The abandoned v1 source, documentation site, and
self-hosting app prototype have been retired; registry publication remains
deliberately disabled. No standalone builder binary is published. Generated
application SEAs are the portable deliverable and do not require Node on the
target machine.

The bounded tarball-based workflow for the completed developer preview is the
[single-host developer preview](./developer-preview.md). The tarball includes
the supported `examples/steady-file` starter and can be installed into a clean
builder workspace without using the checkout as application runtime authority.
Its accepted split builder/clean-target run is recorded in the
[checksummed checkpoint](../../llm/checkpoints/2026-07-29-single-host-developer-preview.md).

Ordinary `npm test` is coverage-free. The runner places its default Jest cache
and any default coverage output in one owned OS-temporary root and removes it
after success, failure, or a child signal. Use `npm run test:coverage` when
coverage is wanted explicitly. The clean-install path `npm run test:ci` invokes
that coverage run, along with lint and type checks, package-tarball
verification, the provider-boundary receipt, and a production dependency audit.
Native LMDB and generated-SEA proofs are separate because they exercise host
file-locking and platform packaging behavior.

## AWS deployment companion

The core `@wharfie/wharfie` production install deliberately contains no AWS SDK
or Smithy packages. Local `app` and `ops` commands, provider-free application
builds, and deployment help need only the core package. AWS deployment
operations use the one version-matched `@wharfie/aws` companion. A source
checkout receives it through `npm ci`; a clean tarball consumer installs the
matching companion tarball next to the core tarball. Neither package is
registry-published in this developer preview.

If the companion is absent, malformed, or version-incompatible, a deployment
operation stops before Wharfie creates local state or contacts AWS and prints
one matching-version install instruction. The companion exposes an exact,
validated set of AWS constructors and functions; it is not a generic provider
or plugin API.

Application packaging follows the same explicit boundary:

- A builder with core only creates a provider-free SEA whose bundle contains no
  AWS SDK or Smithy graph. That executable is sealed provider-free: placing a
  companion beside it later cannot enable deployment operations.
- A builder with the exact companion installed beside core validates and embeds
  that companion into the generated app SEA. The relocated executable does not
  resolve `node_modules` at runtime.

Build provenance observes the prepared entry after this decision, followed by
the bundled JavaScript, SEA blob, and final executable bytes. Therefore provider
embedding changes the recorded entry-code evidence and all downstream artifact
digests. `npm run verify:provider-boundary` exercises both clean installs, keeps
the canonical core install within its dependency and 85 MiB limits, and runs a
provider-enabled SEA after hiding its source install and clearing `PATH`.

The source CLI mounts the experimental `deployment` group. These commands use
the operator's ordinary AWS credential chain. They do not accept or persist
credentials in the app manifest, DeploymentProfileV2, plan, or artifact.

Deployment profiles are canonical `wpr2` operator-input JSON documents supplied
with `--profile`; they remain separate from `wharfie.app.js`. Authors create
them with the supported `@wharfie/wharfie/deployment-profile` Node subpath.
Source plan and direct apply package and durably pre-stage a selected SEA;
source prepared-plan apply and reconcile consume exact durable staged evidence.
Packaged plan, direct apply, prepared-plan apply, and non-destroy reconcile
instead validate the SEA running the command. Source and packaged plan JSON are
not interchangeable. Active destroy recovery remains durable-only. Packaged
commands accept neither source `--dir` nor `--output-dir`. This command surface
has focused automated evidence but no clean-account lifecycle proof or complete
service-readiness claim. Wharfie provisions only its fixed capability substrate
and is not a general infrastructure-as-code system.

See the [Quickstart](./quickstart.md) for the working local and experimental
deployment command surfaces.
