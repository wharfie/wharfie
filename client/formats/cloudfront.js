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
    'skip.header.line.count': '2',
    EXTERNAL: 'TRUE',
  },
  StorageDescriptor: {
    Location,
    Columns,
    InputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
    OutputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
    SerdeInfo: {
      SerializationLibrary:
        'org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe',
      Parameters: {
        'field.delim': '\t',
        'serialization.format': '\t',
      },
    },
    StoredAsSubDirectories: true,
    NumberOfBuckets: 0,
  },
});
