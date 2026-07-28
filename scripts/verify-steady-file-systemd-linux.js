import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  cpSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { parseApplicationPackageReceiptOutput } from '../src/cli/app/package-command-receipt.js';
import { createPackageTarball, readJson } from './package-verification.js';
import { verifyPackageSeaArtifactHandoff } from './package-sea-verification.js';

const APP_ID = 'steady-file-demo';
const WORKFLOW_ID = 'verify-stable';
const UNIT_NAME = `wharfie-${APP_ID}.service`;
const PROOF_ROOT =
  process.env.WHARFIE_SYSTEMD_PROOF_ROOT || '/var/tmp/wharfie-systemd-proof';
const PREPARE_PATH = path.join(PROOF_ROOT, 'steady-file-prepare.json');
const FINAL_PATH = path.join(PROOF_ROOT, 'steady-file-final.json');
const INPUT_PATH = path.join(PROOF_ROOT, 'artifact.tar');
const INPUT_BYTES = 'literal steady-file systemd proof artifact\n';
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const STATUS_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 250;
const SOURCE_FILES = Object.freeze([
  'activities.js',
  'cli.js',
  'file-stability.js',
  'local.js',
  'wharfie.app.js',
]);
const TARGET_WINDOW_FROM = 'export const STABILITY_WINDOW_MS = 250;';
const TARGET_WINDOW_TO = 'export const STABILITY_WINDOW_MS = 500;';

/**
 * @typedef CommandResult
 * @property {number} status - Exit status.
 * @property {string} stdout - Standard output.
 * @property {string} stderr - Standard error.
 */

/**
 * @typedef PackagedArtifact
 * @property {string} artifactPath - Generated SEA path.
 * @property {Record<string, any>} artifact - Public package artifact entry.
 * @property {string} revisionId - Independently verified revision identity.
 */

/**
 * Run one exact command without a shell.
 * @param {string} command - Executable path.
 * @param {string[]} args - Exact argv.
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv, allowFailure?: boolean, timeoutMs?: number}} [options] - Process options.
 * @returns {CommandResult} - Completed command.
 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT_BYTES,
    timeout: options.timeoutMs || 180_000,
  });
  if (result.error) throw result.error;
  const output = {
    status: result.status ?? 1,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  };
  if (output.status !== 0 && options.allowFailure !== true) {
    const detail = output.stderr.trim() || output.stdout.trim();
    throw new Error(
      `${command} failed with exit ${output.status}: ${detail.slice(0, 4096)}`,
    );
  }
  return output;
}

/**
 * Parse one command's complete stdout as JSON.
 * @param {CommandResult} result - Successful command.
 * @param {string} label - Assertion label.
 * @returns {Record<string, any>} - Parsed object.
 */
function parseCompleteJson(result, label) {
  assert.equal(result.status, 0, `${label} exited unsuccessfully`);
  const text = result.stdout.trim();
  assert.ok(text, `${label} emitted no JSON`);
  try {
    const value = JSON.parse(text);
    assert.ok(value && typeof value === 'object' && !Array.isArray(value));
    return value;
  } catch (error) {
    throw new Error(`${label} emitted invalid JSON.`, { cause: error });
  }
}

/**
 * Parse the final nonempty stdout line as JSON.
 * @param {CommandResult} result - Successful command.
 * @param {string} label - Assertion label.
 * @returns {Record<string, any>} - Parsed object.
 */
function parseFinalJson(result, label) {
  assert.equal(result.status, 0, `${label} exited unsuccessfully`);
  const finalLine = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  assert.ok(finalLine, `${label} emitted no JSON`);
  try {
    const value = JSON.parse(finalLine);
    assert.ok(value && typeof value === 'object' && !Array.isArray(value));
    return value;
  } catch (error) {
    throw new Error(`${label} emitted invalid final-line JSON.`, {
      cause: error,
    });
  }
}

/**
 * Atomically persist one proof receipt.
 * @param {string} filePath - Destination path.
 * @param {Record<string, any>} value - JSON-safe receipt.
 * @returns {void}
 */
function writeJsonAtomic(filePath, value) {
  const parent = path.dirname(filePath);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.tmp`;
  const handle = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  renameSync(temporary, filePath);
  const directory = openSync(parent, 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

/**
 * @param {number} duration - Delay in milliseconds.
 * @returns {Promise<void>}
 */
function wait(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

/**
 * Poll until one observation matches.
 * @template T
 * @param {() => T | Promise<T>} observe - Observation.
 * @param {(value: T) => boolean} matches - Success predicate.
 * @param {string} label - Timeout label.
 * @returns {Promise<T>} - Matching observation.
 */
async function waitFor(observe, matches, label) {
  const deadline = Date.now() + STATUS_TIMEOUT_MS;
  /** @type {T | undefined} */
  let last;
  /** @type {unknown} */
  let failure;
  while (Date.now() < deadline) {
    try {
      last = await observe();
      failure = undefined;
      if (matches(last)) return last;
    } catch (error) {
      failure = error;
    }
    await wait(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Timed out waiting for ${label}: ${JSON.stringify({
      last,
      failure: failure instanceof Error ? failure.message : failure,
    })}`,
  );
}

/**
 * @returns {NodeJS.ProcessEnv} - Packaged runtime environment without Node.
 */
function packagedEnvironment() {
  const uid = process.getuid?.();
  assert.ok(Number.isSafeInteger(uid) && Number(uid) > 0);
  return {
    HOME: homedir(),
    USER: process.env.USER,
    LOGNAME: process.env.LOGNAME || process.env.USER,
    XDG_DATA_HOME: path.join(homedir(), '.local', 'share'),
    XDG_RUNTIME_DIR: `/run/user/${uid}`,
    DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${uid}/bus`,
    LANG: 'C.UTF-8',
    PATH: '/usr/bin:/bin',
    TMPDIR: '/tmp',
  };
}

/**
 * @param {string} filePath - Existing file.
 * @returns {string} - SHA-256.
 */
function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * @returns {Readonly<Record<string, string>>} - Stable app-local paths.
 */
function storageLayout() {
  const dataRoot = path.join(homedir(), '.local', 'share', 'wharfie-nodejs');
  const appRoot = path.join(dataRoot, 'applications', APP_ID);
  return Object.freeze({
    appRoot,
    stateRoot: path.join(appRoot, 'state'),
    releasesRoot: path.join(appRoot, 'releases'),
    unitPath: path.join(homedir(), '.config', 'systemd', 'user', UNIT_NAME),
  });
}

/**
 * Execute a generated SEA.
 * @param {string} artifactPath - Executable.
 * @param {string[]} args - Application or operator argv.
 * @param {{allowFailure?: boolean, timeoutMs?: number}} [options] - Policy.
 * @returns {CommandResult} - Completed command.
 */
function runArtifact(artifactPath, args, options = {}) {
  return run(artifactPath, args, {
    cwd: PROOF_ROOT,
    env: packagedEnvironment(),
    allowFailure: options.allowFailure,
    timeoutMs: options.timeoutMs,
  });
}

/**
 * Execute one operator command.
 * @param {string} artifactPath - Executable.
 * @param {string[]} args - Operator argv.
 * @param {string} label - Assertion label.
 * @returns {Record<string, any>} - Parsed receipt.
 */
function runArtifactJson(artifactPath, args, label) {
  return parseFinalJson(runArtifact(artifactPath, args), label);
}

/**
 * @param {string} artifactPath - Executable.
 * @returns {Record<string, any>} - Service status.
 */
function readServiceStatus(artifactPath) {
  return runArtifactJson(
    artifactPath,
    ['wharfie', 'service', 'status', '--json'],
    'steady-file service status',
  );
}

/**
 * @param {string} artifactPath - Executable.
 * @param {string} runId - Run identity.
 * @returns {Record<string, any>} - Redacted run view.
 */
function inspectRun(artifactPath, runId) {
  return runArtifactJson(
    artifactPath,
    ['wharfie', 'inspect', '--run-id', runId, '--json'],
    'steady-file run inspection',
  );
}

/**
 * @param {string} artifactPath - Executable.
 * @returns {Record<string, any>} - App-scoped history.
 */
function listRuns(artifactPath) {
  return runArtifactJson(
    artifactPath,
    ['wharfie', 'list', '--limit', '10', '--json'],
    'steady-file run history',
  );
}

/**
 * @param {string} artifactPath - Executable.
 * @param {string} runId - Run identity.
 * @returns {Record<string, any>} - Confirmed output.
 */
function readOutput(artifactPath, runId) {
  return runArtifactJson(
    artifactPath,
    [
      'wharfie',
      'output',
      '--run-id',
      runId,
      '--confirm-sensitive-output',
      '--json',
    ],
    'steady-file logical output',
  );
}

/**
 * @param {Record<string, any>} value - Candidate decision.
 * @returns {void}
 */
function assertStableDecision(value) {
  const expectedBytes = statSync(INPUT_PATH).size;
  const expectedSha256 = sha256File(INPUT_PATH);
  assert.deepEqual(value, {
    path: INPUT_PATH,
    stable: true,
    baseline: {
      bytes: expectedBytes,
      sha256: expectedSha256,
      readStable: true,
    },
    current: {
      bytes: expectedBytes,
      sha256: expectedSha256,
      readStable: true,
    },
  });
}

/**
 * @param {Record<string, any>} reference - Candidate release reference.
 * @param {Record<string, any>} expected - Artifact evidence.
 * @param {string} label - Assertion label.
 * @returns {void}
 */
function assertReleaseReference(reference, expected, label) {
  assert.deepEqual(
    reference,
    {
      artifactId: expected.artifactId,
      revisionId: expected.revisionId,
    },
    label,
  );
}

/**
 * Assert one healthy selected release.
 * @param {Record<string, any>} status - Service status.
 * @param {Record<string, any>} current - Selected artifact.
 * @param {Record<string, any> | null} rollback - Rollback candidate.
 * @returns {Readonly<Record<string, any>>} - Bounded runtime evidence.
 */
function assertHealthy(status, current, rollback) {
  const storage = storageLayout();
  assert.equal(status.schemaVersion, 3);
  assert.equal(status.kind, 'wharfie.service.status');
  assert.equal(status.appId, APP_ID);
  assert.equal(status.unit, UNIT_NAME);
  assert.equal(status.health, 'healthy');
  assert.equal(status.persistence?.linger, true);
  assert.equal(status.persistence?.unitEnabled, true);
  assert.equal(status.persistence?.bootEnabled, true);
  assert.equal(status.systemd?.fragmentPath, storage.unitPath);
  assert.equal(status.systemd?.dropInPaths, '');
  assert.ok(status.systemd?.mainPid > 0);
  assert.equal(status.runtime?.processId, status.systemd.mainPid);
  assert.equal(status.runtime?.status, 'READY');
  assert.equal(status.runtime?.session, 'active');
  assert.equal(status.runtime?.currentOwner, true);
  assert.equal(status.integrity?.status, 'verified');
  assert.equal(status.installation?.activeArtifactId, current.artifactId);
  assert.equal(status.installation?.activeRevisionId, current.revisionId);
  assert.equal(
    status.installation?.previousArtifactId || null,
    rollback?.artifactId || null,
  );
  assert.equal(
    status.installation?.previousRevisionId || null,
    rollback?.revisionId || null,
  );
  assertReleaseReference(status.activation?.selected, current, 'selected');
  if (rollback) {
    assertReleaseReference(status.activation?.rollback, rollback, 'rollback');
  } else {
    assert.equal(status.activation?.rollback, null);
  }
  assert.equal(status.activation?.phase, 'ACTIVE');
  assert.equal(status.desiredConvergence?.disposition, 'authorized');
  assertReleaseReference(
    status.desiredConvergence?.desired,
    current,
    'desired artifact',
  );
  const releasePath = path.join(
    storage.releasesRoot,
    current.artifactId,
    'app',
  );
  assert.equal(sha256File(releasePath), current.sha256);
  assert.equal(
    readlinkSync(`/proc/${status.systemd.mainPid}/exe`),
    releasePath,
  );
  return Object.freeze({
    artifactId: current.artifactId,
    revisionId: current.revisionId,
    processId: status.systemd.mainPid,
    generation: status.runtime.generation,
    releasePath,
    releaseSha256: sha256File(releasePath),
  });
}

/**
 * Assert one update or rollback receipt.
 * @param {Record<string, any>} receipt - Public receipt.
 * @param {'update'|'rollback'} action - Action.
 * @param {Record<string, any>} current - Selected artifact.
 * @param {Record<string, any>} rollback - Rollback candidate.
 * @returns {void}
 */
function assertActivationReceipt(receipt, action, current, rollback) {
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.kind, 'wharfie.service.result');
  assert.equal(receipt.action, action);
  assert.equal(receipt.requestStatus, 'fulfilled');
  assert.equal(receipt.outcome, 'target-active');
  assert.equal(receipt.health, 'healthy');
  assert.equal(receipt.activeArtifactId, current.artifactId);
  assert.equal(receipt.activeRevisionId, current.revisionId);
  assert.equal(receipt.rollbackArtifactId, rollback.artifactId);
  assert.equal(receipt.rollbackRevisionId, rollback.revisionId);
}

/**
 * @param {Record<string, any>} page - History page.
 * @param {string} runId - Expected run.
 * @param {string} revisionId - Expected revision.
 * @param {string} status - Expected state.
 * @returns {Record<string, any>} - Matching row.
 */
function assertHistory(page, runId, revisionId, status) {
  assert.equal(page.schemaVersion, 1);
  assert.equal(page.kind, 'wharfie.execution-ledger.run-page');
  assert.equal(page.authority, 'none');
  assert.equal(page.authoritative, false);
  assert.deepEqual(page.integrity, { verified: true });
  assert.deepEqual(page.scope, { appId: APP_ID });
  assert.equal(page.nextCursor, null);
  assert.ok(Array.isArray(page.items));
  const row = page.items.find((item) => item.runId === runId);
  assert.ok(row, `history omitted ${runId}`);
  assert.equal(row.revisionId, revisionId);
  assert.equal(row.kind, 'workflow');
  assert.equal(row.status, status);
  return row;
}

/**
 * @param {Record<string, any>} output - Logical output receipt.
 * @param {string} runId - Expected run.
 * @param {string} revisionId - Expected revision.
 * @returns {void}
 */
function assertCompletedOutput(output, runId, revisionId) {
  assert.equal(output.schemaVersion, 1);
  assert.equal(output.kind, 'wharfie.execution-ledger.run-output');
  assert.equal(output.authority, 'none');
  assert.equal(output.authoritative, false);
  assert.equal(output.disclosure, 'application-sensitive-unredacted');
  assert.deepEqual(output.integrity, { verified: true });
  assert.deepEqual(output.scope, {
    appId: APP_ID,
    revisionId,
    runId,
  });
  assert.equal(output.snapshot?.runKind, 'workflow');
  assert.equal(output.snapshot?.status, 'COMPLETED');
  assert.deepEqual(
    output.outputs?.map((entry) => entry.stepId),
    ['baseline', 'stability-window', 'comparison'],
  );
  assertStableDecision(output.outputs.at(-1)?.value);
  assert.deepEqual(output.terminal, {
    type: 'completed',
    result: output.outputs.at(-1).value,
  });
}

/**
 * @param {PackagedArtifact} packaged - Package result.
 * @returns {Readonly<Record<string, any>>} - Durable artifact evidence.
 */
function createArtifactEvidence(packaged) {
  return Object.freeze({
    artifactPath: packaged.artifactPath,
    artifactId: packaged.artifact.artifactId,
    revisionId: packaged.revisionId,
    byteDigest: packaged.artifact.byteDigest,
    size: packaged.artifact.size,
    target: packaged.artifact.target,
    sha256: sha256File(packaged.artifactPath),
  });
}

/**
 * Package the exact golden app and one proof-only 500 ms evolution from the
 * installed repository tarball.
 * @param {string} repoRoot - Extracted committed repository.
 * @returns {{source: PackagedArtifact, target: PackagedArtifact, package: Readonly<Record<string, any>>, sourceTree: Readonly<Record<string, string>>, targetMutation: Readonly<Record<string, string>>}} - Package evidence.
 */
function packageSteadyFileArtifacts(repoRoot) {
  const authoredRoot = path.join(
    repoRoot,
    'scratch',
    'examples',
    'apps',
    'steady-file',
  );
  const consumerRoot = path.join(PROOF_ROOT, 'package-consumer');
  const sourceRoot = path.join(consumerRoot, 'app-source');
  const targetRoot = path.join(consumerRoot, 'app-target');
  const target = `linux/${process.arch}/glibc`;
  mkdirSync(consumerRoot, { recursive: true, mode: 0o700 });
  writeFileSync(
    path.join(consumerRoot, 'package.json'),
    `${JSON.stringify({
      name: 'wharfie-steady-file-systemd-proof',
      private: true,
      version: '0.0.0',
      type: 'module',
    })}\n`,
  );
  cpSync(authoredRoot, sourceRoot, { recursive: true });
  cpSync(authoredRoot, targetRoot, { recursive: true });

  /** @type {Record<string, string>} */
  const sourceTree = {};
  for (const relativePath of SOURCE_FILES) {
    const authoredPath = path.join(authoredRoot, relativePath);
    const copiedPath = path.join(sourceRoot, relativePath);
    assert.equal(sha256File(copiedPath), sha256File(authoredPath));
    sourceTree[relativePath] = sha256File(authoredPath);
  }

  const mutationPath = path.join(targetRoot, 'file-stability.js');
  const beforeMutation = readFileSync(mutationPath, 'utf8');
  assert.equal(
    beforeMutation.split(TARGET_WINDOW_FROM).length,
    2,
    'steady-file window must occur exactly once',
  );
  const afterMutation = beforeMutation.replace(
    TARGET_WINDOW_FROM,
    TARGET_WINDOW_TO,
  );
  writeFileSync(mutationPath, afterMutation);
  const targetMutation = Object.freeze({
    path: 'file-stability.js',
    from: TARGET_WINDOW_FROM,
    to: TARGET_WINDOW_TO,
    beforeSha256: createHash('sha256').update(beforeMutation).digest('hex'),
    afterSha256: createHash('sha256').update(afterMutation).digest('hex'),
  });

  const packaged = createPackageTarball();
  /** @type {PackagedArtifact | undefined} */
  let source;
  /** @type {PackagedArtifact | undefined} */
  let evolved;
  let packageEvidence;

  /**
   * @param {string} fixtureRoot - App directory.
   * @param {string} label - Stable release label.
   * @returns {PackagedArtifact} - Verified artifact.
   */
  function build(fixtureRoot, label) {
    const outputDirectory = path.join(PROOF_ROOT, 'dist', label);
    const wharfieBin = path.join(
      consumerRoot,
      'node_modules',
      '.bin',
      'wharfie',
    );
    const command = run(
      process.execPath,
      [
        wharfieBin,
        'app',
        'package',
        fixtureRoot,
        '--output-dir',
        outputDirectory,
        '--target',
        target,
        '--no-pretty',
      ],
      { cwd: consumerRoot, env: process.env, timeoutMs: 600_000 },
    );
    const receipt = parseApplicationPackageReceiptOutput(
      command.stdout,
      `steady-file ${label} package`,
    );
    assert.equal(receipt.appId, APP_ID);
    assert.equal(receipt.artifacts.length, 1);
    const artifact = receipt.artifacts[0];
    assert.equal(artifact.target.platform, 'linux');
    assert.equal(artifact.target.architecture, process.arch);
    assert.equal(artifact.target.libc, 'glibc');
    assert.equal(artifact.target.nodeVersion, process.versions.node);
    assert.equal(existsSync(artifact.path), true);
    assert.equal((statSync(artifact.path).mode & 0o111) !== 0, true);
    const authority = verifyPackageSeaArtifactHandoff({
      receipt,
      artifactBytes: readFileSync(artifact.path),
      artifactRecord: readJson(artifact.recordPath),
      embeddedManifest: runArtifactJson(
        artifact.path,
        ['wharfie', 'manifest', '--no-pretty'],
        `${label} manifest`,
      ),
      embeddedMetadata: runArtifactJson(
        artifact.path,
        ['wharfie', 'metadata', '--no-pretty'],
        `${label} metadata`,
      ),
    });
    assert.equal(authority.revision.revisionId, receipt.revisionId);
    return {
      artifactPath: artifact.path,
      artifact,
      revisionId: authority.revision.revisionId,
    };
  }

  try {
    run(
      path.join(path.dirname(process.execPath), 'npm'),
      ['install', '--no-audit', '--no-fund', packaged.tarballPath],
      {
        cwd: consumerRoot,
        env: {
          ...process.env,
          npm_config_cache: path.join(PROOF_ROOT, 'npm-cache'),
        },
        timeoutMs: 600_000,
      },
    );
    const installedMetadata = readJson(
      path.join(
        consumerRoot,
        'node_modules',
        '@wharfie',
        'wharfie',
        'package.json',
      ),
    );
    packageEvidence = Object.freeze({
      name: installedMetadata.name,
      version: installedMetadata.version,
      tarballSha256: sha256File(packaged.tarballPath),
      packedFileCount: packaged.manifest.files.length,
    });
    source = build(sourceRoot, 'source');
    evolved = build(targetRoot, 'target');
  } finally {
    packaged.cleanup();
  }

  assert.ok(source);
  assert.ok(evolved);
  assert.ok(packageEvidence);
  assert.notEqual(source.revisionId, evolved.revisionId);
  assert.notEqual(source.artifact.artifactId, evolved.artifact.artifactId);
  return {
    source,
    target: evolved,
    package: packageEvidence,
    sourceTree: Object.freeze(sourceTree),
    targetMutation,
  };
}

/**
 * Require the destructive proof's exact disposable environment.
 * @returns {void}
 */
function assertProofEnvironment() {
  assert.equal(process.platform, 'linux');
  assert.ok((process.getuid?.() || 0) > 0, 'proof must run as non-root');
  assert.equal(process.versions.node, '24.13.1');
  assert.equal(
    process.env.WHARFIE_SYSTEMD_PROOF_DISPOSABLE,
    'lima',
    'refusing to mutate a host without disposable Lima attestation',
  );
  assert.match(process.env.WHARFIE_SYSTEMD_PROOF_COMMIT, /^[0-9a-f]{40}$/);
}

/**
 * Run ordinary behavior, package A/B, submit work, install the service, and
 * then leave rediscovery and inspection to a later verifier process.
 * @param {string} repoRoot - Extracted committed repository.
 * @returns {Promise<Record<string, any>>} - Preparation receipt.
 */
async function prepare(repoRoot) {
  assertProofEnvironment();
  process.env.PATH = [path.dirname(process.execPath), process.env.PATH]
    .filter(Boolean)
    .join(path.delimiter);
  rmSync(PROOF_ROOT, { recursive: true, force: true });
  mkdirSync(PROOF_ROOT, { recursive: true, mode: 0o700 });
  writeFileSync(INPUT_PATH, INPUT_BYTES, { mode: 0o600 });

  const sourceLocal = parseCompleteJson(
    run(
      process.execPath,
      [
        path.join(
          repoRoot,
          'scratch',
          'examples',
          'apps',
          'steady-file',
          'local.js',
        ),
        INPUT_PATH,
      ],
      { cwd: repoRoot, env: process.env },
    ),
    'source steady-file CLI',
  );
  assertStableDecision(sourceLocal);

  const nodeProbe = run('/usr/bin/env', ['node', '--version'], {
    env: packagedEnvironment(),
    allowFailure: true,
  });
  assert.notEqual(
    nodeProbe.status,
    0,
    'packaged PATH unexpectedly exposes Node',
  );

  const packaged = packageSteadyFileArtifacts(repoRoot);
  const source = createArtifactEvidence(packaged.source);
  const target = createArtifactEvidence(packaged.target);
  const sourcePackaged = parseCompleteJson(
    runArtifact(packaged.source.artifactPath, [INPUT_PATH]),
    'source packaged steady-file CLI',
  );
  const targetPackaged = parseCompleteJson(
    runArtifact(packaged.target.artifactPath, [INPUT_PATH]),
    'target packaged steady-file CLI',
  );
  assertStableDecision(sourcePackaged);
  assertStableDecision(targetPackaged);
  assert.deepEqual(sourcePackaged, sourceLocal);
  assert.deepEqual(targetPackaged, sourceLocal);

  const absentBeforeStart = readServiceStatus(packaged.source.artifactPath);
  assert.equal(absentBeforeStart.appId, APP_ID);
  assert.equal(absentBeforeStart.unit, UNIT_NAME);
  assert.equal(absentBeforeStart.health, 'absent');

  const started = runArtifactJson(
    packaged.source.artifactPath,
    ['wharfie', 'start', '--json', '--', INPUT_PATH],
    'default durable steady-file start',
  );
  assert.equal(started.schemaVersion, 1);
  assert.equal(started.kind, 'wharfie.execution-ledger.workflow-start');
  assert.equal(started.appId, APP_ID);
  assert.equal(started.revisionId, source.revisionId);
  assert.equal(started.workflowId, WORKFLOW_ID);
  assert.equal(started.reused, false);
  assert.equal(started.runStatus, 'RUNNING');
  assert.equal(started.cursor?.disposition, 'ACTIVITY_RUNNABLE');
  assert.equal(started.cursor?.stepId, 'baseline');
  assert.equal(started.cursor?.stepIndex, 0);
  assert.match(started.runId, /^wfr_[A-Za-z0-9_-]{43}$/);
  assert.match(
    started.idempotencyKey,
    /^manual-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );

  const pending = inspectRun(packaged.source.artifactPath, started.runId);
  assert.equal(pending.run?.status, 'RUNNING');
  assert.equal(pending.workflowCursor?.disposition, 'ACTIVITY_RUNNABLE');
  const pendingHistory = listRuns(packaged.source.artifactPath);
  assertHistory(pendingHistory, started.runId, source.revisionId, 'RUNNING');
  const absentAfterStart = readServiceStatus(packaged.source.artifactPath);
  assert.equal(absentAfterStart.health, 'absent');
  const install = runArtifactJson(
    packaged.source.artifactPath,
    ['wharfie', 'service', 'install', '--json'],
    'steady-file service install',
  );
  assert.equal(install.schemaVersion, 1);
  assert.equal(install.kind, 'wharfie.service.result');
  assert.equal(install.action, 'install');
  assert.equal(install.requestStatus, 'fulfilled');
  assert.equal(install.outcome, 'target-active');
  assert.equal(install.health, 'healthy');
  assert.equal(install.activeArtifactId, source.artifactId);
  assert.equal(install.activeRevisionId, source.revisionId);
  const installedStatus = readServiceStatus(packaged.source.artifactPath);
  const installed = assertHealthy(installedStatus, source, null);

  const receipt = {
    schemaVersion: 1,
    kind: 'wharfie.steady-file-systemd-proof.prepare',
    commit: process.env.WHARFIE_SYSTEMD_PROOF_COMMIT,
    preparedAt: Date.now(),
    verifierProcessId: process.pid,
    appId: APP_ID,
    workflowId: WORKFLOW_ID,
    input: {
      path: INPUT_PATH,
      bytes: statSync(INPUT_PATH).size,
      sha256: sha256File(INPUT_PATH),
    },
    package: packaged.package,
    artifacts: { source, target },
    authoredSourceFiles: packaged.sourceTree,
    targetMutation: packaged.targetMutation,
    toolchain: {
      node: process.versions.node,
      npm: run(path.join(path.dirname(process.execPath), 'npm'), [
        '--version',
      ]).stdout.trim(),
    },
    ordinary: {
      source: sourceLocal,
      packagedSource: sourcePackaged,
      packagedTarget: targetPackaged,
      nodeAbsentFromPackagedPath: true,
    },
    start: started,
    pending,
    pendingHistory,
    service: {
      beforeStart: absentBeforeStart,
      afterStart: absentAfterStart,
      install,
      installed,
    },
  };
  writeJsonAtomic(PREPARE_PATH, receipt);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  return receipt;
}

/**
 * @returns {Readonly<Record<string, any>>} - Independent unit absence.
 */
function readIndependentSystemdAbsence() {
  const expectedProperties = [
    'LoadState',
    'UnitFileState',
    'ActiveState',
    'SubState',
    'MainPID',
    'FragmentPath',
    'DropInPaths',
  ];
  const args = ['--user', 'show', UNIT_NAME, '--no-pager'];
  for (const property of expectedProperties) {
    args.push(`--property=${property}`);
  }
  const show = run('/usr/bin/systemctl', args, {
    env: packagedEnvironment(),
    allowFailure: true,
  });
  assert.equal(show.status, 0, show.stderr || show.stdout);
  /** @type {Record<string, string>} */
  const properties = {};
  for (const line of show.stdout.trim().split('\n').filter(Boolean)) {
    const separator = line.indexOf('=');
    assert.ok(separator > 0);
    const key = line.slice(0, separator);
    assert.ok(expectedProperties.includes(key));
    assert.equal(Object.hasOwn(properties, key), false);
    properties[key] = line.slice(separator + 1);
  }
  assert.deepEqual(
    Object.keys(properties).sort(),
    [...expectedProperties].sort(),
  );
  const active = run('/usr/bin/systemctl', ['--user', 'is-active', UNIT_NAME], {
    env: packagedEnvironment(),
    allowFailure: true,
  });
  const enabled = run(
    '/usr/bin/systemctl',
    ['--user', 'is-enabled', UNIT_NAME],
    { env: packagedEnvironment(), allowFailure: true },
  );
  assert.equal(properties.MainPID, '0');
  assert.equal(properties.LoadState, 'not-found');
  assert.equal(properties.ActiveState, 'inactive');
  assert.equal(properties.SubState, 'dead');
  assert.equal(properties.FragmentPath, '');
  assert.equal(properties.DropInPaths, '');
  assert.ok(['', 'disabled', 'not-found'].includes(properties.UnitFileState));
  assert.notEqual(active.status, 0);
  assert.notEqual(enabled.status, 0);
  assert.equal(
    existsSync(
      path.join(
        homedir(),
        '.config',
        'systemd',
        'user',
        'default.target.wants',
        UNIT_NAME,
      ),
    ),
    false,
  );
  return Object.freeze({
    show: properties,
    isActive: { status: active.status, output: active.stdout.trim() },
    isEnabled: { status: enabled.status, output: enabled.stdout.trim() },
  });
}

/**
 * Rediscover the installed service from a later process, read the completed
 * run, evolve, roll back, and uninstall while retaining verified reads.
 * @returns {Promise<Record<string, any>>} - Final receipt.
 */
async function verify() {
  assertProofEnvironment();
  const prepared = JSON.parse(readFileSync(PREPARE_PATH, 'utf8'));
  assert.equal(prepared.kind, 'wharfie.steady-file-systemd-proof.prepare');
  assert.equal(prepared.schemaVersion, 1);
  assert.equal(prepared.commit, process.env.WHARFIE_SYSTEMD_PROOF_COMMIT);
  assert.notEqual(prepared.verifierProcessId, process.pid);
  assert.equal(sha256File(INPUT_PATH), prepared.input.sha256);
  assert.equal(statSync(INPUT_PATH).size, prepared.input.bytes);
  for (const artifact of Object.values(prepared.artifacts)) {
    assert.equal(sha256File(artifact.artifactPath), artifact.sha256);
  }

  const source = prepared.artifacts.source;
  const target = prepared.artifacts.target;
  const runId = prepared.start.runId;
  const installedStatus = readServiceStatus(source.artifactPath);
  const installed = assertHealthy(installedStatus, source, null);
  assert.equal(installed.processId, prepared.service.installed.processId);
  assert.equal(installed.generation, prepared.service.installed.generation);

  const completed = await waitFor(
    () => inspectRun(source.artifactPath, runId),
    (view) =>
      view.run?.status === 'COMPLETED' &&
      view.workflowCursor?.disposition === 'COMPLETED',
    'steady-file workflow completion',
  );
  assert.equal(completed.timers?.length, 1);
  assert.equal(completed.timers[0].status, 'FIRED');
  assert.equal(
    completed.timers[0].dueAt - completed.timers[0].scheduledAt,
    250,
  );
  const history = listRuns(source.artifactPath);
  const historyItem = assertHistory(
    history,
    runId,
    source.revisionId,
    'COMPLETED',
  );
  const output = readOutput(source.artifactPath, runId);
  assertCompletedOutput(output, runId, source.revisionId);
  assert.deepEqual(output.terminal?.result, prepared.ordinary.source);

  const update = runArtifactJson(
    target.artifactPath,
    ['wharfie', 'service', 'update', '--json'],
    'steady-file service update',
  );
  assertActivationReceipt(update, 'update', target, source);
  const targetStatus = readServiceStatus(target.artifactPath);
  const targetActive = assertHealthy(targetStatus, target, source);
  assert.deepEqual(inspectRun(target.artifactPath, runId), completed);
  assert.deepEqual(listRuns(target.artifactPath), history);
  assert.deepEqual(readOutput(target.artifactPath, runId), output);

  const rollback = runArtifactJson(
    target.artifactPath,
    ['wharfie', 'service', 'rollback', '--json'],
    'steady-file service rollback',
  );
  assertActivationReceipt(rollback, 'rollback', source, target);
  const sourceStatus = readServiceStatus(source.artifactPath);
  const sourceRestored = assertHealthy(sourceStatus, source, target);
  assert.deepEqual(inspectRun(source.artifactPath, runId), completed);
  assert.deepEqual(listRuns(source.artifactPath), history);
  assert.deepEqual(readOutput(source.artifactPath, runId), output);

  const uninstall = runArtifactJson(
    source.artifactPath,
    ['wharfie', 'service', 'uninstall', '--json'],
    'steady-file service uninstall',
  );
  assert.equal(uninstall.schemaVersion, 1);
  assert.equal(uninstall.kind, 'wharfie.service.result');
  assert.equal(uninstall.action, 'uninstall');
  assert.equal(uninstall.outcome, 'uninstalled');
  assert.equal(uninstall.health, 'absent');
  assert.equal(existsSync(uninstall.preserved?.state), true);
  assert.equal(existsSync(uninstall.preserved?.releases), true);
  const absentStatus = readServiceStatus(source.artifactPath);
  assert.equal(absentStatus.health, 'absent');
  assert.equal(absentStatus.installation?.state, 'uninstalled');
  assert.equal(existsSync(storageLayout().unitPath), false);
  const independentSystemd = readIndependentSystemdAbsence();
  const inspectAfterUninstall = inspectRun(source.artifactPath, runId);
  const historyAfterUninstall = listRuns(source.artifactPath);
  const outputAfterUninstall = readOutput(source.artifactPath, runId);
  assert.deepEqual(inspectAfterUninstall, completed);
  assert.deepEqual(historyAfterUninstall, history);
  assert.deepEqual(outputAfterUninstall, output);

  const prune = runArtifactJson(
    source.artifactPath,
    ['wharfie', 'service', 'prune', '--json'],
    'steady-file retained release prune',
  );
  assert.equal(prune.kind, 'wharfie.service.release-prune');
  assert.equal(prune.requestStatus, 'fulfilled');
  assert.equal(prune.installationState, 'uninstalled');
  assert.equal(prune.scannedReleaseCount, 2);
  assert.equal(prune.retainedReleaseCount, 2);
  assert.equal(prune.removedCount, 0);

  const receipt = {
    schemaVersion: 1,
    kind: 'wharfie.steady-file-systemd-proof.complete',
    commit: prepared.commit,
    completedAt: Date.now(),
    appId: APP_ID,
    workflowId: WORKFLOW_ID,
    processBoundary: {
      prepareProcessId: prepared.verifierProcessId,
      verifyProcessId: process.pid,
      distinct: true,
    },
    input: prepared.input,
    package: prepared.package,
    artifacts: prepared.artifacts,
    authoredSourceFiles: prepared.authoredSourceFiles,
    targetMutation: prepared.targetMutation,
    toolchain: prepared.toolchain,
    ordinary: prepared.ordinary,
    start: prepared.start,
    service: {
      install: prepared.service.install,
      installed,
      update: {
        receipt: update,
        active: targetActive,
      },
      rollback: {
        invokedThroughArtifactId: target.artifactId,
        receipt: rollback,
        active: sourceRestored,
      },
      uninstall: {
        receipt: uninstall,
        status: absentStatus,
        systemd: independentSystemd,
        stateRetainedUntilHostCleanup: true,
      },
      prune,
    },
    run: {
      runId,
      completed,
      history,
      historyItem,
      output,
      readsPreservedAcrossUpdate: true,
      readsPreservedAcrossRollback: true,
      readsPreservedAfterUninstall: true,
    },
  };
  writeJsonAtomic(FINAL_PATH, receipt);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  return receipt;
}

const phase = process.argv[2];
const repoRoot = path.resolve(process.argv[3] || process.cwd());
if (phase === 'prepare') {
  await prepare(repoRoot);
} else if (phase === 'verify') {
  await verify();
} else {
  throw new Error(
    'Usage: verify-steady-file-systemd-linux.js <prepare|verify> [repo-root]',
  );
}
