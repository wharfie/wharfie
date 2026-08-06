import { validateBuildTarget } from './build-target.js';

/**
 * Derive the exact build target of the current Node host. Linux must
 * positively identify glibc: treating musl or an unknown libc as glibc can
 * select native dependencies and Node distribution bytes that cannot execute.
 * Optional observations keep the platform boundary deterministic in tests.
 * @param {{nodeVersion?: string, platform?: string, architecture?: string, glibcVersionRuntime?: string | undefined}} [overrides] - Host observations.
 * @returns {{nodeVersion: string, platform: 'darwin'|'linux'|'win32', architecture: 'arm64'|'x64', libc?: 'glibc'}} - Exact canonical host target.
 */
export function getHostBuildTarget(overrides = {}) {
  const nodeVersion = overrides.nodeVersion ?? process.versions.node;
  const platform = overrides.platform ?? process.platform;
  const architecture = overrides.architecture ?? process.arch;
  let glibcVersionRuntime;

  if (platform === 'linux') {
    if (
      Object.prototype.hasOwnProperty.call(overrides, 'glibcVersionRuntime')
    ) {
      glibcVersionRuntime = overrides.glibcVersionRuntime;
    } else {
      try {
        const report = /** @type {any} */ (process.report?.getReport?.());
        glibcVersionRuntime = report?.header?.glibcVersionRuntime;
      } catch {
        glibcVersionRuntime = undefined;
      }
    }
    if (
      typeof glibcVersionRuntime !== 'string' ||
      !glibcVersionRuntime.trim()
    ) {
      throw new Error(
        'Host build target on Linux requires a positively identified glibc runtime; musl and unknown libc hosts are not supported.',
      );
    }
  }

  return validateBuildTarget(
    {
      nodeVersion,
      platform,
      architecture,
      ...(platform === 'linux' ? { libc: 'glibc' } : {}),
    },
    'host build target',
  );
}

export default getHostBuildTarget;
