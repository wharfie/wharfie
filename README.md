<h1 align="center">
  <a href="https://standardjs.com"><img src="./docs/beanie.svg" alt="Wharfie Beanie Logo" width="200"></a>
  <br>
  Wharfie
  <br>
  <br>
</h1>

<p align="center">
  <a href="https://discord.gg/QEbzFUsR"><img src="https://img.shields.io/discord/1131550721142161408" alt="discord"></a>
  <a href="https://github.com/wharfie/wharfie/actions/workflows/github-actions.yml"><img src="https://github.com/wharfie/wharfie/actions/workflows/github-actions.yml/badge.svg" alt="Wharfie CI"></a>
  <a href="https://www.npmjs.com/package/@wharfie/wharfie"><img src="https://img.shields.io/npm/v/@wharfie/wharfie.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@wharfie/wharfie"><img src="https://img.shields.io/npm/dm/@wharfie/wharfie.svg" alt="npm downloads"></a>
  <a href="https://standardjs.com"><img src="https://img.shields.io/badge/code_style-standard-brightgreen.svg" alt="Standard - JavaScript Style Guide"></a>
</p>

Wharfie is an experimental table-oriented data application framework built ontop of [AWS Athena](https://aws.amazon.com/athena/). Designed to be fast to develop, confident to modify and cheap to run.

Unlike with most data tools Wharfie has ZERO fixed infrastructure costs. Money is only spent when data is processed. Costs are also proportional to the size of the data processed ~5$ per Terrabyte.

Wharfie can work with data in the size of bytes to petabtyes. There is no looming performance cliffs that require a switch of platform.

Wharfie is serverless and relies entirely on managed AWS services. There is no performance tuning or need to maintain a on-call rotation to keep Wharfie running. When Wharfie breaks it is because of upstream outages which when resolved will unblock Wharfie from reprocessing and catching up to a working state.

When defining tables with Wharfie you only need to statically define your table structure or the query used to materialize and Wharfie takes care of The Rest.

"The Rest" includes:

- registing new partitions
- converting compression and data formats
- repartitioning
- schema changes

### ⚡️ Quickstart

#### CLI

```bash
npm i -g @wharfie/wharfie
wharfie config
wharfie deploy create deployment
wharfie deploy create examples
```

### Reference

- **[Shortcuts](./docs/shortcuts.md)**
- **[API](./docs/API.md)**
- **[Defining a role for Wharfie](./docs/defining_a_role_for_wharfie.md)**
- **[Examples](./docs/examples.md)**
- **[FAQ](./docs/FAQ.md)**
- **[Monitoring and Metrics](./docs/metrics.md)**
- **[Contributing](./docs/contributing.md)**
