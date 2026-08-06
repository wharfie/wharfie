# Supported Wharfie examples

## Magnetic hello world

`hello-world/` is the canonical first-run starter included in the Wharfie npm
tarball. It keeps the smallest app, polished durable showcase, acceptance
harness, and noncanonical playground visibly separate.

From this repository, exercise the copied-starter boundary against a freshly
packed Wharfie tarball:

```bash
npm run verify:magnetic-first-run
```

From an installed preview package, copy the starter without retaining a Wharfie
source checkout. With Node 24.13.1 or newer within Node 24, install its exact
pinned Wharfie dependency with any compatible npm and run the same demo:

```bash
cp -R node_modules/@wharfie/wharfie/examples/hello-world ./hello-world
cd hello-world
npm install
npm run demo -- Ada
```

That published-package journey remains release acceptance work until the
preview exists.

## Single-host developer preview

`steady-file/` is the supported deeper single-host starter. It is a normal
JavaScript CLI plus a schema-version 4 manifest, two durable activities, and
one activity/timer/activity workflow. Its durable workflow waits one minute so
work meaningfully outlives an initiating shell.

```bash
cp -R node_modules/@wharfie/wharfie/examples/steady-file ./steady-file
./node_modules/.bin/wharfie app manifest ./steady-file
node ./steady-file/local.js /absolute/path/to/artifact.tar
```

The copied starter contains its own README with source, packaging, and
single-host service commands.
