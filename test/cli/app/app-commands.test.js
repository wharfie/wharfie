/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { existsSync, readFileSync } from 'node:fs';
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

  it('packages an app through the CLI and copies artifacts into the output directory', () => {
    const outputDir = path.join(
      os.tmpdir(),
      'wharfie-package-command-test',
      String(process.pid),
    );

    const result = runCli([
      'app',
      'package',
      packageDemoDir,
      '--output-dir',
      outputDir,
      '--no-pretty',
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    const payload = JSON.parse(result.stdout);
    expect(payload.app).toEqual({ name: 'package-demo' });
    expect(payload.outputDir).toBe(outputDir);
    expect(payload.artifacts).toHaveLength(1);
    expect(payload.artifacts[0].target).toMatchObject({
      nodeVersion: process.versions.node,
      platform: process.platform,
      architecture: process.arch,
    });
    expect(existsSync(payload.artifacts[0].path)).toBe(true);
    expect(readFileSync(payload.artifacts[0].path, 'utf8')).toContain(
      'package-demo',
    );
  });
});
