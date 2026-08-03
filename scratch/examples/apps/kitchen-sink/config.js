/**
 * Fixed package targets used by the kitchen-sink portability fixture.
 */
export const kitchenSinkDefaultTargets = Object.freeze([
  Object.freeze({
    nodeVersion: '24.13.1',
    platform: 'darwin',
    architecture: 'arm64',
  }),
  Object.freeze({
    nodeVersion: '24.13.1',
    platform: 'linux',
    architecture: 'x64',
    libc: 'glibc',
  }),
]);

/**
 * Exact native package kept outside the activity bundle and sealed into each
 * target-specific dependency closure.
 */
export const kitchenSinkExternalDependencies = Object.freeze([
  Object.freeze({ name: 'lmdb', version: '3.4.4' }),
]);

export default {
  kitchenSinkDefaultTargets,
  kitchenSinkExternalDependencies,
};
