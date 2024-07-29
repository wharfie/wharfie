/* eslint-disable jest/no-hooks */
'use strict';

process.env.MONITOR_QUEUE_URL = 'monitor-queue';

let Athena;
let S3;
describe('tests for Athena', () => {
  beforeAll(() => {
    jest.mock('../../../lambdas/lib/id');
    process.env.MONITOR_QUEUE_URL = 'monitor-queue';
  });
  beforeEach(() => {
    process.env.AWS_MOCKS = true;
    S3 = jest.requireMock('@aws-sdk/client-s3').S3;
    jest.requireMock('@aws-sdk/client-glue');
    Athena = require('../../../lambdas/lib/athena/');
  });
  afterAll(() => {
    process.env.MONITOR_QUEUE_URL = undefined;
  });

  it('getWorkgroup', async () => {
    expect.assertions(1);
    const athena = new Athena({ region: 'us-east-1' });
    athena.athena.__setMockState();
    athena.athena.createWorkGroup({
      Name: 'default',
    });
    const params = {
      WorkGroup: 'default',
    };
    const result = await athena.getWorkGroup(params);
    expect(result).toMatchInlineSnapshot(`
      {
        "Name": "default",
        "queries": {},
      }
    `);
  });

  it('startQueryExecution', async () => {
    expect.assertions(2);
    const athena = new Athena({ region: 'us-east-1' });
    athena.athena.__setMockState({
      workgroups: {
        default: {
          queries: {},
        },
      },
    });
    const params = {
      WorkGroup: 'default',
      QueryString: 'select * from foo.bar',
    };
    const result = await athena.startQueryExecution(params);
    expect(result).toMatchInlineSnapshot(`
      {
        "QueryExecutionId": "ckywjpmr70002zjvd0wyq5x48",
      }
    `);
    expect(athena.athena.__getMockState()).toMatchInlineSnapshot(`
      {
        "workgroups": {
          "default": {
            "queries": {
              "ckywjpmr70002zjvd0wyq5x48": {
                "QueryString": "select * from foo.bar",
                "Status": {
                  "State": "FAILED",
                },
                "WorkGroup": "default",
              },
            },
          },
        },
      }
    `);
  });

  it('getQueryExecution', async () => {
    expect.assertions(1);
    const athena = new Athena({ region: 'us-east-1' });
    athena.athena.__setMockState();
    athena.athena.createWorkGroup({
      Name: 'default',
    });
    athena.athena.createWorkGroup({
      Name: 'foo',
    });
    const params = {
      WorkGroup: 'default',
      QueryString: 'select * from foo.bar',
    };
    const { QueryExecutionId } = await athena.startQueryExecution(params);
    await athena.startQueryExecution(params);
    await athena.startQueryExecution({
      WorkGroup: 'foo',
      QueryString: 'select * from foo.bar',
    });
    const result = await athena.getQueryExecution({
      QueryExecutionId,
    });
    expect(result).toMatchInlineSnapshot(`
      {
        "QueryExecution": {
          "Query": "select * from foo.bar",
          "QueryExecutionId": "ckywjpmr70002zjvd0wyq5x48",
          "Status": {
            "State": "SUCCEEDED",
          },
          "WorkGroup": "foo",
        },
      }
    `);
  });

  it('batchGetQueryExecution', async () => {
    expect.assertions(1);
    const athena = new Athena({ region: 'us-east-1' });
    athena.athena.__setMockState();
    athena.athena.createWorkGroup({
      Name: 'default',
    });
    athena.athena.createWorkGroup({
      Name: 'foo',
    });
    const params = {
      WorkGroup: 'default',
      QueryString: 'select * from foo.bar',
    };
    const { QueryExecutionId: foo } = await athena.startQueryExecution(params);
    const { QueryExecutionId: bar } = await athena.startQueryExecution(params);
    await athena.startQueryExecution({
      WorkGroup: 'foo',
      QueryString: 'select * from foo.bar',
    });
    const result = await athena.batchGetQueryExecution({
      QueryExecutionIds: [foo, bar],
    });
    expect(result).toMatchInlineSnapshot(`
      {
        "QueryExecutions": [
          {
            "QueryExecution": {
              "Query": "select * from foo.bar",
              "QueryExecutionId": "ckywjpmr70002zjvd0wyq5x48",
              "Status": {
                "State": "SUCCEEDED",
              },
              "WorkGroup": "foo",
            },
          },
          {
            "QueryExecution": {
              "Query": "select * from foo.bar",
              "QueryExecutionId": "ckywjpmr70002zjvd0wyq5x48",
              "Status": {
                "State": "SUCCEEDED",
              },
              "WorkGroup": "foo",
            },
          },
        ],
      }
    `);
  });

  it('test query side effects', async () => {
    expect.assertions(2);
    const athena = new Athena({ region: 'us-east-1' });
    const s3 = new S3({ region: 'us-east-1' });
    const QueryString = `
      INSERT INTO foo.bar SELECT * FROM foo.biz
    `;
    athena.athena._addQueryMockSideEffect(QueryString, () => {
      s3.putObject({
        Bucket: 'foo',
        Key: 'bar',
        Body: 'baz',
      });
    });
    const params = {
      WorkGroup: 'default',
      QueryString,
    };
    const { QueryExecutionId } = await athena.startQueryExecution(params);
    await new Promise((resolve) => setTimeout(resolve, 11));
    const result = await athena.getQueryExecution({
      QueryExecutionId,
    });
    expect(result).toMatchInlineSnapshot(`
      {
        "QueryExecution": {
          "Query": "select * from foo.bar",
          "QueryExecutionId": "ckywjpmr70002zjvd0wyq5x48",
          "Status": {
            "State": "SUCCEEDED",
          },
          "WorkGroup": "foo",
        },
      }
    `);

    const sideEffect = await s3.getObject({
      Bucket: 'foo',
      Key: 'bar',
    });
    expect(sideEffect).toMatchInlineSnapshot(`
      {
        "Body": "baz",
      }
    `);
  });

  it('test get results', async () => {
    expect.assertions(1);
    const athena = new Athena({ region: 'us-east-1' });
    athena.athena.__setMockState();
    athena.athena.createWorkGroup({
      Name: 'default',
    });
    const s3 = new S3({ region: 'us-east-1' });
    const QueryString = `
      SELECT distinct dt, hr FROM foo.biz
    `;
    const output = [
      ['dt', 'hr'],
      ['2019-01-01', '1'],
      ['2019-01-01', '2'],
      ['2019-01-01', '3'],
      ['2019-01-02', '1'],
      ['2019-01-02', '2'],
      ['2019-01-02', '3'],
    ];
    const outputCSV = output.map((row) => row.join(',')).join('\n');
    athena.athena._addQueryMockSideEffect(
      QueryString,
      () => {
        s3.putObject({
          Bucket: 'foo',
          Key: 'bar',
          Body: outputCSV,
        });
      },
      outputCSV
    );
    const params = {
      WorkGroup: 'default',
      QueryString,
    };
    const { QueryExecutionId } = await athena.startQueryExecution(params);
    await new Promise((resolve) => setTimeout(resolve, 11));
    const resultIterator = await athena.getQueryResults({
      QueryExecutionId,
    });
    const results = [];
    for await (const result of resultIterator) {
      results.push(result);
    }
    expect(results).toMatchInlineSnapshot(`
      [
        {
          "dt": "2019-01-01",
          "hr": "1",
        },
        {
          "dt": "2019-01-01",
          "hr": "2",
        },
        {
          "dt": "2019-01-01",
          "hr": "3",
        },
        {
          "dt": "2019-01-02",
          "hr": "1",
        },
        {
          "dt": "2019-01-02",
          "hr": "2",
        },
        {
          "dt": "2019-01-02",
          "hr": "3",
        },
      ]
    `);
  });
});
