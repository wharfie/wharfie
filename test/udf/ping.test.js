'use strict';
const path = require('path');

const PING_TEST_EVENT = {
  '@type': 'PingRequest',
  identity: {
    id: 'UNKNOWN',
    principal: 'UNKNOWN',
    account: '079185815456',
    arn: 'arn:aws:sts::079185815456:assumed-role/AWSReservedSSO_AdministratorAccess_7e34cc2f21392f6c/joe@wharfie.dev',
    tags: {},
    groups: [],
  },
  catalogName: 'udf_name',
  queryId: 'e4268180-8ba7-49f7-9f16-2a9fb93dc581',
};

describe('tests for bootstrap lambda', () => {
  it('delete', async () => {
    expect.assertions(1);
    process.env.WHARFIE_UDF_HANDLER = `${path.join(
      __dirname,
      'request_test_udf_1.js'
    )}.handler`;
    jest.resetModules();
    const { handler } = require('../../lambdas/udf_entrypoint');
    const pingresult = await handler(PING_TEST_EVENT);
    expect(pingresult).toMatchInlineSnapshot(`
      Object {
        "@type": "PingResponse",
        "capabilities": 24,
        "catalogName": "udf_name",
        "queryId": "e4268180-8ba7-49f7-9f16-2a9fb93dc581",
        "serDeVersion": 4,
        "sourceType": "wharfie_udf",
      }
    `);
  });
});
