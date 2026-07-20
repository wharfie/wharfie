import { Command } from 'commander';

const SERVICE_ACTIONS = Object.freeze([
  Object.freeze({
    name: 'install',
    description: 'Install and enable this artifact as a systemd user service',
  }),
  Object.freeze({
    name: 'update',
    description: 'Quiesce and activate this artifact as the next release',
  }),
  Object.freeze({
    name: 'rollback',
    description: 'Quiesce and reactivate the retained prior release',
  }),
  Object.freeze({
    name: 'recover',
    description: 'Resume an interrupted service activation',
  }),
  Object.freeze({
    name: 'start',
    description: 'Start the installed systemd user service',
  }),
  Object.freeze({
    name: 'stop',
    description: 'Gracefully stop the installed systemd user service',
  }),
  Object.freeze({
    name: 'restart',
    description: 'Gracefully restart the installed systemd user service',
  }),
  Object.freeze({
    name: 'status',
    description: 'Inspect the installed systemd user service',
  }),
  Object.freeze({
    name: 'uninstall',
    description: 'Stop, disable, and uninstall the systemd user service',
  }),
]);

const ACTIVATION_ACTIONS = new Set([
  'install',
  'update',
  'rollback',
  'recover',
]);
const ACTIVATION_RECOVERY_REMEDIATION =
  'Run service recover before retrying activation.';
const ACTIVATION_RECOVERY_ERROR_CODE =
  'systemd-user-service-activation-recovery-required';
const SERVICE_REQUEST_STATUSES = new Set([
  'fulfilled',
  'refused',
  'failed',
  'pending',
]);
const ACTIVATION_OUTCOMES = new Set([
  'absent',
  'target-active',
  'source-retained',
  'source-restored',
  'in-flight',
]);
const FULFILLED_ACTIVATION_OUTCOMES = new Set([
  'absent',
  'target-active',
  'source-retained',
  'source-restored',
]);
/** @type {Readonly<Record<string, Set<string>>>} */
const LIFECYCLE_OUTCOMES = Object.freeze({
  start: new Set(['started']),
  stop: new Set(['stopped']),
  restart: new Set(['restarted']),
  uninstall: new Set([
    'uninstalled',
    'already-uninstalled',
    'orphan-reconciled',
  ]),
});
const SERVICE_HEALTH_STATES = new Set([
  'healthy',
  'starting',
  'degraded',
  'stopped',
  'failed',
  'absent',
]);
const SERVICE_RELEASE_REFERENCE_PAIRS = Object.freeze([
  Object.freeze(['activeArtifactId', 'activeRevisionId']),
  Object.freeze(['rollbackArtifactId', 'rollbackRevisionId']),
]);

/**
 * @typedef SystemdUserServiceCommandOutput
 * @property {(value: Record<string, any>) => void} json - Write one machine-readable result.
 * @property {(message: string) => void} line - Write one concise human-readable result.
 * @property {(error: unknown) => void} failure - Write one safe failure line.
 */

/**
 * @typedef SystemdUserServiceCommandProcess
 * @property {number | undefined} exitCode - Process exit status.
 */

/**
 * @typedef {Record<string, (() => Promise<Record<string, any>> | Record<string, any>) | undefined>} SystemdUserServiceOperator
 */

/**
 * Lazily load the Linux implementation so help remains portable and does not
 * inspect or mutate host service-manager state.
 * @returns {Promise<SystemdUserServiceOperator>} - Host service operator.
 */
async function loadDefaultOperator() {
  const { createSystemdUserServiceOperator } =
    await import('../services/systemd-user-service-manager.js');
  return await createSystemdUserServiceOperator();
}

/**
 * @param {Partial<SystemdUserServiceCommandOutput> | undefined} provided - Optional host output hooks.
 * @returns {SystemdUserServiceCommandOutput} - Complete output adapter.
 */
function resolveOutput(provided) {
  return {
    json:
      provided?.json ||
      ((value) => {
        console.log(JSON.stringify(value));
      }),
    line: provided?.line || ((message) => console.log(message)),
    failure:
      provided?.failure ||
      ((error) => {
        console.error(error instanceof Error ? error.message : String(error));
      }),
  };
}

/**
 * @param {Record<string, any>} result - Candidate service result.
 * @returns {boolean} - Whether every exact release reference is finite and paired.
 */
function hasValidReleaseReferences(result) {
  return SERVICE_RELEASE_REFERENCE_PAIRS.every(([artifactKey, revisionKey]) => {
    const artifact = result[artifactKey];
    const revision = result[revisionKey];
    const artifactValid =
      artifact === null ||
      (typeof artifact === 'string' && artifact.length > 0);
    const revisionValid =
      revision === null ||
      (typeof revision === 'string' && revision.length > 0);
    return (
      Object.prototype.hasOwnProperty.call(result, artifactKey) &&
      Object.prototype.hasOwnProperty.call(result, revisionKey) &&
      artifactValid &&
      revisionValid &&
      (artifact === null) === (revision === null)
    );
  });
}

/**
 * @param {Record<string, any>} result - Candidate schema-V1 receipt.
 * @param {string} action - Requested public action.
 * @returns {boolean} - Whether request status and outcome form a supported settlement.
 */
function hasValidResultSettlement(result, action) {
  if (!SERVICE_REQUEST_STATUSES.has(result.requestStatus)) return false;
  if (Object.prototype.hasOwnProperty.call(result, 'settledOutcome')) {
    return false;
  }
  if (ACTIVATION_ACTIONS.has(action)) {
    if (!ACTIVATION_OUTCOMES.has(result.outcome)) return false;
    if (result.requestStatus === 'pending') {
      return result.outcome === 'in-flight';
    }
    if (result.requestStatus === 'refused') {
      return result.outcome === 'source-retained';
    }
    if (result.requestStatus === 'failed') {
      return result.outcome === 'source-restored';
    }
    return FULFILLED_ACTIVATION_OUTCOMES.has(result.outcome);
  }
  return (
    result.requestStatus === 'fulfilled' &&
    LIFECYCLE_OUTCOMES[action]?.has(result.outcome) === true
  );
}

/**
 * Refuse malformed or non-serializable implementation results at the command
 * boundary. The manager owns the receipt schema; this adapter guarantees only
 * that both output modes emit one JSON object rather than host objects such as
 * child processes or errors.
 * @param {unknown} value - Manager result.
 * @param {string} action - Service action name.
 * @returns {Record<string, any>} - JSON-safe result object.
 */
function normalizeResult(value, action) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      `Systemd user service ${action} returned no result object.`,
    );
  }
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError(
      `Systemd user service ${action} returned a non-JSON result.`,
    );
  }
  if (serialized === undefined) {
    throw new TypeError(
      `Systemd user service ${action} returned a non-JSON result.`,
    );
  }
  const normalized = JSON.parse(serialized);
  if (
    !normalized ||
    typeof normalized !== 'object' ||
    Array.isArray(normalized)
  ) {
    throw new TypeError(
      `Systemd user service ${action} returned no result object.`,
    );
  }
  const expectedKind =
    action === 'status' ? 'wharfie.service.status' : 'wharfie.service.result';
  const expectedSchemaVersion = action === 'status' ? 2 : 1;
  const validWiring =
    action !== 'status' ||
    (normalized.wiring &&
      typeof normalized.wiring === 'object' &&
      !Array.isArray(normalized.wiring) &&
      ['managed', 'absent', 'orphaned', 'conflicting', 'unknown'].includes(
        normalized.wiring.state,
      ) &&
      ['managed', 'absent', 'conflicting'].includes(
        normalized.wiring.unitFile,
      ) &&
      ['managed', 'absent', 'conflicting'].includes(
        normalized.wiring.selection,
      ) &&
      ['managed', 'absent', 'conflicting', 'unknown'].includes(
        normalized.wiring.effectiveUnit,
      ) &&
      typeof normalized.wiring.cleanupPending === 'boolean');
  const validResult =
    action === 'status' ||
    (normalized.action === action &&
      SERVICE_HEALTH_STATES.has(normalized.health) &&
      hasValidResultSettlement(normalized, action) &&
      hasValidReleaseReferences(normalized));
  if (
    normalized.schemaVersion !== expectedSchemaVersion ||
    normalized.kind !== expectedKind ||
    typeof normalized.appId !== 'string' ||
    normalized.appId.length === 0 ||
    !validWiring ||
    (action === 'status'
      ? typeof normalized.health !== 'string' || normalized.health.length === 0
      : !validResult)
  ) {
    throw new TypeError(
      `Systemd user service ${action} returned an invalid receipt.`,
    );
  }
  return normalized;
}

/**
 * @param {unknown} error - Operation failure.
 * @param {string} action - Requested operation.
 * @returns {Readonly<Record<string, any>>} - One safe JSON failure receipt.
 */
function createJsonError(error, action) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = Array.from(rawMessage, (character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint < 32 || codePoint === 127 ? ' ' : character;
  })
    .join('')
    .trim()
    .slice(0, 1024);
  const rawCode =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';
  const code = /^[a-z0-9][a-z0-9-]{0,127}$/.test(rawCode)
    ? rawCode
    : 'systemd-user-service-operation-failed';
  const remediation =
    code === ACTIVATION_RECOVERY_ERROR_CODE &&
    error &&
    typeof error === 'object' &&
    'remediation' in error &&
    error.remediation === ACTIVATION_RECOVERY_REMEDIATION
      ? ACTIVATION_RECOVERY_REMEDIATION
      : null;
  return Object.freeze({
    schemaVersion: 1,
    kind: 'wharfie.service.error',
    action,
    code,
    message: message || `Systemd user service ${action} failed.`,
    ...(remediation ? { remediation } : {}),
  });
}

/**
 * Add static recovery guidance to activation failures without exposing host
 * error objects, stacks, or control characters to the human output boundary.
 * @param {unknown} error - Operation failure.
 * @param {string} action - Requested operation.
 * @returns {unknown} - Original lifecycle failure or safe activation error.
 */
function createHumanFailure(error, action) {
  const safe = createJsonError(error, action);
  if (!safe.remediation) return error;
  const failure = new Error(`${safe.message} ${safe.remediation}`);
  Object.assign(failure, { code: safe.code });
  return failure;
}

/**
 * Format a stable one-line human result without requiring the command adapter
 * to understand the service manager's complete receipt schema.
 * @param {{name: string}} action - Static action metadata.
 * @param {Record<string, any>} result - JSON-safe manager result.
 * @returns {string} - Concise human-readable line.
 */
function formatHumanResult(action, result) {
  const outcome =
    (typeof result.outcome === 'string' && result.outcome) ||
    (typeof result.health === 'string' && result.health) ||
    (typeof result.status === 'string' && result.status) ||
    'completed';
  const app =
    typeof result.appId === 'string' && result.appId
      ? ` (${result.appId})`
      : '';
  if (action.name === 'status') {
    const wiring = result.wiring.state;
    const wiringRemediation =
      wiring === 'orphaned' ? '; run service uninstall' : '';
    const activationPhase = result.activation?.phase;
    const activationRemediation =
      typeof activationPhase === 'string' && activationPhase !== 'ACTIVE'
        ? `; activation: ${activationPhase}; run service recover`
        : '';
    return `${action.name}: ${outcome}; wiring: ${wiring}${wiringRemediation}${activationRemediation}${app}`;
  }
  if (result.requestStatus === 'pending') {
    if (result.reason === 'incompatible-durable-work') {
      return `${action.name}: ${outcome}; request pending; settle incompatible durable work or install its matching revision${app}`;
    }
    return `${action.name}: ${outcome}; request pending; run service recover${app}`;
  }
  if (result.outcome === 'source-retained') {
    const request =
      result.requestStatus === 'fulfilled'
        ? ''
        : `; request ${result.requestStatus}`;
    return `${action.name}: source retained${request}${app}`;
  }
  if (result.outcome === 'source-restored') {
    const request =
      result.requestStatus === 'fulfilled'
        ? ''
        : `; request ${result.requestStatus}`;
    return `${action.name}: source restored${request}${app}`;
  }
  if (result.requestStatus !== 'fulfilled') {
    return `${action.name}: ${outcome}; request ${result.requestStatus}${app}`;
  }
  return `${action.name}: ${outcome}${app}`;
}

/**
 * Create the packaged systemd user-service command. Every operation is lazy:
 * parsing help never loads the Linux implementation or touches host state.
 * @param {{loadOperator?: () => any | Promise<any>, output?: Partial<SystemdUserServiceCommandOutput>, processRef?: SystemdUserServiceCommandProcess}} [options] - Host implementation and I/O seams.
 * @returns {Command} - Fresh `service` parent command.
 */
export function createSystemdUserServiceCommand(options = {}) {
  if (
    options.loadOperator !== undefined &&
    typeof options.loadOperator !== 'function'
  ) {
    throw new TypeError(
      'createSystemdUserServiceCommand loadOperator must be a function.',
    );
  }
  const loadOperator = options.loadOperator || loadDefaultOperator;
  const output = resolveOutput(options.output);
  const processRef = options.processRef || process;
  const command = new Command('service').description(
    'Manage this packaged artifact as a systemd user service',
  );

  for (const action of SERVICE_ACTIONS) {
    command.addCommand(
      new Command(action.name)
        .description(action.description)
        .option('--json', 'Write one machine-readable result object')
        .action(async (commandOptions) => {
          try {
            const operator = await loadOperator();
            const operation = operator?.[action.name];
            if (typeof operation !== 'function') {
              throw new TypeError(
                `Systemd user service operator does not implement ${action.name}().`,
              );
            }
            const result = normalizeResult(
              await operation.call(operator),
              action.name,
            );
            if (commandOptions.json === true) output.json(result);
            else output.line(formatHumanResult(action, result));
            if (
              action.name !== 'status' &&
              result.requestStatus !== 'fulfilled'
            ) {
              processRef.exitCode = 1;
            }
          } catch (error) {
            if (commandOptions.json === true) {
              output.json(createJsonError(error, action.name));
            } else {
              output.failure(createHumanFailure(error, action.name));
            }
            processRef.exitCode = 1;
          }
        }),
    );
  }

  return command;
}

export default createSystemdUserServiceCommand;
