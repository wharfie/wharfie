# API

Wharfie's interface is a custom cloudformation of type: 'Custom::Wharfie'. This resource extends the configuration of the AWS provided [AWS::Glue::Table](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-glue-table.html) resource by adding two extra fields: `CompactedConfig` and `DaemonConfig`.

```js
{
  Type: 'Custom::Wharfie',
  Properties: {
    Tags: [
      {
        Key: "foo",
        Value: "bar"
      }
    ]
    ServiceToken: cf.importValue(`wharfie-production`),
    DatabaseName: cf.ref('Database'),
    CatalogId: cf.accountId,
    Backfill: {
      Version: 1,
      Duration: 60 * 24 * 30
    },
    CompactedConfig: {
      Location: `s3://your-teams-bucket/some_path/table_name/`,
    },
    DaemonConfig: {
      Role: `valid_role_arn`,
      Schedule: 2,
      PrimaryKey: `eventid`,
      SLA: {
	      MaxDelay:  60 * 24,
        ColumnExpression: `date(concat('2020-', month, '-', day))`,
      },
	    AlarmActions: [cf.importValue(cf.sub('on-call-production-${OnCallTeam}'))]
    },
    TableInput: {
      ... // from [glue:TableInput](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-glue-table-tableinput.html)
    }
  }
}
```

## `Tags`

resource tags to apply to Wharfie

_Required:_ No

_Type:_ List<AWS_TAG>

_Update requires:_ No interuption

## `DatabaseName`

DatabaseName to be used by Wharfie, all tables (source and destination) made by wharfie will be created in this database.

_Required:_ Yes

_Type:_ string

_Update requires:_ No interuption

## `CatalogId`

The AWS glue CatalogId to be used by Wharfie for registering any tables it creates with, must also already include the Database referenced with DatabaseName.

_Required:_ No, defaults to current aws account id

_Type:_ string

_Update requires:_ No interuption

## `Backfill`

configuration for performing backfill operations

### Properties:

#### `Version`

Monotonically increasing integar ID for backfills. When this value is incremented a backfill will be run after the next stack update.

_Required:_ No

_Type:_ Integer

_Update requires:_ No interuption

#### `Duration`

In minutes, defines the maximum time delta that wharfie will use when identifying input data for the backfill operation. This value will be used instead of `SLA.MaxDelay`.

_Required:_ Yes

_Type:_ Integer

_Update requires:_ No interuption

## `CompactedConfig`

configuration related to the compacted output

### Properties:

#### `Location`

S3 prefix to write compacted data to

_Required:_ Yes

_Type:_ String

_Update requires:_ No interuption

## `DaemonConfig`

configuration for the Wharfie daemon process

### Properties:

#### `Role`

An IAM role ARN that the daemon can assume with s3 permissions to read from the raw location and write to the compacted location. For more information on how to define this role see the [role docs](./defining_a_role_for_wharfie.md)

_Required:_ Yes

_Type:_ String (ARN)

_Update requires:_ No interuption

#### `Interval`

In minutes, sets the deduplication interval for s3 events being sent to Wharfie for a particular resource. Increasing this will decrease the ammount of reprocessing and cost but reduce the recency of the output data.

_Required:_ No, defaults to 5 minutes

_Type:_ Integer

_Update requires:_ No interuption

#### `Schedule`

In minutes, how frequently the daemon process will check for new partitions to register or new data to compress. If unset the daemon will never look for new partitions or data after the initial resource creation.

_Required:_ No

_Type:_ Integer

_Update requires:_ No interuption

#### `PrimaryKey`

Column name that contains a unique identifier for records in the dataset. Setting this means that no duplicate records will be inserted into the compacted dataset.

_Required:_ No

_Type:_ String

_Update requires:_ No interuption

#### `SLA.MaxDelay`

In minutes, defines the maximum time delta that wharfie will use when identifying data to compress, setting this can avoid recompressing raw data that will no longer be updated.

_Required:_ No, Yes if `SLA.ColumnExpression` is set

_Type:_ Integer

_Update requires:_ No interuption

#### `SLA.ColumnExpression`

presto expression for what the `MaxDelay` value should be compared to, this expression must return a valid date, datetime or timestamp.

_Required:_ No, Yes if `SLA.MaxDelay` is set

_Type:_ String

_Update requires:_ No interuption

#### `AlarmActions`

List of SNS topic that wharfie will push alarm messages to in the event the Wharfie resource has a terminal failure.

_Required:_ No

_Type:_ List<SNS_Topic_ARN>

_Update requires:_ No interuption

## `TableInput`

from [glue:TableInput](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-glue-table-tableinput.html)

Wharfie's TableInput configuration defines the source data, either a view or regular table that will be used as the source to perform work against.

All properties for AWS glue tables are valid for Wharfie resources.
