import envPaths from 'env-paths';
import { promises } from 'node:fs';

const paths = envPaths('wharfie');

/**
 *
 */
async function createWharfiePaths() {
  await Promise.all([
    promises.mkdir(paths.data, { recursive: true }),
    promises.mkdir(paths.config, { recursive: true }),
    promises.mkdir(paths.log, { recursive: true }),
    promises.mkdir(paths.temp, { recursive: true }),
  ]);
}

export default {
  ...paths,
  createWharfiePaths,
};
