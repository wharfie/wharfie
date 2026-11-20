/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { spawn as spawnProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const CHILD_PROCESS_IMPORT = 'node:child_process';

beforeEach(() => {
  jest.resetModules();
});

describe('SEA inspector process launch', () => {
  it('uses the explicit SEA runtime-options channel without NODE_OPTIONS', async () => {
    const child = /** @type {any} */ (new EventEmitter());
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const spawn = /** @type {any} */ (jest.fn(() => child));
    jest.unstable_mockModule(CHILD_PROCESS_IMPORT, () => ({ spawn }));
    const { spawnInspectorPausedProcess } =
      await import('../../scripts/sea-inspector.js');
    const env = { HOME: '/tmp/sea-inspector-home', PATH: '/usr/bin:/bin' };

    const inspected = spawnInspectorPausedProcess(
      '/tmp/wharfie-sea',
      ['wharfie', 'service', 'update', '--json'],
      {
        cwd: '/tmp',
        env,
      },
    );

    expect(spawn).toHaveBeenCalledWith(
      '/tmp/wharfie-sea',
      [
        '--node-options=--inspect-brk=127.0.0.1:0 --inspect-publish-uid=stderr',
        'wharfie',
        'service',
        'update',
        '--json',
      ],
      {
        cwd: '/tmp',
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    child.emit('error', new Error('test process stopped'));
    child.emit('close', null, null);
    await expect(inspected.inspectorUrl).rejects.toThrow(
      /test process stopped/,
    );
    await expect(inspected.exited).resolves.toEqual({
      code: null,
      signal: null,
    });
  });

  it('still refuses an inherited NODE_OPTIONS value', async () => {
    const spawn = jest.fn();
    jest.unstable_mockModule(CHILD_PROCESS_IMPORT, () => ({ spawn }));
    const { spawnInspectorPausedProcess } =
      await import('../../scripts/sea-inspector.js');

    expect(() =>
      spawnInspectorPausedProcess('/tmp/wharfie-sea', [], {
        cwd: '/tmp',
        env: { NODE_OPTIONS: '--require=/tmp/preload.js' },
      }),
    ).toThrow(/refuses inherited NODE_OPTIONS/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('refuses a caller-provided runtime-options carrier', async () => {
    const spawn = jest.fn();
    jest.unstable_mockModule(CHILD_PROCESS_IMPORT, () => ({ spawn }));
    const { spawnInspectorPausedProcess } =
      await import('../../scripts/sea-inspector.js');

    expect(() =>
      spawnInspectorPausedProcess(
        '/tmp/wharfie-sea',
        ['--node-options=--inspect=0.0.0.0:9229'],
        {
          cwd: '/tmp',
          env: {},
        },
      ),
    ).toThrow(/reserved --node-options carrier/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('retains stderr that drains after process exit', async () => {
    const child = /** @type {any} */ (new EventEmitter());
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const spawn = jest.fn(() => child);
    jest.unstable_mockModule(CHILD_PROCESS_IMPORT, () => ({ spawn }));
    const { spawnInspectorPausedProcess } =
      await import('../../scripts/sea-inspector.js');
    const inspected = spawnInspectorPausedProcess('/tmp/wharfie-sea', [], {
      cwd: '/tmp',
      env: {},
    });

    child.emit('exit', 0, null);
    child.stderr.write(
      'Starting inspector on 127.0.0.1:0 failed: operation not permitted\n',
    );
    child.emit('close', 0, null);

    await expect(inspected.inspectorUrl).rejects.toThrow(
      /operation not permitted/,
    );
    await expect(inspected.exited).resolves.toEqual({
      code: 0,
      signal: null,
    });
  });
});

describe('SEA inspector pause tracking', () => {
  it('reports exactly the process it holds paused, until it resumes', async () => {
    // The real child_process: earlier tests mock it for the module under
    // test, so this process is spawned through the static import.
    jest.unstable_mockModule(CHILD_PROCESS_IMPORT, () => ({
      spawn: spawnProcess,
    }));
    const {
      attachSeaInspector,
      hasSeaProcessPausedByInspector,
      isSeaProcessPausedByInspector,
    } = await import('../../scripts/sea-inspector.js');

    // A stand-in for a SEA: an application bundle named esbundle.js with an
    // inline source map, loaded after the inspector's first break.
    const root = mkdtempSync(join(tmpdir(), 'wharfie-sea-inspector-pause-'));
    const map = Buffer.from(
      JSON.stringify({
        version: 3,
        sources: ['app.js'],
        names: [],
        mappings: 'AAAA',
      }),
    ).toString('base64');
    writeFileSync(
      join(root, 'esbundle.js'),
      `setInterval(() => {}, 1000);\n//# sourceMappingURL=data:application/json;base64,${map}\n`,
    );
    writeFileSync(
      join(root, 'main.js'),
      "setTimeout(() => require('./esbundle.js'), 10);\n",
    );
    const child = spawnProcess(
      process.execPath,
      [
        '--inspect-brk=127.0.0.1:0',
        '--inspect-publish-uid=stderr',
        join(root, 'main.js'),
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    const exited = new Promise((resolve) => child.once('exit', resolve));
    /** @type {any} */
    let inspector;
    try {
      const inspectorUrl = new Promise((resolve, reject) => {
        let stderr = '';
        child.stderr?.on('data', (chunk) => {
          stderr += String(chunk);
          const match = /Debugger listening on (ws:\/\/\S+)/.exec(stderr);
          if (match) resolve(match[1]);
        });
        child.once('exit', () => reject(new Error(stderr)));
      });
      inspector = await attachSeaInspector(
        { inspectorUrl, child },
        { timeoutMs: 10_000 },
      );
      expect(
        isSeaProcessPausedByInspector(/** @type {number} */ (child.pid)),
      ).toBe(true);
      expect(isSeaProcessPausedByInspector(process.pid)).toBe(false);

      await inspector.resume();
      const deadline = Date.now() + 5_000;
      while (hasSeaProcessPausedByInspector() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(
        isSeaProcessPausedByInspector(/** @type {number} */ (child.pid)),
      ).toBe(false);
    } finally {
      inspector?.close();
      child.kill('SIGKILL');
      await exited;
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
