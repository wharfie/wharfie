import { Command } from 'commander';

const SERVICE_ACTIONS = Object.freeze([
  Object.freeze({
    name: 'install',
    description: 'Install and enable this artifact as a systemd user service',
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
  if (
    normalized.schemaVersion !== expectedSchemaVersion ||
    normalized.kind !== expectedKind ||
    typeof normalized.appId !== 'string' ||
    normalized.appId.length === 0 ||
    !validWiring ||
    (action === 'status'
      ? typeof normalized.health !== 'string' || normalized.health.length === 0
      : normalized.action !== action ||
        typeof normalized.outcome !== 'string' ||
        normalized.outcome.length === 0)
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
  return Object.freeze({
    schemaVersion: 1,
    kind: 'wharfie.service.error',
    action,
    code,
    message: message || `Systemd user service ${action} failed.`,
  });
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
    const remediation = wiring === 'orphaned' ? '; run service uninstall' : '';
    return `${action.name}: ${outcome}; wiring: ${wiring}${remediation}${app}`;
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
          } catch (error) {
            if (commandOptions.json === true) {
              output.json(createJsonError(error, action.name));
            } else {
              output.failure(error);
            }
            processRef.exitCode = 1;
          }
        }),
    );
  }

  return command;
}

export default createSystemdUserServiceCommand;
