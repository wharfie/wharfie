/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const binPath = path.join(repoRoot, 'bin', 'wharfie');
const helloWorldDir = path.join(
  repoRoot,
  'scratch',
  'examples',
  'actor-systems',
  'hello-world',
);
const packageDemoDir = path.join(
  repoRoot,
  'test',
  'fixtures',
  'apps',
  'package-demo',
);
const currentTarget = {
  nodeVersion: process.versions.node,
  platform: process.platform,
  architecture: process.arch,
};
const alternateTarget = {
  nodeVersion: process.versions.node,
  platform: process.platform,
  architecture: process.arch === 'x64' ? 'arm64' : 'x64',
};

/**
 * @param {{ nodeVersion: string, platform: string, architecture: string, libc?: string }} target - target.
 * @returns {string} - Result.
 */
function getTargetSelector(target) {
  return `node${target.nodeVersion}-${target.platform}-${target.architecture}${
    target.libc ? `-${target.libc}` : ''
  }`;
}

/**
 * @param {string[]} args - args.
 * @param {import('node:child_process').SpawnSyncOptions} [options] - options.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} - Result.
 */
function runCli(args, options = {}) {
  return /** @type {import('node:child_process').SpawnSyncReturns<string>} */ (
    spawnSync(process.execPath, [binPath, ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        WHARFIE_ARTIFACT_BUCKET: 'service-bucket',
      },
      ...options,
    })
  );
}

describe('wharfie app commands', () => {
  it('runs a demo function from the CLI with --event JSON', () => {
    const result = runCli([
      'app',
      'run',
      'echo-event',
      '--dir',
      helloWorldDir,
      '--event',
      '{"who":"cli-user"}',
      '--no-pretty',
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      who: 'cli-user',
      message: 'hello cli-user',
      requestId: null,
    });
  });

  it('runs a demo function from the CLI using stdin JSON as the event', () => {
    const result = runCli(
      ['app', 'run', 'hello-resources', '--dir', helloWorldDir, '--no-pretty'],
      {
        input: '{"who":"stdin-user"}',
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      who: 'stdin-user',
      dbRecord: {
        id: 'greeting',
        who: 'stdin-user',
        message: 'hello stdin-user',
      },
      queueBody: JSON.stringify({ hello: 'stdin-user' }),
      objectBody: 'hello stdin-user',
    });
  });

  it('packages every app target when no target filter is provided', () => {
    const outputDir = path.join(
      os.tmpdir(),
      'wharfie-package-command-test',
      'all-targets',
      String(process.pid),
    );
    const traceFile = path.join(
      os.tmpdir(),
      'wharfie-package-command-test',
      'traces',
      `all-targets-${process.pid}.json`,
    );

    const result = runCli(
      [
        'app',
        'package',
        packageDemoDir,
        '--output-dir',
        outputDir,
        '--no-pretty',
      ],
      {
        env: {
          ...process.env,
          WHARFIE_PACKAGE_DEMO_TRACE_FILE: traceFile,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    /** @type {{ app: { name: string }, outputDir: string, targets: { nodeVersion: string, platform: string, architecture: string, libc?: string }[], artifacts: { fileName: string, path: string, target: { nodeVersion: string, platform: string, architecture: string, libc?: string } }[] }} */
    const payload = JSON.parse(result.stdout);
    expect(payload.app).toEqual({ name: 'package-demo' });
    expect(payload.outputDir).toBe(outputDir);
    expect(payload.targets).toHaveLength(2);
    expect(payload.artifacts).toHaveLength(2);
    expect(payload.targets).toEqual([currentTarget, alternateTarget]);
    expect(payload.artifacts.map((artifact) => artifact.target)).toEqual([
      alternateTarget,
      currentTarget,
    ]);
    payload.artifacts.forEach((artifact) => {
      expect(existsSync(artifact.path)).toBe(true);
      expect(readFileSync(artifact.path, 'utf8')).toContain('node');
    });
    expect(readdirSync(outputDir).sort()).toEqual(
      payload.artifacts.map((artifact) => artifact.fileName).sort(),
    );
    expect(JSON.parse(readFileSync(traceFile, 'utf8'))).toEqual({
      builtTargets: [
        getTargetSelector(currentTarget),
        getTargetSelector(alternateTarget),
      ],
    });
  });

  it('packages only the selected target when --target is provided', () => {
    const outputDir = path.join(
      os.tmpdir(),
      'wharfie-package-command-test',
      'selected-target',
      String(process.pid),
    );
    const traceFile = path.join(
      os.tmpdir(),
      'wharfie-package-command-test',
      'traces',
      `selected-target-${process.pid}.json`,
    );
    const targetSelector = getTargetSelector(currentTarget);

    const result = runCli(
      [
        'app',
        'package',
        packageDemoDir,
        '--output-dir',
        outputDir,
        '--target',
        targetSelector,
        '--no-pretty',
      ],
      {
        env: {
          ...process.env,
          WHARFIE_PACKAGE_DEMO_TRACE_FILE: traceFile,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    /** @type {{ targets: { nodeVersion: string, platform: string, architecture: string, libc?: string }[], artifacts: { fileName: string, path: string, target: { nodeVersion: string, platform: string, architecture: string, libc?: string } }[] }} */
    const payload = JSON.parse(result.stdout);
    expect(payload.targets).toEqual([currentTarget]);
    expect(payload.artifacts).toHaveLength(1);
    expect(payload.artifacts[0].target).toEqual(currentTarget);
    expect(readdirSync(outputDir)).toEqual([payload.artifacts[0].fileName]);
    expect(JSON.parse(readFileSync(traceFile, 'utf8'))).toEqual({
      builtTargets: [targetSelector],
    });
  });

  it('fails with a helpful error when a requested target does not exist', () => {
    const result = runCli([
      'app',
      'package',
      packageDemoDir,
      '--target',
      'node99.99.99-linux-x64',
      '--no-pretty',
    ]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unknown app build target');
    expect(result.stderr).toContain('node99.99.99-linux-x64');
    expect(result.stderr).toContain(getTargetSelector(currentTarget));
    expect(result.stderr).toContain(getTargetSelector(alternateTarget));
  });
});
