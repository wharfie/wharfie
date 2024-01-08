/* eslint-disable jest/no-hooks */
'use strict';
const AWS = require('@aws-sdk/lib-dynamodb');
const AWSAthena = require('@aws-sdk/client-athena');
const { OperationActionGraph, Action } = require('../../../lambdas/lib/graph/');
const Logger = require('../../../lambdas/lib/logging/logger');

process.env.QUERY_TABLE = 'query_table';

const resource = jest.requireActual('../../../lambdas/lib/dynamo/resource');

let query, batchWrite, put;

describe('dynamo resource db', () => {
  beforeAll(() => {
    require('aws-sdk-client-mock-jest');
    put = AWS.spyOn('DynamoDBDocument', 'put');
    query = AWS.spyOn('DynamoDBDocument', 'query');
    batchWrite = AWS.spyOn('DynamoDBDocument', 'batchWrite');
  });

  afterAll(() => {
    AWS.clearAllMocks();
    AWS.AthenaMock.reset();
  });

  it('putResource', async () => {
    expect.assertions(2);
    put.mockResolvedValue(undefined);
    await resource.putResource({
      resource_id: 'StackName',
      resource_arn: 'StackId',
      athena_workgroup: 'StackName',
      daemon_config: {},
      source_properties: {},
      destination_properties: {},
      wharfie_version: '1.0.0',
    });
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]).toMatchInlineSnapshot(`
      Array [
        Object {
          "Item": Object {
            "data": Object {
              "athena_workgroup": "StackName",
              "daemon_config": Object {},
              "destination_properties": Object {},
              "resource_arn": "StackId",
              "source_properties": Object {},
              "wharfie_version": "1.0.0",
            },
            "resource_id": "StackName",
            "sort_key": "StackName",
          },
          "ReturnValues": "NONE",
          "TableName": "",
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
            daemon_config: {},
            source_properties: {},
            destination_properties: {},
          },
        },
      ],
    });
    const result = await resource.getResource('resource_id');
    expect(query).toHaveBeenCalledTimes(1);
    expect(result).toMatchInlineSnapshot(`
      Object {
        "daemon_config": Object {},
        "destination_properties": Object {},
        "resource_id": "resource_id",
        "source_properties": Object {},
      }
    `);
  });

  it('deleteResource', async () => {
    expect.assertions(4);
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
    await resource.deleteResource('resource_id');
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]).toMatchInlineSnapshot(`
      Array [
        Object {
          "ConsistentRead": true,
          "ExpressionAttributeValues": Object {
            ":resource_id": "resource_id",
          },
          "KeyConditionExpression": "resource_id = :resource_id AND begins_with(sort_key, :resource_id)",
          "ProjectionExpression": "resource_id, sort_key",
          "TableName": "",
        },
      ]
    `);
    expect(batchWrite).toHaveBeenCalledTimes(1);
    expect(batchWrite.mock.calls[0]).toMatchInlineSnapshot(`
      Array [
        Object {
          "RequestItems": Object {
            "": Array [
              Object {
                "DeleteRequest": Object {
                  "Key": Object {
                    "resource_id": "counter_name_1",
                    "sort_key": "sortkey#operation",
                  },
                },
              },
              Object {
                "DeleteRequest": Object {
                  "Key": Object {
                    "resource_id": "counter_name_2",
                    "sort_key": "sortkey#operation#action",
                  },
                },
              },
              Object {
                "DeleteRequest": Object {
                  "Key": Object {
                    "resource_id": "counter_name_2",
                    "sort_key": "sortkey#operation#action#query",
                  },
                },
              },
            ],
          },
        },
      ]
    `);
  });

  it('createOperation', async () => {
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
    const action_graph = new OperationActionGraph();
    await resource.createOperation({
      resource_id: 'resource_id',
      operation_id: 'operation_id',
      operation_type: 'operation_type',
      operation_status: 'RUNNING',
      started_at: 123124,
      last_updated_at: 123124,
      operation_config: {},
      action_graph,
      actions: [
        {
          action_id: 'action_id',
          action_type: 'action_type',
          action_status: 'action_status',
          queries: [],
        },
      ],
    });
    expect(batchWrite).toHaveBeenCalledTimes(2);
    expect(batchWrite.mock.calls[1]).toMatchInlineSnapshot(`
      Array [
        Object {
          "RequestItems": Object {
            "": Array [
              Object {
                "PutRequest": Object {
                  "Item": Object {
                    "data": Object {
                      "action_graph": "{\\"adjacencyList\\":[],\\"incomingEdges\\":[],\\"actions\\":[]}",
                      "last_updated_at": 123124,
                      "operation_config": Object {},
                      "operation_id": "operation_id",
                      "operation_inputs": undefined,
                      "operation_status": "RUNNING",
                      "operation_type": "operation_type",
                      "resource_id": "resource_id",
                      "started_at": 123124,
                    },
                    "resource_id": "resource_id",
                    "sort_key": "resource_id#operation_id",
                  },
                },
              },
              Object {
                "PutRequest": Object {
                  "Item": Object {
                    "data": Object {
                      "action_id": "action_id",
                      "action_status": "action_status",
                      "action_type": "action_type",
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

  it('getOperation', async () => {
    expect.assertions(3);
    const action_graph = new OperationActionGraph();
    query.mockResolvedValue({
      Items: [
        {
          data: {
            resource_id: 'resource_id',
            operation_id: 'operation_id',
            operation_type: 'operation_type',
            operation_status: 'RUNNING',
            started_at: 123124,
            last_updated_at: 123124,
            operation_config: {},
            action_graph: action_graph.serialize(),
          },
        },
      ],
    });
    const result = await resource.getOperation('resource_id', 'operation_id');
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[2]).toMatchInlineSnapshot(`
      Array [
        Object {
          "ConsistentRead": true,
          "ExpressionAttributeValues": Object {
            ":resource_id": "resource_id",
            ":sort_key": "resource_id#operation_id",
          },
          "KeyConditionExpression": "resource_id = :resource_id AND sort_key = :sort_key",
          "TableName": "",
        },
      ]
    `);
    expect(result).toMatchInlineSnapshot(`
      Object {
        "action_graph": OperationActionGraph {
          "actions": Array [],
          "adjacencyList": Map {},
          "incomingEdges": Map {},
        },
        "last_updated_at": 123124,
        "operation_config": Object {},
        "operation_id": "operation_id",
        "operation_status": "RUNNING",
        "operation_type": "operation_type",
        "resource_id": "resource_id",
        "started_at": 123124,
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
            query_id: 'query_id',
            query_status: 'WAITING',
            query_string: 'query_string',
            last_updated_at: '20123001200',
            action_inputs: {
              an_input: 123,
            },
          },
        },
      ],
    });
    const result = await resource.getQuery(
      'resource_id',
      'operation_id',
      'action_id',
      'query_id'
    );
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[3]).toMatchInlineSnapshot(`
      Array [
        Object {
          "ConsistentRead": true,
          "ExpressionAttributeValues": Object {
            ":resource_id": "resource_id",
            ":sort_key": "resource_id#operation_id#action_id#query_id",
          },
          "KeyConditionExpression": "resource_id = :resource_id AND sort_key = :sort_key",
          "TableName": "",
        },
      ]
    `);
    expect(result).toMatchInlineSnapshot(`
      Object {
        "action_inputs": Object {
          "an_input": 123,
        },
        "last_updated_at": 20123001200,
        "query_id": "query_id",
        "query_status": "WAITING",
        "query_string": "query_string",
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
            action_id: 'action_id',
            action_type: 'action_type',
            action_status: 'action_status',
          },
        },
      ],
    });
    const result = await resource.getAction(
      'resource_id',
      'operation_id',
      'action_id'
    );
    expect(query).toHaveBeenCalledTimes(5);
    expect(query.mock.calls[4]).toMatchInlineSnapshot(`
      Array [
        Object {
          "ConsistentRead": true,
          "ExpressionAttributeValues": Object {
            ":resource_id": "resource_id",
            ":sort_key": "resource_id#operation_id#action_id",
          },
          "KeyConditionExpression": "resource_id = :resource_id AND sort_key = :sort_key",
          "TableName": "",
        },
      ]
    `);
    expect(result).toMatchInlineSnapshot(`
      Object {
        "action_id": "action_id",
        "action_status": "action_status",
        "action_type": "action_type",
      }
    `);
  });

  it('getActionQueries', async () => {
    expect.assertions(3);
    query.mockResolvedValue({
      Items: [
        {
          data: {
            query_id: 'query_id_1',
            query_status: 'query_status',
            query_execution_id: 'query_execution_id',
          },
        },
        {
          data: {
            query_id: 'query_id_2',
            query_status: 'query_status',
          },
        },
      ],
    });
    const result = await resource.getActionQueries(
      'resource_id',
      'operation_id',
      'action_id'
    );
    expect(query).toHaveBeenCalledTimes(6);
    expect(query.mock.calls[5]).toMatchInlineSnapshot(`
      Array [
        Object {
          "ConsistentRead": true,
          "ExpressionAttributeNames": Object {
            "#data": "data",
          },
          "ExpressionAttributeValues": Object {
            ":resource_id": "resource_id",
            ":sort_key": "resource_id#operation_id#action_id#",
          },
          "KeyConditionExpression": "resource_id = :resource_id AND begins_with(sort_key, :sort_key)",
          "ProjectionExpression": "resource_id, sort_key, #data.query_id, #data.query_execution_id, #data.query_status",
          "TableName": "",
        },
      ]
    `);
    expect(result).toMatchInlineSnapshot(`
      Array [
        Object {
          "query_execution_id": "query_execution_id",
          "query_id": "query_id_1",
          "query_status": "query_status",
        },
        Object {
          "query_id": "query_id_2",
          "query_status": "query_status",
        },
      ]
    `);
  });

  it('putOperation', async () => {
    expect.assertions(2);
    put.mockResolvedValue(undefined);
    const action_graph = new OperationActionGraph();
    await resource.putOperation('resource_id', {
      operation_id: 'operation_id',
      operation_type: 'operation_type',
      operation_status: 'operation_status',
      operation_config: {},
      action_graph,
      started_at: 123,
      last_updated_at: 123,
    });
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[1]).toMatchInlineSnapshot(`
      Array [
        Object {
          "Item": Object {
            "data": Object {
              "action_graph": "{\\"adjacencyList\\":[],\\"incomingEdges\\":[],\\"actions\\":[]}",
              "last_updated_at": 123,
              "operation_config": Object {},
              "operation_id": "operation_id",
              "operation_inputs": undefined,
              "operation_status": "operation_status",
              "operation_type": "operation_type",
              "resource_id": "resource_id",
              "started_at": 123,
            },
            "resource_id": "resource_id",
            "sort_key": "resource_id#operation_id",
          },
          "TableName": "",
        },
      ]
    `);
  });

  it('putAction', async () => {
    expect.assertions(2);
    put.mockResolvedValue(undefined);
    await resource.putAction('resource_id', 'operation_id', {
      action_id: 'action_id',
      action_type: 'action_type',
      action_status: 'action_status',
    });
    expect(put).toHaveBeenCalledTimes(3);
    expect(put.mock.calls[2]).toMatchInlineSnapshot(`
      Array [
        Object {
          "Item": Object {
            "data": Object {
              "action_id": "action_id",
              "action_status": "action_status",
              "action_type": "action_type",
            },
            "resource_id": "resource_id",
            "sort_key": "resource_id#operation_id#action_id",
          },
          "TableName": "",
        },
      ]
    `);
  });

  it('putQuery', async () => {
    expect.assertions(3);
    const dateMock = jest.spyOn(Date, 'now').mockReturnValueOnce(20123001200);
    put.mockResolvedValue(undefined);
    await resource.putQuery('resource_id', 'operation_id', 'action_id', {
      query_id: 'query_id',
      query_status: 'query_status',
      query_execution_id: 'query_execution_id',
    });
    expect(put).toHaveBeenCalledTimes(4);
    expect(put.mock.calls[3]).toMatchInlineSnapshot(`
      Array [
        Object {
          "Item": Object {
            "data": Object {
              "last_updated_at": 20123001200,
              "query_data": undefined,
              "query_execution_id": "query_execution_id",
              "query_id": "query_id",
              "query_status": "query_status",
            },
            "resource_id": "resource_id",
            "sort_key": "resource_id#operation_id#action_id#query_id",
          },
          "TableName": "",
        },
      ]
    `);
    expect(dateMock).toHaveBeenCalledTimes(1);
    dateMock.mockClear();
  });

  it('putQueries', async () => {
    expect.assertions(2);
    const dateMock = jest.spyOn(Date, 'now').mockReturnValue(20123001201);
    batchWrite.mockResolvedValue({});
    await resource.putQueries('resource_id', 'operation_id', 'action_id', [
      {
        query_id: 'query_id_1',
        query_status: 'query_status',
        query_execution_id: 'query_execution_id_1',
      },
      {
        query_id: 'query_id_2',
        query_status: 'query_status',
        query_execution_id: 'query_execution_id_2',
      },
    ]);
    expect(batchWrite).toHaveBeenCalledTimes(3);
    expect(batchWrite.mock.calls[2]).toMatchInlineSnapshot(`
      Array [
        Object {
          "RequestItems": Object {
            "": Array [
              Object {
                "PutRequest": Object {
                  "Item": Object {
                    "data": Object {
                      "last_updated_at": 20123001201,
                      "query_data": undefined,
                      "query_execution_id": "query_execution_id_1",
                      "query_id": "query_id_1",
                      "query_status": "query_status",
                    },
                    "resource_id": "resource_id",
                    "sort_key": "resource_id#operation_id#action_id#query_id_1",
                  },
                },
              },
              Object {
                "PutRequest": Object {
                  "Item": Object {
                    "data": Object {
                      "last_updated_at": 20123001201,
                      "query_data": undefined,
                      "query_execution_id": "query_execution_id_2",
                      "query_id": "query_id_2",
                      "query_status": "query_status",
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
    dateMock.mockClear();
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
    await resource.deleteOperation('resource_id', 'operation_id');
    expect(batchWrite).toHaveBeenCalledTimes(4);
    expect(batchWrite.mock.calls[3]).toMatchInlineSnapshot(`
      Array [
        Object {
          "RequestItems": Object {
            "": Array [
              Object {
                "DeleteRequest": Object {
                  "Key": Object {
                    "resource_id": "resource_id",
                    "sort_key": "resource_id#operation_id#action_id",
                  },
                },
              },
              Object {
                "DeleteRequest": Object {
                  "Key": Object {
                    "resource_id": "resource_id",
                    "sort_key": "resource_id#operation_id#action_id#query_id_1",
                  },
                },
              },
              Object {
                "DeleteRequest": Object {
                  "Key": Object {
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
    expect(query).toHaveBeenCalledTimes(7);
    expect(query.mock.calls[6]).toMatchInlineSnapshot(`
      Array [
        Object {
          "ConsistentRead": true,
          "ExpressionAttributeValues": Object {
            ":resource_id": "resource_id",
            ":sort_key": "resource_id#operation_id",
          },
          "KeyConditionExpression": "resource_id = :resource_id AND begins_with(sort_key, :sort_key)",
          "ProjectionExpression": "resource_id, sort_key",
          "TableName": "",
        },
      ]
    `);
  });

  it('checkActionPrerequisites', async () => {
    expect.assertions(6);
    const dateMock = jest.spyOn(Date, 'now').mockReturnValueOnce(20123001200);
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
          sort_key: 'resource_id#operation_id#action_id',
          data: {
            action_id: 'action_id',
            action_type: 'START',
            action_status: 'INCOMPLETE',
          },
        },
        {
          resource_id: 'resource_id',
          sort_key: 'resource_id#operation_id#action_id#query_id_1',
          data: {
            last_updated_at: '2012300',
            query_id: 'query_id_1',
            query_status: 'RUNNING',
            query_execution_id: 'query_execution_id',
          },
        },
      ],
    });
    const logger = new Logger();
    const action_graph = new OperationActionGraph();
    const start_action = new Action({
      type: 'START',
      id: 'action_id',
    });
    const finish_action = new Action({
      type: 'FINISH',
      id: 'finish_action_id',
    });
    action_graph.addActions([start_action, finish_action]);
    action_graph.addDependency(start_action, finish_action);

    const operation = {
      operation_id: 'operation_id',
      operation_type: 'operation_type',
      operation_status: 'operation_status',
      operation_config: {},
      action_graph,
      started_at: 123,
      last_updated_at: 123,
    };
    const prerequisites_met = await resource.checkActionPrerequisites(
      operation,
      'FINISH',
      logger
    );
    expect(query).toHaveBeenCalledTimes(8);
    expect(query.mock.calls[7]).toMatchInlineSnapshot(`
      Array [
        Object {
          "ConsistentRead": true,
          "ExpressionAttributeValues": Object {
            ":resource_id": undefined,
            ":sort_key": "undefined#operation_id#action_id",
          },
          "KeyConditionExpression": "resource_id = :resource_id AND begins_with(sort_key, :sort_key)",
          "TableName": "",
        },
      ]
    `);
    expect(AWSAthena.AthenaMock).toHaveReceivedCommandTimes(
      AWSAthena.GetQueryExecutionCommand,
      1
    );
    expect(AWSAthena.AthenaMock).toHaveReceivedCommandWith(
      AWSAthena.GetQueryExecutionCommand,
      {
        QueryExecutionId: 'query_execution_id',
      }
    );
    expect(prerequisites_met).toBe(false);
    dateMock.mockClear();
  });
});
