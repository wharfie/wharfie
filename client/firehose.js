'use strict';
const util = require('./util');

/**
 *
 * @param {object} options - configuration options
 * @param {string} options.LogicalName - the logical name of the Cloudformation resource
 * @param {string} options.DatabaseName -
 * @param {string} options.TableName -
 * @param {object[]} options.Columns -
 * @param {string} options.DestinationBucket -
 * @param {string} options.DestinationPrefix -
 * @param {string} options.Description -
 * @param {boolean} options.FirehoseLoggingEnabled -
 * @param {object} options.Backfill -
 * @param {object[]} options.AlarmActions -
 * @param {string} options.SourceStreamARN -
 * @param {number} options.BufferInterval -
 * @param {number} options.BufferMBs -
 * @param {string} options.CatalogId -
 * @param {string} options.WharfieEnvironment -
 * @param {string} options.Condition -
 * @param {string} options.DependsOn -
 */
exports.Firehose = class Firehose {
  constructor({
    LogicalName,
    DatabaseName,
    TableName,
    Columns,
    DestinationBucket,
    DestinationPrefix = '',
    Description = undefined,
    FirehoseLoggingEnabled = false,
    Backfill = undefined,
    AlarmActions = undefined,
    SourceStreamARN = undefined,
    BufferInterval = 900,
    BufferMBs = 128,
    CatalogId = util.accountId,
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
              util.join('-', ['Wharfie', util.ref(LogicalName)]),
              ''
            )
          : util.join('-', ['Wharfie', util.ref(LogicalName)]),
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
          CompactedConfig: {
            Location: util.join('', [
              's3://',
              DestinationBucket,
              '/',
              DestinationPrefix,
              'processed/',
            ]),
          },
          DaemonConfig: {
            Privileged: true,
            Role: util.getAtt(`${LogicalName}WharfieRole`, 'Arn'),
            SLA: {
              MaxDelay: 60,
              ColumnExpression: `date_parse(concat(year, month, day, hr), '%Y%m%d%H')`,
            },
            AlarmActions,
          },
          Backfill,
          TableInput: {
            Name: TableName,
            Description,
            TableType: 'EXTERNAL_TABLE',
            Parameters: { EXTERNAL: 'true' },
            PartitionKeys: [
              { Name: 'year', Type: 'string' },
              { Name: 'month', Type: 'string' },
              { Name: 'day', Type: 'string' },
              { Name: 'hr', Type: 'string' },
            ],
            StorageDescriptor: {
              Location: util.join('', [
                's3://',
                DestinationBucket,
                '/',
                DestinationPrefix,
                'raw/',
              ]),
              Columns,
              InputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
              OutputFormat:
                'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
              SerdeInfo: {
                SerializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
                Parameters: { 'ignore.malformed.json': 'true' },
              },
            },
          },
        },
      },
      [`${LogicalName}Firehose`]: !SourceStreamARN
        ? {
            Type: 'AWS::KinesisFirehose::DeliveryStream',
            Condition,
            DependsOn,
            Properties: {
              DeliveryStreamName: util.sub(
                `$\{AWS::StackName}_${LogicalName}Firehose`
              ),
              DeliveryStreamType: 'DirectPut',
              S3DestinationConfiguration: {
                BucketARN: util.join('', [
                  'arn:',
                  util.ref('AWS::Partition'),
                  ':s3:::',
                  DestinationBucket,
                ]),
                Prefix: util.join('', [DestinationPrefix, 'raw/']),
                BufferingHints: {
                  IntervalInSeconds: BufferInterval,
                  SizeInMBs: BufferMBs,
                },
                CloudWatchLoggingOptions: {
                  Enabled: FirehoseLoggingEnabled,
                  LogGroupName: util.ref(`${LogicalName}LogGroup`),
                  LogStreamName: 'firehose',
                },
                CompressionFormat: 'GZIP',
                RoleARN: util.join('', [
                  'arn:',
                  util.ref('AWS::Partition'),
                  ':iam::',
                  util.ref('AWS::AccountId'),
                  ':role/',
                  util.ref(`${LogicalName}FirehoseRole`),
                ]),
              },
            },
          }
        : {
            Type: 'AWS::KinesisFirehose::DeliveryStream',
            Condition,
            DependsOn,
            Properties: {
              DeliveryStreamName: util.sub(
                `$\{AWS::StackName}_${LogicalName}Firehose`
              ),
              DeliveryStreamType: 'KinesisStreamAsSource',
              KinesisStreamSourceConfiguration: {
                KinesisStreamARN: SourceStreamARN,
                RoleARN: util.join('', [
                  'arn:',
                  util.ref('AWS::Partition'),
                  ':iam::',
                  util.ref('AWS::AccountId'),
                  ':role/',
                  util.ref(`${LogicalName}SourceStreamAccessRole`),
                ]),
              },
              S3DestinationConfiguration: {
                BucketARN: util.join('', [
                  'arn:',
                  util.ref('AWS::Partition'),
                  ':s3:::',
                  DestinationBucket,
                ]),
                Prefix: util.join('', [DestinationPrefix, 'raw/']),
                BufferingHints: {
                  IntervalInSeconds: BufferInterval,
                  SizeInMBs: BufferMBs,
                },
                CloudWatchLoggingOptions: {
                  Enabled: FirehoseLoggingEnabled,
                  LogGroupName: util.ref(`${LogicalName}LogGroup`),
                  LogStreamName: 'firehose',
                },
                CompressionFormat: 'GZIP',
                RoleARN: util.join('', [
                  'arn:',
                  util.ref('AWS::Partition'),
                  ':iam::',
                  util.ref('AWS::AccountId'),
                  ':role/',
                  util.ref(`${LogicalName}FirehoseRole`),
                ]),
              },
            },
          },
      [`${LogicalName}FirehoseRole`]: {
        Type: 'AWS::IAM::Role',
        Condition,
        DependsOn,
        Properties: {
          AssumeRolePolicyDocument: {
            Statement: [
              {
                Effect: 'Allow',
                Principal: { Service: ['firehose.amazonaws.com'] },
                Action: ['sts:AssumeRole'],
              },
            ],
          },
          Path: '/',
          Policies: [
            {
              PolicyName: 'ecs-service',
              PolicyDocument: {
                Statement: [
                  {
                    Effect: 'Allow',
                    Action: ['s3:PutObject', 's3:GetObject'],
                    Resource: util.join('', [
                      'arn:',
                      util.ref('AWS::Partition'),
                      ':s3:::',
                      DestinationBucket,
                      '/',
                      DestinationPrefix,
                      'raw/*',
                    ]),
                  },
                  {
                    Effect: 'Allow',
                    Action: [
                      's3:AbortMultipartUpload',
                      's3:GetBucketLocation',
                      's3:ListBucket',
                      's3:ListBucketMultipartUploads',
                    ],
                    Resource: util.join('', [
                      'arn:',
                      util.ref('AWS::Partition'),
                      ':s3:::',
                      DestinationBucket,
                    ]),
                  },
                  {
                    Effect: 'Allow',
                    Action: ['logs:*'],
                    Resource: util.join('', [
                      'arn:',
                      util.ref('AWS::Partition'),
                      ':logs:::log-group:',
                      util.ref(`${LogicalName}LogGroup`),
                      ':log-stream:',
                      'firehose',
                    ]),
                  },
                ],
              },
            },
          ],
        },
      },
      [`${LogicalName}WharfieRole`]: {
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
                      util.join('', [
                        'arn:',
                        util.ref('AWS::Partition'),
                        ':s3:::',
                        DestinationBucket,
                      ]),
                    ],
                  },
                  {
                    Sid: 'OutputWrite',
                    Effect: 'Allow',
                    Action: ['s3:*'],
                    Resource: [
                      util.join('', [
                        'arn:',
                        util.ref('AWS::Partition'),
                        ':s3:::',
                        DestinationBucket,
                        '/',
                        DestinationPrefix,
                        'processed/*',
                      ]),
                    ],
                  },
                  {
                    Sid: 'InputRead',
                    Effect: 'Allow',
                    Action: ['s3:GetObject'],
                    Resource: [
                      util.join('', [
                        'arn:',
                        util.ref('AWS::Partition'),
                        ':s3:::',
                        DestinationBucket,
                        '/',
                        DestinationPrefix,
                        'raw/*',
                      ]),
                    ],
                  },
                ],
              },
            },
          ],
        },
      },
      ...(SourceStreamARN && {
        [`${LogicalName}SourceStreamAccessRole`]: {
          Condition,
          DependsOn,
          Type: 'AWS::IAM::Role',
          Properties: {
            AssumeRolePolicyDocument: {
              Statement: [
                {
                  Effect: 'Allow',
                  Principal: { Service: ['firehose.amazonaws.com'] },
                  Action: ['sts:AssumeRole'],
                },
              ],
            },
            Path: '/',
            Policies: [
              {
                PolicyName: 'kinesis-stream',
                PolicyDocument: {
                  Statement: [
                    {
                      Effect: 'Allow',
                      Action: ['kinesis:DescribeStream', 'kinesis:Get*'],
                      Resource: SourceStreamARN,
                    },
                  ],
                },
              },
            ],
          },
        },
      }),
      [`${LogicalName}LogGroup`]: {
        Condition,
        DependsOn,
        Type: 'AWS::Logs::LogGroup',
        Properties: {
          LogGroupName: util.ref('AWS::StackName'),
          RetentionInDays: 14,
        },
      },
      [`${LogicalName}LogStream`]: {
        Condition,
        DependsOn,
        Type: 'AWS::Logs::LogStream',
        Properties: {
          LogGroupName: util.ref(`${LogicalName}LogGroup`),
          LogStreamName: 'firehose',
        },
      },
    };
  }
};
