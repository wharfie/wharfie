import {
  assertWorkflowRunId,
  assertWorkflowTimerId,
} from '../lib/ledger/workflow-execution-contract.js';
import { assertLedgerOpaqueId } from '../lib/ledger/record-key.js';
import { cloneJsonObject, cloneJsonValue } from './json-value.js';
import { assertLogicalId } from './logical-id.js';

export const WORKFLOW_SIGNAL_OPERATOR_ACTOR_KIND = 'workflow-signal-operator';

/**
 * Fire one exact due framework timer. The ledger remains the only clock and
 * continuation authority; this wrapper deliberately never dispatches authored
 * activity code.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, runId: string, timerId: string, actor?: {kind: string, id: string}, observedAt?: number}} options - Exact timer activation.
 * @returns {Promise<Readonly<Record<string, any>>>} - Durable timer decision.
 */
export async function fireWorkflowLedgerTimer(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('fireWorkflowLedgerTimer requires options.');
  }
  const allowed = new Set([
    'ledger',
    'runId',
    'timerId',
    'actor',
    'observedAt',
  ]);
  for (const key of Reflect.ownKeys(options)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      throw new TypeError(
        `fireWorkflowLedgerTimer.${String(key)} is not supported.`,
      );
    }
  }
  const ledger = /** @type {any} */ (options.ledger);
  if (!ledger || typeof ledger.fireWorkflowTimer !== 'function') {
    throw new TypeError(
      'fireWorkflowLedgerTimer requires a workflow timer ledger.',
    );
  }
  assertWorkflowRunId(options.runId, 'fireWorkflowLedgerTimer.runId');
  const runId = options.runId;
  assertWorkflowTimerId(options.timerId, 'fireWorkflowLedgerTimer.timerId');
  const timerId = options.timerId;
  const actor =
    options.actor === undefined
      ? undefined
      : /** @type {{kind: string, id: string}} */ (
          cloneJsonObject(options.actor, 'Workflow timer actor')
        );
  return await ledger.fireWorkflowTimer({
    runId,
    timerId,
    ...(actor === undefined ? {} : { actor }),
    ...(options.observedAt === undefined
      ? {}
      : { observedAt: options.observedAt }),
  });
}

/**
 * Submit one stable signal delivery. The app-scoped actor is fixed here so an
 * exact retry through source, packaged, resident, or short-lived-owner paths
 * always describes the same durable request.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, appId: string, runId: string, signalId: string, deliveryId: string, payload: any, observedAt?: number}} options - Signal delivery request.
 * @returns {Promise<Readonly<Record<string, any>>>} - Durable accept/reject decision.
 */
export async function deliverWorkflowLedgerSignal(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('deliverWorkflowLedgerSignal requires options.');
  }
  const allowed = new Set([
    'ledger',
    'appId',
    'runId',
    'signalId',
    'deliveryId',
    'payload',
    'observedAt',
  ]);
  for (const key of Reflect.ownKeys(options)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      throw new TypeError(
        `deliverWorkflowLedgerSignal.${String(key)} is not supported.`,
      );
    }
  }
  const ledger = /** @type {any} */ (options.ledger);
  if (!ledger || typeof ledger.deliverWorkflowSignal !== 'function') {
    throw new TypeError(
      'deliverWorkflowLedgerSignal requires a workflow signal ledger.',
    );
  }
  assertLogicalId(options.appId, 'deliverWorkflowLedgerSignal.appId');
  const appId = options.appId;
  assertWorkflowRunId(options.runId, 'deliverWorkflowLedgerSignal.runId');
  const runId = options.runId;
  assertLogicalId(options.signalId, 'deliverWorkflowLedgerSignal.signalId');
  const signalId = options.signalId;
  const deliveryId = assertLedgerOpaqueId(
    options.deliveryId,
    'deliverWorkflowLedgerSignal.deliveryId',
  );
  if (!Object.prototype.hasOwnProperty.call(options, 'payload')) {
    throw new TypeError('deliverWorkflowLedgerSignal requires payload.');
  }
  const payload = cloneJsonValue(options.payload, 'Workflow signal payload');
  return await ledger.deliverWorkflowSignal({
    appId,
    runId,
    signalId,
    deliveryId,
    payload,
    actor: {
      kind: WORKFLOW_SIGNAL_OPERATOR_ACTOR_KIND,
      id: appId,
    },
    ...(options.observedAt === undefined
      ? {}
      : { observedAt: options.observedAt }),
  });
}

export default {
  WORKFLOW_SIGNAL_OPERATOR_ACTOR_KIND,
  deliverWorkflowLedgerSignal,
  fireWorkflowLedgerTimer,
};
