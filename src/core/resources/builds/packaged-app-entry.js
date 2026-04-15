import {
  BOOTSTRAP_MODE_STATE_START,
  resolveBootstrapInvocation,
} from './actor-system-cli/lib/bootstrap-mode.js';

const INTERNAL_COMMANDS = new Set(['ctl', 'func', 'infra']);

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
  if (bootstrapInvocation) {
    if (
      bootstrapInvocation.mode === BOOTSTRAP_MODE_STATE_START ||
      bootstrapInvocation.mode === 'runtime'
    ) {
      return 'start';
    }

    throw new Error(
      `Unsupported packaged bootstrap mode '${bootstrapInvocation.mode}'.`,
    );
  }

  const command =
    typeof environment.WHARFIE_RUNTIME_COMMAND === 'string'
      ? environment.WHARFIE_RUNTIME_COMMAND.trim()
      : '';
  return command || 'start';
}

/**
 * @param {Record<string, string | undefined>} [environment] - environment.
 * @returns {string[]} - Result.
 */
function getRuntimeArgs(environment = process.env) {
  const bootstrapInvocation = resolveBootstrapInvocation(environment);
  if (bootstrapInvocation) {
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

  if (
    typeof cliExportName === 'string' &&
    cliExportName.trim() &&
    candidate &&
    typeof candidate === 'object'
  ) {
    const explicit = candidate[cliExportName];
    if (explicit && typeof explicit.parseAsync === 'function') {
      return { kind: 'command', value: explicit };
    }
    if (typeof explicit === 'function') {
      return { kind: 'function', value: explicit.bind(candidate) };
    }
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
  const args = argv.slice(2);
  const runtimeModules = options.runtimeModules || {};

  if (getBootstrapMode() === 'runtime') {
    await runRuntimeBootstrap(runtimeModules, { argv });
    return;
  }

  if (args.length > 0 && INTERNAL_COMMANDS.has(String(args[0] || '').trim())) {
    const internalCli = runtimeModules.cli;
    if (typeof internalCli === 'function') {
      await internalCli(argv);
      return;
    }
    if (internalCli && typeof internalCli.parseAsync === 'function') {
      await internalCli.parseAsync(argv);
      return;
    }
  }

  const developerCliModule = options.developerCliModule ?? options.cliModule;
  if (!developerCliModule) {
    throw new Error('Packaged app is missing cli.entrypoint.');
  }

  await runDeveloperCli(developerCliModule, {
    cliExportName: options.cliExportName,
    argv,
  });
}

export default runPackagedApp;
