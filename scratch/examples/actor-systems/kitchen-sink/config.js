/**
 * Shared kitchen-sink fixture configuration.
 */
export const kitchenSinkDefaultTargets = Object.freeze([
  Object.freeze({
    nodeVersion: '24',
    platform: 'darwin',
    architecture: 'arm64',
  }),
  Object.freeze({
    nodeVersion: '24',
    platform: 'linux',
    architecture: 'x64',
  }),
]);

/**
 * Native + heavyweight externals that the kitchen-sink fixture is meant to
 * preserve through manifest compilation and packaging.
 */
export const kitchenSinkExternalDependencies = Object.freeze([
  'lmdb',
  'sharp@0.34.4',
  'sodium-native@5.0.9',
  '@duckdb/node-api',
  'usb@2.13.0',
]);

export default {
  kitchenSinkDefaultTargets,
  kitchenSinkExternalDependencies,
};
