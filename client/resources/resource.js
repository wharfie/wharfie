'use strict';
const util = require('../util');
const getTableInput = require('../formats');

/**
 *
 * @param {object} options - configuration options
 * @param {string} options.LogicalName - the logical name of the Cloudformation resource
 * @param {string} options.DatabaseName -
 * @param {string} options.TableName -
 * @param {object[]} options.Columns -
 * @param {object[]} options.PartitionKeys -
 * @param {object} options.CompactedConfig -
 * @param {object} options.DaemonConfig -
 * @param {string} options.Format -
 * @param {string} options.InputLocation -
 * @param {string} options.Compression -
 * @param {string} options.Description -
 * @param {object} options.Backfill -
 * @param {string} options.CatalogId -
 * @param {string} options.WharfieDeployment -
 * @param {string} options.Condition -
 * @param {string} options.DependsOn -
 */
exports.Resource = class Resource {
  constructor({
    LogicalName,
    DatabaseName,
    TableName,
    Columns,
    PartitionKeys = [],
    CompactedConfig,
    DaemonConfig,
    Format,
    CustomFormat,
    InputLocation,
    Compression = undefined,
    Description = undefined,
    Backfill = undefined,
    CatalogId = util.accountId,
    WharfieDeployment,
    _ServiceToken = undefined,
    Condition = undefined,
    DependsOn = undefined,
  } = {}) {
    if (!LogicalName) throw new Error('LogicalName is required');
    if (!WharfieDeployment) throw new Error('WharfieDeployment is required');

    this.Outputs = {
      [`${LogicalName}`]: {
        Description: 'Wharfie resource ID',
        Value: Condition
          ? util.if(
              Condition,
              util.join('-', ['wharfie', util.ref(LogicalName)]),
              ''
            )
          : util.join('-', ['wharfie', util.ref(LogicalName)]),
      },
    };
    this.Resources = {
      [`${LogicalName}`]: {
        Type: 'Custom::Wharfie',
        Condition,
        DependsOn,
        Properties: {
          ServiceToken: _ServiceToken || util.importValue(WharfieDeployment),
          CatalogId,
          DatabaseName,
          CompactedConfig,
          DaemonConfig,
          Backfill,
          TableInput: getTableInput({
            TableName,
            Description,
            Location: InputLocation,
            Columns,
            PartitionKeys,
            Format,
            Compression,
            CustomFormat,
          }),
        },
      },
    };
  }
};
