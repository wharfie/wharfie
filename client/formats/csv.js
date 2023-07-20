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
    InputFormat: 'org.apache.hadoop.hive.ql.io.SymlinkTextInputFormat',
    OutputFormat: 'org.apache.hadoop.hive.ql.io.IgnoreKeyTextOutputFormat',
    SerdeInfo: {
      SerializationLibrary: 'org.apache.hadoop.hive.serde2.OpenCSVSerde',
      Parameters: { separatorChar: ',' },
    },
    Compressed: false,
    StoredAsSubDirectories: true,
    NumberOfBuckets: 0,
  },
});
