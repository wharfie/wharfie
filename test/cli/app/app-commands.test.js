/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { kitchenSinkExternalDependencies } from '../../../scratch/examples/apps/kitchen-sink/config.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const binPath = path.join(repoRoot, 'bin', 'wharfie');
const helloWorldDir = path.join(
  repoRoot,
  'scratch',
  'examples',
  'apps',
  'hello-world',
);
const kitchenSinkDir = path.join(
  repoRoot,
  'scratch',
  'examples',
  'apps',
  'kitchen-sink',
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
      ...options,
    })
  );
}

describe('wharfie app commands', () => {
  it('runs a demo activity from the CLI with --event JSON', () => {
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

  it('runs a demo activity from the CLI using stdin JSON as the event', () => {
    const result = runCli(
      ['app', 'run', 'hello-resources', '--dir', helloWorldDir, '--no-pretty'],
      { input: '{"who":"stdin-user"}' },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      who: 'stdin-user',
      dbRecord: {
        id: 'greeting',
        message: 'hello stdin-user',
      },
      queueBody: JSON.stringify({ hello: 'stdin-user' }),
      objectBody: 'hello stdin-user',
    });
  });

  it('prints the one canonical manifest for the kitchen-sink fixture', () => {
    const result = runCli(['app', 'manifest', kitchenSinkDir, '--no-pretty']);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    const payload = JSON.parse(result.stdout);
    expect(payload.schemaVersion).toBe(2);
    expect(payload.app).toEqual({ id: 'kitchen-sink-demo' });
    expect(payload.activities).toEqual({
      start: expect.objectContaining({
        entrypoint: {
          kind: 'node',
          export: 'start',
          path: 'activity.js',
        },
        resources: expect.objectContaining({
          db: expect.objectContaining({ adapter: 'vanilla' }),
          queue: expect.objectContaining({ adapter: 'vanilla' }),
          objectStorage: expect.objectContaining({ adapter: 'vanilla' }),
        }),
        externalPackages: kitchenSinkExternalDependencies,
      }),
    });
    expect(payload).not.toHaveProperty('functions');
    expect(payload).not.toHaveProperty('capabilities');
  });

  it('refuses invalid or secret-like manifest fields without echoing values', () => {
    const dir = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-secret-manifest-command-'),
    );
    const secret = 'manifest-command-secret-sentinel';

    try {
      writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ type: 'module' }),
      );
      writeFileSync(
        path.join(dir, 'cli.js'),
        'export default async function main() {}\n',
      );
      writeFileSync(
        path.join(dir, 'wharfie.app.js'),
        `export default {
  schemaVersion: 2,
  app: { id: 'secret-manifest-demo' },
  cli: {
    entrypoint: { kind: 'node', path: './cli.js', export: 'default' },
  },
  resources: {
    db: { adapter: 'vanilla', options: { dbPassword: '${secret}' } },
  },
};
`,
      );

      const result = runCli(['app', 'manifest', dir, '--no-pretty']);

      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain(secret);
      expect(result.stderr).toMatch(/dbPassword.*not supported/i);
      expect(result.stderr).not.toContain(secret);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails helpfully when a requested package target is not declared', () => {
    const dir = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-package-target-command-'),
    );

    try {
      writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ type: 'module' }),
      );
      writeFileSync(
        path.join(dir, 'cli.js'),
        'export default async function main() {}\n',
      );
      writeFileSync(
        path.join(dir, 'wharfie.app.js'),
        `export default {
  schemaVersion: 2,
  app: { id: 'target-command-demo' },
  cli: {
    entrypoint: { kind: 'node', path: './cli.js', export: 'default' },
  },
  targets: [{
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
  }],
};
`,
      );

      const result = runCli([
        'app',
        'package',
        dir,
        '--target',
        'node99.99.99-linux-x64-glibc',
        '--no-pretty',
      ]);

      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('Unknown target');
      expect(result.stderr).toContain('node99.99.99-linux-x64-glibc');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
