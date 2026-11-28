# Quickstart: package a hello-world CLI

Use Node 24.13.1 on macOS or glibc Linux. You'll run an ordinary JavaScript
CLI, then build an executable for the same machine. Only the builder needs
Node. You don't need a cloud account.

## 1. Run the starter

Use the release checkout so the starter installs the matching published npm
package. In a fresh directory:

```sh
git clone --depth 1 --branch v0.0.17 https://github.com/wharfie/wharfie.git
cd wharfie/examples/hello-world
npm install
npm run hello -- Ada
```

You should see `Hello, Ada!`. The CLI lives in `app/hello.js`. Its
`app/wharfie.app.js` manifest tells Wharfie which module to package:

```js
import { defineApp } from '@wharfie/wharfie/app';

export default defineApp({
  id: 'hello-world',
  main: './hello.js',
});
```

## 2. Package and run it

```sh
npm run package
```

Because the manifest doesn't specify a target, Wharfie builds for your
platform and architecture. It prints the executable path under `dist/` and
a `Next:` command. Run that command with `Ada` as its argument. The packaged
CLI prints `Hello, Ada!` without invoking `node`.

## 3. Try durable work

From the same starter directory, run `npm run demo -- Ada`. This builds a
separate example that saves a greeting and waits on a timer. The demo kills
its own process, inspects and explicitly replaces its stopped coordinator,
then resumes the same named run. Look for the retained greeting: the first
step didn't have to run again.

- [Build, share, and run a preview](recipient-preview.md) to hand an executable to someone else or keep a service running after logout.
- [Application structure](application-structure.md) shows how to add a manifest to your own CLI.
- [CLI and runtime reference](cli-reference.md) lists source and packaged commands.
- **Testing a development checkout instead?** From the repository root with the [contributor toolchain](../../contributing/contributing.md), run `npm ci` and `npm run verify:magnetic-first-run`. That tests the locally packed code rather than the published preview.
