/**
 * @param {import('./index.js').FormatDefinitionParams} params -
 * @returns {import('./index.js').FormatDefinition} -
 */
export default ({
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
        'field.delim': '	',
        'serialization.format': '	',
      },
    },
    StoredAsSubDirectories: true,
    NumberOfBuckets: 0,
  },
});
