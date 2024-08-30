/* eslint-disable jest/no-hooks */
'use strict';
const AWSGlue = require('@aws-sdk/client-glue');
const AWSAthena = require('@aws-sdk/client-athena');
const Compaction = require('../../../lambdas/operations/actions/lib/compaction');
const Glue = require('../../../lambdas/lib/glue');
const Athena = require('../../../lambdas/lib/athena');

describe('compaction', () => {
  beforeAll(() => {
    require('aws-sdk-client-mock-jest');
  });

  afterEach(() => {
    AWSGlue.GlueMock.reset();
    AWSAthena.AthenaMock.reset();
  });
  it('getCompactionQueries', async () => {
    expect.assertions(1);

    AWSGlue.GlueMock.on(AWSGlue.GetTableCommand).resolves({
      Table: {
        PartitionKeys: [
          {
            Name: 'dt',
          },
          {
            Name: 'hr',
          },
        ],
      },
    });

    const partitions = [
      {
        location: '',
        partitionValues: {
          dt: 1,
          hr: 1,
          c: 1,
        },
      },
      {
        location: '',
        partitionValues: {
          dt: 1,
          hr: 1,
          c: 2,
        },
      },
      {
        location: '',
        partitionValues: {
          dt: 2,
          hr: 2,
          c: 1,
        },
      },
    ];
    const resource = {
      daemon_config: {
        PrimaryKey: 'id',
        SLA: {
          MaxDelay: 72 * 60,
          ColumnExpression: `date_parse(concat(dt,'-', cast(hr as varchar)), '%Y-%m-%d-%k')`,
        },
      },
      source_properties: {
        tableType: 'VIRTUAL_VIEW',
        viewOriginalText: `/* Presto View: ${Buffer.from(
          JSON.stringify({
            originalSql: 'select * from test_db.test_table',
          })
        ).toString('base64')} */`,
      },
    };
    const operation = {
      operation_config: {
        Duration: 1440,
      },
    };
    const glue = new Glue({ region: 'us-east-1' });
    const athena = new Athena({ region: 'us-east-1' });
    const compaction = new Compaction({
      glue,
      athena,
    });
    const queries = await compaction.getCompactionQueries({
      resource,
      operation,
      partitions,
      sourceDatabaseName: 'sourceDatabaseName',
      sourceTableName: 'sourceTableName',
      temporaryDatabaseName: 'destinationDatabaseName',
      temporaryTableName: 'destinationTableName',
    });

    expect(queries).toMatchInlineSnapshot(`
      [
        {
          "query_data": {
            "partitions": [
              {
                "location": "",
                "partitionValues": {
                  "c": 1,
                  "dt": 1,
                  "hr": 1,
                },
              },
              {
                "location": "",
                "partitionValues": {
                  "c": 2,
                  "dt": 1,
                  "hr": 1,
                },
              },
            ],
          },
          "query_string": "
        INSERT INTO "destinationDatabaseName"."destinationTableName"
        SELECT *
        FROM "sourceDatabaseName"."sourceTableName"
        WHERE ((c=1 and hr=1 and dt=1) or (c=2 and hr=1 and dt=1))",
        },
        {
          "query_data": {
            "partitions": [
              {
                "location": "",
                "partitionValues": {
                  "c": 1,
                  "dt": 2,
                  "hr": 2,
                },
              },
            ],
          },
          "query_string": "
        INSERT INTO "destinationDatabaseName"."destinationTableName"
        SELECT *
        FROM "sourceDatabaseName"."sourceTableName"
        WHERE ((c=1 and hr=2 and dt=2))",
        },
      ]
    `);
  });

  it('getCompactionQueries for repartitioning view', async () => {
    expect.assertions(4);

    AWSGlue.GlueMock.on(AWSGlue.GetTableCommand).resolves({
      Table: {
        PartitionKeys: [
          {
            Name: 'year',
          },
          {
            Name: 'month',
          },
          {
            Name: 'day',
          },
          {
            Name: 'hr',
          },
        ],
      },
    });

    const partitions = [
      {
        location: '',
        partitionValues: {
          creation_date: '2021-08-20',
          quadkey: '002',
        },
      },
      {
        location: '',
        partitionValues: {
          creation_date: '2021-08-20',
          quadkey: '001',
        },
      },
      {
        location: '',
        partitionValues: {
          creation_date: '2021-08-21',
          quadkey: '002',
        },
      },
      {
        location: '',
        partitionValues: {
          creation_date: '2021-08-21',
          quadkey: '001',
        },
      },
      {
        location: '',
        partitionValues: {
          creation_date: '2021-08-22',
          quadkey: '001',
        },
      },
    ];
    const resource = {
      daemon_config: {
        PrimaryKey: 'id',
        SLA: {
          MaxDelay: 72 * 60,
          ColumnExpression: `date_parse(creation_date, '%Y-%m-%d')`,
        },
      },
      source_properties: {
        tableType: 'VIRTUAL_VIEW',
        viewOriginalText: `/* Presto View: ${Buffer.from(
          JSON.stringify({
            originalSql: `select *, concat(year, '-', month, '-', day) as creation_date from test_db.test_table`,
          })
        ).toString('base64')} */`,
      },
    };
    const operation = {
      operation_config: {
        Duration: 1440,
      },
    };
    const glue = new Glue({ region: 'us-east-1' });
    const athena = new Athena({ region: 'us-east-1' });
    const compaction = new Compaction({
      glue,
      athena,
    });
    const queries = await compaction.getCompactionQueries({
      resource,
      operation,
      partitions,
      sourceDatabaseName: 'sourceDatabaseName',
      sourceTableName: 'sourceTableName',
      temporaryDatabaseName: 'destinationDatabaseName',
      temporaryTableName: 'destinationTableName',
    });

    expect(queries).toHaveLength(3);
    expect(queries[0]).toMatchInlineSnapshot(`
      {
        "query_data": {
          "partitions": [
            {
              "location": "",
              "partitionValues": {
                "creation_date": "2021-08-20",
                "quadkey": "002",
              },
            },
            {
              "location": "",
              "partitionValues": {
                "creation_date": "2021-08-20",
                "quadkey": "001",
              },
            },
          ],
        },
        "query_string": "
        INSERT INTO "destinationDatabaseName"."destinationTableName"
        SELECT *
        FROM "sourceDatabaseName"."sourceTableName"
        WHERE ((quadkey='002' and creation_date='2021-08-20') or (quadkey='001' and creation_date='2021-08-20'))",
      }
    `);
    expect(queries[1]).toMatchInlineSnapshot(`
      {
        "query_data": {
          "partitions": [
            {
              "location": "",
              "partitionValues": {
                "creation_date": "2021-08-21",
                "quadkey": "002",
              },
            },
            {
              "location": "",
              "partitionValues": {
                "creation_date": "2021-08-21",
                "quadkey": "001",
              },
            },
          ],
        },
        "query_string": "
        INSERT INTO "destinationDatabaseName"."destinationTableName"
        SELECT *
        FROM "sourceDatabaseName"."sourceTableName"
        WHERE ((quadkey='002' and creation_date='2021-08-21') or (quadkey='001' and creation_date='2021-08-21'))",
      }
    `);
    expect(queries[2]).toMatchInlineSnapshot(`
      {
        "query_data": {
          "partitions": [
            {
              "location": "",
              "partitionValues": {
                "creation_date": "2021-08-22",
                "quadkey": "001",
              },
            },
          ],
        },
        "query_string": "
        INSERT INTO "destinationDatabaseName"."destinationTableName"
        SELECT *
        FROM "sourceDatabaseName"."sourceTableName"
        WHERE ((quadkey='001' and creation_date='2021-08-22'))",
      }
    `);
  });

  it('getCalculatePartitionQueries for athena engine v1', async () => {
    expect.assertions(1);
    AWSAthena.AthenaMock.on(AWSAthena.GetWorkGroupCommand).resolves({
      WorkGroup: {
        Name: 'test',
        State: 'ENABLED',
        Configuration: {
          ResultConfiguration: {},
          EnforceWorkGroupConfiguration: false,
          PublishCloudWatchMetricsEnabled: true,
          RequesterPaysEnabled: false,
          EngineVersion: {
            SelectedEngineVersion: 'AUTO',
            EffectiveEngineVersion: 'Athena engine version 1',
          },
        },
      },
    });
    AWSGlue.GlueMock.on(AWSGlue.GetTableCommand).resolves({
      Table: {
        PartitionKeys: [
          {
            Name: 'a',
          },
          {
            Name: 'b',
          },
        ],
      },
    });
    const glue = new Glue({ region: 'us-east-1' });
    const athena = new Athena({ region: 'us-east-1' });
    const compaction = new Compaction({
      glue,
      athena,
    });
    const query = await compaction.getCalculatePartitionQueries({
      resource: {
        daemon_config: {
          Schedule: 60,
        },
        source_properties: {
          tableType: 'EXTERNAL_TABLE',
        },
      },
      SLA: {
        MaxDelay: 72 * 60,
        ColumnExpression: `date_parse(concat(a,'-', cast(b as varchar)), '%Y-%m-%d-%k')`,
      },
      operationTime: '1608654677',
      sourceDatabaseName: 'sourceDatabaseName',
      sourceTableName: 'sourceTableName',
    });

    expect(query).toMatchInlineSnapshot(`
      "
                  WITH
                    base as (
                      SELECT partition_number as pn, partition_key as key, partition_value as val
                      FROM   information_schema.__internal_partitions__
                      WHERE  table_schema = 'sourceDatabaseName'
                         AND table_name   = 'sourceTableName'
                    )
                  SELECT
                    a ,b
                

                      FROM (
                        SELECT val as a, pn FROM base WHERE key = 'a'
                      ) a
                    

                      JOIN (
                        SELECT val as b, pn FROM base WHERE key = 'b'
                      ) b ON b.pn = a.pn
                    
       WHERE date_diff('minute', date_parse(concat(a,'-', cast(b as varchar)), '%Y-%m-%d-%k'), from_unixtime(1608654677)) <= 4320 + 31
       AND date_diff('minute', date_parse(concat(a,'-', cast(b as varchar)), '%Y-%m-%d-%k'), from_unixtime(1608654677)) >= 0"
    `);
  });

  it('getCalculatePartitionQueries for athena engine v2', async () => {
    expect.assertions(1);
    AWSAthena.AthenaMock.on(AWSAthena.GetWorkGroupCommand).resolves({
      WorkGroup: {
        Name: 'test',
        State: 'ENABLED',
        Configuration: {
          ResultConfiguration: {},
          EnforceWorkGroupConfiguration: false,
          PublishCloudWatchMetricsEnabled: true,
          RequesterPaysEnabled: false,
          EngineVersion: {
            SelectedEngineVersion: 'AUTO',
            EffectiveEngineVersion: 'Athena engine version 2',
          },
        },
      },
    });
    AWSGlue.GlueMock.on(AWSGlue.GetTableCommand).resolves({
      Table: {
        PartitionKeys: [
          {
            Name: 'a',
          },
          {
            Name: 'b',
          },
        ],
      },
    });
    const glue = new Glue({ region: 'us-east-1' });
    const athena = new Athena({ region: 'us-east-1' });
    const compaction = new Compaction({
      glue,
      athena,
    });
    const query = await compaction.getCalculatePartitionQueries({
      resource: {
        daemon_config: {
          Schedule: 1440,
        },
        source_properties: {
          tableType: 'EXTERNAL_TABLE',
        },
      },
      SLA: {
        MaxDelay: 72 * 60,
        ColumnExpression: `date_parse(concat(a,'-', cast(b as varchar)), '%Y-%m-%d-%k')`,
      },
      operationTime: '1608654677',
      sourceDatabaseName: 'sourceDatabaseName',
      sourceTableName: 'sourceTableName',
    });

    expect(query).toMatchInlineSnapshot(`
      "
                  SELECT a ,b
                  FROM sourceDatabaseName."sourceTableName$partitions"
                
       WHERE date_diff('minute', date_parse(concat(a,'-', cast(b as varchar)), '%Y-%m-%d-%k'), from_unixtime(1608654677)) <= 4320 + 991
       AND date_diff('minute', date_parse(concat(a,'-', cast(b as varchar)), '%Y-%m-%d-%k'), from_unixtime(1608654677)) >= 0"
    `);
  });

  it('getCalculatePartitionQueries for athena engine unknown', async () => {
    expect.assertions(1);
    AWSAthena.AthenaMock.on(AWSAthena.GetWorkGroupCommand).resolves({});
    AWSGlue.GlueMock.on(AWSGlue.GetTableCommand).resolves({
      Table: {
        PartitionKeys: [
          {
            Name: 'a',
          },
          {
            Name: 'b',
          },
        ],
      },
    });
    const glue = new Glue({ region: 'us-east-1' });
    const athena = new Athena({ region: 'us-east-1' });
    const compaction = new Compaction({
      glue,
      athena,
    });
    const query = await compaction.getCalculatePartitionQueries({
      resource: {
        daemon_config: {
          Schedule: 14400,
        },
        source_properties: {
          tableType: 'EXTERNAL_TABLE',
        },
      },
      SLA: {
        MaxDelay: 72 * 60,
        ColumnExpression: `date_parse(concat(a,'-', cast(b as varchar)), '%Y-%m-%d-%k')`,
      },
      operationTime: '1608654677',
      sourceDatabaseName: 'sourceDatabaseName',
      sourceTableName: 'sourceTableName',
    });

    expect(query).toMatchInlineSnapshot(`
      "SELECT distinct a ,b FROM sourceDatabaseName.sourceTableName
       WHERE date_diff('minute', date_parse(concat(a,'-', cast(b as varchar)), '%Y-%m-%d-%k'), from_unixtime(1608654677)) <= 4320 + 12511
       AND date_diff('minute', date_parse(concat(a,'-', cast(b as varchar)), '%Y-%m-%d-%k'), from_unixtime(1608654677)) >= 0"
    `);
  });

  it('getCalculatePartitionQueries for View with non-partition key', async () => {
    expect.assertions(1);
    AWSAthena.AthenaMock.on(AWSAthena.GetWorkGroupCommand).resolves({
      WorkGroup: {
        Name: 'test',
        State: 'ENABLED',
        Configuration: {
          ResultConfiguration: {},
          EnforceWorkGroupConfiguration: false,
          PublishCloudWatchMetricsEnabled: true,
          RequesterPaysEnabled: false,
          EngineVersion: {
            SelectedEngineVersion: 'AUTO',
            EffectiveEngineVersion: 'Athena engine version 2',
          },
        },
      },
    });
    AWSGlue.GlueMock.on(AWSGlue.GetTableCommand).resolves({
      Table: {
        PartitionKeys: [
          {
            Name: 'a',
          },
          {
            Name: 'b',
          },
        ],
      },
    });
    const glue = new Glue({ region: 'us-east-1' });
    const athena = new Athena({ region: 'us-east-1' });
    const compaction = new Compaction({
      glue,
      athena,
    });
    const query = await compaction.getCalculatePartitionQueries({
      resource: {
        daemon_config: {
          Schedule: 15,
        },
        source_properties: {
          tableType: 'VIRTUAL_VIEW',
          viewOriginalText: `/* Presto View: ${Buffer.from(
            JSON.stringify({
              originalSql: 'select a, not_partition from test_db.test_table',
            })
          ).toString('base64')} */`,
        },
      },
      SLA: {
        MaxDelay: 72 * 60,
        ColumnExpression: `date_parse(concat(dt,'-', cast(hr as varchar)), '%Y-%m-%d-%k')`,
      },
      operationTime: '1608654677',
      sourceDatabaseName: 'sourceDatabaseName',
      sourceTableName: 'sourceTableName',
    });

    expect(query).toMatchInlineSnapshot(`
      "SELECT distinct a ,b FROM sourceDatabaseName.sourceTableName
       WHERE date_diff('minute', date_parse(concat(dt,'-', cast(hr as varchar)), '%Y-%m-%d-%k'), from_unixtime(1608654677)) <= 4320 + 0
       AND date_diff('minute', date_parse(concat(dt,'-', cast(hr as varchar)), '%Y-%m-%d-%k'), from_unixtime(1608654677)) >= 0"
    `);
  });

  it('getCalculatePartitionQueries for View with only partition keys and SLA of non-partition columns', async () => {
    expect.assertions(1);
    AWSAthena.AthenaMock.on(AWSAthena.GetWorkGroupCommand).resolves({
      WorkGroup: {
        Name: 'test',
        State: 'ENABLED',
        Configuration: {
          ResultConfiguration: {},
          EnforceWorkGroupConfiguration: false,
          PublishCloudWatchMetricsEnabled: true,
          RequesterPaysEnabled: false,
          EngineVersion: {
            SelectedEngineVersion: 'AUTO',
            EffectiveEngineVersion: 'Athena engine version 2',
          },
        },
      },
    });
    AWSGlue.GlueMock.on(AWSGlue.GetTableCommand).resolves({
      Table: {
        PartitionKeys: [
          {
            Name: 'a',
          },
          {
            Name: 'b',
          },
        ],
      },
    });
    const glue = new Glue({ region: 'us-east-1' });
    const athena = new Athena({ region: 'us-east-1' });
    const compaction = new Compaction({
      glue,
      athena,
    });
    const query = await compaction.getCalculatePartitionQueries({
      resource: {
        daemon_config: {
          Schedule: 15,
        },
        source_properties: {
          tableType: 'VIRTUAL_VIEW',
          viewOriginalText: `/* Presto View: ${Buffer.from(
            JSON.stringify({
              originalSql: 'select a, b from test_db.test_table',
            })
          ).toString('base64')} */`,
        },
      },
      SLA: {
        MaxDelay: 72 * 60,
        ColumnExpression: `date_parse(concat(dt,'-', cast(hr as varchar)), '%Y-%m-%d-%k')`,
      },
      operationTime: '1608654677',
      sourceDatabaseName: 'sourceDatabaseName',
      sourceTableName: 'sourceTableName',
    });

    expect(query).toMatchInlineSnapshot(`
      "SELECT distinct a ,b FROM sourceDatabaseName.sourceTableName
       WHERE date_diff('minute', date_parse(concat(dt,'-', cast(hr as varchar)), '%Y-%m-%d-%k'), from_unixtime(1608654677)) <= 4320 + 0
       AND date_diff('minute', date_parse(concat(dt,'-', cast(hr as varchar)), '%Y-%m-%d-%k'), from_unixtime(1608654677)) >= 0"
    `);
  });

  it('getCalculatePartitionQueries for View with only partition keys and SLA of partition keys', async () => {
    expect.assertions(1);
    AWSAthena.AthenaMock.on(AWSAthena.GetWorkGroupCommand).resolves({
      WorkGroup: {
        Name: 'test',
        State: 'ENABLED',
        Configuration: {
          ResultConfiguration: {},
          EnforceWorkGroupConfiguration: false,
          PublishCloudWatchMetricsEnabled: true,
          RequesterPaysEnabled: false,
          EngineVersion: {
            SelectedEngineVersion: 'AUTO',
            EffectiveEngineVersion: 'Athena engine version 2',
          },
        },
      },
    });
    AWSGlue.GlueMock.on(AWSGlue.GetTableCommand).resolves({
      Table: {
        PartitionKeys: [
          {
            Name: 'a',
          },
          {
            Name: 'b',
          },
        ],
      },
    });
    const glue = new Glue({ region: 'us-east-1' });
    const athena = new Athena({ region: 'us-east-1' });
    const compaction = new Compaction({
      glue,
      athena,
    });
    const query = await compaction.getCalculatePartitionQueries({
      resource: {
        source_properties: {
          tableType: 'VIRTUAL_VIEW',
          viewOriginalText: `/* Presto View: ${Buffer.from(
            JSON.stringify({
              originalSql: 'select a, b from test_db.test_table',
            })
          ).toString('base64')} */`,
        },
      },
      SLA: {
        MaxDelay: 72 * 60,
        ColumnExpression: `date_parse(concat(a,'-', cast(b as varchar)), '%Y-%m-%d-%k')`,
      },
      operationTime: '1608654677',
      sourceDatabaseName: 'sourceDatabaseName',
      sourceTableName: 'sourceTableName',
    });

    expect(query).toMatchInlineSnapshot(`
      "
                  SELECT a ,b
                  FROM sourceDatabaseName."sourceTableName$partitions"
                
       WHERE date_diff('minute', date_parse(concat(a,'-', cast(b as varchar)), '%Y-%m-%d-%k'), from_unixtime(1608654677)) <= 4320 + 0
       AND date_diff('minute', date_parse(concat(a,'-', cast(b as varchar)), '%Y-%m-%d-%k'), from_unixtime(1608654677)) >= 0"
    `);
  });

  it('getCalculatePartitionQueries for View with only partition keys and no SLA', async () => {
    expect.assertions(1);
    AWSAthena.AthenaMock.on(AWSAthena.GetWorkGroupCommand).resolves({
      WorkGroup: {
        Name: 'test',
        State: 'ENABLED',
        Configuration: {
          ResultConfiguration: {},
          EnforceWorkGroupConfiguration: false,
          PublishCloudWatchMetricsEnabled: true,
          RequesterPaysEnabled: false,
          EngineVersion: {
            SelectedEngineVersion: 'AUTO',
            EffectiveEngineVersion: 'Athena engine version 2',
          },
        },
      },
    });
    AWSGlue.GlueMock.on(AWSGlue.GetTableCommand).resolves({
      Table: {
        PartitionKeys: [
          {
            Name: 'a',
          },
          {
            Name: 'b',
          },
        ],
      },
    });
    const glue = new Glue({ region: 'us-east-1' });
    const athena = new Athena({ region: 'us-east-1' });
    const compaction = new Compaction({
      glue,
      athena,
    });
    const query = await compaction.getCalculatePartitionQueries({
      resource: {
        daemon_config: {
          Schedule: 15,
        },
        source_properties: {
          tableType: 'VIRTUAL_VIEW',
          viewOriginalText: `/* Presto View: ${Buffer.from(
            JSON.stringify({
              originalSql: 'select a, b from test_db.test_table',
            })
          ).toString('base64')} */`,
        },
      },
      operationTime: '1608654677',
      sourceDatabaseName: 'sourceDatabaseName',
      sourceTableName: 'sourceTableName',
    });

    expect(query).toMatchInlineSnapshot(`
      "
                  SELECT a ,b
                  FROM sourceDatabaseName."sourceTableName$partitions"
                "
    `);
  });

  it('getCalculatePartitionQueries for Table with SLA of non-partition keys', async () => {
    expect.assertions(1);
    AWSAthena.AthenaMock.on(AWSAthena.GetWorkGroupCommand).resolves({
      WorkGroup: {
        Name: 'test',
        State: 'ENABLED',
        Configuration: {
          ResultConfiguration: {},
          EnforceWorkGroupConfiguration: false,
          PublishCloudWatchMetricsEnabled: true,
          RequesterPaysEnabled: false,
          EngineVersion: {
            SelectedEngineVersion: 'AUTO',
            EffectiveEngineVersion: 'Athena engine version 3',
          },
        },
      },
    });
    AWSGlue.GlueMock.on(AWSGlue.GetTableCommand).resolves({
      Table: {
        PartitionKeys: [
          { Name: 'year', Type: 'string' },
          { Name: 'month', Type: 'string' },
          { Name: 'day', Type: 'string' },
          { Name: 'hr', Type: 'string' },
        ],
      },
    });

    const glue = new Glue({ region: 'us-east-1' });
    const athena = new Athena({ region: 'us-east-1' });
    const compaction = new Compaction({
      glue,
      athena,
    });
    const query = await compaction.getCalculatePartitionQueries({
      resource: {
        daemon_config: {
          Schedule: 15,
        },
        source_properties: {
          tableType: 'EXTERNAL_TABLE',
        },
      },
      SLA: {
        MaxDelay: 72 * 60,
        ColumnExpression: `from_iso8601_timestamp(timestamp)`,
      },
      operationTime: '1608654677',
      sourceDatabaseName: 'sourceDatabaseName',
      sourceTableName: 'sourceTableName',
    });

    expect(query).toMatchInlineSnapshot(`
      "
                  SELECT year ,month ,day ,hr
                  FROM sourceDatabaseName."sourceTableName$partitions"
                
       WHERE date_diff('minute', from_iso8601_timestamp(timestamp), from_unixtime(1608654677)) <= 4320 + 0
       AND date_diff('minute', from_iso8601_timestamp(timestamp), from_unixtime(1608654677)) >= 0"
    `);
  });
});
