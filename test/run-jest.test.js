/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it, jest } from '@jest/globals';
import { promises as fsp } from 'node:fs';
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
        env: harness.env,
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
});
