# The Wharfie Project Structure

The default Wharfie project structure is a runnable manifest-first v2 app. Executing `wharfie init` creates the following local scaffold:

- `package.json`
- `wharfie.app.js`
- `src/cli.js`
- `src/activities/hello.js`
- `README.md`

Pass `--no-examples` if you want the minimal scaffold without the sample workflow/scheduler blocks. Pass `--template legacy-v1` only when you are working on the historical Athena/table-oriented scaffold.

## `package.json`

The scaffold writes a minimal ESM package so `wharfie.app.js`, the developer CLI, and activities all run with the same module semantics.

## `wharfie.app.js`

This is the app manifest source. It is where you declare app metadata, the developer CLI entrypoint, named activities, explicit runtime resources, optional workflows, optional scheduler triggers, and packaging targets.

## `src/cli.js`

This is the developer-owned CLI that packaged artifacts run by default.

## `src/activities/`

Activities are named entrypoints that can be invoked directly with `wharfie app run`, referenced by workflows, or triggered by the scheduler.

## Legacy: Wharfie v1

`wharfie init --template legacy-v1` keeps the old scaffold available for historical projects. That template creates `wharfie.yaml`, `sources/`, and `models/`, plus the legacy examples unless you pass `--no-examples`.
