import { describe, expect, it, jest } from '@jest/globals';

import { sha256Base64Url } from '../../src/core/runtime/content-id.js';
import {
  SINGLE_NODE_BOOTSTRAP_IDENTITY_PATH,
  SINGLE_NODE_DEPLOYMENT_ROOT,
} from '../../src/core/runtime/single-node-cloud-init.js';
import { createSingleNodeRemoteStatusInspector } from '../../src/core/runtime/single-node-remote-status.js';
import {
  createHealthySingleNodeServiceStatus,
  createProcessOutcome,
  createSingleNodeStatusActiveJournal,
  createSingleNodeStatusActivatingJournal,
  createSingleNodeStatusAuthorityFixture,
  createSingleNodeStatusDestroyedJournal,
  createSingleNodeStatusInitialJournal,
} from './fixtures/single-node-status-fixture.js';

const DATA_ROOT = '/private/status-data';

function createRemoteRun() {
  return jest.fn(async (/** @type {Record<string, any>} */ _request) =>
    createProcessOutcome(),
  );
}

/**
 * @param {Awaited<ReturnType<typeof createSingleNodeStatusAuthorityFixture>>} fixture
 * @param {ReturnType<typeof createRemoteRun>} runRemoteArgv
 * @param {Partial<{readIdentity: ReturnType<typeof jest.fn>, readHostKey: ReturnType<typeof jest.fn>, createTransport: ReturnType<typeof jest.fn>}>} [overrides]
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
    inspector: createSingleNodeRemoteStatusInspector({
      readIdentity,
      readHostKey,
      createTransport,
    }),
  };
}

/**
 * @param {ReturnType<typeof createHealthySingleNodeServiceStatus>} status
 * @param {{artifactId: string, revisionId: string}} release
 */
function replaceRelease(status, release) {
  status.installation.activeArtifactId = release.artifactId;
  status.installation.activeRevisionId = release.revisionId;
  status.runtime.artifactId = release.artifactId;
  status.runtime.revisionId = release.revisionId;
  status.activation.selected = { ...release };
  status.integrity.artifactId = release.artifactId;
  status.integrity.revisionId = release.revisionId;
  return status;
}

describe('single-node remote status inspection', () => {
  it('returns destroyed and not-ready observations without opening SSH authority', async () => {
    const fixture = await createSingleNodeStatusAuthorityFixture();
    const runRemoteArgv = createRemoteRun();
    const harness = makeHarness(fixture, runRemoteArgv);

    await expect(
      harness.inspector.inspect({
        journal: createSingleNodeStatusDestroyedJournal(fixture),
        dataRoot: DATA_ROOT,
      }),
    ).resolves.toEqual({
      state: 'not-applicable',
      address: null,
      hostKeyFingerprint: null,
      service: null,
    });
    await expect(
      harness.inspector.inspect({
        journal: createSingleNodeStatusInitialJournal(fixture),
        dataRoot: DATA_ROOT,
      }),
    ).resolves.toEqual({
      state: 'not-ready',
      address: null,
      hostKeyFingerprint: null,
      service: null,
    });
    expect(harness.readIdentity).not.toHaveBeenCalled();
    expect(harness.readHostKey).not.toHaveBeenCalled();
    expect(harness.createTransport).not.toHaveBeenCalled();
    expect(runRemoteArgv).not.toHaveBeenCalled();
  });

  it('reads exact pinned authority and projects a healthy active service', async () => {
    const fixture = await createSingleNodeStatusAuthorityFixture();
    const journal = createSingleNodeStatusActiveJournal(fixture);
    const serviceStatus = createHealthySingleNodeServiceStatus(fixture);
    const runRemoteArgv = createRemoteRun()
      .mockResolvedValueOnce(
        createProcessOutcome({
          stdout: JSON.stringify(fixture.bootstrapIdentity),
        }),
      )
      .mockResolvedValueOnce(
        createProcessOutcome({ stdout: JSON.stringify(serviceStatus) }),
      );
    const harness = makeHarness(fixture, runRemoteArgv);

    const result = await harness.inspector.inspect({
      journal,
      dataRoot: DATA_ROOT,
    });

    expect(result).toEqual({
      state: 'observed',
      address: fixture.publicIpv4,
      hostKeyFingerprint: fixture.hostKeyFingerprint,
      service: {
        health: 'healthy',
        activeArtifactId: fixture.desired.artifact.artifactId,
        activeRevisionId: fixture.desired.artifact.revisionId,
        desiredMatches: true,
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.service)).toBe(true);
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
            journal.artifact.remotePath,
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
    ]);
  });

  it('detects healthy activation effects before artifact evidence reaches the journal', async () => {
    const fixture = await createSingleNodeStatusAuthorityFixture();
    const journal = createSingleNodeStatusActivatingJournal(fixture);
    const serviceStatus = createHealthySingleNodeServiceStatus(fixture);
    const runRemoteArgv = createRemoteRun()
      .mockResolvedValueOnce(
        createProcessOutcome({
          stdout: JSON.stringify(fixture.bootstrapIdentity),
        }),
      )
      .mockResolvedValueOnce(
        createProcessOutcome({ stdout: JSON.stringify(serviceStatus) }),
      );
    const harness = makeHarness(fixture, runRemoteArgv);

    expect(journal.artifact).toBeNull();
    await expect(
      harness.inspector.inspect({ journal, dataRoot: DATA_ROOT }),
    ).resolves.toMatchObject({
      state: 'observed',
      service: { health: 'healthy', desiredMatches: true },
    });
    expect(runRemoteArgv.mock.calls[1][0].argv[0]).toBe(
      `${SINGLE_NODE_DEPLOYMENT_ROOT}/${journal.deploymentInstanceId}/artifacts/${journal.desired.artifact.artifactId}/app-sea`,
    );
  });

  it.each(['identity', 'host-address', 'host-fingerprint'])(
    'rejects a durable %s mismatch before constructing transport',
    async (mismatch) => {
      const fixture = await createSingleNodeStatusAuthorityFixture();
      const runRemoteArgv = createRemoteRun();
      const otherFingerprint = `SHA256:${Buffer.alloc(32, 99)
        .toString('base64')
        .replace(/=+$/u, '')}`;
      const readIdentity = jest.fn(async () => ({
        ...fixture.sshIdentity,
        ...(mismatch === 'identity'
          ? { publicKeyFingerprint: otherFingerprint }
          : {}),
      }));
      const readHostKey = jest.fn(async () => ({
        address:
          mismatch === 'host-address' ? '192.0.2.99' : fixture.publicIpv4,
        algorithm: 'ssh-ed25519',
        fingerprint:
          mismatch === 'host-fingerprint'
            ? otherFingerprint
            : fixture.hostKeyFingerprint,
      }));
      const harness = makeHarness(fixture, runRemoteArgv, {
        readIdentity,
        readHostKey,
      });

      await expect(
        harness.inspector.inspect({
          journal: createSingleNodeStatusActiveJournal(fixture),
          dataRoot: DATA_ROOT,
        }),
      ).resolves.toEqual({
        state: 'invalid',
        address: fixture.publicIpv4,
        hostKeyFingerprint: fixture.hostKeyFingerprint,
        service: null,
      });
      if (mismatch === 'identity') {
        expect(readHostKey).not.toHaveBeenCalled();
      }
      expect(harness.createTransport).not.toHaveBeenCalled();
      expect(runRemoteArgv).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['bootstrap throw', 'bootstrap', 'throw'],
    ['bootstrap nonzero', 'bootstrap', 'nonzero'],
    ['service throw', 'service', 'throw'],
    ['service nonzero', 'service', 'nonzero'],
  ])('maps %s to unreachable', async (_name, stage, failure) => {
    const fixture = await createSingleNodeStatusAuthorityFixture();
    const serviceStatus = createHealthySingleNodeServiceStatus(fixture);
    const runRemoteArgv = jest.fn(
      async (/** @type {Record<string, any>} */ request) => {
        const bootstrap =
          request.argv[0] === '/usr/bin/cat' &&
          request.argv[2] === SINGLE_NODE_BOOTSTRAP_IDENTITY_PATH;
        if (
          (stage === 'bootstrap' && bootstrap) ||
          (stage === 'service' && !bootstrap)
        ) {
          if (failure === 'throw') throw new Error('transport failed');
          return createProcessOutcome({ exitCode: 23 });
        }
        return createProcessOutcome({
          stdout: JSON.stringify(
            bootstrap ? fixture.bootstrapIdentity : serviceStatus,
          ),
        });
      },
    );
    const harness = makeHarness(fixture, runRemoteArgv);

    await expect(
      harness.inspector.inspect({
        journal: createSingleNodeStatusActiveJournal(fixture),
        dataRoot: DATA_ROOT,
      }),
    ).resolves.toEqual({
      state: 'unreachable',
      address: fixture.publicIpv4,
      hostKeyFingerprint: fixture.hostKeyFingerprint,
      service: null,
    });
    expect(runRemoteArgv).toHaveBeenCalledTimes(stage === 'bootstrap' ? 1 : 2);
  });

  it.each([
    ['bootstrap JSON', 'bootstrap', '{'],
    ['service JSON', 'service', '{'],
    [
      'service identity',
      'service',
      JSON.stringify({ schemaVersion: 3, kind: 'foreign.service.status' }),
    ],
  ])('maps invalid %s to invalid', async (_name, stage, invalidOutput) => {
    const fixture = await createSingleNodeStatusAuthorityFixture();
    const runRemoteArgv = jest.fn(
      async (/** @type {Record<string, any>} */ request) => {
        const bootstrap = request.argv[0] === '/usr/bin/cat';
        return createProcessOutcome({
          stdout:
            (stage === 'bootstrap' && bootstrap) ||
            (stage === 'service' && !bootstrap)
              ? invalidOutput
              : JSON.stringify(
                  bootstrap
                    ? fixture.bootstrapIdentity
                    : createHealthySingleNodeServiceStatus(fixture),
                ),
        });
      },
    );
    const harness = makeHarness(fixture, runRemoteArgv);

    await expect(
      harness.inspector.inspect({
        journal: createSingleNodeStatusActiveJournal(fixture),
        dataRoot: DATA_ROOT,
      }),
    ).resolves.toEqual({
      state: 'invalid',
      address: fixture.publicIpv4,
      hostKeyFingerprint: fixture.hostKeyFingerprint,
      service: null,
    });
  });

  it.each([
    [
      'schema',
      (/** @type {Record<string, any>} */ status) => (status.schemaVersion = 2),
    ],
    [
      'app',
      (/** @type {Record<string, any>} */ status) =>
        (status.appId = 'other-app'),
    ],
    [
      'unit',
      (/** @type {Record<string, any>} */ status) =>
        (status.unit = 'wharfie-other-app.service'),
    ],
    [
      'artifact ID',
      (/** @type {Record<string, any>} */ status) =>
        (status.installation.activeArtifactId = 'not-an-artifact-id'),
    ],
    [
      'revision ID',
      (/** @type {Record<string, any>} */ status) =>
        (status.installation.activeRevisionId = 'not-a-revision-id'),
    ],
  ])('maps a mismatched service %s to invalid', async (_name, mutate) => {
    const fixture = await createSingleNodeStatusAuthorityFixture();
    const status = createHealthySingleNodeServiceStatus(fixture);
    mutate(status);
    const runRemoteArgv = createRemoteRun()
      .mockResolvedValueOnce(
        createProcessOutcome({
          stdout: JSON.stringify(fixture.bootstrapIdentity),
        }),
      )
      .mockResolvedValueOnce(
        createProcessOutcome({ stdout: JSON.stringify(status) }),
      );
    const harness = makeHarness(fixture, runRemoteArgv);

    await expect(
      harness.inspector.inspect({
        journal: createSingleNodeStatusActiveJournal(fixture),
        dataRoot: DATA_ROOT,
      }),
    ).resolves.toEqual({
      state: 'invalid',
      address: fixture.publicIpv4,
      hostKeyFingerprint: fixture.hostKeyFingerprint,
      service: null,
    });
  });

  it('observes a valid old release without claiming it matches desired', async () => {
    const fixture = await createSingleNodeStatusAuthorityFixture();
    const oldRelease = {
      artifactId: `waf1_${sha256Base64Url('old-artifact')}`,
      revisionId: `wrv1_${sha256Base64Url('old-revision')}`,
    };
    const status = replaceRelease(
      createHealthySingleNodeServiceStatus(fixture),
      oldRelease,
    );
    const runRemoteArgv = createRemoteRun()
      .mockResolvedValueOnce(
        createProcessOutcome({
          stdout: JSON.stringify(fixture.bootstrapIdentity),
        }),
      )
      .mockResolvedValueOnce(
        createProcessOutcome({ stdout: JSON.stringify(status) }),
      );
    const harness = makeHarness(fixture, runRemoteArgv);

    await expect(
      harness.inspector.inspect({
        journal: createSingleNodeStatusActiveJournal(fixture),
        dataRoot: DATA_ROOT,
      }),
    ).resolves.toEqual({
      state: 'observed',
      address: fixture.publicIpv4,
      hostKeyFingerprint: fixture.hostKeyFingerprint,
      service: {
        health: 'healthy',
        activeArtifactId: oldRelease.artifactId,
        activeRevisionId: oldRelease.revisionId,
        desiredMatches: false,
      },
    });
  });

  it.each(['degraded', 'failed'])(
    'observes a valid desired release with %s health',
    async (health) => {
      const fixture = await createSingleNodeStatusAuthorityFixture();
      const status = createHealthySingleNodeServiceStatus(fixture, { health });
      const runRemoteArgv = createRemoteRun()
        .mockResolvedValueOnce(
          createProcessOutcome({
            stdout: JSON.stringify(fixture.bootstrapIdentity),
          }),
        )
        .mockResolvedValueOnce(
          createProcessOutcome({ stdout: JSON.stringify(status) }),
        );
      const harness = makeHarness(fixture, runRemoteArgv);

      await expect(
        harness.inspector.inspect({
          journal: createSingleNodeStatusActiveJournal(fixture),
          dataRoot: DATA_ROOT,
        }),
      ).resolves.toEqual({
        state: 'observed',
        address: fixture.publicIpv4,
        hostKeyFingerprint: fixture.hostKeyFingerprint,
        service: {
          health,
          activeArtifactId: fixture.desired.artifact.artifactId,
          activeRevisionId: fixture.desired.artifact.revisionId,
          desiredMatches: true,
        },
      });
    },
  );

  it.each([
    ['unknown', null],
    ['conflict', null],
    ['authorized', 'durable-install'],
  ])(
    'refuses healthy service evidence with %s/%s convergence authority',
    async (disposition, basis) => {
      const fixture = await createSingleNodeStatusAuthorityFixture();
      const status = /** @type {Record<string, any>} */ (
        createHealthySingleNodeServiceStatus(fixture)
      );
      status.desiredConvergence = {
        ...status.desiredConvergence,
        disposition,
        basis,
      };
      const runRemoteArgv = createRemoteRun()
        .mockResolvedValueOnce(
          createProcessOutcome({
            stdout: JSON.stringify(fixture.bootstrapIdentity),
          }),
        )
        .mockResolvedValueOnce(
          createProcessOutcome({ stdout: JSON.stringify(status) }),
        );
      const harness = makeHarness(fixture, runRemoteArgv);

      await expect(
        harness.inspector.inspect({
          journal: createSingleNodeStatusActiveJournal(fixture),
          dataRoot: DATA_ROOT,
        }),
      ).resolves.toEqual({
        state: 'invalid',
        address: fixture.publicIpv4,
        hostKeyFingerprint: fixture.hostKeyFingerprint,
        service: null,
      });
    },
  );
});
