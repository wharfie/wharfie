# Legacy: Wharfie v1

Wharfie v1 was the original table-oriented AWS/Athena data application framework.

Its authoring model centered on:

- `wharfie.yaml`
- `sources/`
- `models/`

That v1 workflow focused on AWS-managed services and Athena-backed data processing. Historically it automated tasks like partition registration, format conversion, repartitioning, and schema evolution for those source/model projects.

## When to use this page

Use the legacy v1 path only when you are maintaining an existing v1 project or documenting historical behavior. It is not the default Wharfie product story anymore.

## Legacy scaffold

The legacy scaffold is still available explicitly:

```bash
wharfie init my_legacy_project --template legacy-v1
wharfie config
```

`wharfie config` is part of that old AWS deployment workflow. It is not required for the normal v2 `init` / `app` / `ops` / `package` loop.

## Current Wharfie identity

Current Wharfie is the manifest-first v2 surface:

- `wharfie.app.js`
- developer-owned `cli`
- named `activities`
- explicit `resources`
- optional `workflows`
- optional `scheduler`
- executable packaging targets

Use the rest of the documentation for that v2 authoring model. If you want to describe how a historical v1 workload maps onto the current substrate, see [Mapping Wharfie v1 onto v2](/v1-on-v2).
