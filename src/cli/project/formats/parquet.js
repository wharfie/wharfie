import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
/**
 * @param {import('./').FormatDefinitionParams} params -
 * @returns {import('./').FormatDefinition} -
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
    InputFormat:
      'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
    OutputFormat:
      'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',

    Compressed: !!Compression,
    SerdeInfo: {
      SerializationLibrary:
        'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
      Parameters: { ...(Compression && { 'parquet.compress': Compression }) },
    },
    StoredAsSubDirectories: true,
    NumberOfBuckets: 0,
  },
});
