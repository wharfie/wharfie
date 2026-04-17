# The Wharfie Project Structure

The default Wharfie project structure is a runnable v2 app. Executing `wharfie init` creates the following local scaffold:

- `package.json`
- `wharfie.app.js`
- `src/cli.js`
- `src/activities/hello.js`
- `README.md`

Pass `--no-examples` if you want the minimal scaffold without the sample workflow/scheduler blocks. Pass `--template legacy-v1` only when you need the historical Athena/table-oriented scaffold.

## `package.json`

The default scaffold writes a minimal `package.json` with `"type": "module"` so `wharfie.app.js`, the developer CLI, and activities all run as ESM.

## `wharfie.app.js`

This file is the app manifest source. It is where you declare:

- app metadata
- the developer CLI entrypoint
- named activities
- explicit runtime resources
- optional workflows
- optional scheduler triggers
- optional packaging targets

## `src/cli.js`

This is the developer-owned CLI surface that packaged Wharfie artifacts run by default. Wharfie does not require you to rewrite your app around an internal command tree first.

## `src/activities/`

Activities are named entrypoints that can be invoked directly with `wharfie app run`, scheduled, or referenced from persisted workflows and operation graphs.

## Optional workflows and scheduler examples

The default scaffold includes a small workflow and cron trigger example so the manifest shows how activities compose into longer-running execution paths. Use `--no-examples` if you want to start without them.

## Legacy: Wharfie v1

The old Wharfie v1 scaffold is still available behind `wharfie init --template legacy-v1`. That legacy template creates `wharfie.yaml`, `sources/`, and `models/` for historical Athena-oriented projects. It is no longer the default project identity.
