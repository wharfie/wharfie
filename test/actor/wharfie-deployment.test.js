/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = true;
jest.requireMock('@aws-sdk/client-s3');
jest.requireMock('@aws-sdk/client-sns');
jest.requireMock('@aws-sdk/client-glue');
jest.requireMock('@aws-sdk/client-athena');
jest.requireMock('@aws-sdk/client-sqs');
jest.requireMock('@aws-sdk/client-sts');
jest.requireMock('@aws-sdk/client-cloudwatch');

const WharfieDeployment = require('../../lambdas/lib/actor/wharfie-deployment');

jest.mock('../../lambdas/lib/dynamo/resource');
jest.mock('../../lambdas/lib/dynamo/event');
jest.mock('../../lambdas/lib/dynamo/location');
jest.mock('../../lambdas/lib/dynamo/semaphore');
jest.mock('../../lambdas/lib/dynamo/dependency');
jest.mock('../../lambdas/lib/logging');
// eslint-disable-next-line jest/no-untyped-mock-factory
jest.mock('../../package.json', () => ({ version: '0.0.1' }));

// eslint-disable-next-line jest/no-disabled-tests
describe.skip('tests for cron functions', () => {
  it('declare wharfie deployment', async () => {
    expect.assertions(1);
    const deployment = new WharfieDeployment({
      name: 'test-deployment',
    });
    await deployment.reconcile();

    const serialized = deployment.serialize();
    expect(serialized).toMatchSnapshot();
  });
});
