/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it, jest } from '@jest/globals';
import {
  existsSync,
  mkdtempSync,
  promises as fsp,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runJest } from './run-jest.js';

const ownedRoot = path.join('/tmp', 'wharfie-jest-owned');

/**
 * @param {{status: number | null, signal: NodeJS.Signals | null, error?: Error}} [result] - Child result.
 * @returns {any} - Injected runner harness.
 */
function createHarness(result = { status: 0, signal: null }) {
  /** @type {string[]} */
  const events = [];
  const spawn = jest.fn(
    /**
     * @param {string} _executable - Ignored executable.
     * @param {string[]} _args - Ignored arguments.
     * @param {{env: NodeJS.ProcessEnv, stdio: 'inherit'}} _options - Ignored options.
     * @returns {typeof result} - Scripted child result.
     */
    (_executable, _args, _options) => {
      events.push('spawn');
      return result;
    },
  );
  const createTempRoot = jest.fn((prefix) => {
    events.push(`create:${prefix}`);
    return ownedRoot;
  });
  const removeTempRoot = jest.fn(
    /**
     * @param {string} root - Owned root.
     * @param {{recursive: true, force: true}} _options - Removal options.
     * @returns {void}
     */
    (root, _options) => {
      events.push(`remove:${root}`);
    },
  );
  const kill = jest.fn((pid, signal) => {
    events.push(`kill:${pid}:${signal}`);
  });
  const env = { WHARFIE_TEST_RUNNER: '1' };

  return {
    dependencies: {
      spawn,
      createTempRoot,
      removeTempRoot,
      getTempDirectory: () => '/tmp',
      kill,
      execPath: '/node',
      env,
      pid: 321,
    },
    events,
    spawn,
    createTempRoot,
    removeTempRoot,
    kill,
    env,
  };
}

/** @param {ReturnType<typeof createHarness>} harness */
function spawnedArgs(harness) {
  const call = harness.spawn.mock.calls[0];
  expect(call).toBeDefined();
  return call?.[1] ?? [];
}

describe('disposable Jest runner', () => {
  it('confines default cache and coverage output and cleans up on success', () => {
    const harness = createHarness();

    expect(runJest(['--silent'], harness.dependencies)).toBe(0);

    expect(harness.createTempRoot).toHaveBeenCalledWith(
      path.join('/tmp', 'wharfie-jest-'),
    );
    expect(harness.spawn).toHaveBeenCalledWith(
      '/node',
      [
        '--experimental-vm-modules',
        'node_modules/jest/bin/jest.js',
        '--silent',
        '--cacheDirectory',
        path.join(ownedRoot, 'cache'),
        '--coverageDirectory',
        path.join(ownedRoot, 'coverage'),
        '--maxWorkers=4',
      ],
      {
        env: {
          ...harness.env,
          HOME: ownedRoot,
          USERPROFILE: ownedRoot,
          TMPDIR: ownedRoot,
          TMP: ownedRoot,
          TEMP: ownedRoot,
          APPDATA: path.join(ownedRoot, 'app-data'),
          LOCALAPPDATA: path.join(ownedRoot, 'local-app-data'),
          XDG_CACHE_HOME: path.join(ownedRoot, 'xdg-cache'),
          XDG_CONFIG_HOME: path.join(ownedRoot, 'xdg-config'),
          XDG_DATA_HOME: path.join(ownedRoot, 'xdg-data'),
          XDG_STATE_HOME: path.join(ownedRoot, 'xdg-state'),
          CONFIG_DIR: path.join(ownedRoot, 'xdg-config'),
          npm_config_cache: path.join(ownedRoot, 'npm-cache'),
          WHARFIE_TEST_WORKSPACE: ownedRoot,
        },
        stdio: 'inherit',
      },
    );
    expect(harness.removeTempRoot).toHaveBeenCalledWith(ownedRoot, {
      recursive: true,
      force: true,
    });
    expect(harness.events).toEqual([
      `create:${path.join('/tmp', 'wharfie-jest-')}`,
      'spawn',
      `remove:${ownedRoot}`,
    ]);
  });

  it('clones the caller environment and confines every temp variable', () => {
    const harness = createHarness();
    Object.assign(harness.env, {
      HOME: '/caller/home',
      USERPROFILE: '/caller/profile',
      TMPDIR: '/caller/tmpdir',
      TMP: '/caller/tmp',
      TEMP: '/caller/temp',
      APPDATA: '/caller/app-data',
      LOCALAPPDATA: '/caller/local-app-data',
      XDG_CACHE_HOME: '/caller/xdg-cache',
      XDG_CONFIG_HOME: '/caller/xdg-config',
      XDG_DATA_HOME: '/caller/xdg-data',
      XDG_STATE_HOME: '/caller/xdg-state',
      CONFIG_DIR: '/caller/config',
      npm_config_cache: '/caller/npm-cache',
      NPM_CONFIG_CACHE: '/caller/uppercase-npm-cache',
    });
    const callerEnvironment = { ...harness.env };

    runJest([], harness.dependencies);

    const childEnvironment = harness.spawn.mock.calls[0]?.[2].env;
    expect(childEnvironment).not.toBe(harness.env);
    expect(childEnvironment).toEqual({
      WHARFIE_TEST_RUNNER: '1',
      HOME: ownedRoot,
      USERPROFILE: ownedRoot,
      TMPDIR: ownedRoot,
      TMP: ownedRoot,
      TEMP: ownedRoot,
      APPDATA: path.join(ownedRoot, 'app-data'),
      LOCALAPPDATA: path.join(ownedRoot, 'local-app-data'),
      XDG_CACHE_HOME: path.join(ownedRoot, 'xdg-cache'),
      XDG_CONFIG_HOME: path.join(ownedRoot, 'xdg-config'),
      XDG_DATA_HOME: path.join(ownedRoot, 'xdg-data'),
      XDG_STATE_HOME: path.join(ownedRoot, 'xdg-state'),
      CONFIG_DIR: path.join(ownedRoot, 'xdg-config'),
      npm_config_cache: path.join(ownedRoot, 'npm-cache'),
      WHARFIE_TEST_WORKSPACE: ownedRoot,
    });
    expect(harness.env).toEqual(callerEnvironment);
  });

  it('removes a real file written through the injected child temp environment', () => {
    const outerRoot = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-jest-runner-test-'),
    );
    /** @type {string | undefined} */
    let actualOwnedRoot;
    const callerEnvironment = {
      WHARFIE_TEST_RUNNER: 'real-file',
      HOME: '/caller/home',
      USERPROFILE: '/caller/profile',
      TMPDIR: '/caller/tmpdir',
      TMP: '/caller/tmp',
      TEMP: '/caller/temp',
      APPDATA: '/caller/app-data',
      LOCALAPPDATA: '/caller/local-app-data',
      XDG_CACHE_HOME: '/caller/xdg-cache',
      XDG_CONFIG_HOME: '/caller/xdg-config',
      XDG_DATA_HOME: '/caller/xdg-data',
      XDG_STATE_HOME: '/caller/xdg-state',
      CONFIG_DIR: '/caller/config',
      npm_config_cache: '/caller/npm-cache',
      NPM_CONFIG_CACHE: '/caller/uppercase-npm-cache',
    };

    try {
      const result = runJest([], {
        createTempRoot: (prefix) => {
          actualOwnedRoot = mkdtempSync(prefix);
          return actualOwnedRoot;
        },
        getTempDirectory: () => outerRoot,
        env: callerEnvironment,
        execPath: '/node',
        spawn: (_executable, _args, options) => {
          expect(options.env.HOME).toBe(actualOwnedRoot);
          expect(options.env.USERPROFILE).toBe(actualOwnedRoot);
          expect(options.env.TMPDIR).toBe(actualOwnedRoot);
          expect(options.env.TMP).toBe(actualOwnedRoot);
          expect(options.env.TEMP).toBe(actualOwnedRoot);
          expect(options.env.APPDATA).toBe(
            path.join(String(actualOwnedRoot), 'app-data'),
          );
          expect(options.env.LOCALAPPDATA).toBe(
            path.join(String(actualOwnedRoot), 'local-app-data'),
          );
          expect(options.env.XDG_CACHE_HOME).toBe(
            path.join(String(actualOwnedRoot), 'xdg-cache'),
          );
          expect(options.env.XDG_CONFIG_HOME).toBe(
            path.join(String(actualOwnedRoot), 'xdg-config'),
          );
          expect(options.env.XDG_DATA_HOME).toBe(
            path.join(String(actualOwnedRoot), 'xdg-data'),
          );
          expect(options.env.XDG_STATE_HOME).toBe(
            path.join(String(actualOwnedRoot), 'xdg-state'),
          );
          expect(options.env.CONFIG_DIR).toBe(
            path.join(String(actualOwnedRoot), 'xdg-config'),
          );
          expect(options.env.npm_config_cache).toBe(
            path.join(String(actualOwnedRoot), 'npm-cache'),
          );
          expect(options.env.NPM_CONFIG_CACHE).toBeUndefined();
          expect(options.env.WHARFIE_TEST_WORKSPACE).toBe(actualOwnedRoot);
          const sentinelPath = path.join(
            String(options.env.TMPDIR),
            'child-sentinel',
          );
          writeFileSync(sentinelPath, 'owned\n', {
            encoding: 'utf8',
            flag: 'wx',
          });
          expect(existsSync(sentinelPath)).toBe(true);
          return { status: 0, signal: null };
        },
      });

      expect(result).toBe(0);
      expect(actualOwnedRoot).toBeDefined();
      expect(existsSync(String(actualOwnedRoot))).toBe(false);
      expect(callerEnvironment).toEqual({
        WHARFIE_TEST_RUNNER: 'real-file',
        HOME: '/caller/home',
        USERPROFILE: '/caller/profile',
        TMPDIR: '/caller/tmpdir',
        TMP: '/caller/tmp',
        TEMP: '/caller/temp',
        APPDATA: '/caller/app-data',
        LOCALAPPDATA: '/caller/local-app-data',
        XDG_CACHE_HOME: '/caller/xdg-cache',
        XDG_CONFIG_HOME: '/caller/xdg-config',
        XDG_DATA_HOME: '/caller/xdg-data',
        XDG_STATE_HOME: '/caller/xdg-state',
        CONFIG_DIR: '/caller/config',
        npm_config_cache: '/caller/npm-cache',
        NPM_CONFIG_CACHE: '/caller/uppercase-npm-cache',
      });
    } finally {
      rmSync(outerRoot, { recursive: true, force: true });
    }
  });

  it('contains the actual default Wharfie data and build paths', async () => {
    const workspace = process.env.WHARFIE_TEST_WORKSPACE;
    expect(workspace).toEqual(expect.any(String));
    if (!workspace)
      throw new Error('Jest did not receive its owned workspace.');
    const [{ default: paths }, { default: NodeBinary }, { default: SeaBuild }] =
      await Promise.all([
        import('../src/core/lib/paths.js'),
        import('../src/core/resources/builds/node-binary.js'),
        import('../src/core/resources/builds/sea-build.js'),
      ]);
    /** @param {string} value */
    const ownedPath = (value) => {
      const relative = path.relative(workspace, value);
      return (
        relative === '' ||
        (!path.isAbsolute(relative) &&
          relative !== '..' &&
          !relative.startsWith(`..${path.sep}`))
      );
    };

    for (const value of [
      paths.data,
      paths.config,
      paths.cache,
      paths.log,
      paths.temp,
      paths.getConfigDir(),
      NodeBinary.BINARIES_DIR,
      SeaBuild.BINARIES_DIR,
    ]) {
      expect(ownedPath(value)).toBe(true);
    }
  });

  it('returns a nonzero child status after cleanup', () => {
    const harness = createHarness({ status: 23, signal: null });

    expect(runJest([], harness.dependencies)).toBe(23);
    expect(harness.removeTempRoot).toHaveBeenCalledTimes(1);
  });

  it('cleans up before propagating a reported spawn error', () => {
    const spawnError = new Error('spawn failed');
    const harness = createHarness({
      status: null,
      signal: null,
      error: spawnError,
    });

    expect(() => runJest([], harness.dependencies)).toThrow(spawnError);
    expect(harness.events).toEqual([
      `create:${path.join('/tmp', 'wharfie-jest-')}`,
      'spawn',
      `remove:${ownedRoot}`,
    ]);
  });

  it('cleans up when the synchronous spawn function throws', () => {
    const harness = createHarness();
    const spawnError = new Error('spawn threw');
    harness.spawn.mockImplementation(() => {
      harness.events.push('spawn-threw');
      throw spawnError;
    });

    expect(() => runJest([], harness.dependencies)).toThrow(spawnError);
    expect(harness.events).toEqual([
      `create:${path.join('/tmp', 'wharfie-jest-')}`,
      'spawn-threw',
      `remove:${ownedRoot}`,
    ]);
  });

  it('cleans up before re-signalling the current process', () => {
    const harness = createHarness({ status: null, signal: 'SIGTERM' });

    expect(runJest([], harness.dependencies)).toBe(1);
    expect(harness.kill).toHaveBeenCalledWith(321, 'SIGTERM');
    expect(harness.events).toEqual([
      `create:${path.join('/tmp', 'wharfie-jest-')}`,
      'spawn',
      `remove:${ownedRoot}`,
      'kill:321:SIGTERM',
    ]);
  });

  it.each([
    ['separate values', ['--cacheDirectory', '/caller/cache']],
    ['equals syntax', ['--cacheDirectory=/caller/cache']],
    ['kebab separate values', ['--cache-directory', '/caller/cache']],
    ['kebab equals syntax', ['--cache-directory=/caller/cache']],
  ])('preserves caller cache directory overrides using %s', (_, args) => {
    const harness = createHarness();

    runJest(args, harness.dependencies);

    const childArgs = spawnedArgs(harness);
    expect(childArgs).toEqual(expect.arrayContaining(args));
    expect(childArgs).not.toContain(path.join(ownedRoot, 'cache'));
    expect(harness.removeTempRoot).toHaveBeenCalledWith(
      ownedRoot,
      expect.any(Object),
    );
  });

  it.each([
    ['separate values', ['--coverageDirectory', '/caller/coverage']],
    ['equals syntax', ['--coverageDirectory=/caller/coverage']],
    ['kebab separate values', ['--coverage-directory', '/caller/coverage']],
    ['kebab equals syntax', ['--coverage-directory=/caller/coverage']],
  ])('preserves caller coverage directory overrides using %s', (_, args) => {
    const harness = createHarness();

    runJest(args, harness.dependencies);

    const childArgs = spawnedArgs(harness);
    expect(childArgs).toEqual(expect.arrayContaining(args));
    expect(childArgs).not.toContain(path.join(ownedRoot, 'coverage'));
    expect(harness.removeTempRoot).toHaveBeenCalledWith(
      ownedRoot,
      expect.any(Object),
    );
  });

  it('preserves caller cache and coverage enablement flags', () => {
    const harness = createHarness();

    runJest(['--cache=false', '--coverage=false'], harness.dependencies);

    expect(spawnedArgs(harness)).toEqual(
      expect.arrayContaining(['--cache=false', '--coverage=false']),
    );
  });

  it.each([
    ['run in band', ['--runInBand']],
    ['run in band kebab', ['--run-in-band']],
    ['run in band equals', ['--runInBand=true']],
    ['run in band kebab equals', ['--run-in-band=true']],
    ['long worker value', ['--maxWorkers', '2']],
    ['long worker equals', ['--maxWorkers=2']],
    ['long worker kebab value', ['--max-workers', '2']],
    ['long worker kebab equals', ['--max-workers=2']],
    ['short worker value', ['-w', '2']],
    ['short worker equals', ['-w=2']],
    ['short worker attached', ['-w2']],
  ])('does not add the worker default for %s', (_, args) => {
    const harness = createHarness();

    runJest(args, harness.dependencies);

    expect(spawnedArgs(harness)).not.toContain('--maxWorkers=4');
  });

  it('inserts owned options before the end-of-options separator', () => {
    const harness = createHarness();
    const positional = ['--cacheDirectory', 'literal', '--runInBand'];

    runJest(['--silent', '--', ...positional], harness.dependencies);

    const childArgs = spawnedArgs(harness);
    const separatorIndex = childArgs.indexOf('--');
    expect(separatorIndex).toBeGreaterThan(0);
    expect(childArgs.indexOf('--cacheDirectory')).toBeLessThan(separatorIndex);
    expect(childArgs.indexOf('--coverageDirectory')).toBeLessThan(
      separatorIndex,
    );
    expect(childArgs.indexOf('--maxWorkers=4')).toBeLessThan(separatorIndex);
    expect(childArgs.slice(separatorIndex + 1)).toEqual(positional);
  });

  it('keeps coverage opt-in for ordinary tests and mandatory in CI', async () => {
    const packageJson = JSON.parse(
      await fsp.readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );

    expect(packageJson.scripts.test).not.toContain('--coverage');
    expect(packageJson.scripts['test:js']).not.toContain('--coverage');
    expect(packageJson.scripts['test:coverage']).toContain('--coverage');
    expect(packageJson.scripts['test:ci']).toContain('npm run test:coverage');
    expect(packageJson.scripts['test:ci']).not.toContain('npm run test &&');
    expect(packageJson.jest.coverageThreshold).toBeDefined();
  });

  it('keeps the Jest runner, imported globals, and test types on one major', async () => {
    const [packageJson, packageLock] = await Promise.all(
      ['../package.json', '../package-lock.json'].map(async (relativePath) =>
        JSON.parse(
          await fsp.readFile(new URL(relativePath, import.meta.url), 'utf8'),
        ),
      ),
    );
    /** @param {string} version */
    const major = (version) => {
      const match = /\d+/.exec(version);
      if (!match) {
        throw new TypeError(`Missing semantic version in ${version}.`);
      }
      return Number(match[0]);
    };
    const declaredMajors = [
      packageJson.devDependencies.jest,
      packageJson.devDependencies['@jest/globals'],
      packageJson.devDependencies['@types/jest'],
    ].map(major);
    const lockedMajors = [
      packageLock.packages['node_modules/jest'].version,
      packageLock.packages['node_modules/@jest/globals'].version,
      packageLock.packages['node_modules/@types/jest'].version,
      packageLock.packages['node_modules/jest-cli'].version,
      packageLock.packages['node_modules/jest-runtime'].version,
    ].map(major);

    expect(new Set(declaredMajors).size).toBe(1);
    expect(new Set(lockedMajors).size).toBe(1);
    expect(lockedMajors[0]).toBe(declaredMajors[0]);
  });
});
