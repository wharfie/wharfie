import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PREVIEW_TARGET } from './build-preview-release.js';
import { runLiveDeploymentProcess } from './live-deployment-package.js';
import { REPO_ROOT } from './package-verification.js';
import {
  RECIPIENT_HANDOFF,
  RECIPIENT_UID,
  RECIPIENT_USER,
  createPreviewRecipientTargetCommand,
} from './preview-recipient-controller.js';
import {
  downloadPreviewRecipientRelease,
  verifyPreviewRecipientCandidate,
} from './preview-recipient-download.js';
import {
  buildPreviewRecipientApplication,
  PREVIEW_RECIPIENT_INPUT,
  verifyPreviewRecipientStandalone,
} from './preview-recipient-package.js';

const HELP = `Usage:
  node scripts/verify-preview-recipient.js --tag v<version> --expected-commit <sha> --report <absolute.json> [--draft] [--download-only]
  node scripts/verify-preview-recipient.js --artifact-dir <absolute> --expected-commit <sha> --report <absolute.json>

Verifies an exact preview asset set, exercises the standalone CLI without Node
in PATH, and builds the installed starter using the matching core/AWS packages.
The full proof requires the prepared disposable GitHub Linux x64 recipient.
--draft reads draft assets using GH_TOKEN; credentials never enter the builder.
--download-only checks published downloads without provisioning a recipient.
Candidate-directory evidence is labeled separately from GitHub downloads.
`;

/** @typedef {{tag?: string, artifactDir?: string, expectedCommit: string, report: string, draft?: boolean, downloadOnly?: boolean}} PreviewRecipientOptions */

/**
 * Parse a single exact release source and a new bounded report destination.
 * @param {string[]} argv - Checkout acceptance arguments.
 * @returns {PreviewRecipientOptions|null} - Null requests help only.
 */
export function parsePreviewRecipientArgs(argv) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return null;
  const keys = new Map([
    ['--tag', 'tag'],
    ['--artifact-dir', 'artifactDir'],
    ['--expected-commit', 'expectedCommit'],
    ['--report', 'report'],
  ]);
  const options = /** @type {Record<string, any>} */ ({});
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const key =
      keys.get(flag) ??
      (flag === '--draft'
        ? 'draft'
        : flag === '--download-only'
          ? 'downloadOnly'
          : undefined);
    assert.ok(
      key && !Object.hasOwn(options, key),
      'Unknown or repeated recipient option.',
    );
    if (key === 'draft' || key === 'downloadOnly') options[key] = true;
    else {
      const value = argv[++i];
      assert.ok(
        value && !value.startsWith('--'),
        'Recipient option requires a value.',
      );
      options[key] = value;
    }
  }
  assert.notEqual(
    typeof options.tag === 'string',
    typeof options.artifactDir === 'string',
    'Select exactly one release source.',
  );
  if (options.tag)
    assert.match(options.tag, /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u);
  assert.match(
    options.expectedCommit ?? '',
    /^[a-f0-9]{40}$/u,
    'An exact source commit is required.',
  );
  assert.ok(
    typeof options.report === 'string' && path.isAbsolute(options.report),
    'Report requires an absolute new file.',
  );
  if (options.artifactDir)
    assert.ok(
      path.isAbsolute(options.artifactDir),
      'Candidate directory must be absolute.',
    );
  assert.ok(!options.draft || options.tag, 'Draft mode requires a GitHub tag.');
  return /** @type {PreviewRecipientOptions} */ (options);
}

/**
 * Keep controller subprocesses independent from author and download credentials.
 * @returns {NodeJS.ProcessEnv} - Minimal checkout-controller environment.
 */
export function previewRecipientControllerEnvironment() {
  return {
    PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
    LANG: 'C.UTF-8',
    TZ: 'UTC',
    WHARFIE_PREVIEW_RECIPIENT_DISPOSABLE: 'github-actions',
  };
}

/**
 * @param {string} file - Expected absent path.
 * @returns {Promise<boolean>} - True only for ENOENT.
 */
async function absent(file) {
  try {
    await lstat(file);
    return false;
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT')
      return true;
    throw error;
  }
}

/**
 * @param {string} file - Private bounded JSON.
 * @returns {Promise<Record<string, any>>} - Parsed receipt.
 */
async function readReceipt(file) {
  const info = await lstat(file);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= 256 * 1024);
  return JSON.parse(await readFile(file, 'utf8'));
}

/**
 * Default host-side command boundary. Only structured failure metadata escapes.
 * @param {string} file - Exact executable.
 * @param {string[]} args - Exact arguments.
 * @param {string} cwd - Private controller workspace.
 * @param {string} phase - Fixed report phase.
 * @param {number} [timeoutMs] - Owned process-group deadline.
 * @returns {ReturnType<typeof runLiveDeploymentProcess>} - Successful output.
 */
async function command(file, args, cwd, phase, timeoutMs = 60_000) {
  return await runLiveDeploymentProcess({
    file,
    args,
    cwd,
    phase,
    timeoutMs,
    env: previewRecipientControllerEnvironment(),
  });
}

/**
 * Require the current job's newly prepared account before any build or transfer.
 * @param {boolean} downloadOnly - Whether no persistent target will be touched.
 * @returns {Promise<void>} - Validated disposable host.
 */
async function preflight(downloadOnly) {
  assert.equal(
    process.platform,
    'linux',
    'Recipient acceptance requires Linux x64.',
  );
  assert.equal(process.arch, 'x64', 'Recipient acceptance requires Linux x64.');
  assert.equal(process.versions.node, PREVIEW_TARGET.nodeVersion);
  if (downloadOnly) return;
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(
    process.env.WHARFIE_PREVIEW_RECIPIENT_DISPOSABLE,
    'github-actions',
  );
  assert.ok(Number(process.getuid?.()) > 0);
  const result = await command(
    '/usr/bin/sudo',
    [
      '-n',
      '/usr/bin/python3',
      '-c',
      `import os, stat
fd = os.open('/var/tmp/wharfie-preview-recipient-owner.json', os.O_RDONLY | os.O_NOFOLLOW)
try:
    info = os.fstat(fd)
    assert stat.S_ISREG(info.st_mode) and info.st_uid == 0
    assert stat.S_IMODE(info.st_mode) == 0o600 and 0 < info.st_size <= 1024
    data = os.read(fd, 1025)
    assert len(data) == info.st_size
    os.write(1, data)
finally:
    os.close(fd)
`,
    ],
    REPO_ROOT,
    'recipient-account',
  );
  const owner = JSON.parse(result.stdout);
  assert.equal(owner.schemaVersion, 1);
  assert.equal(owner.kind, 'wharfie.preview-recipient.account-owner');
  assert.equal(owner.uid, RECIPIENT_UID);
  assert.equal(owner.runnerUid, process.getuid?.());
  assert.equal(owner.githubRunId, process.env.GITHUB_RUN_ID);
  assert.equal(owner.githubRunAttempt, process.env.GITHUB_RUN_ATTEMPT);
  await createPreviewRecipientTargetCommand()('/usr/bin/test', [
    '!',
    '-e',
    RECIPIENT_HANDOFF,
  ]);
}

/**
 * Supervise download, private build retirement, two controller processes, and
 * unconditional cleanup. The report retains identities and fixed diagnostics;
 * stdout, credentials, arbitrary exceptions, and build files are not retained.
 * @param {PreviewRecipientOptions} options - Exact release source and new report.
 * @param {Record<string, any>} [dependencies] - Narrow orchestration ports for failure-path tests.
 * @returns {Promise<Record<string, any>>} - Final bounded proof report.
 */
export async function verifyPreviewRecipient(options, dependencies = {}) {
  const started = performance.now();
  await mkdir(path.dirname(options.report), { recursive: true, mode: 0o700 });
  const reportFile = await open(options.report, 'wx', 0o600);
  const report = /** @type {Record<string, any>} */ ({
    schemaVersion: 1,
    kind: 'wharfie.preview-recipient.acceptance',
    source: options.artifactDir
      ? 'candidate-directory'
      : options.draft
        ? 'github-draft'
        : 'github-public',
    expectedCommit: options.expectedCommit,
    status: 'failed',
    mode: options.downloadOnly ? 'download-only' : 'full',
    phases: [],
    failure: null,
    cleanup: {
      workspaceRemoved: false,
      handoffRemoved: null,
      applicationCleaned: null,
    },
  });
  let phase = 'preflight';
  /** @type {string|undefined} */
  let workspace;
  let repositoryMode;
  let handoffOwned = false;
  let targetStarted = false;
  let targetFinished = false;
  /** @type {Record<string, any>|undefined} */
  let authority;
  const run = dependencies.command ?? command;
  const repository = dependencies.repositoryRoot ?? REPO_ROOT;
  const enter = (/** @type {string} */ name) => {
    phase = name;
    assert.ok(report.phases.length < 64);
    report.phases.push({
      phase: name,
      elapsedMs: Math.round(performance.now() - started),
    });
    dependencies.onPhase?.(name);
  };
  const controller = async (/** @type {string} */ action) => {
    assert.ok(workspace);
    assert.ok(authority);
    const authorityPath = path.join(workspace, 'authority.json');
    const checkpointPath = path.join(workspace, 'checkpoint.json');
    const resultPath = path.join(workspace, `${action}.json`);
    await writeFile(authorityPath, JSON.stringify(authority) + '\n', {
      mode: 0o600,
    });
    await run(
      process.execPath,
      [
        path.join(REPO_ROOT, 'scripts/preview-recipient-controller.js'),
        action,
        authorityPath,
        checkpointPath,
        resultPath,
      ],
      workspace,
      `recipient-${action}`,
      600_000,
    );
    return await readReceipt(resultPath);
  };
  try {
    enter('preflight');
    await (dependencies.preflight ?? preflight)(options.downloadOnly === true);
    workspace = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'wharfie-recipient-')),
    );
    await chmod(workspace, 0o700);
    enter('verify-release');
    let candidate;
    if (options.artifactDir) {
      candidate = await (
        dependencies.verifyCandidate ?? verifyPreviewRecipientCandidate
      )(options.artifactDir, { expectedCommit: options.expectedCommit });
      report.release = {
        tag: candidate.manifest.tag,
        sourceCommit: candidate.manifest.source.commit,
      };
    } else {
      const downloaded = await (
        dependencies.download ?? downloadPreviewRecipientRelease
      )({
        tag: options.tag,
        directory: path.join(workspace, 'release'),
        expectedCommit: options.expectedCommit,
        draft: options.draft === true,
        ...(options.draft ? { token: process.env.GH_TOKEN } : {}),
      });
      candidate = downloaded.candidate;
      report.release = downloaded.receipt;
    }
    assert.equal(candidate.manifest.source.commit, options.expectedCommit);
    enter('standalone');
    report.standalone = await (
      dependencies.standalone ?? verifyPreviewRecipientStandalone
    )({ candidate, workspace: path.join(workspace, 'standalone') });
    if (!options.downloadOnly) {
      enter('build');
      const builder = path.join(workspace, 'builder');
      const built = await (
        dependencies.build ?? buildPreviewRecipientApplication
      )({
        candidate,
        workspace: builder,
        handoff: path.join(workspace, 'handoff'),
        onPhase: enter,
      });
      report.application = built.receipt;
      enter('retire-builder');
      await rm(builder, { recursive: true, force: true });
      assert.ok(await absent(builder));
      report.builderRemovedBeforeRecipient = true;
      authority = {
        runId: randomUUID(),
        artifactRecord: built.artifactRecord,
        inputBytes: PREVIEW_RECIPIENT_INPUT,
      };
      enter('transfer');
      await run(
        '/usr/bin/sudo',
        ['-n', '/usr/bin/mkdir', RECIPIENT_HANDOFF],
        workspace,
        'recipient-handoff',
      );
      handoffOwned = true;
      await run(
        '/usr/bin/sudo',
        [
          '-n',
          '/usr/bin/chown',
          `${RECIPIENT_UID}:${RECIPIENT_UID}`,
          RECIPIENT_HANDOFF,
        ],
        workspace,
        'recipient-handoff',
      );
      await run(
        '/usr/bin/sudo',
        ['-n', '/usr/bin/chmod', '0700', RECIPIENT_HANDOFF],
        workspace,
        'recipient-handoff',
      );
      const input = path.join(workspace, 'input.txt');
      await writeFile(input, PREVIEW_RECIPIENT_INPUT, {
        mode: 0o600,
        flag: 'wx',
      });
      for (const [source, name, mode] of [
        [built.executable, 'app', '0700'],
        [built.recordPath, 'artifact-record.json', '0600'],
        [input, 'input.txt', '0600'],
      ]) {
        await run(
          '/usr/bin/sudo',
          [
            '-n',
            '/usr/bin/install',
            '-m',
            mode,
            '-o',
            RECIPIENT_USER,
            '-g',
            RECIPIENT_USER,
            source,
            path.join(RECIPIENT_HANDOFF, name),
          ],
          workspace,
          'recipient-handoff',
        );
      }
      repositoryMode = (await stat(repository)).mode & 0o777;
      await chmod(repository, 0o700);
      enter('verify-isolation');
      const targetRun =
        dependencies.targetCommand ?? createPreviewRecipientTargetCommand();
      await targetRun('/usr/bin/test', [
        '!',
        '-r',
        path.join(repository, 'package.json'),
      ]);
      await targetRun('/usr/bin/test', ['!', '-r', workspace]);
      report.sourceUnavailableToRecipient = true;
      enter('prepare');
      targetStarted = true;
      const prepared = await (dependencies.controller ?? controller)(
        'prepare',
        authority,
        workspace,
      );
      report.prepared = prepared;
      authority.prepared = prepared;
      authority.owned = prepared.owned;
      enter('reconnect');
      report.completed = await (dependencies.controller ?? controller)(
        'complete',
        authority,
        workspace,
      );
      targetFinished = true;
      report.cleanup.applicationCleaned = true;
    }
    report.status = 'passed';
  } catch (error) {
    const diagnostic = /** @type {{diagnostic?: Record<string, any>}} */ (error)
      ?.diagnostic;
    report.failure = { phase };
    if (diagnostic) {
      if (
        ['node', 'sudo', 'wharfie', 'app', 'npm'].includes(diagnostic.command)
      ) {
        report.failure.command = diagnostic.command;
      }
      for (const name of [
        'durationMs',
        'status',
        'signal',
        'timedOut',
        'aborted',
        'outputLimitExceeded',
      ]) {
        if (
          ['number', 'boolean'].includes(typeof diagnostic[name]) ||
          diagnostic[name] === null ||
          (name === 'signal' && /^SIG[A-Z]+$/.test(diagnostic[name]))
        )
          report.failure[name] = diagnostic[name];
      }
    }
  } finally {
    if (targetStarted && !targetFinished && workspace && authority) {
      try {
        report.targetFailureCheckpoint = await readReceipt(
          path.join(workspace, 'checkpoint.json'),
        );
      } catch {
        /* A controller can fail before writing its first checkpoint. */
      }
      try {
        authority.owned = await readReceipt(
          path.join(workspace, 'authority-owned.json'),
        );
        await (dependencies.controller ?? controller)(
          'cleanup',
          authority,
          workspace,
        );
        report.cleanup.applicationCleaned = true;
      } catch {
        report.cleanup.applicationCleaned = false;
      }
    }
    if (workspace) {
      try {
        const checkpoint = await readReceipt(
          path.join(workspace, 'checkpoint.json'),
        );
        report.targetCheckpoint = checkpoint;
      } catch {
        /* No target checkpoint exists before the handoff. */
      }
    }
    if (handoffOwned && workspace) {
      try {
        await run(
          '/usr/bin/sudo',
          ['-n', '/usr/bin/rm', '-rf', '--', RECIPIENT_HANDOFF],
          workspace,
          'recipient-handoff-cleanup',
        );
        await (
          dependencies.targetCommand ?? createPreviewRecipientTargetCommand()
        )('/usr/bin/test', ['!', '-e', RECIPIENT_HANDOFF]);
        report.cleanup.handoffRemoved = true;
      } catch {
        report.cleanup.handoffRemoved = false;
        report.status = 'failed';
      }
    }
    if (repositoryMode !== undefined) {
      try {
        await chmod(repository, repositoryMode);
      } catch {
        report.status = 'failed';
        report.cleanup.repositoryModeRestored = false;
      }
    }
    try {
      if (workspace) await rm(workspace, { recursive: true, force: true });
      report.cleanup.workspaceRemoved = !workspace || (await absent(workspace));
    } catch {
      report.cleanup.workspaceRemoved = false;
      report.status = 'failed';
    }
    report.durationMs = Math.round(performance.now() - started);
    try {
      const bytes = JSON.stringify(report, null, 2) + '\n';
      assert.ok(Buffer.byteLength(bytes) <= 256 * 1024);
      await reportFile.writeFile(bytes);
      await reportFile.sync();
    } finally {
      await reportFile.close();
    }
  }
  return report;
}

/** @param {string[]} argv - Public acceptance arguments. @returns {Promise<void>} - CLI boundary. */
export async function main(argv = process.argv.slice(2)) {
  const options = parsePreviewRecipientArgs(argv);
  if (!options) {
    process.stdout.write(HELP);
    return;
  }
  const report = await verifyPreviewRecipient(options, {
    onPhase: (/** @type {string} */ phase) =>
      process.stdout.write(JSON.stringify({ phase }) + '\n'),
  });
  process.stdout.write(
    JSON.stringify({ status: report.status, report: options.report }) + '\n',
  );
  if (report.status !== 'passed') process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    process.stderr.write(
      'Preview recipient acceptance failed before a report could be completed.\n',
    );
    process.exitCode = 1;
  });
}
