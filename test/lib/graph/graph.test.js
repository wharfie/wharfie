/* eslint-disable jest/no-hooks */
'use strict';

const { Action, Operation } = require('../../../lambdas/lib/graph');

const { createId } = require('../../../lambdas/lib/id');
jest.mock('../../../lambdas/lib/id');

let idCount;
describe('tests for graph', () => {
  beforeAll(() => {
    const mockedDate = new Date(1466424490000);
    jest.useFakeTimers('modern');
    jest.setSystemTime(mockedDate);
  });
  beforeEach(() => {
    idCount = 0;
    createId.mockImplementation(() => {
      idCount = idCount + 1;
      return `id-${idCount}`;
    });
  });
  afterAll(() => {
    createId.mockClear();
    jest.useRealTimers();
  });
  it('serialization', async () => {
    expect.assertions(2);
    const test_operation = new Operation({
      resource_id: 'resource_id',
      resource_version: 0,
      type: Operation.Type.BACKFILL,
      id: 'test_operation',
    });
    const start_action = test_operation.createAction({
      type: Action.Type.START,
      id: 'start_action',
    });

    expect(start_action.toRecords()).toMatchInlineSnapshot(`
      [
        {
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
      ]
    `);
    expect(test_operation.toRecords()).toMatchInlineSnapshot(`
      [
        {
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
        {
          "data": {
            "id": "test_operation",
            "last_updated_at": 1466424490000,
            "operation_config": undefined,
            "operation_inputs": undefined,
            "record_type": "OPERATION",
            "resource_id": "resource_id",
            "resource_version": 0,
            "serialized_action_graph": "{"outgoingEdges":[],"incomingEdges":[],"actionIdsToTypes":[["start_action","START"]]}",
            "started_at": 1466424490000,
            "status": "PENDING",
            "type": "BACKFILL",
            "wharfie_version": "0.0.11",
          },
          "resource_id": "resource_id",
          "sort_key": "resource_id#test_operation",
        },
      ]
    `);
  });
  it('deserialization', async () => {
    expect.assertions(3);

    const test_operation = new Operation({
      resource_id: 'resource_id',
      resource_version: 0,
      type: Operation.Type.BACKFILL,
      id: 'test_operation',
    });
    const start_action = test_operation.createAction({
      type: Action.Type.START,
      id: 'start_action',
    });
    const compaction_action = test_operation.createAction({
      type: Action.Type.RUN_COMPACTION,
      id: 'compaction_action',
      dependsOn: [start_action],
    });
    test_operation.createAction({
      type: Action.Type.FINISH,
      id: 'finish_action',
      dependsOn: [compaction_action],
    });

    const serializedGraph = test_operation.toRecords();
    // eslint-disable-next-line jest/no-large-snapshots
    expect(serializedGraph).toMatchInlineSnapshot(`
      [
        {
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
        {
          "data": {
            "id": "compaction_action",
            "last_updated_at": 1466424490000,
            "operation_id": "test_operation",
            "record_type": "ACTION",
            "resource_id": "resource_id",
            "started_at": 1466424490000,
            "status": "PENDING",
            "type": "RUN_COMPACTION",
            "wharfie_version": "0.0.11",
          },
          "resource_id": "resource_id",
          "sort_key": "resource_id#test_operation#compaction_action",
        },
        {
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
        {
          "data": {
            "id": "test_operation",
            "last_updated_at": 1466424490000,
            "operation_config": undefined,
            "operation_inputs": undefined,
            "record_type": "OPERATION",
            "resource_id": "resource_id",
            "resource_version": 0,
            "serialized_action_graph": "{"outgoingEdges":[["start_action",["compaction_action"]],["compaction_action",["finish_action"]]],"incomingEdges":[["compaction_action",["start_action"]],["finish_action",["compaction_action"]]],"actionIdsToTypes":[["start_action","START"],["compaction_action","RUN_COMPACTION"],["finish_action","FINISH"]]}",
            "started_at": 1466424490000,
            "status": "PENDING",
            "type": "BACKFILL",
            "wharfie_version": "0.0.11",
          },
          "resource_id": "resource_id",
          "sort_key": "resource_id#test_operation",
        },
      ]
    `);
    expect(Operation.fromRecord(serializedGraph[serializedGraph.length - 1]))
      .toMatchInlineSnapshot(`
      Operation {
        "actionIdsToTypes": Map {
          "start_action" => "START",
          "compaction_action" => "RUN_COMPACTION",
          "finish_action" => "FINISH",
        },
        "actions": Map {},
        "id": "test_operation",
        "incomingEdges": Map {
          "compaction_action" => [
            "start_action",
          ],
          "finish_action" => [
            "compaction_action",
          ],
        },
        "last_updated_at": 1466424490000,
        "operation_config": undefined,
        "operation_inputs": undefined,
        "outgoingEdges": Map {
          "start_action" => [
            "compaction_action",
          ],
          "compaction_action" => [
            "finish_action",
          ],
        },
        "resource_id": "resource_id",
        "resource_version": 0,
        "started_at": 1466424490000,
        "status": "PENDING",
        "type": "BACKFILL",
        "wharfie_version": "0.0.11",
      }
    `);
    expect(
      Operation.fromRecords(
        serializedGraph[serializedGraph.length - 1],
        serializedGraph.slice(0, -1).map((action) => {
          return {
            action_record: action,
            query_records: [],
          };
        })
      )
    ).toStrictEqual(test_operation);
  });
  it('toString', async () => {
    expect.assertions(1);

    const test_operation = new Operation({
      resource_id: 'resource_id',
      type: Operation.Type.BACKFILL,
      id: 'test_operation',
    });
    const start_action = test_operation.createAction({
      type: Action.Type.START,
      id: 'start_action',
    });
    const compaction_action = test_operation.createAction({
      type: Action.Type.RUN_COMPACTION,
      id: 'compaction_action',
      dependsOn: [start_action],
    });
    const register_partition_action = test_operation.createAction({
      type: Action.Type.REGISTER_PARTITION,
      id: 'register_partitions_action',
      dependsOn: [start_action],
    });
    test_operation.createAction({
      type: Action.Type.FINISH,
      id: 'finish_action',
      dependsOn: [compaction_action, register_partition_action],
    });
    expect(test_operation.toString()).toMatchInlineSnapshot(`
      "START -> RUN_COMPACTION, REGISTER_PARTITION
      RUN_COMPACTION -> FINISH
      REGISTER_PARTITION -> FINISH
      "
    `);
  });
  it('getUpstreamActions', async () => {
    expect.assertions(3);
    const test_operation = new Operation({
      resource_id: 'resource_id',
      type: Operation.Type.BACKFILL,
      id: 'test_operation',
    });
    const start_action = test_operation.createAction({
      type: Action.Type.START,
      id: 'start_action',
    });
    const compaction_action = test_operation.createAction({
      type: Action.Type.RUN_COMPACTION,
      id: 'compaction_action',
      dependsOn: [start_action],
    });
    const register_partition_action = test_operation.createAction({
      type: Action.Type.REGISTER_PARTITION,
      id: 'register_partitions_action',
      dependsOn: [start_action],
    });
    const finish_action = test_operation.createAction({
      type: Action.Type.FINISH,
      id: 'finish_action',
      dependsOn: [compaction_action, register_partition_action],
    });
    expect(
      test_operation.getUpstreamActions(start_action)
    ).toMatchInlineSnapshot(`[]`);
    expect(test_operation.getUpstreamActions(finish_action))
      .toMatchInlineSnapshot(`
      [
        Action {
          "id": "compaction_action",
          "last_updated_at": 1466424490000,
          "operation_id": "test_operation",
          "queries": [],
          "resource_id": "resource_id",
          "started_at": 1466424490000,
          "status": "PENDING",
          "type": "RUN_COMPACTION",
          "wharfie_version": "0.0.11",
        },
        Action {
          "id": "register_partitions_action",
          "last_updated_at": 1466424490000,
          "operation_id": "test_operation",
          "queries": [],
          "resource_id": "resource_id",
          "started_at": 1466424490000,
          "status": "PENDING",
          "type": "REGISTER_PARTITION",
          "wharfie_version": "0.0.11",
        },
      ]
    `);
    expect(test_operation.getUpstreamActions(compaction_action))
      .toMatchInlineSnapshot(`
      [
        Action {
          "id": "start_action",
          "last_updated_at": 1466424490000,
          "operation_id": "test_operation",
          "queries": [],
          "resource_id": "resource_id",
          "started_at": 1466424490000,
          "status": "PENDING",
          "type": "START",
          "wharfie_version": "0.0.11",
        },
      ]
    `);
  });
  it('getDownstreamActions', async () => {
    expect.assertions(3);
    const test_operation = new Operation({
      resource_id: 'resource_id',
      type: Operation.Type.BACKFILL,
      id: 'test_operation',
    });
    const start_action = test_operation.createAction({
      type: Action.Type.START,
      id: 'start_action',
    });
    const compaction_action = test_operation.createAction({
      type: Action.Type.RUN_COMPACTION,
      id: 'compaction_action',
      dependsOn: [start_action],
    });
    const register_partition_action = test_operation.createAction({
      type: Action.Type.REGISTER_PARTITION,
      id: 'register_partitions_action',
      dependsOn: [start_action],
    });
    const finish_action = test_operation.createAction({
      type: Action.Type.FINISH,
      id: 'finish_action',
      dependsOn: [compaction_action, register_partition_action],
    });
    expect(test_operation.getDownstreamActions(start_action))
      .toMatchInlineSnapshot(`
      [
        Action {
          "id": "compaction_action",
          "last_updated_at": 1466424490000,
          "operation_id": "test_operation",
          "queries": [],
          "resource_id": "resource_id",
          "started_at": 1466424490000,
          "status": "PENDING",
          "type": "RUN_COMPACTION",
          "wharfie_version": "0.0.11",
        },
        Action {
          "id": "register_partitions_action",
          "last_updated_at": 1466424490000,
          "operation_id": "test_operation",
          "queries": [],
          "resource_id": "resource_id",
          "started_at": 1466424490000,
          "status": "PENDING",
          "type": "REGISTER_PARTITION",
          "wharfie_version": "0.0.11",
        },
      ]
    `);
    expect(test_operation.getDownstreamActions(register_partition_action))
      .toMatchInlineSnapshot(`
      [
        Action {
          "id": "finish_action",
          "last_updated_at": 1466424490000,
          "operation_id": "test_operation",
          "queries": [],
          "resource_id": "resource_id",
          "started_at": 1466424490000,
          "status": "PENDING",
          "type": "FINISH",
          "wharfie_version": "0.0.11",
        },
      ]
    `);
    expect(
      test_operation.getDownstreamActions(finish_action)
    ).toMatchInlineSnapshot(`[]`);
  });
  it('getSequentialActionOrder', async () => {
    expect.assertions(1);
    const test_operation = new Operation({
      resource_id: 'resource_id',
      type: Operation.Type.BACKFILL,
      id: 'test_operation',
    });
    const start_action = test_operation.createAction({
      type: Action.Type.START,
      id: 'start_action',
    });
    const compaction_action = test_operation.createAction({
      type: Action.Type.RUN_COMPACTION,
      id: 'compaction_action',
      dependsOn: [start_action],
    });
    const register_partition_action = test_operation.createAction({
      type: Action.Type.REGISTER_PARTITION,
      id: 'register_partitions_action',
      dependsOn: [start_action],
    });
    test_operation.createAction({
      type: Action.Type.FINISH,
      id: 'finish_action',
      dependsOn: [compaction_action, register_partition_action],
    });
    expect(test_operation.getSequentialActionOrder()).toMatchInlineSnapshot(`
      [
        Action {
          "id": "start_action",
          "last_updated_at": 1466424490000,
          "operation_id": "test_operation",
          "queries": [],
          "resource_id": "resource_id",
          "started_at": 1466424490000,
          "status": "PENDING",
          "type": "START",
          "wharfie_version": "0.0.11",
        },
        Action {
          "id": "compaction_action",
          "last_updated_at": 1466424490000,
          "operation_id": "test_operation",
          "queries": [],
          "resource_id": "resource_id",
          "started_at": 1466424490000,
          "status": "PENDING",
          "type": "RUN_COMPACTION",
          "wharfie_version": "0.0.11",
        },
        Action {
          "id": "register_partitions_action",
          "last_updated_at": 1466424490000,
          "operation_id": "test_operation",
          "queries": [],
          "resource_id": "resource_id",
          "started_at": 1466424490000,
          "status": "PENDING",
          "type": "REGISTER_PARTITION",
          "wharfie_version": "0.0.11",
        },
        Action {
          "id": "finish_action",
          "last_updated_at": 1466424490000,
          "operation_id": "test_operation",
          "queries": [],
          "resource_id": "resource_id",
          "started_at": 1466424490000,
          "status": "PENDING",
          "type": "FINISH",
          "wharfie_version": "0.0.11",
        },
      ]
    `);
  });
});
