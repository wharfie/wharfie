/* eslint-disable jest/no-large-snapshots */
/* eslint-disable jest/no-hooks */
'use strict';

process.env.AWS_MOCKS = '1';
const { Resource } = require('../../../lambdas/lib/graph/');

const AWS = require('@aws-sdk/lib-dynamodb');
let query, _delete, put, update;

jest.mock('../../../lambdas/lib/dynamo/operations');
const operations_db = require('../../../lambdas/lib/dynamo/operations');
const { load } = require('../../../lambdas/lib/actor/deserialize');
const { getMockDeploymentProperties } = require('../util');
const WharfieResourceRecord = require('../../../lambdas/lib/actor/resources/records/wharfie-resource-record');
const Reconcilable = require('../../../lambdas/lib/actor/resources/reconcilable');

describe('wharfie resource record IaC', () => {
  beforeAll(() => {
    put = AWS.spyOn('DynamoDBDocument', 'put');
    query = AWS.spyOn('DynamoDBDocument', 'query');
    _delete = AWS.spyOn('DynamoDBDocument', 'delete');
    update = AWS.spyOn('DynamoDBDocument', 'update');
  });
  afterEach(() => {
    AWS.clearAllMocks();
  });
  it('basic', async () => {
    expect.assertions(14);
    const record = new WharfieResourceRecord({
      name: 'test-record',
      dependsOn: [],
      properties: {
        deployment: () => getMockDeploymentProperties(),
        data: () => {
          const resource = new Resource({
            id: 'resource_id',
            status: Resource.Status.ACTIVE,
            region: 'us-east-1',
            athena_workgroup: 'wharfie:StackName',
            daemon_config: {
              Role: 'test-role',
            },
            source_region: 'us-east-1',
            source_properties: {
              location: 's3://test-bucket/raw/',
              arn: 'SourceArn',
              catalogId: 'SourceCatalogId',
              columns: [],
              compressed: false,
              databaseName: 'test_db',
              name: 'table_name_raw',
              description: 'SourceDescription',
              parameters: {},
              numberOfBuckets: 0,
              storedAsSubDirectories: false,
              partitionKeys: [{ type: 'string', name: 'dt' }],
              region: 'us-east-1',
              tableType: 'PHYSICAL',
              tags: {},
            },
            destination_properties: {
              databaseName: 'test_db',
              name: 'table_name',
              partitionKeys: [{ type: 'string', name: 'dt' }],
              location: 's3://test-bucket/compacted/',
              arn: 'DestinationArn',
              catalogId: 'SourceCatalogId',
              columns: [],
              compressed: false,
              parameters: {},
              numberOfBuckets: 0,
              storedAsSubDirectories: false,
              region: 'us-east-1',
              tableType: 'PHYSICAL',
              tags: {},
            },
            created_at: 1730166492814,
          });
          return resource.toRecord();
        },
      },
    });
    await record.reconcile();

    const reconcilingStatusUpdate = update.mock.calls;

    const stableStatusUpdate = put.mock.calls
      .filter(([{ Item }]) => Item.status === Reconcilable.Status.STABLE)
      .map(([{ Item }]) => Item);

    expect(reconcilingStatusUpdate).toHaveLength(1);
    update.mock.calls = [];
    expect(stableStatusUpdate).toHaveLength(1);
    expect(stableStatusUpdate).toMatchInlineSnapshot(`
      [
        {
          "deployment": "test-deployment",
          "resource_key": "test-record",
          "serialized": {
            "dependsOn": [],
            "name": "test-record",
            "parent": "",
            "properties": {
              "data": {
                "data": {
                  "athena_workgroup": "wharfie:StackName",
                  "created_at": 1730166492814,
                  "daemon_config": {
                    "Role": "test-role",
                  },
                  "destination_properties": {
                    "arn": "DestinationArn",
                    "catalogId": "SourceCatalogId",
                    "columns": [],
                    "compressed": false,
                    "databaseName": "test_db",
                    "location": "s3://test-bucket/compacted/",
                    "name": "table_name",
                    "numberOfBuckets": 0,
                    "parameters": {},
                    "partitionKeys": [
                      {
                        "name": "dt",
                        "type": "string",
                      },
                    ],
                    "region": "us-east-1",
                    "storedAsSubDirectories": false,
                    "tableType": "PHYSICAL",
                    "tags": {},
                  },
                  "id": "resource_id",
                  "last_updated_at": 1730166492814,
                  "record_type": "RESOURCE",
                  "region": "us-east-1",
                  "resource_properties": undefined,
                  "source_properties": {
                    "arn": "SourceArn",
                    "catalogId": "SourceCatalogId",
                    "columns": [],
                    "compressed": false,
                    "databaseName": "test_db",
                    "description": "SourceDescription",
                    "location": "s3://test-bucket/raw/",
                    "name": "table_name_raw",
                    "numberOfBuckets": 0,
                    "parameters": {},
                    "partitionKeys": [
                      {
                        "name": "dt",
                        "type": "string",
                      },
                    ],
                    "region": "us-east-1",
                    "storedAsSubDirectories": false,
                    "tableType": "PHYSICAL",
                    "tags": {},
                  },
                  "source_region": "us-east-1",
                  "status": "ACTIVE",
                  "version": 0,
                  "wharfie_version": "0.0.12-0",
                },
                "resource_id": "resource_id",
                "sort_key": "resource_id",
              },
              "deployment": {
                "accountId": "123456789012",
                "envPaths": {
                  "cache": "",
                  "config": "",
                  "data": "",
                  "log": "",
                  "temp": "",
                },
                "name": "test-deployment",
                "region": "us-east-1",
                "stateTable": "_testing_state_table",
                "version": "0.0.1test",
              },
            },
            "resourceType": "WharfieResourceRecord",
            "status": "STABLE",
          },
          "status": "STABLE",
          "version": "0.0.1test",
        },
      ]
    `);

    expect(operations_db.__getMockState()).toMatchInlineSnapshot(`
      {
        "resource_id": {
          "athena_workgroup": "wharfie:StackName",
          "created_at": 1730166492814,
          "daemon_config": {
            "Role": "test-role",
          },
          "destination_properties": {
            "arn": "DestinationArn",
            "catalogId": "SourceCatalogId",
            "columns": [],
            "compressed": false,
            "databaseName": "test_db",
            "location": "s3://test-bucket/compacted/",
            "name": "table_name",
            "numberOfBuckets": 0,
            "parameters": {},
            "partitionKeys": [
              {
                "name": "dt",
                "type": "string",
              },
            ],
            "region": "us-east-1",
            "storedAsSubDirectories": false,
            "tableType": "PHYSICAL",
            "tags": {},
          },
          "id": "resource_id",
          "last_updated_at": 1730166492814,
          "record_type": "RESOURCE",
          "region": "us-east-1",
          "resource_properties": undefined,
          "source_properties": {
            "arn": "SourceArn",
            "catalogId": "SourceCatalogId",
            "columns": [],
            "compressed": false,
            "databaseName": "test_db",
            "description": "SourceDescription",
            "location": "s3://test-bucket/raw/",
            "name": "table_name_raw",
            "numberOfBuckets": 0,
            "parameters": {},
            "partitionKeys": [
              {
                "name": "dt",
                "type": "string",
              },
            ],
            "region": "us-east-1",
            "storedAsSubDirectories": false,
            "tableType": "PHYSICAL",
            "tags": {},
          },
          "source_region": "us-east-1",
          "status": "ACTIVE",
          "version": 0,
          "wharfie_version": "0.0.12-0",
        },
      }
    `);
    const serialized = record.serialize();
    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-record",
        "parent": "",
        "properties": {
          "data": {
            "data": {
              "athena_workgroup": "wharfie:StackName",
              "created_at": 1730166492814,
              "daemon_config": {
                "Role": "test-role",
              },
              "destination_properties": {
                "arn": "DestinationArn",
                "catalogId": "SourceCatalogId",
                "columns": [],
                "compressed": false,
                "databaseName": "test_db",
                "location": "s3://test-bucket/compacted/",
                "name": "table_name",
                "numberOfBuckets": 0,
                "parameters": {},
                "partitionKeys": [
                  {
                    "name": "dt",
                    "type": "string",
                  },
                ],
                "region": "us-east-1",
                "storedAsSubDirectories": false,
                "tableType": "PHYSICAL",
                "tags": {},
              },
              "id": "resource_id",
              "last_updated_at": 1730166492814,
              "record_type": "RESOURCE",
              "region": "us-east-1",
              "resource_properties": undefined,
              "source_properties": {
                "arn": "SourceArn",
                "catalogId": "SourceCatalogId",
                "columns": [],
                "compressed": false,
                "databaseName": "test_db",
                "description": "SourceDescription",
                "location": "s3://test-bucket/raw/",
                "name": "table_name_raw",
                "numberOfBuckets": 0,
                "parameters": {},
                "partitionKeys": [
                  {
                    "name": "dt",
                    "type": "string",
                  },
                ],
                "region": "us-east-1",
                "storedAsSubDirectories": false,
                "tableType": "PHYSICAL",
                "tags": {},
              },
              "source_region": "us-east-1",
              "status": "ACTIVE",
              "version": 0,
              "wharfie_version": "0.0.12-0",
            },
            "resource_id": "resource_id",
            "sort_key": "resource_id",
          },
          "deployment": {
            "accountId": "123456789012",
            "envPaths": {
              "cache": "",
              "config": "",
              "data": "",
              "log": "",
              "temp": "",
            },
            "name": "test-deployment",
            "region": "us-east-1",
            "stateTable": "_testing_state_table",
            "version": "0.0.1test",
          },
        },
        "resourceType": "WharfieResourceRecord",
        "status": "STABLE",
      }
    `);

    query.mockResolvedValueOnce({
      Items: put.mock.calls
        .filter(([{ Item }]) => Item.status === Reconcilable.Status.STABLE)
        .map((call) => call[0].Item),
    });
    const deserialized = await load({
      deploymentName: 'test-deployment',
      resourceKey: 'test-record',
    });
    await deserialized.reconcile();
    expect(deserialized.resolveProperties()).toMatchInlineSnapshot(`
      {
        "data": {
          "data": {
            "athena_workgroup": "wharfie:StackName",
            "created_at": 1730166492814,
            "daemon_config": {
              "Role": "test-role",
            },
            "destination_properties": {
              "arn": "DestinationArn",
              "catalogId": "SourceCatalogId",
              "columns": [],
              "compressed": false,
              "databaseName": "test_db",
              "location": "s3://test-bucket/compacted/",
              "name": "table_name",
              "numberOfBuckets": 0,
              "parameters": {},
              "partitionKeys": [
                {
                  "name": "dt",
                  "type": "string",
                },
              ],
              "region": "us-east-1",
              "storedAsSubDirectories": false,
              "tableType": "PHYSICAL",
              "tags": {},
            },
            "id": "resource_id",
            "last_updated_at": 1730166492814,
            "record_type": "RESOURCE",
            "region": "us-east-1",
            "resource_properties": undefined,
            "source_properties": {
              "arn": "SourceArn",
              "catalogId": "SourceCatalogId",
              "columns": [],
              "compressed": false,
              "databaseName": "test_db",
              "description": "SourceDescription",
              "location": "s3://test-bucket/raw/",
              "name": "table_name_raw",
              "numberOfBuckets": 0,
              "parameters": {},
              "partitionKeys": [
                {
                  "name": "dt",
                  "type": "string",
                },
              ],
              "region": "us-east-1",
              "storedAsSubDirectories": false,
              "tableType": "PHYSICAL",
              "tags": {},
            },
            "source_region": "us-east-1",
            "status": "ACTIVE",
            "version": 0,
            "wharfie_version": "0.0.12-0",
          },
          "resource_id": "resource_id",
          "sort_key": "resource_id",
        },
        "deployment": {
          "accountId": "123456789012",
          "envPaths": {
            "cache": "",
            "config": "",
            "data": "",
            "log": "",
            "temp": "",
          },
          "name": "test-deployment",
          "region": "us-east-1",
          "stateTable": "_testing_state_table",
          "version": "0.0.1test",
        },
      }
    `);
    expect(deserialized.status).toBe('STABLE');

    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');

    const destroyingStatusUpdate = update.mock.calls;
    const destroyedStatusUpdate = put.mock.calls
      .filter(([{ Item }]) => Item.status === Reconcilable.Status.DESTROYED)
      .map(([{ Item }]) => Item);

    expect(destroyingStatusUpdate).toHaveLength(1);
    expect(destroyedStatusUpdate).toHaveLength(0);

    expect(operations_db.__getMockState()).toStrictEqual({});

    expect(put).toHaveBeenCalledTimes(1);
    expect(_delete).toHaveBeenCalledTimes(1);
    expect(_delete.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "Key": {
              "deployment": "test-deployment",
              "resource_key": "test-record",
            },
            "TableName": "_testing_state_table",
          },
        ],
      ]
    `);
  });
});
