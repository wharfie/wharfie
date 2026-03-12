import https from 'node:https';

import semver from 'semver';

import { WHARFIE_VERSION } from '../lambdas/lib/version.js';
import { displayWarning } from './output/basic.js';

export const UPDATE_CHECK_DISABLE_ENV_VAR = 'WHARFIE_DISABLE_UPDATE_CHECK';
export const DEFAULT_RELEASE_CHECK_TIMEOUT_MS = 2000;

/**
 * @typedef {{ tag_name: string }} LatestRelease
 */

/**
 * @typedef {object} GetLatestReleaseOptions
 * @property {number} [timeoutMs] - Request timeout in milliseconds.
 * @property {typeof https.get} [request] - Request implementation.
 */

/**
 * @typedef {object} ReleaseCheckOptions
 * @property {Record<string, string | undefined>} [env] - Environment variables.
 * @property {string} [currentVersion] - Current Wharfie version.
 * @property {(message: string) => void} [warn] - Warning reporter.
 * @property {number} [timeoutMs] - Request timeout in milliseconds.
 * @property {(options?: GetLatestReleaseOptions) => Promise<LatestRelease>} [getLatestReleaseFn] - Release fetcher.
 */

/**
 * @param {Record<string, string | undefined>} [env] - Environment variables.
 * @returns {boolean} - Whether the update check is disabled.
 */
export function isUpdateCheckDisabled(env = process.env) {
  const value = env[UPDATE_CHECK_DISABLE_ENV_VAR];
  if (!value) return false;

  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

/**
 * @param {GetLatestReleaseOptions} [options] - Request options.
 * @returns {Promise<LatestRelease>} - Latest GitHub release.
 */
export function getLatestRelease(options = {}) {
  const {
    timeoutMs = DEFAULT_RELEASE_CHECK_TIMEOUT_MS,
    request = https.get.bind(https),
  } = options;

  return new Promise((resolve, reject) => {
    let settled = false;

    /**
     * @template T
     * @param {(value: T) => void} handler - Promise handler.
     * @param {T} value - Promise value.
     * @returns {void}
     */
    function settle(handler, value) {
      if (settled) return;
      settled = true;
      handler(value);
    }

    const req = request(
      {
        hostname: 'api.github.com',
        path: '/repos/wharfie/wharfie/releases/latest',
        headers: { 'User-Agent': 'wharfie-release-check' },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume?.();
          settle(
            reject,
            new Error(`GitHub API responded with status ${res.statusCode}`),
          );
          return;
        }

        let data = '';
        res.on('data', (chunk) => {
          data += String(chunk);
        });
        res.on('end', () => {
          try {
            settle(resolve, JSON.parse(data));
          } catch (_err) {
            settle(reject, new Error('Failed to parse GitHub response'));
          }
        });
      },
    );

    req.on('error', (err) => {
      settle(reject, err);
    });

    req.setTimeout(timeoutMs, () => {
      settle(
        reject,
        new Error(`GitHub release check timed out after ${timeoutMs}ms`),
      );
      req.destroy();
    });
  });
}

/**
 * @param {ReleaseCheckOptions} [options] - Release check options.
 * @returns {Promise<boolean>} - True when a newer release warning was emitted.
 */
export async function checkForNewRelease(options = {}) {
  const {
    env = process.env,
    currentVersion = WHARFIE_VERSION,
    warn = displayWarning,
    timeoutMs = DEFAULT_RELEASE_CHECK_TIMEOUT_MS,
    getLatestReleaseFn = getLatestRelease,
  } = options;

  if (isUpdateCheckDisabled(env)) {
    return false;
  }

  try {
    if (!currentVersion || !semver.valid(currentVersion)) {
      return false;
    }

    const latestRelease = await getLatestReleaseFn({ timeoutMs });

    const latestVersion = latestRelease.tag_name.replace(/^v/, '');
    if (!semver.valid(latestVersion)) {
      return false;
    }

    if (semver.gt(latestVersion, currentVersion)) {
      warn(`A new version of Wharfie is available: ${latestVersion}`);
      warn(`You are currently using version: ${currentVersion}`);
      warn(
        'Please update to the latest version to get the latest features and bug fixes.',
      );
      return true;
    }
  } catch (_error) {
    return false;
  }

  return false;
}

export default {
  checkForNewRelease,
  getLatestRelease,
  isUpdateCheckDisabled,
};
