/* eslint-disable jest/no-large-snapshots */
'use strict';

const {
  deserializeRecords,
  serializeRecords,
  serializeSchema,
} = require('./util');

const arrow = require('apache-arrow');
const path = require('path');

const RECORD_TEST_EVENT = {
  '@type': 'UserDefinedFunctionRequest',
  identity: {
    id: 'UNKNOWN',
    principal: 'UNKNOWN',
    account: '079185815456',
    arn: 'arn:aws:sts::12345678910:assumed-role/role/joe@foo',
    tags: {},
    groups: [],
  },
  inputRecords: {},
  outputSchema: '',
  methodName: 'udf_name',
  functionType: 'SCALAR',
};

describe('tests for js UDF requests', () => {
  it('basic udf test', async () => {
    expect.assertions(1);
    process.env.WHARFIE_UDF_HANDLER = `${path.join(
      __dirname,
      'request_test_udf_1.js'
    )}.handler`;
    jest.resetModules();
    const { handler } = require('../../lambdas/udf_entrypoint');
    const schema = new arrow.Schema([
      new arrow.Field('0', new arrow.Utf8(), true),
    ]);
    const records = ['hello world'];
    const serializedRecords = serializeRecords(schema, records);
    const serializedOuptutSchema = serializeSchema(schema);
    const serializedInputSchema = serializeSchema(schema);

    const input = {
      ...RECORD_TEST_EVENT,
      inputRecords: {
        aId: 'c5ac7fd0-99e8-4862-8563-70efb59e2ab4',
        schema: serializedInputSchema,
        records: serializedRecords,
      },
      outputSchema: serializedOuptutSchema,
    };

    const recordresult = await handler(input);
    const output = await deserializeRecords(recordresult);
    expect(output).toMatchInlineSnapshot(`"HELLO WORLD, input hello world  "`);
  });
  it('multiple param udf test', async () => {
    expect.assertions(1);
    process.env.WHARFIE_UDF_HANDLER = `${path.join(
      __dirname,
      'request_test_udf_2.js'
    )}.handler`;
    jest.resetModules();
    const { handler } = require('../../lambdas/udf_entrypoint');
    const schema = new arrow.Schema([
      new arrow.Field('0', new arrow.Utf8(), true),
      new arrow.Field('1', new arrow.Utf8(), true),
      new arrow.Field('2', new arrow.Utf8(), true),
    ]);
    const records = ['param_1', 'param_2', 'param_3'];
    const serializedRecords = serializeRecords(schema, records);
    const serializedOuptutSchema = serializeSchema(schema);
    const serializedInputSchema = serializeSchema(schema);

    const input = {
      ...RECORD_TEST_EVENT,
      inputRecords: {
        aId: 'c5ac7fd0-99e8-4862-8563-70efb59e2ab4',
        schema: serializedInputSchema,
        records: serializedRecords,
      },
      outputSchema: serializedOuptutSchema,
    };

    const recordresult = await handler(input);
    const output = await deserializeRecords(recordresult);
    expect(output).toMatchInlineSnapshot(
      `"multi param input: param_1, param_2, param_3    "`
    );
  });
});
