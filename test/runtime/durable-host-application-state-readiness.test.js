/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApplicationStateCoordinatorAuthorityRecord } from '../../src/core/lib/db/tables/application-state-authority.js';
import { createApplicationStateReadinessStore } from '../../src/core/lib/db/tables/application-state-readiness.js';
import { createApplicationStateTable } from '../../src/core/lib/db/tables/application-state.js';
import {
  CoordinatorAuthorityStatus,
  createCoordinatorAuthority,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import {
  AttemptStatus,
  InvocationStatus,
  RunStatus,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import {
  createLedgerServiceId,
  createLedgerServiceOwnership,
} from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import {
  ARTIFACT_RUNTIME_KIND,
  ARTIFACT_RUNTIME_SCHEMA_VERSION,
} from '../../src/core/resources/builds/lib/revision-runtime-assets.js';
import {
  ACTIVITY_PROTOCOL_NAME,
  ACTIVITY_PROTOCOL_VERSION,
  ActivityProtocolTranscriptValidator,
} from '../../src/core/runtime/activity-protocol.js';
import {
  DEPENDENCY_LOCK_INPUT_FORMAT,
  RUNTIME_INPUT_FORMAT,
  SOURCE_TREE_INPUT_FORMAT,
  createApplicationRevision,
} from '../../src/core/runtime/application-revision.js';
import { prepareApplicationStateReadiness } from '../../src/core/runtime/application-state-readiness.js';
import {
  resolveApplicationStateStoreConfiguration,
  withApplicationStateDB,
} from '../../src/core/runtime/application-state-store.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  MANUAL_LEDGER_INVOCATION_ID,
  createManualLedgerRunId,
} from '../../src/core/runtime/manual-ledger-run.js';
import {
  resolveExecutionLedgerStoreConfiguration,
  withExecutionLedger,
  withExecutionLedgerCoordinatorAuthority,
} from '../../src/core/runtime/operator/execution-ledger-store.js';

const APP_ID = 'durable-host-readiness';
const ACTIVITY_ID = 'greet';
const ORIGINAL_ENVIRONMENT = { ...process.env };
const REPLACEMENT_STORE_ID = createCanonicalJsonSha256Id({
  domain: 'wharfie:test:durable-host-readiness:store:v1',
  prefix: 'was',
  value: 'replacement',
});

/** @type {string[]} */
const roots = [];
/** @type {{activityName: string, start: Readonly<Record<string, any>>, options: Record<string, any>}[]} */
const physicalAttempts = [];

// Only the final physical invocation is substituted. Manifest binding, local
// ownership, coordinator acquisition, ledger transitions, catalogs, and both
// native stores remain the production implementations.
class MockWharfieFunction {
  /** @param {string} activityName @param {Readonly<Record<string, any>>} start @param {Record<string, any>} [options] */
  static async runActivityAttempt(activityName, start, options = {}) {
    physicalAttempts.push({ activityName, start, options });
    const transcript = new ActivityProtocolTranscriptValidator();
    const acceptedStart = transcript.acceptHostFrame(start);
    const terminal = transcript.acceptComponentFrame({
      protocol: ACTIVITY_PROTOCOL_NAME,
      protocolVersion: ACTIVITY_PROTOCOL_VERSION,
      type: 'completed',
      attemptId: acceptedStart.attemptId,
      sequence: 1,
      result: { greeting: 'Hello Ada' },
    });
    return {
      status: terminal.type,
      start: acceptedStart,
      terminal,
      frames: [acceptedStart, terminal],
      transcript: transcript.snapshot(),
    };
  }
}

jest.unstable_mockModule('../../src/core/resources/builds/function.js', () => ({
  default: MockWharfieFunction,
}));

const { runLocalDurableManifestActivity } =
  await import('../../src/core/runtime/durable-activity-host.js');

afterEach(() => {
  process.env = { ...ORIGINAL_ENVIRONMENT };
  physicalAttempts.length = 0;
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** @param {string} value */
function digest(value) {
  return {
    algorithm: /** @type {const} */ ('sha256'),
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

function makeEmbeddedExecution() {
  const target = {
    nodeVersion: '24.13.1',
    platform: /** @type {const} */ ('linux'),
    architecture: /** @type {const} */ ('x64'),
    libc: /** @type {const} */ ('glibc'),
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
          path: 'activities/greet.js',
          export: ACTIVITY_ID,
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
  return {
    kind: /** @type {const} */ ('embedded'),
    manifest: { ...contract, targets: [target] },
    embeddedRevision: {
      revision,
      runtime: {
        schemaVersion: /** @type {1} */ (ARTIFACT_RUNTIME_SCHEMA_VERSION),
        kind: /** @type {'artifactRuntime'} */ (ARTIFACT_RUNTIME_KIND),
        appId: APP_ID,
        revisionId: revision.revisionId,
        target,
      },
    },
  };
}

async function createHarness() {
  const root = mkdtempSync(join(tmpdir(), 'wharfie-durable-host-readiness-'));
  roots.push(root);
  const applicationPath = join(root, 'application');
  process.env.WHARFIE_CONTROL_ADAPTER = 'lmdb';
  process.env.WHARFIE_CONTROL_PATH = join(root, 'control');
  process.env.WHARFIE_EXECUTION_LEDGER_TABLE = 'durable-host-readiness-control';
  process.env.WHARFIE_EXECUTION_PAYLOAD_PATH = join(root, 'payloads');
  process.env.WHARFIE_EXECUTION_PAYLOAD_STORE_ID =
    'durable-host-readiness-payloads';
  process.env.WHARFIE_LEDGER_SERVICE_SESSION_PATH = join(root, 'sessions');
  process.env.WHARFIE_APPLICATION_STATE_ADAPTER = 'lmdb';
  process.env.WHARFIE_APPLICATION_STATE_PATH = applicationPath;
  const configuration = resolveExecutionLedgerStoreConfiguration();
  const applicationStateConfiguration =
    resolveApplicationStateStoreConfiguration();
  const readiness = await withExecutionLedger(
    async (ledger, context) =>
      await withExecutionLedgerCoordinatorAuthority({
        appId: APP_ID,
        coordinatorId: 'resident-readiness-seed',
        ledger,
        context,
        handler: async (boundLedger) =>
          await prepareApplicationStateReadiness({
            ledger: boundLedger,
            appId: APP_ID,
            controlContext: context,
            configuration: applicationStateConfiguration,
          }),
      }),
    { configuration },
  );
  expect(readiness).toMatchObject({
    app_id: APP_ID,
    status: 'ADOPTED',
    epoch: 1,
    coordinator_id: 'resident-readiness-seed',
  });
  const request = {
    execution: makeEmbeddedExecution(),
    activityName: ACTIVITY_ID,
    idempotencyKey: 'pinned-foreground-request',
    input: { name: 'Ada' },
    actor: { kind: 'test', id: 'durable-host-readiness' },
  };
  return {
    root,
    applicationPath,
    configuration,
    applicationStateConfiguration,
    readiness,
    request,
    runId: createManualLedgerRunId({
      appId: APP_ID,
      idempotencyKey: request.idempotencyKey,
    }),
  };
}

/** @param {Awaited<ReturnType<typeof createHarness>>} harness */
async function readControl(harness) {
  return await withExecutionLedger(
    async (ledger, context) => ({
      view: await ledger.rebuildRun(harness.runId),
      readiness: await createApplicationStateReadinessStore({
        db: context.db,
        tableName: context.tableName,
      }).get({ appId: APP_ID }),
      authority: await createCoordinatorAuthority({
        db: context.db,
        tableName: context.tableName,
      }).get({ appId: APP_ID }),
      ownership: await createLedgerServiceOwnership({
        db: context.db,
        tableName: context.tableName,
      }).getOwnership({ serviceId: createLedgerServiceId({ appId: APP_ID }) }),
    }),
    { configuration: harness.configuration, readOnly: true },
  );
}

/** @param {ReturnType<typeof resolveApplicationStateStoreConfiguration>} configuration */
async function readDestination(configuration) {
  return await withApplicationStateDB(
    async (db, context) => {
      const table = createApplicationStateTable({
        db,
        tableName: context.tableName,
      });
      const identity = await table.readStoreIdentity();
      if (!identity) throw new Error('The fixture store identity is missing.');
      return {
        identity,
        authority: await table.readCoordinatorAuthority({
          storeId: identity.store_id,
          namespace: APP_ID,
        }),
      };
    },
    { configuration, readOnly: true },
  );
}

/** @param {Awaited<ReturnType<typeof createHarness>>} harness */
async function assertRetryablePreflightFailure(harness) {
  expect(physicalAttempts).toEqual([]);
  const state = await readControl(harness);
  expect(state.readiness).toEqual(harness.readiness);
  expect(state.authority).toMatchObject({
    status: CoordinatorAuthorityStatus.RELEASED,
    epoch: 2,
  });
  expect(state.ownership).toBeNull();
  expect(state.view).toMatchObject({
    run: { status: RunStatus.RUNNING, version: 3 },
    invocations: [{ status: InvocationStatus.RUNNABLE, generation: 1 }],
    attempts: [{ status: AttemptStatus.ABANDONED, generation: 1 }],
    effects: [],
  });
  expect(
    state.view?.events.map(
      (/** @type {Record<string, any>} */ event) => event.type,
    ),
  ).toEqual([
    'manual-run-created',
    'attempt-claimed',
    'attempt-abandoned-before-start',
  ]);
}

/** @param {Awaited<ReturnType<typeof createHarness>>} harness @param {number} generation */
async function assertSuccessfulPinnedRun(harness, generation) {
  const result = await runLocalDurableManifestActivity(harness.request);
  expect(result).toMatchObject({
    appId: APP_ID,
    runId: harness.runId,
    outcome: {
      disposition: 'completed',
      run: { status: RunStatus.COMPLETED },
      invocation: { status: InvocationStatus.COMPLETED, generation },
      attempt: { status: AttemptStatus.COMPLETED, generation },
    },
  });
  expect(physicalAttempts).toHaveLength(1);
  expect(physicalAttempts[0]).toMatchObject({
    activityName: ACTIVITY_ID,
    start: {
      runId: harness.runId,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      input: { name: 'Ada' },
    },
    options: { handleEffect: expect.any(Function) },
  });
  const state = await readControl(harness);
  expect(state.readiness).toEqual(harness.readiness);
  expect(state.ownership).toBeNull();
  expect(state.authority).toMatchObject({
    status: CoordinatorAuthorityStatus.RELEASED,
    epoch: generation + 1,
  });
  const destination = await readDestination(
    harness.applicationStateConfiguration,
  );
  expect(destination.identity.store_id).toBe(harness.readiness.store_id);
  expect(destination.authority).toEqual(
    createApplicationStateCoordinatorAuthorityRecord({
      storeId: harness.readiness.store_id,
      namespace: APP_ID,
      authority: state.authority,
    }),
  );
  return state;
}

describe('foreground application-state readiness pin over separate LMDB stores', () => {
  test('a missing pinned volume stays absent and the same request succeeds after restoring it', async () => {
    const harness = await createHarness();
    const retainedPath = join(harness.root, 'retained-application');
    renameSync(harness.applicationPath, retainedPath);
    expect(existsSync(harness.applicationPath)).toBe(false);

    await expect(
      runLocalDurableManifestActivity(harness.request),
    ).rejects.toThrow(/LMDB read-only local volume does not exist/i);

    expect(existsSync(harness.applicationPath)).toBe(false);
    await assertRetryablePreflightFailure(harness);
    renameSync(retainedPath, harness.applicationPath);
    const state = await assertSuccessfulPinnedRun(harness, 2);
    expect(state.view?.attempts).toHaveLength(2);
    expect(state.view?.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          generation: 1,
          status: AttemptStatus.ABANDONED,
        }),
        expect.objectContaining({
          generation: 2,
          status: AttemptStatus.COMPLETED,
        }),
      ]),
    );
    expect(
      state.view?.events.map(
        (/** @type {Record<string, any>} */ event) => event.type,
      ),
    ).toEqual([
      'manual-run-created',
      'attempt-claimed',
      'attempt-abandoned-before-start',
      'attempt-claimed',
      'attempt-started',
      'attempt-terminal',
    ]);
  });

  test('a replacement volume is neither adopted nor dispatched and restoring the pinned volume permits retry', async () => {
    const harness = await createHarness();
    const retainedPath = join(harness.root, 'retained-application');
    const replacementPath = join(harness.root, 'rejected-replacement');
    renameSync(harness.applicationPath, retainedPath);
    await withApplicationStateDB(
      async (db, context) => {
        await createApplicationStateTable({
          db,
          tableName: context.tableName,
          createStoreId: () => REPLACEMENT_STORE_ID,
        }).ensureStoreIdentity();
      },
      { configuration: harness.applicationStateConfiguration },
    );
    const replacement = await readDestination(
      harness.applicationStateConfiguration,
    );
    expect(replacement).toMatchObject({
      identity: { store_id: REPLACEMENT_STORE_ID },
      authority: null,
    });

    await expect(
      runLocalDurableManifestActivity(harness.request),
    ).rejects.toThrow(/store identity does not match/i);

    await assertRetryablePreflightFailure(harness);
    await expect(
      readDestination(harness.applicationStateConfiguration),
    ).resolves.toEqual(replacement);
    renameSync(harness.applicationPath, replacementPath);
    renameSync(retainedPath, harness.applicationPath);
    await assertSuccessfulPinnedRun(harness, 2);
  });

  test('a matching pin permits normal foreground completion with the exact original store and new coordinator barrier', async () => {
    const harness = await createHarness();
    const before = await readDestination(harness.applicationStateConfiguration);
    expect(before.authority).toMatchObject({
      store_id: harness.readiness.store_id,
      coordinator_id: 'resident-readiness-seed',
      epoch: 1,
    });

    const state = await assertSuccessfulPinnedRun(harness, 1);

    expect(
      state.view?.events.map(
        (/** @type {Record<string, any>} */ event) => event.type,
      ),
    ).toEqual([
      'manual-run-created',
      'attempt-claimed',
      'attempt-started',
      'attempt-terminal',
    ]);
    await expect(
      readDestination(harness.applicationStateConfiguration),
    ).resolves.toMatchObject({ identity: before.identity });
  });
});
