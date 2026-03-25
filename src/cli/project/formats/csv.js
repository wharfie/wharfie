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
}) => ({
  Name: TableName,
  Description,
  TableType: 'EXTERNAL_TABLE',
  Parameters: {
    'skip.header.line.count': '1',
    EXTERNAL: 'true',
  },
  PartitionKeys,
  StorageDescriptor: {
    Location,
    Columns,
    InputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
    OutputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
    SerdeInfo: {
      SerializationLibrary: 'org.apache.hadoop.hive.serde2.OpenCSVSerde',
      Parameters: { separatorChar: ',' },
    },
    Compressed: false,
    StoredAsSubDirectories: true,
    NumberOfBuckets: 0,
  },
});
