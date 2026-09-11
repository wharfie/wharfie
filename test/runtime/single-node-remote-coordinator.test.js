import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { createControlDBClient } from '../../src/core/lib/config/db.js';
import {
  CoordinatorAuthorityStatus,
  createCoordinatorAuthority,
  createCoordinatorAuthorityToken,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import { sortCanonicalJsonValue } from '../../src/core/runtime/canonical-order.js';
import { SINGLE_NODE_BOOTSTRAP_IDENTITY_PATH } from '../../src/core/runtime/single-node-cloud-init.js';
import {
  getSingleNodeDeploymentCurrentRelease,
  prepareSingleNodeDeploymentReleaseUpdate,
} from '../../src/core/runtime/single-node-deployment-journal.js';
import { createSingleNodeRemoteExecutor } from '../../src/core/runtime/single-node-remote-exec.js';
import {
  createCoordinatorAuthorityInspectionDocument,
  inspectCoordinatorAuthority,
  takeoverCoordinatorAuthority,
} from '../../src/core/runtime/operator/coordinator-authority-command.js';
import {
  createHealthySingleNodeServiceStatus,
  createProcessOutcome,
  createSingleNodeStatusActiveJournal,
  createSingleNodeStatusActivatingJournal,
  createSingleNodeStatusAuthorityFixture,
  createSingleNodeStatusUpdateTarget,
} from './fixtures/single-node-status-fixture.js';

const DATA_ROOT = '/private/remote-coordinator-data';
const TABLE_NAME = 'execution-ledger';
const SUCCESSOR_ID = 'remote-operator-successor';
const REQUEST_ID = 'remote-operator-takeover';
// The replay case performs several real filesystem syncs across reopened stores.
jest.setTimeout(30_000);
/** @type {Buffer} */
let initialDatabase;
/** @type {import('../../src/core/lib/db/tables/coordinator-authority.js').CoordinatorAuthoritySnapshot} */
let initialAuthority;

beforeAll(async () => {
  const fixture = await createSingleNodeStatusAuthorityFixture();
  const root = mkdtempSync(path.join(os.tmpdir(), 'wharfie-coordinator-seed-'));
  const db = await createControlDBClient('vanilla', { path: root });
  try {
    initialAuthority = (
      await createCoordinatorAuthority({ db, tableName: TABLE_NAME }).acquire({
        appId: fixture.desired.intent.appId,
        coordinatorId: 'dead-resident',
        requestId: 'dead-resident-acquire',
        observedAt: 10,
      })
    ).authority;
    await db.close();
    initialDatabase = readFileSync(path.join(root, 'database.json'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** @type {string[]} */
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Seed an abandoned ACTIVE predecessor in a real deterministic control store.
 * Only transport and host observations are doubled; takeover and replay use
 * the production authority protocol and persisted vanilla adapter.
 */
async function createHarness() {
  const fixture = await createSingleNodeStatusAuthorityFixture();
  const journal = createSingleNodeStatusActiveJournal(fixture);
  const current = getSingleNodeDeploymentCurrentRelease(journal);
  if (current === null) throw new Error('Missing current release fixture.');
  const appId = fixture.desired.intent.appId;
  const root = mkdtempSync(
    path.join(os.tmpdir(), 'wharfie-remote-coordinator-'),
  );
  roots.push(root);
  writeFileSync(path.join(root, 'database.json'), initialDatabase);
  const configuration = Object.freeze({
    adapterName: 'vanilla',
    controlPath: root,
    tableName: TABLE_NAME,
    payloadPath: path.join(root, 'payloads'),
    payloadStoreId: 'remote-coordinator-payloads',
    sessionPath: path.join(root, 'sessions'),
  });
  /**
   * @template T
   * @param {(store: ReturnType<typeof createCoordinatorAuthority>) => Promise<T>} operation
   * @returns {Promise<T>}
   */
  async function withStore(operation) {
    const db = await createControlDBClient('vanilla', { path: root });
    try {
      return await operation(
        createCoordinatorAuthority({ db, tableName: TABLE_NAME }),
      );
    } finally {
      await db.close();
    }
  }
  const predecessor = initialAuthority;
  const inspection = createCoordinatorAuthorityInspectionDocument(
    appId,
    predecessor,
  );
  const healthyStatus = createHealthySingleNodeServiceStatus(fixture);
  const state = {
    serviceStatus: createHealthySingleNodeServiceStatus(fixture, {
      health: 'failed',
      systemd: {
        ...healthyStatus.systemd,
        activeState: 'failed',
        subState: 'failed',
        result: 'failed',
      },
      runtime: {
        ...healthyStatus.runtime,
        status: 'STARTING',
        session: 'absent',
        currentOwner: false,
      },
    }),
    bootstrapIdentity: fixture.bootstrapIdentity,
    hostFingerprint: fixture.hostKeyFingerprint,
    loseTakeoverReply: false,
    /** @type {Record<string, any> | undefined} */
    overrideCoordinatorResult: undefined,
    /** @type {import('../../src/core/runtime/bounded-process.js').BoundedProcessOutcome | undefined} */
    overrideCoordinatorOutcome: undefined,
  };
  const coordinatorCalls = jest.fn(
    async (/** @type {Record<string, any>} */ request) => {
      if (state.overrideCoordinatorOutcome)
        return state.overrideCoordinatorOutcome;
      let result;
      if (request.argv[3] === 'inspect') {
        expect(request.argv).toEqual([
          current.activation.artifact.remotePath,
          'wharfie',
          'coordinator',
          'inspect',
          '--json',
        ]);
        expect(request.stdin).toBeNull();
        result = await inspectCoordinatorAuthority({ appId, configuration });
      } else {
        expect(request.argv).toEqual([
          current.activation.artifact.remotePath,
          'wharfie',
          'coordinator',
          'takeover',
          '--inspection-stdin',
          '--coordinator-id',
          SUCCESSOR_ID,
          '--request-id',
          REQUEST_ID,
          '--confirm-authority-replacement',
          '--json',
        ]);
        expect(Buffer.isBuffer(request.stdin)).toBe(true);
        const transported = JSON.parse(request.stdin.toString('utf8'));
        expect(transported).toEqual(inspection);
        expect(request.stdin.toString('utf8').trim()).toBe(
          JSON.stringify(sortCanonicalJsonValue(inspection)),
        );
        result = await takeoverCoordinatorAuthority({
          appId,
          configuration,
          inspection: transported,
          coordinatorId: SUCCESSOR_ID,
          requestId: REQUEST_ID,
          confirmAuthorityReplacement: true,
        });
        if (state.loseTakeoverReply) {
          state.loseTakeoverReply = false;
          return {
            status: /** @type {const} */ ('ambiguous'),
            exitCode: null,
            signal: null,
            timedOut: true,
            stdout: Buffer.alloc(0),
            stderr: Buffer.alloc(0),
          };
        }
      }
      return createProcessOutcome({
        stdout: JSON.stringify(state.overrideCoordinatorResult ?? result),
      });
    },
  );
  const runRemoteArgv = jest.fn(
    async (/** @type {Record<string, any>} */ request) => {
      if (request.argv[0] === '/usr/bin/cat') {
        expect(request.argv).toEqual([
          '/usr/bin/cat',
          '--',
          SINGLE_NODE_BOOTSTRAP_IDENTITY_PATH,
        ]);
        return createProcessOutcome({
          stdout: JSON.stringify(state.bootstrapIdentity),
        });
      }
      if (request.argv[2] === 'service') {
        expect(request.argv).toEqual([
          current.activation.artifact.remotePath,
          'wharfie',
          'service',
          'status',
          '--json',
        ]);
        return createProcessOutcome({
          stdout: JSON.stringify(state.serviceStatus),
        });
      }
      return coordinatorCalls(request);
    },
  );
  const readIdentity = jest.fn(
    /** @type {(input: unknown) => Promise<typeof fixture.sshIdentity>} */ (
      async () => fixture.sshIdentity
    ),
  );
  const readHostKey = jest.fn(async () => ({
    address: fixture.publicIpv4,
    algorithm: 'ssh-ed25519',
    fingerprint: state.hostFingerprint,
  }));
  const createTransport = jest.fn(
    /** @type {(input: unknown) => {runRemoteArgv: typeof runRemoteArgv}} */ (
      () => ({ runRemoteArgv })
    ),
  );
  const executor = createSingleNodeRemoteExecutor({
    readIdentity,
    readHostKey,
    createTransport,
  });
  const input = { journal, dataRoot: DATA_ROOT };
  const takeoverInput = {
    ...input,
    inspection,
    coordinatorId: SUCCESSOR_ID,
    requestId: REQUEST_ID,
    confirmAuthorityReplacement: true,
  };
  return {
    fixture,
    appId,
    journal,
    current,
    state,
    predecessor,
    inspection,
    healthyStatus,
    withStore,
    executor,
    input,
    takeoverInput,
    readIdentity,
    readHostKey,
    createTransport,
    runRemoteArgv,
    coordinatorCalls,
  };
}

describe('remote coordinator recovery from committed release authority', () => {
  it('inspects an abandoned coordinator despite failed service liveness, without changing authority', async () => {
    const harness = await createHarness();
    const result = await harness.executor.inspectCoordinator(harness.input);
    expect(result).toEqual(harness.inspection);
    expect(harness.runRemoteArgv).toHaveBeenCalledTimes(3);
    expect(harness.coordinatorCalls).toHaveBeenCalledTimes(1);
    expect(
      await harness.withStore((store) => store.get({ appId: harness.appId })),
    ).toEqual(harness.predecessor);
    expect(harness.readIdentity).toHaveBeenCalledWith({
      dataRoot: DATA_ROOT,
      deploymentInstanceId: harness.journal.deploymentInstanceId,
      incarnationId: harness.journal.incarnationId,
    });
    expect(harness.createTransport).toHaveBeenCalledWith({
      address: harness.fixture.publicIpv4,
      privateKeyPath: harness.fixture.sshIdentity.privateKeyPath,
      knownHostsPath: harness.fixture.sshIdentity.knownHostsPath,
    });
  });

  it('keeps ordinary application execution blocked by the same failed service', async () => {
    const harness = await createHarness();
    await expect(
      harness.executor.execute({
        ...harness.input,
        argv: ['run', 'business-work'],
      }),
    ).rejects.toThrow(/healthy active release/);
    expect(harness.runRemoteArgv).toHaveBeenCalledTimes(2);
    expect(harness.coordinatorCalls).not.toHaveBeenCalled();
  });

  it('fences and releases the exact predecessor, then replays a lost reply without replacing a healthy new resident', async () => {
    const harness = await createHarness();
    harness.state.loseTakeoverReply = true;
    await expect(
      harness.executor.takeoverCoordinator(harness.takeoverInput),
    ).rejects.toThrow(/retry the same inspection and request IDs/i);
    const released = await harness.withStore((store) =>
      store.get({ appId: harness.appId }),
    );
    expect(released).toMatchObject({
      coordinatorId: SUCCESSOR_ID,
      epoch: harness.predecessor.epoch + 1,
      status: CoordinatorAuthorityStatus.RELEASED,
    });
    const replay = await harness.executor.takeoverCoordinator(
      harness.takeoverInput,
    );
    expect(replay).toMatchObject({
      action: 'takeover-and-release',
      applied: false,
      observedAuthority: harness.predecessor,
      resultAuthority: released,
    });
    const fresh = await harness.withStore(
      async (store) =>
        (
          await store.acquire({
            appId: harness.appId,
            coordinatorId: 'healthy-new-resident',
            requestId: 'healthy-new-resident-acquire',
          })
        ).authority,
    );
    harness.state.serviceStatus = harness.healthyStatus;
    await expect(
      harness.executor.takeoverCoordinator(harness.takeoverInput),
    ).resolves.toEqual(replay);
    expect(
      await harness.withStore((store) => store.get({ appId: harness.appId })),
    ).toEqual(fresh);
    await expect(
      harness.withStore((store) =>
        store.heartbeat({
          authority: createCoordinatorAuthorityToken(harness.predecessor),
          requestId: 'dead-resident-heartbeat',
        }),
      ),
    ).rejects.toThrow();
    await expect(
      harness.withStore((store) =>
        store.release({
          authority: createCoordinatorAuthorityToken(harness.predecessor),
          requestId: 'dead-resident-release',
        }),
      ),
    ).rejects.toThrow();
    expect(harness.coordinatorCalls).toHaveBeenCalledTimes(3);
    expect(
      harness.runRemoteArgv.mock.calls.every(
        ([request]) =>
          request.argv[2] !== 'service' || request.argv[3] === 'status',
      ),
    ).toBe(true);
  });

  it('requires confirmation before reading SSH authority or contacting the guest', async () => {
    const harness = await createHarness();
    await expect(
      harness.executor.takeoverCoordinator({
        ...harness.takeoverInput,
        confirmAuthorityReplacement: false,
      }),
    ).rejects.toThrow(/confirm/i);
    expect(harness.readIdentity).not.toHaveBeenCalled();
    expect(harness.readHostKey).not.toHaveBeenCalled();
    expect(harness.createTransport).not.toHaveBeenCalled();
  });

  it('rejects a stale inspection at the real authority boundary without fencing its replacement', async () => {
    const harness = await createHarness();
    const replacement = await harness.withStore(
      async (store) =>
        (
          await store.takeover({
            appId: harness.appId,
            coordinatorId: 'other-operator',
            requestId: 'other-takeover',
            observedAuthority: harness.predecessor,
            confirmAuthorityReplacement: true,
          })
        ).authority,
    );
    await expect(
      harness.executor.takeoverCoordinator(harness.takeoverInput),
    ).rejects.toThrow();
    expect(harness.coordinatorCalls).toHaveBeenCalledTimes(1);
    expect(
      await harness.withStore((store) => store.get({ appId: harness.appId })),
    ).toEqual(replacement);
  });

  it.each(['activating', 'update'])(
    'rejects %s deployment authority before SSH even if current guest status looks healthy',
    async (state) => {
      const harness = await createHarness();
      const journal =
        state === 'activating'
          ? createSingleNodeStatusActivatingJournal(harness.fixture)
          : prepareSingleNodeDeploymentReleaseUpdate(
              harness.journal,
              createSingleNodeStatusUpdateTarget(
                harness.fixture,
                'pending-update',
              ).desired,
            );
      harness.state.serviceStatus = harness.healthyStatus;
      await expect(
        harness.executor.inspectCoordinator({ ...harness.input, journal }),
      ).rejects.toThrow();
      await expect(
        harness.executor.takeoverCoordinator({
          ...harness.takeoverInput,
          journal,
        }),
      ).rejects.toThrow();
      expect(harness.readIdentity).not.toHaveBeenCalled();
      expect(harness.createTransport).not.toHaveBeenCalled();
    },
  );

  it.each(['installation', 'activation', 'integrity', 'convergence', 'wiring'])(
    'rejects conflicting %s evidence even when failed liveness is eligible for recovery',
    async (field) => {
      const harness = await createHarness();
      const status = clone(harness.state.serviceStatus);
      const other = createSingleNodeStatusUpdateTarget(
        harness.fixture,
        'wrong-guest-release',
      ).desired.artifact;
      if (field === 'installation')
        status.installation.activeArtifactId = other.artifactId;
      if (field === 'activation')
        status.activation.selected.artifactId = other.artifactId;
      if (field === 'integrity') status.integrity.status = 'invalid';
      if (field === 'convergence')
        status.desiredConvergence.disposition = 'conflict';
      if (field === 'wiring') status.wiring.effectiveUnit = 'conflicting';
      harness.state.serviceStatus = status;
      await expect(
        harness.executor.inspectCoordinator(harness.input),
      ).rejects.toThrow();
      await expect(
        harness.executor.takeoverCoordinator(harness.takeoverInput),
      ).rejects.toThrow();
      expect(harness.coordinatorCalls).not.toHaveBeenCalled();
    },
  );

  it.each(['bootstrap', 'host-key'])(
    'rejects changed %s before coordinator dispatch',
    async (field) => {
      const harness = await createHarness();
      if (field === 'bootstrap')
        harness.state.bootstrapIdentity = {
          ...harness.fixture.bootstrapIdentity,
          incarnationId: 'wrong-incarnation',
        };
      else
        harness.state.hostFingerprint = `SHA256:${Buffer.alloc(32, 99).toString('base64').replace(/=+$/u, '')}`;
      await expect(
        harness.executor.inspectCoordinator(harness.input),
      ).rejects.toThrow();
      expect(harness.coordinatorCalls).not.toHaveBeenCalled();
    },
  );

  it('rejects unknown request fields and foreign inspection scope before reading identity', async () => {
    const harness = await createHarness();
    await expect(
      harness.executor.inspectCoordinator({
        ...harness.input,
        executable: '/bin/sh',
      }),
    ).rejects.toThrow();
    await expect(
      harness.executor.takeoverCoordinator({
        ...harness.takeoverInput,
        provider: 'aws',
      }),
    ).rejects.toThrow();
    await expect(
      harness.executor.takeoverCoordinator({
        ...harness.takeoverInput,
        inspection: createCoordinatorAuthorityInspectionDocument(
          'foreign-app',
          null,
        ),
      }),
    ).rejects.toThrow();
    expect(harness.readIdentity).not.toHaveBeenCalled();
  });

  it('rejects foreign or malformed coordinator output instead of returning an unverified receipt', async () => {
    const harness = await createHarness();
    harness.state.overrideCoordinatorResult =
      createCoordinatorAuthorityInspectionDocument('foreign-app', null);
    await expect(
      harness.executor.inspectCoordinator(harness.input),
    ).rejects.toThrow();
    harness.state.overrideCoordinatorResult = { kind: 'unverified-takeover' };
    await expect(
      harness.executor.takeoverCoordinator(harness.takeoverInput),
    ).rejects.toThrow();
  });

  it('reports a definite exit with bounded terminal-safe stderr instead of presenting replay as its remedy', async () => {
    const harness = await createHarness();
    const stderr =
      'fatal remote refusal: \u001b[31m\u202erejected\n' +
      'x'.repeat(4096) +
      'OMITTED-STDERR-SUFFIX';
    harness.state.overrideCoordinatorOutcome = createProcessOutcome({
      exitCode: 23,
      stdout: JSON.stringify(harness.inspection),
      stderr,
    });
    const failure = await harness.executor
      .inspectCoordinator(harness.input)
      .catch((error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toMatch(
      /exit(?:ed)?(?: with)?(?: status| code)? 23/i,
    );
    expect(failure.message).toContain('fatal remote refusal:');
    expect(failure.message).toContain('\\u001b');
    expect(failure.message).toContain('\\u202e');
    expect(failure.message).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u);
    expect(failure.message).not.toContain('OMITTED-STDERR-SUFFIX');
    expect(Buffer.byteLength(failure.message)).toBeLessThan(4608);
    expect(failure.message).not.toMatch(
      /retry the same inspection and request IDs/i,
    );
    expect(harness.coordinatorCalls).toHaveBeenCalledTimes(1);
  });
});
