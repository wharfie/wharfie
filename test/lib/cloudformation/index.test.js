/* eslint-disable jest/no-hooks */
'use strict';
const AWSCloudformation = require('@aws-sdk/client-cloudformation');
const AWSS3 = require('@aws-sdk/client-s3');
const CloudFormation = require('../../../lambdas/lib/cloudformation/');
const { getImmutableID } = require('../../../lambdas/lib/cloudformation/id');
const response = require('../../../lambdas/lib/cloudformation/cfn-response');
const { EventEmitter } = require('events');
const https = require('https');
const { Readable } = require('stream');

describe('tests for CloudFormation', () => {
  beforeAll(() => {
    require('aws-sdk-client-mock-jest');
  });
  afterEach(() => {
    AWSCloudformation.CloudFormationMock.reset();
    AWSS3.S3Mock.reset();
  });
  it('cfn-response', async () => {
    expect.assertions(1);

    const emitter = new EventEmitter();
    const httpIncomingMessage = {
      on: jest.fn(),
      statusCode: 'mock status code',
      headers: {
        authorization: 'Bearer mocked token',
      },
    };
    const request = jest
      .spyOn(https, 'request')
      .mockImplementation((uri, callback) => {
        if (callback) {
          callback(httpIncomingMessage);
        }
        return emitter;
      });
    await response(
      null,
      {
        StackId: 'id',
        RequestId: 'id',
        LogicalResourceId: 'id',
        ResponseURL:
          'https://cloudformation-custom-resource-response-uswest2.s3-us-west-2.amazonaws.com/arn%3Aaws%3Acloudformation%3Aus-west-2%3A079185815456%3Astack/example-project-4/70987040-2b3a-11ee-9d20-02a0467734b5%7CAmazonBerkeleyObjects%7C21eed148-9aea-4e00-a25e-ac66671e813b?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20230725T222813Z&X-Amz-SignedHeaders=host&X-Amz-Expires=7200&X-Amz-Credential=AKIA54RCMT6SB3PZZFYK%2F20230725%2Fus-west-2%2Fs3%2Faws4_request&X-Amz-Signature=a1fa7446a2e0a92aa54d47b1e90a462a716d4c0af4dab2a01b51be060742c1ba',
      },
      {
        id: 'test',
      }
    );
    expect(request.mock.calls[0]).toMatchInlineSnapshot(`
      [
        {
          "headers": {
            "content-length": 130,
            "content-type": "",
          },
          "hostname": "cloudformation-custom-resource-response-uswest2.s3-us-west-2.amazonaws.com",
          "method": "PUT",
          "path": "/arn%3Aaws%3Acloudformation%3Aus-west-2%3A079185815456%3Astack/example-project-4/70987040-2b3a-11ee-9d20-02a0467734b5%7CAmazonBerkeleyObjects%7C21eed148-9aea-4e00-a25e-ac66671e813b?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20230725T222813Z&X-Amz-SignedHeaders=host&X-Amz-Expires=7200&X-Amz-Credential=AKIA54RCMT6SB3PZZFYK%2F20230725%2Fus-west-2%2Fs3%2Faws4_request&X-Amz-Signature=a1fa7446a2e0a92aa54d47b1e90a462a716d4c0af4dab2a01b51be060742c1ba",
          "port": 443,
        },
        [Function],
      ]
    `);
    request.mockClear();
  });

  it('cfn-response: error', async () => {
    expect.assertions(1);
    const emitter = new EventEmitter();
    const httpIncomingMessage = {
      on: jest.fn(),
      statusCode: 'mock status code',
      headers: {
        authorization: 'Bearer mocked token',
      },
    };
    const request = jest
      .spyOn(https, 'request')
      .mockImplementation((uri, callback) => {
        if (callback) {
          callback(httpIncomingMessage);
        }
        return emitter;
      });
    await response(
      'an error',
      {
        StackId: 'id',
        RequestId: 'id',
        LogicalResourceId: 'id',
        ResponseURL: 'http://www.cloudformation.com',
      },
      {
        id: 'test',
      }
    );
    expect(request.mock.calls[0]).toMatchInlineSnapshot(`
      [
        {
          "headers": {
            "content-length": 149,
            "content-type": "",
          },
          "hostname": "www.cloudformation.com",
          "method": "PUT",
          "path": "/?",
          "port": 443,
        },
        [Function],
      ]
    `);
    request.mockClear();
  });

  it('getImmutableID', async () => {
    expect.assertions(1);
    const id = getImmutableID({
      StackId: '12',
      LogicalResourceId: '1231',
    });
    expect(id).toMatchInlineSnapshot(`"84ed30001fcccfc70cc54b02b82bbe7d"`);
  });

  it('createStack', async () => {
    expect.assertions(7);

    AWSS3.S3Mock.on(AWSS3.PutObjectCommand).resolves({});
    AWSCloudformation.CloudFormationMock.on(
      AWSCloudformation.CreateStackCommand
    ).resolves({
      StackId: 'stack_id',
    });
    AWSCloudformation.CloudFormationMock.on(
      AWSCloudformation.DescribeStacksCommand
    ).resolves({
      Stacks: [
        {
          StackStatus: 'CREATE_COMPLETE',
        },
      ],
    });
    const cloudformation = new CloudFormation(
      {},
      { artifact_bucket: 'utility-079185815456-us-west-2' }
    );
    const params = {
      StackName: 'test',
      TemplateBody: '{}',
      Tags: [],
    };
    await cloudformation.createStack(params);
    expect(AWSCloudformation.CloudFormationMock).toHaveReceivedCommandTimes(
      AWSCloudformation.CreateStackCommand,
      1
    );
    expect(AWSCloudformation.CloudFormationMock).toHaveReceivedNthCommandWith(
      1,
      AWSCloudformation.CreateStackCommand,
      {
        StackName: params.StackName,
        Tags: params.Tags,
        TemplateURL: expect.any(String),
      }
    );
    expect(AWSS3.S3Mock).toHaveReceivedCommandTimes(AWSS3.PutObjectCommand, 1);
    expect(AWSS3.S3Mock).toHaveReceivedNthCommandWith(
      1,
      AWSS3.PutObjectCommand,
      {
        Bucket: 'utility-079185815456-us-west-2',
        Key: expect.any(String),
        Body: expect.any(Readable),
      }
    );
    expect(AWSCloudformation.CloudFormationMock).toHaveReceivedCommandTimes(
      AWSCloudformation.DescribeStacksCommand,
      1
    );
  });

  it('createStack failure', async () => {
    expect.assertions(6);
    AWSS3.S3Mock.on(AWSS3.PutObjectCommand).resolves({});
    AWSCloudformation.CloudFormationMock.on(
      AWSCloudformation.CreateStackCommand
    ).resolves({
      StackId: 'stack_id',
    });
    AWSCloudformation.CloudFormationMock.on(
      AWSCloudformation.DescribeStackEventsCommand
    ).resolves({
      StackEvents: [
        {
          ResourceStatus: 'CREATE_FAILED',
          ResourceStatusReason: 'Stack Create Failed Reason',
        },
      ],
    });
    AWSCloudformation.CloudFormationMock.on(
      AWSCloudformation.DescribeStacksCommand
    ).resolves({
      Stacks: [
        {
          StackStatus: 'CREATE_FAILED',
        },
      ],
    });

    const cloudformation = new CloudFormation(
      {},
      { artifact_bucket: 'utility-079185815456-us-west-2' }
    );
    const params = {
      StackName: 'test',
      Tags: [],
      TemplateBody: '{}',
    };
    await expect(
      cloudformation.createStack(params)
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Stack Create Failed Reason"`
    );
    expect(AWSCloudformation.CloudFormationMock).toHaveReceivedCommandTimes(
      AWSCloudformation.CreateStackCommand,
      1
    );
    expect(AWSCloudformation.CloudFormationMock).toHaveReceivedNthCommandWith(
      1,
      AWSCloudformation.CreateStackCommand,
      {
        StackName: params.StackName,
        Tags: params.Tags,
        TemplateURL: expect.any(String),
      }
    );
    expect(AWSCloudformation.CloudFormationMock).toHaveReceivedCommandWith(
      AWSCloudformation.DescribeStackEventsCommand,
      {
        StackName: 'stack_id',
      }
    );
  });

  it('updateStack', async () => {
    expect.assertions(7);

    AWSS3.S3Mock.on(AWSS3.PutObjectCommand).resolves({});
    AWSCloudformation.CloudFormationMock.on(
      AWSCloudformation.UpdateStackCommand
    ).resolves({
      StackId: 'stack_id',
    });
    AWSCloudformation.CloudFormationMock.on(
      AWSCloudformation.DescribeStacksCommand
    ).resolves({
      Stacks: [
        {
          StackStatus: 'UPDATE_COMPLETE',
        },
      ],
    });

    const cloudformation = new CloudFormation(
      {},
      { artifact_bucket: 'utility-079185815456-us-west-2' }
    );
    const params = {
      StackName: 'test',
      TemplateBody: '{}',
      Tags: [],
    };
    await cloudformation.updateStack(params);

    expect(AWSCloudformation.CloudFormationMock).toHaveReceivedCommandTimes(
      AWSCloudformation.UpdateStackCommand,
      1
    );
    expect(AWSCloudformation.CloudFormationMock).toHaveReceivedNthCommandWith(
      1,
      AWSCloudformation.UpdateStackCommand,
      {
        StackName: params.StackName,
        Tags: params.Tags,
        TemplateURL: expect.any(String),
      }
    );
    expect(AWSS3.S3Mock).toHaveReceivedCommandTimes(AWSS3.PutObjectCommand, 1);
    expect(AWSS3.S3Mock).toHaveReceivedNthCommandWith(
      1,
      AWSS3.PutObjectCommand,
      {
        Bucket: 'utility-079185815456-us-west-2',
        Key: expect.any(String),
        Body: expect.any(Readable),
      }
    );
    expect(AWSCloudformation.CloudFormationMock).toHaveReceivedCommandTimes(
      AWSCloudformation.DescribeStacksCommand,
      1
    );
  });

  it('updateStack failure', async () => {
    expect.assertions(6);
    AWSS3.S3Mock.on(AWSS3.PutObjectCommand).resolves({});
    AWSCloudformation.CloudFormationMock.on(
      AWSCloudformation.UpdateStackCommand
    ).resolves({
      StackId: 'stack_id',
    });
    AWSCloudformation.CloudFormationMock.on(
      AWSCloudformation.DescribeStacksCommand
    ).resolves({
      Stacks: [
        {
          StackStatus: 'ROLLBACK_COMPLETE',
        },
      ],
    });
    AWSCloudformation.CloudFormationMock.on(
      AWSCloudformation.DescribeStackEventsCommand
    ).resolves({
      StackEvents: [
        {
          ResourceStatus: 'UPDATE_FAILED',
          ResourceStatusReason: 'Stack Update Failed Reason',
        },
      ],
    });

    const cloudformation = new CloudFormation(
      {},
      { artifact_bucket: 'utility-079185815456-us-west-2' }
    );
    const params = {
      StackName: 'test',
      Tags: [],
      TemplateBody: '{}',
    };
    await expect(
      cloudformation.updateStack(params)
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Stack Update Failed Reason"`
    );
    expect(AWSCloudformation.CloudFormationMock).toHaveReceivedCommandTimes(
      AWSCloudformation.UpdateStackCommand,
      1
    );
    expect(AWSCloudformation.CloudFormationMock).toHaveReceivedNthCommandWith(
      1,
      AWSCloudformation.UpdateStackCommand,
      {
        StackName: params.StackName,
        Tags: params.Tags,
        TemplateURL: expect.any(String),
      }
    );
    expect(AWSCloudformation.CloudFormationMock).toHaveReceivedCommandWith(
      AWSCloudformation.DescribeStackEventsCommand,
      {
        StackName: 'stack_id',
      }
    );
  });

  it('deleteStack', async () => {
    expect.assertions(4);
    AWSCloudformation.CloudFormationMock.on(
      AWSCloudformation.DeleteStackCommand
    ).resolves(undefined);
    AWSCloudformation.CloudFormationMock.on(
      AWSCloudformation.DescribeStacksCommand
    ).resolves({
      Stacks: [
        {
          StackStatus: 'DELETE_COMPLETE',
        },
      ],
    });

    const cloudformation = new CloudFormation(
      {},
      { artifact_bucket: 'utility-079185815456-us-west-2' }
    );

    const params = {
      StackName: 'stack_id',
    };
    await cloudformation.deleteStack(params);
    expect(AWSCloudformation.CloudFormationMock).toHaveReceivedCommandTimes(
      AWSCloudformation.DeleteStackCommand,
      1
    );
    expect(AWSCloudformation.CloudFormationMock).toHaveReceivedNthCommandWith(
      1,
      AWSCloudformation.DeleteStackCommand,
      params
    );
    expect(AWSCloudformation.CloudFormationMock).toHaveReceivedCommandTimes(
      AWSCloudformation.DescribeStacksCommand,
      1
    );
  });

  it('deleteStack failure', async () => {
    expect.assertions(6);
    AWSCloudformation.CloudFormationMock.on(
      AWSCloudformation.DeleteStackCommand
    ).resolves(undefined);
    AWSCloudformation.CloudFormationMock.on(
      AWSCloudformation.DescribeStacksCommand
    ).resolves({
      Stacks: [
        {
          StackStatus: 'DELETE_FAILED',
        },
      ],
    });
    AWSCloudformation.CloudFormationMock.on(
      AWSCloudformation.DescribeStackEventsCommand
    ).resolves({
      StackEvents: [
        {
          ResourceStatus: 'DELETE_FAILED',
          ResourceStatusReason: 'Stack Delete Failed Reason',
        },
      ],
    });

    const cloudformation = new CloudFormation(
      {},
      { artifact_bucket: 'utility-079185815456-us-west-2' }
    );

    const params = {
      StackName: 'stack_id',
    };
    await expect(
      cloudformation.deleteStack(params)
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Stack Delete Failed Reason"`
    );
    expect(AWSCloudformation.CloudFormationMock).toHaveReceivedCommandTimes(
      AWSCloudformation.DeleteStackCommand,
      1
    );
    expect(AWSCloudformation.CloudFormationMock).toHaveReceivedNthCommandWith(
      1,
      AWSCloudformation.DeleteStackCommand,
      {
        StackName: params.StackName,
      }
    );
    expect(AWSCloudformation.CloudFormationMock).toHaveReceivedCommandWith(
      AWSCloudformation.DescribeStackEventsCommand,
      {
        StackName: 'stack_id',
      }
    );
  });
});
