/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it, jest } from '@jest/globals';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import {
  createDeployCommand,
  deployArtifact,
} from '../../../src/core/resources/builds/actor-system-cli/infrastructure_cmds/deploy.js';
import { getDeploymentStatus } from '../../../src/core/resources/builds/actor-system-cli/infrastructure_cmds/status.js';
import { getDeploymentLogs } from '../../../src/core/resources/builds/actor-system-cli/infrastructure_cmds/logs.js';
import { rollbackArtifact } from '../../../src/core/resources/builds/actor-system-cli/infrastructure_cmds/rollback.js';
import {
  createDeployPlan,
  materializeDeployPlan,
  readCurrentReleaseId,
} from '../../../src/core/resources/builds/actor-system-cli/lib/systemd-release.js';

const manifest = {
  app: { name: 'artifact-infra-demo' },
  targets: [
    {
      nodeVersion: process.versions.node,
      platform: process.platform,
      architecture: process.arch,
    },
  ],
  resources: {
    db: {
      adapter: 'vanilla',
      options: { path: '.wharfie/db' },
    },
  },
  functions: [
    {
      name: 'start',
      entrypoint: {
        path: '/artifact/functions/start.js',
        export: 'start',
      },
    },
  ],
};

/**
 * @returns {Promise<{ artifactPath: string, releaseRoot: string, systemdDir: string, previousPlan: import('../../../src/core/resources/builds/actor-system-cli/lib/systemd-release.js').DeployPlan, currentPlan: import('../../../src/core/resources/builds/actor-system-cli/lib/systemd-release.js').DeployPlan }>} - Result.
 */
async function createReleaseFixture() {
  const rootDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'wharfie-artifact-infra-'),
  );
  const releaseRoot = path.join(rootDir, 'releases');
  const systemdDir = path.join(rootDir, 'systemd');
  const artifactPath = path.join(rootDir, 'wharfie-artifact');

  await fsp.writeFile(artifactPath, '#!/bin/sh\necho wharfie\n', 'utf8');

  const previousPlan = createDeployPlan({
    manifest,
    artifactPath,
    releaseRoot,
    systemdDir,
    releaseId: 'artifact-infra-demo-release-1',
    deployedAt: '2026-03-20T12:00:00.000Z',
  });
  await materializeDeployPlan(previousPlan);

  const currentPlan = createDeployPlan({
    manifest,
    artifactPath,
    releaseRoot,
    systemdDir,
    releaseId: 'artifact-infra-demo-release-2',
    deployedAt: '2026-03-21T12:00:00.000Z',
  });
  await materializeDeployPlan(currentPlan);

  return {
    artifactPath,
    releaseRoot,
    systemdDir,
    previousPlan,
    currentPlan,
  };
}

describe('artifact infrastructure commands', () => {
  it('builds a Linux/systemd deploy plan from the packaged manifest', async () => {
    const result = await deployArtifact(
      {
        dryRun: true,
        artifactPath: '/tmp/wharfie-artifact',
        releaseRoot: '/srv/wharfie',
        systemdDir: '/etc/systemd/system',
        env: ['FOO=bar', 'BAZ=qux'],
        startArg: ['--control-port', '8890'],
        role: 'leader',
      },
      {
        assetProvider: {
          getAsset: async () => Buffer.from(JSON.stringify(manifest), 'utf8'),
        },
      },
    );

    expect(result).toMatchObject({
      app: 'artifact-infra-demo',
      serviceName: 'artifact-infra-demo',
      unitName: 'artifact-infra-demo.service',
      artifactPath: '/tmp/wharfie-artifact',
      dryRun: true,
    });
    expect(result.targetSelector).toBe(
      `node${process.versions.node}-${process.platform}-${process.arch}`,
    );
    expect(result.currentArtifactPath).toContain(
      '/srv/wharfie/artifact-infra-demo/current/wharfie-artifact',
    );
    expect(result.shellCommands).toEqual([
      { command: 'systemctl', args: ['daemon-reload'] },
      { command: 'systemctl', args: ['enable', 'artifact-infra-demo.service'] },
      {
        command: 'systemctl',
        args: ['restart', 'artifact-infra-demo.service'],
      },
    ]);
  });

  it('resolves release status, logs, and rollback targets from packaged release metadata', async () => {
    const fixture = await createReleaseFixture();
    const statusShell = {
      run: jest.fn(async () => ({
        code: 0,
        stdout:
          'ActiveState=active\nSubState=running\nFragmentPath=/tmp/demo.service\nUnitFileState=enabled\n',
        stderr: '',
      })),
    };

    const status = await getDeploymentStatus(
      {
        manifest: JSON.stringify(manifest),
        releaseRoot: fixture.releaseRoot,
      },
      { shell: statusShell },
    );

    expect(status.currentReleaseId).toBe(fixture.currentPlan.releaseId);
    expect(status.selectedReleaseId).toBe(fixture.currentPlan.releaseId);
    expect(
      status.releases.map(
        (/** @type {{ releaseId: string }} */ record) => record.releaseId,
      ),
    ).toEqual([fixture.currentPlan.releaseId, fixture.previousPlan.releaseId]);
    expect(status.systemd).toEqual({
      ActiveState: 'active',
      SubState: 'running',
      FragmentPath: '/tmp/demo.service',
      UnitFileState: 'enabled',
    });
    expect(statusShell.run.mock.calls[0]).toEqual([
      'systemctl',
      [
        'show',
        fixture.currentPlan.unitName,
        '--property=ActiveState,SubState,FragmentPath,UnitFileState',
        '--no-pager',
      ],
      { captureOutput: true },
    ]);

    const logsShell = {
      run: jest.fn(async () => ({
        code: 0,
        stdout: 'hello from journalctl\n',
        stderr: '',
      })),
    };

    const logs = await getDeploymentLogs(
      {
        manifest: JSON.stringify(manifest),
        releaseRoot: fixture.releaseRoot,
        releaseId: fixture.previousPlan.releaseId,
        lines: 50,
      },
      { shell: logsShell },
    );

    expect(logs.releaseId).toBe(fixture.previousPlan.releaseId);
    expect(logs.window).toEqual({
      since: fixture.previousPlan.deployedAt,
      until: fixture.currentPlan.deployedAt,
    });
    expect(logs.output).toBe('hello from journalctl\n');
    expect(logsShell.run.mock.calls[0]).toEqual([
      'journalctl',
      [
        '-u',
        fixture.previousPlan.unitName,
        '--no-pager',
        '-n',
        '50',
        '--since',
        fixture.previousPlan.deployedAt,
        '--until',
        fixture.currentPlan.deployedAt,
      ],
      {
        captureOutput: true,
        inheritStdio: false,
      },
    ]);

    const rollbackShell = {
      run: jest.fn(async () => ({
        code: 0,
        stdout: '',
        stderr: '',
      })),
    };

    const rollback = await rollbackArtifact(
      {
        manifest: JSON.stringify(manifest),
        releaseRoot: fixture.releaseRoot,
      },
      { shell: rollbackShell },
    );

    expect(rollback).toMatchObject({
      app: 'artifact-infra-demo',
      fromReleaseId: fixture.currentPlan.releaseId,
      toReleaseId: fixture.previousPlan.releaseId,
      unitName: fixture.previousPlan.unitName,
      dryRun: false,
    });
    expect(rollbackShell.run.mock.calls[0]).toEqual([
      'systemctl',
      ['restart', fixture.previousPlan.unitName],
      { captureOutput: true },
    ]);
    await expect(
      readCurrentReleaseId({
        releaseRoot: fixture.releaseRoot,
        appName: manifest.app.name,
      }),
    ).resolves.toBe(fixture.previousPlan.releaseId);
  });

  it('allows mocked infrastructure rollback on non-linux hosts when shell execution is injected', async () => {
    const fixture = await createReleaseFixture();
    const rollbackShell = {
      run: jest.fn(async () => ({
        code: 0,
        stdout: '',
        stderr: '',
      })),
    };

    const rollback = await rollbackArtifact(
      {
        manifest: JSON.stringify(manifest),
        releaseRoot: fixture.releaseRoot,
      },
      {
        shell: rollbackShell,
        platform: 'darwin',
      },
    );

    expect(rollback).toMatchObject({
      app: 'artifact-infra-demo',
      fromReleaseId: fixture.currentPlan.releaseId,
      toReleaseId: fixture.previousPlan.releaseId,
      dryRun: false,
    });
    expect(rollbackShell.run.mock.calls[0]).toEqual([
      'systemctl',
      ['restart', fixture.previousPlan.unitName],
      { captureOutput: true },
    ]);
  });

  it('parses deploy command flags and emits json in dry-run mode', async () => {
    /** @type {string[]} */
    const writes = [];
    /** @type {string[]} */
    const errors = [];
    const command = createDeployCommand({
      assetProvider: {
        getAsset: async () => Buffer.from(JSON.stringify(manifest), 'utf8'),
      },
      io: {
        write: (text) => {
          writes.push(text);
        },
        error: (text) => {
          errors.push(text);
        },
      },
    });

    await command.parseAsync(
      [
        'node',
        'deploy',
        '--dry-run',
        '--json',
        '--artifact-path',
        '/tmp/wharfie-artifact',
        '--release-root',
        '/srv/wharfie',
        '--systemd-dir',
        '/etc/systemd/system',
        '--env',
        'FOO=bar',
        '--env',
        'BAR=baz',
        '--start-arg',
        'alpha',
        '--start-arg',
        'beta',
      ],
      { from: 'node' },
    );

    expect(errors).toEqual([]);
    expect(JSON.parse(writes.join(''))).toMatchObject({
      app: 'artifact-infra-demo',
      dryRun: true,
      unitName: 'artifact-infra-demo.service',
    });
  });
});
