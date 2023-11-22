/* eslint-disable jest/no-hooks */
'use strict';

let lambda;

const AWSCloudFormation = require('@aws-sdk/client-cloudformation');
const AWSS3 = require('@aws-sdk/client-s3');
const create_event = require('../../fixtures/wharfieUDF-create.json');

const nock = require('nock');

process.env.WHARFIE_SERVICE_BUCKET = 'service-bucket';
process.env.WHARFIE_ARTIFACT_BUCKET = 'service-bucket';
process.env.AWS_REGION = 'us-east-1';

jest.useFakeTimers();
// eslint-disable-next-line jest/no-untyped-mock-factory
jest.mock('../../../package.json', () => ({ version: '0.0.1' }));

const mockMath = Object.create(global.Math);
mockMath.random = () => 0.5;
global.Math = mockMath;

describe('tests for wharfieUDF resource create handler', () => {
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

  it('basic', async () => {
    expect.assertions(4);
    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.CreateStackCommand
    ).resolves({});

    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.DescribeStacksCommand
    ).resolves({
      Stacks: [
        {
          StackStatus: 'CREATE_COMPLETE',
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
          `"{\\"Status\\":\\"SUCCESS\\",\\"StackId\\":\\"arn:aws:cloudformation:us-east-1:123456789012:stack/wharfie-staging-stack-mappings/f59e6e30-1fe7-11ec-a665-1240661c4205\\",\\"RequestId\\":\\"1065fa64-f86e-4894-a6a9-7faa2a2515c6\\",\\"LogicalResourceId\\":\\"StackMappings\\",\\"PhysicalResourceId\\":\\"6afd22c8fb977fe4b9df55ed495499f3\\",\\"Data\\":{},\\"NoEcho\\":false}"`
        );
        return '';
      });
    await lambda.handler(create_event);

    expect(AWSS3.S3Mock.commandCalls(AWSS3.PutObjectCommand)[0].args[0].input)
      .toMatchInlineSnapshot(`
      Object {
        "Body": "{\\"AWSTemplateFormatVersion\\":\\"2010-09-09\\",\\"Metadata\\":{\\"WharfieVersion\\":\\"0.0.1\\",\\"ParentStack\\":\\"wharfie-staging-stack-mappings\\",\\"LogicalResourceId\\":\\"StackMappings\\"},\\"Parameters\\":{},\\"Mappings\\":{},\\"Conditions\\":{},\\"Resources\\":{\\"UDFLambda\\":{\\"Type\\":\\"AWS::Lambda::Function\\",\\"Properties\\":{\\"Tags\\":[{\\"Value\\":\\"wharfie-staging-stack-mappings\\",\\"Key\\":\\"CloudFormationStackName\\"}],\\"Architectures\\":[\\"arm64\\"],\\"Code\\":{\\"S3Bucket\\":\\"wharfie\\",\\"S3Key\\":\\"stack-mappings/staging/wharfie.zip\\"},\\"Description\\":{\\"Fn::Sub\\":\\"Wharfie UDF Lambda in the \${AWS::StackName} stack\\"},\\"FunctionName\\":{\\"Fn::Sub\\":\\"\${AWS::StackName}\\"},\\"Handler\\":\\"udf_entrypoint.handler\\",\\"Layers\\":[{\\"Fn::Sub\\":\\"arn:\${AWS::Partition}:lambda:\${AWS::Region}:580247275435:layer:LambdaInsightsExtension-Arm64:2\\"}],\\"MemorySize\\":256,\\"Runtime\\":\\"nodejs18.x\\",\\"Timeout\\":20,\\"Role\\":{\\"Fn::GetAtt\\":[\\"UDFLambdaRole\\",\\"Arn\\"]},\\"Environment\\":{\\"Variables\\":{\\"WHARFIE_UDF_HANDLER\\":\\"index.handler\\",\\"NODE_OPTIONS\\":\\"--enable-source-maps\\",\\"AWS_NODEJS_CONNECTION_REUSE_ENABLED\\":1}}}},\\"UDFLambdaLogs\\":{\\"Type\\":\\"AWS::Logs::LogGroup\\",\\"Properties\\":{\\"LogGroupName\\":{\\"Fn::Sub\\":\\"/aws/lambda/\${AWS::StackName}\\"},\\"RetentionInDays\\":14}},\\"UDFLambdaLogPolicy\\":{\\"Type\\":\\"AWS::IAM::Policy\\",\\"DependsOn\\":\\"UDFLambdaRole\\",\\"Properties\\":{\\"PolicyName\\":\\"lambda-log-access\\",\\"Roles\\":[{\\"Ref\\":\\"UDFLambdaRole\\"}],\\"PolicyDocument\\":{\\"Version\\":\\"2012-10-17\\",\\"Statement\\":[{\\"Effect\\":\\"Allow\\",\\"Action\\":\\"logs:*\\",\\"Resource\\":{\\"Fn::GetAtt\\":[\\"UDFLambdaLogs\\",\\"Arn\\"]}}]}}},\\"UDFLambdaRole\\":{\\"Type\\":\\"AWS::IAM::Role\\",\\"Properties\\":{\\"AssumeRolePolicyDocument\\":{\\"Statement\\":[{\\"Effect\\":\\"Allow\\",\\"Action\\":\\"sts:AssumeRole\\",\\"Principal\\":{\\"Service\\":\\"lambda.amazonaws.com\\"}}]}}}},\\"Outputs\\":{}}",
        "Bucket": "service-bucket",
        "Key": "wharfie-templates/WharfieUDF-6afd22c8fb977fe4b9df55ed495499f3-i.json",
      }
    `);

    expect(
      AWSCloudFormation.CloudFormationMock.commandCalls(
        AWSCloudFormation.CreateStackCommand
      )[0].args[0].input
    ).toMatchInlineSnapshot(`
      Object {
        "Capabilities": Array [
          "CAPABILITY_IAM",
        ],
        "StackName": "WharfieUDF-6afd22c8fb977fe4b9df55ed495499f3",
        "Tags": Array [
          Object {
            "Key": "CloudFormationStackName",
            "Value": "wharfie-staging-stack-mappings",
          },
        ],
        "TemplateURL": "https://service-bucket.s3.amazonaws.com/wharfie-templates/WharfieUDF-6afd22c8fb977fe4b9df55ed495499f3-i.json",
      }
    `);
    expect(AWSCloudFormation.CloudFormationMock).toHaveReceivedCommandTimes(
      AWSCloudFormation.DescribeStacksCommand,
      1
    );
  });
});
