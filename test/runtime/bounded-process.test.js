import { Readable } from 'node:stream';

import { describe, expect, it } from '@jest/globals';

import { createBoundedProcessRunner } from '../../src/core/runtime/bounded-process.js';

const environment = Object.freeze({
  LANG: 'C',
  LC_ALL: 'C',
  PATH: '/usr/bin:/bin',
});

/**
 * @param {string[]} args
 * @param {Record<string, any>} [overrides]
 */
function request(args, overrides = {}) {
  return {
    file: process.execPath,
    args: ['-e', ...args],
    stdin: null,
    environment,
    timeoutMilliseconds: 2_000,
    maximumStdoutBytes: 4_096,
    maximumStderrBytes: 4_096,
    ...overrides,
  };
}

describe('bounded process runner', () => {
  it('streams exact stdin and observes a finite exit without a shell', async () => {
    const runner = createBoundedProcessRunner();
    const input = Buffer.from('exact held bytes');
    const outcome = await runner.run(
      request(['process.stdin.pipe(process.stdout)'], { stdin: input }),
    );

    expect(outcome).toEqual({
      status: 'exited',
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: input,
      stderr: Buffer.alloc(0),
    });
  });

  it('accepts a readable stdin source and keeps stderr separate', async () => {
    const runner = createBoundedProcessRunner();
    const outcome = await runner.run(
      request(
        ["process.stdin.pipe(process.stdout); process.stderr.write('warning')"],
        { stdin: Readable.from([Buffer.from('streamed')]) },
      ),
    );

    expect(outcome.status).toBe('exited');
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout.toString()).toBe('streamed');
    expect(outcome.stderr.toString()).toBe('warning');
  });

  it('returns an exact nonzero exit rather than turning stderr into an error', async () => {
    const outcome = await createBoundedProcessRunner().run(
      request(["process.stderr.write('nope'); process.exit(7)"]),
    );

    expect(outcome).toMatchObject({
      status: 'exited',
      exitCode: 7,
      signal: null,
      timedOut: false,
    });
    expect(outcome.stderr.toString()).toBe('nope');
  });

  it('kills and marks output overflow ambiguous while retaining only the bound', async () => {
    const outcome = await createBoundedProcessRunner().run(
      request(["process.stdout.write('x'.repeat(1024))"], {
        maximumStdoutBytes: 17,
      }),
    );

    expect(outcome.status).toBe('ambiguous');
    expect(outcome.stdout).toEqual(Buffer.alloc(17, 'x'));
    expect(outcome.stderr).toHaveLength(0);
  });

  it('kills and marks a deadline ambiguous', async () => {
    const outcome = await createBoundedProcessRunner().run(
      request(['setInterval(() => {}, 1000)'], {
        timeoutMilliseconds: 25,
      }),
    );

    expect(outcome).toMatchObject({
      status: 'ambiguous',
      exitCode: null,
      signal: 'SIGKILL',
      timedOut: true,
    });
  });

  it('passes only the explicit environment and treats metacharacters as argv', async () => {
    const sentinel = '$(touch should-not-exist); `whoami`';
    const outcome = await createBoundedProcessRunner().run(
      request(
        [
          'process.stdout.write(JSON.stringify({arg:process.argv[1],custom:process.env.CUSTOM,secret:process.env.SECRET}))',
          sentinel,
        ],
        { environment: { ...environment, CUSTOM: 'present' } },
      ),
    );

    expect(JSON.parse(outcome.stdout.toString())).toEqual({
      arg: sentinel,
      custom: 'present',
    });
  });

  it.each([
    [
      'relative executable',
      { file: 'node' },
      /canonical absolute executable path/i,
    ],
    ['zero timeout', { timeoutMilliseconds: 0 }, /greater than zero/i],
    ['negative output bound', { maximumStdoutBytes: -1 }, /nonnegative/i],
    ['unsupported stdin', { stdin: 'secret-stdin' }, /Buffer.*Readable/i],
    ['NUL argument', { args: ['-e', 'ok', 'not\0valid'] }, /without NUL/i],
    ['ambient environment', { environment: null }, /explicit plain object/i],
    ['unknown option', { shell: true }, /shell is not supported/i],
  ])('rejects %s', async (_name, override, pattern) => {
    await expect(
      createBoundedProcessRunner().run(request([''], override)),
    ).rejects.toThrow(pattern);
  });

  it('does not echo invalid argument or environment values in errors', async () => {
    const sentinel = 'secret-sentinel\0value';
    let thrown;
    try {
      await createBoundedProcessRunner().run(
        request([''], {
          environment: { SECRET: sentinel },
        }),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).not.toContain(sentinel);
  });
});
