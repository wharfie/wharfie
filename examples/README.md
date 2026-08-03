# Supported Wharfie example

`steady-file/` is the supported single-host developer-preview starter. It is a
normal JavaScript CLI plus a schema-version 4 Wharfie manifest, two durable
activities, and one activity/timer/activity workflow. The normal CLI waits 250
milliseconds; the durable workflow waits one minute so its work meaningfully
outlives an initiating shell.

The example is included in the Wharfie npm tarball. From a clean builder
workspace containing an installed Wharfie tarball, copy it without retaining a
repository checkout:

```bash
cp -R node_modules/@wharfie/wharfie/examples/steady-file ./steady-file
./node_modules/.bin/wharfie app manifest ./steady-file
```

Run the ordinary CLI:

```bash
node ./steady-file/local.js /absolute/path/to/artifact.tar
```

The copied starter contains its own README with source, packaging, and
single-host service commands.
