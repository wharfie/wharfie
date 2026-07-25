/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import createVanillaDB from '../../../src/core/lib/db/adapters/vanilla.js';
import { createControlDBClient } from '../../../src/core/lib/config/db.js';
import {
  createLedgerServiceId,
  createLedgerServiceLifecycle,
  createLedgerServiceOwnership,
  createLedgerServiceSessionId,
} from '../../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import {
  LOCAL_APPLICATION_ACTIVATION_SORT_KEY,
  createLocalApplicationActivation,
  getLocalApplicationActivationPartitionKey,
} from '../../../src/core/lib/db/tables/local-application-activation.js';
import { inspectArtifactBytes } from '../../../src/core/runtime/packaged-artifact.js';
import {
  acquireSystemdUserServiceOperationLock,
  createSystemdUserServiceOperator,
  parseSystemdUserManagerUnitPath,
  readSystemdUserServiceReleaseByReference,
  readSystemdUserServiceRuntimeState,
} from '../../../src/core/runtime/services/systemd-user-service-manager.js';
import {
  createSystemdUserServiceLayout,
  createSystemdUserServiceUnit,
} from '../../../src/core/runtime/services/systemd-user-service.js';

const REVISION_ID = `wrv1_${Buffer.alloc(32, 4).toString('base64url')}`;
const APP_ID = 'service-demo';
const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});
const itOnLinux = process.platform === 'linux' ? it : it.skip;
/** @type {string[]} */
const roots = [];

afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fsp.rm(root, { recursive: true, force: true })),
  );
});

/**
 * The service-manager suite exercises host and activation semantics. Native
 * LMDB behavior has dedicated adapter and workflow integration suites, so use
 * the persisted JSON adapter here to avoid opening one native environment per
 * host fixture.
 * @param {string} adapterName - Manager-selected adapter.
 * @param {{path?: string, readOnly?: boolean}} options - Store options.
 * @returns {Promise<import('../../../src/core/lib/db/base.js').DBClient>} - Test DB.
 */
async function createTestControlDBClient(adapterName, options) {
  if (adapterName !== 'lmdb') {
    throw new Error('service-manager tests expected the fixed lmdb selector');
  }
  return createVanillaDB(options);
}

/**
 * @param {{artifactBytes?: Buffer, target?: Readonly<Record<string, string>>, linger?: boolean, runtimeMode?: 'matching'|'null'|'stopped'|'unavailable'|'wrong-artifact'|'wrong-revision'|'stale-session'|'wrong-process'|'starting', systemdMode?: 'normal'|'failed', platform?: string, uid?: number, filesystemUid?: number, environment?: Record<string, string | undefined>, packagedStorage?: boolean, managerUnitPaths?: string[], managerDiscoversUnitPathAfterReload?: boolean, managerFragmentPath?: string, unitInitiallyUnknown?: boolean, deriveConfigRoot?: boolean, deriveDataRoot?: boolean, useDefaultXdgConfigHome?: boolean, retainActiveWhenUnitMissingOnReload?: boolean, useProductionControlDB?: boolean, fsOps?: typeof fsp, listRuns?: (input: Record<string, any>) => Promise<Record<string, any>>}} [options] - Harness overrides.
 * @returns {Promise<Record<string, any>>} - Isolated manager harness.
 */
async function createHarness(options = {}) {
  const root = await fsp.mkdtemp(
    path.join(tmpdir(), 'wharfie-systemd-user-manager-'),
  );
  roots.push(root);
  const artifactPath = path.join(root, 'source-artifact');
  await fsp.writeFile(
    artifactPath,
    options.artifactBytes || Buffer.from('packaged-artifact-v1'),
    { mode: 0o700 },
  );
  const sourceArtifact = await inspectArtifactBytes(artifactPath);
  const homeDirectory = path.join(root, 'account-home');
  const dataRoot = options.deriveDataRoot
    ? path.join(homeDirectory, '.local', 'share', 'wharfie-nodejs')
    : path.join(root, 'data');
  const configRoot = options.deriveConfigRoot
    ? path.join(homeDirectory, '.config')
    : path.join(root, 'config');
  const layout = createSystemdUserServiceLayout({
    appId: APP_ID,
    dataRoot,
    configRoot,
  });
  const seededForeignFragmentPath = options.managerFragmentPath ?? null;
  const state = {
    active: false,
    enabled: false,
    linger: options.linger !== false,
    runtimeMode: options.runtimeMode || 'matching',
    runtimeArtifactId: /** @type {string | null} */ (null),
    systemdMode: options.systemdMode || 'normal',
    failedArtifactId: /** @type {string | null} */ (null),
    cleanExitArtifactId: /** @type {string | null} */ (null),
    failStartBeforeEffectOnce: false,
    failStartResponseOnce: false,
    repairRuntimeOnStartOnce: false,
    failDaemonReloadOnce: false,
    failUnitPath: false,
    loadState: seededForeignFragmentPath ? 'loaded' : 'not-found',
    fragmentPath: seededForeignFragmentPath || '',
    persistentForeignFragmentPath: seededForeignFragmentPath,
    revealForeignUnitPathAfterRemoval: /** @type {string | null} */ (null),
    retainActiveWhenUnitMissingOnReload:
      options.retainActiveWhenUnitMissingOnReload === true,
    dropInPaths: '',
    needDaemonReload: false,
    failUnitShow: false,
    unitPaths: options.managerUnitPaths || [path.dirname(layout.unitPath)],
    unitPathsAfterReload: options.managerDiscoversUnitPathAfterReload
      ? [path.dirname(layout.unitPath)]
      : null,
    unknownUnitShows: options.unitInitiallyUnknown ? 1 : 0,
    now: 100,
  };
  const readSelectedIdentity = async () => {
    try {
      const selected = await fsp.readlink(layout.currentLink);
      const artifactId = path.basename(selected);
      const release = JSON.parse(
        await fsp.readFile(
          path.join(layout.releasesRoot, artifactId, 'release.json'),
          'utf8',
        ),
      );
      return {
        artifactId,
        revisionId: release.revisionId,
      };
    } catch {
      return {
        artifactId: sourceArtifact.artifactId,
        revisionId: REVISION_ID,
      };
    }
  };
  const refreshManagerCache = async () => {
    if (state.persistentForeignFragmentPath) {
      state.loadState = 'loaded';
      state.fragmentPath = state.persistentForeignFragmentPath;
      state.needDaemonReload = false;
      return;
    }
    let fixedUnitExists = false;
    try {
      await fsp.lstat(layout.unitPath);
      fixedUnitExists = true;
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') {
        throw error;
      }
    }
    if (!fixedUnitExists && state.revealForeignUnitPathAfterRemoval) {
      const foreignPath = state.revealForeignUnitPathAfterRemoval;
      await fsp.mkdir(path.dirname(foreignPath), { recursive: true });
      await fsp.writeFile(foreignPath, '[Unit]\nDescription=foreign\n', {
        mode: 0o600,
      });
      state.persistentForeignFragmentPath = foreignPath;
      state.loadState = 'loaded';
      state.fragmentPath = foreignPath;
      state.dropInPaths = '';
      state.needDaemonReload = false;
      return;
    }
    state.loadState = fixedUnitExists ? 'loaded' : 'not-found';
    state.fragmentPath = fixedUnitExists ? layout.unitPath : '';
    if (!fixedUnitExists && !state.retainActiveWhenUnitMissingOnReload) {
      state.active = false;
      state.enabled = false;
      state.dropInPaths = '';
    }
    state.needDaemonReload = false;
  };
  /** @type {Array<{command: string, args: string[]}>} */
  const calls = [];
  const execute = jest.fn(
    async (/** @type {string} */ command, /** @type {string[]} */ args) => {
      calls.push({ command, args: [...args] });
      if (command === 'loginctl') {
        return { stdout: state.linger ? 'yes\n' : 'no\n', stderr: '' };
      }
      if (command !== 'systemctl' || args[0] !== '--user') {
        throw new Error('unexpected process command');
      }
      const operation = args[1];
      if (
        operation === 'show' &&
        args.includes('--property=UnitPath') &&
        state.failUnitPath
      ) {
        throw new Error('user manager unavailable');
      }
      if (operation === 'daemon-reload' && state.failDaemonReloadOnce) {
        state.failDaemonReloadOnce = false;
        throw new Error('daemon reload interrupted');
      }
      if (operation === 'daemon-reload' && state.unitPathsAfterReload) {
        state.unitPaths = state.unitPathsAfterReload;
        state.unitPathsAfterReload = null;
      }
      if (operation === 'daemon-reload') await refreshManagerCache();
      if (operation === 'enable') {
        state.enabled = true;
        if (args.includes('--now')) state.active = true;
      } else if (operation === 'start' || operation === 'restart') {
        if (state.failStartBeforeEffectOnce) {
          state.failStartBeforeEffectOnce = false;
          throw new Error('systemctl start failed before taking effect');
        }
        state.active = true;
        if (state.repairRuntimeOnStartOnce) {
          state.repairRuntimeOnStartOnce = false;
          state.runtimeMode = 'matching';
        }
        if (state.failStartResponseOnce) {
          state.failStartResponseOnce = false;
          throw new Error('systemctl start response was lost');
        }
        const selectedIdentity = await readSelectedIdentity();
        if (state.cleanExitArtifactId === selectedIdentity.artifactId) {
          state.active = false;
        }
      } else if (operation === 'stop') {
        state.active = false;
      } else if (operation === 'reset-failed') {
        state.systemdMode = 'normal';
      } else if (operation === 'disable') {
        state.enabled = false;
        state.active = false;
      }
      if (operation === 'show' && args.includes('--property=UnitPath')) {
        return { stdout: `${state.unitPaths.join(' ')}\n`, stderr: '' };
      }
      if (operation === 'show') {
        if (state.failUnitShow) throw new Error('unit preflight unavailable');
        if (state.unknownUnitShows > 0) {
          state.unknownUnitShows -= 1;
          return {
            stdout: [
              'LoadState=not-found',
              'UnitFileState=',
              'ActiveState=inactive',
              'SubState=dead',
              'Result=success',
              'MainPID=0',
              'ExecMainStatus=0',
              'FragmentPath=',
              'DropInPaths=',
              `NeedDaemonReload=${state.needDaemonReload ? 'yes' : 'no'}`,
              '',
            ].join('\n'),
            stderr: '',
          };
        }
        if (state.loadState === 'not-found') {
          return {
            stdout: [
              'LoadState=not-found',
              'UnitFileState=',
              `ActiveState=${state.active ? 'active' : 'inactive'}`,
              `SubState=${state.active ? 'running' : 'dead'}`,
              'Result=success',
              `MainPID=${state.active ? 4321 : 0}`,
              'ExecMainStatus=0',
              'FragmentPath=',
              'DropInPaths=',
              `NeedDaemonReload=${state.needDaemonReload ? 'yes' : 'no'}`,
              '',
            ].join('\n'),
            stderr: '',
          };
        }
        const selectedIdentity = await readSelectedIdentity();
        const failed =
          state.active &&
          (state.systemdMode === 'failed' ||
            state.failedArtifactId === selectedIdentity.artifactId);
        return {
          stdout: [
            'LoadState=loaded',
            `UnitFileState=${state.enabled ? 'enabled' : 'disabled'}`,
            `ActiveState=${failed ? 'failed' : state.active ? 'active' : 'inactive'}`,
            `SubState=${failed ? 'failed' : state.active ? 'running' : 'dead'}`,
            `Result=${failed ? 'failed' : 'success'}`,
            `MainPID=${failed ? '0' : state.active ? '4321' : '0'}`,
            'ExecMainStatus=0',
            `FragmentPath=${state.fragmentPath}`,
            `DropInPaths=${state.dropInPaths}`,
            `NeedDaemonReload=${state.needDaemonReload ? 'yes' : 'no'}`,
            '',
          ].join('\n'),
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    },
  );
  const readRuntimeState = jest.fn(async () => {
    const selectedIdentity = await readSelectedIdentity();
    if (state.runtimeMode === 'null') return null;
    if (state.runtimeMode === 'unavailable') {
      return { status: 'UNAVAILABLE', session: 'unknown' };
    }
    if (state.runtimeMode === 'stopped') {
      return {
        status: 'STOPPED',
        artifactId: selectedIdentity.artifactId,
        revisionId: selectedIdentity.revisionId,
        generation: 1,
        session: 'absent',
        currentOwner: false,
      };
    }
    if (state.runtimeMode === 'starting') {
      return {
        status: 'STARTING',
        artifactId: selectedIdentity.artifactId,
        revisionId: selectedIdentity.revisionId,
        generation: 2,
        ownerKind: 'resident',
        ownerGeneration: 2,
        session: 'active',
        processId: 4321,
        currentOwner: true,
      };
    }
    if (!state.active) {
      return {
        status: 'STOPPED',
        artifactId: selectedIdentity.artifactId,
        revisionId: selectedIdentity.revisionId,
        generation: 1,
        session: 'absent',
        currentOwner: false,
      };
    }
    return {
      status: 'READY',
      artifactId:
        state.runtimeArtifactId ||
        (state.runtimeMode === 'wrong-artifact'
          ? `${selectedIdentity.artifactId.slice(0, -1)}${selectedIdentity.artifactId.endsWith('A') ? 'B' : 'A'}`
          : selectedIdentity.artifactId),
      revisionId:
        state.runtimeMode === 'wrong-revision'
          ? `wrv1_${Buffer.alloc(32, 5).toString('base64url')}`
          : selectedIdentity.revisionId,
      generation: 2,
      ownerKind: 'resident',
      ownerGeneration: 2,
      session: state.runtimeMode === 'stale-session' ? 'absent' : 'active',
      processId: state.runtimeMode === 'wrong-process' ? 9876 : 4321,
      currentOwner: state.runtimeMode !== 'stale-session',
    };
  });
  let token = 0;
  const releaseOperationLock = jest.fn(async () => undefined);
  const acquireOperationLock = jest.fn(async () => releaseOperationLock);
  const controlDBClient = options.useProductionControlDB
    ? createControlDBClient
    : createTestControlDBClient;
  /** @param {Readonly<Record<string, string>>} target - Exact packaged target. */
  const createOperatorForTarget = (target) =>
    createSystemdUserServiceOperator({
      platform: options.platform || 'linux',
      architecture: target.architecture,
      nodeVersion: target.nodeVersion,
      artifactPath,
      ...(options.deriveDataRoot ? {} : { dataRoot }),
      ...(options.deriveConfigRoot ? {} : { configRoot }),
      ...(options.deriveConfigRoot || options.deriveDataRoot
        ? { getHomeDirectory: () => homeDirectory }
        : {}),
      environment:
        options.environment ||
        (options.useDefaultXdgConfigHome
          ? { XDG_CONFIG_HOME: `${configRoot}/` }
          : {}),
      getLocalAppStorageLayout: () =>
        options.packagedStorage === false
          ? undefined
          : {
              appId: layout.appId,
              dataRoot: layout.dataRoot,
              appRoot: layout.serviceRoot,
              stateRoot: layout.stateRoot,
              controlPath: layout.controlPath,
              payloadPath: layout.payloadPath,
              applicationStatePath: layout.applicationStatePath,
              sessionPath: layout.sessionPath,
              executionLedgerTable: layout.executionLedgerTable,
            },
      getUid: () => options.uid ?? 1000,
      getEffectiveUid: () => options.uid ?? 1000,
      getFilesystemUid: () =>
        options.filesystemUid ?? process.getuid?.() ?? options.uid ?? 1000,
      fsOps: options.fsOps || fsp,
      acquireOperationLock,
      ...(options.useProductionControlDB
        ? {}
        : { createControlDBClient: controlDBClient }),
      ...(options.listRuns
        ? {
            createExecutionLedger: () => ({ listRuns: options.listRuns }),
          }
        : {}),
      createToken: () => `token-${(token += 1)}`,
      now: () => state.now,
      wait: async () => undefined,
      pollIntervalMs: 1,
      startTimeoutMs: 2,
      stopTimeoutMs: 2,
      execute,
      readRuntimeState,
      readEmbeddedRevisionRuntimePair: async () => ({
        revision: { revisionId: REVISION_ID },
        runtime: { appId: APP_ID, revisionId: REVISION_ID, target },
      }),
    });
  const operator = createOperatorForTarget(options.target || TARGET);
  return {
    root,
    artifactPath,
    dataRoot,
    configRoot,
    layout,
    state,
    calls,
    execute,
    acquireOperationLock,
    releaseOperationLock,
    controlDBClient,
    createOperatorForTarget,
    readRuntimeState,
    operator,
  };
}

/** @param {Record<string, any>} harness - Installed harness. @returns {Promise<void>} - Removes only its activation row. */
async function eraseActivationRecord(harness) {
  const db = await harness.controlDBClient('lmdb', {
    path: harness.layout.controlPath,
  });
  try {
    await db.transactionWrite({
      tableName: harness.layout.executionLedgerTable,
      deleteRequests: [
        {
          keyName: 'run_id',
          keyValue: getLocalApplicationActivationPartitionKey(APP_ID),
          sortKeyName: 'sort_key',
          sortKeyValue: LOCAL_APPLICATION_ACTIVATION_SORT_KEY,
        },
      ],
    });
  } finally {
    await db.close?.();
  }
}

/** @param {Record<string, any>} harness - Harness. @returns {Promise<Readonly<Record<string, any>> | null>} - Activation snapshot. */
async function readActivationRecord(harness) {
  const db = await harness.controlDBClient('lmdb', {
    path: harness.layout.controlPath,
    readOnly: true,
  });
  try {
    return await createLocalApplicationActivation({
      db,
      tableName: harness.layout.executionLedgerTable,
    }).get({ appId: APP_ID });
  } finally {
    await db.close?.();
  }
}

/** @param {Record<string, any>} harness - Harness. @returns {Promise<void>} - Moves an exact ACTIVATING target into source restoration. */
async function beginActivationSourceRestore(harness) {
  const db = await harness.controlDBClient('lmdb', {
    path: harness.layout.controlPath,
  });
  try {
    const activation = createLocalApplicationActivation({
      db,
      tableName: harness.layout.executionLedgerTable,
    });
    const current = await activation.get({ appId: APP_ID });
    await activation.beginSourceRestore({
      appId: APP_ID,
      transitionId: current.transition.transitionId,
    });
  } finally {
    await db.close?.();
  }
}

describe('systemd user service manager', () => {
  it('parses the live manager UnitPath without confusing escaped paths', () => {
    expect(
      parseSystemdUserManagerUnitPath(
        String.raw`"/home/example user/.config/systemd/user" "/run/\$cash/systemd/user" /run/systemd/user`,
      ),
    ).toEqual([
      '/home/example user/.config/systemd/user',
      '/run/$cash/systemd/user',
      '/run/systemd/user',
    ]);
    expect(
      parseSystemdUserManagerUnitPath(
        String.raw`"/home/example\\user/systemd/user" "/run/example\"user/systemd/user"`,
      ),
    ).toEqual([
      String.raw`/home/example\user/systemd/user`,
      '/run/example"user/systemd/user',
    ]);
    const nonBreakingSpacePath = '/home/example\u00a0user/.config/systemd/user';
    expect(
      parseSystemdUserManagerUnitPath(
        `${nonBreakingSpacePath} /run/systemd/user`,
      ),
    ).toEqual([nonBreakingSpacePath, '/run/systemd/user']);
    expect(() => parseSystemdUserManagerUnitPath('relative/path')).toThrow(
      /invalid UnitPath/,
    );
    expect(() =>
      parseSystemdUserManagerUnitPath(String.raw`/home/example\q/user`),
    ).toThrow(/invalid UnitPath/);
    expect(() =>
      parseSystemdUserManagerUnitPath('"/home/example user'),
    ).toThrow(/invalid UnitPath/);
  });

  itOnLinux(
    'uses a crash-releasing kernel lock rather than a stale PID file',
    async () => {
      const options = {
        serviceRoot: `/tmp/wharfie-service-lock-${process.pid}`,
        uid: process.getuid?.() ?? 1000,
      };
      const release = await acquireSystemdUserServiceOperationLock(options);
      try {
        await expect(
          acquireSystemdUserServiceOperationLock(options),
        ).rejects.toThrow(/operation is already active/);
      } finally {
        await release();
      }
      const releaseAfterCrashEquivalent =
        await acquireSystemdUserServiceOperationLock(options);
      await releaseAfterCrashEquivalent();
    },
  );

  it('joins durable lifecycle ownership with the live session process', async () => {
    const harness = await createHarness();
    const artifact = await inspectArtifactBytes(harness.artifactPath);
    await fsp.mkdir(harness.layout.controlPath, { recursive: true });
    const db = createVanillaDB({ path: harness.layout.controlPath });
    const serviceId = createLedgerServiceId({ appId: APP_ID });
    const sessionId = createLedgerServiceSessionId();
    const ownership = createLedgerServiceOwnership({
      db,
      tableName: harness.layout.executionLedgerTable,
    });
    const lifecycle = createLedgerServiceLifecycle({
      db,
      tableName: harness.layout.executionLedgerTable,
    });
    await ownership.claimOwnership({
      serviceId,
      appId: APP_ID,
      scopeId: 'test-session-root',
      principalId: 'test-principal',
      sessionId,
      ownerKind: 'resident',
      expected: null,
      claimedAt: 100,
    });
    const started = await lifecycle.start({
      serviceId,
      appId: APP_ID,
      artifactId: artifact.artifactId,
      revisionId: REVISION_ID,
      sessionId,
      observedAt: 100,
    });
    await lifecycle.markReady({
      serviceId,
      sessionId,
      generation: started.lifecycle.generation,
      observedAt: 101,
    });
    const probeSession = jest.fn(
      async (
        /** @type {{serviceId: string, sessionId: string, sessionRoot?: string}} */
        options,
      ) => ({
        serviceId: options.serviceId,
        sessionId: options.sessionId,
        sessionRoot: options.sessionRoot || harness.layout.sessionPath,
        endpoint: 'test-session-endpoint',
        status: /** @type {'active'} */ ('active'),
        processId: 4321,
      }),
    );

    await expect(
      readSystemdUserServiceRuntimeState({
        layout: harness.layout,
        appId: APP_ID,
        fsOps: fsp,
        createDB: async () => db,
        probeSession,
      }),
    ).resolves.toMatchObject({
      status: 'READY',
      artifactId: artifact.artifactId,
      revisionId: REVISION_ID,
      ownerKind: 'resident',
      session: 'active',
      processId: 4321,
      currentOwner: true,
    });
    expect(probeSession).toHaveBeenCalledWith({
      serviceId,
      sessionId,
      sessionRoot: harness.layout.sessionPath,
    });
  });

  it('serializes status without materializing absent service state', async () => {
    const harness = await createHarness();
    const desired = await inspectArtifactBytes(harness.artifactPath);
    harness.calls.length = 0;

    const status = await harness.operator.status();
    expect(status).toMatchObject({
      schemaVersion: 3,
      health: 'absent',
      installation: { state: 'absent' },
      activation: null,
      desiredConvergence: {
        schemaVersion: 1,
        kind: 'wharfie.service.desired-convergence',
        appId: APP_ID,
        unit: harness.layout.unitName,
        desired: {
          artifactId: desired.artifactId,
          revisionId: REVISION_ID,
        },
        disposition: 'authorized',
        basis: 'physical-absence',
      },
    });
    expect(Object.keys(status.desiredConvergence).sort()).toEqual(
      [
        'appId',
        'basis',
        'desired',
        'disposition',
        'kind',
        'schemaVersion',
        'unit',
      ].sort(),
    );
    expect(
      harness.calls.filter(
        (/** @type {{command: string, args: string[]}} */ call) =>
          call.command === 'systemctl' &&
          ['daemon-reload', 'enable', 'start', 'stop'].includes(call.args[1]),
      ),
    ).toEqual([]);
    expect(harness.acquireOperationLock).toHaveBeenCalledTimes(1);
    expect(harness.acquireOperationLock).toHaveBeenCalledWith({
      serviceRoot: harness.layout.serviceRoot,
      uid: 1000,
    });
    expect(harness.releaseOperationLock).toHaveBeenCalledTimes(1);
    await expect(fsp.stat(harness.layout.serviceRoot)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fsp.stat(harness.layout.controlPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('does not hide a later symlinked state root behind an absent control root', async () => {
    const harness = await createHarness();
    for (const directory of [
      harness.dataRoot,
      path.dirname(harness.layout.serviceRoot),
      harness.layout.serviceRoot,
      harness.layout.stateRoot,
    ]) {
      await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
      await fsp.chmod(directory, 0o700);
    }
    const redirect = path.join(harness.root, 'foreign-application-state');
    await fsp.mkdir(redirect, { mode: 0o700 });
    await fsp.symlink(redirect, harness.layout.applicationStatePath, 'dir');

    await expect(fsp.stat(harness.layout.controlPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(harness.operator.status()).resolves.toMatchObject({
      installation: { state: 'absent' },
      desiredConvergence: {
        disposition: 'conflict',
        basis: null,
      },
    });
  });

  it('retains a later transient state-root observation over an absent control root', async () => {
    const transientFsOps = new Proxy(fsp, {
      get(target, property, receiver) {
        if (property !== 'lstat') {
          return Reflect.get(target, property, receiver);
        }
        return async (/** @type {string} */ targetPath) => {
          if (path.basename(String(targetPath)) === 'application-state') {
            const error = new Error(
              'application-state observation interrupted',
            );
            Object.assign(error, { code: 'EAGAIN' });
            throw error;
          }
          return await target.lstat(targetPath);
        };
      },
    });
    const harness = await createHarness({ fsOps: transientFsOps });
    for (const directory of [
      harness.dataRoot,
      path.dirname(harness.layout.serviceRoot),
      harness.layout.serviceRoot,
      harness.layout.stateRoot,
    ]) {
      await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
      await fsp.chmod(directory, 0o700);
    }

    await expect(fsp.stat(harness.layout.controlPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(harness.operator.status()).resolves.toMatchObject({
      installation: { state: 'absent' },
      desiredConvergence: {
        disposition: 'unknown',
        basis: null,
      },
    });
  });

  it('installs exact bytes, enables the fixed unit, and reports durable health', async () => {
    const harness = await createHarness();
    const source = await inspectArtifactBytes(harness.artifactPath);

    await expect(harness.operator.install()).resolves.toMatchObject({
      schemaVersion: 1,
      kind: 'wharfie.service.result',
      action: 'install',
      appId: APP_ID,
      outcome: 'target-active',
      health: 'healthy',
      activeArtifactId: source.artifactId,
      activeRevisionId: REVISION_ID,
    });

    const installedArtifact = path.join(
      harness.layout.releasesRoot,
      source.artifactId,
      'app',
    );
    await expect(fsp.readFile(installedArtifact)).resolves.toEqual(
      Buffer.from('packaged-artifact-v1'),
    );
    await expect(fsp.readlink(harness.layout.currentLink)).resolves.toBe(
      path.join('releases', source.artifactId),
    );
    await expect(
      fsp.readFile(harness.layout.unitPath, 'utf8'),
    ).resolves.toContain(
      'Environment="WHARFIE_RUNTIME_COMMAND=ledger-service"',
    );
    const installation = JSON.parse(
      await fsp.readFile(harness.layout.installationPath, 'utf8'),
    );
    expect(installation).toMatchObject({
      state: 'installed',
      appId: APP_ID,
      principal: { uid: 1000, linger: true },
      current: { artifactId: source.artifactId, revisionId: REVISION_ID },
    });
    await expect(
      readSystemdUserServiceReleaseByReference({
        layout: harness.layout,
        uid: process.getuid?.() ?? 1000,
        target: TARGET,
        reference: {
          artifactId: source.artifactId,
          revisionId: REVISION_ID,
        },
      }),
    ).resolves.toMatchObject({
      appId: APP_ID,
      artifactId: source.artifactId,
      revisionId: REVISION_ID,
      artifactPath: installedArtifact,
    });
    await expect(
      readSystemdUserServiceReleaseByReference({
        layout: harness.layout,
        uid: process.getuid?.() ?? 1000,
        target: TARGET,
        reference: {
          artifactId: source.artifactId,
          revisionId: `wrv1_${Buffer.alloc(32, 9).toString('base64url')}`,
        },
      }),
    ).rejects.toThrow(/immutable release disagrees with its reference/);
    expect(harness.calls).toEqual(
      expect.arrayContaining([
        {
          command: 'systemctl',
          args: [
            '--user',
            'show',
            '--property=UnitPath',
            '--value',
            '--no-pager',
          ],
        },
        {
          command: 'systemctl',
          args: ['--user', 'daemon-reload'],
        },
        {
          command: 'systemctl',
          args: ['--user', 'enable', 'wharfie-service-demo.service'],
        },
      ]),
    );

    await expect(harness.operator.status()).resolves.toMatchObject({
      schemaVersion: 3,
      kind: 'wharfie.service.status',
      health: 'healthy',
      systemd: { activeState: 'active', unitFileState: 'enabled' },
      wiring: {
        state: 'managed',
        unitFile: 'managed',
        effectiveUnit: 'managed',
        cleanupPending: false,
      },
      runtime: {
        status: 'READY',
        revisionId: REVISION_ID,
        session: 'active',
      },
      desiredConvergence: {
        desired: {
          artifactId: source.artifactId,
          revisionId: REVISION_ID,
        },
        disposition: 'authorized',
        basis: 'durable-active',
      },
    });
  });

  it('converges an absent service without requiring an install/update guess', async () => {
    const harness = await createHarness();
    const target = await inspectArtifactBytes(harness.artifactPath);

    await expect(harness.operator.converge()).resolves.toMatchObject({
      schemaVersion: 1,
      kind: 'wharfie.service.result',
      action: 'converge',
      requestStatus: 'fulfilled',
      outcome: 'target-active',
      health: 'healthy',
      activeArtifactId: target.artifactId,
      activeRevisionId: REVISION_ID,
    });
    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'healthy',
      activation: {
        phase: 'ACTIVE',
        selected: {
          artifactId: target.artifactId,
          revisionId: REVISION_ID,
        },
      },
    });
  });

  (process.platform === 'linux' ? it : it.skip)(
    'persists desired-target convergence through the production LMDB manager path',
    async () => {
      const harness = await createHarness({ useProductionControlDB: true });
      await harness.operator.converge();
      await expect(
        fsp.stat(path.join(harness.layout.controlPath, 'lmdb', 'data.mdb')),
      ).resolves.toBeDefined();
      await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
      const target = await inspectArtifactBytes(harness.artifactPath);

      await expect(harness.operator.converge()).resolves.toMatchObject({
        action: 'converge',
        requestStatus: 'fulfilled',
        outcome: 'target-active',
        activeArtifactId: target.artifactId,
      });
      await expect(harness.operator.status()).resolves.toMatchObject({
        health: 'healthy',
        activation: {
          phase: 'ACTIVE',
          selected: { artifactId: target.artifactId },
        },
      });
    },
  );

  it('converges an already healthy exact target without changing its activation generation', async () => {
    const harness = await createHarness();
    await harness.operator.converge();
    const activationBefore = await readActivationRecord(harness);
    harness.calls.length = 0;

    await expect(harness.operator.converge()).resolves.toMatchObject({
      action: 'converge',
      requestStatus: 'fulfilled',
      outcome: 'target-active',
      health: 'healthy',
    });
    await expect(readActivationRecord(harness)).resolves.toEqual(
      activationBefore,
    );
    expect(
      harness.calls.filter(
        (/** @type {{command: string, args: string[]}} */ call) =>
          call.command === 'systemctl' &&
          ['stop', 'daemon-reload', 'enable', 'start'].includes(call.args[1]),
      ),
    ).toEqual([]);
  });

  it('clears systemd failure state and restarts an exact desired target', async () => {
    const harness = await createHarness();
    await harness.operator.converge();
    const activationBefore = await readActivationRecord(harness);
    harness.state.systemdMode = 'failed';
    harness.calls.length = 0;

    await expect(harness.operator.converge()).resolves.toMatchObject({
      action: 'converge',
      requestStatus: 'fulfilled',
      outcome: 'target-active',
      health: 'healthy',
    });
    await expect(readActivationRecord(harness)).resolves.toEqual(
      activationBefore,
    );
    expect(harness.calls).toEqual(
      expect.arrayContaining([
        {
          command: 'systemctl',
          args: ['--user', 'stop', 'wharfie-service-demo.service'],
        },
        {
          command: 'systemctl',
          args: ['--user', 'reset-failed', 'wharfie-service-demo.service'],
        },
        {
          command: 'systemctl',
          args: ['--user', 'start', 'wharfie-service-demo.service'],
        },
      ]),
    );
  });

  it('restarts an exact desired target whose live runtime proof is degraded', async () => {
    const harness = await createHarness();
    await harness.operator.converge();
    const activationBefore = await readActivationRecord(harness);
    harness.state.runtimeMode = 'wrong-process';
    harness.state.repairRuntimeOnStartOnce = true;
    harness.calls.length = 0;

    await expect(harness.operator.converge()).resolves.toMatchObject({
      action: 'converge',
      requestStatus: 'fulfilled',
      outcome: 'target-active',
      health: 'healthy',
    });
    await expect(readActivationRecord(harness)).resolves.toEqual(
      activationBefore,
    );
    expect(harness.calls).toEqual(
      expect.arrayContaining([
        {
          command: 'systemctl',
          args: ['--user', 'stop', 'wharfie-service-demo.service'],
        },
        {
          command: 'systemctl',
          args: ['--user', 'start', 'wharfie-service-demo.service'],
        },
      ]),
    );
  });

  it('replaces a permanently failed first-install target with a different desired artifact', async () => {
    const harness = await createHarness();
    const failing = await inspectArtifactBytes(harness.artifactPath);
    harness.state.failedArtifactId = failing.artifactId;

    await expect(harness.operator.converge()).resolves.toMatchObject({
      action: 'converge',
      requestStatus: 'pending',
      outcome: 'in-flight',
      activeArtifactId: null,
    });

    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    const desired = await inspectArtifactBytes(harness.artifactPath);

    await expect(harness.operator.converge()).resolves.toMatchObject({
      action: 'converge',
      requestStatus: 'fulfilled',
      outcome: 'target-active',
      health: 'healthy',
      activeArtifactId: desired.artifactId,
      rollbackArtifactId: null,
    });
  });

  it('converges a new invoking artifact through the ordinary update path', async () => {
    const harness = await createHarness();
    const source = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.converge();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    const target = await inspectArtifactBytes(harness.artifactPath);

    await expect(harness.operator.converge()).resolves.toMatchObject({
      action: 'converge',
      requestStatus: 'fulfilled',
      outcome: 'target-active',
      health: 'healthy',
      activeArtifactId: target.artifactId,
      rollbackArtifactId: source.artifactId,
    });
  });

  it('repairs a failed authorized source before converging a new target', async () => {
    const harness = await createHarness();
    const source = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.converge();
    harness.state.systemdMode = 'failed';
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    const target = await inspectArtifactBytes(harness.artifactPath);
    harness.calls.length = 0;

    await expect(harness.operator.converge()).resolves.toMatchObject({
      action: 'converge',
      requestStatus: 'fulfilled',
      outcome: 'target-active',
      health: 'healthy',
      activeArtifactId: target.artifactId,
      rollbackArtifactId: source.artifactId,
    });
    expect(harness.calls).toEqual(
      expect.arrayContaining([
        {
          command: 'systemctl',
          args: ['--user', 'reset-failed', 'wharfie-service-demo.service'],
        },
      ]),
    );
  });

  it('recovers an ambiguous convergence before retrying its exact target', async () => {
    const harness = await createHarness();
    await harness.operator.converge();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    const target = await inspectArtifactBytes(harness.artifactPath);
    harness.state.failStartResponseOnce = true;

    await expect(harness.operator.converge()).rejects.toMatchObject({
      code: 'systemd-user-service-activation-recovery-required',
      remediation: 'Retry service converge from this exact desired SEA.',
    });
    await expect(harness.operator.converge()).resolves.toMatchObject({
      action: 'converge',
      requestStatus: 'fulfilled',
      outcome: 'target-active',
      activeArtifactId: target.artifactId,
    });
    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'healthy',
      activation: {
        phase: 'ACTIVE',
        selected: { artifactId: target.artifactId },
      },
    });
  });

  it('recovers an ambiguous prior target before converging a newer target', async () => {
    const harness = await createHarness();
    await harness.operator.converge();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    const intermediate = await inspectArtifactBytes(harness.artifactPath);
    harness.state.failStartResponseOnce = true;
    await expect(harness.operator.converge()).rejects.toMatchObject({
      code: 'systemd-user-service-activation-recovery-required',
      remediation: 'Retry service converge from this exact desired SEA.',
    });

    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v3');
    const desired = await inspectArtifactBytes(harness.artifactPath);

    await expect(harness.operator.status()).resolves.toMatchObject({
      activation: { phase: 'ACTIVATING', action: 'update' },
      desiredConvergence: {
        desired: {
          artifactId: desired.artifactId,
          revisionId: REVISION_ID,
        },
        disposition: 'unknown',
        basis: null,
      },
    });
    await expect(harness.operator.converge()).resolves.toMatchObject({
      action: 'converge',
      requestStatus: 'fulfilled',
      outcome: 'target-active',
      health: 'healthy',
      activeArtifactId: desired.artifactId,
      rollbackArtifactId: intermediate.artifactId,
    });
    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'healthy',
      activation: {
        phase: 'ACTIVE',
        selected: { artifactId: desired.artifactId },
        rollback: { artifactId: intermediate.artifactId },
      },
    });
  });

  it('returns an unfinished recovered install instead of beginning another transition', async () => {
    let blocked = true;
    const harness = await createHarness({
      listRuns: async () => ({
        items: blocked
          ? [
              {
                runId: 'foreign-running-work',
                appId: APP_ID,
                revisionId: `wrv1_${Buffer.alloc(32, 8).toString('base64url')}`,
                kind: 'workflow',
                status: 'RUNNING',
                version: 1,
                lastSequence: 1,
                createdAt: 1,
                updatedAt: 1,
              },
            ]
          : [],
      }),
    });

    await expect(harness.operator.install()).resolves.toMatchObject({
      requestStatus: 'pending',
      outcome: 'in-flight',
    });
    await expect(harness.operator.converge()).resolves.toMatchObject({
      action: 'converge',
      requestStatus: 'pending',
      outcome: 'in-flight',
      activeArtifactId: null,
    });
    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'degraded',
      activation: { phase: 'QUIESCING', action: 'install' },
      desiredConvergence: {
        disposition: 'authorized',
        basis: 'durable-install',
      },
    });
    blocked = false;
  });

  it('preserves a refused source when desired-target convergence is blocked by durable work', async () => {
    let blocked = false;
    const harness = await createHarness({
      listRuns: async () => ({
        items: blocked
          ? [
              {
                runId: 'running-work',
                appId: APP_ID,
                revisionId: REVISION_ID,
                kind: 'workflow',
                status: 'RUNNING',
                version: 1,
                lastSequence: 1,
                createdAt: 1,
                updatedAt: 1,
              },
            ]
          : [],
      }),
    });
    const source = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.converge();
    blocked = true;
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');

    await expect(harness.operator.converge()).resolves.toMatchObject({
      action: 'converge',
      requestStatus: 'refused',
      outcome: 'source-retained',
      health: 'healthy',
      activeArtifactId: source.artifactId,
      reason: 'durable-work',
      blockingWork: {
        blockerCount: 1,
        blockers: [{ runId: 'running-work', status: 'RUNNING' }],
      },
    });
  });

  it('reports a restored source when desired-target convergence fails definitively', async () => {
    const harness = await createHarness();
    const source = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.converge();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    const target = await inspectArtifactBytes(harness.artifactPath);
    harness.state.failedArtifactId = target.artifactId;

    await expect(harness.operator.converge()).resolves.toMatchObject({
      action: 'converge',
      requestStatus: 'failed',
      outcome: 'source-restored',
      health: 'healthy',
      activeArtifactId: source.artifactId,
    });
    await expect(fsp.readlink(harness.layout.currentLink)).resolves.toBe(
      path.join('releases', source.artifactId),
    );
  });

  it('updates to the exact invoking artifact and retains one rollback release', async () => {
    const harness = await createHarness();
    const source = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.install();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    const target = await inspectArtifactBytes(harness.artifactPath);

    await expect(harness.operator.update()).resolves.toMatchObject({
      action: 'update',
      requestStatus: 'fulfilled',
      outcome: 'target-active',
      health: 'healthy',
      activeArtifactId: target.artifactId,
      activeRevisionId: REVISION_ID,
      rollbackArtifactId: source.artifactId,
      rollbackRevisionId: REVISION_ID,
    });
    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'healthy',
      installation: {
        activeArtifactId: target.artifactId,
        previousArtifactId: source.artifactId,
      },
      activation: {
        phase: 'ACTIVE',
        action: null,
        selected: {
          artifactId: target.artifactId,
          revisionId: REVISION_ID,
        },
        rollback: {
          artifactId: source.artifactId,
          revisionId: REVISION_ID,
        },
      },
    });
  });

  it.each(['current', 'previous'])(
    'degrades status when the installed %s release disagrees with ACTIVE state',
    async (mismatchedField) => {
      const harness = await createHarness();
      const source = await inspectArtifactBytes(harness.artifactPath);
      await harness.operator.install();
      await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
      const target = await inspectArtifactBytes(harness.artifactPath);
      await harness.operator.update();
      const installation = JSON.parse(
        await fsp.readFile(harness.layout.installationPath, 'utf8'),
      );
      if (mismatchedField === 'current') {
        [installation.current, installation.previous] = [
          installation.previous,
          installation.current,
        ];
      } else {
        installation.previous = null;
      }
      await fsp.writeFile(
        harness.layout.installationPath,
        `${JSON.stringify(installation, null, 2)}\n`,
      );

      const status = await harness.operator.status();
      expect(status).toMatchObject({
        health: 'degraded',
        integrity: { status: 'invalid' },
        activation: {
          phase: 'ACTIVE',
          action: null,
          selected: {
            artifactId: target.artifactId,
            revisionId: REVISION_ID,
          },
          rollback: {
            artifactId: source.artifactId,
            revisionId: REVISION_ID,
          },
        },
      });
    },
  );

  it('rolls back through the durable activation projection', async () => {
    const harness = await createHarness();
    const source = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.install();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    const target = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.update();

    await expect(harness.operator.rollback()).resolves.toMatchObject({
      action: 'rollback',
      requestStatus: 'fulfilled',
      outcome: 'target-active',
      health: 'healthy',
      activeArtifactId: source.artifactId,
      rollbackArtifactId: target.artifactId,
    });
  });

  it('refuses rollback from the retained candidate instead of reporting a false success', async () => {
    const harness = await createHarness();
    const source = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.install();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    const target = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.update();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v1');

    await expect(harness.operator.rollback()).rejects.toThrow(
      /exact currently selected release/,
    );
    await expect(fsp.readlink(harness.layout.currentLink)).resolves.toBe(
      path.join('releases', target.artifactId),
    );
    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'healthy',
      activation: {
        selected: { artifactId: target.artifactId },
        rollback: { artifactId: source.artifactId },
      },
    });
  });

  it('requires recover rather than toggling after an ambiguous completed rollback', async () => {
    const harness = await createHarness();
    const source = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.install();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    const invokingSource = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.update();
    await harness.operator.rollback();
    const selectionAfterRollback = await fsp.readlink(
      harness.layout.currentLink,
    );

    await expect(harness.operator.rollback()).rejects.toThrow(
      /use service recover after an ambiguous rollback response/,
    );
    await expect(harness.operator.recover()).resolves.toMatchObject({
      action: 'recover',
      requestStatus: 'fulfilled',
      outcome: 'target-active',
      activeArtifactId: source.artifactId,
      rollbackArtifactId: invokingSource.artifactId,
    });
    await expect(fsp.readlink(harness.layout.currentLink)).resolves.toBe(
      selectionAfterRollback,
    );
  });

  it('refuses to resolve an in-flight rollback through desired-target convergence', async () => {
    const harness = await createHarness();
    const source = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.install();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    await harness.operator.update();
    harness.state.failStartResponseOnce = true;

    await expect(harness.operator.rollback()).rejects.toMatchObject({
      code: 'systemd-user-service-activation-recovery-required',
    });
    harness.calls.length = 0;

    await expect(harness.operator.converge()).rejects.toMatchObject({
      code: 'systemd-user-service-converge-rollback-recovery-required',
      remediation:
        'Run service recover before retrying desired-target convergence.',
    });
    expect(
      harness.calls.filter(
        (/** @type {{command: string, args: string[]}} */ call) =>
          call.command === 'systemctl' &&
          ['stop', 'daemon-reload', 'enable', 'start'].includes(call.args[1]),
      ),
    ).toEqual([]);
    await expect(harness.operator.status()).resolves.toMatchObject({
      activation: { phase: 'ACTIVATING', action: 'rollback' },
      desiredConvergence: {
        disposition: 'conflict',
        basis: null,
      },
    });
    await expect(harness.operator.recover()).resolves.toMatchObject({
      action: 'recover',
      requestStatus: 'fulfilled',
      activeArtifactId: source.artifactId,
    });
  });

  it('refuses an update while durable source work remains nonterminal', async () => {
    let blocked = false;
    const harness = await createHarness({
      listRuns: async () => ({
        items: blocked
          ? [
              {
                runId: 'running-work',
                appId: APP_ID,
                revisionId: REVISION_ID,
                kind: 'workflow',
                status: 'RUNNING',
                version: 1,
                lastSequence: 1,
                createdAt: 1,
                updatedAt: 1,
              },
            ]
          : [],
      }),
    });
    const source = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.install();
    blocked = true;
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');

    await expect(harness.operator.update()).resolves.toMatchObject({
      action: 'update',
      requestStatus: 'refused',
      outcome: 'source-retained',
      health: 'healthy',
      activeArtifactId: source.artifactId,
      reason: 'durable-work',
      blockingWork: {
        blockerCount: 1,
        blockers: [{ runId: 'running-work', status: 'RUNNING' }],
      },
    });
  });

  it('restores the exact source after a definitive target service failure', async () => {
    const harness = await createHarness();
    const source = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.install();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    const target = await inspectArtifactBytes(harness.artifactPath);
    harness.state.failedArtifactId = target.artifactId;

    await expect(harness.operator.update()).resolves.toMatchObject({
      action: 'update',
      requestStatus: 'failed',
      outcome: 'source-restored',
      health: 'healthy',
      activeArtifactId: source.artifactId,
      activeRevisionId: REVISION_ID,
    });
    await expect(fsp.readlink(harness.layout.currentLink)).resolves.toBe(
      path.join('releases', source.artifactId),
    );
  });

  it('restores the source when the target exits cleanly instead of remaining ACTIVATING', async () => {
    const harness = await createHarness();
    const source = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.install();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    const target = await inspectArtifactBytes(harness.artifactPath);
    harness.state.cleanExitArtifactId = target.artifactId;

    await expect(harness.operator.update()).resolves.toMatchObject({
      action: 'update',
      requestStatus: 'failed',
      outcome: 'source-restored',
      health: 'healthy',
      activeArtifactId: source.artifactId,
    });
    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'healthy',
      activation: {
        phase: 'ACTIVE',
        selected: { artifactId: source.artifactId },
      },
    });
  });

  it('marks a lost start response as recovery-required and recovers without a new update', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    const target = await inspectArtifactBytes(harness.artifactPath);
    harness.state.failStartResponseOnce = true;

    await expect(harness.operator.update()).rejects.toMatchObject({
      code: 'systemd-user-service-activation-recovery-required',
      remediation: 'Run service recover before retrying activation.',
    });
    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'degraded',
      activation: { phase: 'ACTIVATING', action: 'update' },
      desiredConvergence: {
        desired: {
          artifactId: target.artifactId,
          revisionId: REVISION_ID,
        },
        disposition: 'authorized',
        basis: 'durable-change',
      },
    });
    await expect(harness.operator.recover()).resolves.toMatchObject({
      action: 'recover',
      requestStatus: 'fulfilled',
      activeArtifactId: target.artifactId,
    });
  });

  it('authorizes exact-target convergence through durable source restoration', async () => {
    const harness = await createHarness();
    const source = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.install();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    const target = await inspectArtifactBytes(harness.artifactPath);
    harness.state.failStartResponseOnce = true;
    await expect(harness.operator.update()).rejects.toMatchObject({
      code: 'systemd-user-service-activation-recovery-required',
    });
    await beginActivationSourceRestore(harness);

    await expect(harness.operator.status()).resolves.toMatchObject({
      activation: {
        phase: 'QUIESCING',
        action: 'update',
        desired: {
          artifactId: source.artifactId,
          revisionId: REVISION_ID,
        },
        selected: {
          artifactId: target.artifactId,
          revisionId: REVISION_ID,
        },
      },
      desiredConvergence: {
        desired: {
          artifactId: target.artifactId,
          revisionId: REVISION_ID,
        },
        disposition: 'authorized',
        basis: 'durable-change',
      },
    });
    await expect(harness.operator.converge()).resolves.toMatchObject({
      action: 'converge',
      requestStatus: 'fulfilled',
      outcome: 'target-active',
      activeArtifactId: target.artifactId,
      rollbackArtifactId: source.artifactId,
    });
  });

  it('rejects a foreign uninstalled tombstone during source restoration', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    harness.state.failStartResponseOnce = true;
    await expect(harness.operator.update()).rejects.toMatchObject({
      code: 'systemd-user-service-activation-recovery-required',
    });
    await beginActivationSourceRestore(harness);
    const tombstone = JSON.parse(
      await fsp.readFile(harness.layout.installationPath, 'utf8'),
    );
    tombstone.state = 'uninstalled';
    tombstone.current.revisionId = `wrv1_${Buffer.alloc(32, 6).toString('base64url')}`;
    await fsp.writeFile(
      harness.layout.installationPath,
      `${JSON.stringify(tombstone, null, 2)}\n`,
    );

    await expect(harness.operator.status()).resolves.toMatchObject({
      activation: {
        phase: 'QUIESCING',
        action: 'update',
      },
      desiredConvergence: {
        disposition: 'conflict',
        basis: null,
      },
    });
  });

  it('recovers a selector/receipt crash boundary under the durable phase', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    const target = await inspectArtifactBytes(harness.artifactPath);
    harness.state.failDaemonReloadOnce = true;

    await expect(harness.operator.update()).rejects.toThrow(
      /daemon reload interrupted/,
    );
    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'degraded',
      activation: {
        phase: 'QUIESCENT',
        action: 'update',
      },
      desiredConvergence: {
        desired: {
          artifactId: target.artifactId,
          revisionId: REVISION_ID,
        },
        disposition: 'authorized',
        basis: 'durable-change',
      },
    });
    await expect(harness.operator.recover()).resolves.toMatchObject({
      action: 'recover',
      requestStatus: 'fulfilled',
      outcome: 'target-active',
      health: 'healthy',
      activeArtifactId: target.artifactId,
    });
  });

  it('rejects a foreign uninstalled tombstone during durable update', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    harness.state.failDaemonReloadOnce = true;
    await expect(harness.operator.update()).rejects.toThrow(
      /daemon reload interrupted/,
    );
    const tombstone = JSON.parse(
      await fsp.readFile(harness.layout.installationPath, 'utf8'),
    );
    tombstone.state = 'uninstalled';
    tombstone.current.revisionId = `wrv1_${Buffer.alloc(32, 7).toString('base64url')}`;
    await fsp.writeFile(
      harness.layout.installationPath,
      `${JSON.stringify(tombstone, null, 2)}\n`,
    );

    await expect(harness.operator.status()).resolves.toMatchObject({
      activation: {
        phase: 'QUIESCENT',
        action: 'update',
      },
      desiredConvergence: {
        disposition: 'conflict',
        basis: null,
      },
    });
  });

  it('verifies authorized uninstalled tombstone metadata during durable update', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    harness.state.failDaemonReloadOnce = true;
    await expect(harness.operator.update()).rejects.toThrow(
      /daemon reload interrupted/,
    );
    const tombstone = JSON.parse(
      await fsp.readFile(harness.layout.installationPath, 'utf8'),
    );
    tombstone.state = 'uninstalled';
    tombstone.current.size += 1;
    await fsp.writeFile(
      harness.layout.installationPath,
      `${JSON.stringify(tombstone, null, 2)}\n`,
    );

    await expect(harness.operator.status()).resolves.toMatchObject({
      activation: {
        phase: 'QUIESCENT',
        action: 'update',
      },
      desiredConvergence: {
        disposition: 'conflict',
        basis: null,
      },
    });
  });

  it('reports QUIESCING as degraded and refuses a concurrent manual stop', async () => {
    let interruptQuiescence = false;
    const harness = await createHarness({
      listRuns: async () => {
        if (interruptQuiescence) {
          throw new Error('quiescence observation interrupted');
        }
        return { items: [] };
      },
    });
    await harness.operator.install();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    interruptQuiescence = true;

    await expect(harness.operator.update()).rejects.toMatchObject({
      code: 'systemd-user-service-activation-recovery-required',
    });
    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'degraded',
      integrity: { status: 'verified' },
      activation: { phase: 'QUIESCING', action: 'update' },
      desiredConvergence: {
        disposition: 'authorized',
        basis: 'durable-change',
      },
    });
    harness.calls.length = 0;
    await expect(harness.operator.stop()).rejects.toMatchObject({
      code: 'systemd-user-service-activation-recovery-required',
      remediation: 'Run service recover before retrying activation.',
    });
    expect(harness.state.active).toBe(true);
    expect(harness.calls).not.toEqual(
      expect.arrayContaining([
        {
          command: 'systemctl',
          args: ['--user', 'stop', harness.layout.unitName],
        },
      ]),
    );
    interruptQuiescence = false;
    await expect(harness.operator.recover()).resolves.toMatchObject({
      outcome: 'target-active',
    });
  });

  it('refuses uninstall while durable activation convergence is in flight', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    harness.state.failDaemonReloadOnce = true;
    await expect(harness.operator.update()).rejects.toThrow(
      /daemon reload interrupted/,
    );

    await expect(harness.operator.uninstall()).rejects.toThrow(
      /activation is in flight.*recover/,
    );
    await expect(fsp.stat(harness.layout.unitPath)).resolves.toBeDefined();
    await expect(harness.operator.recover()).resolves.toMatchObject({
      outcome: 'target-active',
    });
  });

  it('fails closed when old physical wiring has no activation record', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    await eraseActivationRecord(harness);

    await expect(harness.operator.status()).resolves.toMatchObject({
      activation: null,
      integrity: { status: 'invalid' },
      health: 'degraded',
      wiring: { state: 'managed' },
      desiredConvergence: {
        disposition: 'conflict',
        basis: null,
      },
    });
    await expect(harness.operator.install()).rejects.toThrow(
      /activation is missing while an installation receipt exists/,
    );
    await expect(harness.operator.start()).rejects.toThrow(
      /not backed by the exact required durable activation state/,
    );
  });

  it('refuses service management outside packaged app storage context', async () => {
    const harness = await createHarness({ packagedStorage: false });

    await expect(harness.operator.install()).rejects.toThrow(
      /requires packaged app storage context/,
    );
    expect(harness.calls).toEqual([]);
  });

  it('refuses an explicit path that would split foreground and resident ledgers', async () => {
    const harness = await createHarness({
      environment: { WHARFIE_CONTROL_PATH: '/tmp/redirected-control' },
    });

    await expect(harness.operator.install()).rejects.toThrow(
      /WHARFIE_CONTROL_PATH redirects packaged commands/,
    );
    expect(harness.calls).toEqual([]);
  });

  it('is idempotent for the same verified release', async () => {
    const harness = await createHarness();
    await harness.operator.install();

    await expect(harness.operator.install()).resolves.toMatchObject({
      outcome: 'target-active',
      health: 'healthy',
    });
  });

  it('proves the exact durable current and rollback pair on fast reinstall', async () => {
    const harness = await createHarness();
    const source = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.install();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    const target = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.update();
    const activationBefore = await readActivationRecord(harness);
    const receiptBefore = await fsp.readFile(
      harness.layout.installationPath,
      'utf8',
    );
    harness.calls.length = 0;

    await expect(harness.operator.install()).resolves.toMatchObject({
      outcome: 'target-active',
      health: 'healthy',
      activeArtifactId: target.artifactId,
      rollbackArtifactId: source.artifactId,
    });
    await expect(readActivationRecord(harness)).resolves.toEqual(
      activationBefore,
    );
    await expect(
      fsp.readFile(harness.layout.installationPath, 'utf8'),
    ).resolves.toBe(receiptBefore);
    expect(
      harness.calls.filter(
        (/** @type {{command: string, args: string[]}} */ call) =>
          call.command === 'systemctl' &&
          ['stop', 'daemon-reload', 'enable', 'start'].includes(call.args[1]),
      ),
    ).toEqual([]);
  });

  it('rejects a mismatched previous receipt before stopping fast reinstall', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    await harness.operator.update();
    const installation = JSON.parse(
      await fsp.readFile(harness.layout.installationPath, 'utf8'),
    );
    installation.previous = null;
    await fsp.writeFile(
      harness.layout.installationPath,
      `${JSON.stringify(installation, null, 2)}\n`,
    );
    harness.calls.length = 0;

    await expect(harness.operator.install()).rejects.toThrow(
      /receipt is outside durable activation repair authority/,
    );
    expect(harness.state.active).toBe(true);
    expect(harness.calls).not.toEqual(
      expect.arrayContaining([
        {
          command: 'systemctl',
          args: ['--user', 'stop', harness.layout.unitName],
        },
      ]),
    );
  });

  it('does not stop a healthy service before rejecting an unauthorized receipt', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    await fsp.writeFile(harness.layout.installationPath, '{invalid-json');
    harness.calls.length = 0;

    await expect(harness.operator.install()).rejects.toThrow();
    expect(harness.state.active).toBe(true);
    expect(harness.calls).not.toEqual(
      expect.arrayContaining([
        {
          command: 'systemctl',
          args: ['--user', 'stop', harness.layout.unitName],
        },
      ]),
    );
  });

  it('reconciles a published release that predates its interrupted installation receipt', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    harness.state.active = false;
    harness.state.enabled = false;
    harness.state.now = 200;
    await fsp.unlink(harness.layout.installationPath);

    await expect(harness.operator.install()).resolves.toMatchObject({
      outcome: 'target-active',
      health: 'healthy',
    });
    const installation = JSON.parse(
      await fsp.readFile(harness.layout.installationPath, 'utf8'),
    );
    expect(installation).toMatchObject({
      installedAt: 100,
      updatedAt: 200,
      current: { installedAt: 100 },
    });
  });

  it('reports and removes active managed wiring orphaned by a missing receipt', async () => {
    const harness = await createHarness();
    const installed = await harness.operator.install();
    const retainedRelease = path.join(
      harness.layout.releasesRoot,
      installed.activeArtifactId,
      'app',
    );
    const retainedState = path.join(harness.layout.stateRoot, 'orphan-marker');
    await fsp.writeFile(retainedState, 'durable');
    await fsp.unlink(harness.layout.installationPath);

    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'degraded',
      installation: { state: 'absent' },
      systemd: { activeState: 'active', fragmentPath: harness.layout.unitPath },
      runtime: {
        status: 'READY',
        artifactId: installed.activeArtifactId,
        session: 'active',
        processId: 4321,
      },
      wiring: {
        state: 'orphaned',
        unitFile: 'managed',
        effectiveUnit: 'managed',
        cleanupPending: false,
      },
    });

    await expect(harness.operator.uninstall()).resolves.toMatchObject({
      action: 'uninstall',
      outcome: 'orphan-reconciled',
      health: 'absent',
    });
    await expect(fsp.readFile(retainedRelease, 'utf8')).resolves.toBe(
      'packaged-artifact-v1',
    );
    await expect(fsp.readFile(retainedState, 'utf8')).resolves.toBe('durable');
    await expect(fsp.stat(harness.layout.unitPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fsp.lstat(harness.layout.currentLink)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'absent',
      installation: {
        state: 'uninstalled',
        lastArtifactId: installed.activeArtifactId,
      },
      systemd: { loadState: 'not-found' },
      wiring: {
        state: 'absent',
        unitFile: 'absent',
        effectiveUnit: 'absent',
        cleanupPending: false,
      },
    });
  });

  it('repairs exact stale cached wiring for an ACTIVE selection', async () => {
    const harness = await createHarness({
      retainActiveWhenUnitMissingOnReload: true,
    });
    await harness.operator.install();
    await fsp.unlink(harness.layout.installationPath);
    await fsp.unlink(harness.layout.unitPath);
    harness.state.needDaemonReload = true;
    harness.calls.length = 0;

    await expect(harness.operator.status()).resolves.toMatchObject({
      systemd: { needDaemonReload: true },
      desiredConvergence: {
        disposition: 'authorized',
        basis: 'durable-active',
      },
    });
    expect(
      harness.calls.filter(
        (/** @type {{command: string, args: string[]}} */ call) =>
          call.command === 'systemctl' &&
          ['daemon-reload', 'enable', 'start', 'stop'].includes(call.args[1]),
      ),
    ).toEqual([]);
    harness.calls.length = 0;

    await expect(harness.operator.converge()).resolves.toMatchObject({
      outcome: 'target-active',
      health: 'healthy',
    });
    expect(harness.calls).toEqual(
      expect.arrayContaining([
        { command: 'systemctl', args: ['--user', 'daemon-reload'] },
      ]),
    );
    expect(harness.state.active).toBe(true);
  });

  it('reports and removes a verified selector left without unit wiring or a receipt', async () => {
    const harness = await createHarness();
    const installed = await harness.operator.install();
    await fsp.unlink(harness.layout.installationPath);
    await fsp.unlink(harness.layout.unitPath);
    await harness.execute('systemctl', ['--user', 'daemon-reload']);

    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'degraded',
      installation: { state: 'absent' },
      systemd: { loadState: 'not-found' },
      wiring: {
        state: 'orphaned',
        unitFile: 'absent',
        selection: 'managed',
        effectiveUnit: 'absent',
        cleanupPending: false,
      },
    });
    await expect(harness.operator.uninstall()).resolves.toMatchObject({
      outcome: 'orphan-reconciled',
      health: 'absent',
    });
    await expect(fsp.lstat(harness.layout.currentLink)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      fsp.readFile(harness.layout.installationPath, 'utf8'),
    ).resolves.toContain(installed.activeArtifactId);
  });

  it('refuses identity-less orphan cleanup when durable app state remains', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    const retainedState = path.join(
      harness.layout.stateRoot,
      'identity-required',
    );
    await fsp.writeFile(retainedState, 'durable');
    await fsp.unlink(harness.layout.installationPath);
    await fsp.unlink(harness.layout.currentLink);
    harness.calls.length = 0;

    await expect(harness.operator.uninstall()).rejects.toThrow(
      /durable application state exists without a verified release identity/i,
    );
    await expect(fsp.readFile(retainedState, 'utf8')).resolves.toBe('durable');
    await expect(fsp.stat(harness.layout.unitPath)).resolves.toBeDefined();
    expect(harness.calls).not.toEqual(
      expect.arrayContaining([
        {
          command: 'systemctl',
          args: ['--user', 'disable', '--now', harness.layout.unitName],
        },
      ]),
    );
  });

  it('removes identity-less exact unit wiring when no managed state exists', async () => {
    const harness = await createHarness();
    const staleMarkerTemp = path.join(
      harness.layout.serviceRoot,
      '..uninstalling.json.00000000-0000-4000-8000-000000000000.tmp',
    );
    await fsp.mkdir(harness.layout.serviceRoot, {
      recursive: true,
      mode: 0o700,
    });
    await fsp.writeFile(staleMarkerTemp, '{', { mode: 0o600 });
    await fsp.mkdir(path.dirname(harness.layout.unitPath), {
      recursive: true,
      mode: 0o700,
    });
    await fsp.writeFile(
      harness.layout.unitPath,
      createSystemdUserServiceUnit({ layout: harness.layout }),
      { mode: 0o600 },
    );
    await harness.execute('systemctl', ['--user', 'daemon-reload']);
    harness.state.active = true;
    harness.state.enabled = true;

    await expect(harness.operator.uninstall()).resolves.toMatchObject({
      outcome: 'orphan-reconciled',
      health: 'absent',
    });
    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'absent',
      installation: { state: 'absent' },
      wiring: {
        state: 'absent',
        unitFile: 'absent',
        selection: 'absent',
        effectiveUnit: 'absent',
      },
    });
    await expect(fsp.stat(staleMarkerTemp)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects a tampered immutable release on idempotent install', async () => {
    const harness = await createHarness();
    const installed = await harness.operator.install();
    const installedPath = path.join(
      harness.layout.releasesRoot,
      installed.activeArtifactId,
      'app',
    );
    await fsp.chmod(installedPath, 0o700);
    await fsp.writeFile(installedPath, 'tampered');

    await expect(harness.operator.status()).resolves.toMatchObject({
      desiredConvergence: {
        disposition: 'conflict',
        basis: null,
      },
    });
    await expect(harness.operator.install()).rejects.toThrow(
      /bytes failed verification/,
    );
  });

  it('rejects a selected release whose target identity was changed', async () => {
    const harness = await createHarness();
    const installed = await harness.operator.install();
    const releasePath = path.join(
      harness.layout.releasesRoot,
      installed.activeArtifactId,
      'release.json',
    );
    const release = JSON.parse(await fsp.readFile(releasePath, 'utf8'));
    release.target.architecture = 'arm64';
    await fsp.chmod(releasePath, 0o600);
    await fsp.writeFile(releasePath, `${JSON.stringify(release, null, 2)}\n`);
    await fsp.unlink(harness.layout.installationPath);

    await expect(harness.operator.status()).resolves.toMatchObject({
      desiredConvergence: {
        disposition: 'conflict',
        basis: null,
      },
    });
    await expect(harness.operator.install()).rejects.toThrow(
      /immutable release disagrees with its reference/,
    );
  });

  it('refuses install without lingering before materializing service state', async () => {
    const harness = await createHarness({ linger: false });

    await expect(harness.operator.install()).rejects.toThrow(
      /lingering is required/,
    );
    await expect(fsp.stat(harness.layout.serviceRoot)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('proves the user manager is reachable before materializing service state', async () => {
    const harness = await createHarness();
    harness.state.failUnitPath = true;

    await expect(harness.operator.install()).rejects.toThrow(
      /user manager unavailable/,
    );
    await expect(fsp.stat(harness.layout.serviceRoot)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('preserves permissions on existing shared XDG and systemd directories', async () => {
    const harness = await createHarness();
    const systemdRoot = path.join(harness.layout.configRoot, 'systemd');
    const unitRoot = path.dirname(harness.layout.unitPath);
    await fsp.mkdir(unitRoot, { recursive: true });
    for (const directory of [
      harness.layout.configRoot,
      systemdRoot,
      unitRoot,
    ]) {
      await fsp.chmod(directory, 0o755);
    }

    await expect(harness.operator.install()).resolves.toMatchObject({
      outcome: 'target-active',
    });
    for (const directory of [
      harness.layout.configRoot,
      systemdRoot,
      unitRoot,
    ]) {
      const stats = await fsp.stat(directory);
      expect(stats.mode & 0o777).toBe(0o755);
    }
  });

  it('refuses a group-writable shared config root without changing it', async () => {
    const harness = await createHarness();
    await fsp.mkdir(harness.layout.configRoot, { recursive: true });
    await fsp.chmod(harness.layout.configRoot, 0o775);

    await expect(harness.operator.install()).rejects.toThrow(
      /config root must not be writable by group or other users/,
    );
    expect((await fsp.stat(harness.layout.configRoot)).mode & 0o777).toBe(
      0o775,
    );
  });

  it('rejects a shell XDG unit path the live user manager does not search', async () => {
    const harness = await createHarness({
      managerUnitPaths: ['/home/example/.config/systemd/user'],
    });

    await expect(harness.operator.install()).rejects.toThrow(
      /does not search Wharfie's fixed unit directory/,
    );
    await expect(fsp.stat(harness.layout.serviceRoot)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fsp.stat(harness.layout.unitPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(harness.calls).not.toEqual(
      expect.arrayContaining([
        {
          command: 'systemctl',
          args: ['--user', 'enable', 'wharfie-service-demo.service'],
        },
      ]),
    );
  });

  it('rechecks a fresh account-home unit directory after manager reload', async () => {
    const harness = await createHarness({
      managerUnitPaths: ['/run/systemd/user'],
      managerDiscoversUnitPathAfterReload: true,
    });

    await expect(harness.operator.install()).resolves.toMatchObject({
      action: 'install',
      health: 'healthy',
    });
    expect(
      harness.calls.filter(
        (/** @type {{args: string[]}} */ call) =>
          call.args[1] === 'show' && call.args.includes('--property=UnitPath'),
      ),
    ).toHaveLength(3);
  });

  it('allows an unknown unit name before publishing the first unit', async () => {
    const harness = await createHarness({ unitInitiallyUnknown: true });

    await expect(harness.operator.install()).resolves.toMatchObject({
      action: 'install',
      health: 'healthy',
    });
  });

  it('reloads a stale manager cache while the unit name is still unknown', async () => {
    const harness = await createHarness({ unitInitiallyUnknown: true });
    harness.state.needDaemonReload = true;

    await expect(harness.operator.install()).resolves.toMatchObject({
      action: 'install',
      health: 'healthy',
    });
    expect(harness.calls).toEqual(
      expect.arrayContaining([
        { command: 'systemctl', args: ['--user', 'daemon-reload'] },
      ]),
    );
  });

  it('fails closed when exact unit preflight loses the manager', async () => {
    const harness = await createHarness();
    harness.state.failUnitShow = true;

    await expect(harness.operator.install()).rejects.toThrow(
      /unit preflight unavailable/,
    );
    await expect(fsp.stat(harness.layout.serviceRoot)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects invocation-specific XDG config and accepts the fixed account root', async () => {
    const harness = await createHarness({
      deriveConfigRoot: true,
      environment: { XDG_CONFIG_HOME: '/tmp/invocation-specific-config' },
    });

    await expect(harness.operator.install()).rejects.toMatchObject({
      code: 'systemd-user-service-unstable-config-root',
    });
    expect(harness.calls).toEqual([]);

    const fixed = await createHarness({
      deriveConfigRoot: true,
      useDefaultXdgConfigHome: true,
    });
    await expect(fixed.operator.install()).resolves.toMatchObject({
      action: 'install',
      health: 'healthy',
    });
    expect(fixed.layout.configRoot).toBe(
      path.join(fixed.root, 'account-home', '.config'),
    );
  });

  it('anchors packaged durable state to the account instead of ambient XDG data', async () => {
    const harness = await createHarness({
      deriveDataRoot: true,
      environment: { XDG_DATA_HOME: '/tmp/invocation-specific-data' },
    });

    await expect(harness.operator.install()).resolves.toMatchObject({
      action: 'install',
      health: 'healthy',
    });
    expect(harness.layout.dataRoot).toBe(
      path.join(
        harness.root,
        'account-home',
        '.local',
        'share',
        'wharfie-nodejs',
      ),
    );
  });

  it('rejects a foreign effective unit before staging or enabling install', async () => {
    const harness = await createHarness({
      managerFragmentPath: '/etc/systemd/user/wharfie-service-demo.service',
    });

    await expect(harness.operator.install()).rejects.toThrow(
      /effective manager wiring exists/,
    );
    await expect(fsp.stat(harness.layout.serviceRoot)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fsp.stat(harness.layout.unitPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(harness.state.active).toBe(false);
    expect(harness.calls).not.toEqual(
      expect.arrayContaining([
        {
          command: 'systemctl',
          args: ['--user', 'enable', 'wharfie-service-demo.service'],
        },
      ]),
    );
  });

  it('rejects conflicting fixed-unit bytes before selecting a release', async () => {
    const harness = await createHarness();
    await fsp.mkdir(path.dirname(harness.layout.unitPath), {
      recursive: true,
      mode: 0o700,
    });
    await fsp.writeFile(
      harness.layout.unitPath,
      '[Unit]\nDescription=foreign unit\n',
      { mode: 0o600 },
    );
    harness.state.needDaemonReload = true;

    await expect(harness.operator.install()).rejects.toThrow(
      /fixed unit wiring exists/,
    );
    await expect(fsp.readFile(harness.layout.unitPath, 'utf8')).resolves.toBe(
      '[Unit]\nDescription=foreign unit\n',
    );
    await expect(fsp.lstat(harness.layout.currentLink)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      fsp.stat(harness.layout.installationPath),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(harness.calls).not.toEqual(
      expect.arrayContaining([
        {
          command: 'systemctl',
          args: ['--user', 'enable', 'wharfie-service-demo.service'],
        },
      ]),
    );
  });

  it('refuses managed symlink redirection and foreign ownership', async () => {
    const linked = await createHarness();
    const redirect = path.join(linked.root, 'redirect');
    await fsp.mkdir(linked.dataRoot, { recursive: true });
    await fsp.mkdir(redirect);
    await fsp.symlink(
      redirect,
      path.join(linked.dataRoot, 'applications'),
      'dir',
    );

    await expect(linked.operator.install()).rejects.toThrow(
      /applications root must be a real directory/,
    );

    const foreign = await createHarness({ filesystemUid: 999_999 });
    await expect(foreign.operator.install()).rejects.toThrow(
      /must be owned by the service user/,
    );
  });

  it('tightens app-owned roots without rewriting shared config permissions', async () => {
    const harness = await createHarness();
    await fsp.mkdir(harness.dataRoot, { recursive: true, mode: 0o775 });
    await fsp.chmod(harness.dataRoot, 0o775);
    await fsp.mkdir(path.dirname(harness.layout.unitPath), {
      recursive: true,
      mode: 0o755,
    });
    const sharedDirectories = [
      harness.configRoot,
      path.join(harness.configRoot, 'systemd'),
      path.dirname(harness.layout.unitPath),
    ];
    for (const directory of sharedDirectories) {
      await fsp.chmod(directory, 0o755);
    }

    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'absent',
      installation: { state: 'absent' },
      wiring: {
        state: 'absent',
        unitFile: 'absent',
        effectiveUnit: 'absent',
        cleanupPending: false,
      },
    });

    const managedDirectories = [
      harness.dataRoot,
      path.dirname(harness.layout.serviceRoot),
      harness.layout.serviceRoot,
      harness.layout.stateRoot,
      harness.layout.controlPath,
      harness.layout.applicationStatePath,
    ];
    for (const directory of managedDirectories) {
      await fsp.mkdir(directory, { recursive: true, mode: 0o775 });
      await fsp.chmod(directory, 0o775);
    }
    await expect(harness.operator.install()).resolves.toMatchObject({
      outcome: 'target-active',
      health: 'healthy',
    });
    for (const directory of managedDirectories) {
      expect((await fsp.stat(directory)).mode & 0o777).toBe(0o700);
    }
    for (const directory of sharedDirectories) {
      expect((await fsp.stat(directory)).mode & 0o777).toBe(0o755);
    }
  });

  it('refuses non-Linux service management before reading embedded state', async () => {
    const harness = await createHarness({ platform: 'darwin' });

    await expect(harness.operator.status()).rejects.toThrow(
      /supported only on Linux/,
    );
    expect(harness.execute).not.toHaveBeenCalled();
  });

  it('refuses a boot-persistent authored service under uid 0', async () => {
    const harness = await createHarness({ uid: 0 });

    await expect(harness.operator.install()).rejects.toThrow(
      /non-root real\/effective local user ID/,
    );
    expect(harness.execute).not.toHaveBeenCalled();
  });

  it('classifies a systemd-active process with stale durable ownership as degraded', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    harness.state.runtimeMode = 'stale-session';

    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'degraded',
      systemd: { activeState: 'active' },
      runtime: { status: 'READY', session: 'absent' },
    });
  });

  it.each(['null', 'stopped'])(
    'does not authorize a live MainPID with %s runtime ownership',
    async (runtimeMode) => {
      const harness = await createHarness();
      await harness.operator.install();
      harness.state.runtimeMode = runtimeMode;

      await expect(harness.operator.status()).resolves.toMatchObject({
        systemd: { activeState: 'active', mainPid: 4321 },
        desiredConvergence: {
          disposition: 'conflict',
          basis: null,
        },
      });
    },
  );

  it('requires the durable resident to run the exact installed artifact', async () => {
    const harness = await createHarness();
    const installed = await harness.operator.install();
    harness.state.runtimeMode = 'wrong-artifact';

    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'degraded',
      installation: { activeArtifactId: installed.activeArtifactId },
      runtime: {
        status: 'READY',
        revisionId: REVISION_ID,
        session: 'active',
      },
    });
    const status = await harness.operator.status();
    expect(status.runtime.artifactId).not.toBe(installed.activeArtifactId);
  });

  it('rejects a live rollback release even though activation retains its authority', async () => {
    const harness = await createHarness();
    const source = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.install();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    const target = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.update();
    harness.state.runtimeArtifactId = source.artifactId;

    await expect(harness.operator.status()).resolves.toMatchObject({
      activation: {
        selected: { artifactId: target.artifactId },
        rollback: { artifactId: source.artifactId },
      },
      runtime: {
        artifactId: source.artifactId,
        session: 'active',
        processId: 4321,
      },
      desiredConvergence: {
        disposition: 'conflict',
        basis: null,
      },
    });
  });

  it('requires the live durable resident to be systemd MainPID', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    harness.state.runtimeMode = 'wrong-process';

    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'degraded',
      systemd: { activeState: 'active', mainPid: 4321 },
      runtime: { status: 'READY', session: 'active', processId: 9876 },
      desiredConvergence: {
        disposition: 'conflict',
        basis: null,
      },
    });
  });

  it('reports unknown desired convergence when the manager cannot be observed', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    harness.state.failUnitShow = true;

    await expect(harness.operator.status()).resolves.toMatchObject({
      systemd: { loadState: 'unavailable' },
      desiredConvergence: {
        disposition: 'unknown',
        basis: null,
      },
    });
  });

  it('degrades a live service that is no longer boot-enabled', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    harness.state.enabled = false;

    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'degraded',
      persistence: {
        linger: true,
        unitEnabled: false,
        bootEnabled: false,
      },
    });

    harness.state.enabled = true;
    harness.state.linger = false;
    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'degraded',
      persistence: {
        linger: false,
        unitEnabled: true,
        bootEnabled: false,
      },
    });
  });

  it('refuses start when persistent unit enablement was removed', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    await harness.operator.stop();
    harness.state.enabled = false;

    await expect(harness.operator.start()).rejects.toThrow(
      /no longer enabled.*service install/,
    );
    expect(harness.state.active).toBe(false);
  });

  it('reports supervisor failure before a stale durable STARTING state', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    harness.state.systemdMode = 'failed';
    harness.state.runtimeMode = 'starting';

    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'failed',
      systemd: { activeState: 'failed', result: 'failed' },
      runtime: { status: 'STARTING' },
    });
  });

  it('controls graceful stop, start, and restart through argv-only systemctl calls', async () => {
    const harness = await createHarness();
    await harness.operator.install();

    await expect(harness.operator.stop()).resolves.toMatchObject({
      action: 'stop',
      outcome: 'stopped',
      health: 'stopped',
    });
    await expect(harness.operator.start()).resolves.toMatchObject({
      action: 'start',
      outcome: 'started',
      health: 'healthy',
    });
    await expect(harness.operator.restart()).resolves.toMatchObject({
      action: 'restart',
      outcome: 'restarted',
      health: 'healthy',
    });
    expect(harness.calls).toEqual(
      expect.arrayContaining([
        {
          command: 'systemctl',
          args: ['--user', 'stop', 'wharfie-service-demo.service'],
        },
        {
          command: 'systemctl',
          args: ['--user', 'start', 'wharfie-service-demo.service'],
        },
        {
          command: 'systemctl',
          args: ['--user', 'restart', 'wharfie-service-demo.service'],
        },
      ]),
    );
  });

  it('stops systemd even when durable runtime state is unavailable', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    harness.state.runtimeMode = 'unavailable';

    await expect(harness.operator.stop()).resolves.toMatchObject({
      action: 'stop',
      outcome: 'stopped',
      health: 'degraded',
    });
    expect(harness.state.active).toBe(false);
  });

  it('refuses to start a changed current selection and reports invalid integrity', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    await harness.operator.stop();
    await fsp.unlink(harness.layout.currentLink);
    await fsp.symlink(
      'releases/not-the-installed-artifact',
      harness.layout.currentLink,
    );

    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'degraded',
      integrity: { status: 'invalid' },
    });
    await expect(harness.operator.start()).rejects.toThrow(
      /current selection was changed/,
    );
  });

  it('refuses to start a changed fixed unit and exposes invalid integrity', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    await harness.operator.stop();
    const unit = await fsp.readFile(harness.layout.unitPath, 'utf8');
    await fsp.writeFile(
      harness.layout.unitPath,
      unit.replace('Restart=on-failure', 'Restart=no'),
    );

    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'degraded',
      integrity: { status: 'invalid' },
    });
    await expect(harness.operator.start()).rejects.toThrow(/unit was changed/);
  });

  it('rejects a different effective unit or any systemd drop-in', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    await harness.operator.stop();
    harness.state.fragmentPath =
      '/etc/systemd/user/wharfie-service-demo.service';

    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'degraded',
      integrity: { status: 'invalid' },
    });
    await expect(harness.operator.start()).rejects.toThrow(
      /different unit or additional drop-ins/,
    );

    harness.state.fragmentPath = harness.layout.unitPath;
    harness.state.dropInPaths =
      '/etc/systemd/user/wharfie-service-demo.service.d/override.conf';
    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'degraded',
      integrity: { status: 'invalid' },
    });
    await expect(harness.operator.start()).rejects.toThrow(
      /different unit or additional drop-ins/,
    );
  });

  it('never stops or uninstalls a foreign effective unit with the same name', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    harness.state.fragmentPath =
      '/etc/systemd/user/wharfie-service-demo.service';

    await expect(harness.operator.stop()).rejects.toThrow(
      /different unit or additional drop-ins/,
    );
    await expect(harness.operator.uninstall()).rejects.toThrow(
      /unit name is already claimed/,
    );
    expect(harness.state.active).toBe(true);
    await expect(fsp.stat(harness.layout.unitPath)).resolves.toMatchObject({
      mode: expect.any(Number),
    });
    await expect(fsp.stat(harness.layout.uninstallPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('refuses stop but reloads stale manager state before uninstall', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    harness.state.needDaemonReload = true;

    await expect(harness.operator.stop()).rejects.toThrow(
      /unit cache is stale/,
    );
    await expect(harness.operator.uninstall()).resolves.toMatchObject({
      outcome: 'uninstalled',
      health: 'absent',
    });
    expect(harness.state.active).toBe(false);
    expect(harness.calls).toEqual(
      expect.arrayContaining([
        { command: 'systemctl', args: ['--user', 'daemon-reload'] },
      ]),
    );
  });

  it('uninstalls manager wiring while preserving immutable releases and durable state', async () => {
    const harness = await createHarness();
    const installed = await harness.operator.install();
    const retainedRelease = path.join(
      harness.layout.releasesRoot,
      installed.activeArtifactId,
      'app',
    );
    await fsp.writeFile(
      path.join(harness.layout.stateRoot, 'retained-marker'),
      'durable',
    );

    await expect(harness.operator.uninstall()).resolves.toMatchObject({
      action: 'uninstall',
      outcome: 'uninstalled',
      health: 'absent',
      preserved: {
        releases: harness.layout.releasesRoot,
        state: harness.layout.stateRoot,
      },
    });
    await expect(fsp.readFile(retainedRelease, 'utf8')).resolves.toBe(
      'packaged-artifact-v1',
    );
    await expect(
      fsp.readFile(
        path.join(harness.layout.stateRoot, 'retained-marker'),
        'utf8',
      ),
    ).resolves.toBe('durable');
    await expect(fsp.stat(harness.layout.unitPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const retainedInstallation = JSON.parse(
      await fsp.readFile(harness.layout.installationPath, 'utf8'),
    );
    expect(retainedInstallation).toMatchObject({
      state: 'uninstalled',
      current: {
        artifactId: installed.activeArtifactId,
        revisionId: REVISION_ID,
      },
    });
    await expect(harness.operator.status()).resolves.toMatchObject({
      installation: {
        state: 'uninstalled',
        lastArtifactId: installed.activeArtifactId,
        lastRevisionId: REVISION_ID,
      },
      wiring: {
        state: 'absent',
        unitFile: 'absent',
        effectiveUnit: 'absent',
        cleanupPending: false,
      },
      health: 'absent',
    });
    await expect(harness.operator.uninstall()).resolves.toMatchObject({
      outcome: 'already-uninstalled',
      health: 'absent',
    });
    await expect(harness.operator.start()).rejects.toThrow(/not installed/);
  });

  it('reports missing uninstall receipt state as corruption while activation remains ACTIVE', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    await harness.operator.uninstall();
    await fsp.unlink(harness.layout.installationPath);

    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'degraded',
      integrity: { status: 'invalid' },
      installation: { state: 'absent' },
      wiring: { state: 'absent' },
      activation: { phase: 'ACTIVE' },
    });
  });

  it('reconverges a tombstone after exact managed unit wiring is resurrected', async () => {
    const harness = await createHarness();
    const installed = await harness.operator.install();
    const retainedRelease = path.join(
      harness.layout.releasesRoot,
      installed.activeArtifactId,
      'app',
    );
    const retainedState = path.join(
      harness.layout.stateRoot,
      'resurrection-marker',
    );
    await fsp.writeFile(retainedState, 'durable');
    await harness.operator.uninstall();
    await fsp.writeFile(
      harness.layout.unitPath,
      createSystemdUserServiceUnit({ layout: harness.layout }),
      { mode: 0o600 },
    );
    harness.state.needDaemonReload = true;
    await harness.execute('systemctl', ['--user', 'daemon-reload']);
    harness.state.active = true;
    harness.state.enabled = true;
    harness.calls.length = 0;

    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'degraded',
      installation: { state: 'uninstalled' },
      wiring: {
        state: 'orphaned',
        unitFile: 'managed',
        effectiveUnit: 'managed',
        cleanupPending: false,
      },
    });
    await expect(harness.operator.uninstall()).resolves.toMatchObject({
      outcome: 'orphan-reconciled',
      health: 'absent',
    });
    await expect(fsp.readFile(retainedRelease, 'utf8')).resolves.toBe(
      'packaged-artifact-v1',
    );
    await expect(fsp.readFile(retainedState, 'utf8')).resolves.toBe('durable');
    await expect(fsp.stat(harness.layout.unitPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'absent',
      installation: { state: 'uninstalled' },
      systemd: { loadState: 'not-found' },
      wiring: { state: 'absent' },
    });
  });

  it('refuses cached managed wiring when both local unit bytes and receipt are missing', async () => {
    const harness = await createHarness();
    const installed = await harness.operator.install();
    const retainedRelease = path.join(
      harness.layout.releasesRoot,
      installed.activeArtifactId,
      'app',
    );
    await fsp.unlink(harness.layout.unitPath);
    await fsp.unlink(harness.layout.installationPath);
    harness.state.needDaemonReload = true;
    harness.state.retainActiveWhenUnitMissingOnReload = true;
    harness.calls.length = 0;

    await expect(harness.operator.uninstall()).rejects.toThrow(
      /cached a unit whose local bytes cannot be verified/,
    );
    expect(harness.calls).not.toEqual(
      expect.arrayContaining([
        { command: 'systemctl', args: ['--user', 'daemon-reload'] },
        {
          command: 'systemctl',
          args: ['--user', 'disable', '--now', harness.layout.unitName],
        },
      ]),
    );
    await expect(fsp.readFile(retainedRelease, 'utf8')).resolves.toBe(
      'packaged-artifact-v1',
    );
    await expect(fsp.readlink(harness.layout.currentLink)).resolves.toBe(
      path.join('releases', installed.activeArtifactId),
    );
    await expect(fsp.stat(harness.layout.uninstallPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('restores authorized missing unit bytes before reloading an active service', async () => {
    const harness = await createHarness({
      retainActiveWhenUnitMissingOnReload: true,
    });
    await harness.operator.install();
    await fsp.unlink(harness.layout.unitPath);
    harness.state.needDaemonReload = true;
    harness.calls.length = 0;

    await expect(harness.operator.uninstall()).resolves.toMatchObject({
      outcome: 'uninstalled',
      health: 'absent',
    });
    expect(harness.calls).toEqual(
      expect.arrayContaining([
        { command: 'systemctl', args: ['--user', 'daemon-reload'] },
        {
          command: 'systemctl',
          args: ['--user', 'disable', '--now', harness.layout.unitName],
        },
      ]),
    );
    expect(harness.state.active).toBe(false);
  });

  it('serializes clean absent uninstall and establishes disk and manager absence', async () => {
    const harness = await createHarness();

    await expect(harness.operator.uninstall()).resolves.toMatchObject({
      outcome: 'already-uninstalled',
    });
    expect(harness.acquireOperationLock).toHaveBeenCalledTimes(1);
    await expect(fsp.stat(harness.layout.unitPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fsp.lstat(harness.layout.currentLink)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      fsp.stat(harness.layout.installationPath),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'absent',
      installation: { state: 'absent' },
      systemd: { loadState: 'not-found' },
      wiring: {
        state: 'absent',
        unitFile: 'absent',
        effectiveUnit: 'absent',
        cleanupPending: false,
      },
    });
  });

  it('requires the selected SEA to repair an unexpectedly missing ACTIVE receipt before update', async () => {
    const harness = await createHarness();
    const source = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.install();
    await harness.operator.uninstall();
    await fsp.unlink(harness.layout.installationPath);
    const activationBefore = await readActivationRecord(harness);
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    const target = await inspectArtifactBytes(harness.artifactPath);
    harness.calls.length = 0;

    await expect(harness.operator.update()).rejects.toThrow(
      /lacks its exact installed source projection.*exact selected SEA.*service install before service update/,
    );
    await expect(readActivationRecord(harness)).resolves.toEqual(
      activationBefore,
    );
    expect(harness.state.active).toBe(false);
    await expect(fsp.lstat(harness.layout.currentLink)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      fsp.stat(path.join(harness.layout.releasesRoot, target.artifactId)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(
      harness.calls.filter(
        (/** @type {{command: string, args: string[]}} */ call) =>
          call.command === 'systemctl' &&
          ['stop', 'daemon-reload', 'enable', 'start'].includes(call.args[1]),
      ),
    ).toEqual([]);
    await expect(harness.operator.install()).rejects.toThrow(
      /exact selected SEA.*service install before service update/,
    );

    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v1');
    await expect(harness.operator.install()).resolves.toMatchObject({
      activeArtifactId: source.artifactId,
      health: 'healthy',
    });
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    await expect(harness.operator.update()).resolves.toMatchObject({
      action: 'update',
      requestStatus: 'fulfilled',
      outcome: 'target-active',
      health: 'healthy',
      activeArtifactId: target.artifactId,
      rollbackArtifactId: source.artifactId,
    });
  });

  it('converges a new desired SEA through an authorized missing ACTIVE source projection', async () => {
    const harness = await createHarness();
    const source = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.install();
    await harness.operator.uninstall();
    await fsp.unlink(harness.layout.installationPath);
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    const target = await inspectArtifactBytes(harness.artifactPath);
    harness.calls.length = 0;

    await expect(harness.operator.status()).resolves.toMatchObject({
      installation: { state: 'absent' },
      activation: {
        phase: 'ACTIVE',
        selected: {
          artifactId: source.artifactId,
          revisionId: REVISION_ID,
        },
      },
      desiredConvergence: {
        desired: {
          artifactId: target.artifactId,
          revisionId: REVISION_ID,
        },
        disposition: 'authorized',
        basis: 'durable-active',
      },
    });
    expect(
      harness.calls.filter(
        (/** @type {{command: string, args: string[]}} */ call) =>
          call.command === 'systemctl' &&
          ['daemon-reload', 'enable', 'start', 'stop'].includes(call.args[1]),
      ),
    ).toEqual([]);

    await expect(harness.operator.converge()).resolves.toMatchObject({
      action: 'converge',
      requestStatus: 'fulfilled',
      outcome: 'target-active',
      health: 'healthy',
      activeArtifactId: target.artifactId,
      rollbackArtifactId: source.artifactId,
    });
  });

  it('reprojects the retained source before an update after uninstall', async () => {
    const harness = await createHarness();
    const source = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.install();
    await harness.operator.uninstall();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    const target = await inspectArtifactBytes(harness.artifactPath);

    await expect(harness.operator.update()).resolves.toMatchObject({
      action: 'update',
      requestStatus: 'fulfilled',
      outcome: 'target-active',
      health: 'healthy',
      activeArtifactId: target.artifactId,
      rollbackArtifactId: source.artifactId,
    });
  });

  it('treats install from a new release over an uninstall tombstone as update', async () => {
    const harness = await createHarness();
    const source = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.install();
    await harness.operator.uninstall();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    const target = await inspectArtifactBytes(harness.artifactPath);

    await expect(harness.operator.install()).resolves.toMatchObject({
      action: 'install',
      requestStatus: 'fulfilled',
      outcome: 'target-active',
      health: 'healthy',
      activeArtifactId: target.artifactId,
      rollbackArtifactId: source.artifactId,
    });
  });

  it('replays interrupted ACTIVE repair with service install from the selected SEA', async () => {
    const harness = await createHarness();
    const source = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.install();
    await harness.operator.uninstall();
    const activationBefore = await readActivationRecord(harness);
    harness.state.failDaemonReloadOnce = true;

    await expect(harness.operator.install()).rejects.toMatchObject({
      code: 'systemd-user-service-active-reinstall-recovery-required',
      remediation:
        'Run service install again from the exact selected SEA to resume repair.',
    });
    await expect(readActivationRecord(harness)).resolves.toEqual(
      activationBefore,
    );

    await expect(harness.operator.install()).resolves.toMatchObject({
      outcome: 'target-active',
      health: 'healthy',
      activeArtifactId: source.artifactId,
    });
    await expect(readActivationRecord(harness)).resolves.toEqual(
      activationBefore,
    );
  });

  it('retries interrupted source reprojection through the same desired-target convergence command', async () => {
    const harness = await createHarness();
    const source = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.converge();
    await harness.operator.uninstall();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    const target = await inspectArtifactBytes(harness.artifactPath);
    harness.state.failDaemonReloadOnce = true;

    await expect(harness.operator.converge()).rejects.toMatchObject({
      code: 'systemd-user-service-active-reinstall-recovery-required',
      remediation: 'Retry service converge from this exact desired SEA.',
    });
    await expect(harness.operator.converge()).resolves.toMatchObject({
      action: 'converge',
      requestStatus: 'fulfilled',
      outcome: 'target-active',
      health: 'healthy',
      activeArtifactId: target.artifactId,
      rollbackArtifactId: source.artifactId,
    });
  });

  it('restarts a receipt-backed source whose repair start failed before taking effect', async () => {
    const harness = await createHarness();
    const source = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.converge();
    await harness.operator.uninstall();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    const target = await inspectArtifactBytes(harness.artifactPath);
    harness.state.failStartBeforeEffectOnce = true;

    await expect(harness.operator.converge()).rejects.toMatchObject({
      code: 'systemd-user-service-active-reinstall-recovery-required',
      remediation: 'Retry service converge from this exact desired SEA.',
    });
    expect(harness.state.active).toBe(false);

    await expect(harness.operator.converge()).resolves.toMatchObject({
      action: 'converge',
      requestStatus: 'fulfilled',
      outcome: 'target-active',
      health: 'healthy',
      activeArtifactId: target.artifactId,
      rollbackArtifactId: source.artifactId,
    });
  });

  it('installs over an activation-less uninstalled tombstone', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    await eraseActivationRecord(harness);
    await harness.operator.uninstall();
    const replacementTarget = Object.freeze({
      ...TARGET,
      architecture: 'arm64',
    });
    const replacementOperator =
      harness.createOperatorForTarget(replacementTarget);
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    const target = await inspectArtifactBytes(harness.artifactPath);

    await expect(replacementOperator.install()).resolves.toMatchObject({
      action: 'install',
      requestStatus: 'fulfilled',
      outcome: 'target-active',
      health: 'healthy',
      activeArtifactId: target.artifactId,
      rollbackArtifactId: null,
    });
    const installation = JSON.parse(
      await fsp.readFile(harness.layout.installationPath, 'utf8'),
    );
    expect(installation.current.target).toEqual(replacementTarget);
  });

  it('reinstalls the same release across wall-clock rollback', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');
    const target = await inspectArtifactBytes(harness.artifactPath);
    await harness.operator.update();
    const beforeUninstall = await readActivationRecord(harness);
    harness.state.now = 200;
    await harness.operator.uninstall();
    const afterUninstall = await readActivationRecord(harness);
    expect(afterUninstall).toMatchObject({
      recordVersion: beforeUninstall?.recordVersion,
      selectionGeneration: beforeUninstall?.selectionGeneration,
      selected: beforeUninstall?.selected,
      rollbackCandidate: beforeUninstall?.rollbackCandidate,
    });
    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'absent',
      installation: { state: 'uninstalled' },
      activation: {
        phase: 'ACTIVE',
        selected: { artifactId: target.artifactId },
        rollback: { artifactId: expect.any(String) },
      },
    });
    harness.state.now = 50;

    await expect(harness.operator.install()).resolves.toMatchObject({
      outcome: 'target-active',
      health: 'healthy',
    });
    const afterReinstall = await readActivationRecord(harness);
    expect(afterReinstall).toMatchObject({
      recordVersion: beforeUninstall?.recordVersion,
      selectionGeneration: beforeUninstall?.selectionGeneration,
      selected: beforeUninstall?.selected,
      rollbackCandidate: beforeUninstall?.rollbackCandidate,
    });
    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'healthy',
      installation: { state: 'installed' },
      activation: { phase: 'ACTIVE' },
    });
    const installation = JSON.parse(
      await fsp.readFile(harness.layout.installationPath, 'utf8'),
    );
    expect(installation.updatedAt).toBe(200);
  });

  it('retains its cleanup marker when removing the fixed unit reveals a lower-priority foreign unit', async () => {
    const harness = await createHarness();
    const installed = await harness.operator.install();
    const lowerPriorityDirectory = path.join(
      harness.root,
      'lower-priority-systemd-user',
    );
    const foreignPath = path.join(
      lowerPriorityDirectory,
      harness.layout.unitName,
    );
    harness.state.unitPaths.push(lowerPriorityDirectory);
    harness.state.revealForeignUnitPathAfterRemoval = foreignPath;

    await expect(harness.operator.uninstall()).rejects.toThrow(
      /exposed another or stale unit/,
    );
    await expect(fsp.stat(harness.layout.unitPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fsp.readFile(foreignPath, 'utf8')).resolves.toContain(
      'Description=foreign',
    );
    await expect(fsp.stat(harness.layout.uninstallPath)).resolves.toBeDefined();
    await expect(fsp.readlink(harness.layout.currentLink)).resolves.toBe(
      path.join('releases', installed.activeArtifactId),
    );
    const installation = JSON.parse(
      await fsp.readFile(harness.layout.installationPath, 'utf8'),
    );
    expect(installation.state).toBe('installed');
    expect(harness.state.active).toBe(false);

    harness.state.persistentForeignFragmentPath = null;
    harness.state.revealForeignUnitPathAfterRemoval = null;
    await fsp.unlink(foreignPath);
    await harness.execute('systemctl', ['--user', 'daemon-reload']);
    await expect(harness.operator.uninstall()).resolves.toMatchObject({
      outcome: 'uninstalled',
      health: 'absent',
    });
    await expect(fsp.stat(harness.layout.uninstallPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('reconverges a resumed uninstall if the worker was restarted', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    harness.state.failDaemonReloadOnce = true;

    await expect(harness.operator.uninstall()).rejects.toThrow(
      /daemon reload interrupted/,
    );
    await expect(fsp.stat(harness.layout.unitPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fsp.stat(harness.layout.uninstallPath)).resolves.toBeDefined();
    harness.state.active = true;
    harness.state.enabled = true;

    await expect(harness.operator.uninstall()).resolves.toMatchObject({
      outcome: 'uninstalled',
      health: 'absent',
    });
    expect(
      harness.calls.filter(
        (/** @type {{command: string, args: string[]}} */ call) =>
          call.command === 'systemctl' && call.args[1] === 'disable',
      ),
    ).toHaveLength(2);
    expect(harness.state.active).toBe(false);
    expect(harness.state.enabled).toBe(false);
    await expect(fsp.stat(harness.layout.uninstallPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('preserves installed-uninstall identity after crashing past tombstone publication', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    harness.state.now = 200;
    const originalUnlink = fsp.unlink.bind(fsp);
    let failCurrentUnlink = true;
    const unlink = jest
      .spyOn(fsp, 'unlink')
      .mockImplementation(async (value) => {
        if (String(value) === harness.layout.currentLink && failCurrentUnlink) {
          failCurrentUnlink = false;
          throw new Error('current unlink interrupted');
        }
        await originalUnlink(value);
      });

    await expect(harness.operator.uninstall()).rejects.toThrow(
      /current unlink interrupted/,
    );
    unlink.mockRestore();
    const interrupted = JSON.parse(
      await fsp.readFile(harness.layout.installationPath, 'utf8'),
    );
    expect(interrupted).toMatchObject({ state: 'uninstalled', updatedAt: 200 });
    await expect(fsp.stat(harness.layout.uninstallPath)).resolves.toBeDefined();
    await expect(fsp.lstat(harness.layout.currentLink)).resolves.toBeDefined();

    harness.state.now = 300;
    await expect(harness.operator.uninstall()).resolves.toMatchObject({
      outcome: 'uninstalled',
      health: 'absent',
    });
    const converged = JSON.parse(
      await fsp.readFile(harness.layout.installationPath, 'utf8'),
    );
    expect(converged).toMatchObject({ state: 'uninstalled', updatedAt: 200 });
  });
});
