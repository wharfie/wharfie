import internalCli from './actor-system-cli/index.js';

const INTERNAL_COMMANDS = new Set(['ctl', 'func', 'infra']);

/**
 * @param {unknown} value - value.
 * @returns {value is string[]} - Result.
 */
function isStringArray(value) {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

/**
 * @param {string | undefined} raw - raw.
 * @returns {string[]} - Result.
 */
function parseBootstrapArgs(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return isStringArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * @param {Record<string, any> | undefined} cliModule - cliModule.
 * @param {string | undefined} cliExportName - cliExportName.
 * @returns {((argv?: string[]) => Promise<any> | any) | undefined} - Result.
 */
function resolveCliHandler(cliModule, cliExportName) {
  if (!cliModule || typeof cliModule !== 'object') {
    return undefined;
  }

  const explicitCandidate =
    typeof cliExportName === 'string' && cliExportName.trim()
      ? cliModule[cliExportName]
      : undefined;

  if (typeof explicitCandidate === 'function') {
    return explicitCandidate.bind(cliModule);
  }

  const candidates = [
    cliModule.default,
    cliModule.main,
    cliModule.entrypoint,
    cliModule.cli,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'function') {
      return candidate.bind(cliModule);
    }
  }

  return undefined;
}

/**
 * @param {string[]} argv - argv.
 * @returns {Promise<any>} - Result.
 */
async function runInternalRuntime(argv) {
  const bootstrapArgs = parseBootstrapArgs(process.env.WHARFIE_BOOTSTRAP_ARGS);
  const runtimeArgv = [
    argv[0] || process.execPath,
    argv[1] || process.argv[1] || 'wharfie',
    'ctl',
    'state',
    'start',
    ...bootstrapArgs,
  ];
  return await internalCli(runtimeArgv);
}

/**
 * @param {{ cliModule?: Record<string, any>, cliExportName?: string, argv?: string[] }} [options] - options.
 * @returns {Promise<any>} - Result.
 */
export async function runPackagedApp(options = {}) {
  const argv = Array.isArray(options.argv) ? options.argv : process.argv;
  const args = argv.slice(2);

  if (process.env.WHARFIE_BOOTSTRAP_MODE === 'runtime') {
    return await runInternalRuntime(argv);
  }

  if (args.length > 0 && INTERNAL_COMMANDS.has(String(args[0] || '').trim())) {
    return await internalCli(argv);
  }

  const cliHandler = resolveCliHandler(
    options.cliModule,
    options.cliExportName,
  );
  if (cliHandler) {
    return await cliHandler(argv);
  }

  return await internalCli(argv);
}

export default runPackagedApp;
