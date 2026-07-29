import { Command } from 'commander';

import { assertApplicationRevisionId } from '../application-revision.js';
import { assertArtifactId } from '../artifact-record.js';
import { validateSystemdUserServiceReleasePruneReceipt } from '../services/systemd-user-service-release-prune.js';

const SERVICE_ACTIONS = Object.freeze([
  Object.freeze({
    name: 'install',
    description: 'Install and enable this artifact as a systemd user service',
  }),
  Object.freeze({
    name: 'converge',
    description: 'Converge this artifact as the resident release',
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
    name: 'prune',
    description: 'Remove verified local releases outside rollback authority',
  }),
  Object.freeze({
    name: 'purge',
    description: 'Permanently remove this uninstalled application data',
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
  'converge',
  'update',
  'rollback',
  'recover',
]);
const ACTIVATION_RECOVERY_REMEDIATION =
  'Run service recover before retrying activation.';
const CONVERGE_RECOVERY_REMEDIATION =
  'Retry service converge from this exact desired SEA.';
const CONVERGE_ROLLBACK_RECOVERY_REMEDIATION =
  'Run service recover before retrying desired-target convergence.';
const ACTIVE_REINSTALL_RECOVERY_REMEDIATION =
  'Run service install again from the exact selected SEA to resume repair.';
const PRUNE_RECOVERY_REMEDIATION =
  'Run service recover before retrying service prune.';
const PRUNE_RETRY_REMEDIATION =
  'Retry service prune from the exact selected SEA.';
const PRUNE_UNINSTALL_REMEDIATION =
  'Rerun service uninstall before retrying service prune.';
const PRUNE_MISSING_ACTIVATION_REMEDIATION =
  'Run service install or service converge from the exact selected SEA before retrying service prune.';
const PURGE_CONFIRMATION_REMEDIATION =
  'Repeat the embedded application ID with --confirm-data-loss.';
const PURGE_UNINSTALL_REMEDIATION =
  'Run service uninstall before retrying service purge.';
const PURGE_QUIESCENCE_REMEDIATION =
  'Finish or cancel nonterminal durable work before retrying service purge.';
const PURGE_RETRY_REMEDIATION =
  'Retry service purge with the same --confirm-data-loss application ID.';
/** @type {Readonly<Record<string, string>>} */
const PRUNE_ERROR_MESSAGES = Object.freeze({
  'systemd-user-service-operation-failed': 'Systemd user service prune failed.',
  'systemd-user-service-prune-recovery-required':
    'Systemd user-service release pruning requires service recovery.',
  'systemd-user-service-prune-state-conflict':
    'Service prune requires the exact selected SEA and coherent service state.',
  'systemd-user-service-prune-uninstall-recovery-required':
    'Systemd user-service uninstall recovery must finish before release pruning.',
  'systemd-user-service-prune-release-invalid':
    'Systemd user-service release namespace failed bounded integrity verification.',
  'systemd-user-service-prune-incomplete':
    'Systemd user-service release pruning was interrupted and is safe to retry.',
  'systemd-user-service-prune-operation-failed':
    'Systemd user-service release pruning failed before a safe result was available.',
});
/** @type {Readonly<Record<string, string>>} */
const PURGE_ERROR_MESSAGES = Object.freeze({
  'systemd-user-service-operation-failed': 'Systemd user service purge failed.',
  'systemd-user-service-purge-confirmation-required':
    'Systemd user-service purge requires exact data-loss confirmation.',
  'systemd-user-service-purge-uninstall-required':
    'Systemd user-service purge requires a coherently uninstalled service.',
  'systemd-user-service-purge-recovery-required':
    'Systemd user-service activation recovery must finish before purge.',
  'systemd-user-service-purge-runtime-active':
    'Systemd user-service purge requires an inactive local runtime.',
  'systemd-user-service-purge-not-quiescent':
    'Systemd user-service purge requires terminal durable work.',
  'systemd-user-service-purge-state-conflict':
    'Systemd user-service state is not safe to purge.',
  'systemd-user-service-purge-incomplete':
    'Systemd user-service purge was interrupted and is safe to retry.',
});
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
  purge: new Set(['purged', 'already-purged']),
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
const DESIRED_CONVERGENCE_KEYS = new Set([
  'schemaVersion',
  'kind',
  'appId',
  'unit',
  'desired',
  'disposition',
  'basis',
]);
const DESIRED_RELEASE_KEYS = new Set(['artifactId', 'revisionId']);
const DESIRED_CONVERGENCE_DISPOSITIONS = new Set([
  'authorized',
  'conflict',
  'unknown',
]);
const AUTHORIZED_DESIRED_CONVERGENCE_BASES = new Set([
  'physical-absence',
  'durable-install',
  'durable-change',
  'durable-active',
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
 * @typedef {Record<string, ((input?: Record<string, any>) => Promise<Record<string, any>> | Record<string, any>) | undefined>} SystemdUserServiceOperator
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
    if (action === 'converge') {
      return (
        result.outcome === 'target-active' &&
        result.health === 'healthy' &&
        typeof result.activeArtifactId === 'string' &&
        result.activeArtifactId.length > 0 &&
        typeof result.activeRevisionId === 'string' &&
        result.activeRevisionId.length > 0
      );
    }
    return FULFILLED_ACTIVATION_OUTCOMES.has(result.outcome);
  }
  return (
    result.requestStatus === 'fulfilled' &&
    LIFECYCLE_OUTCOMES[action]?.has(result.outcome) === true
  );
}

/**
 * @param {unknown} value - Candidate JSON object.
 * @param {Set<string>} keys - Required exact keys.
 * @returns {value is Record<string, any>} - Whether the object has exactly the required keys.
 */
function hasExactObjectKeys(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

/**
 * Validate the status-V3 read-only convergence decision without interpreting
 * the manager's underlying host evidence. This boundary requires one exact
 * proof shape and keeps its application/unit identity joined to the enclosing
 * status before either JSON or human output is emitted.
 * @param {Record<string, any>} status - Candidate service status.
 * @returns {boolean} - Whether the desired-convergence proof is exact.
 */
function hasValidDesiredConvergence(status) {
  const proof = status.desiredConvergence;
  if (!hasExactObjectKeys(proof, DESIRED_CONVERGENCE_KEYS)) return false;
  if (!hasExactObjectKeys(proof.desired, DESIRED_RELEASE_KEYS)) return false;
  if (
    proof.schemaVersion !== 1 ||
    proof.kind !== 'wharfie.service.desired-convergence' ||
    typeof status.unit !== 'string' ||
    status.unit.length === 0 ||
    proof.appId !== status.appId ||
    proof.unit !== status.unit ||
    !DESIRED_CONVERGENCE_DISPOSITIONS.has(proof.disposition)
  ) {
    return false;
  }
  try {
    assertArtifactId(
      proof.desired.artifactId,
      'systemd user service desiredConvergence.desired.artifactId',
    );
    assertApplicationRevisionId(
      proof.desired.revisionId,
      'systemd user service desiredConvergence.desired.revisionId',
    );
  } catch {
    return false;
  }
  return proof.disposition === 'authorized'
    ? AUTHORIZED_DESIRED_CONVERGENCE_BASES.has(proof.basis)
    : proof.basis === null;
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
  if (action === 'prune') {
    return /** @type {Record<string, any>} */ (
      validateSystemdUserServiceReleasePruneReceipt(normalized)
    );
  }
  const expectedKind =
    action === 'status' ? 'wharfie.service.status' : 'wharfie.service.result';
  const expectedSchemaVersion = action === 'status' ? 3 : 1;
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
      (normalized.health !== 'starting' || ACTIVATION_ACTIONS.has(action)) &&
      hasValidResultSettlement(normalized, action) &&
      hasValidReleaseReferences(normalized) &&
      (action !== 'purge' ||
        (normalized.health === 'absent' &&
          normalized.activeArtifactId === null &&
          normalized.activeRevisionId === null &&
          normalized.rollbackArtifactId === null &&
          normalized.rollbackRevisionId === null)));
  if (
    normalized.schemaVersion !== expectedSchemaVersion ||
    normalized.kind !== expectedKind ||
    typeof normalized.appId !== 'string' ||
    normalized.appId.length === 0 ||
    !validWiring ||
    (action === 'status'
      ? typeof normalized.health !== 'string' ||
        normalized.health.length === 0 ||
        !hasValidDesiredConvergence(normalized)
      : !validResult)
  ) {
    throw new TypeError(
      `Systemd user service ${action} returned an invalid receipt.`,
    );
  }
  return normalized;
}

/**
 * Select only static remediation text appropriate to the requested action.
 * @param {string} code - Safe error code.
 * @param {string} action - Requested service action.
 * @returns {string | null} - Trusted guidance, or null.
 */
function getExpectedErrorRemediation(code, action) {
  if (code === 'systemd-user-service-activation-recovery-required') {
    return action === 'converge'
      ? CONVERGE_RECOVERY_REMEDIATION
      : ACTIVATION_RECOVERY_REMEDIATION;
  }
  if (code === 'systemd-user-service-active-reinstall-recovery-required') {
    return action === 'converge'
      ? CONVERGE_RECOVERY_REMEDIATION
      : ACTIVE_REINSTALL_RECOVERY_REMEDIATION;
  }
  if (
    action === 'converge' &&
    code === 'systemd-user-service-converge-rollback-recovery-required'
  ) {
    return CONVERGE_ROLLBACK_RECOVERY_REMEDIATION;
  }
  if (
    action === 'converge' &&
    code === 'systemd-user-service-converge-proof-required'
  ) {
    return CONVERGE_RECOVERY_REMEDIATION;
  }
  if (
    action === 'prune' &&
    code === 'systemd-user-service-prune-recovery-required'
  ) {
    return PRUNE_RECOVERY_REMEDIATION;
  }
  if (action === 'prune' && code === 'systemd-user-service-prune-incomplete') {
    return PRUNE_RETRY_REMEDIATION;
  }
  if (
    action === 'prune' &&
    code === 'systemd-user-service-prune-uninstall-recovery-required'
  ) {
    return PRUNE_UNINSTALL_REMEDIATION;
  }
  if (
    action === 'prune' &&
    code === 'systemd-user-service-prune-state-conflict'
  ) {
    return PRUNE_MISSING_ACTIVATION_REMEDIATION;
  }
  if (
    action === 'purge' &&
    code === 'systemd-user-service-purge-confirmation-required'
  ) {
    return PURGE_CONFIRMATION_REMEDIATION;
  }
  if (
    action === 'purge' &&
    code === 'systemd-user-service-purge-uninstall-required'
  ) {
    return PURGE_UNINSTALL_REMEDIATION;
  }
  if (
    action === 'purge' &&
    code === 'systemd-user-service-purge-recovery-required'
  ) {
    return ACTIVATION_RECOVERY_REMEDIATION;
  }
  if (
    action === 'purge' &&
    code === 'systemd-user-service-purge-not-quiescent'
  ) {
    return PURGE_QUIESCENCE_REMEDIATION;
  }
  if (action === 'purge' && code === 'systemd-user-service-purge-incomplete') {
    return PURGE_RETRY_REMEDIATION;
  }
  return null;
}

/**
 * @param {unknown} error - Operation failure.
 * @param {string} action - Requested operation.
 * @returns {Readonly<Record<string, any>>} - One safe JSON failure receipt.
 */
function createJsonError(error, action) {
  const rawCode =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';
  const normalizedCode = /^[a-z0-9][a-z0-9-]{0,127}$/.test(rawCode)
    ? rawCode
    : 'systemd-user-service-operation-failed';
  const errorMessages =
    action === 'prune'
      ? PRUNE_ERROR_MESSAGES
      : action === 'purge'
        ? PURGE_ERROR_MESSAGES
        : null;
  const code =
    errorMessages &&
    !Object.prototype.hasOwnProperty.call(errorMessages, normalizedCode)
      ? 'systemd-user-service-operation-failed'
      : normalizedCode;
  const rawMessage = errorMessages
    ? errorMessages[code] || `Systemd user service ${action} failed.`
    : error instanceof Error
      ? error.message
      : String(error);
  const message = Array.from(rawMessage, (character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint < 32 || codePoint === 127 ? ' ' : character;
  })
    .join('')
    .trim()
    .slice(0, 1024);
  const expectedRemediation = getExpectedErrorRemediation(code, action);
  const remediation =
    expectedRemediation !== null &&
    error &&
    typeof error === 'object' &&
    'remediation' in error &&
    error.remediation === expectedRemediation
      ? expectedRemediation
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
 * @returns {Error} - Safe one-line failure with optional recovery guidance.
 */
function createHumanFailure(error, action) {
  const safe = createJsonError(error, action);
  const failure = new Error(
    `${safe.message}${safe.remediation ? ` ${safe.remediation}` : ''}`,
  );
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
    const activationPhase = result.activation?.phase;
    const activationRemediation =
      typeof activationPhase === 'string' && activationPhase !== 'ACTIVE'
        ? `; activation: ${activationPhase}; run service recover`
        : '';
    const wiringRemediation =
      !activationRemediation && wiring === 'orphaned'
        ? '; run service uninstall'
        : '';
    return `${action.name}: ${outcome}; wiring: ${wiring}${wiringRemediation}${activationRemediation}${app}`;
  }
  if (action.name === 'prune') {
    if (result.outcome === 'nothing-to-prune') {
      return `${action.name}: nothing to prune${app}`;
    }
    const releaseLabel = result.removedCount === 1 ? 'release' : 'releases';
    const resumed =
      result.resumedPruneCount === 0
        ? ''
        : `; resumed ${result.resumedPruneCount} interrupted release ${result.resumedPruneCount === 1 ? 'deletion' : 'deletions'}`;
    const recoveredStaging =
      result.recoveredStagingCount === 0
        ? ''
        : `; recovered ${result.recoveredStagingCount} interrupted staging ${result.recoveredStagingCount === 1 ? 'directory' : 'directories'}`;
    return `${action.name}: removed ${result.removedCount} unreferenced ${releaseLabel} (${result.removedArtifactBytes} logical artifact bytes)${resumed}${recoveredStaging}${app}`;
  }
  if (action.name === 'purge') {
    return result.outcome === 'already-purged'
      ? `purge: application data already absent${app}`
      : `purge: permanently removed releases and durable state${app}`;
  }
  if (result.requestStatus === 'pending') {
    if (action.name === 'converge') {
      if (result.reason === 'incompatible-durable-work') {
        return `${action.name}: ${outcome}; request pending; settle incompatible durable work, then retry service converge${app}`;
      }
      return `${action.name}: ${outcome}; request pending; retry service converge${app}`;
    }
    if (result.reason === 'incompatible-durable-work') {
      return `${action.name}: ${outcome}; request pending; settle incompatible durable work, then run service recover; or install its matching revision${app}`;
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
    const actionCommand = new Command(action.name)
      .description(action.description)
      .option('--json', 'Write one machine-readable result object');
    if (action.name === 'purge') {
      actionCommand.option(
        '--confirm-data-loss <app-id>',
        'Confirm permanent deletion by repeating the embedded application ID',
      );
    }
    command.addCommand(
      actionCommand.action(async (commandOptions) => {
        try {
          const operator = await loadOperator();
          const operation = operator?.[action.name];
          if (typeof operation !== 'function') {
            throw new TypeError(
              `Systemd user service operator does not implement ${action.name}().`,
            );
          }
          const result = normalizeResult(
            await operation.call(
              operator,
              ...(action.name === 'purge'
                ? [
                    {
                      confirmation: commandOptions.confirmDataLoss,
                    },
                  ]
                : []),
            ),
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
