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
  Parameters: { EXTERNAL: 'true' },
  PartitionKeys,
  StorageDescriptor: {
    Location,
    Columns,
    InputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
    OutputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
    SerdeInfo: {
      SerializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
      Parameters: { 'ignore.malformed.json': 'true' },
    },
    StoredAsSubDirectories: true,
    NumberOfBuckets: 0,
  },
});
