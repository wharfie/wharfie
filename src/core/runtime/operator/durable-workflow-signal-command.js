import { Command } from 'commander';

import { RunStatus } from '../../lib/ledger/execution-ledger-contract.js';
import {
  WorkflowCursorDisposition,
  assertWorkflowRunId,
} from '../../lib/ledger/workflow-execution-contract.js';
import { assertLedgerOpaqueId } from '../../lib/ledger/record-key.js';
import { cloneJsonValue } from '../json-value.js';
import { assertLogicalId } from '../logical-id.js';
import { signalLocalDurableWorkflow } from '../services/resident-activity-worker.js';
import { inspectExecutionLedgerRun } from './execution-ledger-operator.js';
import { resolveExecutionLedgerStoreConfiguration } from './execution-ledger-store.js';

export const DURABLE_WORKFLOW_SIGNAL_RECEIPT_SCHEMA_VERSION = 1;
export const DURABLE_WORKFLOW_SIGNAL_RECEIPT_KIND =
  'wharfie.execution-ledger.signal';

const SIGNAL_CURSOR_CONTRACTS = Object.freeze({
  [WorkflowCursorDisposition.ACTIVITY_RUNNABLE]: Object.freeze({
    runStatus: RunStatus.RUNNING,
    activationKey: 'invocationId',
    activationKind: 'activity',
  }),
  [WorkflowCursorDisposition.ACTIVITY_RUNNING]: Object.freeze({
    runStatus: RunStatus.RUNNING,
    activationKey: 'invocationId',
    activationKind: 'activity',
  }),
  [WorkflowCursorDisposition.ACTIVITY_UNCERTAIN]: Object.freeze({
    runStatus: RunStatus.BLOCKED,
    activationKey: 'invocationId',
    activationKind: 'activity',
  }),
  [WorkflowCursorDisposition.TIMER_WAITING]: Object.freeze({
    runStatus: RunStatus.RUNNING,
    activationKey: 'timerId',
    activationKind: 'timer',
  }),
  [WorkflowCursorDisposition.SIGNAL_WAITING]: Object.freeze({
    runStatus: RunStatus.RUNNING,
    activationKey: 'signalWaitId',
    activationKind: 'signal',
  }),
  [WorkflowCursorDisposition.CANCELLED]: Object.freeze({
    runStatus: RunStatus.CANCELLED,
    activationKind: 'terminal',
  }),
  [WorkflowCursorDisposition.COMPLETED]: Object.freeze({
    runStatus: RunStatus.COMPLETED,
    activationKind: 'terminal',
  }),
  [WorkflowCursorDisposition.FAILED]: Object.freeze({
    runStatus: RunStatus.FAILED,
    activationKey: 'invocationId',
    activationKind: 'terminal',
  }),
  [WorkflowCursorDisposition.PROTOCOL_FAILED]: Object.freeze({
    runStatus: RunStatus.FAILED,
    activationKey: 'invocationId',
    activationKind: 'terminal',
  }),
});
const SIGNAL_CURSOR_ACTIVATION_KEYS = Object.freeze([
  'invocationId',
  'timerId',
  'signalWaitId',
]);

/**
 * @typedef DurableWorkflowSignalCommandOutput
 * @property {(value: Record<string, any>) => void} json - Write one redacted receipt.
 * @property {(rows: Record<string, any>[]) => void} table - Write redacted rows.
 * @property {(message: string) => void} success - Write accepted text.
 * @property {(error: unknown) => void} failure - Write a safe failure.
 */

/**
 * @param {Partial<DurableWorkflowSignalCommandOutput> | undefined} provided - Optional host output hooks.
 * @returns {DurableWorkflowSignalCommandOutput} - Complete output adapter.
 */
function resolveOutput(provided) {
  return {
    json:
      provided?.json ||
      ((value) => {
        console.log(JSON.stringify(value));
      }),
    table: provided?.table || ((rows) => console.table(rows)),
    success:
      provided?.success ||
      ((message) => {
        console.log('OK', message);
      }),
    failure:
      provided?.failure ||
      ((error) => {
        console.error(error instanceof Error ? error.message : String(error));
      }),
  };
}

/**
 * @param {unknown} value - Required JSON option.
 * @returns {any} - Parsed JSON value, including null.
 */
function parseSignalPayload(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('--payload must contain JSON.');
  }
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Invalid signal payload JSON.');
  }
  return cloneJsonValue(parsed, 'Workflow signal payload');
}

/**
 * Resolve an existing run's immutable app scope before entering the local
 * resident-or-short-lived-owner mutation boundary. Missing runs are refused
 * without opening a writable store or publishing the payload.
 * @param {{runId: string, signalId: string, deliveryId: string, payload: any, expectedAppId?: string, configuration?: ReturnType<typeof resolveExecutionLedgerStoreConfiguration>}} options - Public local delivery request.
 * @returns {Promise<Readonly<Record<string, any>>>} - Durable decision or unknown-run refusal.
 */
export async function deliverLocalDurableWorkflowSignal(options) {
  const configuration =
    options.configuration || resolveExecutionLedgerStoreConfiguration();
  const view = await inspectExecutionLedgerRun({
    runId: options.runId,
    configuration,
  });
  if (!view) {
    return Object.freeze({ applied: false, outcome: 'unknown-run' });
  }
  const run = view.run;
  if (
    options.expectedAppId !== undefined &&
    run.appId !== options.expectedAppId
  ) {
    throw new Error(
      `Durable workflow run ${options.runId} does not belong to the packaged application.`,
    );
  }
  return await signalLocalDurableWorkflow({
    appId: run.appId,
    runId: options.runId,
    signalId: options.signalId,
    deliveryId: options.deliveryId,
    payload: options.payload,
    configuration,
  });
}

/**
 * @param {Record<string, any>} run - Current run projection.
 * @param {Record<string, any>} cursor - Current cursor projection.
 * @returns {'activity'|'timer'|'signal'|'terminal'} - Safe activation class.
 */
function validateSignalCursorLifecycle(run, cursor) {
  const contract =
    SIGNAL_CURSOR_CONTRACTS[
      /** @type {keyof typeof SIGNAL_CURSOR_CONTRACTS} */ (cursor.disposition)
    ];
  const activationKeys = SIGNAL_CURSOR_ACTIVATION_KEYS.filter((key) =>
    Object.prototype.hasOwnProperty.call(cursor, key),
  );
  const activationId =
    activationKeys.length === 1 ? cursor[activationKeys[0]] : undefined;
  if (
    !contract ||
    run.status !== contract.runStatus ||
    activationKeys.length !== 1 ||
    ('activationKey' in contract &&
      activationKeys[0] !== contract.activationKey) ||
    typeof activationId !== 'string' ||
    activationId.length === 0 ||
    typeof cursor.stepId !== 'string' ||
    cursor.stepId.length === 0 ||
    !Number.isSafeInteger(cursor.stepIndex) ||
    cursor.stepIndex < 0
  ) {
    throw new TypeError(
      'Durable workflow signal returned inconsistent durable status.',
    );
  }
  return contract.activationKind;
}

/**
 * Validate a signal result against caller-known identity and expose no payload,
 * payload reference, digest, activation identity, timer deadline, actor, or
 * other private durable detail.
 * @param {unknown} value - Runtime delivery result.
 * @param {{runId: string, signalId: string, deliveryId: string}} expected - Caller request identity.
 * @returns {Readonly<Record<string, any>>} - Compact redacted receipt.
 */
export function createDurableWorkflowSignalReceipt(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Durable workflow signal returned no result.');
  }
  const result = /** @type {Record<string, any>} */ (value);
  if (result.outcome === 'unknown-run') {
    if (result.applied !== false) {
      throw new TypeError(
        'Unknown workflow signal result cannot report a durable mutation.',
      );
    }
    return Object.freeze({
      schemaVersion: DURABLE_WORKFLOW_SIGNAL_RECEIPT_SCHEMA_VERSION,
      kind: DURABLE_WORKFLOW_SIGNAL_RECEIPT_KIND,
      runId: expected.runId,
      signalId: expected.signalId,
      deliveryId: expected.deliveryId,
      outcome: 'unknown-run',
      reused: false,
    });
  }
  if (
    !['accepted', 'rejected'].includes(result.outcome) ||
    typeof result.applied !== 'boolean' ||
    !result.run ||
    !result.workflowCursor ||
    !result.signalDelivery
  ) {
    throw new TypeError(
      'Durable workflow signal must return one accepted or rejected ledger decision.',
    );
  }
  const run = result.run;
  const cursor = result.workflowCursor;
  const delivery = result.signalDelivery;
  if (
    !run ||
    typeof run !== 'object' ||
    Array.isArray(run) ||
    !cursor ||
    typeof cursor !== 'object' ||
    Array.isArray(cursor) ||
    !delivery ||
    typeof delivery !== 'object' ||
    Array.isArray(delivery) ||
    run.runId !== expected.runId ||
    cursor.runId !== expected.runId ||
    delivery.runId !== expected.runId ||
    delivery.deliveryId !== expected.deliveryId ||
    delivery.signalId !== expected.signalId ||
    delivery.status !== result.outcome.toUpperCase()
  ) {
    throw new Error(
      'Durable workflow signal returned an unexpected immutable delivery identity.',
    );
  }
  if (
    typeof run.appId !== 'string' ||
    run.appId.length === 0 ||
    typeof run.revisionId !== 'string' ||
    run.revisionId.length === 0 ||
    run.trigger?.kind !== 'workflow' ||
    typeof run.trigger.workflowId !== 'string' ||
    run.trigger.workflowId.length === 0 ||
    typeof run.trigger.planId !== 'string' ||
    run.trigger.planId.length === 0 ||
    cursor.appId !== run.appId ||
    cursor.revisionId !== run.revisionId ||
    cursor.workflowId !== run.trigger.workflowId ||
    cursor.planId !== run.trigger.planId ||
    delivery.appId !== run.appId
  ) {
    throw new Error(
      'Durable workflow signal returned an unexpected immutable workflow identity.',
    );
  }
  const hasResultRejectionReason = Object.prototype.hasOwnProperty.call(
    result,
    'rejectionReason',
  );
  const hasDeliveryRejectionReason = Object.prototype.hasOwnProperty.call(
    delivery,
    'rejectionReason',
  );
  if (result.outcome === 'rejected') {
    if (
      !['early-signal', 'unexpected-signal', 'late-signal'].includes(
        result.rejectionReason,
      ) ||
      !hasDeliveryRejectionReason ||
      delivery.rejectionReason !== result.rejectionReason
    ) {
      throw new TypeError(
        'Durable workflow signal returned an inconsistent rejection reason.',
      );
    }
  } else if (hasResultRejectionReason || hasDeliveryRejectionReason) {
    throw new TypeError(
      'Accepted durable workflow signal cannot contain a rejection reason.',
    );
  }
  const nextActivationKind = validateSignalCursorLifecycle(run, cursor);
  return Object.freeze({
    schemaVersion: DURABLE_WORKFLOW_SIGNAL_RECEIPT_SCHEMA_VERSION,
    kind: DURABLE_WORKFLOW_SIGNAL_RECEIPT_KIND,
    runId: expected.runId,
    signalId: expected.signalId,
    deliveryId: expected.deliveryId,
    outcome: result.outcome,
    ...(result.outcome === 'rejected'
      ? { rejectionReason: result.rejectionReason }
      : {}),
    reused: result.applied === false,
    runStatus: run.status,
    cursor: Object.freeze({
      disposition: cursor.disposition,
      stepId: cursor.stepId,
      stepIndex: cursor.stepIndex,
    }),
    nextActivation: Object.freeze({
      kind: nextActivationKind,
    }),
  });
}

/**
 * Render the stable human table view without coupling it to the JSON schema.
 * @param {Record<string, any>} receipt - Valid versioned signal receipt.
 * @returns {Record<string, any>} - Concise snake_case row.
 */
export function formatDurableWorkflowSignalHumanRow(receipt) {
  if (
    !receipt ||
    typeof receipt !== 'object' ||
    Array.isArray(receipt) ||
    receipt.schemaVersion !== DURABLE_WORKFLOW_SIGNAL_RECEIPT_SCHEMA_VERSION ||
    receipt.kind !== DURABLE_WORKFLOW_SIGNAL_RECEIPT_KIND ||
    typeof receipt.runId !== 'string' ||
    receipt.runId.length === 0 ||
    typeof receipt.signalId !== 'string' ||
    receipt.signalId.length === 0 ||
    typeof receipt.deliveryId !== 'string' ||
    receipt.deliveryId.length === 0 ||
    !['accepted', 'rejected', 'unknown-run'].includes(receipt.outcome) ||
    typeof receipt.reused !== 'boolean' ||
    (receipt.outcome === 'rejected'
      ? !['early-signal', 'unexpected-signal', 'late-signal'].includes(
          receipt.rejectionReason,
        )
      : Object.prototype.hasOwnProperty.call(receipt, 'rejectionReason'))
  ) {
    throw new TypeError('Durable workflow signal receipt is invalid.');
  }
  const cursor = receipt.cursor;
  const nextActivation = receipt.nextActivation;
  if (
    receipt.outcome !== 'unknown-run' &&
    (typeof receipt.runStatus !== 'string' ||
      !cursor ||
      typeof cursor !== 'object' ||
      Array.isArray(cursor) ||
      typeof cursor.disposition !== 'string' ||
      typeof cursor.stepId !== 'string' ||
      !Number.isSafeInteger(cursor.stepIndex) ||
      !nextActivation ||
      typeof nextActivation !== 'object' ||
      Array.isArray(nextActivation) ||
      !['activity', 'timer', 'signal', 'terminal'].includes(
        nextActivation.kind,
      ))
  ) {
    throw new TypeError('Durable workflow signal receipt is invalid.');
  }
  return {
    delivery_id: receipt.deliveryId,
    run_id: receipt.runId,
    signal: receipt.signalId,
    outcome: receipt.outcome,
    rejection_reason: receipt.rejectionReason || '',
    reused: receipt.reused,
    status: receipt.runStatus || '',
    cursor_disposition: cursor?.disposition || '',
    step: cursor?.stepId || '',
    step_index: cursor?.stepIndex ?? '',
    activation_kind: nextActivation?.kind || '',
  };
}

/**
 * Create the one shared source/package signal command. Packaged callers inject
 * immutable app identity; source callers resolve scope from the existing run.
 * @param {{resolveExpectedIdentity?: () => Promise<{appId: string, revisionId?: string}> | {appId: string, revisionId?: string}, deliverSignal?: typeof deliverLocalDurableWorkflowSignal, output?: Partial<DurableWorkflowSignalCommandOutput>, processRef?: {exitCode: number | undefined}}} [options] - Host seams.
 * @returns {Command} - Fresh signal command.
 */
export function createDurableWorkflowSignalCommand(options = {}) {
  const output = resolveOutput(options.output);
  const deliverSignal =
    options.deliverSignal || deliverLocalDurableWorkflowSignal;
  const processRef = options.processRef || process;
  return new Command('signal')
    .description('Deliver one stable JSON payload to a waiting workflow signal')
    .requiredOption('--run-id <runId>', 'Persisted workflow run ID')
    .requiredOption('--signal <signalId>', 'Expected workflow signal step ID')
    .requiredOption(
      '--delivery-id <deliveryId>',
      'Stable delivery ID; reuse it after a lost response',
    )
    .requiredOption('--payload <json>', 'Required JSON signal payload')
    .option('--json', 'Write one redacted machine-readable signal receipt')
    .action(async (commandOptions) => {
      try {
        assertWorkflowRunId(commandOptions.runId, 'signal --run-id');
        assertLogicalId(commandOptions.signal, 'signal --signal');
        const deliveryId = assertLedgerOpaqueId(
          commandOptions.deliveryId,
          'signal --delivery-id',
        );
        const payload = parseSignalPayload(commandOptions.payload);
        const identity = options.resolveExpectedIdentity
          ? await options.resolveExpectedIdentity()
          : undefined;
        if (identity) assertLogicalId(identity.appId, 'signal expected appId');
        const expected = {
          runId: commandOptions.runId,
          signalId: commandOptions.signal,
          deliveryId,
        };
        const result = await deliverSignal({
          ...expected,
          payload,
          ...(identity ? { expectedAppId: identity.appId } : {}),
        });
        const receipt = createDurableWorkflowSignalReceipt(result, expected);
        if (commandOptions.json === true) output.json(receipt);
        else output.table([formatDurableWorkflowSignalHumanRow(receipt)]);
        if (receipt.outcome === 'accepted') {
          if (commandOptions.json !== true) {
            output.success(
              receipt.reused
                ? `Workflow signal delivery ${deliveryId} was already accepted.`
                : `Accepted workflow signal delivery ${deliveryId}.`,
            );
          }
          return;
        }
        const reason =
          receipt.outcome === 'unknown-run'
            ? 'the workflow run does not exist'
            : `the delivery was rejected (${receipt.rejectionReason})`;
        output.failure(
          new Error(`Workflow signal was not accepted: ${reason}.`),
        );
        processRef.exitCode = 1;
      } catch (error) {
        output.failure(error);
        processRef.exitCode = 1;
      }
    });
}

export default createDurableWorkflowSignalCommand;
