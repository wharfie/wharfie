/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import createLMDB from '../../src/core/lib/db/adapters/lmdb.js';
import {
  APPLICATION_STATE_TABLE_NAME,
  resolveExecutionPayloadStoreId,
} from '../../src/core/lib/config/db.js';
import { createApplicationStateCoordinatorAuthorityRecord } from '../../src/core/lib/db/tables/application-state-authority.js';
import {
  applicationStateReadinessAuthority,
  applicationStateReadinessDestination,
  createApplicationStateReadinessStore,
} from '../../src/core/lib/db/tables/application-state-readiness.js';
import {
  createApplicationStateBusinessKey,
  createApplicationStateTable,
} from '../../src/core/lib/db/tables/application-state.js';
import {
  CoordinatorAuthorityStatus,
  createCoordinatorAuthority,
  createCoordinatorAuthorityToken,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import {
  AttemptStatus,
  EffectStatus,
  InvocationStatus,
  RunStatus,
  createExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import {
  LedgerServiceLifecycleStatus,
  createLedgerServiceId,
  createLedgerServiceLifecycle,
  createLedgerServiceOwnership,
} from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
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
import { openApplicationStateDB } from '../../src/core/runtime/application-state-store.js';
import { APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS } from '../../src/core/runtime/effects/application-state.js';
import {
  createBuiltinManagedEffectCatalog,
  createBuiltinManagedEffectHandler,
} from '../../src/core/runtime/effects/builtin-catalog.js';
import {
  getLocalServiceSessionEndpoint,
  getLocalServiceSessionOwnerCommandEndpoint,
  probeLocalServiceSession,
} from '../../src/core/runtime/local-service-session.js';
import {
  MANUAL_LEDGER_INVOCATION_ID,
  createManualLedgerRunId,
  runManualLedgerActivity,
} from '../../src/core/runtime/manual-ledger-run.js';

/** @typedef {{code: number | null, signal: NodeJS.Signals | null}} ChildExit */
/** @typedef {{child: import('node:child_process').ChildProcess, done: Promise<ChildExit>, exit?: ChildExit, spawnError?: Error, messages: Record<string, any>[], stdout: string, stderr: string}} Child */
/** @typedef {import('../fixtures/application-state-readiness-crash-child.js').CrashBoundary} CrashBoundary */

const CHILD_PATH = fileURLToPath(
  new URL(
    '../fixtures/application-state-readiness-crash-child.js',
    import.meta.url,
  ),
);
const APP_ID = 'application-state-readiness-crash';
const EFFECT_ID = 'retained-effect';
const BUSINESS_KEY = 'retained-business-value';
const ACTOR = Object.freeze({ kind: 'test', id: 'readiness-real-sigkill' });
const testOnUnix = process.platform === 'win32' ? test.skip : test;
const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});
const CASES = /** @type {const} */ ([
  {
    boundary: 'preparing-committed',
    label: 'PREPARING before destination adoption',
  },
  {
    boundary: 'destination-committed',
    label: 'destination commit before ADOPTED',
  },
]);

/** @param {string} value @returns {{algorithm: 'sha256', value: string}} */
function digest(value) {
  return {
    algorithm: 'sha256',
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

function executionFixture() {
  const contract = {
    schemaVersion: 4,
    app: { id: APP_ID },
    cli: { entrypoint: { kind: 'node', path: 'cli.js', export: 'main' } },
    activities: {
      remember: {
        entrypoint: {
          kind: 'node',
          path: 'must-not-redispatch.js',
          export: 'remember',
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
    manifest: { ...contract, targets: [{ ...TARGET }] },
    embeddedRevision: {
      revision,
      runtime: {
        schemaVersion: ARTIFACT_RUNTIME_SCHEMA_VERSION,
        kind: ARTIFACT_RUNTIME_KIND,
        appId: APP_ID,
        revisionId: revision.revisionId,
        target: { ...TARGET },
      },
    },
  };
}

/** @param {string} root @param {CrashBoundary} boundary */
function createFixture(root, boundary) {
  const payloadPath = join(root, 'payloads');
  return {
    root,
    boundary,
    execution: executionFixture(),
    runId: createManualLedgerRunId({ appId: APP_ID, idempotencyKey: boundary }),
    serviceId: createLedgerServiceId({ appId: APP_ID }),
    configuration: Object.freeze({
      adapterName: /** @type {const} */ ('lmdb'),
      controlPath: join(root, 'control'),
      tableName: 'readiness-crash-control',
      payloadPath,
      payloadStoreId: resolveExecutionPayloadStoreId(payloadPath),
      sessionPath: join(root, 'sessions'),
    }),
    applicationStateConfiguration: Object.freeze({
      adapterName: /** @type {const} */ ('lmdb'),
      storePath: join(root, 'application-state'),
      tableName: APPLICATION_STATE_TABLE_NAME,
    }),
  };
}

/** @typedef {ReturnType<typeof createFixture>} Fixture */

/** @param {Fixture} fixture @param {boolean} [readOnly] */
function openControl(fixture, readOnly = true) {
  const db = createLMDB({
    path: fixture.configuration.controlPath,
    readOnly,
  });
  const stores = { db, tableName: fixture.configuration.tableName };
  return {
    db,
    ledger: createExecutionLedger({
      ...stores,
      payloadStore: createLocalExecutionPayloadStore({
        path: fixture.configuration.payloadPath,
        storeId: fixture.configuration.payloadStoreId,
      }),
      effectEvidenceVerifiers: [...APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS],
    }),
    lifecycle: createLedgerServiceLifecycle(stores),
    ownership: createLedgerServiceOwnership(stores),
    authority: createCoordinatorAuthority(stores),
    readiness: createApplicationStateReadinessStore(stores),
  };
}

/** @param {Fixture} fixture */
async function seedTerminalHistory(fixture) {
  const { db, ledger } = openControl(fixture, false);
  try {
    const application = await openApplicationStateDB({
      configuration: fixture.applicationStateConfiguration,
    });
    try {
      // Epoch-zero history models the supported stopped legacy-writer cutover.
      const catalog = await createBuiltinManagedEffectCatalog({
        db: application.db,
        appId: APP_ID,
        adapterName: 'lmdb',
      });
      const handler = createBuiltinManagedEffectHandler({
        ledger,
        runId: fixture.runId,
        invocationId: MANUAL_LEDGER_INVOCATION_ID,
        catalog,
        actor: ACTOR,
      });
      await runManualLedgerActivity({
        ledger,
        runId: fixture.runId,
        appId: APP_ID,
        revisionId: fixture.execution.embeddedRevision.revision.revisionId,
        activityId: 'remember',
        input: { retained: true },
        callerMetadata: { fixture: 'readiness-real-sigkill' },
        actor: ACTOR,
        executeAttempt: async (startFrame, { signal }) => {
          const transcript = new ActivityProtocolTranscriptValidator();
          const start = transcript.acceptHostFrame(startFrame);
          const request = transcript.acceptComponentFrame({
            protocol: 'wharfie.activity',
            protocolVersion: 1,
            type: 'effect-request',
            attemptId: start.attemptId,
            sequence: 1,
            effectId: EFFECT_ID,
            capability: 'application-state',
            operation: 'put-if-absent',
            input: { key: BUSINESS_KEY, value: { retained: 'exactly-once' } },
            requestedReplayProperties: ['idempotent', 'transactional'],
          });
          const response = transcript.acceptHostFrame(
            await handler(request, { signal }),
          );
          const terminal = transcript.acceptComponentFrame({
            protocol: 'wharfie.activity',
            protocolVersion: 1,
            type: 'completed',
            attemptId: start.attemptId,
            sequence: 2,
            result: { retained: true },
          });
          return {
            status: terminal.type,
            start,
            terminal,
            frames: [start, request, response, terminal],
            transcript: transcript.snapshot(),
          };
        },
      });
    } finally {
      await application.close();
    }
  } finally {
    await db.close();
  }
}

/** @param {string} root @returns {Record<string, string>} */
function payloadBytes(root) {
  /** @type {Record<string, string>} */
  const snapshot = {};
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = join(root, entry.name);
    if (entry.isDirectory()) {
      for (const [relative, hash] of Object.entries(payloadBytes(target))) {
        snapshot[join(entry.name, relative)] = hash;
      }
    } else {
      snapshot[entry.name] = createHash('sha256')
        .update(readFileSync(target))
        .digest('hex');
    }
  }
  return snapshot;
}

/** @param {Fixture} fixture */
async function readControl(fixture) {
  const control = openControl(fixture);
  try {
    return {
      authority: await control.authority.get({ appId: APP_ID }),
      readiness: await control.readiness.get({ appId: APP_ID }),
      lifecycle: await control.lifecycle.get({ serviceId: fixture.serviceId }),
      ownership: await control.ownership.getOwnership({
        serviceId: fixture.serviceId,
      }),
      history: await control.ledger.rebuildRun(fixture.runId),
      directory: await control.ledger.listRuns({ appId: APP_ID, limit: 100 }),
      delivery: await control.ledger.readManagedEffectDelivery(
        fixture.runId,
        MANUAL_LEDGER_INVOCATION_ID,
        EFFECT_ID,
      ),
    };
  } finally {
    await control.db.close();
  }
}

/** @param {Fixture} fixture @param {string} destinationEffectId */
async function readDestination(fixture, destinationEffectId) {
  const application = await openApplicationStateDB({
    configuration: fixture.applicationStateConfiguration,
    readOnly: true,
  });
  try {
    const table = createApplicationStateTable({
      db: application.db,
      tableName: application.context.tableName,
    });
    const identity = await table.readStoreIdentity();
    if (!identity) throw new Error('Readiness proof lost its store identity.');
    const businessKey = createApplicationStateBusinessKey(APP_ID, BUSINESS_KEY);
    return {
      identity,
      barrier: await table.readCoordinatorAuthority({
        storeId: identity.store_id,
        namespace: APP_ID,
      }),
      receipt: await table.readReceipt(destinationEffectId),
      business: await table.readBusinessByPhysicalKey(
        businessKey.resourceId,
        businessKey.sortKey,
      ),
    };
  } finally {
    await application.close();
  }
}

/** @param {Fixture} fixture @param {'crash' | 'resident'} mode @returns {Child} */
function spawnChild(fixture, mode) {
  const child = spawn(
    process.execPath,
    [
      CHILD_PATH,
      JSON.stringify({
        mode,
        ...(mode === 'crash' ? { boundary: fixture.boundary } : {}),
        execution: fixture.execution,
        control: fixture.configuration,
        applicationState: fixture.applicationStateConfiguration,
      }),
    ],
    {
      cwd: fixture.root,
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  /** @type {(exit: ChildExit) => void} */
  let resolveExit = () => {};
  /** @type {Child} */
  const handle = {
    child,
    done: new Promise((resolve) => {
      resolveExit = resolve;
    }),
    messages: [],
    stdout: '',
    stderr: '',
  };
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => {
    handle.stdout += chunk;
  });
  child.stderr?.on('data', (chunk) => {
    handle.stderr += chunk;
  });
  child.on('message', (message) => {
    if (message && typeof message === 'object') handle.messages.push(message);
  });
  child.once('error', (error) => {
    handle.spawnError = error;
  });
  // close, not merely exit, also observes closure of the stdio and IPC handles.
  child.once('close', (code, signal) => {
    handle.exit = { code, signal };
    resolveExit(handle.exit);
  });
  return handle;
}

/** @param {Child} handle @param {string} label @returns {Error} */
function childFailure(handle, label) {
  const fatal = handle.messages.find((message) => message.kind === 'fatal');
  return new Error(
    `${label}: ${handle.spawnError?.message || fatal?.error || JSON.stringify(handle.exit)} stdout=${handle.stdout} stderr=${handle.stderr}`,
  );
}

/** @param {Child} handle @returns {Promise<ChildExit>} */
async function waitForExit(handle) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  try {
    return await Promise.race([
      handle.done,
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(childFailure(handle, 'Child did not exit')),
          10_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** @param {Child} handle @param {CrashBoundary} boundary */
async function waitForBoundary(handle, boundary) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const message = handle.messages.find(
      (candidate) => candidate.kind === 'boundary',
    );
    if (message) {
      expect(message.boundary).toBe(boundary);
      return message;
    }
    if (
      handle.exit ||
      handle.spawnError ||
      handle.messages.some((candidate) => candidate.kind === 'fatal')
    ) {
      throw childFailure(handle, 'Child exited before the readiness boundary');
    }
    await delay(10);
  }
  throw childFailure(handle, 'Timed out waiting for readiness boundary');
}

/** @param {Fixture} fixture @param {Child} handle @param {number} previousGeneration */
async function waitForReady(fixture, handle, previousGeneration) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (
      handle.exit ||
      handle.spawnError ||
      handle.messages.some((message) => message.kind === 'fatal')
    ) {
      throw childFailure(handle, 'Production resident failed before READY');
    }
    const state = await readControl(fixture);
    if (
      state.lifecycle?.status === LedgerServiceLifecycleStatus.READY &&
      state.lifecycle.generation > previousGeneration
    ) {
      return state;
    }
    await delay(10);
  }
  throw childFailure(handle, 'Production resident never reached READY');
}

/** @param {Fixture} fixture @param {string} sessionId */
function sessionScope(fixture, sessionId) {
  return {
    serviceId: fixture.serviceId,
    sessionId,
    sessionRoot: fixture.configuration.sessionPath,
  };
}

/** @param {Fixture} fixture @param {Child[]} children @param {Set<string>} knownSessions @returns {Promise<unknown[]>} */
async function cleanupFixture(fixture, children, knownSessions) {
  /** @type {unknown[]} */
  const errors = [];
  /** @param {() => unknown} operation */
  const attempt = async (operation) => {
    try {
      await operation();
    } catch (error) {
      errors.push(error);
    }
  };
  await Promise.all(
    children.map(async (child) => {
      await attempt(() => {
        if (!child.exit) child.child.kill('SIGKILL');
      });
      await attempt(() => waitForExit(child));
    }),
  );
  // Never remove a fixture store or a socket while any child can use it.
  if (children.some((child) => !child.exit)) {
    errors.push(
      new Error(`Unreaped crash-test child; retaining fixture ${fixture.root}`),
    );
    return errors;
  }
  await attempt(async () => {
    if (!existsSync(join(fixture.configuration.controlPath, 'lmdb'))) return;
    const control = openControl(fixture);
    try {
      // Cleanup must not depend on the history validation that may have failed.
      const ownership = await control.ownership.getOwnership({
        serviceId: fixture.serviceId,
      });
      if (ownership) knownSessions.add(ownership.sessionId);
    } finally {
      await attempt(() => control.db.close());
    }
  });
  for (const sessionId of knownSessions) {
    const scope = sessionScope(fixture, sessionId);
    await attempt(() =>
      rmSync(getLocalServiceSessionEndpoint(scope), { force: true }),
    );
    await attempt(() =>
      rmSync(getLocalServiceSessionOwnerCommandEndpoint(scope), {
        force: true,
      }),
    );
  }
  await attempt(() => rmSync(fixture.root, { recursive: true, force: true }));
  return errors;
}

/** @param {Fixture} fixture @param {Record<string, any>} reported @param {ChildExit} exit */
async function releaseKnownKilledAuthority(fixture, reported, exit) {
  assert.deepEqual(exit, { code: null, signal: 'SIGKILL' });
  const control = openControl(fixture, false);
  try {
    const observed = await control.authority.get({ appId: APP_ID });
    // IPC objects live in another realm; compare independently copied fields.
    assert.deepEqual({ ...observed }, { ...reported.coordinatorAuthority });
    assert.equal(observed?.coordinatorId, reported.ownership.sessionId);
    assert.equal(observed?.status, CoordinatorAuthorityStatus.ACTIVE);
    const takeoverRequest = {
      appId: APP_ID,
      coordinatorId: `readiness-known-killed:${fixture.boundary}`,
      requestId: `readiness-takeover:${fixture.boundary}`,
      observedAuthority: observed,
      confirmAuthorityReplacement: true,
    };
    const takeover = await control.authority.takeover(takeoverRequest);
    expect(takeover).toMatchObject({
      applied: true,
      authority: {
        status: CoordinatorAuthorityStatus.ACTIVE,
        epoch: reported.coordinatorAuthority.epoch + 1,
      },
    });
    const releaseRequest = {
      authority: takeover.authority,
      requestId: `readiness-release:${fixture.boundary}`,
    };
    const released = await control.authority.release(releaseRequest);
    expect(released).toMatchObject({
      applied: true,
      authority: {
        status: CoordinatorAuthorityStatus.RELEASED,
        epoch: takeover.authority.epoch,
      },
    });
    await expect(control.authority.takeover(takeoverRequest)).resolves.toEqual({
      ...takeover,
      applied: false,
    });
    await expect(control.authority.release(releaseRequest)).resolves.toEqual({
      ...released,
      applied: false,
    });
    await expect(control.authority.get({ appId: APP_ID })).resolves.toEqual(
      released.authority,
    );
    return released.authority;
  } finally {
    await control.db.close();
  }
}

/** @param {Awaited<ReturnType<typeof readControl>>} actual @param {Awaited<ReturnType<typeof readControl>>} retained */
function expectHistoryUnchanged(actual, retained) {
  expect(actual.history).toEqual(retained.history);
  expect(actual.directory).toEqual(retained.directory);
  expect(actual.delivery).toEqual(retained.delivery);
}

describe('real SIGKILL application-state readiness handoff', () => {
  testOnUnix.each(CASES)(
    'resumes $label only after inspected authority replacement',
    async ({ boundary }) => {
      const root = mkdtempSync(join(tmpdir(), 'wharfie-readiness-crash-'));
      const fixture = createFixture(root, boundary);
      /** @type {Child[]} */
      const children = [];
      /** @type {Set<string>} */
      const knownSessions = new Set();
      /** @type {{error: unknown} | undefined} */
      let failure;
      try {
        await seedTerminalHistory(fixture);
        const retained = await readControl(fixture);
        expect(retained.history).toMatchObject({
          run: { status: RunStatus.COMPLETED },
          invocations: [
            expect.objectContaining({ status: InvocationStatus.COMPLETED }),
          ],
          attempts: [
            expect.objectContaining({
              status: AttemptStatus.COMPLETED,
              coordinatorEpoch: 0,
            }),
          ],
          effects: [
            expect.objectContaining({ status: EffectStatus.COMPLETED }),
          ],
        });
        expect(retained.authority).toBeNull();
        expect(retained.readiness).toBeNull();
        const effect = retained.history?.effects[0];
        if (!effect)
          throw new Error('Crash proof requires its retained effect.');
        const original = await readDestination(
          fixture,
          effect.destinationEffectId,
        );
        expect(original.barrier).toBeNull();
        expect(original.business).toMatchObject({
          value: { retained: 'exactly-once' },
        });
        expect(original.receipt).not.toBeNull();
        const originalPayloads = payloadBytes(
          fixture.configuration.payloadPath,
        );

        const predecessor = spawnChild(fixture, 'crash');
        children.push(predecessor);
        const reported = await waitForBoundary(predecessor, boundary);
        knownSessions.add(reported.ownership.sessionId);
        const paused = await readControl(fixture);
        expect(paused.lifecycle).toMatchObject({
          status: LedgerServiceLifecycleStatus.STARTING,
          generation: 1,
          sessionId: reported.ownership.sessionId,
        });
        expect(paused.ownership).toEqual(reported.ownership);
        expect(paused.authority).toEqual(reported.coordinatorAuthority);
        expect(paused.authority).toMatchObject({
          status: CoordinatorAuthorityStatus.ACTIVE,
          epoch: 1,
        });
        expect(paused.readiness).toMatchObject({
          status: 'PREPARING',
          store_id: original.identity.store_id,
        });
        expect(applicationStateReadinessAuthority(paused.readiness)).toEqual(
          createCoordinatorAuthorityToken(reported.coordinatorAuthority),
        );
        expectHistoryUnchanged(paused, retained);
        const pausedDestination = await readDestination(
          fixture,
          effect.destinationEffectId,
        );
        expect(pausedDestination).toEqual({
          ...original,
          barrier:
            boundary === 'preparing-committed'
              ? null
              : createApplicationStateCoordinatorAuthorityRecord({
                  storeId: original.identity.store_id,
                  namespace: APP_ID,
                  authority: createCoordinatorAuthorityToken(
                    reported.coordinatorAuthority,
                  ),
                }),
        });
        const oldScope = sessionScope(fixture, reported.ownership.sessionId);
        expect(existsSync(getLocalServiceSessionEndpoint(oldScope))).toBe(true);
        expect(
          existsSync(getLocalServiceSessionOwnerCommandEndpoint(oldScope)),
        ).toBe(false);
        expect(predecessor.child.kill('SIGKILL')).toBe(true);
        const killed = await waitForExit(predecessor);
        expect(killed).toEqual({ code: null, signal: 'SIGKILL' });
        expect(predecessor.stdout).toBe('');
        expect(predecessor.stderr).toBe('');
        await expect(probeLocalServiceSession(oldScope)).resolves.toMatchObject(
          { status: 'absent' },
        );
        await expect(readControl(fixture)).resolves.toEqual(paused);
        await expect(
          readDestination(fixture, effect.destinationEffectId),
        ).resolves.toEqual(pausedDestination);

        // A dead process and an absent listener do not implicitly release its
        // durable ACTIVE token. Try the real ordinary restart before recovery.
        const refused = spawnChild(fixture, 'resident');
        children.push(refused);
        expect(await waitForExit(refused)).toEqual({ code: 1, signal: null });
        expect(refused.messages).toEqual([
          expect.objectContaining({
            kind: 'fatal',
            name: 'CoordinatorAuthorityConflictError',
          }),
        ]);
        const afterRefusal = await readControl(fixture);
        expect(afterRefusal.authority).toEqual(paused.authority);
        expect(afterRefusal.readiness).toEqual(paused.readiness);
        expect(afterRefusal.ownership).toBeNull();
        expect(afterRefusal.lifecycle).toMatchObject({
          status: LedgerServiceLifecycleStatus.STOPPED,
          generation: 2,
        });
        expectHistoryUnchanged(afterRefusal, retained);
        await expect(
          readDestination(fixture, effect.destinationEffectId),
        ).resolves.toEqual(pausedDestination);

        const released = await releaseKnownKilledAuthority(
          fixture,
          reported,
          killed,
        );
        const beforeResume = await readControl(fixture);
        expect(beforeResume.authority).toEqual(released);
        expect(beforeResume.readiness).toEqual(paused.readiness);
        expectHistoryUnchanged(beforeResume, retained);
        await expect(
          readDestination(fixture, effect.destinationEffectId),
        ).resolves.toEqual(pausedDestination);

        let previousEpoch = released.epoch;
        let previousGeneration = 2;
        // Both replacement and another clean process restart use the same
        // retained stores with no fixture-owned native handles held open.
        for (let boot = 0; boot < 2; boot += 1) {
          const resident = spawnChild(fixture, 'resident');
          children.push(resident);
          const ready = await waitForReady(
            fixture,
            resident,
            previousGeneration,
          );
          const lifecycle = ready.lifecycle;
          if (!lifecycle || !ready.authority || !ready.readiness) {
            throw new Error(
              'READY requires lifecycle, authority, and readiness.',
            );
          }
          knownSessions.add(lifecycle.sessionId);
          const token = createCoordinatorAuthorityToken(ready.authority);
          expect(token.epoch).toBe(previousEpoch + 1);
          expect(token.coordinatorId).toBe(lifecycle.sessionId);
          expect(token.coordinatorId).not.toBe(reported.ownership.sessionId);
          expect(ready.authority.status).toBe(
            CoordinatorAuthorityStatus.ACTIVE,
          );
          expect(ready.readiness.status).toBe('ADOPTED');
          expect(applicationStateReadinessAuthority(ready.readiness)).toEqual(
            token,
          );
          expect(applicationStateReadinessDestination(ready.readiness)).toEqual(
            effect.destination,
          );
          expect(ready.ownership).toMatchObject({
            sessionId: lifecycle.sessionId,
            ownerKind: 'resident',
          });
          expectHistoryUnchanged(ready, retained);
          const destination = await readDestination(
            fixture,
            effect.destinationEffectId,
          );
          expect(destination).toEqual({
            ...original,
            barrier: createApplicationStateCoordinatorAuthorityRecord({
              storeId: original.identity.store_id,
              namespace: APP_ID,
              authority: token,
            }),
          });
          expect(destination.barrier?.record_digest).toBe(
            ready.readiness.destination_authority_digest,
          );
          const scope = sessionScope(fixture, lifecycle.sessionId);
          expect(existsSync(getLocalServiceSessionEndpoint(scope))).toBe(true);
          expect(
            existsSync(getLocalServiceSessionOwnerCommandEndpoint(scope)),
          ).toBe(true);

          expect(resident.child.kill('SIGTERM')).toBe(true);
          expect(await waitForExit(resident)).toEqual({
            code: 0,
            signal: null,
          });
          expect(resident.messages).toEqual([
            { kind: 'stopped', result: { processed: 0 } },
          ]);
          expect(resident.stdout).toBe('');
          expect(resident.stderr).toBe('');
          const stopped = await readControl(fixture);
          expect(stopped.authority).toMatchObject({
            status: CoordinatorAuthorityStatus.RELEASED,
            epoch: token.epoch,
            coordinatorId: lifecycle.sessionId,
          });
          expect(stopped.lifecycle).toMatchObject({
            status: LedgerServiceLifecycleStatus.STOPPED,
            generation: previousGeneration + 1,
          });
          expect(stopped.ownership).toBeNull();
          expect(stopped.readiness).toEqual(ready.readiness);
          expectHistoryUnchanged(stopped, retained);
          await expect(
            readDestination(fixture, effect.destinationEffectId),
          ).resolves.toEqual(destination);
          expect(existsSync(getLocalServiceSessionEndpoint(scope))).toBe(false);
          expect(
            existsSync(getLocalServiceSessionOwnerCommandEndpoint(scope)),
          ).toBe(false);
          expect(payloadBytes(fixture.configuration.payloadPath)).toEqual(
            originalPayloads,
          );
          previousEpoch = token.epoch;
          previousGeneration = lifecycle.generation;
        }
      } catch (error) {
        failure = { error };
      }
      const cleanupErrors = await cleanupFixture(
        fixture,
        children,
        knownSessions,
      );
      if (failure) {
        if (cleanupErrors.length) {
          throw new AggregateError(
            [failure.error, ...cleanupErrors],
            'Readiness crash test and fixture cleanup failed',
            { cause: failure.error },
          );
        }
        throw failure.error;
      }
      if (cleanupErrors.length) {
        throw new AggregateError(
          cleanupErrors,
          'Readiness crash fixture cleanup failed',
        );
      }
    },
    60_000,
  );
});
