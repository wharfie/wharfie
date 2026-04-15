/**
 * @typedef RuntimeBootstrapInvocation
 * @property {string} mode - mode.
 * @property {string[]} args - args.
 */

export const BOOTSTRAP_MODE_ENV = 'WHARFIE_BOOTSTRAP_MODE';
export const BOOTSTRAP_ARGS_ENV = 'WHARFIE_BOOTSTRAP_ARGS';
export const BOOTSTRAP_MODE_STATE_START = 'state-start';

/**
 * @param {unknown} value - value.
 * @param {string} label - label.
 * @returns {any} - Result.
 */
function parseJson(value, label) {
  try {
    return JSON.parse(String(value));
  } catch (error) {
    const message =
      error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : String(error);
    throw new Error(`Failed to parse ${label}: ${message}`);
  }
}

/**
 * @param {unknown} value - value.
 * @param {string} label - label.
 * @returns {string[]} - Result.
 */
function normalizeStringArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a JSON array of strings.`);
  }

  return value.map((entry) => {
    if (typeof entry !== 'string') {
      throw new Error(`${label} must be a JSON array of strings.`);
    }
    return entry;
  });
}

/**
 * @param {{ mode?: string, args?: string[] }} [options] - options.
 * @returns {Record<string, string>} - Result.
 */
export function createBootstrapEnvironment(options = {}) {
  const mode =
    typeof options.mode === 'string' && options.mode.trim()
      ? options.mode.trim()
      : BOOTSTRAP_MODE_STATE_START;
  const args = normalizeStringArray(
    Array.isArray(options.args) ? options.args : [],
    BOOTSTRAP_ARGS_ENV,
  );

  return {
    [BOOTSTRAP_MODE_ENV]: mode,
    [BOOTSTRAP_ARGS_ENV]: JSON.stringify(args),
  };
}

/**
 * @param {Record<string, string | undefined>} [environment] - environment.
 * @returns {RuntimeBootstrapInvocation | undefined} - Result.
 */
export function resolveBootstrapInvocation(environment = process.env) {
  const modeValue = environment[BOOTSTRAP_MODE_ENV];
  if (typeof modeValue !== 'string' || !modeValue.trim()) {
    return undefined;
  }

  const argsValue = environment[BOOTSTRAP_ARGS_ENV];
  const args =
    typeof argsValue === 'string' && argsValue.trim()
      ? normalizeStringArray(
          parseJson(argsValue, BOOTSTRAP_ARGS_ENV),
          BOOTSTRAP_ARGS_ENV,
        )
      : [];

  return {
    mode: modeValue.trim(),
    args,
  };
}

export default {
  BOOTSTRAP_MODE_ENV,
  BOOTSTRAP_ARGS_ENV,
  BOOTSTRAP_MODE_STATE_START,
  createBootstrapEnvironment,
  resolveBootstrapInvocation,
};
