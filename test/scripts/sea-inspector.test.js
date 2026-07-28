/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { EventEmitter } from 'node:events';
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
