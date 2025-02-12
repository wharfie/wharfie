# The Wharfie Project Structure

The Wharfie project structure is a simplified, opinionated interface for builing with Wharfie. It combines the naming and file structure conventions of dbt with Terraform's CLI patterns. Executing `wharfie project init` creates the following:

- A `wharfie.yaml`
- A `sources` directory
- A `models` directory

## `wharfie.yaml`

This file is intended for project-specific configuration. Currently, it does not contain any configuration options. Support for environment-specific configurations (e.g., `wharfie.dev.yaml`, `wharfie.prod.yaml`) exists; however, the absence of configurable environment variables at this stage makes this feature not yet relevant.

## Sources

A source describes existing data on S3, intended for data ingestion with Wharfie into optimized formats for further transformation with models. Each source is defined in a single `<source_name>.yaml` file.

## Models

A model is a materialized view, consisting of two files: a `<model_name>.sql` file and a `<model_name>.yaml` file. The `.sql` file supports templating, with `${db}` as the current template variable. Currently, models should only reference other Wharfie models or sources.

## What Happens When I Create a Wharfie Project

Creating a Wharfie project automatically sets up the following:

1. A Glue database named after the project, containing all models and sources.
2. An S3 bucket, named based on the project name, where all models and sources are stored.
3. An IAM role for Wharfie, with S3 permissions scoped to the project's bucket.
4. A number of Glue tables based on the defined models/sources.

## How Is This Different From dbt?

The primary difference lies in execution. There is no scheduler or orchestrator. All sources/models are updated based on their `service_level_agreement.freshness` configuration. For sources, this means recreation on a schedule that matches the freshness SLA, and for models, updates occur whenever the upstream tables they reference are updated (updates only happen if there has been a change upstream).
