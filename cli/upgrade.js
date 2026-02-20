import https from 'node:https';

import semver from 'semver';

import { WHARFIE_VERSION } from '../lambdas/lib/version.js';
import { displayWarning } from './output/basic.js';

/**
 *
 */
function getLatestRelease() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/wharfie/wharfie/releases/latest`,
      headers: { 'User-Agent': 'Node.js Release Checker' },
      followRedirects: true,
    };

    https
      .get(options, (res) => {
        if (res.statusCode !== 200) {
          return reject(
            new Error(`GitHub API responded with status ${res.statusCode}`),
          );
        }

        let data = '';
        res.on('data', function (chunk) {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Failed to parse GitHub response'));
          }
        });
      })
      .on('error', reject);
  });
}

/**
 *
 */
export async function checkForNewRelease() {
  try {
    const currentVersion = WHARFIE_VERSION;
    if (!currentVersion || !semver.valid(currentVersion)) {
      throw new Error('Invalid or missing version in process.env.version');
    }
    const latestRelease = await getLatestRelease();

    // Remove leading 'v' if present
    const latestVersion = latestRelease.tag_name.replace(/^v/, '');

    if (!semver.valid(latestVersion)) {
      throw new Error('Invalid semver format in GitHub release');
    }

    if (semver.gt(latestVersion, currentVersion)) {
      displayWarning(`A new version of Wharfie is available: ${latestVersion}`);
      displayWarning(`You are currently using version: ${currentVersion}`);
      displayWarning(
        `Please update to the latest version to get the latest features and bug fixes.`,
      );
    }
  } catch (error) {
    // ignore
  }
}

export default {
  checkForNewRelease,
};
