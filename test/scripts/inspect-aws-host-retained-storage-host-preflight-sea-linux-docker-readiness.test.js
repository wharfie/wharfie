/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { compileAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessOperationForTest } from '../../scripts/inspect-aws-host-retained-storage-host-preflight-sea-linux-docker-readiness.js';
import { AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_TOOLING_PATHS } from '../../scripts/aws-host-retained-storage-host-preflight-sea-linux-docker-readiness.js';

jest.setTimeout(30_000);

const TEST_ROOT_PREFIX = path.join(os.tmpdir(), 'wharfie-v84-cli-tests-');
const REPOSITORY_ROOT = path.resolve(
  fileURLToPath(new URL('../../', import.meta.url)),
);
const CLI_PATH = path.join(
  REPOSITORY_ROOT,
  'scripts/inspect-aws-host-retained-storage-host-preflight-sea-linux-docker-readiness.js',
);
const IMAGE_ID = `sha256:${'a'.repeat(64)}`;
const SOURCE_COMMIT = 'c'.repeat(40);
const OBJECT_IDS =
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_TOOLING_PATHS.map(
    (_logicalPath, index) => `${'0'.repeat(39)}${index + 1}`,
  );
const CONTAINER_ID = 'd'.repeat(64);
const INVOCATION_ID = 'e'.repeat(32);
const CONTEXT_NAME = 'v84-test-context';
const REMOTE_DOCKER_HOST = 'tcp://foreign.example.invalid:2375';
const PROOF_KIND = 'aws-retained-storage-host-preflight-sea-linux-docker-proof';

/**
 * @typedef {{
 *   containerMode?: string,
 *   dirty?: boolean,
 *   hangGit?: boolean,
 * }} ScenarioOptions
 */

/**
 * @typedef {{
 *   root: string,
 *   bin: string,
 *   tmp: string,
 *   outputRoot: string,
 *   dockerConfig: string,
 *   tracePath: string,
 *   endpoint: string,
 *   config: {
 *     sourceCommit: string,
 *     imageId: string,
 *     containerId: string,
 *     invocationId: string,
 *     contextName: string,
 *     endpoint: string,
 *     containerMode: string,
 *     dirty: boolean,
 *     hangGit: boolean,
 *     foreignLabel: string,
 *   },
 * }} Scenario
 */

/**
 * @typedef {{
 *   tool: string,
 *   operation: string,
 *   argv: string[],
 *   cwd: string,
 *   environment: Record<string, string>,
 *   pid: number,
 *   rejected?: boolean,
 *   hang?: boolean,
 *   grandchildPid?: number,
 * }} TraceEntry
 */

/**
 * @typedef {{
 *   status: number | null,
 *   signal: NodeJS.Signals | null,
 *   stdout: Buffer,
 *   stderr: Buffer,
 * }} CliResult
 */

/** @type {string | undefined} */
let testRoot;
/** @type {string | undefined} */
let fixtureRoot;
/** @type {Set<Scenario>} */
const createdScenarios = new Set();
/** @type {Set<import('node:child_process').ChildProcess>} */
const activeCliChildren = new Set();

const DOCKER_INFO_FORMAT =
  '{"operatingSystem":{{json .OSType}},"architecture":{{json .Architecture}},"cpuCount":{{json (printf "%d" .NCPU)}},"memoryBytes":{{json (printf "%d" .MemTotal)}},"serverVersion":{{json .ServerVersion}}}';
const DOCKER_IMAGE_FORMAT =
  '{"id":{{json .Id}},"operatingSystem":{{json .Os}},"architecture":{{json .Architecture}},"rootfsType":{{json .RootFS.Type}},"rootfsLayers":{{json .RootFS.Layers}}}';
const DOCKER_CONTAINER_FORMAT =
  `{"containerId":{{json .Id}},"name":{{json .Name}},"imageId":{{json .Image}},"running":{{json .State.Running}},` +
  '"kind":{{if .Config.Labels}}{{json (index .Config.Labels "org.wharfie.proof.kind")}}{{else}}null{{end}},' +
  '"sourceCommit":{{if .Config.Labels}}{{json (index .Config.Labels "org.wharfie.proof.sourceCommit")}}{{else}}null{{end}},' +
  '"toolingCommit":{{if .Config.Labels}}{{json (index .Config.Labels "org.wharfie.proof.toolingCommit")}}{{else}}null{{end}},' +
  '"invocationId":{{if .Config.Labels}}{{json (index .Config.Labels "org.wharfie.proof.invocationId")}}{{else}}null{{end}}}';

const FORBIDDEN_DOCKER_TOKENS = Object.freeze([
  'run',
  'create',
  'start',
  'stop',
  'kill',
  'rm',
  'pull',
  'build',
  'prune',
  'volume',
  'network',
  'system',
]);
const FORBIDDEN_GIT_TOKENS = Object.freeze([
  'bundle',
  'fetch',
  'pull',
  'push',
  'checkout',
  'reset',
  'clean',
  'gc',
  'repack',
  'commit',
]);

/** @returns {Array<Record<string, any>>} */
function expectedOperations() {
  const endpoint = 'unix:///private/tmp/wharfie-v84-test-docker.sock';
  return [
    { kind: 'git-status' },
    { kind: 'git-head' },
    {
      kind: 'git-ls-tree',
      commit: SOURCE_COMMIT,
      logicalPath:
        AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_TOOLING_PATHS[0],
    },
    { kind: 'git-cat-file', objectId: OBJECT_IDS[0] },
    { kind: 'docker-context-show' },
    { kind: 'docker-context-endpoint', contextName: CONTEXT_NAME },
    { kind: 'docker-info', endpoint },
    { kind: 'docker-image-inspect', endpoint, imageId: IMAGE_ID },
    {
      kind: 'docker-container-list',
      endpoint,
      containerName: `wharfie-sea-proof-${SOURCE_COMMIT}`,
    },
    {
      kind: 'docker-container-inspect',
      endpoint,
      containerId: CONTAINER_ID,
    },
  ];
}

/** @param {unknown} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object' || Buffer.isBuffer(value)) {
    return;
  }
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(
    /** @type {Record<string, unknown>} */ (value),
  )) {
    expectDeepFrozen(child);
  }
}

/**
 * @template T
 * @param {Readonly<Record<string, string | undefined>>} values
 * @param {() => T} callback
 * @returns {T}
 */
function withEnvironment(values, callback) {
  const previous = new Map(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function fakeGitSource() {
  return `#!${process.execPath}
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const toolingPaths = ${JSON.stringify(
    AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_TOOLING_PATHS,
  )};
const objectIds = ${JSON.stringify(OBJECT_IDS)};
const home = process.env.HOME;
const config = JSON.parse(fs.readFileSync(path.join(home, 'fake-config.json'), 'utf8'));
const argv = process.argv.slice(2);
const tracePath = path.join(home, 'trace.jsonl');
const environment = Object.fromEntries(
  Object.entries(process.env)
    .filter(([key]) => key.startsWith('GIT_') || ['PATH', 'HOME', 'LANG', 'LC_ALL'].includes(key))
    .sort(([left], [right]) => left.localeCompare(right)),
);
function operationName() {
  for (const name of ['status', 'rev-parse', 'ls-tree', 'cat-file']) {
    if (argv.includes(name)) return name;
  }
  return 'unsupported';
}
function record(extra = {}) {
  fs.appendFileSync(
    tracePath,
    JSON.stringify({tool: 'git', operation: operationName(), argv, cwd: process.cwd(), environment, pid: process.pid, ...extra}) + '\\n',
    'utf8',
  );
}
function fail() {
  record({rejected: true});
  process.stderr.write('fake git rejected unsupported argv\\n');
  process.exitCode = 64;
}
function main() {
  const operation = operationName();
  if (config.hangGit === true && (operation === 'status' || operation === 'rev-parse')) {
    const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    record({hang: true, grandchildPid: grandchild.pid});
    setInterval(() => {}, 1000);
    return;
  }
  record();
  if (operation === 'status') {
    if (config.dirty === true) process.stdout.write('?? local-change\\0');
    return;
  }
  if (operation === 'rev-parse') {
    process.stdout.write(config.sourceCommit + '\\n');
    return;
  }
  if (operation === 'ls-tree') {
    const logicalPath = argv.at(-1);
    const index = toolingPaths.indexOf(logicalPath);
    if (index < 0 || !argv.includes(config.sourceCommit)) return fail();
    process.stdout.write('100644 blob ' + objectIds[index] + '\\t' + logicalPath + '\\0');
    return;
  }
  if (operation === 'cat-file') {
    const objectId = argv.at(-1);
    const index = objectIds.indexOf(objectId);
    if (index < 0) return fail();
    process.stdout.write(fs.readFileSync(path.join(process.cwd(), toolingPaths[index])));
    return;
  }
  fail();
}
main();
`;
}

function fakeDockerSource() {
  return `#!${process.execPath}
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const home = process.env.HOME;
const config = JSON.parse(fs.readFileSync(path.join(home, 'fake-config.json'), 'utf8'));
const argv = process.argv.slice(2);
const tracePath = path.join(home, 'trace.jsonl');
const environment = Object.fromEntries(
  Object.entries(process.env)
    .filter(([key]) => key.startsWith('DOCKER_') || ['PATH', 'HOME', 'LANG', 'LC_ALL'].includes(key))
    .sort(([left], [right]) => left.localeCompare(right)),
);
function operationName() {
  if (argv[0] === 'context' && argv[1] === 'show') return 'context-show';
  if (argv[0] === 'context' && argv[1] === 'inspect') return 'context-inspect';
  if (argv.includes('info')) return 'info';
  if (argv.includes('image') && argv.includes('inspect')) return 'image-inspect';
  if (argv.includes('container') && argv.includes('ls')) return 'container-list';
  if (argv.includes('container') && argv.includes('inspect')) return 'container-inspect';
  return 'unsupported';
}
function record(extra = {}) {
  fs.appendFileSync(
    tracePath,
    JSON.stringify({tool: 'docker', operation: operationName(), argv, cwd: process.cwd(), environment, pid: process.pid, ...extra}) + '\\n',
    'utf8',
  );
}
function jsonLine(value) {
  process.stdout.write(JSON.stringify(value) + '\\n');
}
function fail() {
  record({rejected: true});
  process.stderr.write('fake docker rejected unsupported argv\\n');
  process.exitCode = 64;
}
function main() {
  const operation = operationName();
  record();
  if (operation === 'context-show') {
    process.stdout.write(config.contextName + '\\n');
    return;
  }
  if (operation === 'context-inspect') {
    if (argv.at(-1) !== config.contextName) return fail();
    jsonLine(config.endpoint);
    return;
  }
  if (operation === 'info') {
    jsonLine({
      operatingSystem: 'linux',
      architecture: 'amd64',
      cpuCount: '4',
      memoryBytes: '6442450944',
      serverVersion: '28.3.2',
    });
    return;
  }
  if (operation === 'image-inspect') {
    jsonLine({
      id: config.imageId,
      operatingSystem: 'linux',
      architecture: 'amd64',
      rootfsType: 'layers',
      rootfsLayers: ['sha256:' + 'f'.repeat(64)],
    });
    return;
  }
  if (operation === 'container-list') {
    if (config.containerMode !== 'absent') jsonLine(config.containerId);
    return;
  }
  if (operation === 'container-inspect') {
    jsonLine({
      containerId: config.containerId,
      name: '/wharfie-sea-proof-' + config.sourceCommit,
      imageId: config.imageId,
      running: config.containerMode === 'running',
      kind: '${PROOF_KIND}',
      sourceCommit: config.sourceCommit,
      toolingCommit: config.sourceCommit,
      invocationId: config.invocationId,
    });
    return;
  }
  fail();
}
main();
`;
}

/** @returns {string} */
function requiredFixtureRoot() {
  if (fixtureRoot === undefined) {
    throw new Error('The unique CLI fixture root has not been initialized.');
  }
  return fixtureRoot;
}

/**
 * @param {string} name
 * @param {ScenarioOptions} [options]
 * @returns {Promise<Scenario>}
 */
async function createScenario(name, options = {}) {
  const root = path.join(requiredFixtureRoot(), name);
  const bin = path.join(root, 'bin');
  const tmp = path.join(root, 'tmp');
  const outputRoot = path.join(root, 'output');
  const dockerConfig = path.join(root, 'docker-config');
  await Promise.all([
    fsp.mkdir(bin, { recursive: true, mode: 0o700 }),
    fsp.mkdir(tmp, { recursive: true, mode: 0o700 }),
    fsp.mkdir(outputRoot, { recursive: true, mode: 0o700 }),
    fsp.mkdir(dockerConfig, { recursive: true, mode: 0o700 }),
  ]);
  const endpoint = `unix://${path.join(root, 'docker.sock')}`;
  const config = {
    sourceCommit: SOURCE_COMMIT,
    imageId: IMAGE_ID,
    containerId: CONTAINER_ID,
    invocationId: INVOCATION_ID,
    contextName: CONTEXT_NAME,
    endpoint,
    containerMode: options.containerMode ?? 'absent',
    dirty: options.dirty ?? false,
    hangGit: options.hangGit ?? false,
    foreignLabel: 'WHARFIE_TEST_FOREIGN_LABEL_MUST_NOT_ESCAPE',
  };
  await Promise.all([
    fsp.writeFile(
      path.join(root, 'fake-config.json'),
      `${JSON.stringify(config)}\n`,
      { mode: 0o600 },
    ),
    fsp.writeFile(path.join(root, 'trace.jsonl'), '', { mode: 0o600 }),
    fsp.writeFile(path.join(bin, 'git'), fakeGitSource(), { mode: 0o700 }),
    fsp.writeFile(path.join(bin, 'docker'), fakeDockerSource(), {
      mode: 0o700,
    }),
  ]);
  await Promise.all([
    fsp.chmod(path.join(bin, 'git'), 0o700),
    fsp.chmod(path.join(bin, 'docker'), 0o700),
  ]);
  const scenario = {
    root,
    bin,
    tmp,
    outputRoot,
    dockerConfig,
    tracePath: path.join(root, 'trace.jsonl'),
    endpoint,
    config,
  };
  createdScenarios.add(scenario);
  return scenario;
}

/** @param {Scenario} scenario @returns {NodeJS.ProcessEnv} */
function cliEnvironment(scenario) {
  return {
    PATH: scenario.bin,
    HOME: scenario.root,
    TMPDIR: scenario.tmp,
    LANG: 'C',
    LC_ALL: 'C',
    DOCKER_CONTEXT: CONTEXT_NAME,
    DOCKER_HOST: REMOTE_DOCKER_HOST,
    DOCKER_CONFIG: scenario.dockerConfig,
    GIT_CONFIG_GLOBAL: path.join(scenario.root, 'ambient-git-config'),
    GIT_CONFIG_SYSTEM: path.join(scenario.root, 'ambient-system-config'),
    GIT_DIR: path.join(scenario.root, 'ambient-git-dir'),
    GIT_WORK_TREE: path.join(scenario.root, 'ambient-work-tree'),
    GIT_INDEX_FILE: path.join(scenario.root, 'ambient-index'),
    GIT_OBJECT_DIRECTORY: path.join(scenario.root, 'ambient-objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(
      scenario.root,
      'ambient-alternates',
    ),
    GIT_EXTERNAL_DIFF: path.join(scenario.root, 'ambient-diff'),
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.fsmonitor',
    GIT_CONFIG_VALUE_0: path.join(scenario.root, 'ambient-fsmonitor'),
    GIT_OPTIONAL_LOCKS: '1',
    GIT_NO_LAZY_FETCH: '0',
  };
}

/**
 * @param {Scenario} scenario
 * @param {NodeJS.ProcessEnv} [environmentOverrides]
 */
function spawnCli(scenario, environmentOverrides = {}) {
  const child = spawn(
    process.execPath,
    [CLI_PATH, IMAGE_ID, scenario.outputRoot],
    {
      cwd: REPOSITORY_ROOT,
      env: { ...cliEnvironment(scenario), ...environmentOverrides },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  activeCliChildren.add(child);
  child.once('close', () => activeCliChildren.delete(child));
  const maximumBytes = 256 * 1024;
  /** @type {Buffer[]} */
  const stdout = [];
  /** @type {Buffer[]} */
  const stderr = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  /** @type {Promise<CliResult>} */
  const completion = new Promise((resolve, reject) => {
    let settled = false;
    let cleaningFailure = false;
    /** @param {unknown} error */
    async function rejectAfterEmergencyCleanup(error) {
      if (settled || cleaningFailure) return;
      cleaningFailure = true;
      clearTimeout(timeout);
      try {
        child.kill('SIGKILL');
      } catch {
        // The bounded close wait and traced-process cleanup remain authoritative.
      }
      /** @type {unknown} */
      let cleanupError;
      try {
        await waitForCliChildExit(child);
        await cleanupTracedFakeProcesses(scenario);
      } catch (caught) {
        cleanupError = caught;
      }
      settled = true;
      reject(
        cleanupError === undefined
          ? error
          : new AggregateError(
              [error, cleanupError],
              'Fake readiness CLI failure cleanup was incomplete.',
            ),
      );
    }
    /** @param {unknown} error */
    const beginEmergencyCleanup = (error) => {
      rejectAfterEmergencyCleanup(error).catch((cleanupFailure) => {
        if (settled) return;
        settled = true;
        reject(cleanupFailure);
      });
    };
    const timeout = setTimeout(() => {
      beginEmergencyCleanup(
        new Error('Fake readiness CLI exceeded its test timeout.'),
      );
    }, 20_000);
    child.once('error', (error) => {
      beginEmergencyCleanup(error);
    });
    child.stdout.on('data', (chunk) => {
      if (cleaningFailure) return;
      const bytes = Buffer.from(chunk);
      stdoutBytes += bytes.length;
      if (stdoutBytes + stderrBytes > maximumBytes) {
        beginEmergencyCleanup(
          new Error('Fake readiness CLI emitted oversized output.'),
        );
        return;
      }
      stdout.push(bytes);
    });
    child.stderr.on('data', (chunk) => {
      if (cleaningFailure) return;
      const bytes = Buffer.from(chunk);
      stderrBytes += bytes.length;
      if (stdoutBytes + stderrBytes > maximumBytes) {
        beginEmergencyCleanup(
          new Error('Fake readiness CLI emitted oversized output.'),
        );
        return;
      }
      stderr.push(bytes);
    });
    child.once('close', (status, signal) => {
      if (settled || cleaningFailure) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        status,
        signal,
        stdout: Buffer.concat(stdout, stdoutBytes),
        stderr: Buffer.concat(stderr, stderrBytes),
      });
    });
  });
  return { child, completion };
}

/** @param {string} tracePath @returns {Promise<TraceEntry[]>} */
async function readTrace(tracePath) {
  const text = await fsp.readFile(tracePath, 'utf8');
  if (text.length === 0) return [];
  expect(text.endsWith('\n')).toBe(true);
  return text
    .slice(0, -1)
    .split('\n')
    .map((line) => JSON.parse(line));
}

/**
 * @param {() => any | Promise<any>} value
 * @param {number} [timeoutMs]
 * @returns {Promise<any>}
 */
async function waitFor(value, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await value();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for bounded fake-child state.');
}

/** @param {number} pid @returns {boolean} */
function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (hasErrorCode(error, 'ESRCH')) return false;
    throw error;
  }
}

/**
 * @param {import('node:child_process').ChildProcess} child
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
async function waitForCliChildExit(child, timeoutMs = 2_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.removeListener('close', handleClose);
      reject(new Error('Timed out reaping the fake readiness CLI.'));
    }, timeoutMs);
    const handleClose = () => {
      clearTimeout(timeout);
      resolve(undefined);
    };
    child.once('close', handleClose);
  });
}

/**
 * @param {unknown} error
 * @param {string} expectedCode
 * @returns {boolean}
 */
function hasErrorCode(error, expectedCode) {
  return (
    typeof error === 'object' &&
    error !== null &&
    /** @type {{code?: unknown}} */ (error).code === expectedCode
  );
}

/**
 * @param {number} pid
 * @param {boolean} processGroup
 * @returns {void}
 */
function forceKill(pid, processGroup) {
  try {
    process.kill(processGroup ? -pid : pid, 'SIGKILL');
  } catch (error) {
    if (!hasErrorCode(error, 'ESRCH')) throw error;
  }
}

/**
 * @param {string} tracePath
 * @returns {Promise<{groupPids: number[], allPids: number[]}>}
 */
async function readHangingFakeProcessIds(tracePath) {
  let traceText;
  try {
    traceText = await fsp.readFile(tracePath, 'utf8');
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return { groupPids: [], allPids: [] };
    }
    throw error;
  }
  /** @type {Set<number>} */
  const groupPids = new Set();
  /** @type {Set<number>} */
  const allPids = new Set();
  for (const line of traceText.split('\n')) {
    if (line.length === 0) continue;
    /** @type {Record<string, unknown>} */
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.tool !== 'git' || entry.hang !== true) continue;
    if (Number.isSafeInteger(entry.pid) && Number(entry.pid) > 1) {
      groupPids.add(Number(entry.pid));
      allPids.add(Number(entry.pid));
    }
    if (
      Number.isSafeInteger(entry.grandchildPid) &&
      Number(entry.grandchildPid) > 1
    ) {
      allPids.add(Number(entry.grandchildPid));
    }
  }
  return {
    groupPids: [...groupPids],
    allPids: [...allPids],
  };
}

/**
 * @param {Scenario} scenario
 * @returns {Promise<void>}
 */
async function cleanupTracedFakeProcesses(scenario) {
  const { groupPids, allPids } = await readHangingFakeProcessIds(
    scenario.tracePath,
  );
  if (!allPids.some(processExists)) return;
  for (const pid of groupPids) forceKill(pid, true);
  try {
    await waitFor(() => allPids.every((pid) => !processExists(pid)), 1_000);
    return;
  } catch {
    // Fall back to each traced PID if its detached process group survived.
  }
  for (const pid of allPids) forceKill(pid, false);
  await waitFor(() => allPids.every((pid) => !processExists(pid)), 1_000);
}

/**
 * @param {import('node:child_process').ChildProcess} child
 * @returns {Promise<void>}
 */
async function cleanupCliChild(child) {
  if (child.exitCode === null && child.signalCode === null) {
    try {
      child.kill('SIGKILL');
    } catch {
      // The bounded close wait remains authoritative.
    }
  }
  await waitForCliChildExit(child);
}

/**
 * @param {TraceEntry} entry
 * @param {Scenario} scenario
 * @returns {Record<string, any>}
 */
function compilerOperationForTrace(entry, scenario) {
  if (entry.tool === 'git') {
    if (entry.operation === 'status') return { kind: 'git-status' };
    if (entry.operation === 'rev-parse') return { kind: 'git-head' };
    if (entry.operation === 'ls-tree') {
      return {
        kind: 'git-ls-tree',
        commit: SOURCE_COMMIT,
        logicalPath: entry.argv.at(-1),
      };
    }
    if (entry.operation === 'cat-file') {
      return { kind: 'git-cat-file', objectId: entry.argv.at(-1) };
    }
  }
  if (entry.tool === 'docker') {
    if (entry.operation === 'context-show') {
      return { kind: 'docker-context-show' };
    }
    if (entry.operation === 'context-inspect') {
      return {
        kind: 'docker-context-endpoint',
        contextName: CONTEXT_NAME,
      };
    }
    if (entry.operation === 'info') {
      return { kind: 'docker-info', endpoint: scenario.endpoint };
    }
    if (entry.operation === 'image-inspect') {
      return {
        kind: 'docker-image-inspect',
        endpoint: scenario.endpoint,
        imageId: IMAGE_ID,
      };
    }
    if (entry.operation === 'container-list') {
      return {
        kind: 'docker-container-list',
        endpoint: scenario.endpoint,
        containerName: `wharfie-sea-proof-${SOURCE_COMMIT}`,
      };
    }
    if (entry.operation === 'container-inspect') {
      return {
        kind: 'docker-container-inspect',
        endpoint: scenario.endpoint,
        containerId: CONTAINER_ID,
      };
    }
  }
  throw new Error(
    `Unexpected fake operation ${entry.tool}:${entry.operation}.`,
  );
}

/**
 * @param {TraceEntry[]} trace
 * @param {string} tool
 * @param {string} operation
 * @returns {number}
 */
function countTrace(trace, tool, operation) {
  return trace.filter(
    (entry) => entry.tool === tool && entry.operation === operation,
  ).length;
}

/**
 * @param {TraceEntry[]} trace
 * @param {Scenario} scenario
 * @param {number} expectedContainerInspections
 * @returns {void}
 */
function expectExactTrace(trace, scenario, expectedContainerInspections) {
  for (const entry of trace) {
    const operation = compilerOperationForTrace(entry, scenario);
    const descriptor =
      compileAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessOperationForTest(
        operation,
      );
    expect(entry.argv).toEqual(descriptor.argv);
    expect(entry.cwd).toBe(REPOSITORY_ROOT);
    expect(entry.rejected).not.toBe(true);
  }
  expect(countTrace(trace, 'git', 'status')).toBe(2);
  expect(countTrace(trace, 'git', 'rev-parse')).toBe(2);
  expect(countTrace(trace, 'git', 'ls-tree')).toBe(
    AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_TOOLING_PATHS.length *
      2,
  );
  expect(countTrace(trace, 'git', 'cat-file')).toBe(
    AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_TOOLING_PATHS.length *
      2,
  );
  expect(countTrace(trace, 'docker', 'context-show')).toBe(0);
  expect(countTrace(trace, 'docker', 'context-inspect')).toBe(1);
  expect(countTrace(trace, 'docker', 'info')).toBe(1);
  expect(countTrace(trace, 'docker', 'image-inspect')).toBe(2);
  expect(countTrace(trace, 'docker', 'container-list')).toBe(1);
  expect(countTrace(trace, 'docker', 'container-inspect')).toBe(
    expectedContainerInspections,
  );
}

beforeAll(async () => {
  testRoot = await fsp.mkdtemp(TEST_ROOT_PREFIX);
  fixtureRoot = path.join(testRoot, 'readiness-fixtures');
});

afterAll(async () => {
  /** @type {unknown[]} */
  const cleanupFailures = [];
  for (const child of activeCliChildren) {
    try {
      await cleanupCliChild(child);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  for (const scenario of createdScenarios) {
    try {
      await cleanupTracedFakeProcesses(scenario);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  const root = testRoot;
  if (root === undefined) {
    cleanupFailures.push(
      new Error('The unique CLI fixture root was never initialized.'),
    );
  } else {
    try {
      await fsp.rm(root, { recursive: true, force: true });
      await expect(fsp.lstat(root)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  activeCliChildren.clear();
  createdScenarios.clear();
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      cleanupFailures,
      'The fake readiness CLI harness did not clean up completely.',
    );
  }
});

describe('AWS retained-storage host-preflight SEA Linux Docker readiness production adapter', () => {
  it('compiles only the exact positive read-operation allowlist', () => {
    const descriptors = withEnvironment(
      {
        PATH: '/bounded/test/bin',
        HOME: '/bounded/test/home',
        DOCKER_CONFIG: '/bounded/test/docker-config',
      },
      () =>
        expectedOperations().map((operation) =>
          compileAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessOperationForTest(
            operation,
          ),
        ),
    );

    expect(descriptors.map(({ command }) => command)).toEqual([
      'git',
      'git',
      'git',
      'git',
      'docker',
      'docker',
      'docker',
      'docker',
      'docker',
      'docker',
    ]);
    expect(descriptors[0].argv).toEqual([
      '--no-pager',
      '--no-optional-locks',
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.untrackedCache=false',
      '-c',
      'core.hooksPath=/dev/null',
      '-C',
      REPOSITORY_ROOT,
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--ignore-submodules=none',
      '--no-renames',
    ]);
    expect(descriptors[1].argv).toEqual([
      '--no-pager',
      '--no-optional-locks',
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.untrackedCache=false',
      '-c',
      'core.hooksPath=/dev/null',
      '-C',
      REPOSITORY_ROOT,
      'rev-parse',
      '--verify',
      'HEAD^{commit}',
    ]);
    expect(descriptors[2].argv).toEqual([
      '--no-pager',
      '--no-optional-locks',
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.untrackedCache=false',
      '-c',
      'core.hooksPath=/dev/null',
      '-C',
      REPOSITORY_ROOT,
      'ls-tree',
      '--full-tree',
      '-z',
      SOURCE_COMMIT,
      '--',
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_TOOLING_PATHS[0],
    ]);
    expect(descriptors[3].argv).toEqual([
      '--no-pager',
      '--no-optional-locks',
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.untrackedCache=false',
      '-c',
      'core.hooksPath=/dev/null',
      '-C',
      REPOSITORY_ROOT,
      'cat-file',
      'blob',
      OBJECT_IDS[0],
    ]);
    expect(descriptors[4].argv).toEqual(['context', 'show']);
    expect(descriptors[5].argv).toEqual([
      'context',
      'inspect',
      '--format',
      '{{json .Endpoints.docker.Host}}',
      CONTEXT_NAME,
    ]);
    expect(descriptors[6].argv).toEqual([
      '--host',
      'unix:///private/tmp/wharfie-v84-test-docker.sock',
      'info',
      '--format',
      DOCKER_INFO_FORMAT,
    ]);
    expect(descriptors[7].argv).toEqual([
      '--host',
      'unix:///private/tmp/wharfie-v84-test-docker.sock',
      'image',
      'inspect',
      '--format',
      DOCKER_IMAGE_FORMAT,
      IMAGE_ID,
    ]);
    expect(descriptors[8].argv).toEqual([
      '--host',
      'unix:///private/tmp/wharfie-v84-test-docker.sock',
      'container',
      'ls',
      '--all',
      '--no-trunc',
      '--filter',
      `name=^/wharfie-sea-proof-${SOURCE_COMMIT}$`,
      '--format',
      '{{json .ID}}',
    ]);
    expect(descriptors[9].argv).toEqual([
      '--host',
      'unix:///private/tmp/wharfie-v84-test-docker.sock',
      'container',
      'inspect',
      '--format',
      DOCKER_CONTAINER_FORMAT,
      CONTAINER_ID,
    ]);
    for (const descriptor of descriptors) {
      expect(descriptor.cwd).toBe(REPOSITORY_ROOT);
      expect(descriptor.timeoutMs).toBe(30_000);
      expect(descriptor.maximumOutputBytes).toBeGreaterThan(0);
      expectDeepFrozen(descriptor);
    }
  });

  it('scrubs ambient Git configuration and preserves only fixed inert Git controls', () => {
    const descriptor = withEnvironment(
      {
        PATH: '/bounded/test/bin',
        HOME: '/bounded/test/home',
        GIT_CONFIG_NOSYSTEM: '0',
        GIT_CONFIG_GLOBAL: '/ambient/global',
        GIT_CONFIG_SYSTEM: '/ambient/system',
        GIT_NO_LAZY_FETCH: '0',
        GIT_NO_REPLACE_OBJECTS: '0',
        GIT_OPTIONAL_LOCKS: '1',
        GIT_TERMINAL_PROMPT: '1',
        GIT_DIR: '/ambient/repository',
        GIT_WORK_TREE: '/ambient/worktree',
        GIT_INDEX_FILE: '/ambient/index',
        GIT_OBJECT_DIRECTORY: '/ambient/objects',
        GIT_ALTERNATE_OBJECT_DIRECTORIES: '/ambient/alternates',
        GIT_EXTERNAL_DIFF: '/ambient/diff',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.fsmonitor',
        GIT_CONFIG_VALUE_0: '/ambient/fsmonitor',
      },
      () =>
        compileAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessOperationForTest(
          { kind: 'git-status' },
        ),
    );

    expect(descriptor.env).toEqual({
      PATH: '/bounded/test/bin',
      HOME: '/bounded/test/home',
      LANG: 'C',
      LC_ALL: 'C',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_NO_LAZY_FETCH: '1',
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0',
    });
    expect(descriptor.env).not.toHaveProperty('GIT_CONFIG_SYSTEM');
    expect(descriptor.env).not.toHaveProperty('GIT_DIR');
    expect(descriptor.env).not.toHaveProperty('GIT_WORK_TREE');
    expect(descriptor.env).not.toHaveProperty('GIT_INDEX_FILE');
    expect(descriptor.env).not.toHaveProperty('GIT_CONFIG_COUNT');
  });

  it('uses narrow Docker formats and never requests raw inspect objects', () => {
    const descriptors = expectedOperations()
      .filter(({ kind }) => kind.startsWith('docker-'))
      .map((operation) =>
        compileAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessOperationForTest(
          operation,
        ),
      );

    for (const descriptor of descriptors) {
      expect(descriptor.argv).not.toContain('{{json .}}');
      expect(descriptor.argv.join('\n')).not.toContain('.Config.Env');
      expect(descriptor.argv.join('\n')).not.toContain(
        '{{json .Config.Labels}}',
      );
    }
    expect(descriptors[2].argv.at(-1)).toBe(DOCKER_INFO_FORMAT);
    expect(descriptors[3].argv.at(-2)).toBe(DOCKER_IMAGE_FORMAT);
    expect(descriptors[4].argv.at(-1)).toBe('{{json .ID}}');
    expect(descriptors[5].argv.at(-2)).toBe(DOCKER_CONTAINER_FORMAT);
    expect(DOCKER_CONTAINER_FORMAT).toContain('org.wharfie.proof.invocationId');
    expect(DOCKER_CONTAINER_FORMAT).not.toContain('foreign');
  });

  it('rejects every near-miss, accessor, symbol, and mutation-shaped operation', () => {
    const invalid = [
      null,
      [],
      {},
      { kind: 'git-status', extra: true },
      {
        kind: 'git-ls-tree',
        commit: SOURCE_COMMIT.toUpperCase(),
        logicalPath: 'x',
      },
      { kind: 'git-ls-tree', commit: SOURCE_COMMIT, logicalPath: '../escape' },
      { kind: 'git-cat-file', objectId: 'A'.repeat(40) },
      { kind: 'docker-context-endpoint', contextName: '../context' },
      { kind: 'docker-info', endpoint: 'tcp://localhost:2375' },
      {
        kind: 'docker-image-inspect',
        endpoint: 'unix:///tmp/docker.sock',
        imageId: 'node:24',
      },
      {
        kind: 'docker-container-list',
        endpoint: 'unix:///tmp/docker.sock',
        containerName: 'foreign',
      },
      {
        kind: 'docker-container-inspect',
        endpoint: 'unix:///tmp/docker.sock',
        containerId: CONTAINER_ID.slice(1),
      },
      ...FORBIDDEN_DOCKER_TOKENS.map((token) => ({
        kind: `docker-${token}`,
      })),
      ...FORBIDDEN_GIT_TOKENS.map((token) => ({ kind: `git-${token}` })),
    ];
    for (const operation of invalid) {
      expect(() =>
        compileAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessOperationForTest(
          operation,
        ),
      ).toThrow();
    }

    let accessorInvoked = false;
    const accessor = {};
    Object.defineProperty(accessor, 'kind', {
      enumerable: true,
      get() {
        accessorInvoked = true;
        return 'git-status';
      },
    });
    expect(() =>
      compileAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessOperationForTest(
        accessor,
      ),
    ).toThrow();
    expect(accessorInvoked).toBe(false);

    const symbol = /** @type {Record<PropertyKey, unknown>} */ ({
      kind: 'git-status',
    });
    symbol[Symbol('extra')] = true;
    expect(() =>
      compileAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessOperationForTest(
        symbol,
      ),
    ).toThrow();
  });

  it('gives DOCKER_CONTEXT inspection precedence and never forwards DOCKER_HOST to children', () => {
    const context = withEnvironment(
      {
        PATH: '/bounded/test/bin',
        HOME: '/bounded/test/home',
        DOCKER_CONFIG: '/bounded/test/docker-config',
        DOCKER_CONTEXT: CONTEXT_NAME,
        DOCKER_HOST: REMOTE_DOCKER_HOST,
      },
      () =>
        compileAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessOperationForTest(
          { kind: 'docker-context-endpoint', contextName: CONTEXT_NAME },
        ),
    );
    const daemon = withEnvironment(
      {
        PATH: '/bounded/test/bin',
        HOME: '/bounded/test/home',
        DOCKER_CONTEXT: CONTEXT_NAME,
        DOCKER_HOST: REMOTE_DOCKER_HOST,
      },
      () =>
        compileAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessOperationForTest(
          {
            kind: 'docker-info',
            endpoint: 'unix:///private/tmp/docker.sock',
          },
        ),
    );

    expect(context.env).toEqual({
      PATH: '/bounded/test/bin',
      HOME: '/bounded/test/home',
      LANG: 'C',
      LC_ALL: 'C',
      DOCKER_CONFIG: '/bounded/test/docker-config',
    });
    expect(daemon.env).toEqual({
      PATH: '/bounded/test/bin',
      HOME: '/bounded/test/home',
      LANG: 'C',
      LC_ALL: 'C',
    });
    expect(context.env).not.toHaveProperty('DOCKER_CONTEXT');
    expect(context.env).not.toHaveProperty('DOCKER_HOST');
    expect(daemon.env).not.toHaveProperty('DOCKER_CONTEXT');
    expect(daemon.env).not.toHaveProperty('DOCKER_HOST');
  });

  it('has no production filesystem-write or mutating Docker/Git command capability', async () => {
    const source = await fsp.readFile(CLI_PATH, 'utf8');
    const compilerStart = source.indexOf(
      'export function compileAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessOperationForTest',
    );
    const compilerEnd = source.indexOf(
      "/** @param {import('node:child_process').ChildProcess}",
      compilerStart,
    );
    const compilerSource = source.slice(compilerStart, compilerEnd);

    expect(compilerStart).toBeGreaterThan(0);
    expect(compilerEnd).toBeGreaterThan(compilerStart);
    expect(source).not.toMatch(
      /\bfsp\.(?:appendFile|writeFile|mkdir|mkdtemp|chmod|chown|copyFile|cp|link|symlink|rename|rm|rmdir|truncate|unlink|utimes)\s*\(/u,
    );
    expect(source).not.toMatch(
      /\bO_(?:WRONLY|RDWR|APPEND|CREAT|EXCL|TRUNC)\b/u,
    );
    expect(source).not.toMatch(/\bcreateWriteStream\s*\(/u);
    expect(source).toContain('fsConstants.O_RDONLY');
    expect(source).toContain('shell: false');

    for (const token of FORBIDDEN_DOCKER_TOKENS) {
      expect(compilerSource).not.toMatch(
        new RegExp(`(['"\`])${token}\\1`, 'u'),
      );
    }
    for (const token of ['bundle', 'fetch']) {
      expect(compilerSource).not.toMatch(
        new RegExp(`(['"\`])${token}\\1`, 'u'),
      );
    }

    const descriptors = expectedOperations().map((operation) =>
      compileAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessOperationForTest(
        operation,
      ),
    );
    for (const descriptor of descriptors) {
      const forbidden =
        descriptor.command === 'docker'
          ? FORBIDDEN_DOCKER_TOKENS
          : FORBIDDEN_GIT_TOKENS;
      expect(descriptor.argv.some((value) => forbidden.includes(value))).toBe(
        false,
      );
    }
  });

  it('runs one green structured scan through bounded fake Git and Docker only', async () => {
    const scenario = await createScenario('green');
    const { completion } = spawnCli(scenario);

    const result = await completion;

    expect(result).toMatchObject({
      status: 0,
      signal: null,
      stderr: Buffer.alloc(0),
    });
    const stdout = result.stdout.toString('utf8');
    expect(stdout.endsWith('\n')).toBe(true);
    expect(stdout.slice(0, -1)).not.toContain('\n');
    const report = JSON.parse(stdout);
    expect(report.readyForBoundedAttempt).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.observations.dockerEndpoint).toEqual({
      state: 'observed',
      locality: 'local-unix',
    });
    expect(report.observations.containerName).toEqual({ state: 'absent' });
    expect(stdout).not.toContain(scenario.outputRoot);
    expect(stdout).not.toContain(scenario.endpoint);
    expect(stdout).not.toContain(REMOTE_DOCKER_HOST);
    expect(stdout).not.toContain(scenario.config.foreignLabel);

    const trace = await readTrace(scenario.tracePath);
    expectExactTrace(trace, scenario, 0);
    for (const entry of trace.filter(({ tool }) => tool === 'git')) {
      expect(entry.environment).toEqual({
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_NO_LAZY_FETCH: '1',
        GIT_NO_REPLACE_OBJECTS: '1',
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        HOME: scenario.root,
        LANG: 'C',
        LC_ALL: 'C',
        PATH: scenario.bin,
      });
    }
    for (const entry of trace.filter(
      ({ tool, operation }) =>
        tool === 'docker' && operation === 'context-inspect',
    )) {
      expect(entry.argv.at(-1)).toBe(CONTEXT_NAME);
      expect(entry.environment).toEqual({
        DOCKER_CONFIG: scenario.dockerConfig,
        HOME: scenario.root,
        LANG: 'C',
        LC_ALL: 'C',
        PATH: scenario.bin,
      });
    }
    for (const entry of trace.filter(
      ({ tool, operation }) =>
        tool === 'docker' && operation !== 'context-inspect',
    )) {
      expect(entry.environment).toEqual({
        HOME: scenario.root,
        LANG: 'C',
        LC_ALL: 'C',
        PATH: scenario.bin,
      });
      expect(entry.argv).not.toContain(REMOTE_DOCKER_HOST);
    }
  });

  it('returns a structured exit-2 blocker without leaking paths or foreign labels', async () => {
    const scenario = await createScenario('blocked', {
      containerMode: 'running',
    });
    const { completion } = spawnCli(scenario);

    const result = await completion;

    expect(result).toMatchObject({
      status: 2,
      signal: null,
      stderr: Buffer.alloc(0),
    });
    const stdout = result.stdout.toString('utf8');
    const report = JSON.parse(stdout);
    expect(report.readyForBoundedAttempt).toBe(false);
    expect(report.blockers).toEqual(['CONCURRENT_PROOF_RUNNING']);
    expect(report.observations.containerName).toMatchObject({
      state: 'observed',
      containerId: CONTAINER_ID,
      runtimeState: 'running',
      collisionClass: 'running-owned',
    });
    expect(stdout).not.toContain(scenario.outputRoot);
    expect(stdout).not.toContain(scenario.endpoint);
    expect(stdout).not.toContain(REMOTE_DOCKER_HOST);
    expect(stdout).not.toContain(scenario.config.foreignLabel);

    const trace = await readTrace(scenario.tracePath);
    expectExactTrace(trace, scenario, 1);
  });

  it('rejects a non-root temporary-directory alias that resolves to filesystem root', async () => {
    const scenario = await createScenario('root-temp-alias');
    const rootAlias = path.join(scenario.root, 'root-alias');
    await fsp.symlink(path.parse(rootAlias).root, rootAlias, 'dir');
    const { completion } = spawnCli(scenario, { TMPDIR: rootAlias });

    const result = await completion;

    expect(result).toMatchObject({
      status: 2,
      signal: null,
      stderr: Buffer.alloc(0),
    });
    const stdout = result.stdout.toString('utf8');
    const report = JSON.parse(stdout);
    expect(report.readyForBoundedAttempt).toBe(false);
    expect(report.blockers).toEqual(['HOST_TEMP_PATH_UNSAFE']);
    expect(report.observations.hostTemp).toEqual({ state: 'unsafe' });
    expect(stdout).not.toContain(rootAlias);

    const trace = await readTrace(scenario.tracePath);
    expectExactTrace(trace, scenario, 0);
  });

  it('preserves SIGTERM exit 143, kills and reaps every fake read process group, and latches future reads', async () => {
    const scenario = await createScenario('interrupt', { hangGit: true });
    const { child, completion } = spawnCli(scenario);
    const started = /** @type {TraceEntry[]} */ (
      await waitFor(async () => {
        const trace = await readTrace(scenario.tracePath);
        const hanging = trace.filter(({ hang }) => hang === true);
        return hanging.length >= 2 ? hanging : null;
      })
    );

    expect(child.kill('SIGTERM')).toBe(true);
    const result = await completion;

    expect(result.status).toBe(143);
    expect(result.signal).toBeNull();
    expect(result.stdout).toEqual(Buffer.alloc(0));
    expect(result.stderr.toString('utf8')).toBe(
      'AWS retained-storage host preflight SEA Linux Docker readiness inspection failed.\n',
    );
    const pids = started.flatMap(({ pid, grandchildPid }) => [
      pid,
      /** @type {number} */ (grandchildPid),
    ]);
    await waitFor(() => pids.every((pid) => !processExists(pid)));

    const traceBefore = await fsp.readFile(scenario.tracePath, 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 150));
    const traceAfter = await fsp.readFile(scenario.tracePath, 'utf8');
    expect(traceAfter).toBe(traceBefore);
    const finalTrace = await readTrace(scenario.tracePath);
    expect(finalTrace).toHaveLength(2);
    expect(
      finalTrace.every(
        ({ tool, operation, hang }) =>
          tool === 'git' &&
          ['status', 'rev-parse'].includes(operation) &&
          hang === true,
      ),
    ).toBe(true);
  });
});
