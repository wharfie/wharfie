import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

/**
 * @typedef CustomFormatDefinitionParams
 * @property {string} TableName -
 * @property {string} Description -
 * @property {string} Location -
 * @property {import('./').Column[]} Columns -
 * @property {import('./').Column[]} PartitionKeys -=
 * @property {import('./').StorageDescriptor} CustomFormat -
 */

/**
 * @param {CustomFormatDefinitionParams} params -
 * @returns {import('./').FormatDefinition} -
 */
module.exports = ({
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
