<h1 align="center">
  <a href="https://standardjs.com"><img src="./docs/beanie.svg" alt="Wharfie Beanie Logo" width="200"></a>
  <br>
  Wharfie
  <br>
  <br>
</h1>

<p align="center">
  <a href="https://discord.gg/QEbzFUsR"><img src="https://img.shields.io/discord/1131550721142161408" alt="discord"></a>
  <a href="https://github.com/wharfie/wharfie/actions/workflows/ci.yml"><img src="https://github.com/wharfie/wharfie/actions/workflows/ci.yml/badge.svg" alt="Wharfie CI"></a>
  <a href="https://www.npmjs.com/package/@wharfie/wharfie"><img src="https://img.shields.io/npm/v/@wharfie/wharfie.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@wharfie/wharfie"><img src="https://img.shields.io/npm/dm/@wharfie/wharfie.svg" alt="npm downloads"></a>
  <a href="https://standardjs.com"><img src="https://img.shields.io/badge/code_style-standard-brightgreen.svg" alt="Standard - JavaScript Style Guide"></a>
</p>

Wharfie is an experimental table-oriented data application framework built ontop of [AWS Athena](https://aws.amazon.com/athena/). Designed to be fast to develop, confident to modify and cheap to run.

Unlike most data tools, Wharfie has ZERO fixed infrastructure costs. Money is only spent when data is processed. Costs are also proportional to the size of the data processed, averaging around $5 per terabyte.

Wharfie can work with data sizes ranging from bytes to petabytes. There are no looming performance cliffs that require a platform switch.

Wharfie is serverless and relies entirely on managed AWS services. There's no need for performance tuning or an on-call rotation to keep Wharfie running. When Wharfie breaks, it's usually because of upstream outages, which when resolved, unblock Wharfie from reprocessing and catching up to a functional state.

When defining tables with Wharfie, you only need to statically define your table structure or the query used to materialize, and Wharfie takes care of the rest.

"The Rest" includes:

- Registering new partitions
- Converting compression and data formats
- Repartitioning
- Managing schema changes

### ⚡️ Quickstart

#### CLI

```bash
npm i -g @wharfie/wharfie
wharfie config
wharfie deployment create
wharfie examples create
```

### Reference

- **[Shortcuts](./docs/shortcuts.md)**
- **[API](./docs/API.md)**
- **[Defining a role for Wharfie](./docs/defining_a_role_for_wharfie.md)**
- **[Examples](./docs/examples.md)**
- **[FAQ](./docs/FAQ.md)**
- **[Monitoring and Metrics](./docs/metrics.md)**
- **[Contributing](./docs/contributing.md)**
