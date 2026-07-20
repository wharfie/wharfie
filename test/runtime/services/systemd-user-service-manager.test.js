/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import createVanillaDB from '../../../src/core/lib/db/adapters/vanilla.js';
import {
  createLedgerServiceId,
  createLedgerServiceLifecycle,
  createLedgerServiceOwnership,
  createLedgerServiceSessionId,
} from '../../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import { inspectArtifactBytes } from '../../../src/core/runtime/packaged-artifact.js';
import {
  acquireSystemdUserServiceOperationLock,
  createSystemdUserServiceOperator,
  parseSystemdUserManagerUnitPath,
  readSystemdUserServiceRuntimeState,
} from '../../../src/core/runtime/services/systemd-user-service-manager.js';
import { createSystemdUserServiceLayout } from '../../../src/core/runtime/services/systemd-user-service.js';

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
 * @param {{artifactBytes?: Buffer, linger?: boolean, runtimeMode?: 'matching'|'unavailable'|'wrong-revision'|'stale-session'|'wrong-process'|'starting', systemdMode?: 'normal'|'failed', platform?: string, uid?: number, filesystemUid?: number, environment?: Record<string, string | undefined>, packagedStorage?: boolean, managerUnitPaths?: string[], managerDiscoversUnitPathAfterReload?: boolean, managerFragmentPath?: string, unitInitiallyUnknown?: boolean, deriveConfigRoot?: boolean, useDefaultXdgConfigHome?: boolean}} [options] - Harness overrides.
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
  const dataRoot = path.join(root, 'data');
  const homeDirectory = path.join(root, 'account-home');
  const configRoot = options.deriveConfigRoot
    ? path.join(homeDirectory, '.config')
    : path.join(root, 'config');
  const layout = createSystemdUserServiceLayout({
    appId: APP_ID,
    dataRoot,
    configRoot,
  });
  const state = {
    active: false,
    enabled: false,
    linger: options.linger !== false,
    runtimeMode: options.runtimeMode || 'matching',
    systemdMode: options.systemdMode || 'normal',
    failDaemonReloadOnce: false,
    failUnitPath: false,
    fragmentPath: options.managerFragmentPath ?? layout.unitPath,
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
      if (operation === 'daemon-reload') state.needDaemonReload = false;
      if (operation === 'enable') {
        state.enabled = true;
        state.active = true;
      } else if (operation === 'start' || operation === 'restart') {
        state.active = true;
      } else if (operation === 'stop') {
        state.active = false;
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
        const failed = state.systemdMode === 'failed';
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
    if (state.runtimeMode === 'unavailable') {
      return { status: 'UNAVAILABLE', session: 'unknown' };
    }
    if (state.runtimeMode === 'starting') {
      return {
        status: 'STARTING',
        revisionId: REVISION_ID,
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
        revisionId: REVISION_ID,
        generation: 1,
        session: 'absent',
        currentOwner: false,
      };
    }
    return {
      status: 'READY',
      revisionId:
        state.runtimeMode === 'wrong-revision'
          ? `wrv1_${Buffer.alloc(32, 5).toString('base64url')}`
          : REVISION_ID,
      generation: 2,
      ownerKind: 'resident',
      ownerGeneration: 2,
      session: state.runtimeMode === 'stale-session' ? 'absent' : 'active',
      processId: state.runtimeMode === 'wrong-process' ? 9876 : 4321,
      currentOwner: state.runtimeMode !== 'stale-session',
    };
  });
  let token = 0;
  const acquireOperationLock = jest.fn(async () => async () => undefined);
  const operator = createSystemdUserServiceOperator({
    platform: options.platform || 'linux',
    architecture: 'x64',
    nodeVersion: '24.13.1',
    artifactPath,
    dataRoot,
    ...(options.deriveConfigRoot
      ? { getHomeDirectory: () => homeDirectory }
      : { configRoot }),
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
    acquireOperationLock,
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
      runtime: { appId: APP_ID, revisionId: REVISION_ID, target: TARGET },
    }),
  });
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
    readRuntimeState,
    operator,
  };
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

  it('installs exact bytes, enables the fixed unit, and reports durable health', async () => {
    const harness = await createHarness();
    const source = await inspectArtifactBytes(harness.artifactPath);

    await expect(harness.operator.install()).resolves.toMatchObject({
      schemaVersion: 1,
      kind: 'wharfie.service.result',
      action: 'install',
      appId: APP_ID,
      outcome: 'installed',
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
          args: ['--user', 'enable', '--now', 'wharfie-service-demo.service'],
        },
      ]),
    );

    await expect(harness.operator.status()).resolves.toMatchObject({
      kind: 'wharfie.service.status',
      health: 'healthy',
      systemd: { activeState: 'active', unitFileState: 'enabled' },
      runtime: {
        status: 'READY',
        revisionId: REVISION_ID,
        session: 'active',
      },
    });
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
      outcome: 'already-installed',
      health: 'healthy',
    });
  });

  it('reconciles a published release that predates its interrupted installation receipt', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    harness.state.active = false;
    harness.state.enabled = false;
    harness.state.now = 200;
    await fsp.unlink(harness.layout.installationPath);

    await expect(harness.operator.install()).resolves.toMatchObject({
      outcome: 'installed',
      health: 'healthy',
    });
    const installation = JSON.parse(
      await fsp.readFile(harness.layout.installationPath, 'utf8'),
    );
    expect(installation).toMatchObject({
      installedAt: 200,
      updatedAt: 200,
      current: { installedAt: 100 },
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

    await expect(harness.operator.install()).rejects.toThrow(
      /bytes failed verification/,
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
          args: ['--user', 'enable', '--now', 'wharfie-service-demo.service'],
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
    ).toHaveLength(2);
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

  it('rejects a foreign effective unit before staging or enabling install', async () => {
    const harness = await createHarness({
      managerFragmentPath: '/etc/systemd/user/wharfie-service-demo.service',
    });

    await expect(harness.operator.install()).rejects.toThrow(
      /unit name is already claimed/,
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
          args: ['--user', 'enable', '--now', 'wharfie-service-demo.service'],
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

  it('tightens same-user roots created under a collaborative umask', async () => {
    const harness = await createHarness();
    for (const root of [harness.dataRoot, harness.configRoot]) {
      await fsp.mkdir(root, { recursive: true, mode: 0o775 });
      await fsp.chmod(root, 0o775);
    }

    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'absent',
      installation: { state: 'absent' },
    });

    const managedDirectories = [
      harness.dataRoot,
      path.dirname(harness.layout.serviceRoot),
      harness.layout.serviceRoot,
      harness.layout.stateRoot,
      harness.layout.controlPath,
      harness.layout.applicationStatePath,
      harness.configRoot,
      path.join(harness.configRoot, 'systemd'),
      path.dirname(harness.layout.unitPath),
    ];
    for (const directory of managedDirectories) {
      await fsp.mkdir(directory, { recursive: true, mode: 0o775 });
      await fsp.chmod(directory, 0o775);
    }
    await expect(harness.operator.install()).resolves.toMatchObject({
      outcome: 'installed',
      health: 'healthy',
    });
    for (const directory of managedDirectories) {
      expect((await fsp.stat(directory)).mode & 0o777).toBe(0o700);
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

  it('requires the live durable resident to be systemd MainPID', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    harness.state.runtimeMode = 'wrong-process';

    await expect(harness.operator.status()).resolves.toMatchObject({
      health: 'degraded',
      systemd: { activeState: 'active', mainPid: 4321 },
      runtime: { status: 'READY', session: 'active', processId: 9876 },
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
      /different unit or additional drop-ins/,
    );
    expect(harness.state.active).toBe(true);
    await expect(fsp.stat(harness.layout.unitPath)).resolves.toMatchObject({
      mode: expect.any(Number),
    });
    await expect(fsp.stat(harness.layout.uninstallPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('never stops or uninstalls while the manager unit cache is stale', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    harness.state.needDaemonReload = true;

    await expect(harness.operator.stop()).rejects.toThrow(
      /unit cache is stale/,
    );
    await expect(harness.operator.uninstall()).rejects.toThrow(
      /unit cache is stale/,
    );
    expect(harness.state.active).toBe(true);
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
      health: 'absent',
    });
    await expect(harness.operator.uninstall()).resolves.toMatchObject({
      outcome: 'already-uninstalled',
      health: 'absent',
    });
    await expect(harness.operator.start()).rejects.toThrow(/not installed/);
  });

  it('serializes an absent uninstall against a concurrent first install', async () => {
    const harness = await createHarness();

    await expect(harness.operator.uninstall()).resolves.toMatchObject({
      outcome: 'already-uninstalled',
    });
    expect(harness.acquireOperationLock).toHaveBeenCalledTimes(1);
  });

  it('retains the last selection so uninstall cannot bypass deferred update', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    await harness.operator.uninstall();
    await fsp.writeFile(harness.artifactPath, 'packaged-artifact-v2');

    await expect(harness.operator.install()).rejects.toThrow(
      /different artifact is installed/,
    );
  });

  it('reinstalls the same release across wall-clock rollback', async () => {
    const harness = await createHarness();
    await harness.operator.install();
    harness.state.now = 200;
    await harness.operator.uninstall();
    harness.state.now = 50;

    await expect(harness.operator.install()).resolves.toMatchObject({
      outcome: 'reinstalled',
      health: 'healthy',
    });
    const installation = JSON.parse(
      await fsp.readFile(harness.layout.installationPath, 'utf8'),
    );
    expect(installation.updatedAt).toBe(200);
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
});
