import envPaths from 'env-paths';
import { promises } from 'node:fs';

const paths = envPaths('wharfie');
const PRIVATE_DIRECTORY_MODE = 0o700;

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
    promises.mkdir(paths.data, {
      recursive: true,
      mode: PRIVATE_DIRECTORY_MODE,
    }),
    promises.mkdir(getConfigDir(), {
      recursive: true,
      mode: PRIVATE_DIRECTORY_MODE,
    }),
    promises.mkdir(paths.log, {
      recursive: true,
      mode: PRIVATE_DIRECTORY_MODE,
    }),
    promises.mkdir(paths.temp, {
      recursive: true,
      mode: PRIVATE_DIRECTORY_MODE,
    }),
  ]);
}

export default {
  ...paths,
  createWharfiePaths,
  getConfigDir,
};
