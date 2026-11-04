import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishPreviewRelease } from './publish-preview-release.js';

/**
 * @typedef {object} PreviewRecoveryOptions
 * @property {string} artifactDir - Absolute directory containing existing assets.
 * @property {string} tag - Exact existing release tag.
 * @property {string} expectedCommit - Exact existing release source commit.
 */

/**
 * @param {PreviewRecoveryOptions} options - Explicit recovery inputs.
 * @returns {void}
 */
function validateOptions(options) {
  if (
    !options ||
    Object.keys(options).sort().join(',') !==
      'artifactDir,expectedCommit,tag' ||
    typeof options.artifactDir !== 'string' ||
    !path.isAbsolute(options.artifactDir) ||
    options.artifactDir.length > 4096 ||
    options.artifactDir.includes('\0')
  ) {
    throw new TypeError(
      'Recovery requires only --artifact-dir (absolute), --tag, and --expected-commit.',
    );
  }
  if (
    typeof options.tag !== 'string' ||
    options.tag.length > 128 ||
    options.tag !== options.tag.trim() ||
    !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(options.tag) ||
    !options.tag
      .slice(1)
      .split('.')
      .every((part) => Number.isSafeInteger(Number(part)))
  ) {
    throw new TypeError('Recovery --tag must be an exact vX.Y.Z release tag.');
  }
  if (
    typeof options.expectedCommit !== 'string' ||
    options.expectedCommit.length !== 40 ||
    !/^[a-f0-9]{40}$/u.test(options.expectedCommit)
  ) {
    throw new TypeError(
      'Recovery --expected-commit must be a full lowercase Git commit ID.',
    );
  }
}

/**
 * @param {string[]} argv - Exact command arguments.
 * @returns {PreviewRecoveryOptions} Validated inputs.
 */
export function parsePreviewRecoveryArgs(argv) {
  const names = new Map([
    ['--artifact-dir', 'artifactDir'],
    ['--tag', 'tag'],
    ['--expected-commit', 'expectedCommit'],
  ]);
  /** @type {Record<string, string>} */
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = names.get(argv[index]);
    const value = argv[index + 1];
    if (
      !name ||
      Object.hasOwn(values, name) ||
      typeof value !== 'string' ||
      !value ||
      value.startsWith('--')
    ) {
      throw new TypeError('Invalid or repeated preview recovery argument.');
    }
    values[name] = value;
  }
  const options = /** @type {PreviewRecoveryOptions} */ (values);
  validateOptions(options);
  return Object.freeze(options);
}

/**
 * Authorize the actual master dispatch without impersonating the tag workflow.
 * The workflow must also retain its protected promotion environment and gates.
 * @param {NodeJS.ProcessEnv} [env] - Actual recovery workflow environment.
 * @returns {void}
 */
export function assertPreviewRecoveryEnvironment(env = process.env) {
  const required = {
    WHARFIE_PREVIEW_PUBLISH: '1',
    WHARFIE_PREVIEW_PUBLISH_ENABLED: 'true',
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REPOSITORY: 'wharfie/wharfie',
    GITHUB_REF: 'refs/heads/master',
    GITHUB_REF_TYPE: 'branch',
    GITHUB_REF_NAME: 'master',
    GITHUB_WORKFLOW_REF:
      'wharfie/wharfie/.github/workflows/recover-preview-release.yml@refs/heads/master',
  };
  const failures = Object.entries(required)
    .filter(([name, value]) => env[name] !== value)
    .map(([name, value]) => `${name} must be exactly ${value}`);
  if (
    env.GITHUB_SHA?.length !== 40 ||
    !/^[a-f0-9]{40}$/u.test(env.GITHUB_SHA || '')
  ) {
    failures.push('GITHUB_SHA must be a full lowercase Git commit ID');
  }
  if (
    env.GITHUB_WORKFLOW_SHA?.length !== 40 ||
    !/^[a-f0-9]{40}$/u.test(env.GITHUB_WORKFLOW_SHA || '') ||
    env.GITHUB_WORKFLOW_SHA !== env.GITHUB_SHA
  ) {
    failures.push('GITHUB_WORKFLOW_SHA must equal the full GITHUB_SHA');
  }
  if (failures.length) {
    throw new Error(
      `Wharfie preview recovery is disabled:\n- ${failures.join('\n- ')}`,
    );
  }
}

/**
 * Finalize an existing, promoted candidate using every existing publication
 * integrity and canonical source check. This entry point cannot publish npm
 * bytes, create a release, upload assets, or promote a dist-tag.
 * @param {PreviewRecoveryOptions} options - Exact existing candidate inputs.
 * @param {{env?: NodeJS.ProcessEnv, publish?: typeof publishPreviewRelease}} [dependencies] - Test seams.
 * @returns {ReturnType<typeof publishPreviewRelease>} Finalization result.
 */
export async function recoverPreviewRelease(options, dependencies = {}) {
  validateOptions(options);
  const input = Object.freeze({ ...options });
  const env = dependencies.env || process.env;
  assertPreviewRecoveryEnvironment(env);
  const publish = dependencies.publish || publishPreviewRelease;
  return await publish(
    { artifactDir: input.artifactDir, finalizeOnly: true },
    {
      expectedCommit: input.expectedCommit,
      authorize(candidate) {
        assertPreviewRecoveryEnvironment(env);
        if (
          candidate.manifest.tag !== input.tag ||
          candidate.manifest.source.commit !== input.expectedCommit
        ) {
          throw new TypeError(
            'Recovery candidate must match the exact requested tag and source commit.',
          );
        }
      },
    },
  );
}

/** @param {string[]} [argv] - Recovery arguments. @returns {Promise<void>} */
export async function main(argv = process.argv.slice(2)) {
  const result = await recoverPreviewRelease(parsePreviewRecoveryArgs(argv));
  process.stdout.write(`Finalized existing preview ${result.tag}.\n`);
}

const isDirect =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  await main();
}
