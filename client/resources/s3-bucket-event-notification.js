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
    Bucket,
    Prefix,
    WharfieDeployment,
    Name,
    Condition = undefined,
    DependsOn = undefined,
    Description = undefined,
    Tags = undefined,
  } = {}) {
    if (!LogicalName) throw new Error('LogicalName is required');
    if (!WharfieDeployment) throw new Error('WharfieDeployment is required');
    if (!Bucket) throw new Error('Bucket is required');
    this.Resources = {
      [`${LogicalName}`]: {
        Type: 'AWS::Events::Rule',
        Condition,
        DependsOn,
        Tags,
        Properties: {
          Name,
          Description,
          // EventBusName: util.importValue(
          //   util.join('-', [WharfieDeployment, 'Event-Bus'])
          // ),
          EventPattern: {
            source: ['aws.s3'],
            'detail-type': ['Object Created', 'Object Deleted'],
            detail: {
              bucket: {
                name: [Bucket],
              },
              ...(Prefix && {
                object: {
                  key: [{ prefix: Prefix }],
                },
              }),
            },
          },
          State: 'ENABLED',
          Targets: [
            {
              Id: 'S3EventQueue',
              Arn: util.importValue(
                util.join('-', [WharfieDeployment, 's3-event-queue'])
              ),
            },
          ],
        },
      },
    };
  }
};
