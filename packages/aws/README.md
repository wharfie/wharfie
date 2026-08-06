# `@wharfie/aws`

This is Wharfie's version-matched AWS deployment companion. In the current
unpublished preview, install both locally packed artifacts into the same clean
builder:

```bash
npm install \
  /absolute/path/to/wharfie-wharfie-0.0.15.tgz \
  /absolute/path/to/wharfie-aws-0.0.15.tgz
```

Wharfie validates the package identity and its exact SDK binding contract
before use. Generated applications embed this companion only when it is
present and compatible; provider-free applications do not include its AWS SDK
graph. The generated entry, bundle, SEA blob, and executable evidence bind the
graph actually bundled for that artifact. This package is not a generic
provider or plugin API.
