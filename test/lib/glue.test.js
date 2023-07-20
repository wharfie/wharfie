/* eslint-disable jest/no-hooks */
'use strict';
process.env.TEMP_FILES_BUCKET = 'wharfie-tests-temp-files';
const AWS = require('@aws-sdk/client-glue');
const Glue = require('../../lambdas/lib/glue');

describe('tests for Glue', () => {
  beforeAll(() => {
    process.env.TEMP_FILES_BUCKET = 'wharfie-tests-temp-files';
    require('aws-sdk-client-mock-jest');
  });
  afterEach(() => {
    AWS.GlueMock.reset();
  });
  afterAll(() => {
    process.env.TEMP_FILES_BUCKET = undefined;
  });

  it('getTable', async () => {
    expect.assertions(3);
    AWS.GlueMock.on(AWS.GetTableCommand).resolves({});
    const glue = new Glue({ region: 'us-east-1' });
    const params = {
      DatabaseName: 'database_name',
      Name: 'table_name',
    };
    await glue.getTable(params);
    expect(AWS.GlueMock).toHaveReceivedCommandTimes(AWS.GetTableCommand, 1);
    expect(AWS.GlueMock).toHaveReceivedCommandWith(AWS.GetTableCommand, params);
  });

  it('getTables', async () => {
    expect.assertions(3);
    AWS.GlueMock.on(AWS.GetTablesCommand).resolves({});
    const glue = new Glue({ region: 'us-east-1' });
    const params = {
      DatabaseName: 'database_name',
    };
    await glue.getTables(params);
    expect(AWS.GlueMock).toHaveReceivedCommandTimes(AWS.GetTablesCommand, 1);
    expect(AWS.GlueMock).toHaveReceivedCommandWith(
      AWS.GetTablesCommand,
      params
    );
  });

  it('getPartition', async () => {
    expect.assertions(3);
    AWS.GlueMock.on(AWS.GetPartitionCommand).resolves({});
    const glue = new Glue({ region: 'us-east-1' });
    const params = {
      DatabaseName: 'database_name',
      TableName: 'table_name',
      PartitionValues: ['2020', '03', '21'],
    };
    await glue.getPartition(params);
    expect(AWS.GlueMock).toHaveReceivedCommandTimes(AWS.GetPartitionCommand, 1);
    expect(AWS.GlueMock).toHaveReceivedCommandWith(
      AWS.GetPartitionCommand,
      params
    );
  });

  it('batchCreatePartition', async () => {
    expect.assertions(3);
    AWS.GlueMock.on(AWS.BatchCreatePartitionCommand)
      .resolvesOnce({
        Errors: [
          {
            ErrorDetail: {
              ErrorCode: 'InternalServiceException',
            },
            PartitionValues: ['2020', '03', '21'],
          },
        ],
      })
      .resolvesOnce({});
    const glue = new Glue({ region: 'us-east-1' });
    const params = {
      DatabaseName: 'database_name',
      TableName: 'table_name',
      PartitionInputList: [
        {
          Values: ['2020', '03', '21'],
          StorageDescriptor: {},
        },
        {
          Values: ['1999', '03', '21'],
          StorageDescriptor: {},
        },
      ],
    };
    await glue.batchCreatePartition(params);
    expect(AWS.GlueMock).toHaveReceivedCommandTimes(
      AWS.BatchCreatePartitionCommand,
      2
    );
    expect(
      AWS.GlueMock.commandCalls(AWS.BatchCreatePartitionCommand)[0].args[0]
        .input
    ).toMatchInlineSnapshot(`
      Object {
        "DatabaseName": "database_name",
        "PartitionInputList": Array [
          Object {
            "StorageDescriptor": Object {},
            "Values": Array [
              "2020",
              "03",
              "21",
            ],
          },
          Object {
            "StorageDescriptor": Object {},
            "Values": Array [
              "1999",
              "03",
              "21",
            ],
          },
        ],
        "TableName": "table_name",
      }
    `);
    expect(
      AWS.GlueMock.commandCalls(AWS.BatchCreatePartitionCommand)[1].args[0]
        .input
    ).toMatchInlineSnapshot(`
      Object {
        "DatabaseName": "database_name",
        "PartitionInputList": Array [
          Object {
            "StorageDescriptor": Object {},
            "Values": Array [
              "2020",
              "03",
              "21",
            ],
          },
        ],
        "TableName": "table_name",
      }
    `);
  });

  it('createPartition', async () => {
    expect.assertions(3);
    AWS.GlueMock.on(AWS.CreatePartitionCommand).resolves({});
    const glue = new Glue({ region: 'us-east-1' });
    const params = {
      DatabaseName: 'database_name',
      TableName: 'table_name',
      PartitionInput: {
        Values: ['2020', '03', '21'],
        StorageDescriptor: {},
      },
    };
    await glue.createPartition(params);
    expect(AWS.GlueMock).toHaveReceivedCommandTimes(
      AWS.CreatePartitionCommand,
      1
    );
    expect(AWS.GlueMock).toHaveReceivedCommandWith(
      AWS.CreatePartitionCommand,
      params
    );
  });

  it('batchUpdatePartition', async () => {
    expect.assertions(3);
    AWS.GlueMock.on(AWS.BatchUpdatePartitionCommand)
      .resolvesOnce({
        Errors: [
          {
            ErrorDetail: {
              ErrorCode: 'InternalFailure',
            },
            PartitionValueList: ['2020', '03', '21'],
          },
        ],
      })
      .resolvesOnce({});
    const glue = new Glue({ region: 'us-east-1' });
    const params = {
      DatabaseName: 'database_name',
      TableName: 'table_name',
      Entries: [
        {
          PartitionValueList: ['2020', '03', '21'],
          PartitionInput: {
            Values: ['2020', '03', '21'],
            StorageDescriptor: {},
            Parameters: {},
          },
        },
        {
          PartitionValueList: ['1999', '1', '12'],
          PartitionInput: {
            Values: ['1999', '1', '12'],
            StorageDescriptor: {},
            Parameters: {},
          },
        },
      ],
    };
    await glue.batchUpdatePartition(params);
    expect(AWS.GlueMock).toHaveReceivedCommandTimes(
      AWS.BatchUpdatePartitionCommand,
      2
    );
    expect(
      AWS.GlueMock.commandCalls(AWS.BatchUpdatePartitionCommand)[0].args[0]
        .input
    ).toMatchInlineSnapshot(`
      Object {
        "DatabaseName": "database_name",
        "Entries": Array [
          Object {
            "PartitionInput": Object {
              "Parameters": Object {},
              "StorageDescriptor": Object {},
              "Values": Array [
                "2020",
                "03",
                "21",
              ],
            },
            "PartitionValueList": Array [
              "2020",
              "03",
              "21",
            ],
          },
          Object {
            "PartitionInput": Object {
              "Parameters": Object {},
              "StorageDescriptor": Object {},
              "Values": Array [
                "1999",
                "1",
                "12",
              ],
            },
            "PartitionValueList": Array [
              "1999",
              "1",
              "12",
            ],
          },
        ],
        "TableName": "table_name",
      }
    `);
    expect(
      AWS.GlueMock.commandCalls(AWS.BatchUpdatePartitionCommand)[1].args[0]
        .input
    ).toMatchInlineSnapshot(`
      Object {
        "DatabaseName": "database_name",
        "Entries": Array [
          Object {
            "PartitionInput": Object {
              "Parameters": Object {},
              "StorageDescriptor": Object {},
              "Values": Array [
                "2020",
                "03",
                "21",
              ],
            },
            "PartitionValueList": Array [
              "2020",
              "03",
              "21",
            ],
          },
        ],
        "TableName": "table_name",
      }
    `);
  });

  it('batchDeletePartition', async () => {
    expect.assertions(2);
    AWS.GlueMock.on(AWS.BatchDeletePartitionCommand)
      .resolvesOnce({
        Errors: [
          {
            ErrorDetail: {
              ErrorCode: 'InternalFailure',
            },
            PartitionValueList: ['2020', '03', '21'],
          },
        ],
      })
      .resolvesOnce({});
    const glue = new Glue({ region: 'us-east-1' });
    const params = {
      DatabaseName: 'database_name',
      TableName: 'table_name',
      PartitionsToDelete: [
        {
          Values: ['2020', '03', '21'],
        },
        {
          Values: ['1999', '1', '12'],
        },
      ],
    };
    await glue.batchDeletePartition(params);
    expect(AWS.GlueMock).toHaveReceivedCommandTimes(
      AWS.BatchDeletePartitionCommand,
      1
    );
    expect(
      AWS.GlueMock.commandCalls(AWS.BatchDeletePartitionCommand)[0].args[0]
        .input
    ).toMatchInlineSnapshot(`
      Object {
        "DatabaseName": "database_name",
        "PartitionsToDelete": Array [
          Object {
            "Values": Array [
              "2020",
              "03",
              "21",
            ],
          },
          Object {
            "Values": Array [
              "1999",
              "1",
              "12",
            ],
          },
        ],
        "TableName": "table_name",
      }
    `);
  });

  it('updatePartition', async () => {
    expect.assertions(3);
    AWS.GlueMock.on(AWS.UpdatePartitionCommand).resolves(undefined);
    const glue = new Glue({ region: 'us-east-1' });
    const params = {
      DatabaseName: 'database_name',
      TableName: 'table_name',
      PartitionValueList: ['2020', '03', '21'],
      PartitionInput: {
        Values: ['2020', '03', '21'],
        StorageDescriptor: {},
        Parameters: {},
      },
    };
    await glue.updatePartition(params);
    expect(AWS.GlueMock).toHaveReceivedCommandTimes(
      AWS.UpdatePartitionCommand,
      1
    );
    expect(AWS.GlueMock).toHaveReceivedCommandWith(
      AWS.UpdatePartitionCommand,
      params
    );
  });

  it('deleteTable', async () => {
    expect.assertions(3);
    AWS.GlueMock.on(AWS.DeleteTableCommand).resolves(undefined);
    const glue = new Glue({ region: 'us-east-1' });
    const params = {
      DatabaseName: 'database_name',
      Name: 'table_name',
    };
    await glue.deleteTable(params);
    expect(AWS.GlueMock).toHaveReceivedCommandTimes(AWS.DeleteTableCommand, 1);
    expect(AWS.GlueMock).toHaveReceivedCommandWith(
      AWS.DeleteTableCommand,
      params
    );
  });

  it('createTable', async () => {
    expect.assertions(3);
    AWS.GlueMock.on(AWS.CreateTableCommand).resolves({});
    const glue = new Glue({ region: 'us-east-1' });
    const params = {
      DatabaseName: 'database_name',
      TableInput: {
        Name: 'table_name',
      },
    };
    await glue.createTable(params);
    expect(AWS.GlueMock).toHaveReceivedCommandTimes(AWS.CreateTableCommand, 1);
    expect(AWS.GlueMock).toHaveReceivedCommandWith(
      AWS.CreateTableCommand,
      params
    );
  });

  it('cloneDestinationTable', async () => {
    expect.assertions(11);
    AWS.GlueMock.on(AWS.GetTableCommand)
      .resolvesOnce({
        Table: {},
      })
      .resolvesOnce({
        Table: {
          StorageDescriptor: {},
        },
      });
    AWS.GlueMock.on(AWS.CreateTableCommand).resolves(undefined);
    AWS.GlueMock.on(AWS.DeleteTableCommand).resolves(undefined);
    const glue = new Glue({ region: 'us-east-1' });
    const params = {
      DatabaseName: 'database_name',
      Name: 'table_name',
    };
    const outputTableName = 'test_table';
    const outputDatabaseName = 'test_database';
    const outputPrefix = 'test_prefix';
    await glue.cloneDestinationTable(
      {
        destination_properties: {
          TableInput: {
            StorageDescriptor: {
              Location: 's3://location/data/some_prefix/references/',
            },
          },
        },
      },
      params,
      outputDatabaseName,
      outputTableName,
      outputPrefix
    );
    expect(AWS.GlueMock).toHaveReceivedCommandTimes(AWS.GetTableCommand, 2);
    expect(AWS.GlueMock).toHaveReceivedNthCommandWith(
      1,
      AWS.GetTableCommand,
      params
    );
    expect(AWS.GlueMock).toHaveReceivedNthCommandWith(2, AWS.GetTableCommand, {
      DatabaseName: outputDatabaseName,
      Name: outputTableName,
    });
    expect(AWS.GlueMock).toHaveReceivedCommandTimes(AWS.DeleteTableCommand, 1);
    expect(AWS.GlueMock).toHaveReceivedNthCommandWith(
      3,
      AWS.DeleteTableCommand,
      {
        DatabaseName: outputDatabaseName,
        Name: outputTableName,
      }
    );
    expect(AWS.GlueMock).toHaveReceivedCommandTimes(AWS.CreateTableCommand, 1);
    expect(AWS.GlueMock).toHaveReceivedNthCommandWith(
      4,
      AWS.CreateTableCommand,
      {
        DatabaseName: outputDatabaseName,
        TableInput: {
          Name: outputTableName,
          StorageDescriptor: {
            InputFormat:
              'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
            Location: 's3://location/data/some_prefix/data/test_prefix/',
            OutputFormat:
              'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
          },
        },
      }
    );
  });

  it('cloneDestinationTable with partitions', async () => {
    expect.assertions(8);
    AWS.GlueMock.on(AWS.GetTableCommand)
      .resolvesOnce({
        Table: {
          StorageDescriptor: {},
        },
      })
      .resolvesOnce({
        Table: undefined,
      });
    AWS.GlueMock.on(AWS.CreateTableCommand).resolves(undefined);
    AWS.GlueMock.on(AWS.DeleteTableCommand).resolves(new Error(''));

    const glue = new Glue({ region: 'us-east-1' });
    const params = {
      DatabaseName: 'database_name',
      Name: 'table_name',
    };
    const outputTableName = 'test_table';
    const outputDatabaseName = 'test_database';
    const outputPrefix = 'test_prefix';
    await glue.cloneDestinationTable(
      {
        destination_properties: {
          TableInput: {
            StorageDescriptor: {
              Location: 's3://location/references/',
            },
          },
        },
      },
      params,
      outputDatabaseName,
      outputTableName,
      outputPrefix
    );
    expect(AWS.GlueMock).toHaveReceivedCommandTimes(AWS.GetTableCommand, 2);
    expect(AWS.GlueMock).toHaveReceivedNthCommandWith(
      1,
      AWS.GetTableCommand,
      params
    );
    expect(AWS.GlueMock).toHaveReceivedNthCommandWith(2, AWS.GetTableCommand, {
      DatabaseName: outputDatabaseName,
      Name: outputTableName,
    });
    expect(AWS.GlueMock).toHaveReceivedCommandTimes(AWS.CreateTableCommand, 1);
    expect(AWS.GlueMock).toHaveReceivedNthCommandWith(
      3,
      AWS.CreateTableCommand,
      {
        DatabaseName: outputDatabaseName,
        TableInput: {
          Name: outputTableName,
          StorageDescriptor: {
            InputFormat:
              'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
            Location: 's3://location/data/test_prefix/',
            OutputFormat:
              'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
          },
        },
      }
    );
  });

  it('getPartitionsSegment', async () => {
    expect.assertions(4);
    AWS.GlueMock.on(AWS.GetPartitionsCommand)
      .resolvesOnce({
        Partitions: [
          {
            StorageDescriptor: {
              Location: 's3://example-bucket/path/01/day=21/',
            },
            Values: ['01', '21'],
          },
        ],
        NextToken: 'continue_token',
      })
      .resolvesOnce({
        Partitions: [
          {
            StorageDescriptor: {
              Location: 's3://example-bucket/path/01/day=22/',
            },
            Values: ['01', '22'],
          },
        ],
      });

    const glue = new Glue();
    const partitions = [];
    await glue.getPartitionsSegment(
      {
        DatabaseName: 'database',
        Name: 'table_name',
      },
      partitions,
      [
        {
          Name: 'month',
        },
        {
          Name: 'day',
        },
      ]
    );
    expect(partitions).toStrictEqual([
      {
        location: 's3://example-bucket/path/01/day=21/',
        partitionValues: {
          month: '01',
          day: '21',
        },
      },
      {
        location: 's3://example-bucket/path/01/day=22/',
        partitionValues: {
          month: '01',
          day: '22',
        },
      },
    ]);
    expect(AWS.GlueMock).toHaveReceivedCommandTimes(
      AWS.GetPartitionsCommand,
      2
    );
    expect(AWS.GlueMock).toHaveReceivedNthCommandWith(
      2,
      AWS.GetPartitionsCommand,
      {
        DatabaseName: 'database',
        Name: 'table_name',
        NextToken: 'continue_token',
      }
    );
  });

  it('getPartitions', async () => {
    expect.assertions(3);
    AWS.GlueMock.on(AWS.GetTableCommand).resolves({
      Table: {
        PartitionKeys: [
          {
            Name: 'month',
          },
          {
            Name: 'day',
          },
        ],
      },
    });
    AWS.GlueMock.on(AWS.GetPartitionsCommand)
      .resolvesOnce({
        Partitions: [
          {
            StorageDescriptor: {
              Location: 's3://example-bucket/path/01/day=21/',
            },
            Values: ['01', '21'],
          },
        ],
      })
      .resolvesOnce({
        Partitions: [
          {
            StorageDescriptor: {
              Location: 's3://example-bucket/path/01/day=22/',
            },
            Values: ['01', '22'],
          },
        ],
      })
      .resolves({
        Partitions: [],
      });

    const glue = new Glue();
    const result = await glue.getPartitions({
      DatabaseName: 'database',
      Name: 'table_name',
    });
    expect(result).toStrictEqual([
      {
        location: 's3://example-bucket/path/01/day=21/',
        partitionValues: {
          month: '01',
          day: '21',
        },
      },
      {
        location: 's3://example-bucket/path/01/day=22/',
        partitionValues: {
          month: '01',
          day: '22',
        },
      },
    ]);
    expect(AWS.GlueMock).toHaveReceivedCommandTimes(
      AWS.GetPartitionsCommand,
      10
    );
    expect(AWS.GlueMock).toHaveReceivedCommandTimes(AWS.GetTableCommand, 1);
  });
});
