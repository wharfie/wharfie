# Installation

Wharfie is experimental and is not ready for production use. There is no
release-ready binary installer during the project reset. Run the current code
from a source checkout:

```bash
git clone https://github.com/wharfie/wharfie.git
cd wharfie
npm ci
node ./bin/wharfie --help
```

Use the exact Node version declared in `package.json#engines` and the npm version
declared in `package.json#packageManager`.

Wharfie's builder currently runs through Node from a source checkout or a
locally packed npm tarball. The abandoned v1 source and dependencies have been
deleted, but registry publication remains deliberately blocked while the
cleaned v2-only boundary is reviewed. No standalone builder binary is published.
The existing self-hosting prototype still depends on build-host modules that
are not embedded. Generated application SEAs are the portable deliverable.

Local `app` and `ops` commands do not require cloud credentials or global
Wharfie configuration. Provider-backed deployment is roadmap work. When it is
introduced, applications will use the provider's normal credential chain to
preview and create only the resources required by Wharfie capabilities;
Wharfie will not become a general infrastructure-as-code system.

See the [Quickstart](./quickstart) for the working local command surface.
