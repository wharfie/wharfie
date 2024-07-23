/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = true;
const { Glue } = jest.requireMock('@aws-sdk/client-glue');

const { GlueTable } = require('../../../lambdas/lib/actor/resources/aws/');
const { deserialize } = require('../../../lambdas/lib/actor/deserialize');

describe('glue table IaC', () => {
  it('basic', async () => {
    expect.assertions(6);
    const glue = new Glue({});
    await glue.createDatabase({
      DatabaseInput: {
        Name: 'database_name',
      },
    });
    const table = new GlueTable({
      name: 'test_table',
      properties: {
        databaseName: 'database_name',
        location: 's3://bucket/path',
        description: 'table description',
        tableType: 'EXTERNAL',
        parameters: {
          1: '1',
          2: '2',
        },
        partitionKeys: [
          {
            name: 'key1',
            type: 'string',
          },
          {
            name: 'key2',
            type: 'string',
          },
        ],
        columns: [
          {
            name: 'column1',
            type: 'string',
          },
          {
            name: 'column2',
            type: 'string',
          },
        ],
        inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
        outputFormat:
          'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
        compressionType: 'gzip',
        numberOfBuckets: 0,
        storedAsSubDirectories: true,
        compressed: true,
        serdeInfo: {
          SerializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
          Parameters: {
            'serialization.format': '1',
          },
        },
        tags: {
          key1: 'value1',
          key2: 'value2',
        },
        region: 'us-east-1',
        catalogId: '123456789012',
      },
    });
    await table.reconcile();

    const serialized = table.serialize();
    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test_table",
        "properties": {
          "arn": "arn:aws:glue:us-east-1:123456789012:table/database_name/test_table",
          "catalogId": "123456789012",
          "columns": [
            {
              "name": "column1",
              "type": "string",
            },
            {
              "name": "column2",
              "type": "string",
            },
          ],
          "compressed": true,
          "compressionType": "gzip",
          "databaseName": "database_name",
          "description": "table description",
          "inputFormat": "org.apache.hadoop.mapred.TextInputFormat",
          "location": "s3://bucket/path",
          "numberOfBuckets": 0,
          "outputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
          "parameters": {
            "1": "1",
            "2": "2",
          },
          "partitionKeys": [
            {
              "name": "key1",
              "type": "string",
            },
            {
              "name": "key2",
              "type": "string",
            },
          ],
          "region": "us-east-1",
          "serdeInfo": {
            "Parameters": {
              "serialization.format": "1",
            },
            "SerializationLibrary": "org.openx.data.jsonserde.JsonSerDe",
          },
          "storedAsSubDirectories": true,
          "tableType": "EXTERNAL",
          "tags": {
            "key1": "value1",
            "key2": "value2",
          },
        },
        "resourceType": "GlueTable",
        "status": "STABLE",
      }
    `);

    const deserialized = deserialize(serialized);
    await deserialized.reconcile();
    expect(deserialized).toMatchInlineSnapshot(`
      GlueTable {
        "_MAX_RETRIES": 10,
        "_MAX_RETRY_TIMEOUT_SECONDS": 10,
        "_destroyErrors": [],
        "_reconcileErrors": [],
        "dependsOn": [],
        "glue": Glue {
          "glue": GlueMock {},
        },
        "name": "test_table",
        "properties": {
          "arn": [Function],
          "catalogId": "123456789012",
          "columns": [
            {
              "name": "column1",
              "type": "string",
            },
            {
              "name": "column2",
              "type": "string",
            },
          ],
          "compressed": true,
          "compressionType": "gzip",
          "databaseName": "database_name",
          "description": "table description",
          "inputFormat": "org.apache.hadoop.mapred.TextInputFormat",
          "location": "s3://bucket/path",
          "numberOfBuckets": 0,
          "outputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
          "parameters": {
            "1": "1",
            "2": "2",
          },
          "partitionKeys": [
            {
              "name": "key1",
              "type": "string",
            },
            {
              "name": "key2",
              "type": "string",
            },
          ],
          "region": "us-east-1",
          "serdeInfo": {
            "Parameters": {
              "serialization.format": "1",
            },
            "SerializationLibrary": "org.openx.data.jsonserde.JsonSerDe",
          },
          "storedAsSubDirectories": true,
          "tableType": "EXTERNAL",
          "tags": {
            "key1": "value1",
            "key2": "value2",
          },
        },
        "resourceType": "GlueTable",
        "status": "STABLE",
      }
    `);
    expect(deserialized.status).toBe('STABLE');

    const res = await glue.getTable({
      Name: table.name,
      DatabaseName: table.get('databaseName'),
    });

    expect(res).toMatchInlineSnapshot(`
      {
        "Table": {
          "DatabaseName": "database_name",
          "Description": "table description",
          "Name": "test_table",
          "Parameters": {
            "1": "1",
            "2": "2",
          },
          "PartitionKeys": [
            {
              "Comment": undefined,
              "Name": "key1",
              "Type": "string",
            },
            {
              "Comment": undefined,
              "Name": "key2",
              "Type": "string",
            },
          ],
          "StorageDescriptor": {
            "Columns": [
              {
                "Comment": undefined,
                "Name": "column1",
                "Type": "string",
              },
              {
                "Comment": undefined,
                "Name": "column2",
                "Type": "string",
              },
            ],
            "Compressed": true,
            "InputFormat": "org.apache.hadoop.mapred.TextInputFormat",
            "Location": "s3://bucket/path",
            "NumberOfBuckets": 0,
            "OutputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
            "SerdeInfo": {
              "Parameters": {
                "serialization.format": "1",
              },
              "SerializationLibrary": "org.openx.data.jsonserde.JsonSerDe",
            },
            "StoredAsSubDirectories": true,
          },
          "TableType": "EXTERNAL",
          "ViewExpandedText": undefined,
          "ViewOriginalText": undefined,
          "_partitions": {},
        },
      }
    `);
    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');
    await expect(
      glue.getTable({
        Name: table.name,
        DatabaseName: table.get('databaseName'),
      })
    ).rejects.toThrowErrorMatchingInlineSnapshot(`"table not found"`);
  });
});
