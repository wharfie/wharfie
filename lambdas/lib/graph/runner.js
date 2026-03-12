import { Status as ActionStatus } from './action.js';
import { Status as OperationStatus } from './operation.js';

/**
 * @typedef {import('./action.js').default} ActionInstance
 * @typedef {import('./operation.js').default} OperationInstance
 */

/**
 * Minimal store contract required by the graph runner.
 *
 * NOTE: this intentionally matches the provider-neutral operations table client
 * (createOperationsTable / createOperationsStore).
 * @typedef {Object} OperationRunnerStore
 * @property {(resource_id: string, operation_id?: string) => Promise<{ operations: OperationInstance[]; actions: ActionInstance[]; queries: import('./query.js').default[] }>} getRecords - Load operation/action/query records.
 * @property {(action: ActionInstance, new_status: string) => Promise<boolean>} updateActionStatus - Optimistically transition an action status.
 * @property {(operation: OperationInstance, new_status: import('./operation.js').WharfieOperationStatusEnum) => Promise<boolean>} [updateOperationStatus] - Optimistically transition an operation status.
 * @property {(operation: OperationInstance, action_type: import('./action.js').WharfieActionTypeEnum) => Promise<boolean>} [checkActionPrerequisites] - Check whether prerequisites have completed.
 */

/**
 * @typedef {Object} RunOperationParams
 * @property {OperationRunnerStore} store - Operations store/table client.
 * @property {string} resourceId - Resource id.
 * @property {string} operationId - Operation id.
 * @property {(action: ActionInstance) => (boolean | Promise<boolean>)} executeAction - User-provided action executor.
 */

/**
 * Execute a persisted operation DAG in-process.
 *
 * Algorithm:
 * - Load operation/action records
 * - Find PENDING actions whose prerequisites are satisfied
 * - Optimistically transition to RUNNING, execute, then transition to COMPLETED/FAILED
 * - Persist operation-level RUNNING / COMPLETED / FAILED / BLOCKED transitions
 * - Repeat until no runnable actions remain
 * @param {RunOperationParams} params - params.
 * @returns {Promise<{ status: 'COMPLETED' | 'FAILED' | 'BLOCKED'; executedActionIds: string[]; failedActionIds: string[]; blockedActionIds: string[]; finalStatusByActionId: Record<string, string> }>} - Result.
 */
export async function runOperation({
  store,
  resourceId,
  operationId,
  executeAction,
}) {
  if (!store) throw new Error('runOperation requires store');
  if (!resourceId) throw new Error('runOperation requires resourceId');
  if (!operationId) throw new Error('runOperation requires operationId');
  if (typeof executeAction !== 'function') {
    throw new Error('runOperation requires executeAction(action)');
  }

  /** @type {string[]} */
  const executedActionIds = [];

  /** @type {Record<string, string>} */
  const finalStatusByActionId = {};

  /** @type {'COMPLETED' | 'FAILED' | 'BLOCKED'} */
  let status = 'COMPLETED';

  /**
   * @param {OperationInstance} operation - operation.
   * @param {import('./operation.js').WharfieOperationStatusEnum} nextStatus - nextStatus.
   * @returns {Promise<void>} - Result.
   */
  const persistOperationStatus = async (operation, nextStatus) => {
    if (operation.status === nextStatus) return;

    if (typeof store.updateOperationStatus === 'function') {
      // Best-effort optimistic update. The stored operation record is the source
      // of truth; the in-memory object is only used to issue the transition.
      await store.updateOperationStatus(operation, nextStatus);
    }

    operation.status = nextStatus;
    operation.last_updated_at = Date.now();
  };

  /**
   * @param {OperationInstance} operation - operation.
   * @param {ActionInstance} action - action.
   * @returns {Promise<boolean>} - Result.
   */
  const prerequisitesSatisfied = async (operation, action) => {
    if (typeof store.checkActionPrerequisites === 'function') {
      return store.checkActionPrerequisites(operation, action.type);
    }

    const upstreamIds = operation.getUpstreamActionIds(action.id) || [];
    if (!upstreamIds.length) return true;

    const { actions } = await store.getRecords(resourceId, operationId);
    const byId = new Map(actions.map((candidate) => [candidate.id, candidate]));
    for (const upstreamId of upstreamIds) {
      const upstream = byId.get(upstreamId);
      if (!upstream || upstream.status !== ActionStatus.COMPLETED) return false;
    }
    return true;
  };

  const initialRecords = await store.getRecords(resourceId, operationId);
  const initialOperation = initialRecords.operations.find(
    (operation) => operation.id === operationId,
  );

  if (!initialOperation) {
    throw new Error(`Operation not found: ${resourceId}#${operationId}`);
  }

  await persistOperationStatus(initialOperation, OperationStatus.RUNNING);

  // Run until no runnable PENDING actions remain.
  // Each loop reloads from the store to ensure DB-backed status is respected.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { operations, actions } = await store.getRecords(
      resourceId,
      operationId,
    );
    const operation = operations.find(
      (candidate) => candidate.id === operationId,
    );

    if (!operation) {
      throw new Error(`Operation not found: ${resourceId}#${operationId}`);
    }

    const pending = actions.filter(
      (action) => action.status === ActionStatus.PENDING,
    );
    if (!pending.length) {
      break;
    }

    /** @type {ActionInstance[]} */
    const runnable = [];
    for (const action of pending) {
      // eslint-disable-next-line no-await-in-loop
      if (await prerequisitesSatisfied(operation, action)) {
        runnable.push(action);
      }
    }

    runnable.sort((left, right) => left.id.localeCompare(right.id));

    if (!runnable.length) {
      status = 'BLOCKED';
      break;
    }

    for (const action of runnable) {
      // eslint-disable-next-line no-await-in-loop
      const claimed = await store.updateActionStatus(
        action,
        ActionStatus.RUNNING,
      );
      if (!claimed) continue;
      action.status = ActionStatus.RUNNING;

      let ok = false;
      try {
        // eslint-disable-next-line no-await-in-loop
        ok = Boolean(await executeAction(action));
      } catch {
        ok = false;
      }

      const terminal = ok ? ActionStatus.COMPLETED : ActionStatus.FAILED;
      // eslint-disable-next-line no-await-in-loop
      await store.updateActionStatus(action, terminal);
      action.status = terminal;
      executedActionIds.push(action.id);
      finalStatusByActionId[action.id] = terminal;
    }
  }

  const finalRecords = await store.getRecords(resourceId, operationId);
  const finalOperation = finalRecords.operations.find(
    (operation) => operation.id === operationId,
  );

  if (!finalOperation) {
    throw new Error(`Operation not found: ${resourceId}#${operationId}`);
  }

  const finalActions = finalRecords.actions;
  for (const action of finalActions) {
    finalStatusByActionId[action.id] = action.status;
  }

  const failedActionIds = finalActions
    .filter((action) => action.status === ActionStatus.FAILED)
    .map((action) => action.id);
  const blockedActionIds = finalActions
    .filter((action) =>
      [ActionStatus.PENDING, ActionStatus.RUNNING].includes(action.status),
    )
    .map((action) => action.id);

  if (failedActionIds.length > 0) status = 'FAILED';
  else if (blockedActionIds.length > 0) status = 'BLOCKED';

  const terminalOperationStatus =
    status === 'FAILED'
      ? OperationStatus.FAILED
      : status === 'BLOCKED'
        ? OperationStatus.BLOCKED
        : OperationStatus.COMPLETED;
  await persistOperationStatus(finalOperation, terminalOperationStatus);

  return {
    status,
    executedActionIds,
    failedActionIds,
    blockedActionIds,
    finalStatusByActionId,
  };
}

export default runOperation;
