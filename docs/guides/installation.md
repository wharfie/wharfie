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
`deployment` group, and generated application SEAs mount the same group at
`<app> wharfie deployment ...`. These commands use the operator's ordinary AWS
credential chain. They do not accept or persist credentials in the app
manifest, DeploymentProfileV2, plan, or artifact.

Deployment profiles are canonical `wpr2` operator-input JSON documents supplied
with `--profile`; they remain separate from `wharfie.app.js`. Authors create
them with the supported `@wharfie/wharfie/deployment-profile` Node subpath.
Source plan and direct apply package and durably pre-stage a selected SEA;
source prepared-plan apply and reconcile consume exact durable staged evidence.
Packaged plan, direct apply, prepared-plan apply, and non-destroy reconcile
instead validate the SEA running the command. Source and packaged plan JSON are
not interchangeable. Active destroy recovery remains durable-only.
Packaged commands accept neither source `--dir` nor `--output-dir`. This command
surface has focused automated evidence but no clean-account lifecycle proof or
complete service-readiness claim. Wharfie provisions only its fixed capability
substrate and is not a general infrastructure-as-code system.

See the [Quickstart](./quickstart.md) for the working local and experimental
deployment command surfaces.
