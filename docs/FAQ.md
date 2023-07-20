# FAQ

## What is Wharfie?

Wharfie is a general purpose utility for doing ETL

## What type of things that you can do with it

- Register structured and unstructured data as new tables
  - **Supported compression formats:** gzip, bzip2, lzo, zlib, snappy.
  - **Supported structured data formats:** csv, tsv, json, avro, orc, parquet
  - Unstructured text data (like logs) can also be registered by using Athena’s Regex Serde or Grok Serde.
- Create a materialized view ,or put differently, making a table by querying existing tables.
- Build data pipelines by chaining together multiple Wharfie resources
- Ingest new data as its delivered in S3

## Why should I be interested in using Wharfie?

1. Its "serverless", You won’t have to own or maintain any processing and orchestration infrastructure. So long as your processing business logic can be expressed in Athena SQL.
2. It will be cheaper than your spark application
3. You can define and manage everything in cloudformation

## How does it work?

You create a new `Wharfie` cloudformation resource. After the creation is complete you will see two new glue resources in the glue metastore. The properties and naming of these are derived from the configuration of the original `Wharfie` resource. They are:

1. A `${table_name}_raw` table which is the raw dataset that was described by the TableInput configuration of the Wharfie resource.
2. A `${table_name}` table which is the compacted dataset that will be updated by Wharfie in response to changes in the first table.

Internally Wharfie will also register the new resource with its orchestration and processing engine powered by Athena. How orchestration and processing works depends on the configuration that was provided in the `DaemonConfig` cloudformation property.

## What’s the interface?

See **[API](./docs/API.md)**

## Do I need to install an NPM package to use this?

No packages need to be installed to use the Wharfie cloudformation resources. But there is a cloudformation shortcut library that can make defining resources easier `@wharfie/wharfie`

## Can I load data from anywhere on S3?

Yes.

## Can I write data to anywhere on S3?

Yes.

## How is S3 access control managed?

Wharfie doesn’t have \* read and write permissions to s3. As a user you’ll need to provide an IAM role to your Wharfie resource that can be assumed by it’s Daemon. This role needs to provide s3 read permissions to the raw data as well as s3 write permissions to the compacted output location. For docs on how to define this role see **[Defining a role for Wharfie](./docs/defining_a_role_for_wharfie.md)**

## How does Wharfie automatically partition my data?

Wharfie will partition data based on whatever schema you've defined for your `partitionKeys` parameter. If `partitionKeys` is omitted or empty the table wont be partitioned. Your partitionKeys must match with the raw data on s3, Wharfie will not repartition raw data for you.

If you need to do repartitioning you'll need to define two Wharfie resources. The first to register your raw unpartition data and the second as a materialized view querying the first resource.

## Can Wharfie be event driven instead of scheduled?

Yes, Wharfie can be event driven by creating an s3 event notification that publish messages to the `wharfie-production-s3-event-queue` SQS queue. Wharfie will deduplicate those events based on the [`interval`](./docs/API.md#Interval) config to avoid excessive reprocessing. You can reference the queue arn in your cloudformation by using `cf.importValue('wharfie-production-s3-event-queue')`. The [examples](./docs/examples.md)\*\* includes a sample event driven Wharfie resource.

Using s3 event driven Wharfie resources is a cost effective way of making sure tables are recent. Wharfie will match each s3 event with the partition it relates to and only reprocess that specific partition, ignoring the SLA configuration. This is less prone to configuration errors, makes processing much faster and will make any backfilling happen automatically.

## How do I backfill data with Wharfie?

By using the `Backfill` configuration options you can start a backfill by incrementing the `Backfill.Version` and updating the Wharfie resource (which will start a backfill using the `Backfill.Duration`).

## What happens when I delete a Wharfie resource?

Tables will be removed from glue along with any metadata related to the Daemon. Deleting a Wharfie resource does not cause data in S3 to be deleted. If you recreate a deleted Wharfie resource with the same configuration the existing data will be reregistered immediately.

## Is there any latency between data landing in the raw location and being available to query in athena/mode?

Users should always prefer querying the compacted table over the raw table. Queries against compacted datasets will often run at least an order of magnitude faster and cheaper. The downside of the compacted dataset is that the update cadence is latent, how latent depends on the DaemonConfig and the size of the dataset’s partitions.

## Are there any filesize, data format and compression format restrictions for raw data?

Wharfie supports ingesting any files of any size, though many very small files (>10000) or very large file sizes (>100gb) will slow down ETL. Wharfie supports any data format and compression format supported by athena.

Docs: https://docs.aws.amazon.com/athena/latest/ug/supported-serdes.html

## Are there any limitations?

- datasets cannot have rows that exceeded 32mb when compressed

## How much does it cost?

ETL costs are significantly impacted by the DaemonConfig, but can run as low as 5\$ per TB of raw data if the SLA is equal to the Schedule and raw data is partitioned to fall evenly within those. Costs can increase substantially depending on the DaemonConfig and partitioning scheme of the dataset, rewriting the entire table on a frequent schedule can become expensive and you’ll see this reflected in your aws cost report.

## How do schema updates work?

Schema updates are self-serve and can be managed by users by modifying the Columns values set on the cloudformation resource. Depending on the type of schema change, data may need to be backfilled, this is treated as a replacement of the resource by cloudformation.

For determining if a particular schema change will cause a replacement/backfill, refer to the athena docs on ORC read by index schema changes (any change not supported by the format causes a full backfill): https://docs.aws.amazon.com/athena/latest/ug/handling-schema-updates-chapter.html

## My raw dataset is very large and stored in the same S3 path?

Many AWS service log datasets are delivered as objects in the same S3 path (e.g. ALB logs, CloudFront logs, CloudTrail). The amount of data in these paths can make running Wharfie V2 very expensive. For these datasets, you’re going to want to configure an S3 object lifecycle rule to either delete them or move into AWS Glacier after a certain amount of time. Wharfie V2 ignores any objects stored in Glacier. Setting up a S3 lifecycle rule in coordination with the Daemon’s SLA configuration provides a robust mechanism for cost effectively storing and processing large flat datasets, like certain types of AWS access logs. Without setting up some type of s3 lifecycle rule the cost of Wharfie processing will steadily grow unbounded.

## Will Wharfie delete my data?

Wharfie never deletes raw data and will only ever delete compacted data if configured to do so, by default Wharfie does not delete compacted data.
