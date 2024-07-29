/* eslint-disable jest/no-hooks */
'use strict';

const { OperationActionGraph, Action } = require('../../../lambdas/lib/graph/');
jest.mock('../../../lambdas/lib/dynamo/resource');

const resource = require('../../../lambdas/lib/dynamo/resource');

describe('dynamo resource db', () => {
  afterEach(() => {
    resource.__setMockState();
  });

  it('putResource', async () => {
    expect.assertions(1);
    await resource.putResource({
      resource_id: 'StackName',
      resource_arn: 'StackId',
      athena_workgroup: 'StackName',
      daemon_config: {},
      source_properties: {},
      destination_properties: {},
      wharfie_version: '1.0.0',
    });
    expect(resource.__getMockState()).toMatchInlineSnapshot(`
      {
        "StackName": {
          "StackName": {
            "athena_workgroup": "StackName",
            "daemon_config": {},
            "destination_properties": {},
            "resource_arn": "StackId",
            "resource_id": "StackName",
            "source_properties": {},
            "wharfie_version": "1.0.0",
          },
        },
      }
    `);
  });

  it('getResource', async () => {
    expect.assertions(1);
    await resource.putResource({
      resource_id: 'StackName',
      resource_arn: 'StackId',
      athena_workgroup: 'StackName',
      daemon_config: {},
      source_properties: {},
      destination_properties: {},
      wharfie_version: '1.0.0',
    });
    const result = await resource.getResource('StackName');
    expect(result).toMatchInlineSnapshot(`
      {
        "athena_workgroup": "StackName",
        "daemon_config": {},
        "destination_properties": {},
        "resource_arn": "StackId",
        "resource_id": "StackName",
        "source_properties": {},
        "wharfie_version": "1.0.0",
      }
    `);
  });

  it('deleteResource', async () => {
    expect.assertions(1);
    await resource.putResource({
      resource_id: 'StackName',
      resource_arn: 'StackId',
      athena_workgroup: 'StackName',
      daemon_config: {},
      source_properties: {},
      destination_properties: {},
      wharfie_version: '1.0.0',
    });
    await resource.deleteResource('StackName');
    expect(resource.__getMockState()).toMatchInlineSnapshot(`{}`);
  });

  it('createOperation', async () => {
    expect.assertions(1);
    const action_graph = new OperationActionGraph();
    await resource.putResource({
      resource_id: 'resource_id',
      resource_arn: 'StackId',
      athena_workgroup: 'StackName',
      daemon_config: {},
      source_properties: {},
      destination_properties: {},
      wharfie_version: '1.0.0',
    });
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
    expect(resource.__getMockState()).toMatchInlineSnapshot(`
      {
        "resource_id": {
          "resource_id": {
            "athena_workgroup": "StackName",
            "daemon_config": {},
            "destination_properties": {},
            "resource_arn": "StackId",
            "resource_id": "resource_id",
            "source_properties": {},
            "wharfie_version": "1.0.0",
          },
          "resource_id#operation_id": {
            "action_graph": OperationActionGraph {
              "actions": [],
              "incomingEdges": Map {},
              "outgoingEdges": Map {},
            },
            "last_updated_at": 123124,
            "operation_config": {},
            "operation_id": "operation_id",
            "operation_inputs": undefined,
            "operation_status": "RUNNING",
            "operation_type": "operation_type",
            "resource_id": "resource_id",
            "started_at": 123124,
          },
          "resource_id#operation_id#action_id": {
            "action_id": "action_id",
            "action_status": "action_status",
            "action_type": "action_type",
          },
        },
      }
    `);
  });

  it('getOperation', async () => {
    expect.assertions(1);
    const action_graph = new OperationActionGraph();
    await resource.putResource({
      resource_id: 'resource_id',
      resource_arn: 'StackId',
      athena_workgroup: 'StackName',
      daemon_config: {},
      source_properties: {},
      destination_properties: {},
      wharfie_version: '1.0.0',
    });
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
    const result = await resource.getOperation('resource_id', 'operation_id');
    expect(result).toMatchInlineSnapshot(`
      {
        "action_graph": OperationActionGraph {
          "actions": [],
          "incomingEdges": Map {},
          "outgoingEdges": Map {},
        },
        "last_updated_at": 123124,
        "operation_config": {},
        "operation_id": "operation_id",
        "operation_inputs": undefined,
        "operation_status": "RUNNING",
        "operation_type": "operation_type",
        "resource_id": "resource_id",
        "started_at": 123124,
      }
    `);
  });

  it('getAction', async () => {
    expect.assertions(1);
    const action_graph = new OperationActionGraph();
    await resource.putResource({
      resource_id: 'resource_id',
      resource_arn: 'StackId',
      athena_workgroup: 'StackName',
      daemon_config: {},
      source_properties: {},
      destination_properties: {},
      wharfie_version: '1.0.0',
    });
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
    const result = await resource.getOperation(
      'resource_id',
      'operation_id',
      'action_id'
    );
    expect(result).toMatchInlineSnapshot(`
      {
        "action_graph": OperationActionGraph {
          "actions": [],
          "incomingEdges": Map {},
          "outgoingEdges": Map {},
        },
        "last_updated_at": 123124,
        "operation_config": {},
        "operation_id": "operation_id",
        "operation_inputs": undefined,
        "operation_status": "RUNNING",
        "operation_type": "operation_type",
        "resource_id": "resource_id",
        "started_at": 123124,
      }
    `);
  });

  it('getActionQueries', async () => {
    expect.assertions(1);
    const action_graph = new OperationActionGraph();
    await resource.putResource({
      resource_id: 'resource_id',
      resource_arn: 'StackId',
      athena_workgroup: 'StackName',
      daemon_config: {},
      source_properties: {},
      destination_properties: {},
      wharfie_version: '1.0.0',
    });
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
          queries: [
            {
              query_id: 'query_id_1',
              query_status: 'query_status',
              query_execution_id: 'query_execution_id_1',
            },
            {
              query_id: 'query_id_2',
              query_status: 'query_status',
              query_execution_id: 'query_execution_id_1',
            },
          ],
        },
      ],
    });
    const result = await resource.getActionQueries(
      'resource_id',
      'operation_id',
      'action_id'
    );
    expect(result).toMatchInlineSnapshot(`
      [
        {
          "query_execution_id": "query_execution_id_1",
          "query_id": "query_id_1",
          "query_status": "query_status",
        },
        {
          "query_execution_id": "query_execution_id_1",
          "query_id": "query_id_2",
          "query_status": "query_status",
        },
      ]
    `);
  });
  it('getQueries', async () => {
    expect.assertions(1);
    const action_graph = new OperationActionGraph();
    await resource.putResource({
      resource_id: 'resource_id',
      resource_arn: 'StackId',
      athena_workgroup: 'StackName',
      daemon_config: {},
      source_properties: {},
      destination_properties: {},
      wharfie_version: '1.0.0',
    });
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
          queries: [
            {
              query_id: 'query_id_1',
              query_status: 'query_status',
              query_execution_id: 'query_execution_id_1',
            },
            {
              query_id: 'query_id_2',
              query_status: 'query_status',
              query_execution_id: 'query_execution_id_1',
            },
          ],
        },
      ],
    });
    const result = await resource.getQueries(
      'resource_id',
      'operation_id',
      'action_id'
    );
    expect(result).toMatchInlineSnapshot(`
      [
        {
          "query_execution_id": "query_execution_id_1",
          "query_id": "query_id_1",
          "query_status": "query_status",
        },
        {
          "query_execution_id": "query_execution_id_1",
          "query_id": "query_id_2",
          "query_status": "query_status",
        },
      ]
    `);
  });

  it('putOperation', async () => {
    expect.assertions(1);
    const action_graph = new OperationActionGraph();
    await resource.putResource({
      resource_id: 'resource_id',
      resource_arn: 'StackId',
      athena_workgroup: 'StackName',
      daemon_config: {},
      source_properties: {},
      destination_properties: {},
      wharfie_version: '1.0.0',
    });
    await resource.putOperation('resource_id', {
      resource_id: 'resource_id',
      operation_id: 'operation_id',
      operation_type: 'operation_type',
      operation_status: 'RUNNING',
      started_at: 123124,
      last_updated_at: 123124,
      operation_config: {},
      action_graph,
    });
    const result = await resource.getOperation('resource_id', 'operation_id');
    expect(result).toMatchInlineSnapshot(`
      {
        "action_graph": OperationActionGraph {
          "actions": [],
          "incomingEdges": Map {},
          "outgoingEdges": Map {},
        },
        "last_updated_at": 123124,
        "operation_config": {},
        "operation_id": "operation_id",
        "operation_inputs": undefined,
        "operation_status": "RUNNING",
        "operation_type": "operation_type",
        "resource_id": "resource_id",
        "started_at": 123124,
      }
    `);
  });

  it('putAction', async () => {
    expect.assertions(1);
    await resource.putResource({
      resource_id: 'resource_id',
      resource_arn: 'StackId',
      athena_workgroup: 'StackName',
      daemon_config: {},
      source_properties: {},
      destination_properties: {},
      wharfie_version: '1.0.0',
    });
    await resource.putAction('resource_id', 'operation_id', {
      action_id: 'action_id',
      action_type: 'action_type',
      action_status: 'action_status',
    });
    const result = await resource.getAction(
      'resource_id',
      'operation_id',
      'action_id'
    );
    expect(result).toMatchInlineSnapshot(`
      {
        "action_id": "action_id",
        "action_status": "action_status",
        "action_type": "action_type",
      }
    `);
  });

  it('putQuery', async () => {
    expect.assertions(1);
    await resource.putResource({
      resource_id: 'resource_id',
      resource_arn: 'StackId',
      athena_workgroup: 'StackName',
      daemon_config: {},
      source_properties: {},
      destination_properties: {},
      wharfie_version: '1.0.0',
    });
    await resource.putQuery('resource_id', 'operation_id', 'action_id', {
      query_id: 'query_id',
      query_status: 'query_status',
      query_execution_id: 'query_execution_id_1',
    });
    const result = await resource.getQuery(
      'resource_id',
      'operation_id',
      'action_id',
      'query_id'
    );
    expect(result).toMatchInlineSnapshot(`
      {
        "query_execution_id": "query_execution_id_1",
        "query_id": "query_id",
        "query_status": "query_status",
      }
    `);
  });

  it('putQueries', async () => {
    expect.assertions(1);
    await resource.putResource({
      resource_id: 'resource_id',
      resource_arn: 'StackId',
      athena_workgroup: 'StackName',
      daemon_config: {},
      source_properties: {},
      destination_properties: {},
      wharfie_version: '1.0.0',
    });
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
    const result = await resource.getActionQueries(
      'resource_id',
      'operation_id',
      'action_id'
    );
    expect(result).toMatchInlineSnapshot(`
      [
        {
          "query_execution_id": "query_execution_id_1",
          "query_id": "query_id_1",
          "query_status": "query_status",
        },
        {
          "query_execution_id": "query_execution_id_2",
          "query_id": "query_id_2",
          "query_status": "query_status",
        },
      ]
    `);
  });

  it('checkActionPrerequisites', async () => {
    expect.assertions(1);
    const action_graph = new OperationActionGraph();
    const start_action = new Action({
      type: 'START',
      id: 'action_id_1',
    });
    const finish_action = new Action({
      type: 'FINISH',
      id: 'action_id_2',
    });
    action_graph.addActions([start_action, finish_action]);
    action_graph.addDependency(start_action, finish_action);

    await resource.putResource({
      resource_id: 'resource_id',
      resource_arn: 'StackId',
      athena_workgroup: 'StackName',
      daemon_config: {},
      source_properties: {},
      destination_properties: {},
      wharfie_version: '1.0.0',
    });
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
          action_id: 'action_id_1',
          action_type: 'START',
          action_status: 'COMPLETED',
          queries: [
            {
              query_id: 'query_id_1',
              query_status: 'COMPLETED',
              query_execution_id: 'query_execution_id_1',
            },
            {
              query_id: 'query_id_2',
              query_status: 'COMPLETED',
              query_execution_id: 'query_execution_id_2',
            },
          ],
        },
        {
          action_id: 'action_id_2',
          action_type: 'FINISH',
          action_status: 'WAITING',
          queries: [],
        },
      ],
    });

    const operation = await resource.getOperation(
      'resource_id',
      'operation_id'
    );
    const result = await resource.checkActionPrerequisites(operation, 'FINISH');
    expect(result).toBe(true);
  });

  it('checkActionPrerequisites - not ready', async () => {
    expect.assertions(1);
    const action_graph = new OperationActionGraph();
    const start_action = new Action({
      type: 'START',
      id: 'action_id_1',
    });
    const finish_action = new Action({
      type: 'FINISH',
      id: 'action_id_2',
    });
    action_graph.addActions([start_action, finish_action]);
    action_graph.addDependency(start_action, finish_action);

    await resource.putResource({
      resource_id: 'resource_id',
      resource_arn: 'StackId',
      athena_workgroup: 'StackName',
      daemon_config: {},
      source_properties: {},
      destination_properties: {},
      wharfie_version: '1.0.0',
    });
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
          action_id: 'action_id_1',
          action_type: 'START',
          action_status: 'RUNNING',
          queries: [
            {
              query_id: 'query_id_1',
              query_status: 'COMPLETED',
              query_execution_id: 'query_execution_id_1',
            },
            {
              query_id: 'query_id_2',
              query_status: 'RUNNING',
              query_execution_id: 'query_execution_id_2',
            },
          ],
        },
        {
          action_id: 'action_id_2',
          action_type: 'FINISH',
          action_status: 'WAITING',
          queries: [],
        },
      ],
    });

    const operation = await resource.getOperation(
      'resource_id',
      'operation_id'
    );
    const result = await resource.checkActionPrerequisites(operation, 'FINISH');
    expect(result).toBe(false);
  });

  it('checkActionPrerequisites - failure', async () => {
    expect.assertions(1);
    const action_graph = new OperationActionGraph();
    const start_action = new Action({
      type: 'START',
      id: 'action_id_1',
    });
    const finish_action = new Action({
      type: 'FINISH',
      id: 'action_id_2',
    });
    action_graph.addActions([start_action, finish_action]);
    action_graph.addDependency(start_action, finish_action);

    await resource.putResource({
      resource_id: 'resource_id',
      resource_arn: 'StackId',
      athena_workgroup: 'StackName',
      daemon_config: {},
      source_properties: {},
      destination_properties: {},
      wharfie_version: '1.0.0',
    });
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
          action_id: 'action_id_1',
          action_type: 'START',
          action_status: 'RUNNING',
          queries: [
            {
              query_id: 'query_id_1',
              query_status: 'FAILED',
              query_execution_id: 'query_execution_id_1',
            },
            {
              query_id: 'query_id_2',
              query_status: 'RUNNING',
              query_execution_id: 'query_execution_id_2',
            },
          ],
        },
        {
          action_id: 'action_id_2',
          action_type: 'FINISH',
          action_status: 'WAITING',
          queries: [],
        },
      ],
    });

    const operation = await resource.getOperation(
      'resource_id',
      'operation_id'
    );
    await expect(async () => {
      await resource.checkActionPrerequisites(operation, 'FINISH');
    }).rejects.toThrow(Error);
  });

  it('deleteOperation', async () => {
    expect.assertions(1);
    const action_graph = new OperationActionGraph();
    const start_action = new Action({
      type: 'START',
      id: 'action_id_1',
    });
    const finish_action = new Action({
      type: 'FINISH',
      id: 'action_id_2',
    });
    action_graph.addActions([start_action, finish_action]);
    action_graph.addDependency(start_action, finish_action);

    await resource.putResource({
      resource_id: 'resource_id',
      resource_arn: 'StackId',
      athena_workgroup: 'StackName',
      daemon_config: {},
      source_properties: {},
      destination_properties: {},
      wharfie_version: '1.0.0',
    });
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
          action_id: 'action_id_1',
          action_type: 'START',
          action_status: 'COMPLETED',
          queries: [
            {
              query_id: 'query_id_1',
              query_status: 'COMPLETED',
              query_execution_id: 'query_execution_id_1',
            },
            {
              query_id: 'query_id_2',
              query_status: 'COMPLETED',
              query_execution_id: 'query_execution_id_2',
            },
          ],
        },
        {
          action_id: 'action_id_2',
          action_type: 'FINISH',
          action_status: 'WAITING',
          queries: [],
        },
      ],
    });
    await resource.deleteOperation('resource_id', 'operation_id');
    const state = resource.__getMockState('resource_id', 'operation_id');
    expect(state).toMatchInlineSnapshot(`
      {
        "resource_id": {
          "resource_id": {
            "athena_workgroup": "StackName",
            "daemon_config": {},
            "destination_properties": {},
            "resource_arn": "StackId",
            "resource_id": "resource_id",
            "source_properties": {},
            "wharfie_version": "1.0.0",
          },
        },
      }
    `);
  });

  it('getRecords', async () => {
    expect.assertions(1);

    await resource.putResource({
      resource_id: 'resource_id',
      resource_arn: 'StackId',
      athena_workgroup: 'StackName',
      daemon_config: {},
      source_properties: {},
      destination_properties: {},
      wharfie_version: '1.0.0',
    });
    await resource.createOperation({
      resource_id: 'resource_id',
      operation_id: 'operation_id',
      operation_type: 'operation_type',
      operation_status: 'RUNNING',
      started_at: 123124,
      last_updated_at: 123124,
      operation_config: {},
      actions: [
        {
          action_id: 'action_id_1',
          action_type: 'START',
          action_status: 'COMPLETED',
          queries: [
            {
              query_id: 'query_id_1',
              query_status: 'COMPLETED',
              query_execution_id: 'query_execution_id_1',
            },
            {
              query_id: 'query_id_2',
              query_status: 'COMPLETED',
              query_execution_id: 'query_execution_id_2',
            },
          ],
        },
        {
          action_id: 'action_id_2',
          action_type: 'FINISH',
          action_status: 'WAITING',
          queries: [],
        },
      ],
    });
    const records = await resource.getRecords('resource_id', 'operation_id');
    expect(records).toMatchInlineSnapshot(`
      {
        "actions": [
          {
            "action_id": "action_id_1",
            "action_status": "COMPLETED",
            "action_type": "START",
          },
          {
            "action_id": "action_id_2",
            "action_status": "WAITING",
            "action_type": "FINISH",
          },
        ],
        "operations": [
          {
            "action_graph": undefined,
            "last_updated_at": 123124,
            "operation_config": {},
            "operation_id": "operation_id",
            "operation_inputs": undefined,
            "operation_status": "RUNNING",
            "operation_type": "operation_type",
            "resource_id": "resource_id",
            "started_at": 123124,
          },
        ],
        "queries": [
          {
            "query_execution_id": "query_execution_id_1",
            "query_id": "query_id_1",
            "query_status": "COMPLETED",
          },
          {
            "query_execution_id": "query_execution_id_2",
            "query_id": "query_id_2",
            "query_status": "COMPLETED",
          },
        ],
      }
    `);
  });
});
