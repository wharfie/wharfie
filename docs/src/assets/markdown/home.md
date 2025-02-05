<h1 align="center">
  <img src="../images/beanie.png?as=webp" alt="Wharfie Beanie Logo" width="200">
  <br>
  Wharfie
</h1>

Wharfie is an experimental table-oriented data application framework built ontop of [AWS Athena](https://aws.amazon.com/athena/). Designed to be fast to develop, confident to modify and cheap to run.

Unlike most data tools, Wharfie has ZERO fixed infrastructure costs. Money is only spent when data is processed. Costs are also proportional to the size of the data processed, averaging around $5 per terabyte. Wharfie can tell you how much it will cost to run your application before you run it, and also can make sure that it will output what you expect before you spend time waiting for it to run.

Wharfie can work with data sizes ranging from bytes to petabytes. There are no looming performance cliffs that require a platform switch.

Wharfie is serverless and relies entirely on managed AWS services. There's no need for performance tuning or an on-call rotation to keep Wharfie running. When Wharfie breaks, it's usually because of upstream outages, which when resolved, unblock Wharfie from reprocessing and catching up to a functional state.

When defining tables with Wharfie, you only need to statically define your table structure or the query used to materialize, and Wharfie takes care of the rest.

"The Rest" includes:

- Registering new partitions
- Converting compression and data formats
- Repartitioning
- Managing schema changes

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
wharfie config
wharfie deployment create
wharfie project init
```

For more follow the [QuickStart Guide](./quickstart)
