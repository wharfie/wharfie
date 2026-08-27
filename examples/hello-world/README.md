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

Next, the demo commits greeting preparation, waits on a Wharfie timer, and kills
the foreground process with `SIGKILL`. That leaves its coordinator authority
ACTIVE, so a bare repeat is not allowed to replace it. The demo first retains
the exact packaged inspection, confirms takeover-and-release for the predecessor
it killed, and only then repeats the exact same named run command. All commands
reuse the same demo-owned `WHARFIE_DATA_ROOT`. For a manual reproduction, set
the two quoted paths to the relocated artifact and its existing data root, and
use a dedicated Bash shell so any setup or inspection failure terminates the
attempt before takeover:

```bash
artifact='./hello'
data_root='/absolute/path/to/the-existing-wharfie-data-root'
WHARFIE_DATA_ROOT="$data_root" "$artifact" wharfie run --name first-run -- Ada

# After SIGKILL:
inspection_dir="$(mktemp -d)" || exit 1
chmod 0700 "$inspection_dir" || exit 1
inspection_file="$inspection_dir/coordinator-inspection.json"
raw_nonce="$(od -An -N16 -tx1 /dev/urandom)" || exit 1
takeover_nonce="${raw_nonce//[[:space:]]/}"
unset raw_nonce
if [[ ! "$takeover_nonce" =~ ^[0-9a-f]{32}$ ]]; then
  printf '%s\n' 'Failed to generate a 32-character lowercase hexadecimal nonce.' >&2
  exit 1
fi
coordinator_id="manual-takeover-$takeover_nonce"
request_id="manual-takeover-request-$takeover_nonce"

(
  umask 077
  set -C
  WHARFIE_DATA_ROOT="$data_root" "$artifact" wharfie coordinator inspect \
    --json > "$inspection_file"
) || exit 1
```

Stop here. Confirm that inspection succeeded, leave the file and both generated
IDs unchanged, and independently verify that the inspected predecessor should
be fenced. Then run the takeover in the same shell:

```bash
WHARFIE_DATA_ROOT="$data_root" "$artifact" wharfie coordinator takeover \
  --inspection-file "$inspection_file" \
  --coordinator-id "$coordinator_id" \
  --request-id "$request_id" \
  --confirm-authority-replacement \
  --json
```

Only after takeover returns a successful receipt may the named run be repeated:

```bash
WHARFIE_DATA_ROOT="$data_root" "$artifact" wharfie run --name first-run -- Ada
```

The coordinator commands are the explicit operator safety step; they do not
replay the workflow. The demo passes only when the original preparation attempt
and timer survive that step, preparation is not repeated, the identical run
command completes the workflow, and a later process verifies the retained
terminal output. If the takeover response is lost or otherwise ambiguous,
retry with the exact unchanged inspection file, coordinator ID, and request ID;
do not inspect again or generate new identities. Only a definite conflict saying
that the inspected predecessor is no longer current permits a rebased attempt:
retain a new inspection, renew the operational confirmation, and generate fresh
coordinator and request IDs. Diagnose every other explicit refusal or error at
its cause; it does not authorize rebasing or a blind retry.

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
