'use strict';
const util = require('./util');

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
 * @param {string} options.InputLocation -
 * @param {object} options.SqlVariables -
 * @param {string} options.CatalogId -
 * @param {string} options.Description -
 * @param {string} options.WharfieDeployment -
 * @param {object} options.Backfill -
 * @param {string} options.Condition -
 * @param {string} options.DependsOn -
 */
exports.MaterializedView = class MaterializedView {
  constructor({
    LogicalName,
    DatabaseName,
    TableName,
    Columns,
    PartitionKeys = [],
    CompactedConfig,
    OriginalSql,
    DaemonConfig,
    InputLocation = '',
    SqlVariables = {},
    CatalogId = util.accountId,
    Description = undefined,
    Backfill = undefined,
    WharfieDeployment,
    Condition = undefined,
    DependsOn = undefined,
  } = {}) {
    if (!LogicalName || !DatabaseName || !TableName || !Columns)
      throw new Error(
        'LogicalName, DatabaseName, TableName, Columns and Location are required'
      );
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
          ServiceToken: util.importValue(WharfieDeployment),
          CatalogId,
          DatabaseName,
          CompactedConfig,
          DaemonConfig,
          Backfill,
          TableInput: {
            Name: TableName,
            Description,
            TableType: 'VIRTUAL_VIEW',
            Parameters: { comment: 'Presto View', presto_view: 'true' },
            PartitionKeys,
            StorageDescriptor: {
              Columns,
              Location: InputLocation,
              NumberOfBuckets: 0,
              StoredAsSubDirectories: false,
              SerdeInfo: {},
              Compressed: false,
            },
            ViewOriginalText: util.sub('/* Presto View: ${view} */', {
              view: util.base64(
                util.sub(
                  JSON.stringify({
                    originalSql: OriginalSql,
                    catalog: 'awsdatacatalog',
                    columns: [
                      ...Columns.map((column) => ({
                        name: column.Name,
                        type: column.Type.replace(/:string/g, ':varchar')
                          .replace(/^string/g, 'varchar')
                          .replace(/:int/g, ':integer')
                          .replace(/^int/g, 'integer')
                          .replace(/:float/g, ':real')
                          .replace(/^float/g, 'real')
                          .replace(/struct/g, 'row')
                          .replace(/</g, '(')
                          .replace(/>/g, ')')
                          .replace(/:/g, ' '),
                      })),
                      ...PartitionKeys.map((column) => ({
                        name: column.Name,
                        type: column.Type.replace(
                          /^string/g,
                          'varchar'
                        ).replace(/^int/g, 'integer'),
                      })),
                    ],
                  }),
                  SqlVariables
                )
              ),
            }),
            ViewExpandedText: '/* Presto View */',
          },
        },
      },
    };
  }
};
