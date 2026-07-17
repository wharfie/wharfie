/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import createVanillaDB from '../../../src/core/lib/db/adapters/vanilla.js';
import createOperationsStore from '../../../src/core/lib/graph/operations-store.js';
import Action from '../../../src/core/lib/graph/action.js';
import Operation from '../../../src/core/lib/graph/operation.js';

const REVISION_ID = `wrv1_${'A'.repeat(43)}`;

/** @typedef {import('../../../src/core/lib/db/base.js').DBClient} DBClient */
/** @typedef {import('../../../src/core/lib/db/tables/operations.js').OperationsTableClient} OperationsStore */

/**
 * @param {{ resourceId: string, id: string, startedAt?: number }} options
 * @returns {Operation}
 */
function makePipeline({ resourceId, id, startedAt = 1 }) {
  const operation = new Operation({
    resource_id: resourceId,
    revision_id: REVISION_ID,
    id,
    type: Operation.Type.PIPELINE,
    operation_config: {
      app: resourceId.slice('app:'.length),
      activity: 'echo',
    },
    started_at: startedAt,
    last_updated_at: startedAt,
  });
  const start = operation.createAction({
    id: `${id}:start`,
    type: Action.Type.START,
    status: Action.Status.COMPLETED,
  });
  const invoke = operation.createAction({
    id: `${id}:invoke`,
    type: Action.Type.INVOKE_FUNCTION,
    function_name: 'echo',
    inputs: { operation: id },
    dependsOn: [start],
  });
  operation.createAction({
    id: `${id}:finish`,
    type: Action.Type.FINISH,
    dependsOn: [invoke],
  });
  return operation;
}

describe('v2 operations persistence (vanilla DB)', () => {
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
    await db?.close?.();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('loads PIPELINE operations and their action DAGs by app id', async () => {
    const appId = 'app:portable-notes';
    const first = makePipeline({
      resourceId: appId,
      id: 'run-a',
      startedAt: 10,
    });
    const second = makePipeline({
      resourceId: appId,
      id: 'run-b',
      startedAt: 20,
    });

    await store.createOperation(first);
    await store.createOperation(second);

    const allRecords = await store.getRecords(appId);
    expect(allRecords.operations.map(({ id }) => id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(allRecords.operations.every(({ type }) => type === 'PIPELINE')).toBe(
      true,
    );
    expect(allRecords.actions).toHaveLength(6);
    expect(allRecords).not.toHaveProperty('queries');

    const scopedRecords = await store.getRecords(appId, second.id);
    expect(scopedRecords.operations).toHaveLength(1);
    expect(scopedRecords.actions).toHaveLength(3);
    expect(
      scopedRecords.operations[0]
        .getSequentialActionOrder()
        .map(({ type }) => type),
    ).toEqual([
      Action.Type.START,
      Action.Type.INVOKE_FUNCTION,
      Action.Type.FINISH,
    ]);

    expect((await store.getOperations(appId)).map(({ id }) => id)).toEqual([
      first.id,
      second.id,
    ]);
    expect((await store.getActions(second)).map(({ id }) => id).sort()).toEqual(
      second
        .getActions()
        .map(({ id }) => id)
        .sort(),
    );
  });

  test('scopes and durably cancels exact operation ids across prefixes and apps', async () => {
    const run = makePipeline({ resourceId: 'app:one', id: 'run-1' });
    const prefixedRun = makePipeline({
      resourceId: 'app:one',
      id: 'run-10',
    });
    const otherAppRun = makePipeline({
      resourceId: 'app:two',
      id: 'run-1',
    });

    await store.createOperation(run);
    await store.createOperation(prefixedRun);
    await store.createOperation(otherAppRun);

    const scoped = await store.getRecords('app:one', 'run-1');
    expect(scoped.operations.map(({ id }) => id)).toEqual(['run-1']);
    expect(
      scoped.actions.every(({ operation_id }) => operation_id === 'run-1'),
    ).toBe(true);

    const cancellation = await store.cancelOperation('app:one', 'run-1', {
      reason: 'test cancellation',
      requestedBy: 'test',
    });

    expect(cancellation.changed).toBe(true);
    expect(await store.getOperation('app:one', 'run-1')).toMatchObject({
      status: Operation.Status.CANCELLED,
      cancellation: {
        reason: 'test cancellation',
        requested_by: 'test',
        requested_at: expect.any(Number),
      },
    });
    expect(
      await store.getAction('app:one', 'run-1', 'run-1:start'),
    ).toMatchObject({ status: Action.Status.COMPLETED });
    expect(
      await store.getAction('app:one', 'run-1', 'run-1:invoke'),
    ).toMatchObject({ status: Action.Status.CANCELLED });
    expect(await store.getOperation('app:one', 'run-10')).not.toBeNull();
    expect(
      await store.getAction('app:one', 'run-10', 'run-10:start'),
    ).not.toBeNull();
    expect(await store.getOperation('app:two', 'run-1')).not.toBeNull();

    const repeated = await store.cancelOperation('app:one', 'run-1');
    expect(repeated.changed).toBe(false);
  });
});
