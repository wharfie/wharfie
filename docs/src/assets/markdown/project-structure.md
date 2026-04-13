# The Wharfie Project Structure

The Wharfie project structure is a simplified, opinionated interface for building with Wharfie. Executing `wharfie init` creates the following local scaffold:

- A `wharfie.yaml`
- A `sources` directory
- A `models` directory
- Example models and sources unless you pass `--no-examples`

## `wharfie.yaml`

This file is intended for project-specific configuration. Currently, it does not contain any configuration options. Support for environment-specific configurations (for example `wharfie.dev.yaml` and `wharfie.prod.yaml`) exists, but the current shipped CLI keeps the scaffold intentionally minimal.

## Sources

A source describes existing data on S3, intended for data ingestion with Wharfie into optimized formats for further transformation with models. Each source is defined in a single `<source_name>.yaml` file.

## Models

A model is a materialized view, consisting of two files: a `<model_name>.sql` file and a `<model_name>.yaml` file. The `.sql` file supports templating, with `${db}` as the current template variable. Currently, models should only reference other Wharfie models or sources.

## What `wharfie init` Does Today

`wharfie init` is a local scaffolding command. It creates the project directory structure on disk and can seed it with example models/sources. It does not create AWS infrastructure by itself.

## How Is This Different From dbt?

The primary difference lies in execution. There is no scheduler or orchestrator in the shipped CLI surface. Wharfie focuses on describing sources, models, app manifests, and operation graphs with local tooling exposed through `wharfie app`, `wharfie ops`, and `wharfie list`.
