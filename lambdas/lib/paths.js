const envPaths = require('env-paths');
const fs = require('node:fs');

const paths = envPaths('wharfie');

/**
 *
 */
async function createWharfiePaths() {
  await Promise.all([
    fs.promises.mkdir(paths.data, { recursive: true }),
    fs.promises.mkdir(paths.config, { recursive: true }),
    fs.promises.mkdir(paths.log, { recursive: true }),
    fs.promises.mkdir(paths.temp, { recursive: true }),
  ]);
}

module.exports = {
  ...paths,
  createWharfiePaths,
};
