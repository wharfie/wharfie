import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import {
  COORDINATOR_AUTHORITY_ID_DOMAIN,
  COORDINATOR_AUTHORITY_ID_PREFIX,
  COORDINATOR_AUTHORITY_SCHEMA_VERSION,
  CoordinatorAuthorityStatus,
} from '../../../src/core/lib/db/tables/coordinator-authority.js';
import { createCanonicalJsonSha256Id } from '../../../src/core/runtime/content-id.js';
import {
  createCoordinatorAuthorityInspectionDocument,
  createCoordinatorAuthorityOperatorReleaseRequestId,
} from '../../../src/core/runtime/operator/coordinator-authority-command.js';
import { prepareSingleNodeDeploymentReleaseUpdate } from '../../../src/core/runtime/single-node-deployment-journal.js';
import { createPackagedDeploymentCommand } from '../../../src/core/resources/builds/actor-system-cli/control_cmds/deployment.js';
import {
  createSingleNodeStatusActiveJournal,
  createSingleNodeStatusAuthorityFixture,
  createSingleNodeStatusUpdateTarget,
} from '../../runtime/fixtures/single-node-status-fixture.js';

const DATA_ROOT = '/private/deployment-coordinator-cli';
const COORDINATOR_ID = 'operator-successor';
const REQUEST_ID = 'operator-takeover';
/** @type {Awaited<ReturnType<typeof createSingleNodeStatusAuthorityFixture>>} */
let fixture;

beforeAll(async () => {
  fixture = await createSingleNodeStatusAuthorityFixture();
});

/** @param {Record<string, any>} [overrides] */
function authority(overrides = {}) {
  const appId = fixture.desired.intent.appId;
  const epoch = overrides.epoch ?? 1;
  const coordinatorId = overrides.coordinatorId ?? 'dead-resident';
  const acquisitionRequestId = overrides.acquisitionRequestId ?? 'dead-acquire';
  const acquiredAt = overrides.acquiredAt ?? 10;
  return {
    schemaVersion: COORDINATOR_AUTHORITY_SCHEMA_VERSION,
    appId,
    coordinatorId,
    authorityId: createCanonicalJsonSha256Id({
      domain: COORDINATOR_AUTHORITY_ID_DOMAIN,
      prefix: COORDINATOR_AUTHORITY_ID_PREFIX,
      value: {
        schemaVersion: COORDINATOR_AUTHORITY_SCHEMA_VERSION,
        appId,
        coordinatorId,
        epoch,
        requestId: acquisitionRequestId,
      },
    }),
    epoch,
    status: CoordinatorAuthorityStatus.ACTIVE,
    recordVersion: 1,
    acquisitionRequestId,
    acquiredAt,
    heartbeatAt: acquiredAt,
    releasedAt: null,
    updatedAt: acquiredAt,
    lastRequestId: acquisitionRequestId,
    ...overrides,
  };
}

/** @param {string} appId */
function runtimeMetadata(appId) {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'artifactRuntime',
    appId,
    revisionId: fixture.revision.revisionId,
    target: fixture.artifactRecord.target,
  });
}

function createHarness() {
  const journal = createSingleNodeStatusActiveJournal(fixture);
  const predecessor = authority();
  const inspection = createCoordinatorAuthorityInspectionDocument(
    fixture.desired.intent.appId,
    predecessor,
  );
  const temporary = authority({
    epoch: 2,
    coordinatorId: COORDINATOR_ID,
    acquisitionRequestId: REQUEST_ID,
    recordVersion: 2,
    acquiredAt: 20,
  });
  const releaseRequestId = createCoordinatorAuthorityOperatorReleaseRequestId({
    appId: fixture.desired.intent.appId,
    coordinatorId: COORDINATOR_ID,
    requestId: REQUEST_ID,
  });
  const resultAuthority = {
    ...temporary,
    status: CoordinatorAuthorityStatus.RELEASED,
    recordVersion: 3,
    releasedAt: 30,
    updatedAt: 30,
    lastRequestId: releaseRequestId,
  };
  const receipt = {
    schemaVersion: 1,
    kind: 'wharfie.coordinator-authority.takeover',
    action: 'takeover-and-release',
    applied: true,
    scope: { appId: fixture.desired.intent.appId },
    releaseRequestId,
    observedAuthority: predecessor,
    takeoverAuthority: temporary,
    resultAuthority,
  };
  let locked = false;
  /** @type {string[]} */
  const events = [];
  const output = {
    json: jest.fn(),
    line: jest.fn(),
    failure: jest.fn(),
    stdout: jest.fn(),
    stderr: jest.fn(),
  };
  const processRef = {
    exitCode: /** @type {number | undefined} */ (undefined),
  };
  const readRevisionRuntimePair = jest.fn(async () => ({
    revision: fixture.revision,
    runtime: runtimeMetadata(fixture.desired.intent.appId),
  }));
  const readJournal = jest.fn(async () => {
    events.push(locked ? 'journal-locked' : 'journal-unlocked');
    return journal;
  });
  const createJournalStore = jest.fn(
    /** @type {(input: unknown) => {read: typeof readJournal}} */ (
      () => ({ read: readJournal })
    ),
  );
  const resolveDataRoot = jest.fn(() => DATA_ROOT);
  const readCoordinatorInspectionFile = jest.fn(
    /** @type {(filePath: unknown, label?: string) => Promise<typeof inspection>} */ (
      async () => {
        events.push('inspection-file');
        return inspection;
      }
    ),
  );
  const releaseLock = jest.fn(async () => {
    events.push('unlock');
    locked = false;
  });
  const acquireOperationLock = jest.fn(
    /** @type {(instanceId: unknown) => Promise<typeof releaseLock>} */ (
      async () => {
        events.push('lock');
        locked = true;
        return releaseLock;
      }
    ),
  );
  const inspectRemoteCoordinator = jest.fn(
    /** @type {(input: unknown) => Promise<typeof inspection>} */ (
      async () => {
        events.push('inspect-remote');
        return inspection;
      }
    ),
  );
  const takeoverRemoteCoordinator = jest.fn(
    /** @type {(input: unknown) => Promise<typeof receipt>} */ (
      async () => {
        events.push('takeover-remote');
        return receipt;
      }
    ),
  );
  const readDeploymentPayload = jest.fn(async () => {
    throw new Error('Unexpected deployment payload read');
  });
  const providerAccess = jest.fn(() => {
    throw new Error('Unexpected provider access');
  });
  const command = createPackagedDeploymentCommand({
    readRevisionRuntimePair,
    readDeploymentPayload,
    createJournalStore,
    resolveDataRoot,
    inspectRemoteCoordinator,
    takeoverRemoteCoordinator,
    readCoordinatorInspectionFile,
    acquireOperationLock,
    requireAwsProvider: providerAccess,
    createPreviewByProvider: { aws: providerAccess, hetzner: providerAccess },
    inspectStatusByProvider: { aws: providerAccess, hetzner: providerAccess },
    createApplyCoordinatorByProvider: {
      aws: providerAccess,
      hetzner: providerAccess,
    },
    createDestroyCoordinatorByProvider: {
      aws: providerAccess,
      hetzner: providerAccess,
    },
    output,
    processRef,
  });
  /** @param {import('commander').Command} parent */
  function silence(parent) {
    parent.exitOverride().configureOutput({ writeOut() {}, writeErr() {} });
    for (const child of parent.commands) silence(child);
  }
  silence(command);
  return {
    command,
    journal,
    inspection,
    receipt,
    events,
    output,
    processRef,
    readRevisionRuntimePair,
    readJournal,
    createJournalStore,
    resolveDataRoot,
    readCoordinatorInspectionFile,
    acquireOperationLock,
    releaseLock,
    inspectRemoteCoordinator,
    takeoverRemoteCoordinator,
    readDeploymentPayload,
    providerAccess,
  };
}

/** @param {ReturnType<typeof createHarness>} harness @param {'inspect'|'takeover'} operation @param {boolean} [confirm] */
function argv(harness, operation, confirm = true) {
  return [
    'coordinator',
    operation,
    '--deployment-instance',
    harness.journal.deploymentInstanceId,
    '--data-root',
    DATA_ROOT,
    ...(operation === 'takeover'
      ? [
          '--inspection-file',
          'retained-inspection.json',
          '--coordinator-id',
          COORDINATOR_ID,
          '--request-id',
          REQUEST_ID,
          ...(confirm ? ['--confirm-authority-replacement'] : []),
        ]
      : []),
    '--json',
  ];
}

/** @param {ReturnType<typeof createHarness>} harness */
function expectProviderFree(harness) {
  expect(harness.readDeploymentPayload).not.toHaveBeenCalled();
  expect(harness.providerAccess).not.toHaveBeenCalled();
}

describe('packaged deployment coordinator commands', () => {
  it('exposes only inspection and confirmed takeover with deployment selectors on their parent', () => {
    const harness = createHarness();
    const coordinator = harness.command.commands.find(
      (command) => command.name() === 'coordinator',
    );
    expect(coordinator?.commands.map((command) => command.name())).toEqual([
      'inspect',
      'takeover',
    ]);
    expect(coordinator?.options.map((option) => option.long)).toEqual([
      '--deployment-instance',
      '--data-root',
    ]);
    expect(coordinator?.helpInformation()).toMatch(/unhealthy/);
    const takeover = coordinator?.commands.find(
      (command) => command.name() === 'takeover',
    );
    expect(takeover?.options.map((option) => option.long)).toEqual([
      '--inspection-file',
      '--coordinator-id',
      '--request-id',
      '--confirm-authority-replacement',
      '--json',
    ]);
    expectProviderFree(harness);
  });

  it('accepts parent flags after inspect and returns the exact provider-free remote inspection', async () => {
    const harness = createHarness();
    await harness.command.parseAsync(argv(harness, 'inspect'), {
      from: 'user',
    });
    expect(harness.output.failure).not.toHaveBeenCalled();
    expect(harness.output.json).toHaveBeenCalledWith(harness.inspection);
    expect(harness.inspectRemoteCoordinator).toHaveBeenCalledWith({
      journal: harness.journal,
      dataRoot: DATA_ROOT,
    });
    expect(harness.createJournalStore).toHaveBeenCalledWith({
      appId: fixture.desired.intent.appId,
      deploymentInstanceId: harness.journal.deploymentInstanceId,
      dataRoot: DATA_ROOT,
    });
    expect(harness.resolveDataRoot).not.toHaveBeenCalled();
    expect(harness.acquireOperationLock).not.toHaveBeenCalled();
    expect(harness.readCoordinatorInspectionFile).not.toHaveBeenCalled();
    expectProviderFree(harness);
  });

  it('refuses missing confirmation before identity, journal, file, lock, or remote reads', async () => {
    const harness = createHarness();
    await harness.command.parseAsync(argv(harness, 'takeover', false), {
      from: 'user',
    });
    expect(harness.processRef.exitCode).toBe(1);
    expect(harness.output.failure).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/confirm-authority-replacement/),
      }),
    );
    expect(harness.readRevisionRuntimePair).not.toHaveBeenCalled();
    expect(harness.readJournal).not.toHaveBeenCalled();
    expect(harness.readCoordinatorInspectionFile).not.toHaveBeenCalled();
    expect(harness.acquireOperationLock).not.toHaveBeenCalled();
    expect(harness.takeoverRemoteCoordinator).not.toHaveBeenCalled();
    expectProviderFree(harness);
  });

  it('rereads the journal under the operation lock and forwards exact retained takeover authority', async () => {
    const harness = createHarness();
    const nextJournal = prepareSingleNodeDeploymentReleaseUpdate(
      harness.journal,
      createSingleNodeStatusUpdateTarget(fixture, 'changed-under-lock').desired,
    );
    harness.readJournal.mockImplementationOnce(async () => {
      harness.events.push('journal-unlocked');
      return harness.journal;
    });
    harness.readJournal.mockImplementationOnce(async () => {
      harness.events.push('journal-locked');
      return nextJournal;
    });
    await harness.command.parseAsync(argv(harness, 'takeover'), {
      from: 'user',
    });
    expect(harness.output.failure).not.toHaveBeenCalled();
    expect(harness.readCoordinatorInspectionFile).toHaveBeenCalledWith(
      'retained-inspection.json',
      'coordinator authority inspection',
    );
    expect(harness.acquireOperationLock).toHaveBeenCalledWith(
      harness.journal.deploymentInstanceId,
    );
    expect(harness.takeoverRemoteCoordinator).toHaveBeenCalledWith({
      journal: nextJournal,
      dataRoot: DATA_ROOT,
      inspection: harness.inspection,
      coordinatorId: COORDINATOR_ID,
      requestId: REQUEST_ID,
      confirmAuthorityReplacement: true,
    });
    expect(harness.events).toEqual([
      'journal-unlocked',
      'inspection-file',
      'lock',
      'journal-locked',
      'takeover-remote',
      'unlock',
    ]);
    expect(harness.output.json).toHaveBeenCalledWith(harness.receipt);
    expect(harness.releaseLock).toHaveBeenCalledTimes(1);
    expectProviderFree(harness);
  });

  it.each(['remote', 'journal'])(
    'releases the operation lock after a %s failure',
    async (failure) => {
      const harness = createHarness();
      if (failure === 'remote')
        harness.takeoverRemoteCoordinator.mockRejectedValueOnce(
          new Error('lost remote response'),
        );
      else
        harness.readJournal
          .mockResolvedValueOnce(harness.journal)
          .mockRejectedValueOnce(new Error('journal changed'));
      await harness.command.parseAsync(argv(harness, 'takeover'), {
        from: 'user',
      });
      expect(harness.processRef.exitCode).toBe(1);
      expect(harness.output.failure).toHaveBeenCalledTimes(1);
      expect(harness.output.json).not.toHaveBeenCalled();
      expect(harness.releaseLock).toHaveBeenCalledTimes(1);
      expect(harness.events.at(-1)).toBe('unlock');
      expectProviderFree(harness);
    },
  );

  it('preserves the takeover failure and unlock failure in one aggregate', async () => {
    const harness = createHarness();
    const primary = new Error('remote reply lost after takeover');
    const cleanup = new Error('operation lock release failed');
    harness.takeoverRemoteCoordinator.mockRejectedValueOnce(primary);
    harness.releaseLock.mockRejectedValueOnce(cleanup);
    await harness.command.parseAsync(argv(harness, 'takeover'), {
      from: 'user',
    });
    expect(harness.processRef.exitCode).toBe(1);
    expect(harness.output.json).not.toHaveBeenCalled();
    expect(harness.output.failure).toHaveBeenCalledTimes(1);
    const failure = /** @type {AggregateError} */ (
      harness.output.failure.mock.calls[0][0]
    );
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toEqual([primary, cleanup]);
    expect(failure.cause).toBe(primary);
    expect(harness.releaseLock).toHaveBeenCalledTimes(1);
    expectProviderFree(harness);
  });

  it('reports unlock failure after successful takeover while preserving the exact request for a later retry', async () => {
    const harness = createHarness();
    const cleanup = new Error('operation lock release failed');
    harness.releaseLock.mockRejectedValueOnce(cleanup);
    await harness.command.parseAsync(argv(harness, 'takeover'), {
      from: 'user',
    });
    expect(harness.processRef.exitCode).toBe(1);
    expect(harness.output.failure).toHaveBeenCalledWith(cleanup);
    expect(harness.output.json).not.toHaveBeenCalled();
    expect(harness.takeoverRemoteCoordinator).toHaveBeenCalledTimes(1);
    expect(harness.releaseLock).toHaveBeenCalledTimes(1);

    // A later invocation after host lock cleanup retains exactly the same
    // inspection and IDs, allowing the guest's already-committed receipt replay.
    const retry = createHarness();
    const replay = { ...harness.receipt, applied: false };
    retry.takeoverRemoteCoordinator.mockResolvedValueOnce(replay);
    await retry.command.parseAsync(argv(retry, 'takeover'), { from: 'user' });
    expect(retry.takeoverRemoteCoordinator.mock.calls[0]).toEqual(
      harness.takeoverRemoteCoordinator.mock.calls[0],
    );
    expect(retry.output.failure).not.toHaveBeenCalled();
    expect(retry.output.json).toHaveBeenCalledWith(replay);
    expect(retry.releaseLock).toHaveBeenCalledTimes(1);
    expectProviderFree(harness);
    expectProviderFree(retry);
  });

  it('rejects an embedded application mismatch before remote access', async () => {
    const harness = createHarness();
    harness.readRevisionRuntimePair.mockResolvedValueOnce({
      revision: fixture.revision,
      runtime: runtimeMetadata('foreign-app'),
    });
    await harness.command.parseAsync(argv(harness, 'inspect'), {
      from: 'user',
    });
    expect(harness.processRef.exitCode).toBe(1);
    expect(harness.output.failure).toHaveBeenCalledTimes(1);
    expect(harness.inspectRemoteCoordinator).not.toHaveBeenCalled();
    expectProviderFree(harness);
  });

  it('rejects a foreign retained inspection before taking the lock', async () => {
    const harness = createHarness();
    harness.readCoordinatorInspectionFile.mockResolvedValueOnce(
      createCoordinatorAuthorityInspectionDocument('foreign-app', null),
    );
    await harness.command.parseAsync(argv(harness, 'takeover'), {
      from: 'user',
    });
    expect(harness.processRef.exitCode).toBe(1);
    expect(harness.acquireOperationLock).not.toHaveBeenCalled();
    expect(harness.takeoverRemoteCoordinator).not.toHaveBeenCalled();
  });

  it.each(['--provider', '--region', '--location', '--app-id'])(
    'rejects unsupported %s selectors before reading authority',
    async (selector) => {
      const harness = createHarness();
      await expect(
        harness.command.parseAsync(
          [...argv(harness, 'inspect'), selector, 'unexpected'],
          { from: 'user' },
        ),
      ).rejects.toThrow();
      expect(harness.readRevisionRuntimePair).not.toHaveBeenCalled();
      expect(harness.inspectRemoteCoordinator).not.toHaveBeenCalled();
    },
  );
});
