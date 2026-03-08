/**
 * @param {import('./index.js').FormatDefinitionParams} params -
 * @returns {import('./index.js').FormatDefinition} -
 */
module.exports = ({
  TableName,
  Description,
  Location,
  Columns,
  PartitionKeys,
  Compression,
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
    InputFormat: 'org.apache.hadoop.hive.ql.io.orc.OrcInputFormat',
    OutputFormat: 'org.apache.hadoop.hive.ql.io.orc.OrcOutputFormat',
    Compressed: !!Compression,
    SerdeInfo: {
      SerializationLibrary: 'org.apache.hadoop.hive.ql.io.orc.OrcSerde',
      Parameters: { ...(Compression && { 'orc.compress': Compression }) },
    },
    StoredAsSubDirectories: true,
    NumberOfBuckets: 0,
  },
});
