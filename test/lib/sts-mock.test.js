/* eslint-disable jest/no-hooks */
'use strict';

let STS;
describe('tests for STS mock', () => {
  beforeAll(() => {
    process.env.AWS_MOCKS = true;
    jest.requireMock('@aws-sdk/client-sts');
    STS = require('../../lambdas/lib/sts');
  });
  afterAll(() => {
    process.env.AWS_MOCKS = false;
  });
  it('getCallerIdentity mock', async () => {
    expect.assertions(1);
    const sts = new STS({ region: 'us-east-1' });
    const response = await sts.getCallerIdentity();
    expect(response).toMatchInlineSnapshot(`
      {
        "Account": "",
        "Arn": "",
        "UserId": "",
      }
    `);
  });
  it('getCredentials mock', async () => {
    expect.assertions(1);
    const sts = new STS({ region: 'us-east-1' });
    const response = await sts.getCredentials('fake-role-arn');
    expect(response).toMatchInlineSnapshot(`
      {
        "accessKeyId": "123",
        "secretAccessKey": "123",
        "sessionToken": "123",
      }
    `);
  });
});
