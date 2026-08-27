/* eslint-env jest */

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  assertBlockedBootEvidence,
  observeBlockedBoot,
  readBootNativeEvidence,
  readBootNativeObservation,
  runBootCheckCommand,
  runBootReadOnlyCommand,
  validateBootConfig,
} from '../systemd/boot-check.js';
import createVanillaDB from '../../src/core/lib/db/adapters/vanilla.js';
import { APPLICATION_STATE_TABLE_NAME } from '../../src/core/lib/config/db.js';
import { createApplicationStateTable } from '../../src/core/lib/db/tables/application-state.js';
import { createApplicationStateReadinessStore } from '../../src/core/lib/db/tables/application-state-readiness.js';
import { createCoordinatorAuthority } from '../../src/core/lib/db/tables/coordinator-authority.js';
import {
  createLedgerServiceId,
  createLedgerServiceLifecycle,
  createLedgerServiceOwnership,
  createLedgerServiceSessionId,
} from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import { LOCAL_APP_EXECUTION_LEDGER_TABLE } from '../../src/core/runtime/local-app-storage.js';
import { createCoordinatorAuthorityInspectionDocument } from '../../src/core/runtime/operator/coordinator-authority-command.js';

const APP_ID = 'boot-proof';
const ARTIFACT_ID = `waf1_${'A'.repeat(43)}`;
const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const OLD_BOOT = '00000000-0000-4000-8000-000000000001';
const NEW_BOOT = '00000000-0000-4000-8000-000000000002';
const INSTALLED_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TABLE_NAME = LOCAL_APP_EXECUTION_LEDGER_TABLE;
/** @typedef {Awaited<ReturnType<typeof fixture>>} Fixture */
/** @type {Array<() => Promise<void>>} */
const cleanups = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** @param {() => unknown} action @returns {unknown} */
function captureFailure(action) {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('Expected the operation to fail.');
}

/** @param {Record<string, any>} parsed @param {number} [status] */
function commandObservation(parsed, status = 0) {
  return {
    result: { status, stdout: JSON.stringify(parsed), stderr: '' },
    parsed: clone(parsed),
  };
}

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'wharfie-boot-check-'));
  const home = join(root, 'proof');
  const stateRoot = join(
    home,
    '.local',
    'share',
    'wharfie-nodejs',
    'applications',
    APP_ID,
    'state',
  );
  const controlPath = join(stateRoot, 'control');
  const applicationStatePath = join(stateRoot, 'application-state');
  // These are physical-file preconditions only. A mutation-refusing read-only
  // adapter port below exercises production record validation without LMDB.
  for (const storePath of [controlPath, applicationStatePath]) {
    mkdirSync(join(storePath, 'lmdb'), { recursive: true });
    for (const name of ['data.mdb', 'lock.mdb']) {
      writeFileSync(join(storePath, 'lmdb', name), `${storePath}:${name}`, {
        flag: 'wx',
      });
    }
  }
  const controlDB = createVanillaDB({ path: controlPath });
  const applicationDB = createVanillaDB({ path: applicationStatePath });
  cleanups.push(async () => {
    await applicationDB.close();
    await controlDB.close();
    rmSync(root, { recursive: true, force: true });
  });
  const serviceId = createLedgerServiceId({ appId: APP_ID });
  const previousSessionId = createLedgerServiceSessionId();
  const authorityStore = createCoordinatorAuthority({
    db: controlDB,
    tableName: TABLE_NAME,
  });
  const { authority } = await authorityStore.acquire({
    appId: APP_ID,
    coordinatorId: previousSessionId,
    requestId: 'old-resident-acquisition',
    observedAt: 10,
  });
  const applicationTable = createApplicationStateTable({
    db: applicationDB,
    tableName: APPLICATION_STATE_TABLE_NAME,
    coordinatorAuthority: authority,
  });
  const identity = await applicationTable.ensureStoreIdentity();
  const destination = {
    kind: 'application-state',
    version: 2,
    bindingId: 'primary',
    configuration: {
      provider: 'lmdb',
      storeId: identity.store_id,
      tableName: APPLICATION_STATE_TABLE_NAME,
      namespace: APP_ID,
    },
  };
  const readinessStore = createApplicationStateReadinessStore({
    db: controlDB,
    tableName: TABLE_NAME,
    coordinatorAuthority: authority,
  });
  const preparation = await readinessStore.prepare({ destination });
  const barrier = await applicationTable.readCoordinatorAuthority({
    storeId: identity.store_id,
    namespace: APP_ID,
  });
  const readiness = await readinessStore.markAdopted({
    preparation,
    destinationAuthority: barrier,
  });
  const lifecycleStore = createLedgerServiceLifecycle({
    db: controlDB,
    tableName: TABLE_NAME,
  });
  await lifecycleStore.start({
    serviceId,
    appId: APP_ID,
    revisionId: REVISION_ID,
    artifactId: ARTIFACT_ID,
    sessionId: previousSessionId,
    observedAt: 20,
  });
  const sessionId = createLedgerServiceSessionId();
  const started = await lifecycleStore.start({
    serviceId,
    appId: APP_ID,
    revisionId: REVISION_ID,
    artifactId: ARTIFACT_ID,
    sessionId,
    observedAt: 30,
  });
  const transition = {
    serviceId,
    sessionId,
    generation: started.lifecycle.generation,
  };
  await lifecycleStore.markStopping({ ...transition, observedAt: 31 });
  const { lifecycle } = await lifecycleStore.markStopped({
    ...transition,
    observedAt: 32,
  });
  const config = {
    schemaVersion: 2,
    kind: 'wharfie.systemd-proof.boot-config',
    commit: 'a'.repeat(40),
    user: 'proof',
    uid: 1000,
    gid: 1000,
    home,
    artifactPath: join(root, 'proof-artifact'),
    releasePath: join(root, 'installed-release'),
    unitPath: join(
      home,
      '.config',
      'systemd',
      'user',
      `wharfie-${APP_ID}.service`,
    ),
    xdgDataHome: join(home, '.local', 'share'),
    appId: APP_ID,
    artifactId: ARTIFACT_ID,
    revisionId: REVISION_ID,
    runId: `wfr_${'A'.repeat(43)}`,
    timer: { timerId: `wft_${'A'.repeat(43)}`, scheduledAt: 40, dueAt: 50 },
    previousBootId: OLD_BOOT,
    minimumGeneration: 1,
    receiptPath: join(root, 'receipt.json'),
    previousAuthority: authority,
    previousReadiness: readiness,
    installedPackageRoot: INSTALLED_ROOT.slice(0, -1),
  };
  const unit = `wharfie-${APP_ID}.service`;
  const evidence = {
    status: {
      schemaVersion: 3,
      kind: 'wharfie.service.status',
      appId: APP_ID,
      unit,
      desiredConvergence: {
        schemaVersion: 1,
        kind: 'wharfie.service.desired-convergence',
        appId: APP_ID,
        unit,
        desired: { artifactId: ARTIFACT_ID, revisionId: REVISION_ID },
        disposition: 'authorized',
        basis: 'durable-active',
      },
      health: 'starting',
      installation: {
        activeArtifactId: ARTIFACT_ID,
        activeRevisionId: REVISION_ID,
      },
      persistence: { linger: true, unitEnabled: true, bootEnabled: true },
      integrity: { status: 'verified' },
      systemd: { fragmentPath: config.unitPath, dropInPaths: '', mainPid: 0 },
      runtime: {
        status: 'STOPPED',
        artifactId: ARTIFACT_ID,
        revisionId: REVISION_ID,
        generation: lifecycle.generation,
        session: 'absent',
        currentOwner: false,
      },
    },
    workflow: {
      run: { runId: config.runId, status: 'RUNNING' },
      workflowCursor: {
        disposition: 'TIMER_WAITING',
        timerId: config.timer.timerId,
      },
      timers: [{ ...config.timer, status: 'WAITING' }],
    },
    coordinatorInspection: createCoordinatorAuthorityInspectionDocument(
      APP_ID,
      authority,
    ),
    readinessEvidence: {
      lifecycle,
      ownership: null,
      readiness,
      authority,
      storeIdentity: identity,
      destinationAuthority: barrier,
    },
  };
  const mutation = jest.fn(async () => {
    throw new Error('boot observer attempted a write');
  });
  /** @type {Array<{path: string, readOnly: true}>} */
  const opens = [];
  /** @type {string[]} */
  const closes = [];
  /** @type {{afterApplicationClose?: () => Promise<void>}} */
  const hooks = {};
  const nativePorts = {
    openReadOnlyDB(/** @type {{path: string, readOnly: true}} */ options) {
      expect(options.readOnly).toBe(true);
      expect([controlPath, applicationStatePath]).toContain(options.path);
      opens.push(options);
      const db = options.path === controlPath ? controlDB : applicationDB;
      return {
        ...db,
        put: mutation,
        update: mutation,
        remove: mutation,
        batchWrite: mutation,
        transactionWrite: mutation,
        async close() {
          closes.push(options.path);
          if (
            options.path === applicationStatePath &&
            hooks.afterApplicationClose
          ) {
            await hooks.afterApplicationClose();
          }
        },
      };
    },
  };
  let clock = 1_000;
  const bootPorts = {
    readBootId: jest.fn((/** @type {number} */ _timeoutMs) => NEW_BOOT),
    readSessions: jest.fn(
      (/** @type {number} */ _uid, /** @type {number} */ _timeoutMs) =>
        /** @type {string[]} */ ([]),
    ),
    readStatus: jest.fn(
      (
        /** @type {Readonly<Record<string, any>>} */ _config,
        /** @type {number} */ _timeoutMs,
      ) => commandObservation(evidence.status, 3),
    ),
    inspectRun: jest.fn(
      (
        /** @type {Readonly<Record<string, any>>} */ _config,
        /** @type {number} */ _timeoutMs,
      ) => commandObservation(evidence.workflow),
    ),
    inspectCoordinator: jest.fn(
      (
        /** @type {Readonly<Record<string, any>>} */ _config,
        /** @type {number} */ _timeoutMs,
      ) => commandObservation(evidence.coordinatorInspection),
    ),
    readNative: jest.fn(
      (
        /** @type {Readonly<Record<string, any>>} */ _config,
        /** @type {number} */ _timeoutMs,
      ) => commandObservation(evidence.readinessEvidence),
    ),
    monotonicNow: () => clock,
    wallClockNow: () => 1_700_000_000_000 + clock,
    sleep: (/** @type {number} */ duration) => {
      clock += duration;
    },
    timeoutMs: 1,
  };
  return {
    root,
    config,
    evidence,
    controlPath,
    applicationStatePath,
    controlDB,
    applicationDB,
    authorityStore,
    lifecycleStore,
    serviceId,
    nativePorts,
    opens,
    closes,
    mutation,
    hooks,
    bootPorts,
  };
}

describe('fail-closed pre-login boot observer', () => {
  test('returns v2 evidence for a new failed attempt even when status exits nonzero', async () => {
    const value = await fixture();
    const receipt = observeBlockedBoot(value.config, value.bootPorts);
    expect(receipt).toMatchObject({
      schemaVersion: 2,
      kind: 'wharfie.systemd-proof.boot-receipt',
      commit: value.config.commit,
      automaticStart: false,
      automaticStartAttempt: true,
      recoveryRequired: 'explicit-coordinator-takeover',
      statusExitCode: 3,
      bootId: NEW_BOOT,
      previousBootId: OLD_BOOT,
      sessionsBeforeCheck: [],
      sessionsAfterCheck: [],
      ...value.evidence,
    });
    expect(value.bootPorts.readStatus).toHaveBeenCalledTimes(2);
    expect(value.bootPorts.readSessions).toHaveBeenCalledTimes(2);
    expect(value.bootPorts.readBootId).toHaveBeenCalledWith(1);
    expect(value.bootPorts.readSessions.mock.calls).toEqual([
      [value.config.uid, 1],
      [value.config.uid, 1],
    ]);
    expect(value.bootPorts.readStatus.mock.calls).toEqual([
      [value.config, 1],
      [value.config, 1],
    ]);
    expect(value.bootPorts.inspectRun).toHaveBeenCalledWith(value.config, 1);
    expect(value.bootPorts.inspectCoordinator).toHaveBeenCalledWith(
      value.config,
      1,
    );
    expect(value.bootPorts.readNative).toHaveBeenCalledWith(value.config, 1);
    expect(existsSync(value.config.receiptPath)).toBe(false);
  });

  test('shares one decreasing deadline across readers and refuses aggregate exhaustion', async () => {
    const value = await fixture();
    value.bootPorts.timeoutMs = 12;
    /** @type {Array<[string, number]>} */
    const budgets = [];
    const spend = (/** @type {number} */ duration) => {
      value.bootPorts.sleep(duration);
    };
    value.bootPorts.readBootId.mockImplementation((budget) => {
      budgets.push(['boot-id', budget]);
      spend(1);
      return NEW_BOOT;
    });
    value.bootPorts.readSessions.mockImplementation((_uid, budget) => {
      budgets.push(['sessions-before', budget]);
      spend(1);
      return [];
    });
    value.bootPorts.readStatus.mockImplementation((_config, budget) => {
      budgets.push(['status', budget]);
      spend(2);
      return commandObservation(value.evidence.status, 3);
    });
    value.bootPorts.inspectRun.mockImplementation((_config, budget) => {
      budgets.push(['workflow', budget]);
      spend(2);
      return commandObservation(value.evidence.workflow);
    });
    value.bootPorts.inspectCoordinator.mockImplementation((_config, budget) => {
      budgets.push(['coordinator', budget]);
      spend(2);
      return commandObservation(value.evidence.coordinatorInspection);
    });
    value.bootPorts.readNative.mockImplementation((_config, budget) => {
      budgets.push(['native', budget]);
      spend(4);
      return commandObservation(value.evidence.readinessEvidence);
    });

    expect(() => observeBlockedBoot(value.config, value.bootPorts)).toThrow(
      /shared 12ms monotonic operation deadline/,
    );
    expect(budgets).toEqual([
      ['boot-id', 12],
      ['sessions-before', 11],
      ['status', 10],
      ['workflow', 8],
      ['coordinator', 6],
      ['native', 4],
    ]);
    expect(value.bootPorts.readStatus).toHaveBeenCalledTimes(1);
    expect(value.bootPorts.readSessions).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['frozen', () => 1_700_000_000_000],
    [
      'backward',
      (() => {
        let now = 1_700_000_000_000;
        return () => (now -= 10_000);
      })(),
    ],
  ])(
    'uses a monotonic deadline when the wall clock moves %s',
    async (_label, wallClock) => {
      const value = await fixture();
      const productionPorts = { ...value.bootPorts };
      Reflect.deleteProperty(productionPorts, 'monotonicNow');
      Reflect.deleteProperty(productionPorts, 'wallClockNow');
      Reflect.deleteProperty(productionPorts, 'sleep');
      productionPorts.timeoutMs = 25;
      productionPorts.readNative.mockReturnValue(
        commandObservation(value.evidence.readinessEvidence, 1),
      );
      const dateNow = jest.spyOn(Date, 'now').mockImplementation(wallClock);
      try {
        const startedAt = process.hrtime.bigint();
        expect(() => observeBlockedBoot(value.config, productionPorts)).toThrow(
          /shared 25ms monotonic operation deadline/,
        );
        const elapsedMs = Number(
          (process.hrtime.bigint() - startedAt) / 1_000_000n,
        );
        expect(elapsedMs).toBeGreaterThanOrEqual(20);
        expect(elapsedMs).toBeLessThan(1_000);
      } finally {
        dateNow.mockRestore();
      }
    },
  );

  test('uses the wall clock only for the receipt timestamp', async () => {
    const value = await fixture();
    value.bootPorts.wallClockNow = jest.fn(() => 1_800_000_000_123);
    const receipt = observeBlockedBoot(value.config, value.bootPorts);
    expect(receipt.observedAt).toBe(1_800_000_000_123);
    expect(value.bootPorts.wallClockNow).toHaveBeenCalledTimes(1);
  });

  test.each([0, -1, 1.5, Number.NaN, 120_001])(
    'rejects invalid shared timeout %p before any observation',
    async (timeoutMs) => {
      const value = await fixture();
      value.bootPorts.timeoutMs = timeoutMs;
      expect(() => observeBlockedBoot(value.config, value.bootPorts)).toThrow(
        TypeError,
      );
      expect(value.bootPorts.readBootId).not.toHaveBeenCalled();
    },
  );

  /** @type {Array<[string, (value: Record<string, any>) => void]>} */
  const invalidConfigs = [
    [
      'old schema',
      (value) => {
        value.schemaVersion = 1;
      },
    ],
    [
      'missing authority',
      (value) => {
        delete value.previousAuthority;
      },
    ],
    [
      'bare token',
      (value) => {
        delete value.previousAuthority.lastRequestId;
      },
    ],
    [
      'released authority',
      (value) => {
        value.previousAuthority.status = 'RELEASED';
      },
    ],
    [
      'unadopted pin',
      (value) => {
        value.previousReadiness.status = 'PREPARING';
      },
    ],
    [
      'different pin authority',
      (value) => {
        value.previousReadiness.epoch += 1;
      },
    ],
    [
      'unscoped package root',
      (value) => {
        value.installedPackageRoot = '../source';
      },
    ],
    [
      'unexpected key',
      (value) => {
        value.automaticRecovery = true;
      },
    ],
  ];
  test.each(invalidConfigs)(
    'rejects config with %s',
    async (_label, change) => {
      const value = await fixture();
      const config = clone(value.config);
      change(config);
      expect(() => validateBootConfig(config)).toThrow();
    },
  );

  /** @type {Array<[string, (value: Record<string, any>) => void]>} */
  const invalidEvidence = [
    [
      'healthy success',
      (value) => {
        value.status.health = 'healthy';
      },
    ],
    [
      'old generation',
      (value) => {
        value.status.runtime.generation = 1;
      },
    ],
    [
      'READY runtime',
      (value) => {
        value.status.runtime.status = 'READY';
      },
    ],
    [
      'live session',
      (value) => {
        value.status.runtime.session = 'active';
      },
    ],
    [
      'current owner',
      (value) => {
        value.status.runtime.currentOwner = true;
      },
    ],
    [
      'live systemd PID',
      (value) => {
        value.status.systemd.mainPid = 123;
      },
    ],
    [
      'live runtime PID',
      (value) => {
        value.status.runtime.processId = 123;
      },
    ],
    [
      'changed full authority metadata',
      (value) => {
        value.coordinatorInspection.observedAuthority.heartbeatAt += 1;
      },
    ],
    [
      'changed retained source authority',
      (value) => {
        value.readinessEvidence.authority.recordVersion += 1;
      },
    ],
    [
      'changed pin',
      (value) => {
        value.readinessEvidence.readiness.status = 'PREPARING';
      },
    ],
    [
      'retained local ownership',
      (value) => {
        value.readinessEvidence.ownership = { ownerKind: 'resident' };
      },
    ],
    [
      'mismatched raw lifecycle',
      (value) => {
        value.readinessEvidence.lifecycle.generation += 1;
      },
    ],
    [
      'different store identity',
      (value) => {
        value.readinessEvidence.storeIdentity.store_id = 'replacement';
      },
    ],
    [
      'advanced destination barrier',
      (value) => {
        value.readinessEvidence.destinationAuthority.epoch += 1;
      },
    ],
    [
      'altered destination digest',
      (value) => {
        value.readinessEvidence.destinationAuthority.record_digest = 'wrong';
      },
    ],
    [
      'fired timer',
      (value) => {
        value.workflow.timers[0].status = 'FIRED';
      },
    ],
    [
      'changed deadline',
      (value) => {
        value.workflow.timers[0].dueAt += 1;
      },
    ],
    [
      'changed workflow',
      (value) => {
        value.workflow.run.status = 'COMPLETED';
      },
    ],
  ];
  test.each(invalidEvidence)(
    'refuses %s instead of claiming automatic success',
    async (_label, change) => {
      const value = await fixture();
      const evidence = clone(value.evidence);
      change(evidence);
      expect(() => assertBlockedBootEvidence(value.config, evidence)).toThrow();
    },
  );

  test('same boot ID or an existing login prevents all unprivileged observations', async () => {
    const value = await fixture();
    value.bootPorts.readBootId.mockReturnValue(OLD_BOOT);
    expect(() => observeBlockedBoot(value.config, value.bootPorts)).toThrow(
      'VM boot ID did not change',
    );
    expect(value.bootPorts.readStatus).not.toHaveBeenCalled();
    value.bootPorts.readBootId.mockReturnValue(NEW_BOOT);
    value.bootPorts.readSessions.mockReturnValue(['3 1000 proof']);
    expect(() => observeBlockedBoot(value.config, value.bootPorts)).toThrow(
      'login session before',
    );
    expect(value.bootPorts.readStatus).not.toHaveBeenCalled();
  });

  test('refuses a login or another restart during observation', async () => {
    const value = await fixture();
    value.bootPorts.readSessions
      .mockReturnValueOnce([])
      .mockReturnValueOnce(['3 1000 proof'])
      .mockReturnValue([]);
    value.bootPorts.timeoutMs = 500;
    expect(() => observeBlockedBoot(value.config, value.bootPorts)).toThrow(
      'logged in during',
    );
    expect(value.bootPorts.readSessions).toHaveBeenCalledTimes(2);
    value.bootPorts.timeoutMs = 1;
    value.bootPorts.readSessions.mockReturnValue([]);
    const changed = clone(value.evidence.status);
    changed.runtime.generation += 1;
    value.bootPorts.readStatus
      .mockReturnValueOnce(commandObservation(value.evidence.status))
      .mockReturnValueOnce(commandObservation(changed));
    expect(() => observeBlockedBoot(value.config, value.bootPorts)).toThrow(
      'lifecycle changed',
    );
  });

  test('does not accept native evidence from a failed read-only child', async () => {
    const value = await fixture();
    value.bootPorts.readNative.mockReturnValue(
      commandObservation(value.evidence.readinessEvidence, 1),
    );
    expect(() => observeBlockedBoot(value.config, value.bootPorts)).toThrow(
      'fail-closed startup attempt',
    );
  });

  test('uses fixed argv, a clean environment and setpriv without creating a login', async () => {
    const value = await fixture();
    const execute = jest.fn(
      /** @type {NonNullable<Parameters<typeof runBootReadOnlyCommand>[2]>} */
      (
        () => ({
          status: 3,
          stdout: JSON.stringify(value.evidence.status),
          stderr: 'blocked',
        })
      ),
    );
    const observed = runBootReadOnlyCommand(
      value.config,
      [value.config.artifactPath, 'wharfie', 'service', 'status', '--json'],
      execute,
    );
    expect(observed.parsed).toEqual(value.evidence.status);
    expect(observed.result.status).toBe(3);
    expect(execute).toHaveBeenCalledWith(
      '/usr/bin/setpriv',
      [
        '--reuid=1000',
        '--regid=1000',
        '--init-groups',
        '/usr/bin/env',
        '-i',
        `HOME=${value.config.home}`,
        'USER=proof',
        'LOGNAME=proof',
        `XDG_DATA_HOME=${value.config.xdgDataHome}`,
        'XDG_RUNTIME_DIR=/run/user/1000',
        'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus',
        'LANG=C.UTF-8',
        'PATH=/usr/bin:/bin',
        value.config.artifactPath,
        'wharfie',
        'service',
        'status',
        '--json',
      ],
      { allowFailure: true, timeoutMs: 120_000 },
    );
    execute.mockReturnValue({ status: 1, stdout: 'not JSON', stderr: 'error' });
    expect(
      runBootReadOnlyCommand(value.config, [value.config.artifactPath], execute)
        .parsed,
    ).toBeUndefined();
  });

  const posixTest = process.platform === 'win32' ? test.skip : test;
  test('preserves child status and both output channels through the supervisor', () => {
    const result = runBootCheckCommand(
      process.execPath,
      [
        '--eval',
        "process.stdout.write('protocol-out'); process.stderr.write('protocol-err'); process.exitCode = 7;",
      ],
      { allowFailure: true, timeoutMs: 2_000 },
    );
    expect(result).toEqual({
      status: 7,
      stdout: 'protocol-out',
      stderr: 'protocol-err',
    });
  });

  posixTest(
    'hard-kills the timed-out reader process group and leaves both PIDs gone',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'wharfie-boot-reader-timeout-'));
      cleanups.push(async () => rmSync(root, { recursive: true, force: true }));
      const parentPidPath = join(root, 'reader.pid');
      const grandchildPidPath = join(root, 'grandchild.pid');
      const grandchildPath = join(root, 'trapped-grandchild.cjs');
      const childPath = join(root, 'trapped-reader.cjs');
      writeFileSync(
        grandchildPath,
        [
          "'use strict';",
          "const { writeFileSync } = require('node:fs');",
          "process.on('SIGTERM', () => {});",
          `writeFileSync(${JSON.stringify(grandchildPidPath)}, String(process.pid));`,
          'setInterval(() => {}, 1_000);',
        ].join('\n'),
      );
      writeFileSync(
        childPath,
        [
          "'use strict';",
          "const { spawn } = require('node:child_process');",
          "const { writeFileSync } = require('node:fs');",
          "process.on('SIGTERM', () => {});",
          `writeFileSync(${JSON.stringify(parentPidPath)}, String(process.pid));`,
          `spawn(process.execPath, [${JSON.stringify(grandchildPath)}], { stdio: ['ignore', 'inherit', 'inherit'] });`,
          'setInterval(() => {}, 1_000);',
        ].join('\n'),
      );

      const startedAt = Date.now();
      const failure = captureFailure(() =>
        runBootCheckCommand(process.execPath, [childPath], { timeoutMs: 500 }),
      );
      const elapsedMs = Date.now() - startedAt;

      expect(failure).toHaveProperty('code', 'ETIMEDOUT');
      expect(elapsedMs).toBeGreaterThanOrEqual(350);
      expect(elapsedMs).toBeLessThan(1_000);
      expect(existsSync(parentPidPath)).toBe(true);
      expect(existsSync(grandchildPidPath)).toBe(true);
      const pids = [parentPidPath, grandchildPidPath].map((pidPath) =>
        Number(readFileSync(pidPath, 'utf8')),
      );
      for (const pid of pids) {
        expect(Number.isSafeInteger(pid)).toBe(true);
        expect(pid).toBeGreaterThan(0);
        const deadline = Date.now() + 2_000;
        let failure;
        while (Date.now() < deadline) {
          try {
            process.kill(pid, 0);
            failure = undefined;
          } catch (error) {
            failure = error;
          }
          if (
            failure &&
            typeof failure === 'object' &&
            'code' in failure &&
            failure.code === 'ESRCH'
          ) {
            break;
          }
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        }
        expect(failure).toHaveProperty('code', 'ESRCH');
      }
    },
  );

  test('the Linux proof freezes retries before binding retained evidence to the stable generation', () => {
    const source = readFileSync(
      join(INSTALLED_ROOT, 'scripts/verify-systemd-user-service-linux.js'),
      'utf8',
    );
    const start = source.indexOf('async function waitForBlockedRestart(');
    const end = source.indexOf('function stopSupervisorForRecovery()', start);
    const body = source.slice(start, end);
    const observed = body.indexOf('const observedStatus = await waitFor(');
    const stopped = body.indexOf(
      'const stopped = stopSupervisorForRecovery();',
    );
    const stable = body.indexOf(
      'const status = readServiceStatus(artifactPath);',
    );
    const retained = body.indexOf(
      'const retained = await readApplicationStateHandoff();',
    );
    const bound = body.indexOf(
      'assert.equal(retained.lifecycle.generation, status.runtime.generation);',
    );
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(observed).toBeGreaterThanOrEqual(0);
    expect(stopped).toBeGreaterThan(observed);
    expect(stable).toBeGreaterThan(stopped);
    expect(retained).toBeGreaterThan(stable);
    expect(bound).toBeGreaterThan(retained);
  });

  test('the Linux proof uses the exact process-group supervisor exercised here', () => {
    const bootSource = readFileSync(
      join(INSTALLED_ROOT, 'test/systemd/boot-check.js'),
      'utf8',
    );
    const verifierSource = readFileSync(
      join(INSTALLED_ROOT, 'scripts/verify-systemd-user-service-linux.js'),
      'utf8',
    );
    /** @param {string} source */
    const supervisorSource = (source) =>
      source.slice(
        source.indexOf('async function processGroupSupervisorMain()'),
        source.indexOf('const PROCESS_GROUP_SUPERVISOR_SOURCE'),
      );
    expect(supervisorSource(verifierSource)).toBe(supervisorSource(bootSource));
    const runStart = verifierSource.indexOf('function run(command, args');
    const runEnd = verifierSource.indexOf(
      'function parseJsonOutput(',
      runStart,
    );
    expect(verifierSource.slice(runStart, runEnd)).toContain(
      'spawnProcessGroupSync(command, args',
    );
  });

  test('the Linux proof removes the accepted privileged observer before recovery', () => {
    const source = readFileSync(
      join(INSTALLED_ROOT, 'scripts/verify-systemd-user-service-linux.js'),
      'utf8',
    );
    const start = source.indexOf('async function verify()');
    const body = source.slice(start);
    const accepted = body.indexOf(
      'assert.equal(readBootId(), bootReceipt.bootId);',
    );
    const removed = body.indexOf('removeBootObserver();');
    const recovery = body.indexOf(
      'const stoppedForBootRecovery = stopSupervisorForRecovery();',
    );
    expect(start).toBeGreaterThan(0);
    expect(accepted).toBeGreaterThanOrEqual(0);
    expect(removed).toBeGreaterThan(accepted);
    expect(recovery).toBeGreaterThan(removed);
  });

  test('native probe executes fixed self-contained source as the proof UID', async () => {
    const value = await fixture();
    /** @type {string[][]} */
    const commands = [];
    readBootNativeObservation(value.config, (_command, args) => {
      commands.push(args);
      return { status: 0, stdout: '{}', stderr: '' };
    });
    expect(commands).toHaveLength(1);
    const args = commands[0];
    expect(args.slice(0, 5)).toEqual([
      '--reuid=1000',
      '--regid=1000',
      '--init-groups',
      '/usr/bin/env',
      '-i',
    ]);
    const node = args.indexOf('/usr/local/bin/node');
    expect(args.slice(node, node + 3)).toEqual([
      '/usr/local/bin/node',
      '--input-type=module',
      '--eval',
    ]);
    expect(args[node + 3]).toContain(readBootNativeEvidence.toString());
    expect(JSON.parse(args[node + 4])).toEqual(value.config);
  });

  test('the exact generated eval body emits parseable JSON in a separate Node process', async () => {
    const value = await fixture();
    await value.controlDB.close();
    await value.applicationDB.close();
    const installedRoot = join(value.root, 'observer-module-fixture');
    mkdirSync(installedRoot);
    writeFileSync(join(installedRoot, 'package.json'), '{"type":"module"}');
    // Keep every production record validator. Only the DB adapter is a
    // read-only file-backed stand-in, so this tests the exact serialized
    // function/argv/JSON boundary without claiming a native LMDB boot proof.
    for (const relative of [
      'src/core/lib/db/tables/ledger-service-lifecycle.js',
      'src/core/lib/db/tables/application-state-readiness.js',
      'src/core/lib/db/tables/coordinator-authority.js',
      'src/core/lib/db/tables/application-state.js',
      'src/core/lib/db/tables/application-state-authority.js',
      'src/core/runtime/local-app-storage.js',
      'src/core/lib/config/db.js',
    ]) {
      const target = join(installedRoot, relative);
      mkdirSync(dirname(target), { recursive: true });
      symlinkSync(join(INSTALLED_ROOT, relative), target);
    }
    const adapterPath = join(installedRoot, 'src/core/lib/db/adapters/lmdb.js');
    mkdirSync(dirname(adapterPath), { recursive: true });
    writeFileSync(
      adapterPath,
      `import assert from 'node:assert/strict';
import createDB from ${JSON.stringify(pathToFileURL(join(INSTALLED_ROOT, 'src/core/lib/db/adapters/vanilla.js')).href)};
export default function open(options) {
  assert.equal(options.readOnly, true);
  return createDB(options);
}
`,
    );
    const before = [value.controlPath, value.applicationStatePath].map(
      (storePath) => readFileSync(join(storePath, 'database.json'), 'utf8'),
    );
    const observation = readBootNativeObservation(
      { ...value.config, installedPackageRoot: installedRoot },
      (command, args) => {
        expect(command).toBe('/usr/bin/setpriv');
        // The test runs Node as the existing test UID; production retains
        // the separately asserted setpriv prefix with the proof UID/GID.
        const node = args.indexOf('/usr/local/bin/node');
        expect(node).toBeGreaterThan(0);
        const result = spawnSync(process.execPath, args.slice(node + 1), {
          cwd: value.root,
          encoding: 'utf8',
          timeout: 15_000,
          maxBuffer: 1024 * 1024,
        });
        expect(result.error).toBeUndefined();
        return {
          status: result.status ?? 1,
          stdout: result.stdout,
          stderr: result.stderr,
        };
      },
    );
    expect(observation.result).toEqual({
      status: 0,
      stdout: JSON.stringify(value.evidence.readinessEvidence),
      stderr: '',
    });
    expect(observation.parsed).toEqual(value.evidence.readinessEvidence);
    expect(
      [value.controlPath, value.applicationStatePath].map((storePath) =>
        readFileSync(join(storePath, 'database.json'), 'utf8'),
      ),
    ).toEqual(before);
  });
});

describe('boot native read-only evidence', () => {
  test('validates both retained volumes with no observer mutation and closes both handles', async () => {
    const value = await fixture();
    const evidence = await readBootNativeEvidence(
      value.config,
      value.nativePorts,
    );
    expect(evidence).toEqual(value.evidence.readinessEvidence);
    expect(value.opens).toEqual([
      { path: value.controlPath, readOnly: true },
      { path: value.applicationStatePath, readOnly: true },
    ]);
    expect(value.closes).toEqual([
      value.applicationStatePath,
      value.controlPath,
    ]);
    expect(value.mutation).not.toHaveBeenCalled();
  });

  test('an invalid content digest fails before opening native stores', async () => {
    const value = await fixture();
    const config = /** @type {Record<string, any>} */ (clone(value.config));
    config.previousReadiness.record_digest = 'wasr1_wrong';
    await expect(
      readBootNativeEvidence(config, value.nativePorts),
    ).rejects.toThrow('verification');
    expect(value.opens).toEqual([]);
  });

  test('missing destination stays missing and is never opened or initialized', async () => {
    const value = await fixture();
    const missing = join(value.applicationStatePath, 'lmdb');
    renameSync(missing, join(value.applicationStatePath, 'retained-lmdb'));
    await expect(
      readBootNativeEvidence(value.config, value.nativePorts),
    ).rejects.toThrow();
    expect(value.opens).toEqual([]);
    expect(existsSync(missing)).toBe(false);
    expect(value.mutation).not.toHaveBeenCalled();
  });

  test('aliased destination data is rejected before opening either volume', async () => {
    const value = await fixture();
    const destination = join(value.applicationStatePath, 'lmdb', 'data.mdb');
    renameSync(destination, `${destination}.retained`);
    linkSync(join(value.controlPath, 'lmdb', 'data.mdb'), destination);
    await expect(
      readBootNativeEvidence(value.config, value.nativePorts),
    ).rejects.toThrow();
    expect(value.opens).toEqual([]);
  });

  test('a full source snapshot change during destination observation cannot be excused by time', async () => {
    const value = await fixture();
    value.hooks.afterApplicationClose = async () => {
      await value.authorityStore.heartbeat({
        authority: value.config.previousAuthority,
        requestId: 'unexpected-heartbeat',
        observedAt: 100,
      });
    };
    await expect(
      readBootNativeEvidence(value.config, value.nativePorts),
    ).rejects.toThrow();
    expect(value.closes).toEqual([
      value.applicationStatePath,
      value.controlPath,
    ]);
    expect(value.mutation).not.toHaveBeenCalled();
  });

  test('a newly claimed local owner cannot be reported as blocked and quiescent', async () => {
    const value = await fixture();
    await createLedgerServiceOwnership({
      db: value.controlDB,
      tableName: TABLE_NAME,
    }).claimOwnership({
      serviceId: value.serviceId,
      appId: APP_ID,
      scopeId: 'scope',
      principalId: 'proof',
      sessionId: createLedgerServiceSessionId(),
      ownerKind: 'resident',
      expected: null,
      claimedAt: 100,
    });
    await expect(
      readBootNativeEvidence(value.config, value.nativePorts),
    ).rejects.toThrow();
    expect(value.opens).toEqual([{ path: value.controlPath, readOnly: true }]);
    expect(value.closes).toEqual([value.controlPath]);
  });
});
