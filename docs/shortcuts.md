# Shortcuts

To make defining resources easier, wharfie features a node.js cloudformation shortcut library.

## Installation

```bash
npm i --save @wharfie/wharfie
```

## Shortcuts

### `new wharfie.Resource(options)`

defines a Wharfie resource

**Options**

`LogicalName` - cloudformation resource logical name

`DatabaseName` - glue database name

`TableName` - glue table name

`Description` - glue table description

`Columns` - list of table columns

`PartitionKeys` - list of partition columns

`Format` - backing data format. options: orc, parquet, json, csv, cloudtrail, cloudfront, s3

`Compression` - backing data compression, only for orc/parquet formats. For data in CSV, TSV, and JSON, Athena determines the compression type from the file extension. If no file extension is present, Athena treats the data as uncompressed plain text. options: SNAPPY, ZLIB, LZO, GZIP, BZIP2.

`InputLocation` - S3 URI to load data from

`CompactedConfig` - Wharfie conmpacted options ([API](./API.md#CompactedConfig))

`DaemonConfig` - Wharfie daemon options ([API](./API.md#DaemonConfig))

`Backfill` - Wharfie backfill options ([API](./API.md#Backfill))

**Example**

```js
const wharfie = require('@wharfie/wharfie')

const wharfieResource = new wharfie.Resource({
    LogicalName: 'MyTemplatesWharfieResource',
    DatabaseName: 'database',
    TableName: 'great_table',
    Columns: [
        { Name: 'name', Type: 'string' },
        { Name: 'address', Type: 'string' },
        { Name: 'state', Type: 'string' },
    ],
    PartitionKeys = [{ Name: 'dt', Type: 'string' }],
    Format: 'orc',
    InputLocation: 's3://bucket/example-input/',
    Compression: 'SNAPPY',
    Description: 'a great example table',
    CompactedConfig: {
        Location: 's3://bucket/example/'
    },
    DaemonConfig: {
        Role: wharfie.util.getAtt('MyTemplatesWharfieRole', 'Arn'),
        Schedule: 5,
        PrimaryKey: `name`,
        SLA: {
            MaxDelay: 60 * 24,
            ColumnExpression: `date_parse(dt, '%Y-%m-%d')`
        },
        AlarmActions: [
            wharfie.util.importValue(wharfie.util.sub('pagerduty-sns-topic'))
        ]
    },
    Backfill: {
        Version: 1,
        Duration: 60 * 24 * 7
    }
})

....

module.exports = wharfie.util.merge({...}, loadingDockResource, ...)

```

### `new ld.Role(options)`

defines an IAM role for Wharfie resources

**Options**

`InputLocations` - array of s3 paths that Wharfie will be able to read data from.

`OutputLocations` - array of s3 path that Wharfie will be able to write data into.

**Example**

```js
const wharfie = require('@wharfie/wharfie')

const wharfieRole = new wharfie.Role({
    LogicalName: 'MyTemplatesWharfieRole',
    InputLocations: ['bucket/example-input/'],
    OutputLocations: ['bucket/example/'],
})

const wharfieResource = new wharfie.Resource({
    ...
    DaemonConfig: {
        Role: wharfie.util.getAtt('MyTemplatesWharfieRole', 'Arn'),
        ...
    }
    ...
})

module.exports = wharfie.util.merge({...}, loadingDockRole, loadingDockResource,  ...)

```

### `new ld.MaterializedView(options)`

defines an wharfie resource that will materialze a table from a Athena SQL query.

**Options**

`LogicalName` - cloudformation resource logical name

`DatabaseName` - glue database name

`TableName` - glue table name

`Description` - glue table description

`Columns` - list of table columns

`PartitionKeys` - list of partition columns

`OriginalSql` - sql string to use for the view

`SqlVariables` - object of key/values to swap out in the `OriginalSql`

`InputLocation` - S3 URI to use for event-driven trigger

`CompactedConfig` - Wharfie conmpacted options ([API](./API.md#CompactedConfig))

`DaemonConfig` - Wharfie daemon options ([API](./API.md#DaemonConfig))

`Backfill` - Wharfie backfill options ([API](./API.md#Backfill))

**Example**

```js
const wharfie = require('@wharfie/wharfie')

const path = require('path');
const { readFileSync } = require('fs');

const wharfieResource = new wharfie.MaterializedView({
    LogicalName: 'MyTemplatesWharfieResource',
    DatabaseName: 'database',
    TableName: 'great_table',
    Columns: [
        { Name: 'name', Type: 'string' },
        { Name: 'address', Type: 'string' },
        { Name: 'state', Type: 'string' },
    ],
    PartitionKeys = [{ Name: 'dt', Type: 'string' }],
    Description: 'a great example table',
    OriginalSql: readFileSync(
        path.join(__dirname, 'great_query.sql'), 'utf8'
    ),
    SqlVariables: {
        db_name: wharfie.util.if('IsProduction', 'logs', 'logs_staging'),
    },
    CompactedConfig: {
        Location: 's3://bucket/example/'
    },
    DaemonConfig: {
        Role: wharfie.util.getAtt('MyTemplatesWharfieRole', 'Arn'),
        Schedule: 5,
        PrimaryKey: `name`,
        SLA: {
            MaxDelay: 60 * 24,
            ColumnExpression: `date_parse(dt, '%Y-%m-%d')`
        },
        AlarmActions: [
            wharfie.util.importValue(wharfie.util.sub('pagerduty-sns-topic'))
        ]
    },
    Backfill: {
        Version: 1,
        Duration: 60 * 24 * 7
    }
})

...

module.exports = wharfie.util.merge({...}, loadingDockResource, ...)

```

### `new ld.Firehose(options)`

defines a kinesis firehose that delivers data to a Wharfie resource

**Options**

`LogicalName` - cloudformation resource logical name

`DatabaseName` - glue database name

`TableName` - glue table name

`Description` - glue table description

`Columns` - list of table columns

`DestinationBucket` - s3 bucket to store data in

`DestinationPrefix` - s3 prefix to store data in

`AlarmActions` - Wharfie alarm actions ([API](./API.md#AlarmActions))

`FirehoseLoggingEnabled` - firehose cloudwatch logging toggle, default=false

`SourceStreamARN` - ARN of kinesis stream to pull data from, optional

`BufferInterval` - firehose buffer interval in seconds, default=900

`BufferMBs` - firehose buffer size in MB, default=128

`Backfill` - Wharfie backfill options ([API](./API.md#Backfill))

**Example**

```js
const wharfie = require('@wharfie/wharfie')

const path = require('path');
const { readFileSync } = require('fs');

const wharfieFirehose = new wharfie.Firehose({
    LogicalName: 'MyTemplatesWharfie',
    DatabaseName: 'database',
    TableName: 'great_table',
    Columns: [
        { Name: 'name', Type: 'string' },
        { Name: 'address', Type: 'string' },
        { Name: 'state', Type: 'string' },
    ],
    Description: 'a great example table',
    DestinationBucket: 'bucket',
    DestinationPrefix: 'great_table_prefix/',
    AlarmActions: [
        wharfie.util.importValue(wharfie.util.sub('pagerduty-sns-topic'))
    ]
    Backfill: {
        Version: 1,
        Duration: 60 * 24 * 7
    }
})

const wharfieFirehoseARN = wharfie.util.getAtt('MyTemplatesWharfieFirehose', 'Arn');

...

module.exports = wharfie.util.merge({...}, wharfieFirehose, ...)

```
