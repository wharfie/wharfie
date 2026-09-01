// @ts-nocheck -- intentionally loose provider, supervisor, and resident-process test seams.
/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, jest, test } from '@jest/globals';

import {
  APPLICATION_STATE_TABLE_NAME,
  createControlDBClient,
} from '../../src/core/lib/config/db.js';
import {
  AttemptStatus,
  InvocationStatus,
  RunStatus,
  createExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import {
  LEDGER_SERVICE_OWNERSHIP_SCHEMA_VERSION,
  LedgerServiceOwnerKind,
  createLedgerServiceId,
  createLedgerServiceSessionId,
} from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import {
  CoordinatorAuthorityStaleError,
  createCoordinatorAuthority,
  createCoordinatorAuthorityToken,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import {
  CoordinatorQuiescenceBarrierState,
  createCoordinatorQuiescenceBarrier,
} from '../../src/core/lib/db/tables/coordinator-quiescence-barrier.js';
import {
  createApplicationStateBusinessKey,
  createApplicationStateTable,
} from '../../src/core/lib/db/tables/application-state.js';
import {
  ExecutionPayloadStoreNotFoundError,
  createLocalExecutionPayloadStore,
} from '../../src/core/lib/payload-store/local.js';
import { createReplicatedExecutionPayloadStore } from '../../src/core/lib/payload-store/replicated.js';
import {
  ARTIFACT_RUNTIME_KIND,
  ARTIFACT_RUNTIME_SCHEMA_VERSION,
} from '../../src/core/resources/builds/lib/revision-runtime-assets.js';
import { ActivityProtocolTranscriptValidator } from '../../src/core/runtime/activity-protocol.js';
import {
  DEPENDENCY_LOCK_INPUT_FORMAT,
  RUNTIME_INPUT_FORMAT,
  SOURCE_TREE_INPUT_FORMAT,
  createApplicationRevision,
} from '../../src/core/runtime/application-revision.js';
import { inventoryApplicationStateHistory } from '../../src/core/runtime/application-state-history-checkpoint.js';
import { prepareApplicationStateReadiness } from '../../src/core/runtime/application-state-readiness.js';
import {
  ApplicationStateSnapshotNotFoundError,
  createApplicationStateSnapshotDistribution,
} from '../../src/core/runtime/application-state-snapshot-distribution.js';
import {
  publishApplicationStateSnapshot,
  transportApplicationStateSnapshot,
} from '../../src/core/runtime/application-state-snapshot-lmdb.js';
import { openApplicationStateDB } from '../../src/core/runtime/application-state-store.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  MANUAL_LEDGER_INVOCATION_ID,
  recoverManualLedgerActivity,
  runManualLedgerActivity,
} from '../../src/core/runtime/manual-ledger-run.js';
import { withReconstructedExecutionLedgerResidentAuthority } from '../../src/core/runtime/operator/execution-ledger-store.js';
import { createResidentReplacementInputReceipt } from '../../src/core/runtime/resident-replacement-input.js';
import {
  ResidentExecutionReconstructionPolicy,
  reconstructResidentExecutionHistory,
} from '../../src/core/runtime/services/resident-execution-reconstruction.js';
import { runResidentActivityWorker } from '../../src/core/runtime/services/resident-activity-worker.js';

const APP_ID = 'reconstructed-resident-crossing';
const ACTIVITY_ID = 'replacement-task';
const CONTROL_TABLE = 'reconstructed-resident-crossing-control';
const INPUT = Object.freeze({ operation: 'resume-after-replacement' });
const CALLER_METADATA = Object.freeze({ source: 'replacement-crossing-test' });
const ACTOR = Object.freeze({ kind: 'resident', id: APP_ID });
const TABLE_RESOURCE_ID = id('wdtr1', 'control-table');
const PAYLOAD_STORE_ID = 'reconstructed-resident-crossing-payloads';
const DISTRIBUTION_ID = id('wepd1', 'payload-distribution');
const REPLACEMENT_DEADLINE_MS = 18_000;
const REPLACEMENT_TEST_TIMEOUT_MS = 25_000;

/** @type {Array<() => Promise<void>>} */
let cleanups = [];

afterEach(async () => {
  const pending = cleanups;
  cleanups = [];
  const results = await Promise.allSettled(
    pending.map(async (cleanup) => await cleanup()),
  );
  const failures = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      'reconstructed resident crossing cleanup failed',
    );
  }
});

function id(prefix, label) {
  return createCanonicalJsonSha256Id({
    domain: `wharfie:test:reconstructed-resident-crossing:${prefix}`,
    prefix,
    value: { label },
  });
}

function digest(value) {
  return {
    algorithm: 'sha256',
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

function createExecution() {
  const target = {
    nodeVersion: '24.13.1',
    platform: 'linux',
    architecture: 'x64',
    libc: 'glibc',
  };
  const contract = {
    schemaVersion: 4,
    app: { id: APP_ID },
    cli: {
      entrypoint: { kind: 'node', path: 'cli.js', export: 'main' },
    },
    activities: {
      [ACTIVITY_ID]: {
        entrypoint: {
          kind: 'node',
          path: 'activities/replacement-task.js',
          export: 'replacementTask',
        },
      },
    },
  };
  const revision = createApplicationRevision({
    contract,
    inputs: {
      source: { format: SOURCE_TREE_INPUT_FORMAT, digest: digest('source') },
      dependencies: {
        format: DEPENDENCY_LOCK_INPUT_FORMAT,
        digest: digest('dependencies'),
      },
      runtime: { format: RUNTIME_INPUT_FORMAT, digest: digest('runtime') },
    },
  });
  return Object.freeze({
    kind: 'embedded',
    manifest: Object.freeze({ ...contract, targets: [target] }),
    embeddedRevision: Object.freeze({
      revision,
      runtime: Object.freeze({
        schemaVersion: ARTIFACT_RUNTIME_SCHEMA_VERSION,
        kind: ARTIFACT_RUNTIME_KIND,
        appId: APP_ID,
        revisionId: revision.revisionId,
        target,
      }),
    }),
  });
}

const EXECUTION = createExecution();
const REVISION_ID = EXECUTION.embeddedRevision.runtime.revisionId;

function completedEvidence(start, result) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(start);
  const terminal = transcript.acceptComponentFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'completed',
    attemptId: start.attemptId,
    sequence: 1,
    result,
  });
  return {
    status: terminal.type,
    start: acceptedStart,
    terminal,
    frames: [acceptedStart, terminal],
    transcript: transcript.snapshot(),
  };
}

function applicationStateIntent(storeId) {
  return Object.freeze({
    storeId,
    namespace: APP_ID,
    key: 'retained-before-replacement',
    value: { retained: true },
    destinationEffectId: 'replacement-crossing-state-seed',
    contractDigest: id('wac', 'application-state-contract'),
  });
}

async function assertApplicationStateSeed(configuration, authority) {
  const access = await openApplicationStateDB({ configuration });
  try {
    const table = createApplicationStateTable({
      db: access.db,
      tableName: access.context.tableName,
      coordinatorAuthority: authority,
    });
    const key = createApplicationStateBusinessKey(
      APP_ID,
      'retained-before-replacement',
    );
    await expect(
      table.readBusinessByPhysicalKey(key.resourceId, key.sortKey),
    ).resolves.toMatchObject({ value: { retained: true } });
  } finally {
    await access.close();
  }
}

async function createFixture(retainedStatus) {
  const root = await fsp.mkdtemp(
    join(tmpdir(), 'wharfie-reconstructed-resident-crossing-'),
  );
  const controlPath = join(root, 'control');
  const sourcePayloadPath = join(root, 'source-payloads');
  const replacementPayloadPath = join(root, 'replacement-payloads');
  const sourceStatePath = join(root, 'source-state');
  const replacementStatePath = join(root, 'replacement-state');
  const controlDb = await createControlDBClient('vanilla', {
    path: controlPath,
  });
  cleanups.push(async () => {
    try {
      await controlDb.close();
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  const authorities = createCoordinatorAuthority({
    db: controlDb,
    tableName: CONTROL_TABLE,
  });
  const sourceAcquisition = await authorities.acquire({
    appId: APP_ID,
    coordinatorId: 'predecessor-coordinator',
    requestId: `predecessor-acquire-${retainedStatus.toLowerCase()}`,
    observedAt: 1,
  });
  const sourceAuthority = createCoordinatorAuthorityToken(
    sourceAcquisition.authority,
  );

  const payloadArtifacts = new Map();
  const payloadRead = jest.fn(async (reference) => {
    const bytes = payloadArtifacts.get(reference.payloadId);
    if (!bytes) {
      throw new ExecutionPayloadStoreNotFoundError(reference.payloadId);
    }
    return Buffer.from(bytes);
  });
  const payloadDistribution = Object.freeze({
    identity: Object.freeze({
      kind: 'wharfie.execution-payload-distribution.v1',
      distributionId: DISTRIBUTION_ID,
      storeId: PAYLOAD_STORE_ID,
    }),
    publishImmutable: jest.fn(async ({ reference, bytes }) => {
      const existing = payloadArtifacts.get(reference.payloadId);
      if (existing && !existing.equals(bytes)) {
        throw new Error('immutable execution payload conflict');
      }
      payloadArtifacts.set(reference.payloadId, Buffer.from(bytes));
    }),
    readBytes: payloadRead,
  });
  const sourcePayloads = createReplicatedExecutionPayloadStore({
    localStore: createLocalExecutionPayloadStore({
      path: sourcePayloadPath,
      storeId: PAYLOAD_STORE_ID,
    }),
    distribution: payloadDistribution,
  });
  const sourceLedger = createExecutionLedger({
    db: controlDb,
    tableName: CONTROL_TABLE,
    payloadStore: sourcePayloads,
  });
  const predecessorLedger =
    sourceLedger.bindCoordinatorAuthority(sourceAuthority);
  const runId = `replacement-${retainedStatus.toLowerCase()}-work`;
  const created = await predecessorLedger.createManualRun({
    runId,
    appId: APP_ID,
    revisionId: REVISION_ID,
    invocationId: MANUAL_LEDGER_INVOCATION_ID,
    activityId: ACTIVITY_ID,
    input: INPUT,
    callerMetadata: CALLER_METADATA,
    transitionId: 'create',
    actor: ACTOR,
    observedAt: 2,
  });
  const claimed = await predecessorLedger.claimInvocation({
    runId,
    invocationId: MANUAL_LEDGER_INVOCATION_ID,
    fencingToken: 'predecessor-generation-1-fence',
    expectedGeneration: 0,
    expectedVersion: created.run.version,
    transitionId: 'claim:1',
    actor: ACTOR,
    coordinatorEpoch: sourceAuthority.epoch,
    observedAt: 3,
  });
  if (!claimed.attempt) {
    throw new Error(
      'Replacement crossing fixture failed to claim generation 1.',
    );
  }
  const started =
    retainedStatus === AttemptStatus.STARTED
      ? await predecessorLedger.markAttemptStarted({
          runId,
          invocationId: MANUAL_LEDGER_INVOCATION_ID,
          attemptId: claimed.attempt.attemptId,
          fencingToken: claimed.attempt.fencingToken,
          generation: claimed.attempt.generation,
          expectedVersion: claimed.run.version,
          transitionId: `start:${claimed.attempt.attemptId}`,
          actor: ACTOR,
          coordinatorEpoch: sourceAuthority.epoch,
          observedAt: 4,
        })
      : undefined;

  let barrierClock = 10;
  const admission = createCoordinatorQuiescenceBarrier({
    db: controlDb,
    tableName: CONTROL_TABLE,
    now: () => barrierClock++,
  });
  const sourceBarrier = (
    await admission.close({
      authority: sourceAuthority,
      requestId: `predecessor-close-${retainedStatus.toLowerCase()}`,
      predecessor: null,
    })
  ).barrier;

  const stateStoreId = id('was', `application-state-${retainedStatus}`);
  const destination = Object.freeze({
    kind: 'application-state',
    version: 2,
    bindingId: 'primary',
    configuration: Object.freeze({
      provider: 'lmdb',
      storeId: stateStoreId,
      tableName: APPLICATION_STATE_TABLE_NAME,
      namespace: APP_ID,
    }),
  });
  const sourceStateConfiguration = Object.freeze({
    adapterName: /** @type {const} */ ('lmdb'),
    storePath: sourceStatePath,
    tableName: APPLICATION_STATE_TABLE_NAME,
  });
  const replacementStateConfiguration = Object.freeze({
    ...sourceStateConfiguration,
    storePath: replacementStatePath,
  });
  const sourceState = await openApplicationStateDB({
    configuration: sourceStateConfiguration,
  });
  try {
    const table = createApplicationStateTable({
      db: sourceState.db,
      tableName: sourceState.context.tableName,
      coordinatorAuthority: sourceAuthority,
      createStoreId: () => stateStoreId,
    });
    await table.ensureStoreIdentity();
    await table.adoptCoordinatorAuthority({
      storeId: stateStoreId,
      namespace: APP_ID,
    });
    await table.putIfAbsent(applicationStateIntent(stateStoreId));
  } finally {
    await sourceState.close();
  }

  const snapshotArtifacts = new Map();
  const snapshotDistribution = createApplicationStateSnapshotDistribution({
    identity: {
      kind: 'wharfie.application-state-snapshot-distribution.v1',
      distributionId: id('wasd1', `state-distribution-${retainedStatus}`),
      storeId: stateStoreId,
    },
    publishImmutable: async ({ reference, bytes }) => {
      snapshotArtifacts.set(reference.snapshotId, Buffer.from(bytes));
    },
    readBytes: async (reference) => {
      const bytes = snapshotArtifacts.get(reference.snapshotId);
      if (!bytes) {
        throw new ApplicationStateSnapshotNotFoundError(reference.snapshotId);
      }
      return Buffer.from(bytes);
    },
  });
  const actualControlContext = Object.freeze({
    db: controlDb,
    tableName: CONTROL_TABLE,
    adapterName: /** @type {const} */ ('vanilla'),
    controlPath,
  });
  const applicationStateTransport = await publishApplicationStateSnapshot({
    ledger: predecessorLedger,
    appId: APP_ID,
    configuration: sourceStateConfiguration,
    controlContext: actualControlContext,
    destination,
    closedBarrier: sourceBarrier,
    coordinatorAuthority: sourceAuthority,
    transferId: id('wast1', `state-transfer-${retainedStatus}`),
    distribution: snapshotDistribution,
  });

  const observedAuthority = await authorities.get({ appId: APP_ID });
  const replacementAcquisition = await authorities.takeover({
    appId: APP_ID,
    coordinatorId: 'replacement-coordinator',
    requestId: `replacement-takeover-${retainedStatus.toLowerCase()}`,
    observedAuthority,
    confirmAuthorityReplacement: true,
    observedAt: 20,
  });
  const replacementAuthority = createCoordinatorAuthorityToken(
    replacementAcquisition.authority,
  );

  const replacementPayloads = createReplicatedExecutionPayloadStore({
    localStore: createLocalExecutionPayloadStore({
      path: replacementPayloadPath,
      storeId: PAYLOAD_STORE_ID,
    }),
    distribution: payloadDistribution,
  });
  const replacementLedger = createExecutionLedger({
    db: controlDb,
    tableName: CONTROL_TABLE,
    payloadStore: replacementPayloads,
  });
  const configuration = Object.freeze({
    adapterName: /** @type {const} */ ('dynamodb'),
    controlPath,
    tableName: CONTROL_TABLE,
    payloadPath: replacementPayloadPath,
    payloadStoreId: PAYLOAD_STORE_ID,
    sessionPath: join(root, 'sessions'),
    region: 'us-east-2',
    residentCoordinatorAuthority: Object.freeze({
      profile: /** @type {const} */ ('dynamodb-rvn-v1'),
      adapterName: /** @type {const} */ ('dynamodb'),
      region: 'us-east-2',
      tableName: CONTROL_TABLE,
      tableResourceId: TABLE_RESOURCE_ID,
      renewalIntervalMs: 5_000,
      observationWindowMs: 15_000,
    }),
  });
  const replacementInput = createResidentReplacementInputReceipt({
    appId: APP_ID,
    currentRevisionId: REVISION_ID,
    control: {
      profile: 'dynamodb-rvn-v1',
      adapterName: 'dynamodb',
      region: 'us-east-2',
      tableName: CONTROL_TABLE,
      tableResourceId: TABLE_RESOURCE_ID,
    },
    payloadStorage: {
      ...replacementPayloads.storage,
      distribution: replacementPayloads.distribution,
    },
    applicationStateDestination: destination,
    applicationStateTransport,
  });

  return {
    root,
    runId,
    controlDb,
    controlPath,
    actualControlContext,
    authorities,
    admission,
    sourceBarrier,
    sourceAuthority,
    predecessorLedger,
    claimed,
    started,
    replacementAuthority,
    replacementLedger,
    replacementPayloads,
    payloadRead,
    replacementStateConfiguration,
    destination,
    snapshotDistribution,
    applicationStateTransport,
    configuration,
    replacementInput,
  };
}

async function currentBarrier(fixture) {
  return await fixture.admission.get({ appId: APP_ID });
}

async function expectClosedBarrier(fixture) {
  await expect(currentBarrier(fixture)).resolves.toMatchObject({
    state: CoordinatorQuiescenceBarrierState.CLOSED,
  });
}

function createOwner() {
  const serviceId = createLedgerServiceId({ appId: APP_ID });
  const sessionId = createLedgerServiceSessionId();
  const sessionRoot = join(
    tmpdir(),
    'wharfie-reconstructed-resident-crossing-session',
  );
  const endpoint = join(sessionRoot, 'live.sock');
  const ownerCommandEndpoint = join(sessionRoot, 'command.sock');
  return Object.freeze({
    serviceId,
    sessionId,
    commandSession: Object.freeze({
      serviceId,
      sessionId,
      sessionRoot,
      endpoint,
      ownerCommandEndpoint,
    }),
    ownership: Object.freeze({
      schemaVersion: LEDGER_SERVICE_OWNERSHIP_SCHEMA_VERSION,
      serviceId,
      appId: APP_ID,
      scopeId: 'replacement-test-machine',
      principalId: 'replacement-test-principal',
      sessionId,
      ownerKind: LedgerServiceOwnerKind.RESIDENT,
      generation: 1,
      claimedAt: 30,
      updatedAt: 30,
    }),
  });
}

async function waitForAbort(signal) {
  if (signal.aborted) return;
  await new Promise((resolve) =>
    signal.addEventListener('abort', resolve, { once: true }),
  );
}

async function runReplacement(fixture, retainedStatus) {
  const trace = [];
  const activityMarkers = [];
  const workerStop = new AbortController();
  const authorityStop = new AbortController();
  const authoritySignal = authorityStop.signal;
  const stopReplacement = (reason) => {
    if (!workerStop.signal.aborted) workerStop.abort(reason);
    if (!authorityStop.signal.aborted) authorityStop.abort(reason);
  };
  const replacementDeadline = setTimeout(() => {
    stopReplacement(
      new Error(
        `Reconstructed resident crossing exceeded ${REPLACEMENT_DEADLINE_MS}ms.`,
      ),
    );
  }, REPLACEMENT_DEADLINE_MS);
  replacementDeadline.unref?.();
  let reconstruction;

  const wrappedAdmission = {
    get: async (input) => {
      trace.push('barrier-get');
      return await fixture.admission.get(input);
    },
    close: async () => {
      trace.push('barrier-close');
      throw new Error('An inherited CLOSED barrier must be adopted.');
    },
    adopt: async (input) => {
      trace.push('barrier-adopt');
      await expectClosedBarrier(fixture);
      const result = await fixture.admission.adopt(input);
      expect(result.barrier).toMatchObject({
        state: CoordinatorQuiescenceBarrierState.CLOSED,
        authority: fixture.replacementAuthority,
      });
      return result;
    },
    reopen: async (input) => {
      trace.push('barrier-reopen');
      await expectClosedBarrier(fixture);
      const result = await fixture.admission.reopen(input);
      await expect(currentBarrier(fixture)).resolves.toMatchObject({
        state: CoordinatorQuiescenceBarrierState.OPEN,
        authority: fixture.replacementAuthority,
      });
      return result;
    },
  };

  const runWorker = async (ledger, session) => {
    trace.push('handler');
    await expect(currentBarrier(fixture)).resolves.toMatchObject({
      state: CoordinatorQuiescenceBarrierState.OPEN,
      authority: fixture.replacementAuthority,
    });
    expect(session.applicationStateTransport).toMatchObject({
      status: 'HYDRATED',
    });
    expect(session.applicationState).toMatchObject({ status: 'ADOPTED' });
    await assertApplicationStateSeed(
      fixture.replacementStateConfiguration,
      fixture.replacementAuthority,
    );

    const runActivity = jest.fn(async (input) => {
      trace.push('activity-port');
      const outcome = await runManualLedgerActivity({
        ledger: input.ledger,
        runId: input.runId,
        appId: APP_ID,
        revisionId: REVISION_ID,
        activityId: ACTIVITY_ID,
        input: INPUT,
        callerMetadata: CALLER_METADATA,
        actor: ACTOR,
        admissionSignal: input.admissionSignal,
        signal: input.signal,
        createFencingToken: () => 'replacement-generation-2-fence',
        executeAttempt: async (startFrame) => {
          trace.push('activity-execute');
          expect(startFrame).toEqual({
            protocol: 'wharfie.activity',
            protocolVersion: 1,
            type: 'start',
            revisionId: REVISION_ID,
            activityId: ACTIVITY_ID,
            runId: fixture.runId,
            invocationId: MANUAL_LEDGER_INVOCATION_ID,
            attemptId: expect.any(String),
            fencingToken: 'replacement-generation-2-fence',
            input: INPUT,
            caller: { metadata: CALLER_METADATA },
          });
          activityMarkers.push(startFrame.attemptId);
          return completedEvidence(startFrame, {
            resumedBy: 'replacement',
          });
        },
      });
      workerStop.abort(new Error('Replacement crossing proof completed.'));
      return Object.freeze({
        appId: APP_ID,
        revisionId: REVISION_ID,
        activityName: ACTIVITY_ID,
        runId: input.runId,
        outcome,
      });
    });
    const recoverActivity = jest.fn(async (input) => {
      trace.push('worker-recovery');
      const recovered = await recoverManualLedgerActivity(input);
      if (retainedStatus === AttemptStatus.STARTED) {
        workerStop.abort(
          new Error('Started work remained recovery-only after replacement.'),
        );
      }
      return recovered;
    });
    const signal = AbortSignal.any([session.signal, workerStop.signal]);
    const worker = await runResidentActivityWorker({
      ledger,
      execution: EXECUTION,
      controlContext: fixture.actualControlContext,
      owner: createOwner(),
      signal,
      pollIntervalMs: 1,
      drainTimeoutMs: 1_000,
      applicationStateConfiguration: fixture.replacementStateConfiguration,
      runActivity,
      recoverActivity,
      createCommandServer: async ({ session: commandSession }) =>
        Object.freeze({
          endpoint: commandSession.ownerCommandEndpoint,
          session: commandSession,
          close: async () => undefined,
        }),
      runScheduleObserver: async ({ signal: observerSignal, onReady }) => {
        await onReady?.();
        await waitForAbort(observerSignal);
        return Object.freeze({
          observations: 0,
          admitted: 0,
          replayed: 0,
          advanced: 0,
        });
      },
      onReady: async () => {
        trace.push('worker-ready');
      },
    });
    return { worker, runActivity, recoverActivity };
  };

  try {
    const result = await withReconstructedExecutionLedgerResidentAuthority(
      /** @type {any} */ ({
        appId: APP_ID,
        currentRevisionId: REVISION_ID,
        coordinatorId: 'replacement-coordinator',
        ledger: fixture.replacementLedger,
        context: {
          db: fixture.controlDb,
          adapterName: 'dynamodb',
          tableName: CONTROL_TABLE,
          readOnly: false,
          payloadStore: fixture.replacementPayloads,
        },
        configuration: fixture.configuration,
        replacementInput: fixture.replacementInput,
        transportApplicationState: async (_ledger, session) => {
          trace.push('application-state-transport');
          await expectClosedBarrier(fixture);
          return await transportApplicationStateSnapshot({
            configuration: fixture.replacementStateConfiguration,
            controlContext: fixture.actualControlContext,
            transport: session.replacementInput.applicationStateTransport,
            history: session.applicationStateHistory,
            closedBarrier: session.closedBarrier,
            coordinatorAuthority: session.coordinatorAuthority,
            distribution: fixture.snapshotDistribution,
            signal: session.signal,
          });
        },
        prepareApplicationState: async (ledger, session) => {
          trace.push('application-state-readiness');
          await expectClosedBarrier(fixture);
          const readiness = await prepareApplicationStateReadiness({
            ledger,
            appId: APP_ID,
            controlContext: fixture.actualControlContext,
            configuration: fixture.replacementStateConfiguration,
            signal: session.signal,
          });
          await expectClosedBarrier(fixture);
          return readiness;
        },
        handler: runWorker,
      }),
      /** @type {any} */ ({
        validateTopology: async () => {
          trace.push('topology');
          return Object.freeze({ tableResourceId: TABLE_RESOURCE_ID });
        },
        createProtocol: () => {
          trace.push('protocol');
          return Object.freeze({ kind: 'replacement-crossing-protocol' });
        },
        createSupervisor: () => {
          trace.push('supervisor');
          return {
            run: async ({ handler }) => {
              trace.push('supervisor-run');
              return await handler({
                authority: fixture.replacementAuthority,
                coordinatorAuthority: fixture.replacementAuthority,
                signal: authoritySignal,
              });
            },
          };
        },
        createAdmissionBarrier: () => wrappedAdmission,
        reconstructHistory: async (input) => {
          trace.push('execution-reconstruction');
          await expectClosedBarrier(fixture);
          reconstruction = await reconstructResidentExecutionHistory(input);
          await expectClosedBarrier(fixture);
          return reconstruction;
        },
        inventoryApplicationState: async (input) => {
          trace.push('application-state-history');
          await expectClosedBarrier(fixture);
          return await inventoryApplicationStateHistory(input);
        },
      }),
    );

    return { ...result, trace, activityMarkers, reconstruction };
  } finally {
    clearTimeout(replacementDeadline);
    stopReplacement(new Error('Reconstructed resident crossing settled.'));
  }
}

describe('reconstructed resident eligible-work crossing', () => {
  test(
    'adopts the barrier, reconstructs every durable input, and dispatches only a fresh generation',
    async () => {
      const fixture = await createFixture(AttemptStatus.CLAIMED);
      await expect(
        fixture.predecessorLedger.markAttemptStarted({
          runId: fixture.runId,
          invocationId: MANUAL_LEDGER_INVOCATION_ID,
          attemptId: fixture.claimed.attempt.attemptId,
          fencingToken: fixture.claimed.attempt.fencingToken,
          generation: fixture.claimed.attempt.generation,
          expectedVersion: fixture.claimed.run.version,
          transitionId: `start:${fixture.claimed.attempt.attemptId}`,
          actor: ACTOR,
          coordinatorEpoch: fixture.sourceAuthority.epoch,
          observedAt: 21,
        }),
      ).rejects.toBeInstanceOf(CoordinatorAuthorityStaleError);

      const result = await runReplacement(fixture, AttemptStatus.CLAIMED);

      expect(result.trace).toEqual([
        'topology',
        'protocol',
        'supervisor',
        'supervisor-run',
        'barrier-get',
        'barrier-adopt',
        'execution-reconstruction',
        'application-state-history',
        'application-state-transport',
        'application-state-readiness',
        'barrier-reopen',
        'handler',
        'worker-ready',
        'worker-recovery',
        'activity-port',
        'activity-execute',
      ]);
      expect(result.reconstruction).toMatchObject({
        inspectedRuns: 1,
        policyCounts: {
          [ResidentExecutionReconstructionPolicy.RECOVER_PRE_START_CLAIM]: 1,
        },
      });
      expect(result.worker).toEqual({ processed: 1 });
      expect(result.runActivity).toHaveBeenCalledTimes(1);
      expect(result.recoverActivity).toHaveBeenCalledTimes(1);
      expect(result.activityMarkers).toHaveLength(1);
      expect(fixture.payloadRead).toHaveBeenCalled();

      const view = await fixture.replacementLedger.rebuildRun(fixture.runId);
      expect(view).toMatchObject({
        run: { status: RunStatus.COMPLETED },
        invocations: [
          expect.objectContaining({
            status: InvocationStatus.COMPLETED,
            generation: 2,
          }),
        ],
        attempts: expect.arrayContaining([
          expect.objectContaining({
            attemptId: fixture.claimed.attempt.attemptId,
            generation: 1,
            status: AttemptStatus.ABANDONED,
          }),
          expect.objectContaining({
            attemptId: result.activityMarkers[0],
            generation: 2,
            status: AttemptStatus.COMPLETED,
            coordinatorEpoch: fixture.replacementAuthority.epoch,
          }),
        ]),
      });
      expect(
        view.events.filter((event) => event.type === 'attempt-started'),
      ).toHaveLength(1);
      expect(
        view.events.find((event) => event.type === 'attempt-started')?.fence,
      ).toMatchObject({
        coordinatorEpoch: fixture.replacementAuthority.epoch,
        invocationGeneration: 2,
      });
      expect(
        view.events.filter((event) => event.type === 'attempt-terminal'),
      ).toHaveLength(1);
      await expect(currentBarrier(fixture)).resolves.toMatchObject({
        state: CoordinatorQuiescenceBarrierState.OPEN,
        authority: fixture.replacementAuthority,
      });
    },
    REPLACEMENT_TEST_TIMEOUT_MS,
  );

  test(
    'keeps a predecessor STARTED attempt outcome-unknown and never reaches the activity port',
    async () => {
      const fixture = await createFixture(AttemptStatus.STARTED);
      const started = fixture.started;
      if (!started) throw new Error('Expected a retained STARTED attempt.');
      await expect(
        fixture.predecessorLedger.commitVerifiedAttemptTerminal({
          runId: fixture.runId,
          invocationId: MANUAL_LEDGER_INVOCATION_ID,
          attemptId: fixture.claimed.attempt.attemptId,
          fencingToken: fixture.claimed.attempt.fencingToken,
          generation: fixture.claimed.attempt.generation,
          expectedVersion: started.run.version,
          transitionId: `terminal:${fixture.claimed.attempt.attemptId}`,
          evidence: completedEvidence(started.startFrame, {
            stale: 'predecessor',
          }),
          actor: ACTOR,
          coordinatorEpoch: fixture.sourceAuthority.epoch,
          observedAt: 21,
        }),
      ).rejects.toBeInstanceOf(CoordinatorAuthorityStaleError);

      const result = await runReplacement(fixture, AttemptStatus.STARTED);

      expect(result.trace).toEqual([
        'topology',
        'protocol',
        'supervisor',
        'supervisor-run',
        'barrier-get',
        'barrier-adopt',
        'execution-reconstruction',
        'application-state-history',
        'application-state-transport',
        'application-state-readiness',
        'barrier-reopen',
        'handler',
        'worker-ready',
        'worker-recovery',
      ]);
      expect(result.reconstruction).toMatchObject({
        inspectedRuns: 1,
        policyCounts: {
          [ResidentExecutionReconstructionPolicy.STARTED_OUTCOME_UNKNOWN]: 1,
        },
      });
      expect(result.worker).toEqual({ processed: 0 });
      expect(result.runActivity).not.toHaveBeenCalled();
      expect(result.recoverActivity).toHaveBeenCalledTimes(1);
      expect(result.activityMarkers).toEqual([]);

      const view = await fixture.replacementLedger.rebuildRun(fixture.runId);
      expect(view).toMatchObject({
        run: { status: RunStatus.BLOCKED },
        invocations: [
          expect.objectContaining({
            status: InvocationStatus.UNCERTAIN,
            generation: 1,
          }),
        ],
        attempts: [
          expect.objectContaining({
            attemptId: fixture.claimed.attempt.attemptId,
            generation: 1,
            status: AttemptStatus.ABANDONED,
            coordinatorEpoch: fixture.sourceAuthority.epoch,
          }),
        ],
      });
      expect(
        view.events.filter((event) => event.type === 'attempt-started'),
      ).toHaveLength(1);
      expect(
        view.events.filter((event) => event.type === 'attempt-terminal'),
      ).toHaveLength(0);
      expect(
        view.events.filter(
          (event) => event.type === 'attempt-became-uncertain',
        ),
      ).toHaveLength(1);
      await expect(currentBarrier(fixture)).resolves.toMatchObject({
        state: CoordinatorQuiescenceBarrierState.OPEN,
        authority: fixture.replacementAuthority,
      });
    },
    REPLACEMENT_TEST_TIMEOUT_MS,
  );
});
