# Hello world with Wharfie

This starter teaches Wharfie in two steps: the smallest understandable
application, then one interruption-and-resumption moment that shows why Wharfie
exists.

## See the product moment

Use Node 24.13.1 or newer within Node 24; the starter does not require one
exact npm patch. Then install the pinned preview dependency:

```bash
npm install
npm run demo -- Ada
```

The demo first runs and compiles the canonical two-field application manifest.
It then packages the separate resumable showcase as one executable, moves only
that executable away from its source, and runs it with Node absent from
`PATH`. Ordinary application argv does not extract the durable runtime.
The repository acceptance gate additionally hides its disposable copied
builder and installed dependencies before any relocated command runs.

Next, the demo commits greeting preparation, waits on a Wharfie timer, kills
the foreground process with `SIGKILL`, and repeats the exact same command:

```text
./hello wharfie run --name first-run -- Ada
```

It passes only when the original preparation attempt and timer survive,
preparation is not repeated, the workflow completes, and a later process
verifies the retained terminal output:

```text
Hello, Ada!
```

All executable copies, durable state, and deliberately interrupted runtime
files live under one disposable temporary directory. Successful runs remove
it; a cleanup failure reports the retained path.

## Read the smallest application

`app/hello.js` is ordinary JavaScript:

```js
export function hello(name = 'world') {
  return `Hello, ${name}!`;
}

export function main(argv = process.argv) {
  process.stdout.write(`${hello(argv[2])}\n`);
}
```

`app/wharfie.app.js` is the complete beginner-facing Wharfie declaration:

```js
import { defineApp } from '@wharfie/wharfie/app';

export default defineApp({
  id: 'hello-world',
  main: './hello.js',
});
```

Run the ordinary CLI, tests, manifest, and package command separately when you
want to inspect each piece:

```bash
npm run hello -- Ada
npm test
npm run manifest
npm run package
```

The package command infers the exact compatible host and shows its phases,
target, size, executable path, and next command. Scripts that need the stable
machine receipt can add `--json`.

## What belongs where

- `app/` is the canonical example. Its manifest has only `id` and `main`.
- `test/` tests that application without becoming packaged source.
- `showcase/resumable-hello/` is the polished durable example.
- `scripts/demo.js` is acceptance machinery, not application architecture.
- `playground/` is explicitly noncanonical space for unfinished ideas.

Nothing in the playground or repository checkout is required by the packaged
artifact. The dependency is the exact published Wharfie preview, never a source
import from a sibling checkout.
