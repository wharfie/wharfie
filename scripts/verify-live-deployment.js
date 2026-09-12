/* eslint-disable jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This acceptance driver keeps its bounded orchestration helpers together. */

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isIPv4 } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { assertSingleNodeDeploymentInstanceId } from '../src/core/runtime/single-node-deployment-identity.js';
import { acquireSingleNodeDeploymentOperationLock } from '../src/core/runtime/single-node-deployment-operation-lock.js';
import {
  createSingleNodeDeploymentJournalStore,
  getSingleNodeDeploymentEffectiveDesired,
} from '../src/core/runtime/single-node-deployment-journal.js';
import { validateSingleNodeDeploymentPreview } from '../src/core/runtime/single-node-deployment-preview.js';
import { validateSingleNodeDeploymentStatus } from '../src/core/runtime/single-node-deployment-status.js';
import { auditLiveDeploymentCleanup } from './live-deployment-provider-audit.js';
import {
  buildLiveDeploymentCandidate,
  runLiveDeploymentProcess,
} from './live-deployment-package.js';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const FORMAT = 'wharfie.live-deployment.run.v1';
const APP_ID = 'hello-world';
const MAX_RECEIPT_BYTES = 256 * 1024;
const HELP = `Usage:
  npm run verify:deployment:live -- --provider hetzner --location fsn1 --allow-ssh-from <IPv4/32> [--output-dir <new-directory>]
  npm run verify:deployment:live -- --provider aws --region us-east-2 --allow-ssh-from <IPv4/32> [--output-dir <new-directory>]
  npm run verify:deployment:live -- --cleanup <run-directory>

Builds a fresh installed candidate, provisions one real host, checks the packaged
app, then destroys its resources and independently verifies their absence.
Credentials: ambient AWS credential chain or HCLOUD_TOKEN. One provider per run.
Unconfirmed cleanup retains the executable and controller state for --cleanup.
`;

/**
 * Validate explicit placement and narrow SSH access before doing any work.
 * @param {string[]} args
 * @returns {Record<string, any>}
 */
export function parseLiveDeploymentArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const options = /** @type {Record<string, string>} */ ({});
  const allowed = new Set([
    '--provider',
    '--region',
    '--location',
    '--allow-ssh-from',
    '--output-dir',
    '--cleanup',
  ]);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    assert.ok(allowed.has(key), 'Unknown acceptance option.');
    assert.ok(
      typeof args[i + 1] === 'string' && !args[i + 1].startsWith('--'),
      'Option requires a value.',
    );
    assert.ok(!Object.hasOwn(options, key), 'Duplicate acceptance option.');
    options[key] = args[i + 1];
  }
  if (Object.hasOwn(options, '--cleanup')) {
    assert.equal(
      Object.keys(options).length,
      1,
      'Cleanup does not accept deployment selectors.',
    );
    return { cleanup: path.resolve(options['--cleanup']) };
  }
  const provider = options['--provider'];
  assert.ok(
    ['aws', 'hetzner'].includes(provider),
    'Select --provider aws or hetzner.',
  );
  const placement = options[provider === 'aws' ? '--region' : '--location'];
  assert.ok(
    typeof placement === 'string' && /^[a-z][a-z0-9-]{1,31}$/.test(placement),
    'Explicit provider placement is required.',
  );
  assert.ok(
    !Object.hasOwn(options, provider === 'aws' ? '--location' : '--region'),
    'Placement must match the provider.',
  );
  const allowedIpv4 = options['--allow-ssh-from'];
  assert.ok(
    typeof allowedIpv4 === 'string' && allowedIpv4.endsWith('/32'),
    'SSH access requires one IPv4 /32.',
  );
  const address = allowedIpv4.slice(0, -3);
  assert.ok(
    isIPv4(address) && address === address.split('.').map(Number).join('.'),
    'SSH access requires a canonical IPv4 /32.',
  );
  return {
    provider,
    placement,
    allowedIpv4,
    ...(options['--output-dir']
      ? { outputDir: path.resolve(options['--output-dir']) }
      : {}),
  };
}

/**
 * Keep report destinations and retained authority private and unambiguous.
 * @param {string} directory
 */
function assertPrivateDirectory(directory) {
  const stat = lstatSync(directory);
  assert.ok(
    stat.isDirectory() && !stat.isSymbolicLink(),
    'Expected a real private directory.',
  );
  assert.equal(
    stat.mode & 0o077,
    0,
    'Acceptance directories must be owner-only.',
  );
}

/**
 * Write only finite JSON evidence; temporary publication is replaced atomically.
 * @param {string} directory
 * @param {string} name
 * @param {unknown} value
 */
function writeJson(directory, name, value) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  assert.ok(
    Buffer.byteLength(bytes) <= MAX_RECEIPT_BYTES,
    'Acceptance receipt exceeds its bound.',
  );
  const temporary = path.join(directory, `.${name}.${randomUUID()}.tmp`);
  writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
  renameSync(temporary, path.join(directory, name));
}

/**
 * Read finite local evidence without following a file symlink.
 * @param {string} directory
 * @param {string} name
 * @returns {any}
 */
function readJson(directory, name) {
  const selected = path.join(directory, name);
  const stat = lstatSync(selected);
  assert.ok(
    stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_RECEIPT_BYTES,
    'Invalid acceptance receipt.',
  );
  return JSON.parse(readFileSync(selected, 'utf8'));
}

/**
 * Never persist raw child output, exceptions, arguments, or environment.
 * @param {string} phase
 * @param {number} durationMs
 * @param {any} error
 */
export function liveDeploymentFailureDiagnostic(phase, durationMs, error) {
  const diagnostic = error?.diagnostic ?? {};
  return {
    phase,
    durationMs: Math.max(0, Math.round(durationMs)),
    command: ['node', 'npm', 'npm.cmd'].includes(diagnostic.command)
      ? diagnostic.command
      : diagnostic.command
        ? 'packaged-app'
        : null,
    status: Number.isInteger(diagnostic.status) ? diagnostic.status : null,
    signal:
      typeof diagnostic.signal === 'string' &&
      /^SIG[A-Z0-9]{1,12}$/.test(diagnostic.signal)
        ? diagnostic.signal
        : null,
    timedOut: diagnostic.timedOut === true,
    aborted: diagnostic.aborted === true,
    outputLimitExceeded: diagnostic.outputLimitExceeded === true,
  };
}

/**
 * Package outside the checkout, retaining only the verified executable.
 * @param {Parameters<typeof buildLiveDeploymentCandidate>[0]} options
 */
async function buildCandidate({ workspace, provider, signal, onPhase }) {
  const temporary = mkdtempSync(
    path.join(realpathSync(os.tmpdir()), 'wharfie-live-build-'),
  );
  chmodSync(temporary, 0o700);
  try {
    const candidate = await buildLiveDeploymentCandidate({
      workspace: temporary,
      provider,
      signal,
      onPhase,
    });
    const executable = path.join(workspace, 'app');
    copyFileSync(candidate.executable, executable);
    chmodSync(executable, 0o700);
    return { ...candidate, executable };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

/**
 * Authenticate the retained executable before running it again for cleanup.
 * @param {string} executable
 * @param {Record<string, any>} record
 */
async function verifyExecutable(executable, record) {
  const stat = lstatSync(executable);
  assert.ok(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      record &&
      stat.size === record.size,
    'Retained executable does not match its receipt.',
  );
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(executable)) hash.update(chunk);
  assert.equal(
    hash.digest('base64url'),
    record.byteDigest.value,
    'Retained executable digest mismatch.',
  );
}

/**
 * Read only the exact production journal selected before apply.
 * @param {Record<string, any>} state
 * @param {string} dataRoot
 */
async function readJournal(state, dataRoot) {
  if (state.deploymentInstanceId === null) return null;
  assertSingleNodeDeploymentInstanceId(state.deploymentInstanceId);
  const store = createSingleNodeDeploymentJournalStore({
    appId: APP_ID,
    deploymentInstanceId: state.deploymentInstanceId,
    dataRoot,
  });
  const journal = await store.read();
  if (journal !== null) {
    const desired = getSingleNodeDeploymentEffectiveDesired(journal);
    assert.equal(desired.intent.appId, APP_ID);
    assert.equal(desired.intent.deployment.id, state.deploymentId);
    assert.equal(desired.intent.provider.kind, state.provider);
    assert.equal(
      desired.intent.provider[state.provider === 'aws' ? 'region' : 'location'],
      state.placement,
    );
    assert.deepEqual(
      [...desired.intent.access.allowedIpv4],
      [state.allowedIpv4],
    );
    assert.equal(desired.desiredRevisionId, state.desiredRevisionId);
  }
  return journal;
}

/**
 * Restrict lifecycle credentials to the chosen provider and the controller.
 * @param {string} provider
 * @param {NodeJS.ProcessEnv} [environment]
 * @returns {NodeJS.ProcessEnv}
 */
export function liveDeploymentControllerEnvironment(
  provider,
  environment = process.env,
) {
  const result = /** @type {NodeJS.ProcessEnv} */ ({});
  for (const [name, value] of Object.entries(environment)) {
    if (typeof value !== 'string') continue;
    if (
      [
        'PATH',
        'HOME',
        'USER',
        'LOGNAME',
        'TMPDIR',
        'LANG',
        'LC_ALL',
        'SSH_AUTH_SOCK',
      ].includes(name) ||
      (provider === 'aws' && name.startsWith('AWS_')) ||
      (provider === 'hetzner' && name === 'HCLOUD_TOKEN')
    )
      result[name] = value;
  }
  return result;
}

/**
 * One fresh invocation verifies healthy identity against the packaged preview.
 * @param {unknown} value
 * @param {Record<string, any>} state
 */
function assertHealthyStatus(value, state) {
  const status = validateSingleNodeDeploymentStatus(value);
  assert.equal(status.status, 'healthy');
  assert.equal(status.provider, state.provider);
  assert.equal(
    status.deployment.deploymentInstanceId,
    state.deploymentInstanceId,
  );
  assert.equal(status.deployment.desiredRevisionId, state.desiredRevisionId);
  assert.equal(status.deployment.artifact.artifactId, state.guestArtifactId);
  assert.equal(status.guest.service.health, 'healthy');
  assert.equal(status.guest.service.desiredMatches, true);
  return status;
}

/**
 * Keep only the public apply identity and require every replay comparison.
 * @param {Record<string, any>} value
 * @param {Record<string, any>} state
 */
function applyReceipt(value, state) {
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.kind, 'wharfie.deployment.apply');
  assert.equal(value.provider, state.provider);
  assert.equal(value.status, 'active');
  const result = /** @type {Record<string, any>} */ ({
    schemaVersion: 1,
    kind: value.kind,
    provider: state.provider,
    status: 'active',
  });
  for (const key of [
    'deploymentInstanceId',
    'deploymentId',
    'appId',
    'revisionId',
    'publicIpv4',
    'artifactId',
  ]) {
    assert.ok(
      typeof value[key] === 'string' &&
        /^[A-Za-z0-9_.:-]{1,128}$/.test(value[key]),
      'Apply receipt is missing a bounded identity.',
    );
    result[key] = value[key];
  }
  assert.equal(result.deploymentInstanceId, state.deploymentInstanceId);
  assert.equal(result.deploymentId, state.deploymentId);
  assert.equal(result.appId, APP_ID);
  assert.equal(result.revisionId, state.guestRevisionId);
  assert.equal(result.artifactId, state.guestArtifactId);
  return result;
}

/**
 * Build, exercise, and clean up exactly one new provider deployment.
 * @param {Record<string, any>} options
 * @param {Record<string, any>} [dependencies]
 */
export async function runLiveDeploymentAcceptance(options, dependencies = {}) {
  if (!options.cleanup) {
    parseLiveDeploymentArguments([
      '--provider',
      options.provider,
      options.provider === 'aws' ? '--region' : '--location',
      options.placement,
      '--allow-ssh-from',
      options.allowedIpv4,
    ]);
  }
  const requested = path.resolve(
    options.cleanup ??
      options.outputDir ??
      path.join(REPO, '.wharfie/live-deployment', randomUUID()),
  );
  if (!options.cleanup)
    mkdirSync(path.dirname(requested), { recursive: true, mode: 0o700 });
  const selected = options.cleanup
    ? realpathSync(requested)
    : path.join(
        realpathSync(path.dirname(requested)),
        path.basename(requested),
      );
  // A distinct kernel lock prevents --cleanup racing a still-running acceptance
  // controller. It supplies exclusion only, never provider or journal authority.
  const lockId = `wsnd1_${createHash('sha256').update(`wharfie:live-deployment-run-lock:v1:${selected}`).digest('base64url')}`;
  const acquire =
    dependencies.acquireRunLock ?? acquireSingleNodeDeploymentOperationLock;
  const release = await acquire(lockId);
  try {
    return await runAcceptance(
      {
        ...options,
        ...(options.cleanup ? { cleanup: selected } : { outputDir: selected }),
      },
      dependencies,
    );
  } finally {
    await release();
  }
}

/**
 * Run one exclusively held acceptance workspace.
 * @param {Record<string, any>} options
 * @param {Record<string, any>} dependencies
 */
async function runAcceptance(options, dependencies) {
  const ports = /** @type {Record<string, any>} */ ({
    build: buildCandidate,
    run: runLiveDeploymentProcess,
    readJournal,
    audit: auditLiveDeploymentCleanup,
    verifyExecutable,
    validatePreview: validateSingleNodeDeploymentPreview,
    validateStatus: assertHealthyStatus,
    wait: delay,
    log: (/** @type {Record<string, any>} */ event) =>
      process.stdout.write(`${JSON.stringify(event)}\n`),
    ...dependencies,
  });
  const started = performance.now();
  let state = /** @type {Record<string, any>} */ ({});
  let runDir = '';
  if (options.cleanup) {
    runDir = realpathSync(options.cleanup);
    assertPrivateDirectory(runDir);
    state = readJson(runDir, 'run.json');
    assert.equal(state.format, FORMAT);
    assert.equal(state.appId, APP_ID);
    const checked = parseLiveDeploymentArguments([
      '--provider',
      state.provider,
      state.provider === 'aws' ? '--region' : '--location',
      state.placement,
      '--allow-ssh-from',
      state.allowedIpv4,
    ]);
    assert.equal(checked.provider, state.provider);
    assert.ok(/^acceptance-[0-9a-f-]{36}$/.test(state.deploymentId));
    assert.equal(typeof state.applyAttempted, 'boolean');
    if (!existsSync(path.join(runDir, 'workspace'))) {
      const report = readJson(
        runDir,
        existsSync(path.join(runDir, 'cleanup-report.json'))
          ? 'cleanup-report.json'
          : 'report.json',
      );
      assert.equal(report.workspaceRemoved, true);
      assert.ok(['absent', 'not-created'].includes(report.cleanup.status));
      return { runDir, ...report, mode: 'cleanup', status: 'passed' };
    }
  } else {
    // Validate programmatic callers through the same CLI boundary.
    parseLiveDeploymentArguments([
      '--provider',
      options.provider,
      options.provider === 'aws' ? '--region' : '--location',
      options.placement,
      '--allow-ssh-from',
      options.allowedIpv4,
    ]);
    const runId = randomUUID();
    const requested =
      options.outputDir ?? path.join(REPO, '.wharfie/live-deployment', runId);
    mkdirSync(path.dirname(requested), { recursive: true, mode: 0o700 });
    mkdirSync(requested, { mode: 0o700 });
    runDir = realpathSync(requested);
    assertPrivateDirectory(runDir);
    mkdirSync(path.join(runDir, 'workspace'), { mode: 0o700 });
    state = {
      format: FORMAT,
      appId: APP_ID,
      runId,
      provider: options.provider,
      placement: options.placement,
      allowedIpv4: options.allowedIpv4,
      deploymentId: `acceptance-${runId}`,
      deploymentInstanceId: null,
      desiredRevisionId: null,
      guestArtifactId: null,
      guestRevisionId: null,
      artifactRecord: null,
      applyAttempted: false,
    };
    writeJson(runDir, 'run.json', state);
  }
  const workspace = path.join(runDir, 'workspace');
  assertPrivateDirectory(workspace);
  const executable = path.join(workspace, 'app');
  const dataRoot = path.join(workspace, 'controller');
  const environment = liveDeploymentControllerEnvironment(state.provider);
  const phases = /** @type {Record<string, any>[]} */ ([]);
  let failure =
    /** @type {ReturnType<typeof liveDeploymentFailureDiagnostic>|null} */ (
      null
    );
  let cleanup = /** @type {Record<string, any>} */ ({
    status: state.applyAttempted ? 'unknown' : 'not-created',
  });
  let workspaceRemoved = false;
  let currentPhase = 'preflight';
  let phaseStarted = started;
  /**
   * Run a finite phase and retain only its bounded diagnostic.
   * @param {string} name
   * @param {() => Promise<any>} action
   */
  async function phase(name, action) {
    currentPhase = name;
    phaseStarted = performance.now();
    ports.log({ phase: name, state: 'started', runDir });
    try {
      const result = await action();
      phases.push({
        phase: name,
        durationMs: Math.round(performance.now() - phaseStarted),
        status: 'passed',
      });
      return result;
    } catch (error) {
      phases.push({
        ...liveDeploymentFailureDiagnostic(
          name,
          performance.now() - phaseStarted,
          error,
        ),
        result: 'failed',
      });
      throw error;
    }
  }
  /**
   * Each packaged call is a new controller process; cleanup ignores cancellation.
   * @param {string} name
   * @param {string[]} args
   * @param {number} timeoutMs
   * @param {boolean} [cleaning]
   */
  async function command(name, args, timeoutMs, cleaning = false) {
    return ports.run({
      file: executable,
      args,
      cwd: workspace,
      env:
        name === 'local-cli'
          ? liveDeploymentControllerEnvironment('none')
          : environment,
      timeoutMs,
      phase: name,
      signal: cleaning ? undefined : options.signal,
    });
  }
  const placementArgs = [
    '--deployment',
    state.deploymentId,
    '--provider',
    state.provider,
    state.provider === 'aws' ? '--region' : '--location',
    state.placement,
    '--allow-ssh-from',
    state.allowedIpv4,
    '--data-root',
    dataRoot,
    '--json',
  ];
  const selectedArgs = () => [
    '--deployment-instance',
    state.deploymentInstanceId,
    '--data-root',
    dataRoot,
  ];
  try {
    if (!options.cleanup) {
      const candidate = await phase('package', () =>
        ports.build({
          workspace,
          provider: state.provider,
          signal: options.signal,
          onPhase: (/** @type {Record<string, any>} */ event) =>
            ports.log({ phase: 'package', step: event.phase }),
        }),
      );
      assert.equal(candidate.appId, APP_ID);
      state.artifactRecord = candidate.artifactRecord;
      writeJson(runDir, 'run.json', state);
      writeJson(runDir, 'package.json', {
        packageVersion: candidate.packageVersion,
        artifactRecord: candidate.artifactRecord,
      });
      await phase('verify-executable', () =>
        ports.verifyExecutable(executable, state.artifactRecord),
      );
      await phase('local-cli', async () => {
        const result = await command(
          'local-cli',
          ['Wharfie acceptance'],
          60_000,
        );
        assert.equal(result.stdout, 'Hello, Wharfie acceptance!\n');
      });
      const preview = await phase('preview', async () => {
        const result = await command(
          'preview',
          ['wharfie', 'deployment', 'preview', ...placementArgs],
          180_000,
        );
        const value = ports.validatePreview(JSON.parse(result.stdout));
        assert.equal(value.provider, state.provider);
        assert.equal(value.status, 'actionable');
        assert.equal(value.deployment.appId, APP_ID);
        assert.equal(value.deployment.deploymentId, state.deploymentId);
        assert.equal(value.journal.state, 'absent');
        assert.equal(
          existsSync(dataRoot),
          false,
          'Read-only preview created controller state.',
        );
        writeJson(runDir, 'preview.json', value);
        return value;
      });
      state.deploymentInstanceId = preview.deployment.deploymentInstanceId;
      state.desiredRevisionId = preview.deployment.desiredRevisionId;
      state.guestArtifactId = preview.deployment.artifact.artifactId;
      state.guestRevisionId = preview.deployment.revisionId;
      // Persist the selected identity and possible cloud mutation BEFORE spawning apply.
      state.applyAttempted = true;
      cleanup = { status: 'unknown' };
      writeJson(runDir, 'run.json', state);
      const first = await phase('apply', async () => {
        const value = applyReceipt(
          JSON.parse(
            (
              await command(
                'apply',
                ['wharfie', 'deployment', 'apply', ...placementArgs],
                1_200_000,
              )
            ).stdout,
          ),
          state,
        );
        const journal = await ports.readJournal(state, dataRoot);
        assert.ok(journal !== null && journal.phase === 'active');
        writeJson(runDir, 'apply.json', value);
        return { receipt: value, journalId: journal.journalId };
      });
      await phase('status', async () => {
        const status = ports.validateStatus(
          JSON.parse(
            (
              await command(
                'status',
                [
                  'wharfie',
                  'deployment',
                  'status',
                  ...selectedArgs(),
                  '--json',
                ],
                180_000,
              )
            ).stdout,
          ),
          state,
        );
        writeJson(runDir, 'status.json', status);
      });
      await phase('remote-cli', async () => {
        const result = await command(
          'remote-cli',
          [
            'wharfie',
            'deployment',
            'exec',
            ...selectedArgs(),
            '--',
            'Wharfie acceptance',
          ],
          120_000,
        );
        assert.equal(result.stdout, 'Hello, Wharfie acceptance!\n');
      });
      await phase('fresh-controller', async () => {
        const next = applyReceipt(
          JSON.parse(
            (
              await command(
                'fresh-controller',
                ['wharfie', 'deployment', 'apply', ...placementArgs],
                1_200_000,
              )
            ).stdout,
          ),
          state,
        );
        assert.deepEqual(next, first.receipt);
        const journal = await ports.readJournal(state, dataRoot);
        assert.ok(journal !== null && journal.phase === 'active');
        assert.equal(
          journal.journalId,
          first.journalId,
          'Fresh controller changed the committed deployment journal.',
        );
        writeJson(runDir, 'fresh-controller.json', next);
      });
    }
  } catch (error) {
    failure = liveDeploymentFailureDiagnostic(
      currentPhase,
      performance.now() - phaseStarted,
      error,
    );
  }
  // Always run journal-directed destruction, including a lost/failed apply response.
  try {
    if (state.applyAttempted) {
      await phase('cleanup', async () => {
        await ports.verifyExecutable(executable, state.artifactRecord);
        let journal = await ports.readJournal(state, dataRoot);
        assert.ok(
          journal !== null,
          'Apply was attempted but cleanup authority could not be recovered.',
        );
        if (journal.phase !== 'destroyed') {
          const result = JSON.parse(
            (
              await command(
                'destroy',
                [
                  'wharfie',
                  'deployment',
                  'destroy',
                  ...selectedArgs(),
                  '--json',
                ],
                600_000,
                true,
              )
            ).stdout,
          );
          assert.equal(result.status, 'destroyed');
          assert.equal(result.deploymentInstanceId, state.deploymentInstanceId);
          writeJson(runDir, 'destroy.json', {
            provider: state.provider,
            status: 'destroyed',
            deploymentInstanceId: state.deploymentInstanceId,
          });
          journal = await ports.readJournal(state, dataRoot);
          assert.ok(journal !== null && journal.phase === 'destroyed');
        }
        const deadline = performance.now() + 120_000;
        do {
          cleanup = await ports.audit({ journal, dataRoot });
          writeJson(runDir, 'cleanup.json', cleanup);
          if (cleanup.status === 'absent') return;
          assert.equal(
            cleanup.status,
            'present',
            'Provider cleanup could not be independently observed.',
          );
          if (performance.now() >= deadline) break;
          await ports.wait(2_000);
        } while (performance.now() < deadline);
        throw new Error('Provider resources remain after destruction.');
      });
    }
    await phase('remove-workspace', async () => {
      assertPrivateDirectory(workspace);
      rmSync(workspace, { recursive: true, force: true });
      workspaceRemoved = true;
    });
  } catch (error) {
    cleanup = {
      ...cleanup,
      failure: liveDeploymentFailureDiagnostic(
        currentPhase,
        performance.now() - phaseStarted,
        error,
      ),
    };
  }
  const report = {
    format: FORMAT,
    mode: options.cleanup ? 'cleanup' : 'acceptance',
    provider: state.provider,
    status: failure === null && workspaceRemoved ? 'passed' : 'failed',
    durationMs: Math.round(performance.now() - started),
    failure,
    cleanup,
    workspaceRemoved,
    phases,
  };
  writeJson(
    runDir,
    options.cleanup ? 'cleanup-report.json' : 'report.json',
    report,
  );
  ports.log({ status: report.status, runDir, workspaceRemoved });
  return { runDir, ...report };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseLiveDeploymentArguments(process.argv.slice(2));
    if (options.help) process.stdout.write(HELP);
    else {
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      try {
        const result = await runLiveDeploymentAcceptance({
          ...options,
          signal: controller.signal,
        });
        if (result.status !== 'passed') process.exitCode = 1;
      } finally {
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
      }
    }
  } catch {
    process.stderr.write(
      `Live deployment acceptance could not start or retain its report.\n${HELP}`,
    );
    process.exitCode = 1;
  }
}
