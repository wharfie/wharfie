'use strict';

const { parse } = require('@sandfox/arn');
const { version } = require('../../../../package.json');

/**
 * @typedef CloudformationTemplate
 * @property {string} AWSTemplateFormatVersion -
 * @property {any} Metadata -
 * @property {any} Parameters -
 * @property {any} Mappings -
 * @property {any} Resources -
 * @property {any} Outputs -
 * @param {import('../../../typedefs').CloudformationEvent} event -
 * @returns {CloudformationTemplate} -
 */
function WharfieUDF(event) {
  const {
    LogicalResourceId,
    StackId,
    ResourceProperties: {
      Tags,
      Handler,
      Code: { S3Bucket, S3Key, S3ObjectVersion },
    },
  } = event;
  const originalStack = parse(StackId).resource.split('/')[1];

  const Metadata = {
    WharfieVersion: version,
    ParentStack: originalStack,
    LogicalResourceId,
  };

  const template = {
    AWSTemplateFormatVersion: '2010-09-09',
    Metadata,
    Parameters: {},
    Mappings: {},
    Conditions: {},
    Resources: {
      UDFLambda: {
        Type: 'AWS::Lambda::Function',
        Properties: {
          Tags,
          Architectures: ['arm64'],
          Code: {
            S3Bucket,
            S3Key,
            S3ObjectVersion,
          },
          Description: {
            'Fn::Sub': 'Wharfie UDF Lambda in the ${AWS::StackName} stack',
          },
          FunctionName: { 'Fn::Sub': '${AWS::StackName}' },
          Handler: 'udf_entrypoint.handler',
          Layers: [
            {
              'Fn::Sub':
                'arn:${AWS::Partition}:lambda:${AWS::Region}:580247275435:layer:LambdaInsightsExtension-Arm64:2',
            },
          ],
          MemorySize: 256,
          Runtime: 'nodejs18.x',
          Timeout: 20,
          Role: { 'Fn::GetAtt': ['UDFLambdaRole', 'Arn'] },
          Environment: {
            Variables: {
              WHARFIE_UDF_HANDLER: Handler,
              NODE_OPTIONS: '--enable-source-maps',
              AWS_NODEJS_CONNECTION_REUSE_ENABLED: 1,
            },
          },
        },
      },
      UDFLambdaLogs: {
        Type: 'AWS::Logs::LogGroup',
        Properties: {
          LogGroupName: {
            'Fn::Sub': '/aws/lambda/${AWS::StackName}',
          },
          RetentionInDays: 14,
        },
      },
      UDFLambdaLogPolicy: {
        Type: 'AWS::IAM::Policy',
        DependsOn: 'UDFLambdaRole',
        Properties: {
          PolicyName: 'lambda-log-access',
          Roles: [{ Ref: 'UDFLambdaRole' }],
          PolicyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: 'logs:*',
                Resource: { 'Fn::GetAtt': ['UDFLambdaLogs', 'Arn'] },
              },
            ],
          },
        },
      },
      UDFLambdaRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          AssumeRolePolicyDocument: {
            Statement: [
              {
                Effect: 'Allow',
                Action: 'sts:AssumeRole',
                Principal: { Service: 'lambda.amazonaws.com' },
              },
            ],
          },
        },
      },
    },
    Outputs: {},
  };

  return template;
}

module.exports = {
  WharfieUDF,
};
