import { Command, InvalidArgumentError } from 'commander';

import {
  ACTIVITY_PROTOCOL_NAME,
  ACTIVITY_PROTOCOL_VERSION,
  validateActivityProtocolComponentFrame,
} from '../activity-protocol.js';
import { assertApplicationRevisionId } from '../application-revision.js';
import { cloneBoundedJsonObject } from '../json-value.js';
import { assertLogicalId } from '../logical-id.js';
import { WORKFLOW_MAX_STEPS } from '../workflow-definition.js';
import {
  RunStatus,
  assertPositiveSafeInteger,
  deepFreezeJson,
  hasSameCanonicalJson,
} from '../../lib/ledger/execution-ledger-contract.js';
import { assertLedgerOpaqueId } from '../../lib/ledger/record-key.js';
import {
  EXECUTION_LEDGER_RUN_OUTPUT_DISCLOSURE,
  EXECUTION_LEDGER_RUN_OUTPUT_KIND,
  EXECUTION_LEDGER_RUN_OUTPUT_MAX_BYTES,
  EXECUTION_LEDGER_RUN_OUTPUT_SCHEMA_VERSION,
} from '../../lib/ledger/run-output.js';
import { withExecutionLedger } from './execution-ledger-store.js';
import {
  renderBoundedTerminalSafeJson,
  renderTerminalSafeJson,
} from './terminal-safe-json.js';

const INVALID_OUTPUT =
  'Execution-ledger run output returned an invalid verified snapshot.';
const SAFE_FAILURE =
  'Sensitive durable run output could not be read safely. No partial output was emitted.';
const CONFIRMATION_REQUIRED =
  'output requires --confirm-sensitive-output because durable run outputs are unredacted and may contain secrets.';
const RUN_KINDS = new Set(['manual', 'workflow', 'effect-successor']);
const ERROR_TERMINAL_TYPES = new Set([
  'failed',
  'cancelled',
  'protocol-failed',
]);

/**
 * @typedef ExecutionLedgerRunOutputPort
 * @property {(value: Record<string, any>, rendered?: string) => void} json - Write one raw JSON document, optionally using its prevalidated terminal-safe encoding.
 * @property {(rows: Array<Record<string, any>>) => void} table - Write one terminal-safe human table.
 * @property {(error: Error) => void} failure - Write one fixed safe failure.
 */

/**
 * @param {unknown} value - Candidate object.
 * @returns {value is Record<string, any>} - Whether value is a non-array object.
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {Record<string, any>} value - Candidate exact object.
 * @param {string[]} required - Exact supported keys.
 * @returns {void} - Throws on a missing or unknown key.
 */
function assertKeys(value, required) {
  const accepted = new Set(required);
  const keys = Object.keys(value);
  if (
    keys.length !== required.length ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    keys.some((key) => !accepted.has(key))
  ) {
    throw new TypeError(INVALID_OUTPUT);
  }
}

/**
 * @param {unknown} value - Candidate exact read request.
 * @returns {{appId: string, runId: string}} - Strict app/run scope.
 */
function normalizeReadRequest(value) {
  if (!isObject(value)) {
    throw new TypeError('Execution-ledger run-output request is invalid.');
  }
  assertKeys(value, ['appId', 'runId']);
  assertLogicalId(value.appId, 'run-output request.appId');
  return {
    appId: /** @type {string} */ (value.appId),
    runId: assertLedgerOpaqueId(value.runId, 'run-output request.runId'),
  };
}

/**
 * @param {unknown} error - Candidate adapter error.
 * @returns {boolean} - Whether the read-only local store is absent.
 */
function isMissingReadOnlyStore(error) {
  return isObject(error) && error.code === 'WHARFIE_READ_ONLY_STORE_NOT_FOUND';
}

/**
 * Read one verified sensitive snapshot through the default read-only store.
 * A store that has never existed is indistinguishable from a missing run.
 * @param {unknown} value - Exact app/run request.
 * @returns {Promise<Record<string, any> | null>} - Raw ledger snapshot.
 */
export async function readExecutionLedgerRunOutput(value) {
  const request = normalizeReadRequest(value);
  try {
    return await withExecutionLedger(
      async (ledger) => await ledger.readRunOutput(request),
      { readOnly: true },
    );
  } catch (error) {
    if (isMissingReadOnlyStore(error)) return null;
    throw error;
  }
}

/**
 * @param {unknown} value - Candidate verified scope.
 * @param {{appId: string, runId: string}} request - Requested scope.
 * @returns {{appId: string, revisionId: string, runId: string}} - Strict public scope.
 */
function projectScope(value, request) {
  if (!isObject(value)) throw new TypeError(INVALID_OUTPUT);
  assertKeys(value, ['appId', 'revisionId', 'runId']);
  assertLogicalId(value.appId, 'run-output scope.appId');
  assertApplicationRevisionId(value.revisionId, 'run-output scope.revisionId');
  assertLedgerOpaqueId(value.runId, 'run-output scope.runId');
  if (value.appId !== request.appId || value.runId !== request.runId) {
    throw new TypeError(INVALID_OUTPUT);
  }
  return {
    appId: value.appId,
    revisionId: value.revisionId,
    runId: value.runId,
  };
}

/**
 * @param {unknown} value - Candidate verified polling state.
 * @returns {{runKind: string, status: string, version: number, lastSequence: number}} - Strict public snapshot.
 */
function projectSnapshot(value) {
  if (!isObject(value)) throw new TypeError(INVALID_OUTPUT);
  assertKeys(value, ['runKind', 'status', 'version', 'lastSequence']);
  if (
    typeof value.runKind !== 'string' ||
    !RUN_KINDS.has(value.runKind) ||
    typeof value.status !== 'string' ||
    !Object.values(RunStatus).includes(/** @type {any} */ (value.status))
  ) {
    throw new TypeError(INVALID_OUTPUT);
  }
  return {
    runKind: value.runKind,
    status: value.status,
    version: assertPositiveSafeInteger(
      value.version,
      'run-output snapshot.version',
    ),
    lastSequence: assertPositiveSafeInteger(
      value.lastSequence,
      'run-output snapshot.lastSequence',
    ),
  };
}

/**
 * Validate one structured error by passing it through the same Activity
 * Protocol component boundary that produced authored activity failures.
 * @param {string} type - Error terminal type.
 * @param {unknown} value - Candidate structured error.
 * @returns {Record<string, any>} - Strict independent error.
 */
function projectStructuredError(type, value) {
  const terminal = validateActivityProtocolComponentFrame(
    {
      protocol: ACTIVITY_PROTOCOL_NAME,
      protocolVersion: ACTIVITY_PROTOCOL_VERSION,
      type,
      attemptId: 'run-output-projection',
      sequence: 1,
      error: value,
    },
    'run-output terminal',
  );
  return /** @type {Record<string, any>} */ (terminal.error);
}

/**
 * @param {string} runKind - Verified aggregate run kind.
 * @param {string} status - Verified aggregate run status.
 * @param {string} type - Candidate logical error terminal type.
 * @returns {boolean} - Whether the persisted ledger can produce this tuple.
 */
function isAllowedErrorTerminal(runKind, status, type) {
  if (runKind === 'effect-successor') {
    return status === RunStatus.FAILED && type === 'failed';
  }
  if (status === RunStatus.CANCELLED) return type === 'cancelled';
  return (
    status === RunStatus.FAILED &&
    (type === 'failed' || type === 'protocol-failed')
  );
}

/**
 * @param {unknown} value - Candidate output array.
 * @param {string} runKind - Verified run kind.
 * @returns {Array<{stepId: string, stepIndex: number, value: any}>} - Strict ordered output values.
 */
function projectOutputs(value, runKind) {
  if (
    !Array.isArray(value) ||
    value.length > WORKFLOW_MAX_STEPS ||
    (runKind !== 'workflow' && value.length !== 0)
  ) {
    throw new TypeError(INVALID_OUTPUT);
  }
  const stepIds = new Set();
  return value.map((candidate, index) => {
    if (!Object.hasOwn(value, index) || !isObject(candidate)) {
      throw new TypeError(INVALID_OUTPUT);
    }
    assertKeys(candidate, ['stepId', 'stepIndex', 'value']);
    assertLogicalId(candidate.stepId, `run-output outputs[${index}].stepId`);
    if (candidate.stepIndex !== index || stepIds.has(candidate.stepId)) {
      throw new TypeError(INVALID_OUTPUT);
    }
    stepIds.add(candidate.stepId);
    return {
      stepId: candidate.stepId,
      stepIndex: index,
      value: candidate.value,
    };
  });
}

/**
 * @param {unknown} value - Candidate nullable logical terminal.
 * @param {string} status - Verified aggregate run status.
 * @param {string} runKind - Verified aggregate run kind.
 * @returns {{type: string, result?: any, error?: Record<string, any>} | null} - Strict terminal union.
 */
function projectTerminal(value, status, runKind) {
  const isTerminalStatus = [
    RunStatus.COMPLETED,
    RunStatus.FAILED,
    RunStatus.CANCELLED,
  ].includes(/** @type {any} */ (status));
  if (value === null) {
    if (isTerminalStatus) throw new TypeError(INVALID_OUTPUT);
    return null;
  }
  if (!isTerminalStatus || !isObject(value) || typeof value.type !== 'string') {
    throw new TypeError(INVALID_OUTPUT);
  }
  if (value.type === 'completed') {
    assertKeys(value, ['type', 'result']);
    if (status !== RunStatus.COMPLETED) throw new TypeError(INVALID_OUTPUT);
    return { type: value.type, result: value.result };
  }
  if (!ERROR_TERMINAL_TYPES.has(value.type)) {
    throw new TypeError(INVALID_OUTPUT);
  }
  assertKeys(value, ['type', 'error']);
  if (!isAllowedErrorTerminal(runKind, status, value.type)) {
    throw new TypeError(INVALID_OUTPUT);
  }
  return {
    type: value.type,
    error: projectStructuredError(value.type, value.error),
  };
}

/**
 * Validate the complete raw snapshot before any output method is called.
 * @param {unknown} raw - Candidate ledger result.
 * @param {{appId: string, runId: string}} request - Exact requested scope.
 * @returns {{scope: Record<string, any>, snapshot: Record<string, any>, outputs: Record<string, any>[], terminal: Record<string, any> | null}} - Strict public data.
 */
function projectRunOutput(raw, request) {
  const value = cloneBoundedJsonObject(
    raw,
    EXECUTION_LEDGER_RUN_OUTPUT_MAX_BYTES,
    'execution-ledger run output',
  );
  assertKeys(value, ['scope', 'snapshot', 'outputs', 'terminal']);
  const scope = projectScope(value.scope, request);
  const snapshot = projectSnapshot(value.snapshot);
  const outputs = projectOutputs(value.outputs, snapshot.runKind);
  const terminal = projectTerminal(
    value.terminal,
    snapshot.status,
    snapshot.runKind,
  );
  if (
    snapshot.runKind === 'workflow' &&
    snapshot.status === RunStatus.COMPLETED &&
    (outputs.length === 0 ||
      terminal?.type !== 'completed' ||
      !hasSameCanonicalJson(outputs.at(-1)?.value, terminal.result))
  ) {
    throw new TypeError(INVALID_OUTPUT);
  }
  return {
    scope,
    snapshot,
    outputs,
    terminal,
  };
}

/**
 * Pre-render every application-controlled value before the first output call.
 * @param {{scope: Record<string, any>, snapshot: Record<string, any>, outputs: Record<string, any>[], terminal: Record<string, any> | null}} value - Strict public data.
 * @returns {Array<Record<string, any>>} - Terminal-inert human rows.
 */
function createHumanRows(value) {
  return [
    {
      entry: 'scope',
      step_index: '',
      step_id_json: '',
      value_json: renderTerminalSafeJson(value.scope),
    },
    {
      entry: 'snapshot',
      step_index: '',
      step_id_json: '',
      value_json: renderTerminalSafeJson(value.snapshot),
    },
    ...value.outputs.map((output) => ({
      entry: 'output',
      step_index: output.stepIndex,
      step_id_json: renderTerminalSafeJson(output.stepId),
      value_json: renderTerminalSafeJson(output.value),
    })),
    {
      entry: 'terminal',
      step_index: '',
      step_id_json: '',
      value_json: renderTerminalSafeJson(value.terminal),
    },
  ];
}

/**
 * @param {unknown} provided - Optional output overrides.
 * @returns {ExecutionLedgerRunOutputPort} - Complete output port.
 */
function resolveOutput(provided) {
  if (provided !== undefined && !isObject(provided)) {
    throw new TypeError('Execution-ledger run output must be an object.');
  }
  const candidate =
    provided === undefined ? {} : /** @type {Record<string, any>} */ (provided);
  for (const key of ['json', 'table', 'failure']) {
    if (candidate[key] !== undefined && typeof candidate[key] !== 'function') {
      throw new TypeError(
        `Execution-ledger run output.${key} must be a function.`,
      );
    }
  }
  return {
    json:
      candidate.json ||
      ((value, rendered) =>
        console.log(rendered ?? renderTerminalSafeJson(value))),
    table: candidate.table || ((rows) => console.table(rows)),
    failure:
      candidate.failure ||
      ((error) => {
        console.error(error.message);
      }),
  };
}

/**
 * @param {string} value - Current CLI value.
 * @param {string | undefined} previous - Previous value.
 * @returns {string} - Canonical application ID.
 */
function parseAppId(value, previous) {
  if (previous !== undefined) {
    throw new InvalidArgumentError('--app-id may be specified only once.');
  }
  try {
    assertLogicalId(value, '--app-id');
    return value;
  } catch {
    throw new InvalidArgumentError('--app-id must be a canonical logical ID.');
  }
}

/**
 * @param {string} value - Current CLI value.
 * @param {string | undefined} previous - Previous value.
 * @returns {string} - Bounded run ID.
 */
function parseRunId(value, previous) {
  if (previous !== undefined) {
    throw new InvalidArgumentError('--run-id may be specified only once.');
  }
  try {
    return assertLedgerOpaqueId(value, '--run-id');
  } catch {
    throw new InvalidArgumentError(
      '--run-id must be a bounded canonical ledger ID.',
    );
  }
}

/**
 * Create the shared source or packaged sensitive run-output command. Source
 * accepts an explicit app ID; a packaged program resolves only its embedded
 * app ID lazily after disclosure confirmation.
 * @param {{allowAppId?: boolean, resolveAppId?: () => unknown | Promise<unknown>, readOutput?: (request: {appId: string, runId: string}) => unknown | Promise<unknown>, output?: Partial<ExecutionLedgerRunOutputPort>}} options - Identity, reader, and output dependencies.
 * @returns {Command} - Fresh `output` command.
 */
export function createExecutionLedgerRunOutputCommand(options) {
  if (!isObject(options)) {
    throw new TypeError(
      'Execution-ledger run-output command options are invalid.',
    );
  }
  const allowAppId = options.allowAppId === true;
  const hasResolver = typeof options.resolveAppId === 'function';
  if (
    (options.allowAppId !== undefined &&
      typeof options.allowAppId !== 'boolean') ||
    allowAppId === hasResolver ||
    (options.readOutput !== undefined &&
      typeof options.readOutput !== 'function')
  ) {
    throw new TypeError(
      'Execution-ledger run-output command identity mode is invalid.',
    );
  }
  const readOutput = options.readOutput || readExecutionLedgerRunOutput;
  const output = resolveOutput(options.output);
  const command = new Command('output').description(
    'Read one run’s verified sensitive durable output snapshot',
  );
  if (allowAppId) {
    command.option(
      '--app-id <appId>',
      'Exact application logical ID that owns the persisted run',
      parseAppId,
    );
  }
  command
    .option(
      '--run-id <runId>',
      'Exact persisted execution-ledger run ID',
      parseRunId,
    )
    .option(
      '--confirm-sensitive-output',
      'Confirm that durable application outputs may contain secrets',
    )
    .option('--json', 'Write one raw machine-readable output snapshot')
    .action(async (commandOptions) => {
      if (commandOptions.confirmSensitiveOutput !== true) {
        output.failure(new Error(CONFIRMATION_REQUIRED));
        process.exitCode = 1;
        return;
      }
      /** @type {undefined | (() => void)} */
      let emit;
      try {
        const appIdValue = allowAppId
          ? commandOptions.appId
          : await options.resolveAppId?.();
        const request = normalizeReadRequest({
          appId: appIdValue,
          runId: commandOptions.runId,
        });
        const raw = await readOutput(request);
        if (raw === null) throw new TypeError(INVALID_OUTPUT);
        const projected = projectRunOutput(raw, request);
        const publicOutput = deepFreezeJson(
          cloneBoundedJsonObject(
            {
              schemaVersion: EXECUTION_LEDGER_RUN_OUTPUT_SCHEMA_VERSION,
              kind: EXECUTION_LEDGER_RUN_OUTPUT_KIND,
              authority: 'none',
              authoritative: false,
              disclosure: EXECUTION_LEDGER_RUN_OUTPUT_DISCLOSURE,
              integrity: { verified: true },
              ...projected,
            },
            EXECUTION_LEDGER_RUN_OUTPUT_MAX_BYTES,
            'public execution-ledger run output',
          ),
        );
        const rendered = renderBoundedTerminalSafeJson(
          publicOutput,
          EXECUTION_LEDGER_RUN_OUTPUT_MAX_BYTES,
          'public execution-ledger run output',
        );
        if (commandOptions.json === true) {
          emit = () => output.json(publicOutput, rendered);
        } else {
          const rows = createHumanRows(publicOutput);
          emit = () => output.table(rows);
        }
      } catch {
        output.failure(new Error(SAFE_FAILURE));
        process.exitCode = 1;
        return;
      }
      emit();
    });
  return command;
}

export default createExecutionLedgerRunOutputCommand;
