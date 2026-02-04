import { join, basename } from 'path';
import { homedir as _homedir, tmpdir as _tmpdir } from 'os';
import process, { platform } from 'process';

const homedir = _homedir();
const tmpdir = _tmpdir();
const { env } = process;

/**
 * @typedef EnvPaths
 * @property {string} data - data.
 * @property {string} config - config.
 * @property {string} cache - cache.
 * @property {string} log - log.
 * @property {string} temp - temp.
 */

/**
 *
 * @param {string} name - name.
 * @returns {EnvPaths} - Result.
 */
function macos(name) {
  const library = join(homedir, 'Library');

  return {
    data: join(library, 'Application Support', name),
    config: join(library, 'Preferences', name),
    cache: join(library, 'Caches', name),
    log: join(library, 'Logs', name),
    temp: join(tmpdir, name),
  };
}

/**
 *
 * @param {string} name - name.
 * @returns {EnvPaths} - Result.
 */
function windows(name) {
  const appData = env.APPDATA || join(homedir, 'AppData', 'Roaming');
  const localAppData = env.LOCALAPPDATA || join(homedir, 'AppData', 'Local');

  return {
    // Data/config/cache/log are invented by me as Windows isn't opinionated about this
    data: join(localAppData, name, 'Data'),
    config: join(appData, name, 'Config'),
    cache: join(localAppData, name, 'Cache'),
    log: join(localAppData, name, 'Log'),
    temp: join(tmpdir, name),
  };
}

/**
 *
 * @param {string} name - name.
 * @returns {EnvPaths} - Result.
 */
function linux(name) {
  const username = basename(homedir);

  return {
    data: join(env.XDG_DATA_HOME || join(homedir, '.local', 'share'), name),
    config: join(env.XDG_CONFIG_HOME || join(homedir, '.config'), name),
    cache: join(env.XDG_CACHE_HOME || join(homedir, '.cache'), name),
    // https://wiki.debian.org/XDGBaseDirectorySpecification#state
    log: join(env.XDG_STATE_HOME || join(homedir, '.local', 'state'), name),
    temp: join(tmpdir, username, name),
  };
}

/**
 * @typedef EnvPathsOptions
 * @property {string} [suffix] - suffix.
 */

/**
 *
 * @param {string} name - name.
 * @param {EnvPathsOptions} [options] - options.
 * @returns {EnvPaths} - Result.
 */
function envPaths(name, { suffix = 'nodejs' } = {}) {
  if (typeof name !== 'string') {
    throw new TypeError(`Expected a string, got ${typeof name}`);
  }

  if (suffix) {
    // Add suffix to prevent possible conflict with native apps
    name += `-${suffix}`;
  }

  if (platform === 'darwin') {
    return macos(name);
  }

  if (platform === 'win32') {
    return windows(name);
  }

  return linux(name);
}

export default envPaths;
