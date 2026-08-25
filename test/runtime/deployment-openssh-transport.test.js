import { Readable } from 'node:stream';

import { describe, expect, it, jest } from '@jest/globals';

import {
  DEPLOYMENT_OPENSSH_MAX_DURATION_MILLISECONDS,
  DEPLOYMENT_OPENSSH_MAX_OUTPUT_BYTES,
  DEPLOYMENT_OPENSSH_MAX_REMOTE_ARGUMENTS,
  DEPLOYMENT_OPENSSH_MAX_REMOTE_COMMAND_BYTES,
  DEPLOYMENT_OPENSSH_PATH,
  createDeploymentOpenSshTransport,
  encodePosixArgv,
} from '../../src/core/runtime/deployment-openssh-transport.js';

const PRIVATE_KEY_PATH =
  '/Users/example/Library/Application Support/wharfie/id_ed25519';
const KNOWN_HOSTS_PATH =
  '/Users/example/Library/Application Support/wharfie/known_hosts';
const FINITE_OUTCOME = Object.freeze({
  status: 'exited',
  exitCode: 0,
  signal: null,
  timedOut: false,
  stdout: Buffer.from('remote-output'),
  stderr: Buffer.alloc(0),
});

function makeFixture() {
  const run = jest.fn(
    async (/** @type {unknown} */ _request) => FINITE_OUTCOME,
  );
  const runProcess = { run };
  const transport = createDeploymentOpenSshTransport({
    address: '203.0.113.10',
    privateKeyPath: PRIVATE_KEY_PATH,
    knownHostsPath: KNOWN_HOSTS_PATH,
    runProcess,
  });
  return { run, runProcess, transport };
}

function makeRequest(overrides = {}) {
  return {
    argv: ['/opt/wharfie/app', 'wharfie', 'service', 'status', '--json'],
    stdin: null,
    timeoutMilliseconds: 45_000,
    maximumStdoutBytes: 64 * 1024,
    maximumStderrBytes: 8 * 1024,
    ...overrides,
  };
}

describe('deployment OpenSSH transport', () => {
  it('quotes every POSIX argv word without admitting shell syntax', () => {
    const argv = [
      '/opt/wharfie/app',
      '',
      'two words',
      "single'quote",
      '$HOME',
      '`touch /tmp/nope`',
      '$(touch /tmp/nope)',
      'line\nbreak',
    ];

    expect(encodePosixArgv(argv)).toBe(
      [
        "'/opt/wharfie/app'",
        "''",
        "'two words'",
        "'single'\"'\"'quote'",
        "'$HOME'",
        "'`touch /tmp/nope`'",
        "'$(touch /tmp/nope)'",
        "'line\nbreak'",
      ].join(' '),
    );
  });

  it('runs one exact absolute remote argv through a fully pinned SSH invocation', async () => {
    const { run, transport } = makeFixture();
    const input = Readable.from([Buffer.from('held-artifact-bytes')]);
    const result = await transport.runRemoteArgv(
      makeRequest({
        argv: [
          '/home/wharfie/bin/app',
          'hello',
          "Ada's laptop",
          '$HCLOUD_TOKEN',
        ],
        stdin: input,
      }),
    );

    expect(result).toBe(FINITE_OUTCOME);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({
      file: DEPLOYMENT_OPENSSH_PATH,
      args: [
        '-F',
        '/dev/null',
        '-T',
        '-o',
        'AddKeysToAgent=no',
        '-o',
        'BatchMode=yes',
        '-o',
        'CanonicalizeHostname=no',
        '-o',
        'CheckHostIP=yes',
        '-o',
        'ClearAllForwardings=yes',
        '-o',
        'ConnectionAttempts=1',
        '-o',
        'ConnectTimeout=10',
        '-o',
        'ControlMaster=no',
        '-o',
        'ControlPath=none',
        '-o',
        'ControlPersist=no',
        '-o',
        'EnableSSHKeysign=no',
        '-o',
        'EscapeChar=none',
        '-o',
        'ExitOnForwardFailure=yes',
        '-o',
        'ForwardAgent=no',
        '-o',
        'ForwardX11=no',
        '-o',
        'ForwardX11Trusted=no',
        '-o',
        'GlobalKnownHostsFile=/dev/null',
        '-o',
        'GSSAPIAuthentication=no',
        '-o',
        'HostbasedAuthentication=no',
        '-o',
        'HostKeyAlgorithms=ssh-ed25519',
        '-o',
        'IdentitiesOnly=yes',
        '-o',
        'IdentityAgent=none',
        '-o',
        'KbdInteractiveAuthentication=no',
        '-o',
        'LogLevel=ERROR',
        '-o',
        'NumberOfPasswordPrompts=0',
        '-o',
        'PasswordAuthentication=no',
        '-o',
        'PermitLocalCommand=no',
        '-o',
        'PreferredAuthentications=publickey',
        '-o',
        'ProxyCommand=none',
        '-o',
        'ProxyJump=none',
        '-o',
        'PubkeyAuthentication=yes',
        '-o',
        'RequestTTY=no',
        '-o',
        'ServerAliveCountMax=2',
        '-o',
        'ServerAliveInterval=15',
        '-o',
        'StrictHostKeyChecking=yes',
        '-o',
        'Tunnel=no',
        '-o',
        `UserKnownHostsFile=${KNOWN_HOSTS_PATH}`,
        '-o',
        'UpdateHostKeys=no',
        '-o',
        'VerifyHostKeyDNS=no',
        '-i',
        PRIVATE_KEY_PATH,
        '-p',
        '22',
        '--',
        'wharfie@203.0.113.10',
        "'/home/wharfie/bin/app' 'hello' 'Ada'\"'\"'s laptop' '$HCLOUD_TOKEN'",
      ],
      stdin: input,
      environment: {
        LANG: 'C',
        LC_ALL: 'C',
        PATH: '/usr/bin:/bin',
      },
      timeoutMilliseconds: 45_000,
      maximumStdoutBytes: 64 * 1024,
      maximumStderrBytes: 8 * 1024,
    });
  });

  it('snapshots the injected process method at construction', async () => {
    const { run, runProcess, transport } = makeFixture();
    runProcess.run = jest.fn(async () => {
      throw new Error('replacement must not run');
    });

    await expect(transport.runRemoteArgv(makeRequest())).resolves.toBe(
      FINITE_OUTCOME,
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(runProcess.run).not.toHaveBeenCalled();
  });

  it('passes only a minimal non-cloud local process environment', async () => {
    const { run, transport } = makeFixture();
    await transport.runRemoteArgv(makeRequest());

    const request = /** @type {any} */ (run.mock.calls[0]?.[0]);
    expect(request.environment).toEqual({
      LANG: 'C',
      LC_ALL: 'C',
      PATH: '/usr/bin:/bin',
    });
    expect(request.environment).not.toHaveProperty('AWS_ACCESS_KEY_ID');
    expect(request.environment).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
    expect(request.environment).not.toHaveProperty('AWS_SESSION_TOKEN');
    expect(request.environment).not.toHaveProperty('HCLOUD_TOKEN');
    expect(request.environment).not.toHaveProperty('HOME');
    expect(request.environment).not.toHaveProperty('SSH_AUTH_SOCK');
  });

  it.each([
    ['hostname', { address: 'host.example' }, /numeric IPv4/i],
    ['IPv6', { address: '2001:db8::1' }, /numeric IPv4/i],
    ['noncanonical IPv4', { address: '203.0.113.010' }, /numeric IPv4/i],
    [
      'relative private key',
      { privateKeyPath: 'id_ed25519' },
      /canonical absolute local path/i,
    ],
    [
      'relative known hosts',
      { knownHostsPath: 'known_hosts' },
      /canonical absolute local path/i,
    ],
    [
      'newline in known hosts',
      { knownHostsPath: '/tmp/known\nhosts' },
      /canonical absolute local path/i,
    ],
    [
      'same identity files',
      { knownHostsPath: PRIVATE_KEY_PATH },
      /paths must differ/i,
    ],
    ['missing process port', { runProcess: null }, /must provide run/i],
  ])('rejects a %s endpoint or identity', (_name, override, pattern) => {
    const candidate = /** @type {any} */ ({
      address: '203.0.113.10',
      privateKeyPath: PRIVATE_KEY_PATH,
      knownHostsPath: KNOWN_HOSTS_PATH,
      runProcess: { run: async () => FINITE_OUTCOME },
      ...override,
    });
    expect(() => createDeploymentOpenSshTransport(candidate)).toThrow(pattern);
  });

  it('does not expose user, port, SSH options, or a raw command input', async () => {
    const { run, transport } = makeFixture();

    expect(() =>
      createDeploymentOpenSshTransport(
        /** @type {any} */ ({
          address: '203.0.113.10',
          privateKeyPath: PRIVATE_KEY_PATH,
          knownHostsPath: KNOWN_HOSTS_PATH,
          runProcess: { run: async () => FINITE_OUTCOME },
          user: 'root',
        }),
      ),
    ).toThrow(/exact fields/i);
    await expect(
      transport.runRemoteArgv({
        ...makeRequest(),
        command: 'rm -rf /',
      }),
    ).rejects.toThrow(/exact fields/i);
    expect(run).not.toHaveBeenCalled();
    expect(Object.keys(transport)).toEqual(['runRemoteArgv']);
  });

  it.each([
    ['empty argv', { argv: [] }, /between 1 and/i],
    ['relative executable', { argv: ['app'] }, /absolute remote executable/i],
    [
      'normalized executable',
      { argv: ['/opt/../bin/app'] },
      /absolute remote executable/i,
    ],
    ['NUL argument', { argv: ['/bin/app', 'bad\0arg'] }, /without NUL/i],
    ['unsupported stdin', { stdin: 'raw bytes' }, /Buffer.*Readable/i],
    ['zero timeout', { timeoutMilliseconds: 0 }, /positive safe integer/i],
    [
      'excessive timeout',
      {
        timeoutMilliseconds: DEPLOYMENT_OPENSSH_MAX_DURATION_MILLISECONDS + 1,
      },
      /not exceeding/i,
    ],
    [
      'excessive stdout',
      { maximumStdoutBytes: DEPLOYMENT_OPENSSH_MAX_OUTPUT_BYTES + 1 },
      /not exceeding/i,
    ],
    [
      'negative stderr',
      { maximumStderrBytes: -1 },
      /nonnegative safe integer/i,
    ],
  ])('rejects %s before invoking SSH', async (_name, override, pattern) => {
    const { run, transport } = makeFixture();
    await expect(
      transport.runRemoteArgv(makeRequest(override)),
    ).rejects.toThrow(pattern);
    expect(run).not.toHaveBeenCalled();
  });

  it('bounds remote argument count and encoded command bytes', () => {
    expect(() =>
      encodePosixArgv([
        '/bin/app',
        ...Array.from(
          { length: DEPLOYMENT_OPENSSH_MAX_REMOTE_ARGUMENTS },
          () => 'argument',
        ),
      ]),
    ).toThrow(/between 1 and/i);
    expect(() =>
      encodePosixArgv([
        '/bin/app',
        'x'.repeat(DEPLOYMENT_OPENSSH_MAX_REMOTE_COMMAND_BYTES),
      ]),
    ).toThrow(/remote command must not exceed/i);
  });
});
