# Mapping legacy Wharfie v1 workloads onto v2

Wharfie v2 does not recreate the old `wharfie.yaml` / `sources/` / `models/` authoring surface.

Instead, it treats that shape as a workload you can model on the current manifest-first substrate.

## Core mapping

- `wharfie.yaml` project metadata becomes `wharfie.app.js`
- `sources/` ingestion and registration steps become named `activities`
- `models/` refreshes become named `activities` or multi-step `workflows`
- partition repair, repartitioning, and backfills become explicit activity runs or workflow actions
- cron/SLA automation becomes `scheduler.triggers`
- AWS-specific state and IO move behind explicit `resources` or shared refs using adapters like `dynamodb`, `sqs`, and `s3`
- operation history, retries, and replay move onto persisted `wharfie ops` DAGs

## A concrete v1-style workload expressed as a v2 app

```js
export default {
  name: 'legacy-daily-analytics',
  cli: {
    entrypoint: './src/cli.js',
    export: 'main',
  },
  resources: {
    db: {
      adapter: 'dynamodb',
      options: { tableName: 'legacy-daily-analytics-state' },
    },
    queue: {
      adapter: 'sqs',
      options: { queueUrl: process.env.WHARFIE_QUEUE_URL },
    },
    objectStorage: { ref: 'analytics-lake' },
  },
  activities: {
    syncOrdersSource: {
      entrypoint: {
        path: './src/activities/sync-orders-source.js',
        export: 'syncOrdersSource',
      },
    },
    materializeDailyRevenue: {
      entrypoint: {
        path: './src/activities/materialize-daily-revenue.js',
        export: 'materializeDailyRevenue',
      },
    },
  },
  workflows: {
    refreshDailyAnalytics: {
      actions: [
        { id: 'start', type: 'START' },
        {
          id: 'sync-orders',
          type: 'INVOKE_FUNCTION',
          activity: 'syncOrdersSource',
          dependsOn: ['start'],
        },
        {
          id: 'materialize-daily-revenue',
          type: 'INVOKE_FUNCTION',
          activity: 'materializeDailyRevenue',
          dependsOn: ['sync-orders'],
        },
        {
          id: 'finish',
          type: 'FINISH',
          dependsOn: ['materialize-daily-revenue'],
        },
      ],
    },
  },
  scheduler: {
    triggers: [
      { activity: 'syncOrdersSource', cron: '0 * * * *' },
      { activity: 'materializeDailyRevenue', cron: '15 * * * *' },
    ],
  },
};
```

That app still looks like Wharfie v2:

- a developer-owned CLI remains the front door
- source handling is just an activity with explicit resources
- model materialization is just another activity
- orchestration is visible in a workflow definition instead of being inferred from folder names
- scheduling is explicit instead of hidden behind deployment metadata

## What stays intentionally different

Wharfie v2 does **not** try to keep the old product identity alive.

You do not get implicit `sources/` and `models/` directory semantics in the default scaffold. You declare the app shape directly in `wharfie.app.js`, then opt into workflows, scheduling, packaging, and shared resources as needed.

That is the point of the split:

- **Wharfie v1** is the historical Athena/table-oriented workload model
- **Wharfie v2** is the current manifest-first CLI/activity/runtime substrate

Use this page when you want to explain how an old v1-style data workflow fits on the current system without making Wharfie itself look like two competing products.
