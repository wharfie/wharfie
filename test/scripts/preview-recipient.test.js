import { afterEach, describe, expect, it, jest } from '@jest/globals';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createPreviewRecipientTargetCommand } from '../../scripts/preview-recipient-controller.js';
import {
  createPreviewRecipientEnvironment,
  verifyPreviewRecipientStandalone,
} from '../../scripts/preview-recipient-package.js';
import {
  parsePreviewRecipientArgs,
  previewRecipientControllerEnvironment,
  verifyPreviewRecipient,
} from '../../scripts/verify-preview-recipient.js';

const COMMIT = 'a'.repeat(40);
/** @type {string[]} */
const roots = [];
async function directory() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wharfie-recipient-test-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('preview recipient acceptance boundaries', () => {
  const base = ['--expected-commit', COMMIT, '--report', '/tmp/recipient.json'];
  it('requires one exact source, commit, and new report destination', () => {
    expect(parsePreviewRecipientArgs(['--help'])).toBeNull();
    expect(
      parsePreviewRecipientArgs(['--tag', 'v0.0.15', '--draft', ...base]),
    ).toEqual({
      tag: 'v0.0.15',
      draft: true,
      expectedCommit: COMMIT,
      report: '/tmp/recipient.json',
    });
    expect(
      parsePreviewRecipientArgs(['--artifact-dir', '/tmp/candidate', ...base]),
    ).toEqual({
      artifactDir: '/tmp/candidate',
      expectedCommit: COMMIT,
      report: '/tmp/recipient.json',
    });
    for (const args of [
      base,
      ['--tag', 'latest', ...base],
      ['--tag', 'v0.0.15', '--artifact-dir', '/tmp/candidate', ...base],
      ['--artifact-dir', '/tmp/candidate', '--draft', ...base],
      ['--tag', 'v0.0.15', '--tag', 'v0.0.16', ...base],
      ['--tag', 'v0.0.15', '--report', 'relative'],
      ['--tag', 'v0.0.15', '--publish', ...base],
    ]) {
      expect(() => parsePreviewRecipientArgs(args)).toThrow();
    }
  });

  it('keeps download, cloud, and Node injection credentials out of builder and controller environments', async () => {
    const root = await directory();
    const environment = await createPreviewRecipientEnvironment(
      path.join(root, 'environment'),
    );
    for (const env of [environment, previewRecipientControllerEnvironment()]) {
      for (const key of [
        'GH_TOKEN',
        'GITHUB_TOKEN',
        'AWS_PROFILE',
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
        'HCLOUD_TOKEN',
        'NPM_TOKEN',
        'NODE_OPTIONS',
        'NODE_PATH',
        'SSH_AUTH_SOCK',
      ])
        expect(env).not.toHaveProperty(key);
    }
    assert.ok(environment.npm_config_userconfig);
    expect(await readFile(environment.npm_config_userconfig, 'utf8')).toBe('');
  });

  it('isolates target command environment and bounds target work after controller loss', async () => {
    const run = jest.fn(async (/** @type {unknown} */ _request) => ({
      status: /** @type {'exited'} */ ('exited'),
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: Buffer.from('ok'),
      stderr: Buffer.alloc(0),
    }));
    const command = createPreviewRecipientTargetCommand({ run });
    expect(await command('/usr/bin/id', ['-u'], { timeoutMs: 1200 })).toEqual({
      status: 0,
      stdout: 'ok',
      stderr: '',
    });
    expect(run.mock.calls[0][0]).toMatchObject({
      file: '/usr/bin/sudo',
      timeoutMilliseconds: 11200,
      environment: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
      args: expect.arrayContaining([
        '--chdir=/home/wharfie-recipient',
        '/usr/bin/timeout',
        '--signal=KILL',
        '2s',
        '/usr/bin/env',
        '-i',
        'PATH=/home/wharfie-recipient/recipient/bin',
        'TMPDIR=/home/wharfie-recipient/recipient/tmp',
        '/usr/bin/id',
        '-u',
      ]),
    });
  });

  it.each([
    { status: 'ambiguous', exitCode: null, signal: null, timedOut: true },
    { status: 'exited', exitCode: 124, signal: null, timedOut: false },
    { status: 'exited', exitCode: 137, signal: null, timedOut: false },
    { status: 'exited', exitCode: null, signal: 'SIGKILL', timedOut: false },
  ])(
    'rejects timed out or unconfirmed target exits even when command failure is allowed',
    async (outcome) => {
      const run =
        /** @type {() => Promise<import('../../src/core/runtime/bounded-process.js').BoundedProcessOutcome>} */ (
          async () => ({
            ...outcome,
            stdout: Buffer.from('secret-output'),
            stderr: Buffer.from('secret-error'),
          })
        );
      const command = createPreviewRecipientTargetCommand({ run });
      const failure = await command('/usr/bin/id', ['-u'], {
        allowFailure: true,
      }).catch((error) => error);
      expect(failure).toBeInstanceOf(Error);
      expect(failure.diagnostic.phase).toBe('recipient-command');
      expect(JSON.stringify(failure)).not.toContain('secret');
    },
  );

  it('rehashes the copied standalone before execution and runs it with an empty PATH', async () => {
    const root = await directory();
    const bytes =
      '#!/bin/sh\nif [ -n "$GH_TOKEN$AWS_ACCESS_KEY_ID$NODE_OPTIONS" ]; then exit 2; fi\ncase "$1" in --version) echo 0.0.15;; --help) echo "CLI tool for Wharfie";; *) exit 3;; esac\n';
    const fileName = 'wharfie-v0.0.15-linux-x64';
    await writeFile(path.join(root, fileName), bytes, { mode: 0o600 });
    const artifact = {
      kind: 'standalone-cli',
      fileName,
      size: Buffer.byteLength(bytes),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      artifactId: 'artifact',
      revisionId: 'revision',
    };
    const candidate = /** @type {any} */ ({
      artifactDir: root,
      manifest: { version: '0.0.15', artifacts: [artifact] },
    });
    await expect(
      verifyPreviewRecipientStandalone({
        candidate,
        workspace: path.join(root, 'good'),
      }),
    ).resolves.toMatchObject({ version: '0.0.15', nodeAbsentFromPath: true });
    await writeFile(path.join(root, fileName), '#!/bin/sh\nexit 0\n');
    await expect(
      verifyPreviewRecipientStandalone({
        candidate,
        workspace: path.join(root, 'bad'),
      }),
    ).rejects.toThrow();
    expect((await stat(path.join(root, 'bad', 'wharfie'))).mode & 0o111).toBe(
      0,
    );
  });
});

async function fixture() {
  const root = await directory();
  const repository = path.join(root, 'repo');
  await mkdir(repository, { mode: 0o755 });
  await chmod(repository, 0o755);
  await writeFile(path.join(repository, 'package.json'), '{}');
  const options = {
    artifactDir: path.join(root, 'candidate'),
    expectedCommit: COMMIT,
    report: path.join(root, 'report.json'),
  };
  const candidate = {
    manifest: { tag: 'v0.0.15', source: { commit: COMMIT } },
  };
  const observed = /** @type {Record<string, any>} */ ({
    workspace: null,
    builder: null,
    calls: [],
  });
  const dependencies = {
    repositoryRoot: repository,
    preflight: jest.fn(async () => {}),
    verifyCandidate: jest.fn(async () => candidate),
    standalone: jest.fn(async () => ({ version: '0.0.15' })),
    build: jest.fn(async (/** @type {Record<string, any>} */ input) => {
      observed.builder = input.workspace;
      observed.workspace = path.dirname(input.workspace);
      await mkdir(input.workspace);
      await writeFile(
        path.join(input.workspace, 'private-build-file'),
        'not retained',
      );
      await mkdir(input.handoff);
      const executable = path.join(input.handoff, 'app');
      const recordPath = path.join(input.handoff, 'artifact-record.json');
      await writeFile(executable, 'SEA');
      await writeFile(recordPath, '{}');
      return {
        executable,
        recordPath,
        artifactRecord: { artifactId: 'artifact' },
        receipt: { artifactId: 'artifact' },
      };
    }),
    command: jest.fn(async (...args) => {
      observed.calls.push(args);
      return { stdout: '', status: 0 };
    }),
    targetCommand: jest.fn(async () => ({ status: 0, stdout: '', stderr: '' })),
    controller: jest.fn(
      async (
        /** @type {string} */ phase,
        /** @type {Record<string, any>} */ authority,
        /** @type {string} */ workspace,
      ) => {
        await expect(lstat(observed.builder)).rejects.toMatchObject({
          code: 'ENOENT',
        });
        if (phase === 'prepare') {
          await writeFile(
            path.join(workspace, 'authority-owned.json'),
            JSON.stringify({ runId: authority.runId }),
          );
          return {
            owned: { runId: authority.runId },
            controllerProcessId: 100,
          };
        }
        return { cleaned: true, controllerProcessId: 200 };
      },
    ),
  };
  return { root, repository, options, dependencies, observed };
}

describe('recipient runner retirement and bounded failure reports', () => {
  it('retires the builder before prepare/reconnect and cleans the handoff/workspace', async () => {
    const { options, dependencies, observed, repository } = await fixture();
    const report = await verifyPreviewRecipient(options, dependencies);
    expect(report).toMatchObject({
      status: 'passed',
      source: 'candidate-directory',
      builderRemovedBeforeRecipient: true,
      cleanup: {
        workspaceRemoved: true,
        handoffRemoved: true,
        applicationCleaned: true,
      },
    });
    expect(dependencies.controller.mock.calls.map((call) => call[0])).toEqual([
      'prepare',
      'complete',
    ]);
    expect(
      dependencies.controller.mock.calls[1][1].prepared.controllerProcessId,
    ).toBe(100);
    await expect(lstat(observed.workspace)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect((await stat(repository)).mode & 0o777).toBe(0o755);
    expect(JSON.parse(await readFile(options.report, 'utf8')).status).toBe(
      'passed',
    );
  });

  it('does not overwrite an existing report or begin work when it exists', async () => {
    const { options, dependencies } = await fixture();
    await writeFile(options.report, 'keep this report');
    await expect(
      verifyPreviewRecipient(options, dependencies),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(dependencies.preflight).not.toHaveBeenCalled();
    expect(await readFile(options.report, 'utf8')).toBe('keep this report');
  });

  it('retains only bounded failure metadata and removes a partial builder', async () => {
    const { options, dependencies, observed } = await fixture();
    const original = dependencies.build.getMockImplementation();
    assert.ok(original);
    dependencies.build.mockImplementation(async (input) => {
      await original(input);
      throw Object.assign(new Error('do-not-retain-token'), {
        diagnostic: {
          durationMs: 500,
          status: 1,
          signal: null,
          stdout: 'do-not-retain-output',
          args: ['do-not-retain-secret'],
        },
      });
    });
    const report = await verifyPreviewRecipient(options, dependencies);
    expect(report).toMatchObject({
      status: 'failed',
      failure: { phase: 'build', durationMs: 500, status: 1 },
      cleanup: { workspaceRemoved: true },
    });
    expect(JSON.stringify(report)).not.toContain('do-not-retain');
    expect(dependencies.controller).not.toHaveBeenCalled();
    await expect(lstat(observed.workspace)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('uses retained ownership to clean a failed target and restores repository permissions', async () => {
    const { options, dependencies, observed, repository } = await fixture();
    const original = dependencies.controller.getMockImplementation();
    assert.ok(original);
    dependencies.controller.mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[0] === 'prepare') throw new Error('unsafe raw details');
      return result;
    });
    const report = await verifyPreviewRecipient(options, dependencies);
    expect(report).toMatchObject({
      status: 'failed',
      failure: { phase: 'prepare' },
      cleanup: {
        workspaceRemoved: true,
        applicationCleaned: true,
        handoffRemoved: true,
      },
    });
    expect(dependencies.controller.mock.calls.map((call) => call[0])).toEqual([
      'prepare',
      'cleanup',
    ]);
    expect(JSON.stringify(report)).not.toContain('unsafe raw');
    expect((await stat(repository)).mode & 0o777).toBe(0o755);
    await expect(lstat(observed.workspace)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('keeps a failed handoff cleanup visible even after a successful workflow', async () => {
    const { options, dependencies } = await fixture();
    dependencies.command.mockImplementation(async (...args) => {
      if (args[3] === 'recipient-handoff-cleanup')
        throw new Error('cleanup failed');
      return { stdout: '', status: 0 };
    });
    const report = await verifyPreviewRecipient(options, dependencies);
    expect(report).toMatchObject({
      status: 'failed',
      cleanup: { handoffRemoved: false, workspaceRemoved: true },
    });
  });

  it('retains the original target failure before cleanup replaces the shared checkpoint', async () => {
    const { options, dependencies, observed } = await fixture();
    const original = dependencies.controller.getMockImplementation();
    assert.ok(original);
    const failedCheckpoint = {
      phase: 'failure',
      receipt: {
        schemaVersion: 1,
        kind: 'wharfie.preview-recipient.target-failure',
        phase: 'observe-waiting',
        durationMs: 2300,
        code: 'command-failed',
        command: {
          executable: 'app',
          status: 1,
          signal: null,
          timedOut: false,
        },
      },
    };
    const cleanupCheckpoint = {
      phase: 'cleanup',
      receipt: {
        schemaVersion: 1,
        kind: 'wharfie.preview-recipient.target-cleanup',
        applicationRootAbsent: true,
        externalArtifactPreserved: true,
      },
    };
    dependencies.controller.mockImplementation(async (...args) => {
      const result = await original(...args);
      await writeFile(
        path.join(args[2], 'checkpoint.json'),
        JSON.stringify(
          args[0] === 'prepare' ? failedCheckpoint : cleanupCheckpoint,
        ),
      );
      if (args[0] === 'prepare')
        throw new Error('raw target failure must stay private');
      return result;
    });
    const report = await verifyPreviewRecipient(options, dependencies);
    expect(report).toMatchObject({
      status: 'failed',
      failure: { phase: 'prepare' },
      targetFailureCheckpoint: failedCheckpoint,
      targetCheckpoint: cleanupCheckpoint,
      cleanup: { applicationCleaned: true, workspaceRemoved: true },
    });
    const retained = JSON.parse(await readFile(options.report, 'utf8'));
    expect(retained.targetFailureCheckpoint).toEqual(failedCheckpoint);
    expect(retained.targetCheckpoint).toEqual(cleanupCheckpoint);
    expect(JSON.stringify(retained)).not.toContain('raw target failure');
    await expect(lstat(observed.workspace)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('anonymous download-only mode never starts a builder or target', async () => {
    const { options, dependencies } = await fixture();
    const download = jest.fn(async (/** @type {unknown} */ _input) => ({
      candidate: await dependencies.verifyCandidate(),
      receipt: { tag: 'v0.0.15' },
    }));
    const report = await verifyPreviewRecipient(
      {
        tag: 'v0.0.15',
        expectedCommit: COMMIT,
        report: options.report,
        downloadOnly: true,
      },
      { ...dependencies, download },
    );
    expect(report).toMatchObject({
      status: 'passed',
      source: 'github-public',
      mode: 'download-only',
      cleanup: { workspaceRemoved: true },
    });
    expect(download.mock.calls[0][0]).not.toHaveProperty('token');
    expect(dependencies.build).not.toHaveBeenCalled();
    expect(dependencies.controller).not.toHaveBeenCalled();
  });
});
