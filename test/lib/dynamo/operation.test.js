/* eslint-disable jest/no-large-snapshots */
/* eslint-disable jest/no-hooks */
'use strict';
const AWS = require('@aws-sdk/lib-dynamodb');
const AWSAthena = require('@aws-sdk/client-athena');
const {
  Resource,
  Operation,
  Action,
  Query,
} = require('../../../lambdas/lib/graph');
const Logger = require('../../../lambdas/lib/logging/logger');

process.env.OPERATIONS_TABLE = 'operations_table';
process.env.QUERY_TABLE = 'query_table';

const operation = jest.requireActual('../../../lambdas/lib/dynamo/operations');
/**
 * @type {jest.Mock}
 */
let query;
/**
 * @type {jest.Mock}
 */
let batchWrite;
/**
 * @type {jest.Mock}
 */
let put;

describe('dynamo resource db', () => {
  beforeAll(() => {
    const mockedDate = new Date(1466424490000);
    jest.useFakeTimers('modern');
    jest.setSystemTime(mockedDate);
    require('aws-sdk-client-mock-jest');
  });
  beforeEach(() => {
    // @ts-ignore
    put = AWS.spyOn('DynamoDBDocument', 'put');
    // @ts-ignore
    query = AWS.spyOn('DynamoDBDocument', 'query');
    // @ts-ignore
    batchWrite = AWS.spyOn('DynamoDBDocument', 'batchWrite');
  });

  afterEach(() => {
    // @ts-ignore
    AWS.clearAllMocks();
  });

  afterAll(() => {
    // @ts-ignore
    AWS.clearAllMocks();
    jest.useRealTimers();
  });

  it('putResource', async () => {
    expect.assertions(2);
    put.mockResolvedValue(undefined);
    await operation.putResource(
      new Resource({
        id: 'StackName',
        status: Resource.Status.ACTIVE,
        region: 'us-east-1',
        athena_workgroup: 'StackName',
        daemon_config: {
          Role: 'RoleArn',
        },
        source_properties: {
          arn: 'SourceArn',
          catalogId: 'SourceCatalogId',
          columns: [],
          compressed: false,
          databaseName: 'SourceDatabaseName',
          description: 'SourceDescription',
          name: 'SourceName',
          parameters: {},
          numberOfBuckets: 0,
          storedAsSubDirectories: false,
          region: 'us-east-1',
          tableType: 'PHYSICAL',
          tags: {},
        },
        destination_properties: {
          arn: 'DestinationArn',
          catalogId: 'SourceCatalogId',
          columns: [],
          compressed: false,
          databaseName: 'SourceDatabaseName',
          description: 'SourceDescription',
          name: 'SourceName',
          parameters: {},
          numberOfBuckets: 0,
          storedAsSubDirectories: false,
          region: 'us-east-1',
          tableType: 'PHYSICAL',
          tags: {},
        },
      })
    );
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]).toMatchInlineSnapshot(`
      [
        {
          "Item": {
            "data": {
              "athena_workgroup": "StackName",
              "created_at": 1466424490000,
              "daemon_config": {
                "Role": "RoleArn",
              },
              "destination_properties": {
                "arn": "DestinationArn",
                "catalogId": "SourceCatalogId",
                "columns": [],
                "compressed": false,
                "databaseName": "SourceDatabaseName",
                "description": "SourceDescription",
                "name": "SourceName",
                "numberOfBuckets": 0,
                "parameters": {},
                "region": "us-east-1",
                "storedAsSubDirectories": false,
                "tableType": "PHYSICAL",
                "tags": {},
              },
              "id": "StackName",
              "last_updated_at": 1466424490000,
              "record_type": "RESOURCE",
              "region": "us-east-1",
              "source_properties": {
                "arn": "SourceArn",
                "catalogId": "SourceCatalogId",
                "columns": [],
                "compressed": false,
                "databaseName": "SourceDatabaseName",
                "description": "SourceDescription",
                "name": "SourceName",
                "numberOfBuckets": 0,
                "parameters": {},
                "region": "us-east-1",
                "storedAsSubDirectories": false,
                "tableType": "PHYSICAL",
                "tags": {},
              },
              "source_region": undefined,
              "status": "ACTIVE",
              "wharfie_version": "0.0.11",
            },
            "resource_id": "StackName",
            "sort_key": "StackName",
          },
          "ReturnValues": "NONE",
          "TableName": "operations_table",
        },
      ]
    `);
  });

  it('getResource', async () => {
    expect.assertions(2);
    query.mockResolvedValue({
      Items: [
        {
          data: {
            athena_workgroup: 'StackName',
            created_at: 1727209948325,
            daemon_config: {
              Role: 'RoleArn',
            },
            destination_properties: {
              arn: 'DestinationArn',
              catalogId: 'SourceCatalogId',
              columns: [],
              compressed: false,
              databaseName: 'SourceDatabaseName',
              description: 'SourceDescription',
              name: 'SourceName',
              numberOfBuckets: 0,
              parameters: {},
              region: 'us-east-1',
              storedAsSubDirectories: false,
              tableType: 'PHYSICAL',
              tags: {},
            },
            id: 'StackName',
            last_updated_at: 1727209948325,
            record_type: 'RESOURCE',
            region: 'us-east-1',
            source_properties: {
              arn: 'SourceArn',
              catalogId: 'SourceCatalogId',
              columns: [],
              compressed: false,
              databaseName: 'SourceDatabaseName',
              description: 'SourceDescription',
              name: 'SourceName',
              numberOfBuckets: 0,
              parameters: {},
              region: 'us-east-1',
              storedAsSubDirectories: false,
              tableType: 'PHYSICAL',
              tags: {},
            },
            source_region: undefined,
            status: 'ACTIVE',
            wharfie_version: '0.0.11',
          },
          resource_id: 'StackName',
          sort_key: 'StackName',
        },
      ],
    });
    const result = await operation.getResource('resource_id');
    expect(query).toHaveBeenCalledTimes(1);
    expect(result).toMatchInlineSnapshot(`
      Resource {
        "athena_workgroup": "StackName",
        "created_at": 1727209948325,
        "daemon_config": {
          "Role": "RoleArn",
        },
        "destination_properties": {
          "arn": "DestinationArn",
          "catalogId": "SourceCatalogId",
          "columns": [],
          "compressed": false,
          "databaseName": "SourceDatabaseName",
          "description": "SourceDescription",
          "name": "SourceName",
          "numberOfBuckets": 0,
          "parameters": {},
          "region": "us-east-1",
          "storedAsSubDirectories": false,
          "tableType": "PHYSICAL",
          "tags": {},
        },
        "id": "StackName",
        "last_updated_at": 1727209948325,
        "region": "us-east-1",
        "source_properties": {
          "arn": "SourceArn",
          "catalogId": "SourceCatalogId",
          "columns": [],
          "compressed": false,
          "databaseName": "SourceDatabaseName",
          "description": "SourceDescription",
          "name": "SourceName",
          "numberOfBuckets": 0,
          "parameters": {},
          "region": "us-east-1",
          "storedAsSubDirectories": false,
          "tableType": "PHYSICAL",
          "tags": {},
        },
        "source_region": undefined,
        "status": "ACTIVE",
        "wharfie_version": "0.0.11",
      }
    `);
  });

  it('deleteResource', async () => {
    expect.assertions(4);
    query.mockResolvedValue({
      Items: [
        {
          resource_id: 'resource_id',
          sort_key: 'resource_id#operation',
        },
        {
          resource_id: 'resource_id',
          sort_key: 'resource_id#operation#action',
        },
        {
          resource_id: 'resource_id',
          sort_key: 'resource_id#operation#action#query',
        },
      ],
    });
    batchWrite.mockResolvedValue({ Item: { value: 10 } });
    await operation.deleteResource(
      new Resource({
        id: 'resource_id',
        status: Resource.Status.ACTIVE,
        region: 'us-east-1',
        athena_workgroup: 'StackName',
        daemon_config: {
          Role: 'RoleArn',
        },
        source_properties: {
          arn: 'SourceArn',
          catalogId: 'SourceCatalogId',
          columns: [],
          compressed: false,
          databaseName: 'SourceDatabaseName',
          description: 'SourceDescription',
          name: 'SourceName',
          parameters: {},
          numberOfBuckets: 0,
          storedAsSubDirectories: false,
          region: 'us-east-1',
          tableType: 'PHYSICAL',
          tags: {},
        },
        destination_properties: {
          arn: 'DestinationArn',
          catalogId: 'SourceCatalogId',
          columns: [],
          compressed: false,
          databaseName: 'SourceDatabaseName',
          description: 'SourceDescription',
          name: 'SourceName',
          parameters: {},
          numberOfBuckets: 0,
          storedAsSubDirectories: false,
          region: 'us-east-1',
          tableType: 'PHYSICAL',
          tags: {},
        },
      })
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[1]).toMatchInlineSnapshot(`undefined`);
    expect(batchWrite).toHaveBeenCalledTimes(1);
    expect(batchWrite.mock.calls[0]).toMatchInlineSnapshot(`
      [
        {
          "RequestItems": {
            "operations_table": [
              {
                "DeleteRequest": {
                  "Key": {
                    "resource_id": "resource_id",
                    "sort_key": "resource_id#operation",
                  },
                },
              },
              {
                "DeleteRequest": {
                  "Key": {
                    "resource_id": "resource_id",
                    "sort_key": "resource_id#operation#action",
                  },
                },
              },
              {
                "DeleteRequest": {
                  "Key": {
                    "resource_id": "resource_id",
                    "sort_key": "resource_id#operation#action#query",
                  },
                },
              },
            ],
          },
        },
      ]
    `);
  });

  it('putOperation', async () => {
    expect.assertions(2);
    query.mockResolvedValue({
      Items: [
        {
          resource_id: 'counter_name_1',
          sort_key: 'sortkey#operation',
        },
        {
          resource_id: 'counter_name_2',
          sort_key: 'sortkey#operation#action',
        },
        {
          resource_id: 'counter_name_2',
          sort_key: 'sortkey#operation#action#query',
        },
      ],
    });
    batchWrite.mockResolvedValue({ Item: { value: 10 } });

    const test_operation = new Operation({
      resource_id: 'resource_id',
      type: Operation.Type.MAINTAIN,
      id: 'test_operation',
    });
    const start_action = test_operation.createAction({
      type: Action.Type.START,
      id: 'start_action',
    });
    test_operation.createAction({
      type: Action.Type.FINISH,
      id: 'finish_action',
      dependsOn: [start_action],
    });
    await operation.putOperation(test_operation);
    expect(batchWrite).toHaveBeenCalledTimes(1);
    expect(batchWrite.mock.calls[0]).toMatchInlineSnapshot(`
      [
        {
          "RequestItems": {
            "operations_table": [
              {
                "PutRequest": {
                  "Item": {
                    "data": {
                      "id": "start_action",
                      "last_updated_at": 1466424490000,
                      "operation_id": "test_operation",
                      "record_type": "ACTION",
                      "resource_id": "resource_id",
                      "started_at": 1466424490000,
                      "status": "PENDING",
                      "type": "START",
                      "wharfie_version": "0.0.11",
                    },
                    "resource_id": "resource_id",
                    "sort_key": "resource_id#test_operation#start_action",
                  },
                },
              },
              {
                "PutRequest": {
                  "Item": {
                    "data": {
                      "id": "finish_action",
                      "last_updated_at": 1466424490000,
                      "operation_id": "test_operation",
                      "record_type": "ACTION",
                      "resource_id": "resource_id",
                      "started_at": 1466424490000,
                      "status": "PENDING",
                      "type": "FINISH",
                      "wharfie_version": "0.0.11",
                    },
                    "resource_id": "resource_id",
                    "sort_key": "resource_id#test_operation#finish_action",
                  },
                },
              },
              {
                "PutRequest": {
                  "Item": {
                    "data": {
                      "id": "test_operation",
                      "last_updated_at": 1466424490000,
                      "operation_config": undefined,
                      "operation_inputs": undefined,
                      "record_type": "OPERATION",
                      "resource_id": "resource_id",
                      "serialized_action_graph": "{"outgoingEdges":[["start_action",["finish_action"]]],"incomingEdges":[["finish_action",["start_action"]]],"actionIdsToTypes":[["start_action","START"],["finish_action","FINISH"]]}",
                      "started_at": 1466424490000,
                      "status": "PENDING",
                      "type": "MAINTAIN",
                      "wharfie_version": "0.0.11",
                    },
                    "resource_id": "resource_id",
                    "sort_key": "resource_id#test_operation",
                  },
                },
              },
            ],
          },
        },
      ]
    `);
  });

  it('getOperation', async () => {
    expect.assertions(3);
    query.mockResolvedValue({
      Items: [
        {
          data: {
            id: 'operation_id',
            last_updated_at: 1466424490000,
            operation_config: undefined,
            operation_inputs: undefined,
            record_type: 'OPERATION',
            resource_id: 'resource_id',
            serialized_action_graph: `{"outgoingEdges":[["start_action",["finish_action"]],["finish_action",[]]],"incomingEdges":[["start_action",[]],["finish_action",["start_action"]]],"actionIdsToTypes":[["start_action","START"],["finish_action","FINISH"]]}`,
            started_at: 1466424490000,
            status: 'PENDING',
            type: 'MAINTAIN',
            wharfie_version: '0.0.11',
          },
        },
      ],
    });
    const result = await operation.getOperation('resource_id', 'operation_id');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]).toMatchInlineSnapshot(`
      [
        {
          "ConsistentRead": true,
          "ExpressionAttributeValues": {
            ":resource_id": "resource_id",
            ":sort_key": "resource_id#operation_id",
          },
          "KeyConditionExpression": "resource_id = :resource_id AND sort_key = :sort_key",
          "TableName": "operations_table",
        },
      ]
    `);
    expect(result).toMatchInlineSnapshot(`
      Operation {
        "actionIdsToTypes": Map {
          "start_action" => "START",
          "finish_action" => "FINISH",
        },
        "actions": Map {},
        "id": "operation_id",
        "incomingEdges": Map {
          "finish_action" => [
            "start_action",
          ],
        },
        "last_updated_at": 1466424490000,
        "operation_config": undefined,
        "operation_inputs": undefined,
        "outgoingEdges": Map {
          "start_action" => [
            "finish_action",
          ],
        },
        "resource_id": "resource_id",
        "started_at": 1466424490000,
        "status": "PENDING",
        "type": "MAINTAIN",
        "wharfie_version": "0.0.11",
      }
    `);
  });

  it('getQuery', async () => {
    expect.assertions(3);
    const dateMock = jest.spyOn(Date, 'now').mockReturnValue(20123001200);
    query.mockResolvedValue({
      Items: [
        {
          data: {
            action_id: 'action_id',
            execution_id: undefined,
            id: 'query_id',
            last_updated_at: 20123001200,
            operation_id: 'operation_id',
            query_data: 'query_data 1',
            query_string: 'sql 1',
            record_type: 'QUERY',
            resource_id: 'resource_id',
            started_at: 20123001200,
            status: 'PENDING',
            wharfie_version: '0.0.11',
          },
          resource_id: 'resource_id',
          sort_key: 'resource_id#operation_id#action_id#query_id_1',
        },
      ],
    });
    const result = await operation.getQuery(
      'resource_id',
      'operation_id',
      'action_id',
      'query_id'
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]).toMatchInlineSnapshot(`
      [
        {
          "ConsistentRead": true,
          "ExpressionAttributeValues": {
            ":resource_id": "resource_id",
            ":sort_key": "resource_id#operation_id#action_id#query_id",
          },
          "KeyConditionExpression": "resource_id = :resource_id AND sort_key = :sort_key",
          "TableName": "operations_table",
        },
      ]
    `);
    expect(result).toMatchInlineSnapshot(`
      Query {
        "action_id": "action_id",
        "execution_id": undefined,
        "id": "query_id",
        "last_updated_at": 20123001200,
        "operation_id": "operation_id",
        "query_data": "query_data 1",
        "query_string": "sql 1",
        "resource_id": "resource_id",
        "started_at": 20123001200,
        "status": "PENDING",
        "wharfie_version": "0.0.11",
      }
    `);
    dateMock.mockClear();
  });

  it('getAction', async () => {
    expect.assertions(3);
    query.mockResolvedValue({
      Items: [
        {
          data: {
            id: 'action_id',
            last_updated_at: 1466424490000,
            operation_id: 'operation_id',
            record_type: 'ACTION',
            resource_id: 'resource_id',
            started_at: 1466424490000,
            status: 'PENDING',
            type: 'START',
            wharfie_version: '0.0.11',
          },
        },
      ],
    });
    const result = await operation.getAction(
      'resource_id',
      'operation_id',
      'action_id'
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]).toMatchInlineSnapshot(`
      [
        {
          "ConsistentRead": true,
          "ExpressionAttributeValues": {
            ":resource_id": "resource_id",
            ":sort_key": "resource_id#operation_id#action_id",
          },
          "KeyConditionExpression": "resource_id = :resource_id AND sort_key = :sort_key",
          "TableName": "operations_table",
        },
      ]
    `);
    expect(result).toMatchInlineSnapshot(`
      Action {
        "id": "action_id",
        "last_updated_at": 1466424490000,
        "operation_id": "operation_id",
        "queries": [],
        "resource_id": "resource_id",
        "started_at": 1466424490000,
        "status": "PENDING",
        "type": "START",
        "wharfie_version": "0.0.11",
      }
    `);
  });

  it('putAction', async () => {
    expect.assertions(2);
    batchWrite.mockResolvedValue({ Item: { value: 10 } });

    const test_operation = new Operation({
      resource_id: 'resource_id',
      id: 'operation_id',
      type: Operation.Type.MAINTAIN,
    });
    const test_action = test_operation.createAction({
      type: Action.Type.START,
      id: 'action_id',
    });
    await operation.putAction(test_action);
    expect(batchWrite).toHaveBeenCalledTimes(1);
    expect(batchWrite.mock.calls[0]).toMatchInlineSnapshot(`
      [
        {
          "RequestItems": {
            "operations_table": [
              {
                "PutRequest": {
                  "Item": {
                    "data": {
                      "id": "action_id",
                      "last_updated_at": 20123001200,
                      "operation_id": "operation_id",
                      "record_type": "ACTION",
                      "resource_id": "resource_id",
                      "started_at": 20123001200,
                      "status": "PENDING",
                      "type": "START",
                      "wharfie_version": "0.0.11",
                    },
                    "resource_id": "resource_id",
                    "sort_key": "resource_id#operation_id#action_id",
                  },
                },
              },
            ],
          },
        },
      ]
    `);
  });

  it('putQuery', async () => {
    expect.assertions(2);
    put.mockResolvedValue(undefined);
    const query = new Query({
      id: 'query_id_1',
      resource_id: 'resource_id',
      operation_id: 'operation_id',
      action_id: 'action_id',
      status: Query.Status.PENDING,
      query_string: 'sql 1',
      query_data: 'query_data 1',
    });
    await operation.putQuery(query);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]).toMatchInlineSnapshot(`
      [
        {
          "Item": {
            "data": {
              "action_id": "action_id",
              "execution_id": undefined,
              "id": "query_id_1",
              "last_updated_at": 20123001200,
              "operation_id": "operation_id",
              "query_data": "query_data 1",
              "query_string": "sql 1",
              "record_type": "QUERY",
              "resource_id": "resource_id",
              "started_at": 20123001200,
              "status": "PENDING",
              "wharfie_version": "0.0.11",
            },
            "resource_id": "resource_id",
            "sort_key": "resource_id#operation_id#action_id#query_id_1",
          },
          "TableName": "operations_table",
        },
      ]
    `);
  });

  it('putQueries', async () => {
    expect.assertions(2);
    batchWrite.mockResolvedValue({});

    const query1 = new Query({
      id: 'query_id_1',
      resource_id: 'resource_id',
      operation_id: 'operation_id',
      action_id: 'action_id',
      status: Query.Status.PENDING,
      query_string: 'sql 1',
      query_data: 'query_data 1',
    });
    const query2 = new Query({
      id: 'query_id_2',
      resource_id: 'resource_id',
      operation_id: 'operation_id',
      action_id: 'action_id',
      status: Query.Status.PENDING,
      query_string: 'sql 2',
      query_data: 'query_data 2',
    });
    await operation.putQueries([query1, query2]);
    expect(batchWrite).toHaveBeenCalledTimes(1);
    expect(batchWrite.mock.calls[0]).toMatchInlineSnapshot(`
      [
        {
          "RequestItems": {
            "operations_table": [
              {
                "PutRequest": {
                  "Item": {
                    "data": {
                      "action_id": "action_id",
                      "execution_id": undefined,
                      "id": "query_id_1",
                      "last_updated_at": 20123001200,
                      "operation_id": "operation_id",
                      "query_data": "query_data 1",
                      "query_string": "sql 1",
                      "record_type": "QUERY",
                      "resource_id": "resource_id",
                      "started_at": 20123001200,
                      "status": "PENDING",
                      "wharfie_version": "0.0.11",
                    },
                    "resource_id": "resource_id",
                    "sort_key": "resource_id#operation_id#action_id#query_id_1",
                  },
                },
              },
              {
                "PutRequest": {
                  "Item": {
                    "data": {
                      "action_id": "action_id",
                      "execution_id": undefined,
                      "id": "query_id_2",
                      "last_updated_at": 20123001200,
                      "operation_id": "operation_id",
                      "query_data": "query_data 2",
                      "query_string": "sql 2",
                      "record_type": "QUERY",
                      "resource_id": "resource_id",
                      "started_at": 20123001200,
                      "status": "PENDING",
                      "wharfie_version": "0.0.11",
                    },
                    "resource_id": "resource_id",
                    "sort_key": "resource_id#operation_id#action_id#query_id_2",
                  },
                },
              },
            ],
          },
        },
      ]
    `);
  });

  it('deleteOperation', async () => {
    expect.assertions(4);
    query.mockResolvedValue({
      Items: [
        {
          resource_id: 'resource_id',
          sort_key: 'resource_id#operation_id#action_id',
          data: {
            action_id: 'action_id',
            action_type: 'action_type',
            action_status: 'action_status',
          },
        },
        {
          resource_id: 'resource_id',
          sort_key: 'resource_id#operation_id#action_id#query_id_1',
          data: {
            query_id: 'query_id_1',
            query_status: 'query_status',
            query_execution_id: 'query_execution_id',
          },
        },
        {
          resource_id: 'resource_id',
          sort_key: 'resource_id#operation_id#action_id#query_id_2',
          data: {
            query_id: 'query_id_2',
            query_status: 'query_status',
          },
        },
      ],
    });
    batchWrite.mockResolvedValue({});

    const test_operation = new Operation({
      resource_id: 'resource_id',
      type: Operation.Type.MAINTAIN,
      id: 'operation_id',
    });
    await operation.deleteOperation(test_operation);
    expect(batchWrite).toHaveBeenCalledTimes(1);
    expect(batchWrite.mock.calls[0]).toMatchInlineSnapshot(`
      [
        {
          "RequestItems": {
            "operations_table": [
              {
                "DeleteRequest": {
                  "Key": {
                    "resource_id": "resource_id",
                    "sort_key": "resource_id#operation_id#action_id",
                  },
                },
              },
              {
                "DeleteRequest": {
                  "Key": {
                    "resource_id": "resource_id",
                    "sort_key": "resource_id#operation_id#action_id#query_id_1",
                  },
                },
              },
              {
                "DeleteRequest": {
                  "Key": {
                    "resource_id": "resource_id",
                    "sort_key": "resource_id#operation_id#action_id#query_id_2",
                  },
                },
              },
            ],
          },
        },
      ]
    `);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]).toMatchInlineSnapshot(`
      [
        {
          "ConsistentRead": true,
          "ExpressionAttributeValues": {
            ":resource_id": "resource_id",
            ":sort_key": "resource_id#operation_id",
          },
          "KeyConditionExpression": "resource_id = :resource_id AND begins_with(sort_key, :sort_key)",
          "ProjectionExpression": "resource_id, sort_key",
          "TableName": "operations_table",
        },
      ]
    `);
  });

  it('checkActionPrerequisites', async () => {
    expect.assertions(6);
    const dateMock = jest.spyOn(Date, 'now').mockReturnValueOnce(20123001200);
    // @ts-ignore
    AWSAthena.AthenaMock.on(AWSAthena.GetQueryExecutionCommand).resolves({
      QueryExecution: {
        Status: {
          State: 'RUNNING',
        },
      },
    });
    query.mockResolvedValue({
      Items: [
        {
          resource_id: 'resource_id',
          sort_key: 'resource_id#test_operation#start_action',
          data: {
            id: 'start_action',
            action_type: Action.Type.START,
            status: Action.Status.RUNNING,
            record_type: Action.RecordType,
          },
        },
        {
          resource_id: 'resource_id',
          sort_key: 'resource_id#test_operation#start_action#query_id_1',
          data: {
            last_updated_at: '2012300',
            id: 'query_id_1',
            status: Query.Status.RUNNING,
            execution_id: 'execution_id',
            record_type: Query.RecordType,
          },
        },
      ],
    });
    const logger = new Logger({
      level: 'error',
    });
    const test_operation = new Operation({
      resource_id: 'resource_id',
      type: Operation.Type.MAINTAIN,
      id: 'test_operation',
    });
    const start_action = test_operation.createAction({
      type: Action.Type.START,
      id: 'start_action',
    });
    test_operation.createAction({
      type: Action.Type.FINISH,
      id: 'finish_action',
      dependsOn: [start_action],
    });
    const prerequisites_met = await operation.checkActionPrerequisites(
      test_operation,
      Action.Type.FINISH,
      logger
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]).toMatchInlineSnapshot(`
      [
        {
          "ConsistentRead": true,
          "ExpressionAttributeValues": {
            ":resource_id": "resource_id",
            ":sort_key": "resource_id#test_operation#start_action",
          },
          "KeyConditionExpression": "resource_id = :resource_id AND begins_with(sort_key, :sort_key)",
          "TableName": "operations_table",
        },
      ]
    `);
    // @ts-ignore
    expect(AWSAthena.AthenaMock).toHaveReceivedCommandTimes(
      AWSAthena.GetQueryExecutionCommand,
      1
    );
    // @ts-ignore
    expect(AWSAthena.AthenaMock).toHaveReceivedCommandWith(
      AWSAthena.GetQueryExecutionCommand,
      {
        QueryExecutionId: 'execution_id',
      }
    );
    expect(prerequisites_met).toBe(false);
    dateMock.mockClear();
  });
});
