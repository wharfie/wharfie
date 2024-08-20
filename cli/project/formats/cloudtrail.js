'use strict';

module.exports = ({
  TableName,
  Description,
  Location,
  Columns,
  PartitionKeys,
}) => ({
  Name: TableName,
  Description,
  TableType: 'EXTERNAL_TABLE',
  PartitionKeys,
  Parameters: {
    EXTERNAL: 'TRUE',
  },
  StorageDescriptor: {
    Location,
    Columns,
    InputFormat: 'com.amazon.emr.cloudtrail.CloudTrailInputFormat',
    OutputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
    SerdeInfo: {
      SerializationLibrary: 'com.amazon.emr.hive.serde.CloudTrailSerde',
    },
    StoredAsSubDirectories: true,
    NumberOfBuckets: 0,
  },
});
