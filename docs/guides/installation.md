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

The clean-install validation path is `npm run test:ci`. It includes lint and
type checks, tests, package-tarball verification, and a production dependency
audit. Native LMDB and generated-SEA proofs are separate because they exercise
host file-locking and platform packaging behavior.

Local `app` and `ops` commands do not require cloud credentials or global
Wharfie configuration. Provider-backed deployment is roadmap work. When it is
introduced, applications will use the provider's normal credential chain to
preview and create only the resources required by Wharfie capabilities;
Wharfie will not become a general infrastructure-as-code system.

See the [Quickstart](./quickstart.md) for the working local command surface.
