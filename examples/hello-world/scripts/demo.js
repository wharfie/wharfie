import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { hello as canonicalHello } from '../app/hello.js';
import {
  hello,
  toDurableInput,
} from '../showcase/resumable-hello/app/hello.js';

const COMMAND_DIAGNOSTIC_TAIL = 8 * 1024;
const COMMAND_OUTPUT_LIMIT = 2 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 45_000;
const PACKAGE_TIMEOUT_MS = 240_000;
const POLL_TIMEOUT_MS = 20_000;
const CHILD_STOP_TIMEOUT_MS = 15_000;
const DEMO_PREFIX = 'wharfie-first-run-';
const ACCEPTANCE_PROOF_PREFIX = 'wharfie-magnetic-first-run-';
const ACCEPTANCE_BUILDER_ROOT_ENVIRONMENT_VARIABLE =
  'WHARFIE_MAGNETIC_ACCEPTANCE_BUILDER_ROOT';
const SUPPORTED_NODE_RANGE = '>=24.13.1 <25';
const RUN_NAME = 'first-run';
const DURABLE_APP_ID = 'resumable-hello';
const TAKEOVER_COORDINATOR_ID = 'magnetic-first-run-takeover';
const TAKEOVER_REQUEST_ID = 'magnetic-first-run-authority-replacement';
const UNSAFE_TERMINAL_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/gu;
const COORDINATOR_AUTHORITY_SNAPSHOT_KEYS = Object.freeze([
  'schemaVersion',
  'appId',
  'coordinatorId',
  'authorityId',
  'epoch',
  'status',
  'recordVersion',
  'acquisitionRequestId',
  'acquiredAt',
  'heartbeatAt',
  'releasedAt',
  'updatedAt',
  'lastRequestId',
]);

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptRoot, '..');
const canonicalAppRoot = path.join(projectRoot, 'app');
const canonicalManifestPath = path.join(canonicalAppRoot, 'wharfie.app.js');
const canonicalTestPath = path.join(projectRoot, 'test', 'hello.test.js');
const canonicalLocalPath = path.join(canonicalAppRoot, 'local.js');
const showcaseRoot = path.join(projectRoot, 'showcase', 'resumable-hello');
const showcaseAppRoot = path.join(showcaseRoot, 'app');
const showcaseTestPath = path.join(showcaseRoot, 'test', 'hello.test.js');
const packageJsonPath = path.join(projectRoot, 'package.json');
const wharfieCliPath = path.join(
  projectRoot,
  'node_modules',
  '@wharfie',
  'wharfie',
  'bin',
  'wharfie',
);

const activeChildren = new Map();
let interrupted;
let retainedTemporaryRoot;
let temporaryRoot;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function asError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

function failureMessages(error) {
  if (error instanceof AggregateError) {
    return error.errors.flatMap((nestedError) => failureMessages(nestedError));
  }
  return [asError(error).message];
}

function checkInterrupted() {
  if (interrupted) throw interrupted;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function formatMiB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function escapeUnicodeCodePoint(value) {
  const codePoint = value.codePointAt(0);
  if (codePoint === undefined) {
    throw new TypeError('Terminal-safe JSON received an empty code point.');
  }
  if (codePoint <= 0xffff) {
    return `\\u${codePoint.toString(16).padStart(4, '0')}`;
  }
  const scalar = codePoint - 0x10000;
  const high = 0xd800 + (scalar >> 10);
  const low = 0xdc00 + (scalar & 0x3ff);
  return `\\u${high.toString(16).padStart(4, '0')}\\u${low
    .toString(16)
    .padStart(4, '0')}`;
}

export function renderTerminalSafeJson(value) {
  const json = JSON.stringify(value);
  if (typeof json !== 'string') {
    throw new TypeError('Terminal-safe JSON requires a serializable value.');
  }
  return json.replace(UNSAFE_TERMINAL_CHARACTER, escapeUnicodeCodePoint);
}

function assertSupportedNodeVersion(actual, declaredRange) {
  invariant(
    declaredRange === SUPPORTED_NODE_RANGE,
    `package.json engines.node must remain ${SUPPORTED_NODE_RANGE}.`,
  );
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(actual);
  invariant(match, `Could not parse the current Node version ${actual}.`);
  const [, majorSource, minorSource, patchSource] = match;
  const [major, minor, patch] = [majorSource, minorSource, patchSource].map(
    Number,
  );
  invariant(
    major === 24 && (minor > 13 || (minor === 13 && patch >= 1)),
    `This demo requires Node ${SUPPORTED_NODE_RANGE}; found ${actual}.`,
  );
}

function createArtifactEnvironment(overrides) {
  /** @type {Record<string, string>} */
  const environment = {};
  const preservedNames = new Set([
    'COMSPEC',
    'HOME',
    'HOMEDRIVE',
    'HOMEPATH',
    'LANG',
    'LANGUAGE',
    'LOGNAME',
    'PATHEXT',
    'SYSTEMROOT',
    'TZ',
    'USER',
    'USERPROFILE',
    'WINDIR',
  ]);
  for (const [name, value] of Object.entries(process.env)) {
    const normalizedName = name.toUpperCase();
    if (
      typeof value === 'string' &&
      (preservedNames.has(normalizedName) || normalizedName.startsWith('LC_'))
    ) {
      environment[name] = value;
    }
  }
  return { ...environment, ...overrides };
}

async function hideDisposableAcceptanceBuilder() {
  const configured = process.env[ACCEPTANCE_BUILDER_ROOT_ENVIRONMENT_VARIABLE];
  if (!configured) return false;

  const [resolvedProjectRoot, resolvedConfiguredRoot, resolvedTemporaryRoot] =
    await Promise.all([
      realpath(projectRoot),
      realpath(configured),
      realpath(os.tmpdir()),
    ]);
  invariant(
    resolvedConfiguredRoot === resolvedProjectRoot,
    `${ACCEPTANCE_BUILDER_ROOT_ENVIRONMENT_VARIABLE} must identify this copied starter.`,
  );
  const proofRoot = path.dirname(resolvedProjectRoot);
  invariant(
    path.dirname(proofRoot) === resolvedTemporaryRoot &&
      path.basename(proofRoot).startsWith(ACCEPTANCE_PROOF_PREFIX),
    'Refusing to hide a builder outside a disposable magnetic proof root.',
  );

  const hiddenBuilderRoot = path.join(proofRoot, 'builder-hidden');
  await rename(resolvedProjectRoot, hiddenBuilderRoot);
  try {
    await access(resolvedProjectRoot);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return true;
    }
    throw error;
  }
  throw new Error('The disposable builder remained available after hiding it.');
}

function parseJson(stdout, label) {
  try {
    return JSON.parse(stdout.trim());
  } catch {
    throw new Error(`${label} did not emit one JSON document.`);
  }
}

function isBoundedOpaqueId(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    Buffer.byteLength(value, 'utf8') <= 512
  );
}

function hasExactKeys(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function assertCoordinatorAuthoritySnapshot(value, status, label) {
  const releasedAtIsValid =
    status === 'ACTIVE'
      ? value?.releasedAt === null
      : Number.isSafeInteger(value?.releasedAt) &&
        value.releasedAt >= value.heartbeatAt;
  invariant(
    hasExactKeys(value, COORDINATOR_AUTHORITY_SNAPSHOT_KEYS) &&
      value.schemaVersion === 1 &&
      value.appId === DURABLE_APP_ID &&
      isBoundedOpaqueId(value.coordinatorId) &&
      /^wca1_[A-Za-z0-9_-]{43}$/u.test(value.authorityId) &&
      Number.isSafeInteger(value.epoch) &&
      value.epoch > 0 &&
      value.status === status &&
      Number.isSafeInteger(value.recordVersion) &&
      value.recordVersion > 0 &&
      isBoundedOpaqueId(value.acquisitionRequestId) &&
      Number.isSafeInteger(value.acquiredAt) &&
      value.acquiredAt >= 0 &&
      Number.isSafeInteger(value.heartbeatAt) &&
      value.heartbeatAt >= value.acquiredAt &&
      releasedAtIsValid &&
      Number.isSafeInteger(value.updatedAt) &&
      value.updatedAt >= value.heartbeatAt &&
      (status !== 'RELEASED' || value.updatedAt >= value.releasedAt) &&
      isBoundedOpaqueId(value.lastRequestId),
    `${label} did not match the exact ${status} authority contract.`,
  );
  return value;
}

function sameCoordinatorAuthoritySnapshot(left, right) {
  return COORDINATOR_AUTHORITY_SNAPSHOT_KEYS.every(
    (key) => left[key] === right[key],
  );
}

function assertCoordinatorAuthorityInspection(value) {
  invariant(
    hasExactKeys(value, [
      'schemaVersion',
      'kind',
      'authority',
      'authoritative',
      'integrity',
      'scope',
      'observedAuthority',
    ]) &&
      value.schemaVersion === 1 &&
      value.kind === 'wharfie.coordinator-authority.inspection' &&
      value.authority === 'none' &&
      value.authoritative === false &&
      hasExactKeys(value.integrity, ['verified']) &&
      value.integrity.verified === true &&
      hasExactKeys(value.scope, ['appId']) &&
      value.scope.appId === DURABLE_APP_ID,
    'The operator did not return the exact non-authoritative coordinator inspection.',
  );
  return assertCoordinatorAuthoritySnapshot(
    value.observedAuthority,
    'ACTIVE',
    'The inspected killed-owner authority',
  );
}

function assertCoordinatorAuthorityTakeoverReceipt(value, inspection) {
  invariant(
    hasExactKeys(value, [
      'schemaVersion',
      'kind',
      'action',
      'applied',
      'scope',
      'releaseRequestId',
      'observedAuthority',
      'takeoverAuthority',
      'resultAuthority',
    ]) &&
      value.schemaVersion === 1 &&
      value.kind === 'wharfie.coordinator-authority.takeover' &&
      value.action === 'takeover-and-release' &&
      value.applied === true &&
      hasExactKeys(value.scope, ['appId']) &&
      value.scope.appId === DURABLE_APP_ID &&
      isBoundedOpaqueId(value.releaseRequestId),
    'The operator did not return the exact takeover-and-release receipt.',
  );
  const predecessor = assertCoordinatorAuthoritySnapshot(
    value.observedAuthority,
    'ACTIVE',
    'The takeover receipt predecessor',
  );
  invariant(
    sameCoordinatorAuthoritySnapshot(predecessor, inspection.observedAuthority),
    'The takeover receipt did not retain the exact inspected predecessor.',
  );
  const takeover = assertCoordinatorAuthoritySnapshot(
    value.takeoverAuthority,
    'ACTIVE',
    'The temporary takeover authority',
  );
  invariant(
    takeover.schemaVersion === predecessor.schemaVersion &&
      takeover.appId === DURABLE_APP_ID &&
      takeover.coordinatorId === TAKEOVER_COORDINATOR_ID &&
      takeover.authorityId !== predecessor.authorityId &&
      takeover.epoch === predecessor.epoch + 1 &&
      takeover.recordVersion === predecessor.recordVersion + 1 &&
      takeover.acquisitionRequestId === TAKEOVER_REQUEST_ID &&
      takeover.acquiredAt === takeover.heartbeatAt &&
      takeover.heartbeatAt === takeover.updatedAt &&
      takeover.lastRequestId === TAKEOVER_REQUEST_ID,
    'The takeover receipt did not install the exact temporary successor.',
  );
  const released = assertCoordinatorAuthoritySnapshot(
    value.resultAuthority,
    'RELEASED',
    'The released takeover authority',
  );
  invariant(
    released.schemaVersion === takeover.schemaVersion &&
      released.appId === takeover.appId &&
      released.coordinatorId === takeover.coordinatorId &&
      released.authorityId === takeover.authorityId &&
      released.epoch === takeover.epoch &&
      released.recordVersion === takeover.recordVersion + 1 &&
      released.acquisitionRequestId === takeover.acquisitionRequestId &&
      released.acquiredAt === takeover.acquiredAt &&
      released.heartbeatAt === takeover.heartbeatAt &&
      released.updatedAt === released.releasedAt &&
      released.lastRequestId === value.releaseRequestId,
    'The takeover receipt did not release the exact temporary successor.',
  );
}

function stopChild(child, signal = 'SIGKILL') {
  const metadata = activeChildren.get(child);
  if (!metadata || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (metadata.grouped && process.platform !== 'win32') {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch (error) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ESRCH'
    ) {
      throw error;
    }
  }
}

async function stopActiveChildren() {
  const children = [...activeChildren.keys()];
  const failures = [];
  for (const child of children) {
    try {
      stopChild(child);
    } catch (error) {
      failures.push(asError(error));
    }
  }

  const deadline = Date.now() + CHILD_STOP_TIMEOUT_MS;
  while (
    children.some((child) => activeChildren.has(child)) &&
    Date.now() < deadline
  ) {
    await delay(25);
  }
  const remaining = children.filter((child) => activeChildren.has(child));
  if (remaining.length > 0) {
    failures.push(
      new Error(
        `Timed out reaping ${remaining.length} demo child process(es).`,
      ),
    );
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      'Could not stop every demo child process.',
    );
  }
}

function capture(stream, state, child, writeThrough) {
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    state.value += chunk;
    writeThrough?.(chunk);
    if (Buffer.byteLength(state.value) > COMMAND_OUTPUT_LIMIT) {
      state.overflow = true;
      stopChild(child);
    }
  });
}

function waitForStreamEnd(stream) {
  return new Promise((resolve) => {
    stream.once('end', resolve);
    stream.once('close', resolve);
    stream.once('error', resolve);
  });
}

function startCommand(executable, args, options = {}) {
  checkInterrupted();
  const grouped = process.platform !== 'win32';
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
  const child = spawn(executable, args, {
    cwd: options.cwd ?? projectRoot,
    detached: grouped,
    env: options.env ?? process.env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  activeChildren.set(child, { grouped });

  const stdout = { value: '', overflow: false };
  const stderr = { value: '', overflow: false };
  capture(child.stdout, stdout, child, options.writeStdout);
  capture(child.stderr, stderr, child, options.writeStderr);
  const streamsEnded = Promise.all([
    waitForStreamEnd(child.stdout),
    waitForStreamEnd(child.stderr),
  ]);

  let result;
  let settled = false;
  let timedOut = false;
  let spawnError;
  const timer = setTimeout(() => {
    timedOut = true;
    stopChild(child);
  }, timeoutMs);

  const closed = new Promise((resolve) => {
    const finish = async (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await Promise.race([streamsEnded, delay(500)]);
      child.stdout.destroy();
      child.stderr.destroy();
      activeChildren.delete(child);
      result = {
        code,
        command: [executable, ...args],
        elapsedMs: Date.now() - startedAt,
        timeoutMs,
        signal,
        stdout: stdout.value,
        stderr: stderr.value,
        overflow: stdout.overflow || stderr.overflow,
        timedOut,
        error: spawnError,
      };
      resolve(result);
    };
    child.once('error', (error) => {
      spawnError = error;
      finish(null, null);
    });
    child.once('close', (code, signal) => {
      finish(code, signal);
    });
  });

  return {
    child,
    stdout,
    stderr,
    closed,
    get result() {
      return result;
    },
  };
}

function commandFailure(executable, result) {
  if (result.error) return asError(result.error);
  const rawDetail = (result.stderr || result.stdout || '').trim();
  const detail =
    rawDetail.length > COMMAND_DIAGNOSTIC_TAIL
      ? `…\n${rawDetail.slice(-COMMAND_DIAGNOSTIC_TAIL)}`
      : rawDetail;
  const command = (result.command ?? [executable])
    .map((value) => JSON.stringify(value))
    .join(' ');
  if (result.overflow) {
    return new Error(
      `${command} output exceeded 2 MiB${detail ? `:\n${detail}` : '.'}`,
    );
  }
  if (result.timedOut) {
    return new Error(
      `${command} timed out after ${(result.elapsedMs / 1000).toFixed(1)}s${detail ? `:\n${detail}` : '.'}`,
    );
  }
  return new Error(
    `${command} exited ${
      result.signal ? `from ${result.signal}` : `with status ${result.code}`
    }${detail ? `:\n${detail}` : '.'}`,
  );
}

async function runCommand(executable, args, options = {}) {
  const command = startCommand(executable, args, options);
  const result = await command.closed;
  if (interrupted) throw interrupted;
  if (
    result.error ||
    result.overflow ||
    result.timedOut ||
    result.code !== 0 ||
    result.signal
  ) {
    throw commandFailure(executable, result);
  }
  return result;
}

async function waitForOutput(command, pattern, label) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    checkInterrupted();
    if (pattern.test(command.stdout.value)) return;
    if (command.result)
      throw commandFailure(command.child.spawnfile, command.result);
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function crashCommand(command) {
  stopChild(command.child);
  const result = await command.closed;
  invariant(
    result.signal === 'SIGKILL' || result.code === 137,
    'The foreground run did not exit from the deliberate SIGKILL.',
  );
}

async function sha256Base64Url(filePath) {
  const bytes = await readFile(filePath);
  return createHash('sha256').update(bytes).digest('base64url');
}

function assertInspection(view, runId) {
  invariant(
    view?.schemaVersion === 8 &&
      view?.kind === 'wharfie.execution-ledger.run' &&
      view?.integrity?.verified === true &&
      view?.run?.runId === runId &&
      view?.run?.appId === DURABLE_APP_ID,
    'Wharfie returned an unexpected durable inspection.',
  );
}

function waitingEvidence(view) {
  invariant(view.run.status === 'RUNNING', 'The durable run is not RUNNING.');
  invariant(
    view.workflowCursor?.disposition === 'TIMER_WAITING' &&
      view.workflowCursor?.stepId === 'wait' &&
      view.workflowCursor?.stepIndex === 1 &&
      view.workflowCursor.outputs?.some(
        (output) => output.stepId === 'prepare',
      ),
    'The workflow did not retain preparation at its timer.',
  );
  const preparation = view.invocations.filter(
    (invocation) => invocation.activityId === 'prepare-greeting',
  );
  invariant(
    preparation.length === 1 && preparation[0].status === 'COMPLETED',
    'Preparation was not represented by one completed invocation.',
  );
  const attempts = view.attempts.filter(
    (attempt) => attempt.invocationId === preparation[0].invocationId,
  );
  invariant(
    attempts.length === 1 && attempts[0].status === 'COMPLETED',
    'Preparation was not represented by one completed physical attempt.',
  );
  const timers = view.timers.filter((timer) => timer.stepId === 'wait');
  invariant(
    timers.length === 1 && timers[0].status === 'WAITING',
    'The durable timer is not waiting.',
  );
  return {
    invocationId: preparation[0].invocationId,
    attemptId: attempts[0].attemptId,
    timerId: timers[0].timerId,
    scheduledAt: timers[0].scheduledAt,
    dueAt: timers[0].dueAt,
  };
}

function assertSameWaitingEvidence(before, after) {
  for (const key of [
    'invocationId',
    'attemptId',
    'timerId',
    'scheduledAt',
    'dueAt',
  ]) {
    invariant(
      after[key] === before[key],
      `The retained ${key} changed after the foreground crash.`,
    );
  }
}

function assertCompleted(view, runId, before) {
  assertInspection(view, runId);
  invariant(
    view.run.status === 'COMPLETED' &&
      view.workflowCursor?.disposition === 'COMPLETED',
    'The repeated foreground command did not complete the retained run.',
  );
  const timer = view.timers.find(
    (candidate) => candidate.timerId === before.timerId,
  );
  invariant(
    timer?.status === 'FIRED' && timer.dueAt === before.dueAt,
    'The repeated command did not fire the original durable timer.',
  );
  const preparations = view.invocations.filter(
    (invocation) => invocation.activityId === 'prepare-greeting',
  );
  const preparationAttempts = view.attempts.filter(
    (attempt) => attempt.invocationId === before.invocationId,
  );
  invariant(
    preparations.length === 1 &&
      preparations[0].invocationId === before.invocationId &&
      preparationAttempts.length === 1 &&
      preparationAttempts[0].attemptId === before.attemptId &&
      preparationAttempts[0].status === 'COMPLETED',
    'The committed preparation was repeated after restart.',
  );
  const completions = view.invocations.filter(
    (invocation) => invocation.activityId === 'say-hello',
  );
  invariant(
    completions.length === 1 && completions[0].status === 'COMPLETED',
    'The final greeting activity did not complete exactly once.',
  );
}

async function safelyRemoveTemporaryRoot(root) {
  const resolvedRoot = path.resolve(root);
  const resolvedTemporaryDirectory = path.resolve(os.tmpdir());
  invariant(
    path.dirname(resolvedRoot) === resolvedTemporaryDirectory &&
      path.basename(resolvedRoot).startsWith(DEMO_PREFIX),
    'Refusing to remove an unrecognized demo directory.',
  );
  await rm(resolvedRoot, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}

async function findPackagedArtifact(packageDir) {
  const entries = await readdir(packageDir, { withFileTypes: true });
  const artifacts = entries.filter(
    (entry) =>
      entry.isFile() &&
      entry.name.startsWith('resumable-hello-sha256-') &&
      !entry.name.endsWith('.artifact.json'),
  );
  invariant(
    artifacts.length === 1,
    'Packaging did not publish exactly one host artifact.',
  );
  return path.join(packageDir, artifacts[0].name);
}

async function runDemo() {
  const packageJson = parseJson(
    await readFile(packageJsonPath, 'utf8'),
    'package.json',
  );
  const supportedNodeRange = packageJson.engines?.node;
  assertSupportedNodeVersion(process.versions.node, supportedNodeRange);
  const nodeVersion = process.versions.node;
  await access(wharfieCliPath);

  const name = toDurableInput(process.argv.slice(2)).name;
  const expectedGreeting = hello(name);
  const expectedCanonicalGreeting = canonicalHello(name);
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), DEMO_PREFIX));
  const packageDir = path.join(temporaryRoot, 'package');
  const relocatedDir = path.join(temporaryRoot, 'away-from-source');
  const emptyPath = path.join(temporaryRoot, 'empty-path');
  const packageTemp = path.join(temporaryRoot, 'package-tmp');
  const packageDatabase = path.join(temporaryRoot, 'package-database.json');
  const packageStateDatabase = path.join(
    temporaryRoot,
    'package-state-database.json',
  );
  const runtimeTemp = path.join(temporaryRoot, 'runtime-tmp');
  const dataRoot = path.join(temporaryRoot, 'data');
  await Promise.all(
    [
      packageDir,
      relocatedDir,
      emptyPath,
      packageTemp,
      runtimeTemp,
      dataRoot,
    ].map(async (directory) => await mkdir(directory, { recursive: true })),
  );

  process.stdout.write('Wharfie magnetic first run\n\n');
  process.stdout.write('1. Start with the smallest Wharfie application\n');
  await runCommand(process.execPath, ['--test', canonicalTestPath]);
  const local = await runCommand(process.execPath, [canonicalLocalPath, name]);
  invariant(
    local.stdout === `${expectedCanonicalGreeting}\n`,
    'Canonical local CLI output changed.',
  );
  const manifestSource = await readFile(canonicalManifestPath, 'utf8');
  invariant(
    manifestSource.includes('defineApp({') &&
      manifestSource.includes("id: 'hello-world'") &&
      manifestSource.includes("main: './hello.js'"),
    'The canonical manifest is no longer the compact beginner contract.',
  );
  process.stdout.write(
    manifestSource
      .trimEnd()
      .split('\n')
      .map((line) => `   ${line}\n`)
      .join(''),
  );
  const manifestResult = await runCommand(process.execPath, [
    wharfieCliPath,
    'app',
    'manifest',
    canonicalAppRoot,
    '--no-pretty',
  ]);
  const manifest = parseJson(manifestResult.stdout, 'Wharfie manifest');
  invariant(
    manifest?.schemaVersion === 4 &&
      manifest?.app?.id === 'hello-world' &&
      manifest?.cli?.entrypoint?.kind === 'node' &&
      manifest?.cli?.entrypoint?.path === 'hello.js' &&
      manifest?.cli?.entrypoint?.export === 'main' &&
      manifest?.cli?.durable === undefined &&
      manifest?.activities === undefined &&
      manifest?.workflows === undefined &&
      manifest?.targets === undefined,
    'The compact canonical definition did not expand to the expected v4 contract.',
  );
  process.stdout.write(`   ${expectedCanonicalGreeting}\n`);
  process.stdout.write(
    '   ✓ Canonical test passed; two-field source expanded to strict v4\n\n',
  );

  process.stdout.write('2. Add durability, then package the host\n');
  await runCommand(process.execPath, ['--test', showcaseTestPath]);
  process.stdout.write(
    `$ wharfie app package ${showcaseAppRoot} --output-dir ${packageDir}\n`,
  );
  const packageStartedAt = process.hrtime.bigint();
  const packaged = await runCommand(
    process.execPath,
    [
      wharfieCliPath,
      'app',
      'package',
      showcaseAppRoot,
      '--output-dir',
      packageDir,
    ],
    {
      env: {
        ...process.env,
        TMPDIR: packageTemp,
        WHARFIE_DB_ADAPTER: 'vanilla',
        WHARFIE_DB_PATH: packageDatabase,
        WHARFIE_STATE_ADAPTER: 'vanilla',
        WHARFIE_STATE_DB_PATH: packageStateDatabase,
      },
      timeoutMs: PACKAGE_TIMEOUT_MS,
      writeStderr: (chunk) => process.stderr.write(chunk),
    },
  );
  const packageMilliseconds =
    Number(process.hrtime.bigint() - packageStartedAt) / 1e6;
  invariant(
    packaged.stdout.includes('✓ Packaged resumable-hello') &&
      packaged.stdout.includes('Next:') &&
      packaged.stdout.includes('wharfie run --name first-run'),
    'Wharfie did not emit the expected human package handoff.',
  );
  process.stdout.write(packaged.stdout);

  const packagedPath = await findPackagedArtifact(packageDir);
  process.stdout.write(
    `   ✓ Packaged in ${(packageMilliseconds / 1000).toFixed(1)}s\n`,
  );
  const artifactRecord = parseJson(
    await readFile(`${packagedPath}.artifact.json`, 'utf8'),
    'artifact record',
  );
  const packagedStats = await stat(packagedPath);
  invariant(
    artifactRecord?.target?.nodeVersion === nodeVersion &&
      artifactRecord?.target?.platform === process.platform &&
      artifactRecord?.target?.architecture === process.arch &&
      artifactRecord?.size === packagedStats.size &&
      artifactRecord?.byteDigest?.value ===
        (await sha256Base64Url(packagedPath)),
    'The packaged host artifact did not match its canonical sidecar.',
  );

  const relocatedArtifact = path.join(relocatedDir, 'hello');
  await copyFile(packagedPath, relocatedArtifact);
  await chmod(relocatedArtifact, 0o755);
  if (await hideDisposableAcceptanceBuilder()) {
    process.stdout.write(
      '   ✓ Hid the disposable builder and installed dependencies\n',
    );
  }
  const artifactEnvironment = createArtifactEnvironment({
    PATH: emptyPath,
    TMPDIR: runtimeTemp,
    TMP: runtimeTemp,
    TEMP: runtimeTemp,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    WHARFIE_DATA_ROOT: dataRoot,
  });
  const runArtifact = async (args, options = {}) =>
    await runCommand(relocatedArtifact, args, {
      cwd: relocatedDir,
      env: artifactEnvironment,
      ...options,
    });
  const ordinaryStartedAt = process.hrtime.bigint();
  const ordinary = await runArtifact([name]);
  const ordinaryMilliseconds =
    Number(process.hrtime.bigint() - ordinaryStartedAt) / 1e6;
  invariant(
    ordinary.stdout === `${expectedGreeting}\n`,
    'The relocated application output changed.',
  );
  invariant(
    (await readdir(dataRoot)).length === 0,
    'Ordinary application argv unexpectedly materialized durable runtime state.',
  );
  invariant(
    (await readdir(runtimeTemp)).length === 0,
    'Ordinary application argv unexpectedly extracted the durable runtime.',
  );
  process.stdout.write(
    `   ✓ Copied one ${formatMiB(packagedStats.size)} executable away from source\n`,
  );
  process.stdout.write(
    '   ✓ Ran it with Node absent from PATH and no durable extraction\n',
  );
  process.stdout.write(
    `   ${expectedGreeting} (${ordinaryMilliseconds.toFixed(0)} ms)\n\n`,
  );

  process.stdout.write(
    '3. Kill it, confirm authority replacement, then repeat the identical named invocation\n',
  );
  const foregroundArgs = ['wharfie', 'run', '--name', RUN_NAME, '--', name];
  const foregroundArgvJson = renderTerminalSafeJson([
    './hello',
    ...foregroundArgs,
  ]);
  process.stdout.write(
    `named invocation argv (JSON data): ${foregroundArgvJson}\n`,
  );
  const first = startCommand(relocatedArtifact, foregroundArgs, {
    cwd: relocatedDir,
    env: artifactEnvironment,
    writeStdout: (chunk) => process.stdout.write(chunk),
    writeStderr: (chunk) => process.stderr.write(chunk),
  });
  await waitForOutput(first, /◷ wait — durable timer,/, 'the durable timer');
  const runIdMatch = /new durable run first-run \(([^)]+)\)\./u.exec(
    first.stdout.value,
  );
  invariant(
    runIdMatch,
    'The named invocation did not report its retained run identity.',
  );
  const runId = runIdMatch[1];
  const readInspection = async () => {
    const inspected = await runArtifact([
      'wharfie',
      'inspect',
      '--run-id',
      runId,
      '--json',
    ]);
    const view = parseJson(inspected.stdout, 'Wharfie inspection');
    assertInspection(view, runId);
    return view;
  };
  const beforeCrash = waitingEvidence(await readInspection());
  const crashedPid = first.child.pid;
  await crashCommand(first);
  process.stdout.write(`   ✕ SIGKILL (pid ${crashedPid})\n`);

  const afterCrash = waitingEvidence(await readInspection());
  assertSameWaitingEvidence(beforeCrash, afterCrash);
  const remainingSeconds = Math.max(0, beforeCrash.dueAt - Date.now()) / 1000;
  process.stdout.write(
    `   ✓ Same preparation attempt and timer retained (${remainingSeconds.toFixed(1)}s remaining)\n\n`,
  );

  invariant(
    isBoundedOpaqueId(TAKEOVER_COORDINATOR_ID) &&
      isBoundedOpaqueId(TAKEOVER_REQUEST_ID),
    'The stable operator identities are not bounded IDs.',
  );
  process.stdout.write('$ ./hello wharfie coordinator inspect --json\n');
  const coordinatorInspectionResult = await runArtifact([
    'wharfie',
    'coordinator',
    'inspect',
    '--json',
  ]);
  const coordinatorInspection = parseJson(
    coordinatorInspectionResult.stdout,
    'Wharfie coordinator inspection',
  );
  const inspectedAuthority = assertCoordinatorAuthorityInspection(
    coordinatorInspection,
  );
  invariant(
    inspectedAuthority.coordinatorId !== TAKEOVER_COORDINATOR_ID &&
      inspectedAuthority.acquisitionRequestId !== TAKEOVER_REQUEST_ID,
    'The stable operator identities collided with the killed owner.',
  );
  const coordinatorInspectionFile = 'coordinator-inspection.json';
  const coordinatorInspectionPath = path.join(
    relocatedDir,
    coordinatorInspectionFile,
  );
  await writeFile(
    coordinatorInspectionPath,
    `${JSON.stringify(coordinatorInspection)}\n`,
    {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    },
  );
  const coordinatorInspectionStats = await stat(coordinatorInspectionPath);
  invariant(
    coordinatorInspectionStats.isFile() &&
      (coordinatorInspectionStats.mode & 0o777) === 0o600,
    'The retained coordinator inspection is not a private regular file.',
  );
  process.stdout.write(
    '   ✓ Operator inspected the exact non-authoritative ACTIVE authority\n',
  );

  const takeoverArgs = [
    'wharfie',
    'coordinator',
    'takeover',
    '--inspection-file',
    `./${coordinatorInspectionFile}`,
    '--coordinator-id',
    TAKEOVER_COORDINATOR_ID,
    '--request-id',
    TAKEOVER_REQUEST_ID,
    '--confirm-authority-replacement',
    '--json',
  ];
  process.stdout.write(
    `$ ./hello wharfie coordinator takeover --inspection-file ./${coordinatorInspectionFile} --coordinator-id ${TAKEOVER_COORDINATOR_ID} --request-id ${TAKEOVER_REQUEST_ID} --confirm-authority-replacement --json\n`,
  );
  const takeoverResult = await runArtifact(takeoverArgs);
  const takeoverReceipt = parseJson(
    takeoverResult.stdout,
    'Wharfie coordinator takeover',
  );
  assertCoordinatorAuthorityTakeoverReceipt(
    takeoverReceipt,
    coordinatorInspection,
  );
  process.stdout.write(
    '   ✓ Operator confirmed exact authority replacement and released its temporary successor\n\n',
  );

  process.stdout.write(
    `named invocation argv (JSON data): ${foregroundArgvJson}\n`,
  );
  const resumed = await runArtifact(foregroundArgs, {
    writeStdout: (chunk) => process.stdout.write(chunk),
    writeStderr: (chunk) => process.stderr.write(chunk),
  });
  invariant(
    resumed.stdout.includes(`↻ Resuming ${RUN_NAME}`) &&
      resumed.stdout.includes('✓ prepare — retained; not run again') &&
      resumed.stdout.includes(expectedGreeting) &&
      resumed.stdout.includes(`✓ Completed ${RUN_NAME}; result retained.`),
    'Repeating the identical named invocation did not visibly resume and complete.',
  );
  const completedView = await readInspection();
  assertCompleted(completedView, runId, beforeCrash);
  const retainedOutputResult = await runArtifact([
    'wharfie',
    'output',
    '--run-id',
    runId,
    '--confirm-sensitive-output',
    '--json',
  ]);
  const retainedOutput = parseJson(
    retainedOutputResult.stdout,
    'Wharfie retained output',
  );
  invariant(
    retainedOutput?.schemaVersion === 1 &&
      retainedOutput?.kind === 'wharfie.execution-ledger.run-output' &&
      retainedOutput?.authority === 'none' &&
      retainedOutput?.authoritative === false &&
      retainedOutput?.disclosure === 'application-sensitive-unredacted' &&
      retainedOutput?.integrity?.verified === true &&
      retainedOutput?.scope?.appId === 'resumable-hello' &&
      retainedOutput?.scope?.revisionId === completedView.run.revisionId &&
      retainedOutput?.scope?.runId === runId &&
      retainedOutput?.snapshot?.runKind === 'workflow' &&
      retainedOutput?.snapshot?.status === 'COMPLETED' &&
      retainedOutput?.outputs?.at(-1)?.stepId === 'say-hello' &&
      retainedOutput?.outputs?.at(-1)?.value === expectedGreeting &&
      retainedOutput?.terminal?.type === 'completed' &&
      retainedOutput?.terminal?.result === expectedGreeting,
    'A later process did not verify the retained terminal greeting.',
  );
  process.stdout.write(
    '   ✓ Later process verified the retained terminal output\n',
  );
  process.stdout.write(
    '   ✓ Original named run resumed and retained its result\n',
  );
  process.stdout.write(
    '   ✓ prepare-greeting: 1 invocation, 1 physical attempt\n',
  );
}

async function main() {
  const signalHandlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      if (interrupted) {
        process.removeListener(signal, handler);
        process.kill(process.pid, signal);
        return;
      }
      interrupted = new Error(`Interrupted by ${signal}.`);
      for (const child of activeChildren.keys()) stopChild(child, 'SIGTERM');
    };
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }

  let failure;
  try {
    await runDemo();
  } catch (error) {
    failure = asError(error);
  } finally {
    let childrenStopped = true;
    try {
      await stopActiveChildren();
    } catch (error) {
      childrenStopped = false;
      failure = failure
        ? new AggregateError([failure, error], 'Demo and cleanup failed.')
        : asError(error);
    }
    if (temporaryRoot && childrenStopped) {
      retainedTemporaryRoot = temporaryRoot;
      try {
        await safelyRemoveTemporaryRoot(temporaryRoot);
        retainedTemporaryRoot = undefined;
      } catch (error) {
        failure = failure
          ? new AggregateError([failure, error], 'Demo and cleanup failed.')
          : asError(error);
      }
    } else if (temporaryRoot) {
      retainedTemporaryRoot = temporaryRoot;
    }
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler);
    }
  }

  if (failure) {
    const messages = failureMessages(failure);
    process.stderr.write(`\nDemo failed: ${messages[0]}\n`);
    for (const message of messages.slice(1)) {
      process.stderr.write(`  - ${message}\n`);
    }
    if (retainedTemporaryRoot) {
      process.stderr.write(
        `Cleanup incomplete; temporary files retained at:\n${retainedTemporaryRoot}\n`,
      );
    }
    process.exitCode = 1;
  } else {
    process.stdout.write(
      '\n✓ The identical named invocation resumed committed work.\n',
    );
    process.stdout.write('✓ Disposable demo state was cleaned up.\n');
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
