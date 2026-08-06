# `@wharfie/aws`

This is Wharfie's version-matched AWS deployment companion. Wharfie's preview
workflow quarantines the core package on npm, requires registry proof and
reviewed promotion to the `preview` channel, and attaches this companion
tarball to the matching GitHub prerelease. After verifying the release
checksums, install both into the same clean builder:

```bash
npm install \
  @wharfie/wharfie@0.0.15 \
  /absolute/path/to/wharfie-aws-0.0.15.tgz
```

Wharfie validates the package identity and its exact SDK binding contract
before use. Only the outer operator produced by `app package
--self-deployable` may embed this companion when it is present and compatible.
Ordinary application SEAs and the nested Linux payload remain AWS-provider-free.
The generated entry, bundle, SEA blob, and executable evidence bind the graph
actually bundled for that artifact. This package is not a generic provider or
plugin API, and the preview workflow does not publish it to npm.
