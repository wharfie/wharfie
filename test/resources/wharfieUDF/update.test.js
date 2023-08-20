/* eslint-disable jest/no-hooks */
'use strict';

let lambda;

const AWSCloudFormation = require('@aws-sdk/client-cloudformation');
const AWSS3 = require('@aws-sdk/client-s3');
const update_event = require('../../fixtures/wharfieUDF-update.json');

const nock = require('nock');

process.env.WHARFIE_ARTIFACT_BUCKET = 'template-bucket';
process.env.AWS_REGION = 'us-east-1';

jest.useFakeTimers();
// eslint-disable-next-line jest/no-untyped-mock-factory
jest.mock('../../../package.json', () => ({ version: '0.0.1' }));

const mockMath = Object.create(global.Math);
mockMath.random = () => 0.5;
global.Math = mockMath;

describe('tests for wharfieUDF resource update handler', () => {
  beforeAll(() => {
    require('aws-sdk-client-mock-jest');
  });
  beforeEach(() => {
    AWSS3.S3Mock.on(AWSS3.PutObjectCommand).resolves({});
    lambda = require('../../../lambdas/bootstrap');
  });

  afterEach(() => {
    AWSS3.S3Mock.reset();
    AWSCloudFormation.CloudFormationMock.reset();
    nock.cleanAll();
  });

  it('handle no update error', async () => {
    expect.assertions(4);

    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.UpdateStackCommand
    ).resolves({
      StackId: 'stack_id',
    });
    const waitUntilStackUpdateComplete = jest
      .spyOn(AWSCloudFormation, 'waitUntilStackUpdateComplete')
      .mockResolvedValue({});
    nock(
      'https://cloudformation-custom-resource-response-useast1.s3.amazonaws.com'
    )
      .filteringPath(() => {
        return '/';
      })
      .put('/')
      .reply(200, (uri, body) => {
        expect(body).toMatchInlineSnapshot(
          `"{\\"Status\\":\\"SUCCESS\\",\\"StackId\\":\\"arn:aws:cloudformation:us-east-1:123456789012:stack/wharfie-staging/3a62f040-5743-11eb-b528-0ebb325b25bf\\",\\"RequestId\\":\\"6bb77cd5-bbcc-40d0-9902-66ac98eb4817\\",\\"LogicalResourceId\\":\\"StackMappings\\",\\"PhysicalResourceId\\":\\"260ca406900a3f747e42cd69c3591fd9\\",\\"Data\\":{},\\"NoEcho\\":false}"`
        );
        return '';
      });
    await lambda.handler(update_event);
    expect(AWSS3.S3Mock.commandCalls(AWSS3.PutObjectCommand)[0].args[0].input)
      .toMatchInlineSnapshot(`
      Object {
        "Body": "{\\"AWSTemplateFormatVersion\\":\\"2010-09-09\\",\\"Metadata\\":{\\"WharfieVersion\\":\\"0.0.1\\",\\"ParentStack\\":\\"wharfie-staging\\",\\"LogicalResourceId\\":\\"StackMappings\\"},\\"Parameters\\":{},\\"Mappings\\":{},\\"Conditions\\":{},\\"Resources\\":{\\"UDFLambda\\":{\\"Type\\":\\"AWS::Lambda::Function\\",\\"Properties\\":{\\"Tags\\":[{\\"Value\\":\\"wharfie-staging\\",\\"Key\\":\\"CloudFormationStackName\\"}],\\"Architectures\\":[\\"arm64\\"],\\"Code\\":{\\"S3Bucket\\":\\"wharfie\\",\\"S3Key\\":\\"stack-mappings/staging/wharfie.zip\\"},\\"Description\\":{\\"Fn::Sub\\":\\"Wharfie UDF Lambda in the \${AWS::StackName} stack\\"},\\"FunctionName\\":{\\"Fn::Sub\\":\\"\${AWS::StackName}\\"},\\"Handler\\":\\"udf_entrypoint.handler\\",\\"Layers\\":[{\\"Fn::Sub\\":\\"arn:\${AWS::Partition}:lambda:\${AWS::Region}:580247275435:layer:LambdaInsightsExtension-Arm64:2\\"}],\\"MemorySize\\":256,\\"Runtime\\":\\"nodejs18.x\\",\\"Timeout\\":20,\\"Role\\":{\\"Fn::GetAtt\\":[\\"UDFLambdaRole\\",\\"Arn\\"]},\\"Environment\\":{\\"Variables\\":{\\"WHARFIE_UDF_HANDLER\\":\\"index.handler\\",\\"NODE_OPTIONS\\":\\"--enable-source-maps\\",\\"AWS_NODEJS_CONNECTION_REUSE_ENABLED\\":1}}}},\\"UDFLambdaLogs\\":{\\"Type\\":\\"AWS::Logs::LogGroup\\",\\"Properties\\":{\\"LogGroupName\\":{\\"Fn::Sub\\":\\"/aws/lambda/\${AWS::StackName}\\"},\\"RetentionInDays\\":14}},\\"UDFLambdaLogPolicy\\":{\\"Type\\":\\"AWS::IAM::Policy\\",\\"DependsOn\\":\\"UDFLambdaRole\\",\\"Properties\\":{\\"PolicyName\\":\\"lambda-log-access\\",\\"Roles\\":[{\\"Ref\\":\\"UDFLambdaRole\\"}],\\"PolicyDocument\\":{\\"Version\\":\\"2012-10-17\\",\\"Statement\\":[{\\"Effect\\":\\"Allow\\",\\"Action\\":\\"logs:*\\",\\"Resource\\":{\\"Fn::GetAtt\\":[\\"UDFLambdaLogs\\",\\"Arn\\"]}}]}}},\\"UDFLambdaRole\\":{\\"Type\\":\\"AWS::IAM::Role\\",\\"Properties\\":{\\"AssumeRolePolicyDocument\\":{\\"Statement\\":[{\\"Effect\\":\\"Allow\\",\\"Action\\":\\"sts:AssumeRole\\",\\"Principal\\":{\\"Service\\":\\"lambda.amazonaws.com\\"}}]}}}},\\"Outputs\\":{}}",
        "Bucket": "template-bucket",
        "Key": "wharfie-templates/WharfieUDF-260ca406900a3f747e42cd69c3591fd9-i.json",
      }
    `);
    expect(
      AWSCloudFormation.CloudFormationMock.commandCalls(
        AWSCloudFormation.UpdateStackCommand
      )[0].args[0].input
    ).toMatchInlineSnapshot(`
      Object {
        "Capabilities": Array [
          "CAPABILITY_IAM",
        ],
        "StackName": "WharfieUDF-260ca406900a3f747e42cd69c3591fd9",
        "Tags": Array [
          Object {
            "Key": "CloudFormationStackName",
            "Value": "wharfie-staging",
          },
        ],
        "TemplateURL": "https://template-bucket.s3.amazonaws.com/wharfie-templates/WharfieUDF-260ca406900a3f747e42cd69c3591fd9-i.json",
      }
    `);
    expect(waitUntilStackUpdateComplete).toHaveBeenCalledWith(
      {
        client: expect.anything(),
        maxWaitTime: 600,
      },
      {
        StackName: 'stack_id',
      }
    );
  });

  it('handle failure', async () => {
    expect.assertions(3);

    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.UpdateStackCommand
    ).resolves({
      StackId: 'stack_id',
    });
    const waitUntilStackUpdateComplete = jest
      .spyOn(AWSCloudFormation, 'waitUntilStackUpdateComplete')
      .mockRejectedValue(new Error());

    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.DescribeStackEventsCommand
    ).resolves({
      StackEvents: [
        {
          ResourceStatus: 'UPDATE_FAILED',
          ResourceStatusReason: 'some error occured',
        },
      ],
    });
    nock(
      'https://cloudformation-custom-resource-response-useast1.s3.amazonaws.com'
    )
      .filteringPath(() => {
        return '/';
      })
      .put('/')
      .reply(200, (uri, body) => {
        expect(body).toMatchInlineSnapshot(
          `"{\\"Status\\":\\"FAILED\\",\\"StackId\\":\\"arn:aws:cloudformation:us-east-1:123456789012:stack/wharfie-staging/3a62f040-5743-11eb-b528-0ebb325b25bf\\",\\"RequestId\\":\\"6bb77cd5-bbcc-40d0-9902-66ac98eb4817\\",\\"LogicalResourceId\\":\\"StackMappings\\",\\"PhysicalResourceId\\":\\"260ca406900a3f747e42cd69c3591fd9\\",\\"Data\\":{},\\"NoEcho\\":false,\\"Reason\\":\\"Error: some error occured\\"}"`
        );
        return '';
      });
    await lambda.handler(update_event);

    expect(AWSCloudFormation.CloudFormationMock).toHaveReceivedCommandTimes(
      AWSCloudFormation.DescribeStackEventsCommand,
      1
    );
    expect(waitUntilStackUpdateComplete).toHaveBeenCalledTimes(2);
  });

  it('basic', async () => {
    expect.assertions(4);

    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.UpdateStackCommand
    ).resolves({
      StackId: 'stack_id',
    });
    const waitUntilStackUpdateComplete = jest
      .spyOn(AWSCloudFormation, 'waitUntilStackUpdateComplete')
      .mockResolvedValue({});
    update_event.OldResourceProperties.Tags[0].Value = 'wharfie-testing';
    nock(
      'https://cloudformation-custom-resource-response-useast1.s3.amazonaws.com'
    )
      .filteringPath(() => {
        return '/';
      })
      .put('/')
      .reply(200, (uri, body) => {
        expect(body).toMatchInlineSnapshot(
          `"{\\"Status\\":\\"SUCCESS\\",\\"StackId\\":\\"arn:aws:cloudformation:us-east-1:123456789012:stack/wharfie-staging/3a62f040-5743-11eb-b528-0ebb325b25bf\\",\\"RequestId\\":\\"6bb77cd5-bbcc-40d0-9902-66ac98eb4817\\",\\"LogicalResourceId\\":\\"StackMappings\\",\\"PhysicalResourceId\\":\\"260ca406900a3f747e42cd69c3591fd9\\",\\"Data\\":{},\\"NoEcho\\":false}"`
        );
        return '';
      });
    await lambda.handler(update_event);

    // eslint-disable-next-line jest/no-large-snapshots
    expect(AWSS3.S3Mock.commandCalls(AWSS3.PutObjectCommand)[0].args[0].input)
      .toMatchInlineSnapshot(`
      Object {
        "Body": "{\\"AWSTemplateFormatVersion\\":\\"2010-09-09\\",\\"Metadata\\":{\\"WharfieVersion\\":\\"0.0.1\\",\\"ParentStack\\":\\"wharfie-staging\\",\\"LogicalResourceId\\":\\"StackMappings\\"},\\"Parameters\\":{},\\"Mappings\\":{},\\"Conditions\\":{},\\"Resources\\":{\\"UDFLambda\\":{\\"Type\\":\\"AWS::Lambda::Function\\",\\"Properties\\":{\\"Tags\\":[{\\"Value\\":\\"wharfie-staging\\",\\"Key\\":\\"CloudFormationStackName\\"}],\\"Architectures\\":[\\"arm64\\"],\\"Code\\":{\\"S3Bucket\\":\\"wharfie\\",\\"S3Key\\":\\"stack-mappings/staging/wharfie.zip\\"},\\"Description\\":{\\"Fn::Sub\\":\\"Wharfie UDF Lambda in the \${AWS::StackName} stack\\"},\\"FunctionName\\":{\\"Fn::Sub\\":\\"\${AWS::StackName}\\"},\\"Handler\\":\\"udf_entrypoint.handler\\",\\"Layers\\":[{\\"Fn::Sub\\":\\"arn:\${AWS::Partition}:lambda:\${AWS::Region}:580247275435:layer:LambdaInsightsExtension-Arm64:2\\"}],\\"MemorySize\\":256,\\"Runtime\\":\\"nodejs18.x\\",\\"Timeout\\":20,\\"Role\\":{\\"Fn::GetAtt\\":[\\"UDFLambdaRole\\",\\"Arn\\"]},\\"Environment\\":{\\"Variables\\":{\\"WHARFIE_UDF_HANDLER\\":\\"index.handler\\",\\"NODE_OPTIONS\\":\\"--enable-source-maps\\",\\"AWS_NODEJS_CONNECTION_REUSE_ENABLED\\":1}}}},\\"UDFLambdaLogs\\":{\\"Type\\":\\"AWS::Logs::LogGroup\\",\\"Properties\\":{\\"LogGroupName\\":{\\"Fn::Sub\\":\\"/aws/lambda/\${AWS::StackName}\\"},\\"RetentionInDays\\":14}},\\"UDFLambdaLogPolicy\\":{\\"Type\\":\\"AWS::IAM::Policy\\",\\"DependsOn\\":\\"UDFLambdaRole\\",\\"Properties\\":{\\"PolicyName\\":\\"lambda-log-access\\",\\"Roles\\":[{\\"Ref\\":\\"UDFLambdaRole\\"}],\\"PolicyDocument\\":{\\"Version\\":\\"2012-10-17\\",\\"Statement\\":[{\\"Effect\\":\\"Allow\\",\\"Action\\":\\"logs:*\\",\\"Resource\\":{\\"Fn::GetAtt\\":[\\"UDFLambdaLogs\\",\\"Arn\\"]}}]}}},\\"UDFLambdaRole\\":{\\"Type\\":\\"AWS::IAM::Role\\",\\"Properties\\":{\\"AssumeRolePolicyDocument\\":{\\"Statement\\":[{\\"Effect\\":\\"Allow\\",\\"Action\\":\\"sts:AssumeRole\\",\\"Principal\\":{\\"Service\\":\\"lambda.amazonaws.com\\"}}]}}}},\\"Outputs\\":{}}",
        "Bucket": "template-bucket",
        "Key": "wharfie-templates/WharfieUDF-260ca406900a3f747e42cd69c3591fd9-i.json",
      }
    `);
    expect(
      AWSCloudFormation.CloudFormationMock.commandCalls(
        AWSCloudFormation.UpdateStackCommand
      )[0].args[0].input
    ).toMatchInlineSnapshot(`
      Object {
        "Capabilities": Array [
          "CAPABILITY_IAM",
        ],
        "StackName": "WharfieUDF-260ca406900a3f747e42cd69c3591fd9",
        "Tags": Array [
          Object {
            "Key": "CloudFormationStackName",
            "Value": "wharfie-staging",
          },
        ],
        "TemplateURL": "https://template-bucket.s3.amazonaws.com/wharfie-templates/WharfieUDF-260ca406900a3f747e42cd69c3591fd9-i.json",
      }
    `);
    expect(waitUntilStackUpdateComplete).toHaveBeenCalledWith(
      {
        client: expect.anything(),
        maxWaitTime: 600,
      },
      {
        StackName: 'stack_id',
      }
    );
  });
});
