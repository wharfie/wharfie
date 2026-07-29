/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it, jest } from '@jest/globals';

import {
  assertStableDecision,
  createSteadyFilePreviewRemote,
  purgeSteadyFilePreviewApplication,
} from '../../scripts/verify-steady-file-preview-target.js';

function successfulSpawn(overrides = {}) {
  return {
    status: 0,
    stdout: '',
    stderr: '',
    ...overrides,
  };
}

function createSpawnMock(resultFactory = () => successfulSpawn()) {
  /**
   * @param {string} _command
   * @param {string[]} _args
   * @param {Record<string, any>} _options
   */
  function spawn(_command, _args, _options) {
    return resultFactory();
  }
  return jest.fn(spawn);
}

describe('steady-file preview target controller transport', () => {
  it('retries only the public purge-incomplete recovery result', () => {
    const incomplete = {
      schemaVersion: 1,
      kind: 'wharfie.service.error',
      action: 'purge',
      code: 'systemd-user-service-purge-incomplete',
      message:
        'Systemd user-service purge was interrupted and is safe to retry.',
      remediation:
        'Retry service purge with the same --confirm-data-loss application ID.',
    };
    const purged = {
      schemaVersion: 1,
      kind: 'wharfie.service.result',
      action: 'purge',
      requestStatus: 'fulfilled',
      appId: 'steady-file-demo',
      outcome: 'purged',
      health: 'absent',
    };
    const results = [
      successfulSpawn({
        status: 1,
        stderr: `${JSON.stringify(incomplete)}\n`,
      }),
      successfulSpawn({
        stdout: `${JSON.stringify(purged)}\n`,
      }),
    ];
    let resultIndex = 0;
    const spawn = createSpawnMock(() => results[resultIndex++]);
    const remote = createSteadyFilePreviewRemote('preview-target', {
      spawn,
    });

    expect(
      purgeSteadyFilePreviewApplication(
        remote,
        '/home/wharfie/preview/handoff/source/app',
      ),
    ).toEqual({
      receipt: purged,
      recovery: {
        required: true,
        firstFailure: incomplete,
        attemptCount: 2,
      },
    });
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[0][1]).toEqual([
      'shell',
      '--tty=false',
      'preview-target',
      '/usr/bin/env',
      'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      '/home/wharfie/preview/handoff/source/app',
      'wharfie',
      'service',
      'purge',
      '--confirm-data-loss',
      'steady-file-demo',
      '--json',
    ]);
  });

  it('compares canonical JSON values without requiring matching object prototypes', () => {
    const fingerprint = Object.assign(Object.create(null), {
      bytes: 43,
      readStable: true,
      sha256: '9d'.repeat(32),
    });
    const expected = Object.assign(Object.create(null), {
      current: Object.assign(Object.create(null), fingerprint),
      baseline: Object.assign(Object.create(null), fingerprint),
      stable: true,
    });
    const actual = {
      path: '/home/wharfie/preview/artifact.tar',
      stable: true,
      baseline: { ...fingerprint },
      current: { ...fingerprint },
    };

    expect(() =>
      assertStableDecision(
        actual,
        '/home/wharfie/preview/artifact.tar',
        expected,
      ),
    ).not.toThrow();
    expect(() =>
      assertStableDecision(
        {
          ...actual,
          current: { ...actual.current, bytes: 44 },
        },
        '/home/wharfie/preview/artifact.tar',
        expected,
      ),
    ).toThrow();
  });

  it.each([
    'preview-target',
    'preview_target',
    'preview.target',
    'PreviewTarget-01',
    '0-preview',
  ])('accepts the safe Lima instance name %s', (instance) => {
    expect(() =>
      createSteadyFilePreviewRemote(instance, {
        spawn: createSpawnMock(),
      }),
    ).not.toThrow();
  });

  it.each([
    undefined,
    null,
    1,
    '',
    '-preview',
    '.preview',
    '_preview',
    'preview target',
    'preview/target',
    'preview:target',
    'preview\ntarget',
  ])('rejects the unsafe Lima instance name %p', (instance) => {
    expect(() =>
      createSteadyFilePreviewRemote(/** @type {any} */ (instance)),
    ).toThrow(
      new TypeError('steady-file target instance must be a safe name.'),
    );
  });

  it('spawns one exact limactl shell argv with caller data propagated and no host shell', () => {
    const spawn = createSpawnMock(() =>
      successfulSpawn({
        stdout: Buffer.from('target stdout'),
        stderr: Buffer.from('target stderr'),
      }),
    );
    const environment = Object.freeze({
      HOME: '/private/isolated-home',
      LIMA_HOME: '/private/isolated-lima',
    });
    const input = Buffer.from('literal input');
    const remote = createSteadyFilePreviewRemote('preview-target', {
      spawn,
      command: '/opt/lima/bin/limactl',
      environment,
    });

    expect(
      remote.run(
        '/usr/bin/env',
        [
          'PATH=/usr/bin:/bin',
          '/home/wharfie/preview/handoff/source/app',
          'ordinary',
          '--json',
        ],
        { input, timeoutMs: 1_234 },
      ),
    ).toEqual({
      status: 0,
      stdout: 'target stdout',
      stderr: 'target stderr',
    });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      '/opt/lima/bin/limactl',
      [
        'shell',
        '--tty=false',
        'preview-target',
        '/usr/bin/env',
        'PATH=/usr/bin:/bin',
        '/home/wharfie/preview/handoff/source/app',
        'ordinary',
        '--json',
      ],
      {
        encoding: 'utf8',
        env: environment,
        input,
        maxBuffer: 20 * 1024 * 1024,
        timeout: 1_234,
        windowsHide: true,
      },
    );
    expect(spawn.mock.calls[0][2]).not.toHaveProperty('shell');
  });

  it('uses stable default process options', () => {
    const spawn = createSpawnMock();
    const environment = Object.freeze({ HOME: '/private/isolated-home' });
    const remote = createSteadyFilePreviewRemote('preview', {
      spawn,
      environment,
    });

    remote.run('/usr/bin/true');

    expect(spawn).toHaveBeenCalledWith(
      'limactl',
      ['shell', '--tty=false', 'preview', '/usr/bin/true'],
      {
        encoding: 'utf8',
        env: environment,
        input: undefined,
        maxBuffer: 20 * 1024 * 1024,
        timeout: 180_000,
        windowsHide: true,
      },
    );
  });

  it.each([['/bin/sh'], ['/bin/bash'], ['/usr/bin/sh'], ['/usr/bin/bash']])(
    'rejects the shell executable %s before spawning',
    (executable) => {
      const spawn = createSpawnMock();
      const remote = createSteadyFilePreviewRemote('preview', { spawn });

      expect(() => remote.run(executable, ['-c', 'false'])).toThrow(
        'steady-file target commands may not invoke a shell.',
      );
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['', []],
    ['usr/bin/true', []],
    [1, []],
    ['/usr/bin/true', 'not-an-array'],
    ['/usr/bin/true', ['ok', 1]],
  ])(
    'rejects a non-absolute executable or non-string argv before spawning',
    (executable, args) => {
      const spawn = createSpawnMock();
      const remote = createSteadyFilePreviewRemote('preview', { spawn });

      expect(() =>
        remote.run(/** @type {any} */ (executable), /** @type {any} */ (args)),
      ).toThrow(
        new TypeError(
          'steady-file target commands require an absolute executable and string argv.',
        ),
      );
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it('throws on a nonzero result unless failure is explicitly allowed', () => {
    const spawn = createSpawnMock(() =>
      successfulSpawn({
        status: 23,
        stdout: 'fallback stdout',
        stderr: 'specific target failure\n',
      }),
    );
    const remote = createSteadyFilePreviewRemote('preview', { spawn });

    expect(() => remote.run('/usr/bin/test', ['-e', '/missing'])).toThrow(
      '/usr/bin/test failed with exit 23: specific target failure',
    );
    expect(
      remote.run('/usr/bin/test', ['-e', '/missing'], {
        allowFailure: true,
      }),
    ).toEqual({
      status: 23,
      stdout: 'fallback stdout',
      stderr: 'specific target failure\n',
    });
  });

  it('uses stdout as failure detail and treats a missing status as failure', () => {
    const remote = createSteadyFilePreviewRemote('preview', {
      spawn: () =>
        successfulSpawn({
          status: null,
          stdout: 'command was terminated\n',
        }),
    });

    expect(() => remote.run('/usr/bin/false')).toThrow(
      '/usr/bin/false failed with exit 1: command was terminated',
    );
  });

  it('propagates a process launch error unchanged', () => {
    const launchError = new Error('limactl executable was not found');
    const remote = createSteadyFilePreviewRemote('preview', {
      spawn: () =>
        successfulSpawn({
          error: launchError,
        }),
    });

    expect(() => remote.run('/usr/bin/true')).toThrow(launchError);
  });
});
