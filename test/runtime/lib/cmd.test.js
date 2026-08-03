/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import EventEmitter from 'node:events';

const CHILD_PROCESS_IMPORT = 'node:child_process';
const CMD_IMPORT = '../../../src/core/lib/cmd.js';

/** @type {EventEmitter} */
let child;

beforeEach(() => {
  jest.resetModules();
  child = new EventEmitter();
  jest.unstable_mockModule(CHILD_PROCESS_IMPORT, () => ({
    execFile: jest.fn(),
    spawn: jest.fn(() => child),
    spawnSync: jest.fn(),
  }));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

describe('runCmd sensitive argument redaction', () => {
  it('routes child stdout and stderr to parent stderr', async () => {
    const { spawn } = await import(CHILD_PROCESS_IMPORT);
    const { runCmd } = await import(CMD_IMPORT);
    const result = runCmd('build-tool', ['--diagnostic']);

    child.emit('exit', 0, null);

    await expect(result).resolves.toBeUndefined();
    expect(spawn).toHaveBeenCalledWith('build-tool', ['--diagnostic'], {
      stdio: ['inherit', process.stderr, process.stderr],
    });
  });

  it('redacts marked arguments from nonzero-exit diagnostics', async () => {
    const { runCmd } = await import(CMD_IMPORT);
    const secret = 'credential-password-sentinel';
    const result = runCmd(
      'security',
      ['import', 'certificate.p12', '-P', secret],
      { sensitiveArgIndexes: [3] },
    );

    child.emit('exit', 1, null);

    await expect(result).rejects.toThrow(
      'Command failed: security import certificate.p12 -P [REDACTED], exit code 1',
    );
    await expect(result).rejects.not.toThrow(secret);
  });

  it('does not rethrow spawn errors carrying credential argv metadata', async () => {
    const { runCmd } = await import(CMD_IMPORT);
    const secret = 'spawn-error-password-sentinel';
    const result = runCmd('security', ['unlock-keychain', '-p', secret], {
      sensitiveArgIndexes: [2],
    });
    const error = Object.assign(new Error(`spawn security ${secret} ENOENT`), {
      code: 'ENOENT',
      spawnargs: ['unlock-keychain', '-p', secret],
    });

    child.emit('error', error);

    await expect(result).rejects.toThrow(
      'Command failed to start: security unlock-keychain -p [REDACTED] (ENOENT)',
    );
    await expect(result).rejects.not.toThrow(secret);
  });

  it('redacts marked arguments when spawn throws synchronously', async () => {
    const { spawn } = await import(CHILD_PROCESS_IMPORT);
    const secret = 'nul-password-sentinel';
    /** @type {ReturnType<typeof jest.fn>} */
    const spawnMock = /** @type {any} */ (spawn);
    spawnMock.mockImplementationOnce(() => {
      throw Object.assign(new Error(`invalid argv ${secret}`), {
        code: 'ERR_INVALID_ARG_VALUE',
      });
    });
    const { runCmd } = await import(CMD_IMPORT);

    const result = runCmd('security', ['unlock-keychain', '-p', secret], {
      sensitiveArgIndexes: [2],
    });

    await expect(result).rejects.toThrow(
      'Command failed to start: security unlock-keychain -p [REDACTED] (ERR_INVALID_ARG_VALUE)',
    );
    await expect(result).rejects.not.toThrow(secret);
  });
});
