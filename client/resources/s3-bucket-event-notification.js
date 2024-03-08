'use strict';
const util = require('../util');

/**
 *
 * @param {object} options - configuration options
 * @param {string} options.LogicalName - the logical name of the Cloudformation resource
 * @param {Array<object>} options.Tags -
 * @param {object} options.Code -
 * @param {string} options.WharfieDeployment -
 * @param {string} options.Condition -
 * @param {string} options.DependsOn -
 */
exports.S3BucketEventNotification = class S3BucketEventNotification {
  constructor({
    LogicalName,
    S3URI,
    WharfieDeployment,
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
        Type: 'Custom::WharfieS3BucketEventNotification',
        Condition,
        DependsOn,
        Properties: {
          ServiceToken: util.importValue(WharfieDeployment),
          S3URI,
        },
      },
    };
  }
};
