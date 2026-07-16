import {
  BOOTSTRAP_MODE_STATE_START,
  resolveBootstrapInvocation,
} from './actor-system-cli/lib/bootstrap-mode.js';

/**
 * The one top-level word reserved by packaged applications for Wharfie-owned
 * operator commands. All other argv belongs to the application.
 */
export const OPERATOR_NAMESPACE = 'wharfie';

/**
 * @param {string | undefined} value - value.
 * @param {string} label - label.
 * @returns {string[]} - Result.
 */
export function parseBootstrapArgs(
  value = typeof process.env.WHARFIE_BOOTSTRAP_ARGS === 'string'
    ? process.env.WHARFIE_BOOTSTRAP_ARGS
    : process.env.WHARFIE_RUNTIME_ARGS,
  label = typeof process.env.WHARFIE_BOOTSTRAP_ARGS === 'string'
    ? 'WHARFIE_BOOTSTRAP_ARGS'
    : 'WHARFIE_RUNTIME_ARGS',
) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    return [];
  }

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON array of strings.`);
  }

  return parsed.map((candidate) => String(candidate));
}

/**
 * @param {Record<string, string | undefined>} [environment] - environment.
 * @returns {'cli' | 'runtime'} - Result.
 */
export function getBootstrapMode(environment = process.env) {
  if (resolveBootstrapInvocation(environment)) {
    return 'runtime';
  }

  return environment.WHARFIE_RUNTIME_COMMAND || environment.WHARFIE_RUNTIME_ARGS
    ? 'runtime'
    : 'cli';
}

/**
 * @param {Record<string, string | undefined>} [environment] - environment.
 * @returns {string} - Result.
 */
export function getRuntimeCommand(environment = process.env) {
  const bootstrapInvocation = resolveBootstrapInvocation(environment);
  const runtimeCommand =
    typeof environment.WHARFIE_RUNTIME_COMMAND === 'string'
      ? environment.WHARFIE_RUNTIME_COMMAND.trim()
      : '';

  if (bootstrapInvocation) {
    if (bootstrapInvocation.mode === BOOTSTRAP_MODE_STATE_START) {
      return 'start';
    }

    if (bootstrapInvocation.mode === 'runtime') {
      return runtimeCommand || 'start';
    }

    throw new Error(
      `Unsupported packaged bootstrap mode '${bootstrapInvocation.mode}'.`,
    );
  }

  return runtimeCommand || 'start';
}

/**
 * @param {Record<string, string | undefined>} [environment] - environment.
 * @returns {string[]} - Result.
 */
function getRuntimeArgs(environment = process.env) {
  const bootstrapInvocation = resolveBootstrapInvocation(environment);
  if (bootstrapInvocation) {
    if (bootstrapInvocation.mode === 'runtime') {
      const runtimeArgsValue = environment.WHARFIE_RUNTIME_ARGS;
      return typeof runtimeArgsValue === 'string' && runtimeArgsValue.trim()
        ? parseBootstrapArgs(runtimeArgsValue, 'WHARFIE_RUNTIME_ARGS')
        : bootstrapInvocation.args;
    }

    return bootstrapInvocation.args;
  }

  return parseBootstrapArgs(
    environment.WHARFIE_RUNTIME_ARGS,
    'WHARFIE_RUNTIME_ARGS',
  );
}

/**
 * @param {Record<string, any> | null | undefined} moduleLike - moduleLike.
 * @param {string | undefined} cliExportName - cliExportName.
 * @returns {{ kind: 'command' | 'function', value: any } | undefined} - Result.
 */
function resolveCliHandler(moduleLike, cliExportName) {
  const candidate = moduleLike || {};

  if (typeof cliExportName === 'string' && cliExportName.trim()) {
    const requestedExport = cliExportName.trim();
    const explicit =
      candidate && typeof candidate === 'object'
        ? candidate[requestedExport]
        : undefined;
    if (explicit && typeof explicit.parseAsync === 'function') {
      return { kind: 'command', value: explicit };
    }
    if (typeof explicit === 'function') {
      return { kind: 'function', value: explicit.bind(candidate) };
    }

    throw new Error(
      `cli.export '${requestedExport}' was requested, but that export is not a callable function or Commander command.`,
    );
  }

  const candidates = [
    candidate.default,
    candidate.main,
    candidate.entrypoint,
    candidate.cli,
  ];

  for (const current of candidates) {
    if (current && typeof current.parseAsync === 'function') {
      return { kind: 'command', value: current };
    }
    if (typeof current === 'function') {
      return { kind: 'function', value: current.bind(candidate) };
    }
  }

  return undefined;
}

/**
 * @param {Record<string, any> | null | undefined} moduleLike - moduleLike.
 * @param {{ cliExportName?: string, argv?: string[] }} [options] - options.
 * @returns {Promise<void>} - Result.
 */
export async function runDeveloperCli(moduleLike, options = {}) {
  const argv = Array.isArray(options.argv) ? options.argv : process.argv;
  const handler = resolveCliHandler(moduleLike, options.cliExportName);

  if (!handler) {
    throw new Error(
      'cli.entrypoint must export a default function, a default Commander command, or a named main() function.',
    );
  }

  if (handler.kind === 'command') {
    await handler.value.parseAsync(argv);
    return;
  }

  await handler.value(argv);
}

/**
 * @param {string[]} argv - Packaged application argv.
 * @returns {boolean} - Whether this is an explicit operator invocation.
 */
export function isOperatorInvocation(argv) {
  return argv[2] === OPERATOR_NAMESPACE;
}

/**
 * Remove the reserved namespace before handing argv to the operator CLI.
 * @param {string[]} argv - Packaged application argv.
 * @returns {string[]} - Node-style argv for the operator CLI.
 */
export function getOperatorArgv(argv) {
  return [argv[0] || 'node', argv[1] || 'wharfie-app', ...argv.slice(3)];
}

/**
 * @param {Record<string, any>} runtimeModules - runtimeModules.
 * @param {{ argv?: string[] }} [options] - options.
 * @returns {Promise<void>} - Result.
 */
export async function runRuntimeBootstrap(runtimeModules, options = {}) {
  const runtimeCommand = getRuntimeCommand();
  const runtimeArgs = getRuntimeArgs();

  /** @type {any} */
  const command = runtimeModules?.[runtimeCommand];
  if (!command || typeof command.parseAsync !== 'function') {
    throw new Error(
      `Unknown packaged runtime command '${runtimeCommand}'. Available commands: ${
        Object.keys(runtimeModules || {})
          .sort((left, right) => left.localeCompare(right))
          .join(', ') || '(none)'
      }`,
    );
  }

  const argv = Array.isArray(options.argv) ? options.argv : process.argv;
  await command.parseAsync(
    [argv[0] || 'node', runtimeCommand, ...runtimeArgs],
    {
      from: 'node',
    },
  );
}

/**
 * @param {{ developerCliModule?: Record<string, any> | null, cliModule?: Record<string, any> | null, cliExportName?: string, runtimeModules?: Record<string, any>, argv?: string[] }} [options] - options.
 * @returns {Promise<void>} - Result.
 */
export async function runPackagedApp(options = {}) {
  const argv = Array.isArray(options.argv) ? options.argv : process.argv;
  const runtimeModules = options.runtimeModules || {};

  if (getBootstrapMode() === 'runtime') {
    await runRuntimeBootstrap(runtimeModules, { argv });
    return;
  }

  if (isOperatorInvocation(argv)) {
    if (!runtimeModules.operatorCli) {
      throw new Error(
        `Packaged app does not include the Wharfie operator CLI requested by '${OPERATOR_NAMESPACE}'.`,
      );
    }

    await runDeveloperCli(
      { default: runtimeModules.operatorCli },
      { argv: getOperatorArgv(argv) },
    );
    return;
  }

  const developerCliModule = options.developerCliModule ?? options.cliModule;
  if (developerCliModule) {
    await runDeveloperCli(developerCliModule, {
      cliExportName: options.cliExportName,
      argv,
    });
    return;
  }

  throw new Error(
    `Packaged app is missing cli.entrypoint. Wharfie operator commands must be invoked as '<app> ${OPERATOR_NAMESPACE} <command>'.`,
  );
}

export default runPackagedApp;
