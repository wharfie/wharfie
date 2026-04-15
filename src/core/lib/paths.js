import envPaths from 'env-paths';
import { promises } from 'node:fs';

const paths = envPaths('wharfie');

/**
 * @returns {string} - Result.
 */
function getConfigDir() {
  const configDir = process.env.CONFIG_DIR;
  if (typeof configDir === 'string' && configDir.trim()) {
    return configDir.trim();
  }

  return paths.config;
}

/**
 *
 */
async function createWharfiePaths() {
  await Promise.all([
    promises.mkdir(paths.data, { recursive: true }),
    promises.mkdir(getConfigDir(), { recursive: true }),
    promises.mkdir(paths.log, { recursive: true }),
    promises.mkdir(paths.temp, { recursive: true }),
  ]);
}

export default {
  ...paths,
  createWharfiePaths,
  getConfigDir,
};
