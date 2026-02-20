/* eslint-disable jest/no-hooks */
import { afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const AWS = require('@aws-sdk/client-athena');
const AWSGlue = require('@aws-sdk/client-glue');
const Athena = require('../../../lambdas/lib/athena');

describe('tests for Athena', () => {
  beforeAll(() => {
    require('aws-sdk-client-mock-jest');
  });

  afterEach(() => {
    AWS.AthenaMock.reset();
    AWSGlue.GlueMock.reset();
  });

  it('extractSources', async () => {
    expect.assertions(1);

    const athena = new Athena({ region: 'us-east-1' });
    const result = await athena.extractSources(
      'select * from test_database.test_table',
    );

    expect(result).toMatchInlineSnapshot(`
      {
        "columns": [
          "(.*)",
        ],
        "selectAsColumns": [
          {
            "columns": Set {
              "*",
            },
            "identifier": "",
          },
        ],
        "sources": [
          {
            "DatabaseName": "test_database",
            "TableName": "test_table",
          },
        ],
      }
    `);
  });

  it('extractSources columns', async () => {
    expect.assertions(1);

    const athena = new Athena({ region: 'us-east-1' });
    const result = await athena.extractSources(
      'select column1, column_2 from test_database.test_table',
    );

    expect(result).toMatchInlineSnapshot(`
      {
        "columns": [
          "column1",
          "column_2",
        ],
        "selectAsColumns": [
          {
            "columns": Set {
              "column1",
            },
            "identifier": "",
          },
          {
            "columns": Set {
              "column_2",
            },
            "identifier": "",
          },
        ],
        "sources": [
          {
            "DatabaseName": "test_database",
            "TableName": "test_table",
          },
        ],
      }
    `);
  });

  it('extractSources select as', async () => {
    expect.assertions(1);

    const athena = new Athena({ region: 'us-east-1' });
    const result = await athena.extractSources(
      'select CONCAT(first_name, " ", last_name) AS full_name, renamed_column as column2, column3, CONCAT(first_name, " ", last_name)  from test_table',
    );

    expect(result).toMatchInlineSnapshot(`
      {
        "columns": [
          "first_name",
          "last_name",
          "renamed_column",
          "column3",
        ],
        "selectAsColumns": [
          {
            "columns": Set {
              "first_name",
              "last_name",
            },
            "identifier": "full_name",
          },
          {
            "columns": Set {
              "renamed_column",
            },
            "identifier": "column2",
          },
          {
            "columns": Set {
              "column3",
            },
            "identifier": "",
          },
          {
            "columns": Set {
              "first_name",
              "last_name",
            },
            "identifier": "",
          },
        ],
        "sources": [
          {
            "DatabaseName": "",
            "TableName": "test_table",
          },
        ],
      }
    `);
  });

  it('startQueryExecution', async () => {
    expect.assertions(2);

    AWS.AthenaMock.on(AWS.StartQueryExecutionCommand).resolves();

    const athena = new Athena({ region: 'us-east-1' });
    const params = {};
    await athena.startQueryExecution(params);

    expect(AWS.AthenaMock).toHaveReceivedCommandWith(
      AWS.StartQueryExecutionCommand,
      params,
    );
  });

  it('batchGetQueryExecution', async () => {
    expect.assertions(2);

    AWS.AthenaMock.on(AWS.BatchGetQueryExecutionCommand).resolves();
    const athena = new Athena({ region: 'us-east-1' });
    const params = {};
    await athena.batchGetQueryExecution(params);

    expect(AWS.AthenaMock).toHaveReceivedCommandWith(
      AWS.BatchGetQueryExecutionCommand,
      params,
    );
  });

  it('getQueryExecution', async () => {
    expect.assertions(2);

    AWS.AthenaMock.on(AWS.GetQueryExecutionCommand).resolves();
    const athena = new Athena({ region: 'us-east-1' });
    const params = {};
    await athena.getQueryExecution(params);

    expect(AWS.AthenaMock).toHaveReceivedCommandWith(
      AWS.GetQueryExecutionCommand,
      params,
    );
  });

  it('getQueryResults', async () => {
    expect.assertions(4);

    AWS.AthenaMock.on(AWS.GetQueryResultsCommand)
      .resolvesOnce({
        NextToken: 'next-token',
        ResultSet: {
          ResultSetMetadata: {
            ColumnInfo: [
              {
                Name: 'foo',
                Type: 'varchar',
              },
              {
                Name: 'bar',
                Type: 'float',
              },
              {
                Name: 'bar-array',
                Type: 'array',
              },
              {
                Name: 'bar-timestamp',
                Type: 'timestamp',
              },
              {
                Name: 'bar-boolean',
                Type: 'boolean',
              },
              {
                Name: 'bar-map',
                Type: 'map',
              },
            ],
          },
          Rows: [
            {
              Data: [
                {
                  VarCharValue: 'foo',
                },
                {
                  VarCharValue: 'bar',
                },
                {
                  VarCharValue: 'bar-array',
                },
                {
                  VarCharValue: 'bar-timestamp',
                },
                {
                  VarCharValue: 'bar-boolean',
                },
                {
                  VarCharValue: 'bar-map',
                },
              ],
            },
            {
              Data: [
                {
                  VarCharValue: 'amazing',
                },
                {
                  VarCharValue: '23.4',
                },
                {
                  VarCharValue: '[amazing,great,test]',
                },
                {
                  VarCharValue: '2012-08-06 20:00:00.000',
                },
                {
                  VarCharValue: 'true',
                },
                {
                  VarCharValue: '{test=value,another=another value}',
                },
              ],
            },
          ],
        },
      })
      .resolvesOnce({
        ResultSet: {
          ResultSetMetadata: {
            ColumnInfo: [
              {
                Name: 'foo',
                Type: 'varchar',
              },
              {
                Name: 'bar',
                Type: 'float',
              },
            ],
          },
          Rows: [
            {
              Data: [
                {
                  VarCharValue: 'foo',
                },
                {
                  VarCharValue: 'bar',
                },
              ],
            },
            {
              Data: [
                {
                  VarCharValue: 'another',
                },
                {
                  VarCharValue: '3.4',
                },
              ],
            },
          ],
        },
      });
    const athena = new Athena({ region: 'us-east-1' });
    const params = {};
    const resultStream = await athena.getQueryResults(params);
    const results = [];
    for await (const result of resultStream) {
      results.push(result);
    }

    expect(AWS.AthenaMock).toHaveReceivedCommandWith(
      AWS.GetQueryResultsCommand,
      params,
    );
    expect(results).toMatchInlineSnapshot(`
      [
        {
          "bar": 23.4,
          "bar-array": [
            "amazing",
            "great",
            "test",
          ],
          "bar-boolean": true,
          "bar-map": {
            "another": "another value",
            "test": "value",
          },
          "bar-timestamp": 2012-08-06T20:00:00.000Z,
          "foo": "amazing",
        },
        {
          "bar": 3.4,
          "foo": "another",
        },
      ]
    `);
  });

  it('getQueryMetrics', async () => {
    expect.assertions(3);

    AWS.AthenaMock.on(AWS.GetQueryExecutionCommand).resolves({
      QueryExecution: {
        Query: 'select * from test.test_table',
        Status: { State: 'SUCCEEDED', StateChangeReason: 'reasons' },
        QueryExecutionContext: {
          Database: 'test',
        },
        Statistics: {
          Stats: '',
        },
      },
    });
    AWSGlue.GlueMock.on(AWSGlue.GetTablesCommand).rejects(new Error());

    const athena = new Athena({ region: 'us-east-1' });

    const result = await athena.getQueryMetrics('1');

    expect(result).toMatchInlineSnapshot(`
      {
        "References": [
          {
            "DatabaseName": "test",
            "TableName": "test_table",
          },
        ],
        "Statistics": {
          "Stats": "",
        },
      }
    `);
    expect(AWS.AthenaMock).toHaveReceivedCommandTimes(
      AWS.GetQueryExecutionCommand,
      1,
    );
    expect(AWSGlue.GlueMock).toHaveReceivedCommandTimes(
      AWSGlue.GetTablesCommand,
      1,
    );
  });

  it('getQueryMetrics derive db', async () => {
    expect.assertions(3);

    AWS.AthenaMock.on(AWS.GetQueryExecutionCommand).resolves({
      QueryExecution: {
        Query: 'select * from "test_table"',
        Status: { State: 'SUCCEEDED', StateChangeReason: 'reasons' },
        QueryExecutionContext: {
          Database: 'test',
        },
        Statistics: {
          Stats: '',
        },
      },
    });
    AWSGlue.GlueMock.on(AWSGlue.GetTablesCommand).resolves({
      TableList: [
        {
          Name: 'test_table',
        },
      ],
    });
    const athena = new Athena({ region: 'us-east-1' });

    const result = await athena.getQueryMetrics('1');

    expect(result).toMatchInlineSnapshot(`
      {
        "References": [
          {
            "DatabaseName": "test",
            "TableName": "test_table",
          },
        ],
        "Statistics": {
          "Stats": "",
        },
      }
    `);
    expect(AWS.AthenaMock).toHaveReceivedCommandTimes(
      AWS.GetQueryExecutionCommand,
      1,
    );
    expect(AWSGlue.GlueMock).toHaveReceivedCommandTimes(
      AWSGlue.GetTablesCommand,
      1,
    );
  });
});
