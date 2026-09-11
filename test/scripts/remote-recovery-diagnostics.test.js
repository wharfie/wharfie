import { describe, expect, test } from '@jest/globals';

import { remoteRecoveryServiceFailureContext } from '../../scripts/remote-recovery-diagnostics.js';

const REMOTE_PATH = '/home/wharfie/disposable-proof/app-sea';
const REQUEST = {
  argv: [REMOTE_PATH, 'wharfie', 'service', 'converge', '--json'],
  stdin: Buffer.from('private request input'),
  environment: { TOKEN: 'private environment' },
};
/** @type {import('../../src/core/runtime/bounded-process.js').BoundedProcessOutcome} */
const OUTCOME = {
  status: 'exited',
  exitCode: 1,
  signal: null,
  timedOut: false,
  stdout: Buffer.alloc(20_000, 'o'),
  stderr: Buffer.alloc(20_000, 'e'),
};

describe('remote recovery activation diagnostics', () => {
  test('bounds each public-command stream and omits request material', () => {
    const context = remoteRecoveryServiceFailureContext(
      REMOTE_PATH,
      REQUEST,
      OUTCOME,
    );
    expect(context).toEqual({
      operation: 'converge',
      status: 'exited',
      exitCode: 1,
      signal: null,
      timedOut: false,
      stdout: 'o'.repeat(8192),
      stderr: 'e'.repeat(8192),
    });
    expect(JSON.stringify(context)).not.toContain('private');
    expect(JSON.stringify(context)).not.toContain(REMOTE_PATH);
  });

  test.each([
    { argv: ['/usr/bin/cat', '/private/identity'] },
    { argv: ['/another/app-sea', ...REQUEST.argv.slice(1)] },
    { argv: [REMOTE_PATH, 'wharfie', 'service', 'logs', '--json'] },
    { argv: [...REQUEST.argv, '--extra'] },
  ])(
    'ignores output outside the exact public command allowlist: %j',
    (request) => {
      expect(
        remoteRecoveryServiceFailureContext(REMOTE_PATH, request, OUTCOME),
      ).toBeNull();
    },
  );

  test('ignores successful public commands', () => {
    expect(
      remoteRecoveryServiceFailureContext(REMOTE_PATH, REQUEST, {
        ...OUTCOME,
        exitCode: 0,
      }),
    ).toBeNull();
  });
});
