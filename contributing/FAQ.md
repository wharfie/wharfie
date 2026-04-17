# FAQ

## What is Wharfie?

Wharfie is a manifest-first framework for packaging developer-owned Node CLIs and named activities into single executable artifacts.

## What does a Wharfie v2 app look like?

A v2 app is declared in `wharfie.app.js`. It typically contains:

- `cli`
- `activities`
- `resources`
- optional `workflows`
- optional `scheduler`
- optional `targets`

The shipped CLI is focused on `wharfie init`, `wharfie app`, `wharfie ops`, `wharfie list`, and `wharfie build-self`.

## Do I need AWS to use Wharfie?

No for the core v2 workflow. You can initialize an app, inspect its manifest, run activities locally, package executables, and persist operation runs without first configuring AWS.

## Do I need to run `wharfie config`?

Not for normal v2 work. `wharfie config` is only for the historical Wharfie v1 AWS deployment workflow.

## What was Wharfie v1?

Wharfie v1 was the original Athena/table-oriented product organized around `wharfie.yaml`, `sources/`, and `models/`. That legacy shape still exists behind `wharfie init --template legacy-v1`, but it is no longer the default Wharfie identity.

## Why is the default scaffold a CLI plus activities?

That is the progression Wharfie is optimizing for: start from a developer-owned CLI, expose named activities, add explicit resources, and then opt into workflows, scheduling, and packaging without changing the basic app shape first.

## Do I need to install an npm package to use this?

Today the Wharfie CLI is distributed as an npm package, and the repository also contains self-hosted executable packaging flows.
