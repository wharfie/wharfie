/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import createVanillaDB from '../../../lambdas/lib/db/adapters/vanilla.js';
import createOperationsStore from '../../../lambdas/lib/graph/operations-store.js';
import {
  Action,
  Operation,
  Resource,
} from '../../../lambdas/lib/graph/index.js';

/** @typedef {import('../../../lambdas/lib/db/base.js').DBClient} DBClient */
/** @typedef {import('../../../lambdas/lib/db/tables/operations.js').OperationsTableClient} OperationsStore */
/** @typedef {import('../../../lambdas/typedefs.js').TableProperties} TableProperties */

/**
 * @param {number} epochSeconds - epochSeconds.
 * @returns {string} - Result.
 */
function toIsoSeconds(epochSeconds) {
  return new Date(Number(epochSeconds || 0) * 1000).toISOString();
}

/**
 * @param {string} name - name.
 * @param {string} region - region.
 * @returns {TableProperties} - Result.
 */
function makeTableProperties(name, region) {
  return {
    catalogId: 'AwsDataCatalog',
    columns: [{ name: 'id', type: 'string' }],
    compressed: false,
    databaseName: 'test_db',
    name,
    numberOfBuckets: 0,
    parameters: {},
    region,
    storedAsSubDirectories: false,
    tableType: 'EXTERNAL_TABLE',
    tags: {},
  };
}

/**
 * @param {OperationsStore} store - store.
 * @returns {Promise<Array<{ resource_id: string }>>} - Result.
 */
async function listResourcesRows(store) {
  const resources = await store.getAllResources();
  return resources.map(({ id }) => ({ resource_id: id }));
}

/**
 * @param {OperationsStore} store - store.
 * @param {string} resource_id - resource_id.
 * @returns {Promise<Array<Record<string, any>>>} - Result.
 */
async function listOperationsRows(store, resource_id) {
  const records = await store.getRecords(resource_id);
  records.operations.sort((a, b) => b.started_at - a.started_at);

  return records.operations.map(
    ({ operation_config, resource_id: _rid, ...x }) => ({
      ...x,
      started_at: toIsoSeconds(x.started_at),
      last_updated_at: toIsoSeconds(x.last_updated_at),
    }),
  );
}

/**
 * @param {OperationsStore} store - store.
 * @param {string} resource_id - resource_id.
 * @param {string} operation_id - operation_id.
 * @returns {Promise<{ found: boolean; actions: any[]; queries: any[] }>} - Result.
 */
async function listOperationDetails(store, resource_id, operation_id) {
  const records = await store.getRecords(resource_id, operation_id);
  if (records.operations.length === 0) {
    return { found: false, actions: [], queries: [] };
  }

  const actions = records.operations[0].getSequentialActionOrder();
  records.queries.sort((a, b) => {
    if (a.status < b.status) return -1;
    if (a.status > b.status) return 1;
    return 0;
  });

  return {
    found: true,
    actions: actions.map((action) => ({
      action_id: action.id,
      action_type: action.type,
      action_status: action.status,
    })),
    queries: records.queries.map((query) => ({
      query_id: query.id,
      query_status: query.status,
      query_execution_id: query.execution_id,
    })),
  };
}

/**
 * @param {OperationsStore} store - store.
 * @param {string} resource_id - resource_id.
 * @param {string} [operation_id] - operation_id.
 * @param {string} [operation_type] - operation_type.
 * @returns {Promise<number>} - Result.
 */
async function cancel(store, resource_id, operation_id, operation_type) {
  const records = await store.getRecords(resource_id);
  let operationsToRemove = [];

  if (operation_type) {
    operationsToRemove = records.operations.filter(
      (x) => x.type === operation_type,
    );
  } else if (operation_id) {
    operationsToRemove = records.operations.filter(
      (x) => x.id === operation_id,
    );
  } else {
    operationsToRemove = records.operations;
  }

  await Promise.all(
    operationsToRemove.map((operation) => store.deleteOperation(operation)),
  );
  return operationsToRemove.length;
}

/**
 * @param {OperationsStore} store - store.
 * @param {string} operation_type - operation_type.
 * @returns {Promise<number>} - Result.
 */
async function cancelAll(store, operation_type) {
  const resources = await store.getAllResources();
  let cancelled = 0;
  for (const resource of resources) {
    cancelled += await cancel(store, resource.id, undefined, operation_type);
  }
  return cancelled;
}

describe('OperationsStore list/cancel behavior (vanilla DB)', () => {
  /** @type {DBClient} */
  let db;
  /** @type {OperationsStore} */
  let store;
  /** @type {string} */
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wharfie-ops-'));
    db = createVanillaDB({ path: tempDir });
    store = createOperationsStore({ db, tableName: 'operations-test' });
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('lists resources, operations, and operation details using OperationsStore', async () => {
    const resource = new Resource({
      id: 'r1',
      region: 'us-east-1',
      athena_workgroup: 'primary',
      daemon_config: {
        Role: 'arn:aws:iam::123456789012:role/test',
      },
      resource_properties: {},
      source_properties: makeTableProperties('src_table', 'us-east-1'),
      destination_properties: makeTableProperties('dst_table', 'us-east-1'),
    });

    await store.putResource(resource);

    const op1 = new Operation({
      resource_id: resource.id,
      resource_version: resource.version,
      type: Operation.Type.LOAD,
      started_at: 1700000000,
      last_updated_at: 1700000005,
    });
    const op1Start = new Action({
      resource_id: resource.id,
      operation_id: op1.id,
      type: Action.Type.START,
      status: Action.Status.COMPLETED,
    });
    const op1Finish = new Action({
      resource_id: resource.id,
      operation_id: op1.id,
      type: Action.Type.FINISH,
      status: Action.Status.RUNNING,
    });
    op1.addAction({ action: op1Start, dependsOn: [] });
    op1.addAction({ action: op1Finish, dependsOn: [op1Start] });
    await store.putOperation(op1);

    const op2 = new Operation({
      resource_id: resource.id,
      resource_version: resource.version,
      type: Operation.Type.BACKFILL,
      started_at: 1700000100,
      last_updated_at: 1700000105,
    });
    const op2Start = new Action({
      resource_id: resource.id,
      operation_id: op2.id,
      type: Action.Type.START,
      status: Action.Status.RUNNING,
    });
    op2.addAction({ action: op2Start, dependsOn: [] });
    await store.putOperation(op2);

    // List resources (like: `wharfie list`)
    expect(await listResourcesRows(store)).toEqual([{ resource_id: 'r1' }]);

    // List operations (like: `wharfie list r1`)
    const operationRows = await listOperationsRows(store, 'r1');
    expect(operationRows).toHaveLength(2);
    // Sorted by started_at desc
    expect(operationRows[0].id).toEqual(op2.id);
    expect(operationRows[1].id).toEqual(op1.id);
    // Timestamp formatting preserved
    expect(operationRows[0].started_at).toEqual(toIsoSeconds(1700000100));
    expect(operationRows[1].started_at).toEqual(toIsoSeconds(1700000000));

    // List operation details (like: `wharfie list r1 <op1.id>`)
    const details = await listOperationDetails(store, 'r1', op1.id);
    expect(details.found).toEqual(true);
    expect(details.actions.map((x) => x.action_type)).toEqual([
      Action.Type.START,
      Action.Type.FINISH,
    ]);
  });

  test('cancels operations by id/type and supports cancelAll via resource index', async () => {
    const r1 = new Resource({
      id: 'r1',
      region: 'us-east-1',
      athena_workgroup: 'primary',
      daemon_config: {
        Role: 'arn:aws:iam::123456789012:role/test',
      },
      resource_properties: {},
      source_properties: makeTableProperties('r1_src', 'us-east-1'),
      destination_properties: makeTableProperties('r1_dst', 'us-east-1'),
    });
    const r2 = new Resource({
      id: 'r2',
      region: 'us-east-1',
      athena_workgroup: 'primary',
      daemon_config: {
        Role: 'arn:aws:iam::123456789012:role/test',
      },
      resource_properties: {},
      source_properties: makeTableProperties('r2_src', 'us-east-1'),
      destination_properties: makeTableProperties('r2_dst', 'us-east-1'),
    });

    await store.putResource(r1);
    await store.putResource(r2);

    const r1Load = new Operation({
      resource_id: r1.id,
      resource_version: r1.version,
      type: Operation.Type.LOAD,
      started_at: 1700000000,
      last_updated_at: 1700000001,
    });
    r1Load.addAction({
      action: new Action({
        resource_id: r1.id,
        operation_id: r1Load.id,
        type: Action.Type.START,
      }),
      dependsOn: [],
    });

    const r1Backfill = new Operation({
      resource_id: r1.id,
      resource_version: r1.version,
      type: Operation.Type.BACKFILL,
      started_at: 1700000050,
      last_updated_at: 1700000051,
    });
    r1Backfill.addAction({
      action: new Action({
        resource_id: r1.id,
        operation_id: r1Backfill.id,
        type: Action.Type.START,
      }),
      dependsOn: [],
    });

    const r2Load = new Operation({
      resource_id: r2.id,
      resource_version: r2.version,
      type: Operation.Type.LOAD,
      started_at: 1700000100,
      last_updated_at: 1700000101,
    });
    r2Load.addAction({
      action: new Action({
        resource_id: r2.id,
        operation_id: r2Load.id,
        type: Action.Type.START,
      }),
      dependsOn: [],
    });

    await store.putOperation(r1Load);
    await store.putOperation(r1Backfill);
    await store.putOperation(r2Load);

    // Cancel a single operation by id
    expect(await cancel(store, 'r1', r1Backfill.id)).toEqual(1);
    expect((await store.getRecords('r1')).operations.map((x) => x.id)).toEqual([
      r1Load.id,
    ]);

    // Cancel remaining operations by type
    expect(await cancel(store, 'r1', undefined, Operation.Type.LOAD)).toEqual(
      1,
    );
    expect((await store.getRecords('r1')).operations).toHaveLength(0);

    // Cancel all LOAD operations across all resources (r2)
    expect(await cancelAll(store, Operation.Type.LOAD)).toEqual(1);
    expect((await store.getRecords('r2')).operations).toHaveLength(0);
  });
});
