'use strict';
const util = require('./util');

/**
 *
 * @param {object} options - configuration options
 * @param {string} options.LogicalName - the logical name of the Cloudformation resource
 * @param {string[]} options.InputLocations -
 * @param {string} options.OutputLocations -
 * @param {string} options.WharfieDeployment -
 * @param {any[]} options.AdditionalPolicies -
 * @param {string} options.Condition -
 * @param {string} options.DependsOn -
 */
exports.Role = class Role {
  constructor({
    LogicalName,
    InputLocations = [],
    OutputLocations = [],
    WharfieDeployment,
    AdditionalPolicies = [],
    Condition = undefined,
    DependsOn = undefined,
  } = {}) {
    if (!LogicalName) throw new Error('LogicalName is required');
    if (!WharfieDeployment) throw new Error('WharfieDeployment is required');

    this.Resources = {
      [LogicalName]: {
        Condition,
        DependsOn,
        Type: 'AWS::IAM::Role',
        Properties: {
          AssumeRolePolicyDocument: {
            Statement: [
              {
                Action: 'sts:AssumeRole',
                Effect: 'Allow',
                Principal: {
                  AWS: util.importValue(
                    util.join('-', [WharfieDeployment, 'role'])
                  ),
                },
              },
            ],
            Version: '2012-10-17',
          },
          ManagedPolicyArns: [
            util.importValue(
              util.join('-', [WharfieDeployment, 'base-policy'])
            ),
          ],
          Policies: [
            {
              PolicyName: 'main',
              PolicyDocument: {
                Statement: [
                  {
                    Sid: 'Bucket',
                    Effect: 'Allow',
                    Action: [
                      's3:GetBucketLocation',
                      's3:GetBucketAcl',
                      's3:ListBucket',
                      's3:ListBucketMultipartUploads',
                      's3:AbortMultipartUpload',
                    ],
                    Resource: [
                      ...InputLocations.map((location) =>
                        util.join('', [
                          'arn:',
                          util.ref('AWS::Partition'),
                          ':s3:::',
                          util.select(0, util.split('/', location)),
                        ])
                      ),
                      ...OutputLocations.map((location) =>
                        util.join('', [
                          'arn:',
                          util.ref('AWS::Partition'),
                          ':s3:::',
                          util.select(0, util.split('/', location)),
                        ])
                      ),
                    ],
                  },
                  {
                    Sid: 'OutputWrite',
                    Effect: 'Allow',
                    Action: ['s3:*'],
                    Resource: [
                      ...OutputLocations.map((location) =>
                        util.join('', [
                          'arn:',
                          util.ref('AWS::Partition'),
                          ':s3:::',
                          location,
                          '*',
                        ])
                      ),
                    ],
                  },
                  {
                    Sid: 'InputRead',
                    Effect: 'Allow',
                    Action: ['s3:GetObject'],
                    Resource: [
                      ...InputLocations.map((location) =>
                        util.join('', [
                          'arn:',
                          util.ref('AWS::Partition'),
                          ':s3:::',
                          location,
                          '*',
                        ])
                      ),
                    ],
                  },
                  ...AdditionalPolicies,
                ],
              },
            },
          ],
        },
      },
    };
  }
};
