/* eslint-disable jest/no-hooks */
'use strict';

let SNS;
describe('tests for SNS Mock', () => {
  beforeAll(() => {
    process.env.AWS_MOCKS = true;
    jest.requireMock('@aws-sdk/client-sns');
    SNS = require('../../lambdas/lib/sns');
  });
  afterAll(() => {
    process.env.AWS_MOCKS = false;
  });
  it('publish Mock', async () => {
    expect.assertions(1);
    const sns = new SNS({ region: 'us-east-1' });
    const params = {
      Message: JSON.stringify('test'),
      TopicArn: 'test_topic_arn',
    };
    await sns.publish(params);
    expect(sns.sns.__getMockState()).toMatchInlineSnapshot(`
      Object {
        "test_topic_arn": Array [
          "\\"test\\"",
        ],
      }
    `);
  });
});
