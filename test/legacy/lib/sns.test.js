/* eslint-disable jest/no-hooks */
import { afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const AWS = require('@aws-sdk/client-sns');
const SNS = require('../../lambdas/lib/sns');

describe('tests for SNS', () => {
  beforeAll(() => {
    require('aws-sdk-client-mock-jest');
  });

  afterEach(() => {
    AWS.SNSMock.reset();
  });

  it('publish', async () => {
    expect.assertions(2);

    AWS.SNSMock.on(AWS.PublishCommand).resolves({});
    const sns = new SNS({ region: 'us-east-1' });
    const params = {
      Message: JSON.stringify('test'),
      TopicArn: 'test_topic_arn',
    };
    await sns.publish(params);

    expect(AWS.SNSMock).toHaveReceivedNthCommandWith(
      1,
      AWS.PublishCommand,
      params,
    );
  });
});
