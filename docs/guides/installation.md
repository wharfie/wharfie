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
verification, and a production dependency audit. Native LMDB and generated-SEA
proofs are separate because they exercise host file-locking and platform
packaging behavior.

Local `app` and `ops` commands do not require cloud credentials or global
Wharfie configuration. The source CLI now also mounts an experimental
AWS-oriented `deployment` group using the operator's ordinary AWS credential
chain. It does not accept or persist credentials in the app manifest,
DeploymentProfileV2, plan, or artifact.

Deployment profiles are canonical `wpr2` operator-input JSON documents supplied
with `--profile`; they remain separate from `wharfie.app.js`. Authors create
them with the supported `@wharfie/wharfie/deployment-profile` Node subpath.
Source plan and direct apply package and durably pre-stage a selected SEA;
source prepared-plan apply and reconcile consume exact durable staged evidence.

`wharfie app package --self-deployable` creates an application SEA whose
packaged deployment surface has AWS and Hetzner `preview`, `apply`, `status`,
and `destroy`:

```text
<app> wharfie deployment status --deployment-instance <id> [--data-root <absolute>] [--json]
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
the current outer SEA revision. Destroy reads only embedded app identity plus
exact durable local deployment authority. Its journal supplies the bound
provider location, so destroy accepts no region or location selector.

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
