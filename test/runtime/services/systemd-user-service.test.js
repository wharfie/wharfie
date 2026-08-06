/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import path from 'node:path';

import {
  createSystemdUserServiceInstallation,
  createSystemdUserServiceLayout,
  createSystemdUserServiceRelease,
  createSystemdUserServiceUnit,
  parseSystemdUserServiceStatus,
  validateSystemdUserServiceInstallation,
  validateSystemdUserServiceLayout,
  validateSystemdUserServiceRelease,
} from '../../../src/core/runtime/services/systemd-user-service.js';

const DIGEST = 'A'.repeat(43);
const OTHER_DIGEST = Buffer.alloc(32, 3).toString('base64url');
const REVISION_ID = `wrv1_${Buffer.alloc(32, 2).toString('base64url')}`;
const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});

function layout() {
  return createSystemdUserServiceLayout({
    appId: 'example-app',
    dataRoot: '/srv/wharfie data%$',
    configRoot: '/home/example/.config',
  });
}

function release(options = {}) {
  const serviceLayout = layout();
  return createSystemdUserServiceRelease({
    appId: 'example-app',
    artifactId: `waf1_${DIGEST}`,
    revisionId: REVISION_ID,
    byteDigest: { algorithm: 'sha256', value: DIGEST },
    size: 1234,
    target: TARGET,
    installedAt: 100,
    artifactPath: path.join(
      serviceLayout.releasesRoot,
      `waf1_${DIGEST}`,
      'app',
    ),
    ...options,
  });
}

describe('systemd user service contract', () => {
  it('derives one app-scoped layout with state outside immutable releases', () => {
    const value = layout();

    expect(value).toEqual({
      appId: 'example-app',
      dataRoot: '/srv/wharfie data%$',
      configRoot: '/home/example/.config',
      serviceRoot: '/srv/wharfie data%$/applications/example-app',
      releasesRoot: '/srv/wharfie data%$/applications/example-app/releases',
      currentLink: '/srv/wharfie data%$/applications/example-app/current',
      currentArtifact:
        '/srv/wharfie data%$/applications/example-app/current/app',
      stateRoot: '/srv/wharfie data%$/applications/example-app/state',
      controlPath: '/srv/wharfie data%$/applications/example-app/state/control',
      payloadPath:
        '/srv/wharfie data%$/applications/example-app/state/control/execution-payloads',
      applicationStatePath:
        '/srv/wharfie data%$/applications/example-app/state/application-state',
      sessionPath:
        '/srv/wharfie data%$/applications/example-app/state/control/ledger-service-sessions',
      installationPath:
        '/srv/wharfie data%$/applications/example-app/installation.json',
      uninstallPath:
        '/srv/wharfie data%$/applications/example-app/.uninstalling.json',
      unitName: 'wharfie-example-app.service',
      unitPath:
        '/home/example/.config/systemd/user/wharfie-example-app.service',
      executionLedgerTable: 'wharfie-execution-ledger-v10',
    });
    expect(validateSystemdUserServiceLayout(value)).toEqual(value);
    expect(Object.isFrozen(value)).toBe(true);
  });

  it.each([
    { dataRoot: 'relative/data', configRoot: '/config' },
    { dataRoot: '/data/../other', configRoot: '/config' },
    { dataRoot: '/data', configRoot: 'relative/config' },
  ])('refuses noncanonical roots %#', (roots) => {
    expect(() =>
      createSystemdUserServiceLayout({ appId: 'example-app', ...roots }),
    ).toThrow(/canonical absolute path/);
  });

  it('renders a fixed hidden-runtime unit with boot and drain semantics', () => {
    const unit = createSystemdUserServiceUnit({ layout: layout() });

    expect(unit).toContain('[Service]\nType=exec');
    expect(unit).toContain(
      'ExecStart="/srv/wharfie data%%$$/applications/example-app/current/app"',
    );
    expect(unit).toContain(
      'WorkingDirectory=/srv/wharfie data%%$/applications/example-app/state',
    );
    expect(unit).toContain(
      'Environment="WHARFIE_DATA_ROOT=/srv/wharfie data%%$"',
    );
    expect(unit).toContain(
      'Environment="WHARFIE_RUNTIME_COMMAND=ledger-service"',
    );
    expect(unit).toContain('Environment="WHARFIE_RUNTIME_ARGS=[]"');
    for (const name of [
      'WHARFIE_APPLICATION_STATE_ADAPTER',
      'WHARFIE_APPLICATION_STATE_PATH',
      'WHARFIE_CONTROL_ADAPTER',
      'WHARFIE_CONTROL_PATH',
      'WHARFIE_DB_ADAPTER',
      'WHARFIE_DB_PATH',
      'WHARFIE_EXECUTION_LEDGER_TABLE',
      'WHARFIE_EXECUTION_PAYLOAD_PATH',
      'WHARFIE_EXECUTION_PAYLOAD_STORE_ID',
      'WHARFIE_LEDGER_SERVICE_SESSION_PATH',
      'WHARFIE_STATE_ADAPTER',
      'WHARFIE_STATE_DB_PATH',
    ]) {
      expect(unit).not.toContain(`Environment="${name}=`);
    }
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('KillSignal=SIGTERM');
    expect(unit).toContain('KillMode=mixed');
    expect(unit).toContain('TimeoutStopSec=45s');
    expect(unit).toContain('WantedBy=default.target');
    expect(unit).not.toContain('User=');
    expect(unit).not.toContain('PrivateTmp=');
    expect(unit).not.toContain('credential');
  });

  it('validates exact content-addressed release and installation records', () => {
    const serviceLayout = layout();
    const current = release();
    const installation = createSystemdUserServiceInstallation({
      layout: serviceLayout,
      uid: 1000,
      current,
      installedAt: 100,
      updatedAt: 100,
    });

    expect(validateSystemdUserServiceRelease(current)).toEqual(current);
    expect(validateSystemdUserServiceInstallation(installation)).toEqual(
      installation,
    );
    expect(installation.principal).toEqual({ uid: 1000, linger: true });
    expect(installation.state).toBe('installed');
    expect(installation.previous).toBeNull();
    expect(Object.isFrozen(installation)).toBe(true);
  });

  it('rejects release identity, layout, and principal tampering', () => {
    const current = release();
    const installation = createSystemdUserServiceInstallation({
      layout: layout(),
      uid: 1000,
      current,
      installedAt: 100,
      updatedAt: 100,
    });

    expect(() =>
      validateSystemdUserServiceRelease({
        ...current,
        artifactId: `waf1_${OTHER_DIGEST}`,
      }),
    ).toThrow(/does not match byteDigest/);
    expect(() =>
      validateSystemdUserServiceInstallation({
        ...installation,
        layout: { ...installation.layout, controlPath: '/tmp/redirected' },
      }),
    ).toThrow(/does not match its derived path/);
    expect(() =>
      validateSystemdUserServiceInstallation({
        ...installation,
        principal: { uid: 1000, linger: false },
      }),
    ).toThrow(/linger must be true/);
    expect(() =>
      validateSystemdUserServiceInstallation({
        ...installation,
        state: 'unknown',
      }),
    ).toThrow(/state must be 'installed' or 'uninstalled'/);
    expect(() =>
      validateSystemdUserServiceInstallation({
        ...installation,
        previous: current,
      }),
    ).toThrow(/previous must differ/);
  });

  it('allows a verified release to predate a retried installation receipt', () => {
    const installation = createSystemdUserServiceInstallation({
      layout: layout(),
      uid: 1000,
      current: release({ installedAt: 100 }),
      installedAt: 200,
      updatedAt: 200,
    });

    expect(installation).toMatchObject({
      installedAt: 200,
      updatedAt: 200,
      current: { installedAt: 100 },
    });
    expect(() =>
      createSystemdUserServiceInstallation({
        layout: layout(),
        uid: 1000,
        current: release({ installedAt: 201 }),
        installedAt: 200,
        updatedAt: 200,
      }),
    ).toThrow(/timestamps are inconsistent/);
  });

  it('parses only the exact bounded systemctl status property set', () => {
    const status = parseSystemdUserServiceStatus(
      [
        'LoadState=loaded',
        'UnitFileState=enabled',
        'ActiveState=active',
        'SubState=running',
        'Result=success',
        'MainPID=123',
        'ExecMainStatus=0',
        'FragmentPath=/home/example/.config/systemd/user/wharfie-demo.service',
        'DropInPaths=',
        'NeedDaemonReload=no',
        '',
      ].join('\n'),
    );

    expect(status).toEqual({
      loadState: 'loaded',
      unitFileState: 'enabled',
      activeState: 'active',
      subState: 'running',
      result: 'success',
      mainPid: 123,
      execMainStatus: 0,
      fragmentPath: '/home/example/.config/systemd/user/wharfie-demo.service',
      dropInPaths: '',
      needDaemonReload: false,
    });
    expect(
      parseSystemdUserServiceStatus(
        [
          'LoadState=not-found',
          'UnitFileState=',
          'ActiveState=inactive',
          'SubState=dead',
          'Result=success',
          'MainPID=0',
          'ExecMainStatus=0',
          'FragmentPath=',
          'DropInPaths=',
          'NeedDaemonReload=no',
          '',
        ].join('\n'),
      ),
    ).toEqual({
      loadState: 'not-found',
      unitFileState: '',
      activeState: 'inactive',
      subState: 'dead',
      result: 'success',
      mainPid: 0,
      execMainStatus: 0,
      fragmentPath: '',
      dropInPaths: '',
      needDaemonReload: false,
    });
    expect(() =>
      parseSystemdUserServiceStatus(
        [
          'LoadState=loaded',
          'UnitFileState=',
          'ActiveState=inactive',
          'SubState=dead',
          'Result=success',
          'MainPID=0',
          'ExecMainStatus=0',
          'FragmentPath=',
          'DropInPaths=',
          'NeedDaemonReload=no',
          '',
        ].join('\n'),
      ),
    ).toThrow(/loaded status is incomplete/);
    expect(() =>
      parseSystemdUserServiceStatus(
        'LoadState=loaded\nUnitFileState=enabled\nActiveState=active\nSubState=running\nResult=success\nMainPID=1\nUnknown=value\n',
      ),
    ).toThrow(/unsupported fields|missing fields/);
    expect(() =>
      parseSystemdUserServiceStatus(
        'LoadState=loaded\nUnitFileState=enabled\nActiveState=active\nSubState=running\nResult=success\nMainPID=-1\nExecMainStatus=0\n',
      ),
    ).toThrow(/MainPID is invalid/);
  });
});
