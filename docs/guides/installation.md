# Installation

Wharfie is experimental and is not ready for production use. There is no
stable release-ready binary installer. Tagged previews are deliberately kept
off npm's `latest` channel. After the first preview completes reviewed
promotion, install the Node-hosted CLI explicitly from that channel:

```bash
npm install --save-dev @wharfie/wharfie@preview
npx wharfie --help
```

The `preview` tag moves only after the matching registry bytes and provenance
have passed the release proof and a maintainer has approved promotion.

The exact preview package and provider-free Linux x64 glibc standalone builder
binary release contract is documented in
[Preview releases](./preview-release.md). A source checkout remains the
authoritative fallback:

```bash
git clone https://github.com/wharfie/wharfie.git
cd wharfie
npm ci
node ./bin/wharfie --help
```

Consumers must use the Node range declared in `package.json#engines`.
Contributors use the exact Node version in `.nvmrc` and the npm version declared
in `package.json#packageManager`.

Wharfie's builder currently runs through Node from a source checkout or a
locally packed npm tarball. The abandoned v1 source, documentation site, and
self-hosting app prototype have been retired. Preview publication is guarded
and never targets `latest`; the sealed provider-free standalone Wharfie binary
is currently Linux x64 glibc only. Generated application SEAs remain the
portable application deliverable and do not require Node on the target machine.

The shortest packaged candidate is the
[magnetic hello-world starter](../../examples/hello-world/README.md). Its
repository gate copies only that starter, installs Wharfie's freshly packed npm
tarball, hides the disposable builder, and proves relocated Node-absent
execution plus named durable resumption. This remains release-candidate evidence
until the same gate passes against a published preview.

The deeper tarball-based workflow for the completed service preview is the
[single-host developer preview](./developer-preview.md). The tarball also
includes the supported `examples/steady-file` starter and can be installed into
a clean builder workspace without using the checkout as application runtime
authority. Its accepted split builder/clean-target run is recorded in the
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
or Smithy packages. Local `app` and `ops` commands, AWS-provider-free application
builds, and deployment help need only the core package. AWS deployment
operations use the one version-matched `@wharfie/aws` companion. A source
checkout receives it through `npm ci`; a clean tarball consumer installs the
matching companion tarball next to core. Tagged previews quarantine core on
npm before registry proof and reviewed promotion to the `preview` channel.
They attach the checksummed companion tarball to the matching GitHub
prerelease; the preview workflow does not publish the companion to npm.

If the companion is absent, malformed, or version-incompatible, a deployment
operation stops before Wharfie creates or mutates local state or contacts AWS,
and prints one matching-version install instruction. The companion exposes an
exact, validated set of AWS constructors and functions; it is not a generic
provider or plugin API.

Application packaging follows the same explicit boundary:

- Ordinary `wharfie app package` output is always AWS-provider-free, even when the
  companion is installed in the builder.
- The private Linux payload created by `--self-deployable` is also always
  AWS-provider-free, so its digest does not depend on the outer operator's cloud
  capability.
- Only the outer `--self-deployable` operator may embed AWS. With the exact
  companion installed beside core, the builder validates and embeds it. With
  core only, the outer executable remains fully usable for Hetzner and is
  sealed AWS-free: placing a companion beside it later cannot add AWS support.
  Neither form resolves `node_modules` at runtime.

Build provenance observes the prepared entry after this decision, followed by
the bundled JavaScript, SEA blob, and final executable bytes. Therefore provider
embedding changes the outer operator's recorded entry-code evidence and
downstream artifact digests. It does not change the logical application
revision or the nested Linux payload digest. `npm run verify:provider-boundary`
exercises both clean installs, keeps the canonical core install within its
dependency and 85 MiB limits, and runs a provider-enabled SEA after hiding its
source install and clearing `PATH`.

The source CLI mounts the experimental `deployment` group. These commands use
the operator's ordinary AWS credential chain. They do not accept or persist
credentials in the app manifest, DeploymentProfileV2, plan, or artifact.

Deployment profiles are canonical `wpr2` operator-input JSON documents supplied
with `--profile`; they remain separate from `wharfie.app.js`. Authors create
them with the supported `@wharfie/wharfie/deployment-profile` Node subpath.
Source plan and direct apply package and durably pre-stage a selected SEA;
source prepared-plan apply and reconcile consume exact durable staged evidence.
`wharfie app package --self-deployable` creates an application SEA whose
packaged deployment surface has AWS and Hetzner `preview`, `apply`, `status`,
`update`, `recover`, `exec`, and `destroy`:

```text
<app> wharfie deployment status --deployment-instance <id> [--data-root <absolute>] [--json]
<next-app> wharfie deployment update --deployment-instance <id> [--data-root <absolute>] [--json]
<app> wharfie deployment recover --deployment-instance <id> [--data-root <absolute>] [--json]
<app> wharfie deployment exec --deployment-instance <id> [--data-root <absolute>] [-- <application argv...>]
<app> wharfie deployment destroy --deployment-instance <id> [--data-root <absolute>] [--json]
```

AWS preview/apply requires a region and uses the ordinary credential chain;
Hetzner preview/apply requires a location and reads ambient `HCLOUD_TOKEN`.
Credentials are never CLI arguments. Use a dedicated Hetzner project for this
preview because its token is project-wide. Preview performs only provider
identity/describe/list queries and a side-effect-free local journal read; it
creates neither local state nor cloud resources. Status derives provider scope
from the exact journal and joins that local evidence with an exact provider
observation and the pinned guest's packaged `service status`. It creates or
mutates neither local nor remote state and is app-bound rather than bound to
the current outer SEA revision. Update activates the invoking SEA's exact
embedded Linux release while retaining committed current authority until
settlement. Recover resumes only the exact apply, update/repair, or destroy
frontier selected by the journal; during a failed update, the committed-current
SEA may reconverge current and abandon the target before a later update.
Destroy reads only embedded app identity plus exact durable local deployment
authority. Its journal supplies the bound provider and location, so destroy
accepts no provider, region, or location selector.

The companion gate follows durable provider authority rather than the whole
deployment command. AWS preview/apply requires it before embedded payload
reads. AWS status and destroy require it only after the local journal identifies
AWS and before provider observation or mutation. Recover requires it for AWS
apply phases and AWS destruction, but not for active release repair/restore or
an already destroyed journal. Update and exec are provider-neutral. Help and
every Hetzner path remain available without the companion.

The AWS path requires suitable default-VPC public-network prerequisites;
Hetzner uses its public network and Wharfie creates no private network. Destroy
removes the bounded resources Wharfie created, including the node and its
root-disk data. Packaged `deployment inspect` and `deployment reconcile` are
not exposed yet.
The AWS path has completed a live packaged apply/activate/adopt/restart/destroy
slice and independently verified cleanup. The Hetzner path has current-contract
automated lifecycle coverage and completed the equivalent live slice in
`fsn1`. Wharfie provisions only its fixed capability substrate and is not a
general infrastructure-as-code system.

See the [Quickstart](./quickstart.md) for the working local and experimental
deployment command surfaces.
