import { Status as ActionStatus } from './action.js';

/**
 * @typedef {import('./action.js').default} ActionInstance
 */

/**
 * Minimal store contract required by the graph runner.
 *
 * NOTE: this intentionally matches the provider-neutral operations table client
 * (createOperationsTable / createOperationsStore).
 * @typedef {Object} OperationRunnerStore
 * @property {(resource_id: string, operation_id?: string) => Promise<{ operations: import('./operation.js').default[]; actions: ActionInstance[]; queries: import('./query.js').default[] }>} getRecords - Load operation/action/query records.
 * @property {(action: ActionInstance, new_status: string) => Promise<boolean>} updateActionStatus - Optimistically transition an action status.
 * @property {(operation: import('./operation.js').default, action_type: import('./action.js').WharfieActionTypeEnum) => Promise<boolean>} [checkActionPrerequisites] - Check whether prerequisites have completed.
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
 * - Repeat until no runnable actions remain
 *
 * This runner is intentionally minimal: it does not attempt concurrency, retries,
 * or operation-level status transitions.
 * @param {RunOperationParams} params - params.
 * @returns {Promise<{ executedActionIds: string[]; finalStatusByActionId: Record<string, string> }>} - Result.
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

  /**
   * @param {import('./operation.js').default} operation - operation.
   * @param {ActionInstance} action - action.
   * @returns {Promise<boolean>} - Result.
   */
  const prerequisitesSatisfied = async (operation, action) => {
    if (typeof store.checkActionPrerequisites === 'function') {
      return store.checkActionPrerequisites(operation, action.type);
    }

    // Fallback: in-memory prerequisite check.
    const upstreamIds = operation.getUpstreamActionIds(action.id) || [];
    if (!upstreamIds.length) return true;

    const { actions } = await store.getRecords(resourceId, operationId);
    const byId = new Map(actions.map((a) => [a.id, a]));
    for (const upstreamId of upstreamIds) {
      const upstream = byId.get(upstreamId);
      if (!upstream || upstream.status !== ActionStatus.COMPLETED) return false;
    }
    return true;
  };

  // Run until no runnable PENDING actions remain.
  // Each loop reloads from the store to ensure DB-backed status is respected.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { operations, actions } = await store.getRecords(
      resourceId,
      operationId,
    );
    const operation = operations.find((o) => o.id === operationId);

    if (!operation) {
      throw new Error(`Operation not found: ${resourceId}#${operationId}`);
    }

    const pending = actions.filter((a) => a.status === ActionStatus.PENDING);
    if (!pending.length) {
      for (const a of actions) finalStatusByActionId[a.id] = a.status;
      break;
    }

    /** @type {ActionInstance[]} */
    const runnable = [];
    for (const action of pending) {
      // eslint-disable-next-line no-await-in-loop
      if (await prerequisitesSatisfied(operation, action))
        runnable.push(action);
    }

    // Deterministic execution order for any concurrently runnable actions.
    runnable.sort((a, b) => a.id.localeCompare(b.id));

    if (!runnable.length) {
      for (const a of actions) finalStatusByActionId[a.id] = a.status;
      break;
    }

    for (const action of runnable) {
      // Optimistically claim the action.
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

  return { executedActionIds, finalStatusByActionId };
}

export default runOperation;
