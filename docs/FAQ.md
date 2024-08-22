# FAQ

## What is Wharfie?

Wharfie is a general purpose utility for doing ETL in AWS

## What type of things that you can do with it

- Register structured and unstructured data as new tables
  - **Supported compression formats:** gzip, bzip2, lzo, zlib, snappy.
  - **Supported structured data formats:** csv, tsv, json, avro, orc, parquet
  - **Unstructured text data** (like logs) can also be registered by using Athena’s Regex Serde or Grok Serde.
- Create a dbt-like model, or put differently, making a table by querying existing tables, sometimes called a materialized view by tools like PostgreSQL.
- Build data pipelines by chaining together multiple Wharfie Models
- Ingest new data as its delivered in S3
- Make changes to existing tables without worrying about complex migrations

## Why should I be interested in using Wharfie?

1. Wharfie ensures that your ETL does what you expect before you spend time or money on processing. (run `wharfie project dev`)
2. Wharfie accurately tells you what your ETL will cost before you run anything (run `wharfie project cost`)
3. Wharfie is "serverless", you won’t have to own or maintain any processing and orchestration infrastructure and have an oncall rotation to ensure uptime.
4. Wharfie allows you to evolve your schemas and data models without having to worry about complex migrations or breaking tables.

## How does it work?

Wharfie is built ontop of AWS Lambda/SQS/DynamoDB/S3/Athena. By observing change events from S3, Wharfie is able to automatically update and maintain Source datasets as new data is delivered, and refresh models who depend on those sources by understanding the dependencies required by them.

## What’s the interface?

Wharfie uses an opinionated project file structure and organizes itself around the concept of Sources And Models

Sources describe existing data on S3

Models describe mataterialized views, or sql queries that create new data on s3 by querying other Models and Sources.

For more information see **[Project](./docs/project.md)**

## Do I need to install an NPM package to use this?

Yes, currently the wharfie CLI is distributed as an NPM package and needs to be installed globally with `npm install -g @wharfie/wharfie`

## Can I load data from anywhere on S3?

Yes.

## Can I write data to anywhere on S3?

Yes.

## How is S3 access control managed?

Wharfie manages this automatically with tightly scoped IAM roles set to the specific locations defined for Wharfie Sources and Models

## How does Wharfie automatically partition my data?

Wharfie will partition data based on whatever schema you've defined for your `partitions` config. If `partitions` is omitted or empty the table wont be partitioned. Your partitions must match with the raw data on s3, Wharfie will not repartition raw data for you.

If you need to do repartitioning you'll need to define a Wharfie Model that queries your unpartitioned Sources/Models and writes the data to a new location with the desired partitioning.

## How does scheduling work?

Instead of scheduling, you define **Service Level Agreements** for your data. Wharfie will ensure that your data is processed according to the SLA you've defined.

## Are there any filesize, data format and compression format restrictions for raw data?

Wharfie supports ingesting any files of any size, though many very small files (>10000) or very large file sizes (>100gb) will slow down ETL. Wharfie supports any data format and compression format supported by athena.

Docs: https://docs.aws.amazon.com/athena/latest/ug/supported-serdes.html

## Are there any limitations?

- datasets cannot have rows that exceeded 32mb when compressed

## How much does it cost?

ETL costs are significantly impacted by **Service Level Agreement** configuration, but can run as low as 5\$ per TB. Costs can increase substantially depending on the freshness SLA and partitioning scheme of the dataset, rewriting the entire table on a frequent schedule can become expensive. Using `wharfie project cost` will give you a breakdown of the costs for your project and can be run before you deploy your project to get a sense of the costs.

## How do schema updates work?

When making a schema change wharfie will do a zero-downtime swap of the old schema resource with an updated and backfilled resource, depending on the size of the table this backfill can take a while to run, and will block downstream updates to be applied.

## My raw dataset is very large and stored in the same S3 path?

Many AWS service log datasets are delivered as objects in the same S3 path (e.g. ALB logs, CloudFront logs, CloudTrail). The amount of data in these paths can make running Wharfie very expensive. For these datasets, you may want to want to configure an S3 object lifecycle rule to either delete them or move into AWS Glacier after a certain amount of time. Wharfie ignores any s3 objects stored in Glacier. Setting up a S3 lifecycle rule in coordination with wharfie's SLA configuration provides a robust mechanism for cost effectively storing and processing large flat datasets, like certain types of AWS access logs. Without setting up some type of s3 lifecycle rule the cost of Wharfie processing will steadily grow unbounded.
