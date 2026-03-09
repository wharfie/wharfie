/**
 * @typedef CustomFormatDefinitionParams
 * @property {string} TableName -
 * @property {string} Description -
 * @property {string} Location -
 * @property {import('./index.js').Column[]} Columns -
 * @property {import('./index.js').Column[]} PartitionKeys -=
 * @property {import('./index.js').StorageDescriptor} CustomFormat -
 */

/**
 * @param {CustomFormatDefinitionParams} params -
 * @returns {import('./index.js').FormatDefinition} -
 */
export default ({
  TableName,
  Description,
  Location,
  Columns,
  PartitionKeys,
  CustomFormat,
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
    InputFormat: CustomFormat.InputFormat,
    OutputFormat: CustomFormat.OutputFormat,
    Compressed: CustomFormat.Compressed,
    SerdeInfo: CustomFormat.SerdeInfo,
    StoredAsSubDirectories: CustomFormat.StoredAsSubDirectories,
    NumberOfBuckets: CustomFormat.NumberOfBuckets,
  },
});
