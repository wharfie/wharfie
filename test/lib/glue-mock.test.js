/* eslint-disable jest/no-hooks */
'use strict';

let Glue;
describe('tests for Glue', () => {
  beforeEach(() => {
    process.env.AWS_MOCKS = true;
    jest.requireMock('@aws-sdk/client-s3');
    Glue = require('../../lambdas/lib/glue');
  });
  afterAll(() => {
    process.env.AWS_MOCKS = false;
  });
  it('getTable mock', async () => {
    expect.assertions(1);
    const glueFoo = new Glue();
    glueFoo.glue.__setMockState({
      database_name: {
        _tables: {},
      },
    });
    await glueFoo.createTable({
      DatabaseName: 'database_name',
      TableInput: {
        Name: 'table_name',
        Description: 'some description',
        PartitionKeys: [{ Name: 'dt' }],
      },
    });
    const glueBar = new Glue();
    const result = await glueBar.getTable({
      DatabaseName: 'database_name',
      Name: 'table_name',
    });
    expect(result).toMatchInlineSnapshot(`
      Object {
        "Table": Object {
          "DatabaseName": "database_name",
          "Description": "some description",
          "Name": "table_name",
          "PartitionKeys": Array [
            Object {
              "Name": "dt",
            },
          ],
          "_partitions": Object {},
        },
      }
    `);
  });

  it('cloneDestinationTable mock', async () => {
    expect.assertions(1);
    const glue = new Glue();
    glue.glue.__setMockState({
      database_name: {
        _tables: {},
      },
    });
    await glue.createTable({
      DatabaseName: 'database_name',
      TableInput: {
        Name: 'table_name',
        Description: 'some description',
        PartitionKeys: [{ Name: 'dt' }],
      },
    });
    await glue.createTable({
      DatabaseName: 'database_name',
      TableInput: {
        Name: 'table_name_cloned',
        Description: 'some description',
        PartitionKeys: [{ Name: 'dt' }],
      },
    });
    await glue.cloneDestinationTable(
      {
        destination_properties: {
          TableInput: {
            StorageDescriptor: {
              Location: 's3://bucket/table/refrences/',
            },
          },
        },
      },
      {
        DatabaseName: 'database_name',
        Name: 'table_name',
      },
      'database_name',
      'table_name_cloned'
    );
    const result = await glue.getTable({
      DatabaseName: 'database_name',
      Name: 'table_name_cloned',
    });
    expect(result).toMatchInlineSnapshot(`
      Object {
        "Table": Object {
          "DatabaseName": "database_name",
          "Description": "some description",
          "Name": "table_name_cloned",
          "PartitionKeys": Array [
            Object {
              "Name": "dt",
            },
          ],
          "StorageDescriptor": Object {
            "InputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
            "Location": "s3://bucket/table/refrences/data/undefined/",
            "OutputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
          },
          "_partitions": Object {},
        },
      }
    `);
  });

  it('batch partition operations mock', async () => {
    expect.assertions(4);
    const glue = new Glue();
    glue.glue.__setMockState({
      database_name: {
        _tables: {},
      },
    });
    await glue.createTable({
      DatabaseName: 'database_name',
      TableInput: {
        Name: 'table_name',
        Description: 'some description',
        PartitionKeys: [{ Name: 'dt' }, { Name: 'hr' }],
      },
    });

    for (let dt = 0; dt < 10; dt++) {
      for (let hr = 0; hr < 10; hr++) {
        await glue.createPartition({
          DatabaseName: 'database_name',
          TableName: 'table_name',
          PartitionInput: {
            Values: [dt, hr],
            StorageDescriptor: {
              Location: 's3://bucket/location',
            },
          },
        });
      }
    }
    for (let dt = 5; dt < 15; dt++) {
      const input = [];
      for (let hr = 0; hr < 10; hr++) {
        input.push({
          Values: [dt, hr],
          StorageDescriptor: {
            Location: 's3://bucket/location',
          },
        });
      }
      await glue.batchCreatePartition({
        DatabaseName: 'database_name',
        TableName: 'table_name',
        PartitionInputList: input,
      });
    }

    const result = await glue.getPartitions({
      DatabaseName: 'database_name',
      TableName: 'table_name',
    });

    expect(result.length).toMatchInlineSnapshot(`150`);
    expect(result[0]).toMatchInlineSnapshot(`
      Object {
        "location": "s3://bucket/location",
        "partitionValues": Object {
          "dt": 0,
          "hr": 0,
        },
      }
    `);
    expect(result[result.length - 1]).toMatchInlineSnapshot(`
      Object {
        "location": "s3://bucket/location",
        "partitionValues": Object {
          "dt": 14,
          "hr": 9,
        },
      }
    `);

    await glue.batchDeletePartition({
      DatabaseName: 'database_name',
      TableName: 'table_name',
      PartitionsToDelete: result.map((partition) => {
        return {
          Values: [partition.partitionValues.dt, partition.partitionValues.hr],
        };
      }),
    });

    const result2 = await glue.getPartitions({
      DatabaseName: 'database_name',
      TableName: 'table_name',
    });

    expect(result2).toHaveLength(0);
  });
});
