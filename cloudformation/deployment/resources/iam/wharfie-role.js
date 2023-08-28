'use strict';

const wharfie = require('../../../../client');

const Outputs = {
  Role: {
    Value: wharfie.util.getAtt('WharfieRole', 'Arn'),
    Export: { Name: wharfie.util.sub('${AWS::StackName}-role') },
  },
  Policy: {
    Value: wharfie.util.ref('WharfieManagedPolicy'),
    Export: { Name: wharfie.util.sub('${AWS::StackName}-base-policy') },
  },
};

const Resources = {
  WharfieManagedPolicy: {
    Type: 'AWS::IAM::ManagedPolicy',
    Properties: {
      PolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['athena:*'],
            Resource: [
              wharfie.util.sub(
                'arn:${AWS::Partition}:athena:${AWS::Region}:${AWS::AccountId}:workgroup/Wharfie*'
              ),
            ],
          },
          {
            Effect: 'Allow',
            Action: [
              'glue:GetDatabase',
              'glue:GetPartitions',
              'glue:GetPartition',
              'glue:BatchCreatePartition',
              'glue:CreatePartition',
              'glue:UpdatePartition',
              'glue:GetTable',
              'glue:UpdateTable',
            ],
            Resource: '*',
          },
        ],
      },
    },
  },
  WharfieUDFManagedPolicy: {
    Type: 'AWS::IAM::ManagedPolicy',
    Properties: {
      PolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'lambda:CreateFunction',
              'lambda:UpdateFunctionConfiguration',
              'lambda:UpdateFunctionCode',
              'lambda:DeleteFunction',
              'lambda:GetFunction',
              'lambda:GetFunctionConfiguration',
            ],
            Resource: wharfie.util.sub(
              'arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:Wharfie*'
            ),
          },
          {
            Effect: 'Allow',
            Action: ['lambda:GetLayerVersion'],
            Resource: wharfie.util.sub(
              'arn:${AWS::Partition}:lambda:${AWS::Region}:580247275435:layer:LambdaInsightsExtension-*'
            ),
          },
          {
            Effect: 'Allow',
            Action: [
              'iam:CreateRole',
              'iam:DeleteRole',
              'iam:AttachRolePolicy',
              'iam:DetachRolePolicy',
              'iam:CreatePolicy',
              'iam:DeletePolicy',
              'iam:GetRole',
              'iam:PutRolePolicy',
              'iam:DeleteRolePolicy',
              'iam:PassRole',
            ],
            Resource: wharfie.util.sub(
              'arn:${AWS::Partition}:iam::${AWS::AccountId}:role/WharfieUDF*'
            ),
          },
          {
            Effect: 'Allow',
            Action: [
              'logs:CreateLogGroup',
              'logs:DeleteLogGroup',
              'logs:DescribeLogGroups',
              'logs:PutRetentionPolicy',
              'logs:DeleteRetentionPolicy',
            ],
            Resource: [
              wharfie.util.sub(
                'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/WharfieUDF*'
              ),
              wharfie.util.sub(
                'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/WharfieUDF*:log-stream:*'
              ),
            ],
          },
          {
            Effect: 'Allow',
            Action: ['logs:DescribeLogGroups'],
            Resource: '*',
          },
          {
            Sid: 'OutputWrite',
            Effect: 'Allow',
            Action: ['s3:GetObject'],
            Resource: [
              wharfie.util.sub(
                'arn:${AWS::Partition}:s3:::wharfie-artifacts-${AWS::Region}/wharfie/*'
              ),
              wharfie.util.sub(
                'arn:${AWS::Partition}:s3:::${ArtifactBucket}/wharfie/*'
              ),
            ],
          },
          {
            Sid: 'Bucket',
            Effect: 'Allow',
            Action: ['s3:ListBucket'],
            Resource: [
              wharfie.util.sub(
                'arn:${AWS::Partition}:s3:::wharfie-artifacts-${AWS::Region}'
              ),
              wharfie.util.sub('arn:${AWS::Partition}:s3:::${ArtifactBucket}'),
            ],
          },
        ],
      },
    },
  },
  WharfieRole: {
    Type: 'AWS::IAM::Role',
    Properties: {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Effect: 'Allow',
            Action: 'sts:AssumeRole',
            Principal: {
              Service: 'lambda.amazonaws.com',
            },
          },
        ],
      },
      ManagedPolicyArns: [
        wharfie.util.sub(
          'arn:${AWS::Partition}:iam::aws:policy/CloudWatchLambdaInsightsExecutionRolePolicy'
        ),
        wharfie.util.ref('WharfieUDFManagedPolicy'),
      ],
      Policies: [
        {
          PolicyName: 'main',
          Version: '2012-10-17',
          PolicyDocument: {
            Statement: [
              {
                Effect: 'Allow',
                Action: ['cloudwatch:PutMetricData'],
                Resource: '*',
              },
              {
                Effect: 'Allow',
                Action: 'cloudwatch:*',
                Resource: [
                  wharfie.util.sub(
                    'arn:${AWS::Partition}:cloudwatch::${AWS::AccountId}:dashboard/*'
                  ),
                ],
              },
              {
                Effect: 'Allow',
                Action: 'logs:*',
                Resource: [
                  wharfie.util.getAtt('DaemonLogs', 'Arn'),
                  wharfie.util.getAtt('BootstrapLogs', 'Arn'),
                  wharfie.util.getAtt('MonitorLogs', 'Arn'),
                  wharfie.util.getAtt('CleanupLogs', 'Arn'),
                  wharfie.util.getAtt('EventsLogs', 'Arn'),
                  wharfie.util.sub(
                    'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:Wharfie*'
                  ),
                ],
              },
              {
                Effect: 'Allow',
                Action: [
                  'sqs:DeleteMessage',
                  'sqs:ReceiveMessage',
                  'sqs:GetQueueAttributes',
                  'sqs:SendMessage',
                ],
                Resource: [
                  wharfie.util.getAtt('DaemonQueue', 'Arn'),
                  wharfie.util.sub('${arn}/*', {
                    arn: wharfie.util.getAtt('DaemonQueue', 'Arn'),
                  }),
                  wharfie.util.getAtt('MonitorQueue', 'Arn'),
                  wharfie.util.sub('${arn}/*', {
                    arn: wharfie.util.getAtt('MonitorQueue', 'Arn'),
                  }),
                  wharfie.util.getAtt('DaemonResourceDeadLetterQueue', 'Arn'),
                  wharfie.util.sub('${arn}/*', {
                    arn: wharfie.util.getAtt(
                      'DaemonResourceDeadLetterQueue',
                      'Arn'
                    ),
                  }),
                  wharfie.util.getAtt('DaemonDeadLetterQueue', 'Arn'),
                  wharfie.util.sub('${arn}/*', {
                    arn: wharfie.util.getAtt('DaemonDeadLetterQueue', 'Arn'),
                  }),
                  wharfie.util.getAtt('MonitorResourceDeadLetterQueue', 'Arn'),
                  wharfie.util.sub('${arn}/*', {
                    arn: wharfie.util.getAtt(
                      'MonitorResourceDeadLetterQueue',
                      'Arn'
                    ),
                  }),
                  wharfie.util.getAtt('MonitorDeadLetterQueue', 'Arn'),
                  wharfie.util.sub('${arn}/*', {
                    arn: wharfie.util.getAtt('MonitorDeadLetterQueue', 'Arn'),
                  }),
                  wharfie.util.getAtt('CleanupQueue', 'Arn'),
                  wharfie.util.sub('${arn}/*', {
                    arn: wharfie.util.getAtt('CleanupQueue', 'Arn'),
                  }),
                  wharfie.util.getAtt('CleanupDeadLetterQueue', 'Arn'),
                  wharfie.util.sub('${arn}/*', {
                    arn: wharfie.util.getAtt('CleanupDeadLetterQueue', 'Arn'),
                  }),
                  wharfie.util.getAtt('S3EventQueue', 'Arn'),
                  wharfie.util.sub('${arn}/*', {
                    arn: wharfie.util.getAtt('S3EventQueue', 'Arn'),
                  }),
                  wharfie.util.getAtt('EventsQueue', 'Arn'),
                  wharfie.util.sub('${arn}/*', {
                    arn: wharfie.util.getAtt('EventsQueue', 'Arn'),
                  }),
                  wharfie.util.getAtt('EventsDeadLetterQueue', 'Arn'),
                  wharfie.util.sub('${arn}/*', {
                    arn: wharfie.util.getAtt('EventsDeadLetterQueue', 'Arn'),
                  }),
                ],
              },
              {
                Effect: 'Allow',
                Action: [
                  'dynamodb:PutItem',
                  'dynamodb:Query',
                  'dynamodb:BatchWriteItem',
                  'dynamodb:UpdateItem',
                  'dynamodb:GetItem',
                  'dynamodb:DeleteItem',
                ],
                Resource: [
                  wharfie.util.getAtt('SemaphoreTable', 'Arn'),
                  wharfie.util.getAtt('ResourceTable', 'Arn'),
                  wharfie.util.getAtt('LocationTable', 'Arn'),
                  wharfie.util.getAtt('EventTable', 'Arn'),
                ],
              },
              {
                Effect: 'Allow',
                Action: ['cloudformation:*'],
                Resource: [
                  wharfie.util.sub(
                    'arn:${AWS::Partition}:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/Wharfie*'
                  ),
                ],
              },
              {
                Effect: 'Allow',
                Action: ['events:*'],
                Resource: [
                  wharfie.util.sub(
                    'arn:${AWS::Partition}:events:${AWS::Region}:${AWS::AccountId}:rule/Wharfie*'
                  ),
                ],
              },
              {
                Effect: 'Allow',
                Action: ['iam:PassRole'],
                Resource: [wharfie.util.getAtt('DaemonEventRole', 'Arn')],
              },
              {
                Effect: 'Allow',
                Action: [
                  'glue:GetPartitions',
                  'glue:GetPartition',
                  'glue:UpdatePartition',
                  'glue:CreatePartition',
                  'glue:BatchCreatePartition',
                  'glue:BatchDeletePartition',
                  'glue:CreateTable',
                  'glue:UpdateTable',
                  'glue:DeleteTable',
                  'glue:GetTable',
                  'glue:GetTables',
                ],
                Resource: '*',
              },
              {
                Sid: 'Bucket',
                Effect: 'Allow',
                Action: [
                  's3:GetBucketLocation',
                  's3:ListBucket',
                  's3:ListBucketMultipartUploads',
                  's3:AbortMultipartUpload',
                ],
                Resource: [
                  wharfie.util.sub(
                    'arn:${AWS::Partition}:s3:::${ArtifactBucket}'
                  ),
                ],
              },
              {
                Sid: 'OutputWrite',
                Effect: 'Allow',
                Action: [
                  's3:GetObject',
                  's3:PutObject',
                  's3:ListMultipartUploadParts',
                  's3:AbortMultipartUpload',
                ],
                Resource: [
                  wharfie.util.sub(
                    'arn:${AWS::Partition}:s3:::${ArtifactBucket}/wharfie-templates/*'
                  ),
                ],
              },
              {
                Sid: 'Logging',
                Effect: 'Allow',
                Action: ['s3:GetObject', 's3:PutObject'],
                Resource: [
                  wharfie.util.sub(
                    'arn:${AWS::Partition}:s3:::${ArtifactBucket}/${AWS::StackName}/*'
                  ),
                ],
              },
              {
                Effect: 'Allow',
                Action: ['athena:GetQueryExecution'],
                Resource: '*',
              },
              {
                Effect: 'Allow',
                Action: ['athena:*'],
                Resource: [
                  wharfie.util.sub(
                    'arn:${AWS::Partition}:athena:${AWS::Region}:${AWS::AccountId}:workgroup/Wharfie*'
                  ),
                ],
              },
            ],
          },
        },
      ],
    },
  },
};

module.exports = wharfie.util.merge({ Resources, Outputs });
