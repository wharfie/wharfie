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

/**
 * @typedef CommandResult
 * @property {number} status - Exit status.
 * @property {string} stdout - Standard output.
 * @property {string} stderr - Standard error.
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
function parseJsonResult(result, label) {
  assert.equal(result.status, 0, `${label} exited unsuccessfully`);
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
 * Build the current-target proof SEA from the committed fixture.
 * @param {string} repoRoot - Extracted repository root.
 * @returns {{artifactPath: string, artifact: Record<string, any>, revision: Record<string, any>, package: Readonly<Record<string, any>>}} - Package result.
 */
function packageProofArtifact(repoRoot) {
  const sourceFixture = path.join(
    repoRoot,
    'test',
    'fixtures',
    'apps',
    'systemd-service',
  );
  const consumerRoot = path.join(PROOF_ROOT, 'package-consumer');
  const fixture = path.join(consumerRoot, 'app');
  const outputDirectory = path.join(PROOF_ROOT, 'dist');
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
  cpSync(sourceFixture, fixture, { recursive: true });
  const fixtureManifestPath = path.join(fixture, 'wharfie.app.js');
  const fixtureManifest = readFileSync(fixtureManifestPath, 'utf8');
  const installedFixtureManifest = fixtureManifest.replace(
    '../../../../src/app.js',
    '@wharfie/wharfie/app',
  );
  assert.notEqual(installedFixtureManifest, fixtureManifest);
  writeFileSync(fixtureManifestPath, installedFixtureManifest);
  const packaged = createPackageTarball();
  let result;
  let packageEvidence;
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
    const installedPackageRoot = path.join(
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
    result = parseJsonResult(
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
      'installed-package proof artifact package',
    );
    packageEvidence = Object.freeze({
      name: installedMetadata.name,
      version: installedMetadata.version,
      tarballSha256: sha256File(packaged.tarballPath),
      packedFileCount: packaged.manifest.files.length,
    });
  } finally {
    packaged.cleanup();
  }
  assert.equal(result.artifacts?.length, 1);
  const artifact = result.artifacts[0];
  assert.equal(artifact.target?.platform, 'linux');
  assert.equal(artifact.target?.architecture, process.arch);
  assert.equal(artifact.target?.nodeVersion, process.versions.node);
  assert.equal(artifact.target?.libc, 'glibc');
  assert.equal(existsSync(artifact.path), true);
  assert.equal((statSync(artifact.path).mode & 0o111) !== 0, true);
  return {
    artifactPath: artifact.path,
    artifact,
    revision: result.revision,
    package: packageEvidence,
  };
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

  const packaged = packageProofArtifact(repoRoot);
  announce('packaged-consumer-sea');
  const storage = proofStorageLayout();
  const absent = readServiceStatus(packaged.artifactPath);
  assert.equal(absent.health, 'absent');
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
    schemaVersion: 1,
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
    package: packaged.package,
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
    schemaVersion: 1,
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
