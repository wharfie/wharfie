import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const cloudfront = require('./cloudfront');
const cloudtrail = require('./cloudtrail');
const csv = require('./csv');
const json = require('./json');
const orc = require('./orc');
const parquet = require('./parquet');
const s3 = require('./s3');
const customFormat = require('./custom-format');

/**
 * @typedef Column
 * @property {string} Name -
 * @property {string} Description -
 * @property {string} Type -
 */

/**
 * @typedef SerdeInfo
 * @property {string} SerializationLibrary -
 * @property {Object<string,string>} [Parameters] -
 */

/**
 * @typedef StorageDescriptor
 * @property {string} Location -
 * @property {Column[]} Columns -
 * @property {string} InputFormat -
 * @property {string} OutputFormat -
 * @property {boolean} [Compressed] -
 * @property {SerdeInfo} SerdeInfo -
 * @property {boolean} [StoredAsSubDirectories] -
 * @property {number} [NumberOfBuckets] -
 */

/**
 * @typedef FormatDefinition
 * @property {string} Name -
 * @property {string} Description -
 * @property {string} TableType -
 * @property {Column[]} PartitionKeys -
 * @property {Object<string,string>} [Parameters] -
 * @property {StorageDescriptor} StorageDescriptor -
 */

/**
 * @typedef FormatDefinitionParams
 * @property {string} TableName -
 * @property {string} Description -
 * @property {string} Location -
 * @property {Column[]} Columns -
 * @property {Column[]} PartitionKeys -=
 * @property {StorageDescriptor} [CustomFormat] -
 * @property {string} [Format] -
 * @property {string} [Compression] -
 */

/**
 * @param {FormatDefinitionParams} params -
 * @returns {FormatDefinition} -
 */
module.exports = (params) => {
  if (params.CustomFormat && params.Format)
    throw new Error('Cannot specify both CustomFormat and Format');
  if (params.CustomFormat && params.Compression)
    throw new Error('Cannot specify both CustomFormat and Compression');
  if (params.CustomFormat)
    return customFormat({ ...params, CustomFormat: params.CustomFormat });
  switch (params.Format) {
    case 'cloudfront':
      return cloudfront(params);
    case 'cloudtrail':
      return cloudtrail(params);
    case 's3':
      return s3(params);
    case 'csv':
      return csv(params);
    case 'json':
      return json(params);
    case 'orc':
      return orc(params);
    case 'parquet':
      return parquet(params);
    default:
      throw new Error(`No format of type ${params.Format}`);
  }
};
