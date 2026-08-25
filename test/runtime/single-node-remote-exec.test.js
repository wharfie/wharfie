import { createHash } from 'node:crypto';

import { describe, expect, it, jest } from '@jest/globals';

import { DEPLOYMENT_OPENSSH_MAX_REMOTE_ARGUMENTS } from '../../src/core/runtime/deployment-openssh-transport.js';
import { SINGLE_NODE_BOOTSTRAP_IDENTITY_PATH } from '../../src/core/runtime/single-node-cloud-init.js';
import {
  getSingleNodeDeploymentCurrentRelease,
  prepareSingleNodeDeploymentReleaseUpdate,
} from '../../src/core/runtime/single-node-deployment-journal.js';
import {
  SINGLE_NODE_REMOTE_EXEC_MAX_STDERR_BYTES,
  SINGLE_NODE_REMOTE_EXEC_MAX_STDOUT_BYTES,
  SINGLE_NODE_REMOTE_EXEC_TIMEOUT_MILLISECONDS,
  createSingleNodeRemoteExecutor,
} from '../../src/core/runtime/single-node-remote-exec.js';
import {
  createHealthySingleNodeServiceStatus,
  createProcessOutcome,
  createSingleNodeStatusActiveJournal,
  createSingleNodeStatusActivatingJournal,
  createSingleNodeStatusAuthorityFixture,
  createSingleNodeStatusUpdateTarget,
} from './fixtures/single-node-status-fixture.js';

const DATA_ROOT = '/private/remote-exec-data';

/** @param {number} byte */
function publicKey(byte) {
  /** @param {string|Buffer} value */
  const wireString = (value) => {
    const bytes = Buffer.from(value);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.byteLength);
    return Buffer.concat([length, bytes]);
  };
  return `ssh-ed25519 ${Buffer.concat([
    wireString('ssh-ed25519'),
    wireString(Buffer.alloc(32, byte)),
  ]).toString('base64')}`;
}

/** @param {string} key */
function publicKeyFingerprint(key) {
  return `SHA256:${createHash('sha256')
    .update(Buffer.from(key.split(' ')[1], 'base64'))
    .digest('base64')
    .replace(/=+$/u, '')}`;
}

/**
 * @param {Awaited<ReturnType<typeof createSingleNodeStatusAuthorityFixture>>} fixture
 * @param {ReturnType<typeof jest.fn>} runRemoteArgv
 * @param {Partial<Record<'readIdentity'|'readHostKey'|'createTransport', ReturnType<typeof jest.fn>>>} [overrides]
 */
function makeHarness(fixture, runRemoteArgv, overrides = {}) {
  const readIdentity =
    overrides.readIdentity ?? jest.fn(async () => fixture.sshIdentity);
  const readHostKey =
    overrides.readHostKey ??
    jest.fn(async () => ({
      address: fixture.publicIpv4,
      algorithm: 'ssh-ed25519',
      fingerprint: fixture.hostKeyFingerprint,
    }));
  const createTransport =
    overrides.createTransport ?? jest.fn(() => ({ runRemoteArgv }));
  return {
    readIdentity,
    readHostKey,
    createTransport,
    executor: createSingleNodeRemoteExecutor({
      readIdentity,
      readHostKey,
      createTransport,
    }),
  };
}

/**
 * @param {Awaited<ReturnType<typeof createSingleNodeStatusAuthorityFixture>>} fixture
 * @param {import('../../src/core/runtime/bounded-process.js').BoundedProcessOutcome} applicationOutcome
 */
function successfulRun(fixture, applicationOutcome = createProcessOutcome()) {
  const runRemoteArgv = /** @type {any} */ (jest.fn());
  return runRemoteArgv
    .mockResolvedValueOnce(
      createProcessOutcome({
        stdout: JSON.stringify(fixture.bootstrapIdentity),
      }),
    )
    .mockResolvedValueOnce(
      createProcessOutcome({
        stdout: JSON.stringify(createHealthySingleNodeServiceStatus(fixture)),
      }),
    )
    .mockResolvedValueOnce(applicationOutcome);
}

describe('single-node remote application execution', () => {
  it('re-proves exact active authority and returns the application outcome unchanged', async () => {
    const fixture = await createSingleNodeStatusAuthorityFixture();
    const journal = createSingleNodeStatusActiveJournal(fixture);
    const applicationOutcome = createProcessOutcome({
      exitCode: 23,
      stdout: 'application output',
      stderr: 'application failure',
    });
    const runRemoteArgv = successfulRun(fixture, applicationOutcome);
    const harness = makeHarness(fixture, runRemoteArgv);
    const currentRelease = /** @type {Readonly<Record<string, any>>} */ (
      getSingleNodeDeploymentCurrentRelease(journal)
    );
    const argv = [
      'workflow',
      'start',
      '--label',
      "literal '$HOME' $(touch /tmp/nope)\nnext",
    ];

    const result = await harness.executor.execute({
      journal,
      dataRoot: DATA_ROOT,
      argv,
    });

    expect(result).toBe(applicationOutcome);
    expect(harness.readIdentity).toHaveBeenCalledWith({
      dataRoot: DATA_ROOT,
      deploymentInstanceId: journal.deploymentInstanceId,
      incarnationId: journal.incarnationId,
    });
    expect(harness.readHostKey).toHaveBeenCalledWith({
      address: fixture.publicIpv4,
      knownHostsPath: fixture.sshIdentity.knownHostsPath,
    });
    expect(harness.createTransport).toHaveBeenCalledWith({
      address: fixture.publicIpv4,
      privateKeyPath: fixture.sshIdentity.privateKeyPath,
      knownHostsPath: fixture.sshIdentity.knownHostsPath,
    });
    expect(runRemoteArgv.mock.calls).toEqual([
      [
        {
          argv: ['/usr/bin/cat', '--', SINGLE_NODE_BOOTSTRAP_IDENTITY_PATH],
          stdin: null,
          timeoutMilliseconds: 20_000,
          maximumStdoutBytes: 16 * 1024,
          maximumStderrBytes: 8 * 1024,
        },
      ],
      [
        {
          argv: [
            currentRelease.activation.artifact.remotePath,
            'wharfie',
            'service',
            'status',
            '--json',
          ],
          stdin: null,
          timeoutMilliseconds: 2 * 60 * 1000,
          maximumStdoutBytes: 256 * 1024,
          maximumStderrBytes: 16 * 1024,
        },
      ],
      [
        {
          argv: [currentRelease.activation.artifact.remotePath, ...argv],
          stdin: null,
          timeoutMilliseconds: SINGLE_NODE_REMOTE_EXEC_TIMEOUT_MILLISECONDS,
          maximumStdoutBytes: SINGLE_NODE_REMOTE_EXEC_MAX_STDOUT_BYTES,
          maximumStderrBytes: SINGLE_NODE_REMOTE_EXEC_MAX_STDERR_BYTES,
        },
      ],
    ]);
  });

  it('preserves an exact ambiguous bounded application outcome', async () => {
    const fixture = await createSingleNodeStatusAuthorityFixture();
    const outcome = {
      status: /** @type {const} */ ('ambiguous'),
      exitCode: null,
      signal: 'SIGKILL',
      timedOut: true,
      stdout: Buffer.from('bounded prefix'),
      stderr: Buffer.alloc(0),
    };
    const harness = makeHarness(fixture, successfulRun(fixture, outcome));

    await expect(
      harness.executor.execute({
        journal: createSingleNodeStatusActiveJournal(fixture),
        dataRoot: DATA_ROOT,
        argv: [],
      }),
    ).resolves.toBe(outcome);
  });

  it('refuses execution when the guest advanced before update settlement', async () => {
    const fixture = await createSingleNodeStatusAuthorityFixture();
    const target = createSingleNodeStatusUpdateTarget(fixture, 'exec-v2');
    const journal = prepareSingleNodeDeploymentReleaseUpdate(
      createSingleNodeStatusActiveJournal(fixture),
      target.desired,
    );
    const targetStatus = createHealthySingleNodeServiceStatus({
      ...fixture,
      desired: target.desired,
    });
    const runRemoteArgv = /** @type {any} */ (jest.fn())
      .mockResolvedValueOnce(
        createProcessOutcome({
          stdout: JSON.stringify(fixture.bootstrapIdentity),
        }),
      )
      .mockResolvedValueOnce(
        createProcessOutcome({ stdout: JSON.stringify(targetStatus) }),
      );
    const harness = makeHarness(fixture, runRemoteArgv);

    await expect(
      harness.executor.execute({
        journal,
        dataRoot: DATA_ROOT,
        argv: ['workflow', 'list'],
      }),
    ).rejects.toThrow(/not the exact healthy active release/i);
    expect(runRemoteArgv).toHaveBeenCalledTimes(2);
  });

  it('rejects non-active state before opening SSH authority', async () => {
    const fixture = await createSingleNodeStatusAuthorityFixture();
    const runRemoteArgv = jest.fn();
    const harness = makeHarness(fixture, runRemoteArgv);

    await expect(
      harness.executor.execute({
        journal: createSingleNodeStatusActivatingJournal(fixture),
        dataRoot: DATA_ROOT,
        argv: ['workflow', 'list'],
      }),
    ).rejects.toThrow(/requires an active deployment/i);
    expect(harness.readIdentity).not.toHaveBeenCalled();
    expect(harness.readHostKey).not.toHaveBeenCalled();
    expect(harness.createTransport).not.toHaveBeenCalled();
    expect(runRemoteArgv).not.toHaveBeenCalled();
  });

  it.each([
    ['non-array', 'workflow'],
    [
      'too many',
      Array.from(
        { length: DEPLOYMENT_OPENSSH_MAX_REMOTE_ARGUMENTS },
        () => 'argument',
      ),
    ],
    ['NUL', ['workflow', 'bad\0argument']],
  ])(
    'rejects %s application argv before reading identity',
    async (_name, argv) => {
      const fixture = await createSingleNodeStatusAuthorityFixture();
      const harness = makeHarness(fixture, jest.fn());

      await expect(
        harness.executor.execute({
          journal: createSingleNodeStatusActiveJournal(fixture),
          dataRoot: DATA_ROOT,
          argv,
        }),
      ).rejects.toThrow(/argv|argument/i);
      expect(harness.readIdentity).not.toHaveBeenCalled();
    },
  );

  it('does not invoke an argv accessor or reveal its value', async () => {
    const fixture = await createSingleNodeStatusAuthorityFixture();
    const harness = makeHarness(fixture, jest.fn());
    const getter = jest.fn(() => 'private application argument');
    const argv = /** @type {string[]} */ ([]);
    Object.defineProperty(argv, '0', {
      enumerable: true,
      configurable: true,
      get: getter,
    });
    Object.defineProperty(argv, 'length', { value: 1 });

    await expect(
      harness.executor.execute({
        journal: createSingleNodeStatusActiveJournal(fixture),
        dataRoot: DATA_ROOT,
        argv,
      }),
    ).rejects.not.toThrow('private application argument');
    expect(getter).not.toHaveBeenCalled();
    expect(harness.readIdentity).not.toHaveBeenCalled();
  });

  it('rejects a locally valid identity that conflicts with cloud-init authority', async () => {
    const fixture = await createSingleNodeStatusAuthorityFixture();
    const otherKey = publicKey(8);
    const readIdentity = jest.fn(async () => ({
      ...fixture.sshIdentity,
      publicKey: otherKey,
      publicKeyFingerprint: publicKeyFingerprint(otherKey),
    }));
    const harness = makeHarness(fixture, jest.fn(), { readIdentity });

    await expect(
      harness.executor.execute({
        journal: createSingleNodeStatusActiveJournal(fixture),
        dataRoot: DATA_ROOT,
        argv: [],
      }),
    ).rejects.toThrow(/cloud-init authority/i);
    expect(harness.readHostKey).not.toHaveBeenCalled();
    expect(harness.createTransport).not.toHaveBeenCalled();
  });

  it('rejects a host key conflict before constructing transport', async () => {
    const fixture = await createSingleNodeStatusAuthorityFixture();
    const readHostKey = jest.fn(async () => ({
      address: fixture.publicIpv4,
      algorithm: 'ssh-ed25519',
      fingerprint: `SHA256:${Buffer.alloc(32, 99)
        .toString('base64')
        .replace(/=+$/u, '')}`,
    }));
    const harness = makeHarness(fixture, jest.fn(), { readHostKey });

    await expect(
      harness.executor.execute({
        journal: createSingleNodeStatusActiveJournal(fixture),
        dataRoot: DATA_ROOT,
        argv: [],
      }),
    ).rejects.toThrow(/host key conflicts/i);
    expect(harness.createTransport).not.toHaveBeenCalled();
  });

  it.each([
    ['nonzero bootstrap', 'bootstrap', createProcessOutcome({ exitCode: 1 })],
    [
      'wrong bootstrap',
      'bootstrap',
      createProcessOutcome({ stdout: JSON.stringify({ wrong: true }) }),
    ],
    ['nonzero service', 'service', createProcessOutcome({ exitCode: 1 })],
    [
      'unhealthy service',
      'service',
      createProcessOutcome({
        stdout: JSON.stringify({
          schemaVersion: 3,
          kind: 'wharfie.service.status',
          health: 'failed',
        }),
      }),
    ],
  ])(
    'rejects %s evidence before application execution',
    async (_name, stage, badOutcome) => {
      const fixture = await createSingleNodeStatusAuthorityFixture();
      const runRemoteArgv = /** @type {any} */ (
        jest.fn()
      ).mockResolvedValueOnce(
        stage === 'bootstrap'
          ? badOutcome
          : createProcessOutcome({
              stdout: JSON.stringify(fixture.bootstrapIdentity),
            }),
      );
      if (stage === 'service') runRemoteArgv.mockResolvedValueOnce(badOutcome);
      const harness = makeHarness(fixture, runRemoteArgv);

      await expect(
        harness.executor.execute({
          journal: createSingleNodeStatusActiveJournal(fixture),
          dataRoot: DATA_ROOT,
          argv: ['workflow', 'list'],
        }),
      ).rejects.toThrow(/bootstrap|service/i);
      expect(runRemoteArgv).toHaveBeenCalledTimes(
        stage === 'bootstrap' ? 1 : 2,
      );
    },
  );

  it('rejects an unbounded or malformed application outcome', async () => {
    const fixture = await createSingleNodeStatusAuthorityFixture();
    const oversized = createProcessOutcome({
      stdout: Buffer.alloc(SINGLE_NODE_REMOTE_EXEC_MAX_STDOUT_BYTES + 1),
    });
    const harness = makeHarness(fixture, successfulRun(fixture, oversized));

    await expect(
      harness.executor.execute({
        journal: createSingleNodeStatusActiveJournal(fixture),
        dataRoot: DATA_ROOT,
        argv: [],
      }),
    ).rejects.toThrow(/bounded outcome/i);
  });

  it('closes dependency and request shapes', async () => {
    expect(() =>
      createSingleNodeRemoteExecutor({
        readIdentity: jest.fn(),
        readHostKey: jest.fn(),
        createTransport: jest.fn(),
        providerApi: {},
      }),
    ).toThrow(/dependencies.*fields/i);

    const fixture = await createSingleNodeStatusAuthorityFixture();
    const harness = makeHarness(fixture, jest.fn());
    await expect(
      harness.executor.execute({
        journal: createSingleNodeStatusActiveJournal(fixture),
        dataRoot: DATA_ROOT,
        argv: [],
        executable: '/bin/sh',
      }),
    ).rejects.toThrow(/fields/i);
    expect(harness.readIdentity).not.toHaveBeenCalled();
  });
});
