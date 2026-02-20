/* eslint-disable jest/no-hooks */
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const AWS = require('@aws-sdk/client-sts');
const STS = require('../../lambdas/lib/sts');

describe('tests for STS', () => {
  beforeAll(() => {
    require('aws-sdk-client-mock-jest');
  });

  afterEach(() => {
    AWS.STSMock.reset();
  });

  it('getCredentials', async () => {
    expect.assertions(5);

    const mockedDate = new Date(1466424490000);
    jest.useFakeTimers('modern');
    jest.setSystemTime(mockedDate);
    const Credentials = {
      AccessKeyId: 'access-key-id',
      SecretAccessKey: 'secret-access-key',
      SessionToken: 'session-token',
      Expiration: new Date(1466424490000 + 1000 * 60 * 60),
    };
    // const spy = jest.spyOn(global, 'Date').mockImplementation(() => mockDate);
    AWS.STSMock.on(AWS.AssumeRoleCommand).resolves({
      Credentials,
    });
    const sts = new STS({ region: 'us-east-1' });
    const sts2 = new STS({ region: 'us-east-1' });
    const response = await sts.getCredentials('test-role-arn');
    const response2 = await sts2.getCredentials('test-role-arn');

    expect(response).toStrictEqual({
      accessKeyId: 'access-key-id',
      secretAccessKey: 'secret-access-key',
      sessionToken: 'session-token',
    });
    expect(response).toStrictEqual(response2);
    expect(AWS.STSMock).toHaveReceivedCommandTimes(AWS.AssumeRoleCommand, 1);
    expect(AWS.STSMock).toHaveReceivedCommandWith(AWS.AssumeRoleCommand, {
      RoleArn: 'test-role-arn',
      RoleSessionName: `wharfie-${mockedDate.getTime()}`,
    });

    jest.useRealTimers();
  });
});
