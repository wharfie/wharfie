<h1 align="center">
  <img src="./docs/src/assets/svgs/beanie.svg" alt="Wharfie Beanie Logo" width="200">
  <br>
  Wharfie
  <br>
  <br>
</h1>

<p align="center">
  <a href="https://discord.gg/QEbzFUsR"><img src="https://img.shields.io/discord/1131550721142161408" alt="discord"></a>
  <a href="https://github.com/wharfie/wharfie/actions/workflows/ci.yml"><img src="https://github.com/wharfie/wharfie/actions/workflows/ci.yml/badge.svg" alt="Wharfie CI"></a>
</p>

Wharfie is a manifest-first framework for packaging developer-owned Node CLIs and named activities into single executable artifacts.

A Wharfie app is defined in `wharfie.app.js` and can declare:

- a developer CLI (`cli`)
- named activities (`activities`)
- explicit runtime resources (`resources`)
- optional workflows (`workflows`)
- optional cron triggers (`scheduler`)
- packaging targets (`targets`)

The shipped CLI is centered on local authoring, packaging, and persisted operation runs. The primary command surface is `wharfie init`, `wharfie app`, `wharfie ops`, `wharfie list`, and `wharfie build-self`. `wharfie config` remains available for legacy AWS deployment workflows only.

### ⚡️ Quickstart

#### Install

```bash
curl -fsSL https://raw.githubusercontent.com/wharfie/wharfie/master/install.sh | bash
```

For Windows:

```ps1
iex (Invoke-WebRequest -Uri "https://raw.githubusercontent.com/wharfie/wharfie/master/install.ps1" -UseBasicParsing).Content
```

#### Example

```bash
wharfie init my_app
wharfie app manifest ./my_app
wharfie app run hello --dir ./my_app --event '{"who":"cli-user"}'
wharfie app package ./my_app
```

The current ESM CLI ships these top-level commands: `init`, `app`, `ops`, `list`, `build-self`, and `config` (legacy AWS deployment setup).
The legacy `deployment`, `project`, and `utils` command groups have been removed from the repo.

### Legacy: Wharfie v1

Wharfie v1 was the original table-oriented AWS/Athena data application framework organized around `sources/` and `models/`. That workflow is still available as an explicit legacy scaffold:

```bash
wharfie init my_legacy_project --template legacy-v1
wharfie config
```

Use that path only for historical v1 work. The current Wharfie product is the manifest-first v2 app/runtime surface described above. For more background see [Legacy: Wharfie v1](./docs/src/assets/markdown/legacy-v1.md) and [Mapping Wharfie v1 onto v2](./docs/src/assets/markdown/v1-on-v2.md).

### Reference

[docs.wharfie.dev](https://docs.wharfie.dev)

### Operation DAG inspection/execution (v2)

The `wharfie ops` command group exposes local, provider-neutral tooling for inspecting and executing persisted operation DAGs.

```bash
wharfie ops list <resourceId>
wharfie ops cancel <resourceId> --operationId <operationId>
wharfie ops run <resourceId> <operationId>
```

DB selection is explicit via env vars (default: `vanilla`):

```bash
export WHARFIE_DB_ADAPTER=vanilla   # or lmdb|dynamodb
export WHARFIE_DB_PATH=/path/to/db
```

### Repository layout

- `src/cli/` contains the shipped CLI entrypoint and commands.
- `src/core/` contains runtime code, with `actors/`, `resources/`, and `runtime/` split out from the shared `lib/` subsystems.
- `apps/` contains buildable reference apps and dogfood manifests.
- `llm/` contains local design docs and prompt templates.
