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

import { createPackageTarball, readJson } from './package-verification.js';
import {
  attachSeaInspector,
  spawnInspectorPausedProcess,
} from './sea-inspector.js';
import { createControlDBClient } from '../src/core/lib/config/db.js';
import {
  LocalApplicationActivationPhase,
  createLocalApplicationActivation,
} from '../src/core/lib/db/tables/local-application-activation.js';
import { LOCAL_APP_EXECUTION_LEDGER_TABLE } from '../src/core/runtime/local-app-storage.js';

/** @typedef {ReturnType<typeof spawnInspectorPausedProcess>} InspectedCommand */
/**
 * @typedef SeaInspector
 * @property {(name: string, target: {sourceSuffix: string, anchor: string, occurrence?: number, expectedSourceContent?: string}) => Promise<Record<string, any>>} setSourceBreakpoint - Install an exact source-mapped breakpoint.
 * @property {() => Promise<void>} resume - Resume the debuggee.
 * @property {() => Promise<Record<string, any>>} waitForPause - Await the next debugger pause.
 * @property {() => void} close - Close the inspector session.
 */

const APP_ID = 'systemd-service-proof';
const WORKFLOW_ID = 'reboot-chain';
const SIGNAL_ID = 'resume-after-reboot';
const UNIT_NAME = `wharfie-${APP_ID}.service`;
const BOOT_CHECK_UNIT = 'wharfie-systemd-proof-boot-check.service';
const PROOF_ROOT =
  process.env.WHARFIE_SYSTEMD_PROOF_ROOT || '/var/tmp/wharfie-systemd-proof';
const PREPARE_PATH = path.join(PROOF_ROOT, 'prepare.json');
const FINAL_PATH = path.join(PROOF_ROOT, 'final.json');
const FAILURE_PATH = path.join(PROOF_ROOT, 'failure.json');
const MARKER_PATH = path.join(PROOF_ROOT, 'activity-entries.jsonl');
const BOOT_RECEIPT_PATH = '/var/lib/wharfie-systemd-proof/boot-receipt.json';
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const STATUS_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 250;
const EXPECTED_TIMER_DELAY_MS = 180_000;
const CHILD_EXIT_TIMEOUT_MS = 30_000;
const ACTIVATION_STORE_WRITE_BREAKPOINT = Object.freeze({
  sourceSuffix: 'src/core/lib/db/tables/local-application-activation.js',
  anchor: 'return { applied: true, activation: toSnapshot(record) };',
  occurrence: 1,
});
const ACTIVATION_FORWARD_CRASH_BOUNDARIES = Object.freeze(
  [
    LocalApplicationActivationPhase.QUIESCING,
    LocalApplicationActivationPhase.QUIESCENT,
    LocalApplicationActivationPhase.SELECTED,
    LocalApplicationActivationPhase.ACTIVATING,
    LocalApplicationActivationPhase.ACTIVE,
  ].map((phase, index) => Object.freeze({ writeNumber: index + 1, phase })),
);
const ACTIVATION_RESTORE_CRASH_BOUNDARIES = Object.freeze(
  [
    LocalApplicationActivationPhase.QUIESCING,
    LocalApplicationActivationPhase.QUIESCENT,
    LocalApplicationActivationPhase.SELECTED,
    LocalApplicationActivationPhase.ACTIVATING,
    LocalApplicationActivationPhase.ACTIVE,
  ].map((phase, index) => Object.freeze({ writeNumber: index + 5, phase })),
);
const FAILING_RESIDENT_SOURCE_SUFFIX =
  'src/core/runtime/services/ledger-service-command.js';
const FAILING_RESIDENT_CODE =
  "if (process.env.WHARFIE_RUNTIME_COMMAND === 'ledger-service') process.exit(0);";
const FAILING_RESIDENT_INJECTION = [
  '',
  '// Disposable systemd proof fault: a selected target exits cleanly before READY.',
  FAILING_RESIDENT_CODE,
  '',
].join('\n');

/**
 * @typedef CommandResult
 * @property {number} status - Exit status.
 * @property {string} stdout - Standard output.
 * @property {string} stderr - Standard error.
 */

/**
 * @typedef ProofPackageArtifact
 * @property {string} artifactPath - Packaged SEA path.
 * @property {Record<string, any>} artifact - Package artifact receipt.
 * @property {Record<string, any>} revision - Embedded revision receipt.
 */

/**
 * Run one exact command without a shell.
 * @param {string} command - Executable path.
 * @param {string[]} args - Exact argv.
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv, allowFailure?: boolean, timeoutMs?: number}} [options] - Process options.
 * @returns {CommandResult} - Completed result.
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
 * Parse the last nonempty stdout line as JSON.
 * @param {CommandResult} result - Successful command result.
 * @param {string} label - Boundary label.
 * @returns {Record<string, any>} - Parsed object.
 */
function parseJsonOutput(result, label) {
  const text = result.stdout.trim();
  assert.ok(text, `${label} emitted no JSON`);
  const finalLine = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  let value;
  try {
    value = JSON.parse(finalLine);
  } catch (error) {
    throw new Error(
      `${label} emitted invalid final JSON line: ${String(finalLine).slice(0, 1024)}`,
      { cause: error },
    );
  }
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value;
}

/**
 * Parse one successful command's final JSON line.
 * @param {CommandResult} result - Successful command result.
 * @param {string} label - Boundary label.
 * @returns {Record<string, any>} - Parsed object.
 */
function parseJsonResult(result, label) {
  assert.equal(result.status, 0, `${label} exited unsuccessfully`);
  return parseJsonOutput(result, label);
}

/**
 * Persist one JSON receipt atomically with file and parent synchronization.
 * @param {string} filePath - Destination.
 * @param {Record<string, any>} value - Receipt.
 * @returns {void} - Returns after durable publication.
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
 * @param {number} duration - Milliseconds.
 * @returns {Promise<void>} - Resolves after the delay.
 */
function wait(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

/**
 * Publish a non-sensitive phase marker so a host/VM transport failure can be
 * distinguished from an assertion inside the disposable proof.
 * @param {string} phase - Stable proof phase.
 * @returns {void} - Returns after writing the marker.
 */
function announce(phase) {
  process.stderr.write(`[wharfie-systemd-proof] ${phase}\n`);
}

/**
 * Poll one async observation until its predicate matches.
 * @param {() => Promise<any> | any} observe - Observation callback.
 * @param {(value: any) => boolean} matches - Success predicate.
 * @param {string} label - Timeout label.
 * @param {number} [timeoutMs] - Bound.
 * @returns {Promise<any>} - Matching observation.
 */
async function waitFor(observe, matches, label, timeoutMs = STATUS_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last;
  let error;
  while (Date.now() < deadline) {
    try {
      last = await observe();
      error = undefined;
      if (matches(last)) return last;
    } catch (caught) {
      error = caught;
    }
    await wait(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Timed out waiting for ${label}: ${JSON.stringify({
      last,
      error: error instanceof Error ? error.message : error,
    })}`,
  );
}

/**
 * Build an environment that exposes required OS commands but no Node binary
 * or caller-provided Wharfie path redirection to the packaged artifact.
 * @returns {NodeJS.ProcessEnv} - Sanitized packaged environment.
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
 * @param {string} filePath - Concrete file.
 * @returns {string} - Lowercase SHA-256 digest.
 */
function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * @returns {Readonly<Record<string, string>>} - Expected packaged app layout.
 */
function proofStorageLayout() {
  const dataRoot = path.join(homedir(), '.local', 'share', 'wharfie-nodejs');
  const appRoot = path.join(dataRoot, 'applications', APP_ID);
  const stateRoot = path.join(appRoot, 'state');
  const controlPath = path.join(stateRoot, 'control');
  return Object.freeze({
    dataRoot,
    appRoot,
    stateRoot,
    controlPath,
    payloadPath: path.join(controlPath, 'execution-payloads'),
    applicationStatePath: path.join(stateRoot, 'application-state'),
    releasesRoot: path.join(appRoot, 'releases'),
    currentLink: path.join(appRoot, 'current'),
    installationPath: path.join(appRoot, 'installation.json'),
    unitPath: path.join(homedir(), '.config', 'systemd', 'user', UNIT_NAME),
  });
}

/**
 * Execute one packaged Wharfie command.
 * @param {string} artifactPath - SEA path.
 * @param {string[]} args - Arguments after the executable.
 * @param {{allowFailure?: boolean}} [options] - Failure policy.
 * @returns {CommandResult} - Process result.
 */
function runArtifact(artifactPath, args, options = {}) {
  return run(artifactPath, args, {
    cwd: PROOF_ROOT,
    env: packagedEnvironment(),
    allowFailure: options.allowFailure,
  });
}

/**
 * Execute one packaged command and parse its JSON object.
 * @param {string} artifactPath - SEA path.
 * @param {string[]} args - Arguments.
 * @param {string} label - Boundary label.
 * @returns {Record<string, any>} - Parsed result.
 */
function runArtifactJson(artifactPath, args, label) {
  return parseJsonResult(runArtifact(artifactPath, args), label);
}

/**
 * @param {string} artifactPath - SEA path.
 * @returns {Record<string, any>} - Packaged service status.
 */
function readServiceStatus(artifactPath) {
  return runArtifactJson(
    artifactPath,
    ['wharfie', 'service', 'status', '--json'],
    'service status',
  );
}

/**
 * Capture the exact user-manager and packaged observations needed to diagnose
 * a failed real-host phase before the disposable VM is removed.
 * @param {string} artifactPath - Packaged SEA path.
 * @param {string} phase - Failed proof phase.
 * @param {unknown} error - Original failure.
 * @returns {Record<string, any>} - Persisted diagnostic receipt.
 */
function captureServiceFailure(artifactPath, phase, error) {
  /**
   * @param {CommandResult} result - Captured command result.
   * @returns {Record<string, any>} - Redacted command evidence.
   */
  const commandReceipt = (result) => ({
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  const receipt = {
    schemaVersion: 1,
    kind: 'wharfie.systemd-proof.failure',
    phase,
    error: error instanceof Error ? error.message : String(error),
    packagedStatus: commandReceipt(
      runArtifact(artifactPath, ['wharfie', 'service', 'status', '--json'], {
        allowFailure: true,
      }),
    ),
    systemdStatus: commandReceipt(
      run(
        '/usr/bin/systemctl',
        [
          '--user',
          'show',
          UNIT_NAME,
          '--no-pager',
          '--property=LoadState,UnitFileState,ActiveState,SubState,Result,MainPID,ExecMainStatus,FragmentPath,DropInPaths',
        ],
        { allowFailure: true },
      ),
    ),
    effectiveUnit: commandReceipt(
      run('/usr/bin/systemctl', ['--user', 'cat', UNIT_NAME, '--no-pager'], {
        allowFailure: true,
      }),
    ),
    unitVerification: commandReceipt(
      run(
        '/usr/bin/systemd-analyze',
        ['--user', 'verify', proofStorageLayout().unitPath],
        { env: packagedEnvironment(), allowFailure: true },
      ),
    ),
    userJournal: commandReceipt(
      run(
        '/usr/bin/journalctl',
        [
          '--user',
          '--boot=0',
          '--unit',
          UNIT_NAME,
          '--lines=200',
          '--no-pager',
        ],
        { allowFailure: true },
      ),
    ),
  };
  writeJsonAtomic(FAILURE_PATH, receipt);
  process.stderr.write(
    `Wharfie systemd proof diagnostics:\n${JSON.stringify(receipt, null, 2)}\n`,
  );
  return receipt;
}

/**
 * @param {string} artifactPath - SEA path.
 * @param {string} runId - Durable run ID.
 * @returns {Record<string, any>} - Redacted run view.
 */
function inspectRun(artifactPath, runId) {
  return runArtifactJson(
    artifactPath,
    ['wharfie', 'inspect', '--run-id', runId, '--json'],
    'workflow inspection',
  );
}

/**
 * Read synchronized physical activity entries.
 * @returns {Record<string, any>[]} - Marker rows.
 */
function readMarkers() {
  if (!existsSync(MARKER_PATH)) return [];
  return readFileSync(MARKER_PATH, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * @returns {string} - Current Linux boot ID.
 */
function readBootId() {
  return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
}

/**
 * Build distinct source, healthy-target, and resident-failing-target SEAs from
 * one installed Wharfie tarball. All three keep the same application identity
 * and target while embedding different immutable revisions.
 * @param {string} repoRoot - Extracted repository root.
 * @returns {{source: ProofPackageArtifact, target: ProofPackageArtifact, failingTarget: ProofPackageArtifact, installedPackageRoot: string, faultInjection: Readonly<Record<string, any>>, package: Readonly<Record<string, any>>}} - Package results.
 */
function packageProofArtifacts(repoRoot) {
  const sourceFixture = path.join(
    repoRoot,
    'test',
    'fixtures',
    'apps',
    'systemd-service',
  );
  const consumerRoot = path.join(PROOF_ROOT, 'package-consumer');
  const target = `linux/${process.arch}/glibc`;
  mkdirSync(consumerRoot, { recursive: true, mode: 0o700 });
  writeFileSync(
    path.join(consumerRoot, 'package.json'),
    `${JSON.stringify({
      name: 'wharfie-systemd-proof-consumer',
      private: true,
      version: '0.0.0',
      type: 'module',
    })}\n`,
  );
  const packaged = createPackageTarball();
  /** @type {ProofPackageArtifact | undefined} */
  let source;
  /** @type {ProofPackageArtifact | undefined} */
  let healthyTarget;
  /** @type {ProofPackageArtifact | undefined} */
  let failingTarget;
  let installedPackageRoot;
  let faultInjection;
  let packageEvidence;

  /**
   * Package one fixture variant after the installed consumer exists.
   * @param {string} label - Stable release label.
   * @returns {ProofPackageArtifact} - Exact artifact.
   */
  function buildFixture(label) {
    const fixture = path.join(consumerRoot, `app-${label}`);
    const outputDirectory = path.join(PROOF_ROOT, 'dist', label);
    cpSync(sourceFixture, fixture, { recursive: true });
    const fixtureManifestPath = path.join(fixture, 'wharfie.app.js');
    const fixtureManifest = readFileSync(fixtureManifestPath, 'utf8');
    const installedFixtureManifest = fixtureManifest.replace(
      '../../../../src/app.js',
      '@wharfie/wharfie/app',
    );
    assert.notEqual(installedFixtureManifest, fixtureManifest);
    writeFileSync(fixtureManifestPath, installedFixtureManifest);
    const activityPath = path.join(fixture, 'activity.js');
    writeFileSync(
      activityPath,
      `${readFileSync(activityPath, 'utf8').trimEnd()}\n\nexport const systemdProofRelease = ${JSON.stringify(label)};\n`,
    );
    const wharfieBin = path.join(
      consumerRoot,
      'node_modules',
      '.bin',
      'wharfie',
    );
    const result = parseJsonResult(
      run(
        process.execPath,
        [
          wharfieBin,
          'app',
          'package',
          fixture,
          '--output-dir',
          outputDirectory,
          '--target',
          target,
          '--no-pretty',
        ],
        { cwd: consumerRoot, env: process.env, timeoutMs: 600_000 },
      ),
      `installed-package ${label} proof artifact package`,
    );
    assert.equal(result.artifacts?.length, 1);
    const artifact = result.artifacts[0];
    assert.equal(artifact.target?.platform, 'linux');
    assert.equal(artifact.target?.architecture, process.arch);
    assert.equal(artifact.target?.nodeVersion, process.versions.node);
    assert.equal(artifact.target?.libc, 'glibc');
    assert.equal(existsSync(artifact.path), true);
    assert.equal((statSync(artifact.path).mode & 0o111) !== 0, true);
    assert.equal(artifact.revisionId, result.revision?.revisionId);
    return {
      artifactPath: artifact.path,
      artifact,
      revision: result.revision,
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
    installedPackageRoot = path.join(
      consumerRoot,
      'node_modules',
      '@wharfie',
      'wharfie',
    );
    const installedMetadata = readJson(
      path.join(installedPackageRoot, 'package.json'),
    );
    const wharfieBin = path.join(
      consumerRoot,
      'node_modules',
      '.bin',
      'wharfie',
    );
    assert.equal(existsSync(wharfieBin), true);
    packageEvidence = Object.freeze({
      name: installedMetadata.name,
      version: installedMetadata.version,
      tarballSha256: sha256File(packaged.tarballPath),
      packedFileCount: packaged.manifest.files.length,
    });
    source = buildFixture('source');
    healthyTarget = buildFixture('target');
    const faultSourcePath = path.join(
      installedPackageRoot,
      FAILING_RESIDENT_SOURCE_SUFFIX,
    );
    const pristineFaultSource = readFileSync(faultSourcePath, 'utf8');
    assert.equal(
      pristineFaultSource.includes(FAILING_RESIDENT_INJECTION.trim()),
      false,
    );
    const injectedFaultSource = `${pristineFaultSource.trimEnd()}${FAILING_RESIDENT_INJECTION}`;
    writeFileSync(faultSourcePath, injectedFaultSource);
    faultInjection = Object.freeze({
      kind: 'clean-resident-exit-before-ready',
      sourceSuffix: FAILING_RESIDENT_SOURCE_SUFFIX,
      pristineSha256: createHash('sha256')
        .update(pristineFaultSource)
        .digest('hex'),
      injectedSha256: createHash('sha256')
        .update(injectedFaultSource)
        .digest('hex'),
      injectionSha256: createHash('sha256')
        .update(FAILING_RESIDENT_INJECTION)
        .digest('hex'),
      expectedExitStatus: 0,
      expectedSystemdResult: 'success',
    });
    failingTarget = buildFixture('failing-target');
  } finally {
    packaged.cleanup();
  }
  assert.ok(source);
  assert.ok(healthyTarget);
  assert.ok(failingTarget);
  assert.ok(installedPackageRoot);
  assert.ok(faultInjection);
  assert.ok(packageEvidence);
  assert.equal(
    new Set([
      source.artifact.artifactId,
      healthyTarget.artifact.artifactId,
      failingTarget.artifact.artifactId,
    ]).size,
    3,
  );
  assert.equal(
    new Set([
      source.artifact.revisionId,
      healthyTarget.artifact.revisionId,
      failingTarget.artifact.revisionId,
    ]).size,
    3,
  );
  return {
    source,
    target: healthyTarget,
    failingTarget,
    installedPackageRoot,
    faultInjection,
    package: packageEvidence,
  };
}

/**
 * Reduce one package result to durable, non-secret proof evidence.
 * @param {{artifactPath: string, artifact: Record<string, any>}} packaged - Package result.
 * @returns {Readonly<Record<string, any>>} - Exact artifact evidence.
 */
function createArtifactEvidence(packaged) {
  return Object.freeze({
    artifactPath: packaged.artifactPath,
    artifactId: packaged.artifact.artifactId,
    revisionId: packaged.artifact.revisionId,
    byteDigest: packaged.artifact.byteDigest,
    size: packaged.artifact.size,
    target: packaged.artifact.target,
    sha256: sha256File(packaged.artifactPath),
  });
}

/** @typedef {{code: number | null, signal: string | null}} ChildExit */

/**
 * Add command output to one bounded lifecycle failure.
 * @param {{getOutput: () => {stdout: string, stderr: string}}} command - Child command.
 * @param {string} message - Failure context.
 * @returns {Error} - Diagnostic error.
 */
function childCommandError(command, message) {
  const output = command.getOutput();
  return new Error(
    [
      message,
      output.stdout ? `stdout:\n${output.stdout}` : '',
      output.stderr ? `stderr:\n${output.stderr}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

/**
 * Bound one child or control-store operation.
 * @template T
 * @param {Promise<T>} promise - Pending operation.
 * @param {number} timeoutMs - Maximum duration.
 * @param {string} label - Timeout label.
 * @returns {Promise<T>} - Completed value.
 */
async function waitWithTimeout(promise, timeoutMs, label) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Best-effort inspector and child cleanup without replacing the primary error.
 * @param {InspectedCommand | undefined} command - Optional child.
 * @param {SeaInspector | undefined} inspector - Optional inspector.
 * @returns {Promise<void>} - Resolves after cleanup attempt.
 */
async function cleanupInspectedCommand(command, inspector) {
  try {
    if (command && !command.getExit()) {
      command.child.kill('SIGKILL');
      await waitWithTimeout(
        command.exited,
        CHILD_EXIT_TIMEOUT_MS,
        'inspected activation command cleanup',
      );
    }
  } catch {
    // The caller's assertion is the useful failure.
  } finally {
    inspector?.close();
    command?.child.stdout?.destroy();
    command?.child.stderr?.destroy();
  }
}

/**
 * @param {Record<string, any> | null} actual - Observed release.
 * @param {Record<string, any>} expected - Artifact evidence.
 * @param {string} label - Boundary label.
 * @returns {void} - Resolves for one exact reference.
 */
function assertReleaseReference(actual, expected, label) {
  assert.equal(actual?.artifactId, expected.artifactId, `${label} artifact`);
  assert.equal(actual?.revisionId, expected.revisionId, `${label} revision`);
}

/**
 * Assert one nullable release reference.
 * @param {Record<string, any> | null} actual - Observed reference.
 * @param {Record<string, any> | null} expected - Expected reference.
 * @param {string} label - Boundary label.
 * @returns {void} - Resolves for one exact optional reference.
 */
function assertOptionalReleaseReference(actual, expected, label) {
  if (expected === null) {
    assert.equal(actual, null, label);
    return;
  }
  assertReleaseReference(actual, expected, label);
}

/**
 * Read one exact durable activation snapshot through a separate read-only DB.
 * @param {Readonly<Record<string, string>>} storage - Proof layout.
 * @returns {Promise<Record<string, any>>} - Existing activation snapshot.
 */
async function readDurableActivation(storage) {
  const db = await createControlDBClient('lmdb', {
    path: storage.controlPath,
    readOnly: true,
  });
  try {
    const store = createLocalApplicationActivation({
      db,
      tableName: LOCAL_APP_EXECUTION_LEDGER_TABLE,
    });
    const activation = await store.get({ appId: APP_ID });
    assert.ok(activation, 'durable activation is absent');
    return activation;
  } finally {
    await db.close();
  }
}

/**
 * Assert one exact post-commit activation breakpoint snapshot.
 * @param {Record<string, any>} activation - Durable snapshot.
 * @param {{mode: 'forward'|'restore', action: 'update'|'rollback', boundary: {writeNumber: number, phase: string}, baseline: Record<string, any>, source: Record<string, any>, target: Record<string, any>}} expected - Exact transition boundary.
 * @returns {void} - Resolves for the expected durable state.
 */
function assertActivationBoundary(activation, expected) {
  const { mode, action, boundary, baseline, source, target } = expected;
  const final = boundary.phase === LocalApplicationActivationPhase.ACTIVE;
  assert.equal(
    activation.recordVersion,
    baseline.recordVersion + boundary.writeNumber,
  );
  assert.equal(activation.phase, boundary.phase);
  assert.equal(
    activation.selectionGeneration,
    baseline.selectionGeneration +
      (mode === 'forward'
        ? boundary.writeNumber >= 3
          ? 1
          : 0
        : boundary.writeNumber >= 7
          ? 2
          : 1),
  );
  const selected =
    mode === 'forward'
      ? boundary.writeNumber <= 2
        ? source
        : target
      : boundary.writeNumber <= 6
        ? target
        : source;
  const desired = mode === 'forward' ? target : source;
  assertReleaseReference(activation.selected, selected, 'selected');
  assertReleaseReference(activation.desired, desired, 'desired');
  assertOptionalReleaseReference(
    activation.rollbackCandidate,
    final && mode === 'forward' ? source : baseline.rollbackCandidate,
    'rollback candidate',
  );
  if (final) {
    assert.equal(activation.transition, null);
    assert.ok(activation.lastTransition?.transitionId);
    assert.notEqual(
      activation.lastTransition.transitionId,
      baseline.lastTransition?.transitionId || null,
    );
    assert.equal(
      activation.lastTransition.outcome,
      mode === 'forward' ? 'target-active' : 'source-restored',
    );
    return;
  }
  assert.equal(activation.transition?.action, action);
  assert.equal(
    activation.transition?.sourceRecordVersion,
    baseline.recordVersion,
  );
  assert.equal(
    activation.transition?.sourceSelectionGeneration,
    baseline.selectionGeneration,
  );
  assertReleaseReference(
    activation.transition?.source,
    source,
    'transition source',
  );
  assertReleaseReference(
    activation.transition?.target,
    target,
    'transition target',
  );
}

/**
 * Read systemd independently without taking Wharfie's operation lock.
 * @returns {Readonly<Record<string, string>>} - Exact manager properties.
 */
function readIndependentServiceState() {
  const properties = [
    'LoadState',
    'UnitFileState',
    'ActiveState',
    'SubState',
    'Result',
    'ExecMainCode',
    'ExecMainStatus',
    'MainPID',
    'FragmentPath',
    'DropInPaths',
    'NeedDaemonReload',
  ];
  const shown = run(
    '/usr/bin/systemctl',
    [
      '--user',
      'show',
      UNIT_NAME,
      '--no-pager',
      `--property=${properties.join(',')}`,
    ],
    { env: packagedEnvironment(), allowFailure: true },
  );
  assert.equal(shown.status, 0, shown.stderr || shown.stdout);
  const parsed = {};
  for (const line of shown.stdout.trimEnd().split('\n')) {
    const separator = line.indexOf('=');
    assert.ok(separator > 0, `malformed systemd property: ${line}`);
    const key = line.slice(0, separator);
    assert.ok(properties.includes(key), `unexpected systemd property: ${key}`);
    assert.equal(
      Object.hasOwn(parsed, key),
      false,
      `duplicate property: ${key}`,
    );
    parsed[key] = line.slice(separator + 1);
  }
  assert.deepEqual(Object.keys(parsed).sort(), [...properties].sort());
  return Object.freeze(parsed);
}

/**
 * Capture the selector, receipt, and live manager while an operator is frozen.
 * @param {Readonly<Record<string, string>>} storage - Proof layout.
 * @returns {Readonly<Record<string, any>>} - Physical state.
 */
function captureActivationPhysicalState(storage) {
  const installation = existsSync(storage.installationPath)
    ? JSON.parse(readFileSync(storage.installationPath, 'utf8'))
    : null;
  const systemd = readIndependentServiceState();
  const processId = Number(systemd.MainPID);
  return Object.freeze({
    selector: existsSync(storage.currentLink)
      ? readlinkSync(storage.currentLink)
      : null,
    installation: installation
      ? Object.freeze({
          state: installation.state,
          current: Object.freeze({
            artifactId: installation.current.artifactId,
            revisionId: installation.current.revisionId,
          }),
          previous: installation.previous
            ? Object.freeze({
                artifactId: installation.previous.artifactId,
                revisionId: installation.previous.revisionId,
              })
            : null,
        })
      : null,
    systemd,
    executablePath:
      Number.isSafeInteger(processId) && processId > 0
        ? readlinkSync(`/proc/${processId}/exe`)
        : null,
  });
}

/**
 * Assert phase-specific real-host projection ordering.
 * @param {Readonly<Record<string, any>>} physical - Physical snapshot.
 * @param {{storage: Readonly<Record<string, string>>, current: Record<string, any>, previous: Record<string, any> | null, active: boolean, phase: string}} expected - Exact projection.
 * @returns {void} - Resolves for an authorized projection.
 */
function assertFrozenPhysicalState(physical, expected) {
  assert.equal(physical.systemd.LoadState, 'loaded');
  assert.equal(physical.systemd.UnitFileState, 'enabled');
  assert.equal(physical.systemd.FragmentPath, expected.storage.unitPath);
  assert.equal(physical.systemd.DropInPaths, '');
  assert.equal(physical.systemd.NeedDaemonReload, 'no');
  assert.ok(physical.installation);
  assert.equal(physical.installation.state, 'installed');
  assertReleaseReference(
    physical.installation.current,
    expected.current,
    `${expected.phase} installation current`,
  );
  assertOptionalReleaseReference(
    physical.installation.previous,
    expected.previous,
    `${expected.phase} installation previous`,
  );
  assert.equal(
    physical.selector,
    path.join('releases', expected.current.artifactId),
  );
  if (expected.active) {
    assert.equal(physical.systemd.ActiveState, 'active');
    assert.equal(physical.systemd.SubState, 'running');
    assert.ok(Number(physical.systemd.MainPID) > 0);
    assert.equal(
      physical.executablePath,
      path.join(
        expected.storage.releasesRoot,
        expected.current.artifactId,
        'app',
      ),
    );
  } else {
    assert.equal(physical.systemd.ActiveState, 'inactive');
    assert.equal(physical.systemd.SubState, 'dead');
    assert.equal(physical.systemd.MainPID, '0');
    assert.equal(physical.executablePath, null);
  }
}

/**
 * Bind the debugger to exact installed source bytes packaged into every SEA.
 * @param {string} installedPackageRoot - Installed tarball root.
 * @returns {{sourceSuffix: string, anchor: string, occurrence: number, expectedSourceContent: string, sourceSha256: string}} - Bound breakpoint target.
 */
function bindActivationStoreBreakpoint(installedPackageRoot) {
  const sourcePath = path.join(
    installedPackageRoot,
    ACTIVATION_STORE_WRITE_BREAKPOINT.sourceSuffix,
  );
  const expectedSourceContent = readFileSync(sourcePath, 'utf8');
  assert.equal(
    expectedSourceContent.split(ACTIVATION_STORE_WRITE_BREAKPOINT.anchor)
      .length - 1,
    1,
    'activation post-commit anchor must be unique',
  );
  return Object.freeze({
    ...ACTIVATION_STORE_WRITE_BREAKPOINT,
    expectedSourceContent,
    sourceSha256: createHash('sha256')
      .update(expectedSourceContent)
      .digest('hex'),
  });
}

/**
 * Bind the debugger to the exact fault source embedded only in the failing SEA.
 * @param {string} installedPackageRoot - Installed tarball root.
 * @returns {{sourceSuffix: string, anchor: string, occurrence: number, expectedSourceContent: string, sourceSha256: string}} - Bound fault target.
 */
function bindFailingResidentBreakpoint(installedPackageRoot) {
  const sourcePath = path.join(
    installedPackageRoot,
    FAILING_RESIDENT_SOURCE_SUFFIX,
  );
  const expectedSourceContent = readFileSync(sourcePath, 'utf8');
  assert.equal(
    expectedSourceContent.split(FAILING_RESIDENT_CODE).length - 1,
    1,
    'failing resident injection anchor must be unique',
  );
  return Object.freeze({
    sourceSuffix: FAILING_RESIDENT_SOURCE_SUFFIX,
    anchor: FAILING_RESIDENT_CODE,
    occurrence: 1,
    expectedSourceContent,
    sourceSha256: createHash('sha256')
      .update(expectedSourceContent)
      .digest('hex'),
  });
}

/**
 * Require one pause to originate only from the exact retained breakpoint IDs.
 * @param {Record<string, any>} pause - Inspector pause.
 * @param {Record<string, any>} breakpoint - Installed-source breakpoint.
 * @param {string} label - Boundary label.
 * @returns {void} - Resolves for an exact post-commit pause.
 */
function assertActivationBreakpointPause(pause, breakpoint, label) {
  const expectedIds = new Set(
    breakpoint.breakpointIds || [breakpoint.breakpointId],
  );
  const hitBreakpoints = pause.hitBreakpoints || [];
  assert.ok(
    hitBreakpoints.length > 0 &&
      hitBreakpoints.every((breakpointId) => expectedIds.has(breakpointId)),
    `${label} paused outside the activation post-commit breakpoint: ${JSON.stringify(hitBreakpoints)}`,
  );
}

/**
 * Calculate the exact selector, receipt, and process state at one boundary.
 * @param {{mode: 'forward'|'restore', boundary: {writeNumber: number, phase: string}, baseline: Record<string, any>, source: Record<string, any>, target: Record<string, any>, storage: Readonly<Record<string, string>>}} options - Boundary inputs.
 * @returns {Readonly<{storage: Readonly<Record<string, string>>, current: Record<string, any>, previous: Record<string, any> | null, active: boolean, phase: string}>} - Expected physical projection.
 */
function expectedPhysicalProjection(options) {
  const { mode, boundary, baseline, source, target, storage } = options;
  if (mode === 'forward') {
    const selectedTarget = boundary.writeNumber >= 3;
    return Object.freeze({
      storage,
      phase: boundary.phase,
      current: selectedTarget ? target : source,
      previous: selectedTarget ? source : baseline.rollbackCandidate,
      active: boundary.writeNumber === 1 || boundary.writeNumber === 5,
    });
  }
  const selectedSource = boundary.writeNumber >= 7;
  return Object.freeze({
    storage,
    phase: `restore-${boundary.phase}`,
    current: selectedSource ? source : target,
    previous: selectedSource ? baseline.rollbackCandidate : source,
    active: boundary.writeNumber === 9,
  });
}

/**
 * Crash one public activation command immediately after an exact durable write.
 * @param {{artifactPath: string, installedPackageRoot: string, mode: 'forward'|'restore', action: 'update'|'rollback', boundary: {writeNumber: number, phase: string}, baseline: Record<string, any>, source: Record<string, any>, target: Record<string, any>, storage: Readonly<Record<string, string>>}} options - Exact crash boundary.
 * @returns {Promise<Readonly<Record<string, any>>>} - Durable and physical crash evidence.
 */
async function crashActivationCommandAtBoundary(options) {
  const db = await createControlDBClient('lmdb', {
    path: options.storage.controlPath,
    readOnly: true,
  });
  const activationStore = createLocalApplicationActivation({
    db,
    tableName: LOCAL_APP_EXECUTION_LEDGER_TABLE,
  });
  /** @type {InspectedCommand | undefined} */
  let command;
  /** @type {SeaInspector | undefined} */
  let inspector;
  try {
    assert.deepEqual(
      await activationStore.get({ appId: APP_ID }),
      options.baseline,
      'activation changed before inspected command start',
    );
    command = spawnInspectorPausedProcess(
      options.artifactPath,
      ['wharfie', 'service', options.action, '--json'],
      {
        cwd: PROOF_ROOT,
        env: packagedEnvironment(),
        timeoutMs: STATUS_TIMEOUT_MS,
      },
    );
    inspector = await attachSeaInspector(command, {
      timeoutMs: STATUS_TIMEOUT_MS,
    });
    const boundTarget = bindActivationStoreBreakpoint(
      options.installedPackageRoot,
    );
    const breakpoint = await inspector.setSourceBreakpoint(
      'activation-store-post-commit',
      boundTarget,
    );
    let faultBreakpoint;
    let boundFault;
    if (options.mode === 'restore') {
      boundFault = bindFailingResidentBreakpoint(options.installedPackageRoot);
      faultBreakpoint = await inspector.setSourceBreakpoint(
        'failing-resident-injection',
        boundFault,
      );
      const paused = inspector.waitForPause();
      await inspector.resume();
      const pause = await paused;
      assertActivationBreakpointPause(
        pause,
        faultBreakpoint,
        `${options.mode} ${options.action} embedded fault`,
      );
      assert.deepEqual(
        await activationStore.get({ appId: APP_ID }),
        options.baseline,
        'activation changed before the embedded fault line executed',
      );
    }

    const targetRecordVersion =
      options.baseline.recordVersion + options.boundary.writeNumber;
    let observedRecordVersion = options.baseline.recordVersion;
    let observedPauseCount = 0;
    let cleanExit;
    let frozen;
    const maximumPauses =
      options.boundary.writeNumber * breakpoint.breakpointIds.length;
    while (observedRecordVersion < targetRecordVersion) {
      assert.ok(
        observedPauseCount < maximumPauses,
        `${options.action} exceeded ${maximumPauses} post-commit pauses before write ${options.boundary.writeNumber}`,
      );
      const paused = inspector.waitForPause();
      await inspector.resume();
      const pause = await paused;
      observedPauseCount += 1;
      assertActivationBreakpointPause(
        pause,
        breakpoint,
        `${options.mode} ${options.action} pause ${observedPauseCount}`,
      );
      assert.equal(
        command.getExit(),
        null,
        `${options.action} exited at activation pause ${observedPauseCount}`,
      );
      const snapshot = await activationStore.get({ appId: APP_ID });
      assert.ok(snapshot);
      assert.ok(
        snapshot.recordVersion === observedRecordVersion ||
          snapshot.recordVersion === observedRecordVersion + 1,
        `${options.action} activation record version advanced unexpectedly from ${observedRecordVersion} to ${snapshot.recordVersion}`,
      );
      observedRecordVersion = snapshot.recordVersion;
      assert.ok(
        observedRecordVersion <= targetRecordVersion,
        `${options.action} passed target activation record version ${targetRecordVersion}`,
      );
      if (
        options.mode === 'restore' &&
        observedRecordVersion === options.baseline.recordVersion + 5 &&
        !cleanExit
      ) {
        cleanExit = readIndependentServiceState();
        assert.equal(cleanExit.ActiveState, 'inactive');
        assert.equal(cleanExit.SubState, 'dead');
        assert.equal(cleanExit.Result, 'success');
        assert.equal(cleanExit.ExecMainStatus, '0');
      }
      if (observedRecordVersion === targetRecordVersion) frozen = snapshot;
    }
    assert.ok(frozen);
    assertActivationBoundary(frozen, options);
    const physical = captureActivationPhysicalState(options.storage);
    assertFrozenPhysicalState(physical, expectedPhysicalProjection(options));
    assert.equal(command.getOutput().stdout, '');
    const killed = command.child.kill('SIGKILL');
    if (!killed && !command.getExit()) {
      throw childCommandError(
        command,
        `could not kill ${options.action} at write ${options.boundary.writeNumber}`,
      );
    }
    const exit = await waitWithTimeout(
      command.exited,
      CHILD_EXIT_TIMEOUT_MS,
      `${options.action} SIGKILL at write ${options.boundary.writeNumber}`,
    );
    assert.deepEqual(exit, { code: null, signal: 'SIGKILL' });
    const afterKill = await activationStore.get({ appId: APP_ID });
    assert.deepEqual(afterKill, frozen);
    return Object.freeze({
      mode: options.mode,
      action: options.action,
      writeNumber: options.boundary.writeNumber,
      phase: options.boundary.phase,
      activation: frozen,
      physical,
      processExit: exit,
      observedPauseCount,
      ...(cleanExit ? { cleanExit } : {}),
      breakpoint: Object.freeze({
        retainedLocationCount: breakpoint.breakpointIds.length,
        sourceSuffix: ACTIVATION_STORE_WRITE_BREAKPOINT.sourceSuffix,
        sourceSha256: boundTarget.sourceSha256,
        originalLine: breakpoint.originalLine,
        originalColumn: breakpoint.originalColumn,
        generatedLine: breakpoint.generatedLine,
        generatedColumn: breakpoint.generatedColumn,
      }),
      ...(faultBreakpoint
        ? {
            embeddedFault: Object.freeze({
              retainedLocationCount: faultBreakpoint.breakpointIds.length,
              sourceSuffix: FAILING_RESIDENT_SOURCE_SUFFIX,
              sourceSha256: boundFault.sourceSha256,
              originalLine: faultBreakpoint.originalLine,
              originalColumn: faultBreakpoint.originalColumn,
              generatedLine: faultBreakpoint.generatedLine,
              generatedColumn: faultBreakpoint.generatedColumn,
            }),
          }
        : {}),
    });
  } finally {
    await cleanupInspectedCommand(command, inspector);
    await db.close();
  }
}

/**
 * Run sudo with exact argv.
 * @param {string[]} args - Command and arguments after sudo.
 * @returns {CommandResult} - Result.
 */
function sudo(args) {
  return run('/usr/bin/sudo', ['--non-interactive', ...args], {
    timeoutMs: 180_000,
  });
}

/**
 * Install the root boot observer that proves automatic service readiness
 * before the proof user's first post-reboot login.
 * @param {string} repoRoot - Extracted repository root.
 * @param {{artifactPath: string, artifact: Record<string, any>}} packaged - Proof SEA evidence.
 * @param {Record<string, any>} serviceStatus - Last pre-reboot status.
 * @param {string} bootId - Pre-reboot kernel identity.
 * @param {string} runId - Workflow crossing the reboot.
 * @param {Record<string, any>} timer - Exact durable timer before reboot.
 * @param {string} releasePath - Immutable selected service executable.
 * @returns {Record<string, any>} - Published boot configuration.
 */
function installBootObserver(
  repoRoot,
  packaged,
  serviceStatus,
  bootId,
  runId,
  timer,
  releasePath,
) {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  assert.ok(Number.isSafeInteger(uid) && Number(uid) > 0);
  assert.ok(Number.isSafeInteger(gid) && Number(gid) > 0);
  assert.ok(Number.isSafeInteger(serviceStatus.runtime?.generation));
  const commit = process.env.WHARFIE_SYSTEMD_PROOF_COMMIT;
  assert.match(commit, /^[0-9a-f]{40}$/);
  const config = {
    schemaVersion: 1,
    kind: 'wharfie.systemd-proof.boot-config',
    commit,
    user: process.env.USER,
    uid,
    gid,
    home: homedir(),
    artifactPath: packaged.artifactPath,
    releasePath,
    unitPath: serviceStatus.systemd.fragmentPath,
    xdgDataHome: path.join(homedir(), '.local', 'share'),
    appId: APP_ID,
    artifactId: packaged.artifact.artifactId,
    revisionId: packaged.artifact.revisionId,
    runId,
    timer: {
      timerId: timer.timerId,
      scheduledAt: timer.scheduledAt,
      dueAt: timer.dueAt,
    },
    previousBootId: bootId,
    minimumGeneration: serviceStatus.runtime.generation,
    receiptPath: BOOT_RECEIPT_PATH,
  };
  const configSource = path.join(PROOF_ROOT, 'boot-config.json');
  const unitSource = path.join(PROOF_ROOT, BOOT_CHECK_UNIT);
  writeJsonAtomic(configSource, config);
  writeFileSync(
    unitSource,
    [
      '[Unit]',
      'Description=Wharfie systemd user-service boot proof',
      `After=user@${uid}.service`,
      'Before=ssh.service getty.target',
      '',
      '[Service]',
      'Type=oneshot',
      'ExecStart=/usr/local/bin/node /usr/local/libexec/wharfie-systemd-proof-boot-check.js',
      'TimeoutStartSec=150s',
      '',
      '[Install]',
      'WantedBy=multi-user.target',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  sudo([
    '/usr/bin/install',
    '-D',
    '-o',
    'root',
    '-g',
    'root',
    '-m',
    '0755',
    path.join(repoRoot, 'test', 'systemd', 'boot-check.js'),
    '/usr/local/libexec/wharfie-systemd-proof-boot-check.js',
  ]);
  sudo([
    '/usr/bin/install',
    '-D',
    '-o',
    'root',
    '-g',
    'root',
    '-m',
    '0644',
    configSource,
    '/etc/wharfie-systemd-proof.json',
  ]);
  sudo([
    '/usr/bin/install',
    '-D',
    '-o',
    'root',
    '-g',
    'root',
    '-m',
    '0644',
    unitSource,
    `/etc/systemd/system/${BOOT_CHECK_UNIT}`,
  ]);
  sudo(['/usr/bin/systemctl', 'daemon-reload']);
  sudo(['/usr/bin/systemctl', 'enable', BOOT_CHECK_UNIT]);
  run('/usr/bin/sync', []);
  return config;
}

/**
 * Remove the one-shot boot observer before a retained debug VM can reboot.
 * @returns {void} - Returns after systemd reload.
 */
function removeBootObserver() {
  sudo(['/usr/bin/systemctl', 'disable', BOOT_CHECK_UNIT]);
  for (const target of [
    `/etc/systemd/system/${BOOT_CHECK_UNIT}`,
    '/etc/wharfie-systemd-proof.json',
    '/usr/local/libexec/wharfie-systemd-proof-boot-check.js',
  ]) {
    sudo(['/usr/bin/rm', '--force', target]);
  }
  sudo(['/usr/bin/systemctl', 'daemon-reload']);
}

/**
 * Assert the finite service status agreement used throughout the proof.
 * @param {Record<string, any>} status - Packaged status.
 * @returns {void} - Returns for healthy PID-bound boot persistence.
 */
function assertHealthy(status) {
  const storage = proofStorageLayout();
  assert.equal(status.schemaVersion, 2);
  assert.equal(status.kind, 'wharfie.service.status');
  assert.equal(status.appId, APP_ID);
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
}

/**
 * @param {Record<string, any>} timer - Observed timer.
 * @param {Record<string, any>} expected - Previously persisted timer.
 * @param {'WAITING'|'FIRED'} status - Required state.
 * @returns {void} - Returns for the identical timer decision.
 */
function assertSameTimer(timer, expected, status) {
  assert.equal(timer?.timerId, expected.timerId);
  assert.equal(timer?.scheduledAt, expected.scheduledAt);
  assert.equal(timer?.dueAt, expected.dueAt);
  assert.equal(timer?.status, status);
}

/**
 * @param {Record<string, any>} status - Healthy service status.
 * @param {string} releasePath - Exact immutable release path.
 * @returns {void} - Returns when the supervised PID executes that release.
 */
function assertRunningRelease(status, releasePath) {
  assertHealthy(status);
  assert.equal(
    readlinkSync(`/proc/${status.systemd.mainPid}/exe`),
    releasePath,
  );
}

/**
 * Keep the durable activation fields needed in a portable proof receipt.
 * @param {Record<string, any>} activation - Full activation snapshot.
 * @returns {Readonly<Record<string, any>>} - Bounded activation evidence.
 */
function createActivationEvidence(activation) {
  return Object.freeze({
    recordVersion: activation.recordVersion,
    selectionGeneration: activation.selectionGeneration,
    phase: activation.phase,
    selected: activation.selected,
    desired: activation.desired,
    rollbackCandidate: activation.rollbackCandidate,
    transition: activation.transition,
    lastTransition: activation.lastTransition,
  });
}

/**
 * Assert one healthy immutable release and return bounded host evidence.
 * @param {Record<string, any>} status - Packaged status.
 * @param {Record<string, any>} current - Expected current artifact evidence.
 * @param {Record<string, any> | null} rollback - Expected retained candidate.
 * @param {Readonly<Record<string, string>>} storage - Proof layout.
 * @returns {Readonly<Record<string, any>>} - Healthy selection evidence.
 */
function assertActiveArtifact(status, current, rollback, storage) {
  const releasePath = path.join(
    storage.releasesRoot,
    current.artifactId,
    'app',
  );
  assertRunningRelease(status, releasePath);
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
  assert.equal(
    status.activation?.phase,
    LocalApplicationActivationPhase.ACTIVE,
  );
  assertReleaseReference(
    status.activation?.selected,
    current,
    'status selected',
  );
  if (rollback) {
    assertReleaseReference(
      status.activation?.rollback,
      rollback,
      'status rollback',
    );
  } else {
    assert.equal(status.activation?.rollback, null);
  }
  assert.equal(sha256File(releasePath), current.sha256);
  return Object.freeze({
    artifactId: current.artifactId,
    revisionId: current.revisionId,
    releasePath,
    releaseSha256: sha256File(releasePath),
    processId: status.systemd.mainPid,
    generation: status.runtime.generation,
    lastOutcome: status.activation.lastOutcome,
  });
}

/**
 * Assert one fulfilled public activation command receipt.
 * @param {Record<string, any>} receipt - Public JSON receipt.
 * @param {string} action - Command action.
 * @param {Record<string, any>} current - Expected selected release.
 * @param {Record<string, any> | null} rollback - Expected candidate.
 * @param {'target-active'|'source-restored'} [outcome] - Durable outcome.
 * @returns {void} - Resolves for exact public output.
 */
function assertSuccessfulActivationReceipt(
  receipt,
  action,
  current,
  rollback,
  outcome = 'target-active',
) {
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.kind, 'wharfie.service.result');
  assert.equal(receipt.action, action);
  assert.equal(receipt.requestStatus, 'fulfilled');
  assert.equal(receipt.outcome, outcome);
  assert.equal(receipt.health, 'healthy');
  assert.equal(receipt.activeArtifactId, current.artifactId);
  assert.equal(receipt.activeRevisionId, current.revisionId);
  assert.equal(receipt.rollbackArtifactId, rollback?.artifactId || null);
  assert.equal(receipt.rollbackRevisionId, rollback?.revisionId || null);
}

/**
 * Execute and independently verify one ordinary update, rollback, or recovery.
 * @param {{artifactPath: string, action: 'update'|'rollback'|'recover', current: Record<string, any>, rollback: Record<string, any> | null, storage: Readonly<Record<string, string>>, label: string, outcome?: 'target-active'|'source-restored'}} options - Expected result.
 * @returns {Readonly<Record<string, any>>} - Public and host evidence.
 */
function runSuccessfulActivationCommand(options) {
  const receipt = runArtifactJson(
    options.artifactPath,
    ['wharfie', 'service', options.action, '--json'],
    options.label,
  );
  assertSuccessfulActivationReceipt(
    receipt,
    options.action,
    options.current,
    options.rollback,
    options.outcome,
  );
  const status = readServiceStatus(options.artifactPath);
  const active = assertActiveArtifact(
    status,
    options.current,
    options.rollback,
    options.storage,
  );
  return Object.freeze({ receipt, active });
}

/**
 * Collect deterministic SIGKILL/recovery evidence for one complete forward
 * update or rollback, including the committed ACTIVE response-loss boundary.
 * @param {{action: 'update'|'rollback', commandArtifact: Record<string, any>, recoveryArtifact: Record<string, any>, installedPackageRoot: string, source: Record<string, any>, target: Record<string, any>, storage: Readonly<Record<string, string>>, reset: () => Readonly<Record<string, any>>}} options - Matrix direction.
 * @returns {Promise<Readonly<Record<string, any>>>} - Ordered phase evidence.
 */
async function proveActivationCrashDirection(options) {
  const cases = [];
  for (const [
    index,
    boundary,
  ] of ACTIVATION_FORWARD_CRASH_BOUNDARIES.entries()) {
    const baseline = await readDurableActivation(options.storage);
    assert.equal(baseline.phase, LocalApplicationActivationPhase.ACTIVE);
    assertReleaseReference(baseline.selected, options.source, 'matrix source');
    assertActiveArtifact(
      readServiceStatus(options.source.artifactPath),
      options.source,
      baseline.rollbackCandidate,
      options.storage,
    );
    const crash = await crashActivationCommandAtBoundary({
      artifactPath: options.commandArtifact.artifactPath,
      installedPackageRoot: options.installedPackageRoot,
      mode: 'forward',
      action: options.action,
      boundary,
      baseline,
      source: options.source,
      target: options.target,
      storage: options.storage,
    });
    const recovered = runSuccessfulActivationCommand({
      artifactPath: options.recoveryArtifact.artifactPath,
      action: 'recover',
      current: options.target,
      rollback: options.source,
      storage: options.storage,
      label: `${options.action} recovery from write ${boundary.writeNumber} ${boundary.phase}`,
    });
    const afterRecovery = await readDurableActivation(options.storage);
    if (boundary.phase === LocalApplicationActivationPhase.ACTIVE) {
      assert.deepEqual(afterRecovery, crash.activation);
    }
    assert.equal(afterRecovery.phase, LocalApplicationActivationPhase.ACTIVE);
    assertReleaseReference(
      afterRecovery.selected,
      options.target,
      'recovered selected',
    );
    assertReleaseReference(
      afterRecovery.rollbackCandidate,
      options.source,
      'recovered rollback candidate',
    );
    cases.push(
      Object.freeze({
        ...crash,
        baseline: createActivationEvidence(baseline),
        activation: createActivationEvidence(crash.activation),
        recovery: Object.freeze({
          ...recovered,
          activation: createActivationEvidence(afterRecovery),
          durableUnchangedAfterResponseLoss:
            boundary.phase === LocalApplicationActivationPhase.ACTIVE,
        }),
      }),
    );
    announce(
      `${options.action}-write-${boundary.writeNumber}-${String(boundary.phase).toLowerCase()}-recovered`,
    );
    if (index + 1 < ACTIVATION_FORWARD_CRASH_BOUNDARIES.length) {
      options.reset();
    }
  }
  return Object.freeze({
    expectedCaseCount: ACTIVATION_FORWARD_CRASH_BOUNDARIES.length,
    observedCaseCount: cases.length,
    cases: Object.freeze(cases),
  });
}

/**
 * Crash and recover each distinct source-restoration phase after a definitive
 * target failure. The same transition performs four forward writes first, so
 * restore boundaries are post-commit writes five through nine.
 * @param {{commandArtifact: Record<string, any>, recoveryArtifact: Record<string, any>, installedPackageRoot: string, source: Record<string, any>, target: Record<string, any>, storage: Readonly<Record<string, string>>}} options - Restoration matrix.
 * @returns {Promise<Readonly<Record<string, any>>>} - Restoration evidence.
 */
async function proveSourceRestorationCrashDirection(options) {
  const cases = [];
  for (const boundary of ACTIVATION_RESTORE_CRASH_BOUNDARIES) {
    const baseline = await readDurableActivation(options.storage);
    assert.equal(baseline.phase, LocalApplicationActivationPhase.ACTIVE);
    assertReleaseReference(baseline.selected, options.source, 'restore source');
    const crash = await crashActivationCommandAtBoundary({
      artifactPath: options.commandArtifact.artifactPath,
      installedPackageRoot: options.installedPackageRoot,
      mode: 'restore',
      action: 'update',
      boundary,
      baseline,
      source: options.source,
      target: options.target,
      storage: options.storage,
    });
    const recovered = runSuccessfulActivationCommand({
      artifactPath: options.recoveryArtifact.artifactPath,
      action: 'recover',
      current: options.source,
      rollback: baseline.rollbackCandidate,
      outcome: 'source-restored',
      storage: options.storage,
      label: `source restoration recovery from write ${boundary.writeNumber} ${boundary.phase}`,
    });
    const afterRecovery = await readDurableActivation(options.storage);
    if (boundary.phase === LocalApplicationActivationPhase.ACTIVE) {
      assert.deepEqual(afterRecovery, crash.activation);
    }
    assert.equal(afterRecovery.phase, LocalApplicationActivationPhase.ACTIVE);
    assertReleaseReference(
      afterRecovery.selected,
      options.source,
      'restored source',
    );
    assertOptionalReleaseReference(
      afterRecovery.rollbackCandidate,
      baseline.rollbackCandidate,
      'restored rollback candidate',
    );
    assert.equal(afterRecovery.lastTransition?.outcome, 'source-restored');
    cases.push(
      Object.freeze({
        ...crash,
        baseline: createActivationEvidence(baseline),
        activation: createActivationEvidence(crash.activation),
        recovery: Object.freeze({
          ...recovered,
          activation: createActivationEvidence(afterRecovery),
          durableUnchangedAfterResponseLoss:
            boundary.phase === LocalApplicationActivationPhase.ACTIVE,
        }),
      }),
    );
    announce(
      `source-restore-write-${boundary.writeNumber}-${String(boundary.phase).toLowerCase()}-recovered`,
    );
  }
  return Object.freeze({
    expectedCaseCount: ACTIVATION_RESTORE_CRASH_BOUNDARIES.length,
    observedCaseCount: cases.length,
    cases: Object.freeze(cases),
  });
}

/**
 * Prove update, rollback, response-loss recovery, stale-request refusal, and
 * definitive target-failure source restoration on real systemd.
 * @param {{source: Record<string, any>, target: Record<string, any>, failingTarget: Record<string, any>, installedPackageRoot: string, faultInjection: Record<string, any>, storage: Readonly<Record<string, string>>}} options - Artifact evidence.
 * @returns {Promise<Readonly<Record<string, any>>>} - Activation proof receipt.
 */
async function proveActivationEvolution(options) {
  const {
    source,
    target,
    failingTarget,
    installedPackageRoot,
    faultInjection,
    storage,
  } = options;
  const before = assertActiveArtifact(
    readServiceStatus(source.artifactPath),
    source,
    null,
    storage,
  );
  const update = await proveActivationCrashDirection({
    action: 'update',
    commandArtifact: target,
    recoveryArtifact: target,
    installedPackageRoot,
    source,
    target,
    storage,
    reset: () =>
      runSuccessfulActivationCommand({
        artifactPath: target.artifactPath,
        action: 'rollback',
        current: source,
        rollback: target,
        storage,
        label: 'update crash-matrix reset rollback',
      }),
  });

  const rollback = await proveActivationCrashDirection({
    action: 'rollback',
    commandArtifact: target,
    recoveryArtifact: target,
    installedPackageRoot,
    source: target,
    target: source,
    storage,
    reset: () =>
      runSuccessfulActivationCommand({
        artifactPath: target.artifactPath,
        action: 'update',
        current: target,
        rollback: source,
        storage,
        label: 'rollback crash-matrix reset update',
      }),
  });

  const ambiguousCase = rollback.cases.at(-1);
  assert.equal(ambiguousCase.phase, LocalApplicationActivationPhase.ACTIVE);
  assert.equal(ambiguousCase.recovery.durableUnchangedAfterResponseLoss, true);
  const beforeStaleRetry = await readDurableActivation(storage);
  const staleRetry = runArtifact(
    target.artifactPath,
    ['wharfie', 'service', 'rollback', '--json'],
    { allowFailure: true },
  );
  assert.notEqual(staleRetry.status, 0);
  assert.match(
    `${staleRetry.stdout}\n${staleRetry.stderr}`,
    /use service recover after an ambiguous rollback response/,
  );
  const afterStaleRetry = await readDurableActivation(storage);
  assert.deepEqual(afterStaleRetry, beforeStaleRetry);
  const afterAmbiguity = assertActiveArtifact(
    readServiceStatus(source.artifactPath),
    source,
    target,
    storage,
  );
  announce('rollback-response-loss-recovered-and-stale-retry-refused');

  const restoration = await proveSourceRestorationCrashDirection({
    commandArtifact: failingTarget,
    recoveryArtifact: source,
    installedPackageRoot,
    source,
    target: failingTarget,
    storage,
  });
  for (const restorationCase of restoration.cases) {
    assert.equal(
      restorationCase.embeddedFault?.sourceSha256,
      faultInjection.injectedSha256,
    );
    assert.equal(
      restorationCase.cleanExit?.ExecMainStatus,
      String(faultInjection.expectedExitStatus),
    );
    assert.equal(
      restorationCase.cleanExit?.Result,
      faultInjection.expectedSystemdResult,
    );
  }

  const failed = runArtifact(
    failingTarget.artifactPath,
    ['wharfie', 'service', 'update', '--json'],
    { allowFailure: true },
  );
  assert.equal(
    failed.status,
    1,
    'failing target update must exit unsuccessfully',
  );
  const failedReceipt = parseJsonOutput(failed, 'failing target update');
  assert.equal(failedReceipt.action, 'update');
  assert.equal(failedReceipt.requestStatus, 'failed');
  assert.equal(failedReceipt.outcome, 'source-restored');
  assert.equal(failedReceipt.health, 'healthy');
  assert.equal(failedReceipt.activeArtifactId, source.artifactId);
  assert.equal(failedReceipt.activeRevisionId, source.revisionId);
  assert.equal(failedReceipt.rollbackArtifactId, target.artifactId);
  assert.equal(failedReceipt.rollbackRevisionId, target.revisionId);
  const afterFailure = assertActiveArtifact(
    readServiceStatus(source.artifactPath),
    source,
    target,
    storage,
  );
  const failedReleasePath = path.join(
    storage.releasesRoot,
    failingTarget.artifactId,
    'app',
  );
  assert.equal(sha256File(failedReleasePath), failingTarget.sha256);
  announce('failed-target-source-restored');

  return Object.freeze({
    artifacts: Object.freeze({ source, target, failingTarget }),
    faultInjection,
    before,
    update,
    rollback,
    restoration,
    crashCaseCount:
      update.observedCaseCount +
      rollback.observedCaseCount +
      restoration.observedCaseCount,
    ambiguousRollbackResponse: Object.freeze({
      killedAfterActiveCommit: true,
      writeNumber: ambiguousCase.writeNumber,
      durableUnchangedAfterRecovery:
        ambiguousCase.recovery.durableUnchangedAfterResponseLoss,
      staleRetry: Object.freeze({
        status: staleRetry.status,
        stdout: staleRetry.stdout,
        stderr: staleRetry.stderr,
        durableUnchanged: true,
      }),
      active: afterAmbiguity,
    }),
    sourceRestoration: Object.freeze({
      failedTargetArtifactId: failingTarget.artifactId,
      failedTargetRevisionId: failingTarget.revisionId,
      failedTargetReleasePath: failedReleasePath,
      failedTargetReleaseSha256: sha256File(failedReleasePath),
      receipt: failedReceipt,
      active: afterFailure,
    }),
  });
}

/**
 * Read systemd directly after Wharfie removes its installation wiring. This
 * deliberately does not trust the packaged command's uninstall tombstone.
 * @returns {Readonly<Record<string, any>>} - Independent absence evidence.
 */
function readIndependentUninstallState() {
  const properties = [
    'LoadState',
    'UnitFileState',
    'ActiveState',
    'SubState',
    'MainPID',
    'FragmentPath',
    'DropInPaths',
  ];
  const args = ['--user', 'show', UNIT_NAME, '--no-pager'];
  for (const property of properties) args.push(`--property=${property}`);
  const shown = run('/usr/bin/systemctl', args, {
    env: packagedEnvironment(),
    allowFailure: true,
  });
  assert.equal(shown.status, 0, shown.stderr || shown.stdout);
  const parsed = {};
  for (const line of shown.stdout.trimEnd().split('\n')) {
    const separator = line.indexOf('=');
    assert.ok(separator > 0, `malformed systemd property: ${line}`);
    const key = line.slice(0, separator);
    assert.ok(properties.includes(key), `unexpected systemd property: ${key}`);
    assert.equal(
      Object.hasOwn(parsed, key),
      false,
      `duplicate property: ${key}`,
    );
    parsed[key] = line.slice(separator + 1);
  }
  assert.deepEqual(Object.keys(parsed).sort(), [...properties].sort());
  assert.equal(parsed.LoadState, 'not-found');
  assert.ok(['', 'disabled', 'not-found'].includes(parsed.UnitFileState));
  assert.equal(parsed.ActiveState, 'inactive');
  assert.equal(parsed.SubState, 'dead');
  assert.equal(parsed.MainPID, '0');
  assert.equal(parsed.FragmentPath, '');
  assert.equal(parsed.DropInPaths, '');

  const active = run('/usr/bin/systemctl', ['--user', 'is-active', UNIT_NAME], {
    env: packagedEnvironment(),
    allowFailure: true,
  });
  const enabled = run(
    '/usr/bin/systemctl',
    ['--user', 'is-enabled', UNIT_NAME],
    { env: packagedEnvironment(), allowFailure: true },
  );
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
    show: Object.freeze(parsed),
    isActive: Object.freeze({
      status: active.status,
      output: active.stdout.trim(),
    }),
    isEnabled: Object.freeze({
      status: enabled.status,
      output: enabled.stdout.trim(),
    }),
  });
}

/**
 * Prepare durable work, prove systemd crash replacement, and publish the
 * independent boot observer before the host restarts the VM.
 * @param {string} repoRoot - Extracted committed repository.
 * @returns {Promise<Record<string, any>>} - Preparation receipt.
 */
async function prepare(repoRoot) {
  assert.equal(process.platform, 'linux');
  assert.ok((process.getuid?.() || 0) > 0, 'proof must run as non-root');
  assert.equal(process.versions.node, '24.13.1');
  assert.equal(
    process.env.WHARFIE_SYSTEMD_PROOF_DISPOSABLE,
    'lima',
    'refusing to mutate a Linux host without the disposable Lima attestation',
  );
  assert.match(process.env.WHARFIE_SYSTEMD_PROOF_COMMIT, /^[0-9a-f]{40}$/);
  process.env.PATH = [path.dirname(process.execPath), process.env.PATH]
    .filter(Boolean)
    .join(path.delimiter);
  rmSync(PROOF_ROOT, { recursive: true, force: true });
  mkdirSync(PROOF_ROOT, { recursive: true, mode: 0o700 });

  const nodeProbe = run('/usr/bin/env', ['node', '--version'], {
    env: packagedEnvironment(),
    allowFailure: true,
  });
  assert.notEqual(
    nodeProbe.status,
    0,
    'packaged PATH unexpectedly exposes Node',
  );

  const packagedSet = packageProofArtifacts(repoRoot);
  const packaged = packagedSet.source;
  const sourceArtifact = createArtifactEvidence(packagedSet.source);
  const targetArtifact = createArtifactEvidence(packagedSet.target);
  const failingTargetArtifact = createArtifactEvidence(
    packagedSet.failingTarget,
  );
  const activationBreakpoint = bindActivationStoreBreakpoint(
    packagedSet.installedPackageRoot,
  );
  announce('packaged-consumer-seas');
  const storage = proofStorageLayout();
  const absent = readServiceStatus(packaged.artifactPath);
  if (absent.health !== 'absent') {
    captureServiceFailure(
      packaged.artifactPath,
      'fresh-service-status',
      new Error(`Fresh service status is ${JSON.stringify(absent)}`),
    );
  }
  assert.equal(
    absent.health,
    'absent',
    `fresh service status: ${JSON.stringify(absent)}`,
  );
  const idempotencyKey = 'systemd-real-reboot-proof';
  const started = runArtifactJson(
    packaged.artifactPath,
    [
      'wharfie',
      'start',
      '--workflow',
      WORKFLOW_ID,
      '--idempotency-key',
      idempotencyKey,
      '--input',
      JSON.stringify({ markerPath: MARKER_PATH, stepIndex: 0 }),
      '--json',
    ],
    'offline workflow start before service install',
  );
  assert.equal(started.workflow, WORKFLOW_ID);
  assert.equal(started.cursor_disposition, 'ACTIVITY_RUNNABLE');
  assert.match(started.run_id, /^wfr_[A-Za-z0-9_-]{43}$/);
  const runId = started.run_id;
  const pendingBeforeInstall = inspectRun(packaged.artifactPath, runId);
  announce('persisted-work-before-install');
  assert.equal(pendingBeforeInstall.run?.status, 'RUNNING');
  assert.equal(
    pendingBeforeInstall.workflowCursor?.disposition,
    'ACTIVITY_RUNNABLE',
  );
  assert.deepEqual(readMarkers(), []);
  assert.equal(existsSync(storage.appRoot), true);
  assert.equal(existsSync(storage.controlPath), true);
  for (const legacyPath of [
    path.join(storage.dataRoot, 'control'),
    path.join(storage.dataRoot, 'application-state'),
    path.join(storage.dataRoot, 'services'),
  ]) {
    assert.equal(
      existsSync(legacyPath),
      false,
      `legacy path exists: ${legacyPath}`,
    );
  }

  let install;
  try {
    install = runArtifactJson(
      packaged.artifactPath,
      ['wharfie', 'service', 'install', '--json'],
      'service install',
    );
  } catch (error) {
    captureServiceFailure(packaged.artifactPath, 'service-install', error);
    throw error;
  }
  assert.equal(install.action, 'install');
  assert.equal(install.outcome, 'target-active');
  assert.equal(install.health, 'healthy');
  const installed = readServiceStatus(packaged.artifactPath);
  assertHealthy(installed);
  announce('healthy-systemd-service');
  assert.equal(
    installed.installation.activeArtifactId,
    packaged.artifact.artifactId,
  );
  assert.equal(
    installed.installation.activeRevisionId,
    packaged.artifact.revisionId,
  );
  for (const expectedPath of [
    storage.stateRoot,
    storage.controlPath,
    storage.payloadPath,
    storage.applicationStatePath,
    storage.releasesRoot,
  ]) {
    assert.equal(
      existsSync(expectedPath),
      true,
      `missing path: ${expectedPath}`,
    );
  }
  const releaseDirectory = path.join(
    storage.releasesRoot,
    packaged.artifact.artifactId,
  );
  const releasePath = path.join(releaseDirectory, 'app');
  const releaseRecordPath = path.join(releaseDirectory, 'release.json');
  assert.equal(sha256File(releasePath), sha256File(packaged.artifactPath));
  assertRunningRelease(installed, releasePath);

  const timerWaiting = await waitFor(
    () => inspectRun(packaged.artifactPath, runId),
    (view) => view.workflowCursor?.disposition === 'TIMER_WAITING',
    'durable timer wait before reboot',
  );
  assert.equal(timerWaiting.run?.status, 'RUNNING');
  assert.equal(timerWaiting.timers?.length, 1);
  assert.equal(timerWaiting.timers[0].status, 'WAITING');
  assert.equal(
    timerWaiting.timers[0].dueAt - timerWaiting.timers[0].scheduledAt,
    EXPECTED_TIMER_DELAY_MS,
  );
  assert.deepEqual(
    readMarkers().map((entry) => entry.stepIndex),
    [0],
  );
  announce('durable-timer-waiting');

  const beforeCrash = readServiceStatus(packaged.artifactPath);
  assertHealthy(beforeCrash);
  process.kill(beforeCrash.systemd.mainPid, 'SIGKILL');
  const afterCrash = await waitFor(
    () => readServiceStatus(packaged.artifactPath),
    (status) =>
      status.health === 'healthy' &&
      status.systemd?.mainPid > 0 &&
      status.systemd.mainPid !== beforeCrash.systemd.mainPid &&
      status.runtime?.generation > beforeCrash.runtime.generation,
    'systemd crash replacement',
  );
  assertHealthy(afterCrash);
  const afterCrashRun = inspectRun(packaged.artifactPath, runId);
  assert.equal(afterCrashRun.workflowCursor?.disposition, 'TIMER_WAITING');
  assertSameTimer(afterCrashRun.timers?.[0], timerWaiting.timers[0], 'WAITING');
  assertRunningRelease(afterCrash, releasePath);
  announce('systemd-crash-replacement');
  assert.deepEqual(
    readMarkers().map((entry) => entry.stepIndex),
    [0],
  );

  const bootId = readBootId();
  const bootConfig = installBootObserver(
    repoRoot,
    packaged,
    afterCrash,
    bootId,
    runId,
    afterCrashRun.timers[0],
    releasePath,
  );
  announce('boot-observer-installed');
  const receipt = {
    schemaVersion: 2,
    kind: 'wharfie.systemd-proof.prepare',
    commit: process.env.WHARFIE_SYSTEMD_PROOF_COMMIT,
    preparedAt: Date.now(),
    appId: APP_ID,
    artifactPath: packaged.artifactPath,
    artifactId: packaged.artifact.artifactId,
    revisionId: packaged.artifact.revisionId,
    artifact: {
      byteDigest: packaged.artifact.byteDigest,
      size: packaged.artifact.size,
      target: packaged.artifact.target,
      sha256: sha256File(packaged.artifactPath),
    },
    activationArtifacts: {
      source: sourceArtifact,
      target: targetArtifact,
      failingTarget: failingTargetArtifact,
    },
    activationInspector: {
      installedPackageRoot: packagedSet.installedPackageRoot,
      sourceSuffix: activationBreakpoint.sourceSuffix,
      anchor: activationBreakpoint.anchor,
      occurrence: activationBreakpoint.occurrence,
      sourceSha256: activationBreakpoint.sourceSha256,
    },
    faultInjection: packagedSet.faultInjection,
    package: packagedSet.package,
    toolchain: {
      node: process.versions.node,
      npm: run(path.join(path.dirname(process.execPath), 'npm'), [
        '--version',
      ]).stdout.trim(),
    },
    storage,
    release: {
      artifactPath: releasePath,
      artifactSha256: sha256File(releasePath),
      recordPath: releaseRecordPath,
      recordSha256: sha256File(releaseRecordPath),
    },
    runId,
    idempotencyKey,
    bootId,
    timer: timerWaiting.timers[0],
    pendingBeforeInstall,
    crashReplacement: {
      before: {
        processId: beforeCrash.systemd.mainPid,
        generation: beforeCrash.runtime.generation,
      },
      after: {
        processId: afterCrash.systemd.mainPid,
        generation: afterCrash.runtime.generation,
      },
    },
    bootConfig,
    markerEntries: readMarkers(),
  };
  writeJsonAtomic(PREPARE_PATH, receipt);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  return receipt;
}

/**
 * Verify pre-login automatic boot, resume the durable workflow, exercise
 * graceful lifecycle operations, and prove uninstall preserves state.
 * @returns {Promise<Record<string, any>>} - Final proof receipt.
 */
async function verify() {
  assert.equal(
    process.env.WHARFIE_SYSTEMD_PROOF_DISPOSABLE,
    'lima',
    'refusing to mutate a Linux host without the disposable Lima attestation',
  );
  assert.equal(
    process.env.WHARFIE_SYSTEMD_PROOF_POWER_CYCLE,
    'forced-stop-start',
    'proof must use the declared abrupt VM power cycle',
  );
  const prepared = JSON.parse(readFileSync(PREPARE_PATH, 'utf8'));
  assert.equal(prepared.schemaVersion, 2);
  assert.equal(prepared.kind, 'wharfie.systemd-proof.prepare');
  assert.match(prepared.commit, /^[0-9a-f]{40}$/);
  assert.equal(process.env.WHARFIE_SYSTEMD_PROOF_COMMIT, prepared.commit);
  const bootReceipt = JSON.parse(readFileSync(BOOT_RECEIPT_PATH, 'utf8'));
  assert.equal(bootReceipt.kind, 'wharfie.systemd-proof.boot-receipt');
  assert.notEqual(bootReceipt.bootId, prepared.bootId);
  assert.equal(bootReceipt.previousBootId, prepared.bootId);
  assert.deepEqual(bootReceipt.sessionsBeforeCheck, []);
  assert.equal(bootReceipt.automaticStart, true);
  assertHealthy(bootReceipt.status);
  assert.equal(bootReceipt.executablePath, prepared.release.artifactPath);
  assert.equal(bootReceipt.workflow.run?.runId, prepared.runId);
  assert.equal(
    bootReceipt.workflow.workflowCursor?.disposition,
    'TIMER_WAITING',
  );
  assertSameTimer(bootReceipt.workflow.timers?.[0], prepared.timer, 'WAITING');
  assert.ok(
    bootReceipt.status.runtime.generation >
      prepared.crashReplacement.after.generation,
  );
  assert.equal(readBootId(), bootReceipt.bootId);

  const artifactPath = prepared.artifactPath;
  const bootStatus = readServiceStatus(artifactPath);
  assertRunningRelease(bootStatus, prepared.release.artifactPath);
  assert.equal(bootStatus.systemd.mainPid, bootReceipt.status.systemd.mainPid);
  const waitBeforePolling = prepared.timer.dueAt - Date.now() - 1_000;
  if (waitBeforePolling > 0) await wait(waitBeforePolling);
  const signalWaiting = await waitFor(
    () => inspectRun(artifactPath, prepared.runId),
    (view) => view.workflowCursor?.disposition === 'SIGNAL_WAITING',
    'persisted timer fire and signal wait after reboot',
  );
  assert.equal(signalWaiting.run?.status, 'RUNNING');
  assertSameTimer(signalWaiting.timers?.[0], prepared.timer, 'FIRED');
  assert.ok(Number.isSafeInteger(signalWaiting.timers[0].firedAt));
  assert.ok(signalWaiting.timers[0].firedAt >= prepared.timer.dueAt);
  assert.equal(signalWaiting.signalWaits?.[0]?.status, 'WAITING');
  assert.equal(signalWaiting.signalWaits?.[0]?.signalId, SIGNAL_ID);
  const firstMarkers = readMarkers();
  assert.deepEqual(
    firstMarkers.map((entry) => entry.stepIndex),
    [0],
  );
  assert.equal(firstMarkers[0].bootId, prepared.bootId);

  const deliveryId = 'systemd-real-reboot-delivery';
  const signal = runArtifactJson(
    artifactPath,
    [
      'wharfie',
      'signal',
      '--run-id',
      prepared.runId,
      '--signal',
      SIGNAL_ID,
      '--delivery-id',
      deliveryId,
      '--payload',
      JSON.stringify({ markerPath: MARKER_PATH, stepIndex: 1 }),
      '--json',
    ],
    'post-reboot signal',
  );
  assert.equal(signal.outcome, 'accepted');
  assert.equal(signal.reused, false);
  const completed = await waitFor(
    () => inspectRun(artifactPath, prepared.runId),
    (view) =>
      view.run?.status === 'COMPLETED' &&
      view.workflowCursor?.disposition === 'COMPLETED',
    'post-reboot workflow completion',
  );
  assert.equal(completed.timers?.[0]?.status, 'FIRED');
  assert.equal(completed.signalWaits?.[0]?.status, 'CONSUMED');
  const completedMarkers = readMarkers();
  assert.deepEqual(
    completedMarkers.map((entry) => entry.stepIndex),
    [0, 1],
  );
  assert.equal(completedMarkers[0].bootId, prepared.bootId);
  assert.equal(completedMarkers[1].bootId, bootReceipt.bootId);

  let activation;
  try {
    activation = await proveActivationEvolution({
      source: prepared.activationArtifacts.source,
      target: prepared.activationArtifacts.target,
      failingTarget: prepared.activationArtifacts.failingTarget,
      installedPackageRoot: prepared.activationInspector.installedPackageRoot,
      faultInjection: prepared.faultInjection,
      storage: prepared.storage,
    });
  } catch (error) {
    captureServiceFailure(artifactPath, 'activation-evolution', error);
    throw error;
  }
  announce('activation-evolution-complete');
  assert.equal(
    bindActivationStoreBreakpoint(
      prepared.activationInspector.installedPackageRoot,
    ).sourceSha256,
    prepared.activationInspector.sourceSha256,
  );
  assert.deepEqual(inspectRun(artifactPath, prepared.runId), completed);
  assert.deepEqual(readMarkers(), completedMarkers);

  const beforeRestart = readServiceStatus(artifactPath);
  assertHealthy(beforeRestart);
  const restart = runArtifactJson(
    artifactPath,
    ['wharfie', 'service', 'restart', '--json'],
    'service restart',
  );
  assert.equal(restart.action, 'restart');
  assert.equal(restart.outcome, 'restarted');
  const afterRestart = readServiceStatus(artifactPath);
  assertHealthy(afterRestart);
  assert.notEqual(afterRestart.systemd.mainPid, beforeRestart.systemd.mainPid);
  assert.ok(afterRestart.runtime.generation > beforeRestart.runtime.generation);

  const stop = runArtifactJson(
    artifactPath,
    ['wharfie', 'service', 'stop', '--json'],
    'service stop',
  );
  assert.equal(stop.action, 'stop');
  assert.equal(stop.outcome, 'stopped');
  const stopped = readServiceStatus(artifactPath);
  assert.equal(stopped.health, 'stopped');
  assert.equal(stopped.systemd?.activeState, 'inactive');

  const start = runArtifactJson(
    artifactPath,
    ['wharfie', 'service', 'start', '--json'],
    'service start',
  );
  assert.equal(start.action, 'start');
  assert.equal(start.outcome, 'started');
  const afterStart = readServiceStatus(artifactPath);
  assertHealthy(afterStart);
  assert.ok(afterStart.runtime.generation > afterRestart.runtime.generation);

  const beforeUninstall = inspectRun(artifactPath, prepared.runId);
  const releaseBeforeUninstall = {
    artifactSha256: sha256File(prepared.release.artifactPath),
    recordSha256: sha256File(prepared.release.recordPath),
  };
  const uninstall = runArtifactJson(
    artifactPath,
    ['wharfie', 'service', 'uninstall', '--json'],
    'service uninstall',
  );
  assert.equal(uninstall.action, 'uninstall');
  assert.equal(uninstall.outcome, 'uninstalled');
  assert.equal(uninstall.health, 'absent');
  assert.equal(existsSync(uninstall.preserved?.state), true);
  assert.equal(existsSync(uninstall.preserved?.releases), true);
  assert.equal(
    existsSync(path.join(path.dirname(uninstall.preserved.state), 'current')),
    false,
  );
  assert.equal(
    existsSync(path.join(homedir(), '.config', 'systemd', 'user', UNIT_NAME)),
    false,
  );
  const absent = readServiceStatus(artifactPath);
  assert.equal(absent.health, 'absent');
  assert.equal(absent.installation?.state, 'uninstalled');
  const independentSystemd = readIndependentUninstallState();
  const afterUninstall = inspectRun(artifactPath, prepared.runId);
  assert.equal(afterUninstall.run?.status, 'COMPLETED');
  assert.equal(afterUninstall.workflowCursor?.disposition, 'COMPLETED');
  assert.deepEqual(afterUninstall, beforeUninstall);
  assert.deepEqual(
    {
      artifactSha256: sha256File(prepared.release.artifactPath),
      recordSha256: sha256File(prepared.release.recordPath),
    },
    releaseBeforeUninstall,
  );
  assert.deepEqual(releaseBeforeUninstall, {
    artifactSha256: prepared.release.artifactSha256,
    recordSha256: prepared.release.recordSha256,
  });
  for (const expectedPath of [
    prepared.storage.stateRoot,
    prepared.storage.controlPath,
    prepared.storage.payloadPath,
    prepared.storage.applicationStatePath,
    prepared.storage.releasesRoot,
  ]) {
    assert.equal(
      existsSync(expectedPath),
      true,
      `uninstall removed ${expectedPath}`,
    );
  }
  assert.deepEqual(readMarkers(), completedMarkers);

  removeBootObserver();
  const receipt = {
    schemaVersion: 2,
    kind: 'wharfie.systemd-proof.complete',
    commit: prepared.commit,
    completedAt: Date.now(),
    appId: APP_ID,
    artifactId: prepared.artifactId,
    revisionId: prepared.revisionId,
    artifact: prepared.artifact,
    package: prepared.package,
    toolchain: prepared.toolchain,
    runId: prepared.runId,
    boot: {
      before: prepared.bootId,
      after: bootReceipt.bootId,
      powerCycle: process.env.WHARFIE_SYSTEMD_PROOF_POWER_CYCLE,
      sessionsBeforeCheck: bootReceipt.sessionsBeforeCheck,
      automaticStart: bootReceipt.automaticStart,
      processId: bootReceipt.status.systemd.mainPid,
      generation: bootReceipt.status.runtime.generation,
    },
    crashReplacement: prepared.crashReplacement,
    activation,
    gracefulRestart: {
      beforeProcessId: beforeRestart.systemd.mainPid,
      afterProcessId: afterRestart.systemd.mainPid,
      beforeGeneration: beforeRestart.runtime.generation,
      afterGeneration: afterRestart.runtime.generation,
    },
    stopStart: {
      stoppedHealth: stopped.health,
      processId: afterStart.systemd.mainPid,
      generation: afterStart.runtime.generation,
    },
    workflow: {
      status: afterUninstall.run.status,
      disposition: afterUninstall.workflowCursor.disposition,
      timerStatus: afterUninstall.timers[0].status,
      timerId: afterUninstall.timers[0].timerId,
      scheduledAt: afterUninstall.timers[0].scheduledAt,
      dueAt: afterUninstall.timers[0].dueAt,
      firedAt: afterUninstall.timers[0].firedAt,
      signalStatus: afterUninstall.signalWaits[0].status,
      markerEntries: completedMarkers,
    },
    uninstall: {
      status: absent.installation.state,
      preserved: uninstall.preserved,
      inspectableAfterUninstall: true,
      release: releaseBeforeUninstall,
      systemd: independentSystemd,
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
    'Usage: verify-systemd-user-service-linux.js <prepare|verify> [repo-root]',
  );
}
