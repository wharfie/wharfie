import { Command } from 'commander';

import { assertWorkflowRunId } from '../../lib/ledger/workflow-execution-contract.js';
import { assertLedgerOpaqueId } from '../../lib/ledger/record-key.js';
import { cloneJsonValue } from '../json-value.js';
import { assertLogicalId } from '../logical-id.js';
import { signalLocalDurableWorkflow } from '../services/resident-activity-worker.js';
import { inspectExecutionLedgerRun } from './execution-ledger-operator.js';
import { resolveExecutionLedgerStoreConfiguration } from './execution-ledger-store.js';

export const DURABLE_WORKFLOW_SIGNAL_RECEIPT_SCHEMA_VERSION = 1;
export const DURABLE_WORKFLOW_SIGNAL_RECEIPT_KIND =
  'wharfie.execution-ledger.signal';

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
function activationKind(run, cursor) {
  if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status)) {
    return 'terminal';
  }
  if (Object.prototype.hasOwnProperty.call(cursor, 'invocationId')) {
    return 'activity';
  }
  if (Object.prototype.hasOwnProperty.call(cursor, 'timerId')) return 'timer';
  if (Object.prototype.hasOwnProperty.call(cursor, 'signalWaitId')) {
    return 'signal';
  }
  return 'terminal';
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
      kind: activationKind(run, cursor),
    }),
  });
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
        else output.table([receipt]);
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
