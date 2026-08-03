/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This closed local-readiness adapter keeps its exact command and filesystem observation boundaries inline. */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, lstat, open, realpath, statfs } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { TextDecoder } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { sortCanonicalJsonValue } from '../src/core/runtime/canonical-order.js';
import {
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_TOOLING_PATHS,
  createAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessInspector,
  parseAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessArguments,
  stringifyAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessReport,
} from './aws-host-retained-storage-host-preflight-sea-linux-docker-readiness.js';

const LIVE_REPOSITORY_ROOT = path.resolve(
  fileURLToPath(new URL('../', import.meta.url)),
);
const IMAGE_ID_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const OBJECT_ID_PATTERN = /^[0-9a-f]{40}$/u;
const CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/u;
const INVOCATION_ID_PATTERN = /^[0-9a-f]{32}$/u;
const CONTEXT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const CONTAINER_NAME_PATTERN = /^wharfie-sea-proof-[0-9a-f]{40}$/u;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const ROOTFS_LAYER_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SIMPLE_VALUE_PATTERN = /^[\x20-\x7e]{1,256}$/u;
const SMALL_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+~-]{0,127}$/u;
const MAX_GENERAL_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_TOOLING_BYTES = 2 * 1024 * 1024;
const MAX_CONTEXT_OUTPUT_BYTES = 8 * 1024;
const MAX_DOCKER_FACT_OUTPUT_BYTES = 2 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 30 * 1000;
const COMMAND_REAP_TIMEOUT_MS = 10 * 1000;
/** @type {NodeJS.Signals | undefined} */
let interruptedSignal;

class DockerReadinessInterruptedError extends Error {
  /** @param {NodeJS.Signals} signal */
  constructor(signal) {
    super(`Docker readiness inspection was interrupted by ${signal}.`);
    this.name = 'DockerReadinessInterruptedError';
  }
}

const CONTAINER_LABEL_KIND = 'org.wharfie.proof.kind';
const CONTAINER_LABEL_SOURCE = 'org.wharfie.proof.sourceCommit';
const CONTAINER_LABEL_TOOLING = 'org.wharfie.proof.toolingCommit';
const CONTAINER_LABEL_INVOCATION = 'org.wharfie.proof.invocationId';
const PROOF_KIND = 'aws-retained-storage-host-preflight-sea-linux-docker-proof';

const GIT_OPERATION_KEYS = new Set(['kind']);
const GIT_PATH_OPERATION_KEYS = new Set(['kind', 'commit', 'logicalPath']);
const GIT_OBJECT_OPERATION_KEYS = new Set(['kind', 'objectId']);
const DOCKER_CONTEXT_OPERATION_KEYS = new Set(['kind', 'contextName']);
const DOCKER_ENDPOINT_OPERATION_KEYS = new Set(['kind', 'endpoint']);
const DOCKER_IMAGE_OPERATION_KEYS = new Set(['kind', 'endpoint', 'imageId']);
const DOCKER_CONTAINER_LIST_OPERATION_KEYS = new Set([
  'kind',
  'endpoint',
  'containerName',
]);
const DOCKER_CONTAINER_INSPECT_OPERATION_KEYS = new Set([
  'kind',
  'endpoint',
  'containerId',
]);
const CONTAINER_OBSERVATION_INPUT_KEYS = new Set([
  'imageId',
  'sourceCommit',
  'toolingCommit',
  'containerName',
]);
const IMAGE_OBSERVATION_INPUT_KEYS = new Set(['imageId']);
const OUTPUT_OBSERVATION_INPUT_KEYS = new Set(['outputRoot', 'sourceCommit']);

const DOCKER_INFO_FORMAT =
  '{"operatingSystem":{{json .OSType}},"architecture":{{json .Architecture}},"cpuCount":{{json (printf "%d" .NCPU)}},"memoryBytes":{{json (printf "%d" .MemTotal)}},"serverVersion":{{json .ServerVersion}}}';
const DOCKER_IMAGE_FORMAT =
  '{"id":{{json .Id}},"operatingSystem":{{json .Os}},"architecture":{{json .Architecture}},"rootfsType":{{json .RootFS.Type}},"rootfsLayers":{{json .RootFS.Layers}}}';
const DOCKER_CONTAINER_FORMAT =
  `{"containerId":{{json .Id}},"name":{{json .Name}},"imageId":{{json .Image}},"running":{{json .State.Running}},` +
  `"kind":{{if .Config.Labels}}{{json (index .Config.Labels "${CONTAINER_LABEL_KIND}")}}{{else}}null{{end}},` +
  `"sourceCommit":{{if .Config.Labels}}{{json (index .Config.Labels "${CONTAINER_LABEL_SOURCE}")}}{{else}}null{{end}},` +
  `"toolingCommit":{{if .Config.Labels}}{{json (index .Config.Labels "${CONTAINER_LABEL_TOOLING}")}}{{else}}null{{end}},` +
  `"invocationId":{{if .Config.Labels}}{{json (index .Config.Labels "${CONTAINER_LABEL_INVOCATION}")}}{{else}}null{{end}}}`;

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @param {unknown} value @param {string} valuePath @returns {Record<string, any>} */
function exactObject(value, valuePath) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${valuePath} must be a plain object.`);
  }
  return value;
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} valuePath @returns {void} */
function assertExactDataKeys(value, keys, valuePath) {
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))
  ) {
    throw new TypeError(
      `${valuePath} must contain only its exact required keys.`,
    );
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${valuePath}.${key} must be an own data property.`);
    }
  }
}

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  if (Buffer.isBuffer(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {unknown} value @param {RegExp} pattern @param {string} valuePath @returns {string} */
function patternedString(value, pattern, valuePath) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new TypeError(`${valuePath} is invalid.`);
  }
  return value;
}

/** @param {unknown} value @param {string} valuePath @returns {string} */
function canonicalLogicalPath(value, valuePath) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\0') ||
    value.includes('\n') ||
    value.includes('\r') ||
    value.startsWith('/') ||
    path.posix.normalize(value) !== value ||
    value === '.' ||
    value.startsWith('../')
  ) {
    throw new TypeError(`${valuePath} must be a canonical relative path.`);
  }
  return value;
}

/** @param {unknown} value @param {string} valuePath @returns {string} */
function canonicalAbsoluteNonRootPath(value, valuePath) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    value.includes('\0') ||
    value.includes('\n') ||
    value.includes('\r') ||
    !path.isAbsolute(value) ||
    path.normalize(value) !== value ||
    path.parse(value).root === value
  ) {
    throw new TypeError(
      `${valuePath} must be a canonical absolute non-root path.`,
    );
  }
  return value;
}

/** @param {unknown} value @param {string} valuePath @returns {string} */
function localUnixEndpoint(value, valuePath) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('unix://') ||
    value.length > 4096 ||
    value.trim() !== value ||
    value.includes('\0') ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    throw new TypeError(`${valuePath} must be one local Unix Docker endpoint.`);
  }
  const socketPath = value.slice('unix://'.length);
  if (
    socketPath.length === 0 ||
    !path.isAbsolute(socketPath) ||
    path.normalize(socketPath) !== socketPath
  ) {
    throw new TypeError(`${valuePath} must be one local Unix Docker endpoint.`);
  }
  return value;
}

/** @param {unknown} value @param {string} valuePath @returns {string} */
function safeSimpleValue(value, valuePath) {
  if (typeof value !== 'string' || !SIMPLE_VALUE_PATTERN.test(value)) {
    throw new TypeError(`${valuePath} is not one bounded printable value.`);
  }
  return value;
}

/** @param {unknown} value @param {string} valuePath @returns {string} */
function smallToken(value, valuePath) {
  if (typeof value !== 'string' || !SMALL_TOKEN_PATTERN.test(value)) {
    throw new TypeError(`${valuePath} is not one bounded canonical token.`);
  }
  return value;
}

/** @param {unknown} value @param {string} valuePath @returns {string} */
function canonicalDecimal(value, valuePath) {
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) {
    throw new TypeError(`${valuePath} must be one canonical decimal integer.`);
  }
  return value;
}

/** @returns {Readonly<Record<string, string>>} */
function baseCommandEnvironment() {
  const commandPath =
    typeof process.env.PATH === 'string' && process.env.PATH.length > 0
      ? process.env.PATH
      : '/usr/local/bin:/usr/bin:/bin';
  const home =
    typeof process.env.HOME === 'string' && process.env.HOME.length > 0
      ? process.env.HOME
      : os.homedir();
  return Object.freeze({
    PATH: commandPath,
    HOME: home,
    LANG: 'C',
    LC_ALL: 'C',
  });
}

/** @returns {Readonly<Record<string, string>>} */
function gitCommandEnvironment() {
  return Object.freeze({
    ...baseCommandEnvironment(),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_NO_LAZY_FETCH: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  });
}

/** @returns {Readonly<Record<string, string>>} */
function dockerContextCommandEnvironment() {
  const environment = { ...baseCommandEnvironment() };
  if (
    typeof process.env.DOCKER_CONFIG === 'string' &&
    process.env.DOCKER_CONFIG.length > 0
  ) {
    environment.DOCKER_CONFIG = process.env.DOCKER_CONFIG;
  }
  return Object.freeze(environment);
}

/** @returns {Readonly<Record<string, string>>} */
function dockerDaemonCommandEnvironment() {
  return baseCommandEnvironment();
}

const GIT_COMMON_ARGV = Object.freeze([
  '--no-pager',
  '--no-optional-locks',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.untrackedCache=false',
  '-c',
  'core.hooksPath=/dev/null',
  '-C',
  LIVE_REPOSITORY_ROOT,
]);

/**
 * Compile one positively enumerated read-only operation. No caller-supplied
 * executable or arbitrary argument list reaches the child-process boundary.
 * @param {unknown} operationValue
 * @returns {Readonly<{command: string, argv: readonly string[], cwd: string, env: Readonly<Record<string, string>>, maximumOutputBytes: number, timeoutMs: number}>}
 */
export function compileAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessOperationForTest(
  operationValue,
) {
  const operation = exactObject(
    operationValue,
    'Docker readiness read operation',
  );
  const kindDescriptor = Object.getOwnPropertyDescriptor(operation, 'kind');
  if (
    !kindDescriptor?.enumerable ||
    !Object.hasOwn(kindDescriptor, 'value') ||
    typeof kindDescriptor.value !== 'string'
  ) {
    throw new TypeError(
      'Docker readiness read operation.kind must be an own data string.',
    );
  }
  const kind = kindDescriptor.value;
  /** @type {string[]} */
  let argv;
  let command;
  let env;
  let maximumOutputBytes;

  switch (kind) {
    case 'git-status':
      assertExactDataKeys(
        operation,
        GIT_OPERATION_KEYS,
        'Docker readiness git-status operation',
      );
      command = 'git';
      argv = [
        ...GIT_COMMON_ARGV,
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--ignore-submodules=none',
        '--no-renames',
      ];
      env = gitCommandEnvironment();
      maximumOutputBytes = MAX_GENERAL_OUTPUT_BYTES;
      break;
    case 'git-head':
      assertExactDataKeys(
        operation,
        GIT_OPERATION_KEYS,
        'Docker readiness git-head operation',
      );
      command = 'git';
      argv = [...GIT_COMMON_ARGV, 'rev-parse', '--verify', 'HEAD^{commit}'];
      env = gitCommandEnvironment();
      maximumOutputBytes = MAX_CONTEXT_OUTPUT_BYTES;
      break;
    case 'git-ls-tree': {
      assertExactDataKeys(
        operation,
        GIT_PATH_OPERATION_KEYS,
        'Docker readiness git-ls-tree operation',
      );
      const commit = patternedString(
        operation.commit,
        COMMIT_PATTERN,
        'Docker readiness git-ls-tree operation.commit',
      );
      const logicalPath = canonicalLogicalPath(
        operation.logicalPath,
        'Docker readiness git-ls-tree operation.logicalPath',
      );
      command = 'git';
      argv = [
        ...GIT_COMMON_ARGV,
        'ls-tree',
        '--full-tree',
        '-z',
        commit,
        '--',
        logicalPath,
      ];
      env = gitCommandEnvironment();
      maximumOutputBytes = MAX_CONTEXT_OUTPUT_BYTES;
      break;
    }
    case 'git-cat-file': {
      assertExactDataKeys(
        operation,
        GIT_OBJECT_OPERATION_KEYS,
        'Docker readiness git-cat-file operation',
      );
      const objectId = patternedString(
        operation.objectId,
        OBJECT_ID_PATTERN,
        'Docker readiness git-cat-file operation.objectId',
      );
      command = 'git';
      argv = [...GIT_COMMON_ARGV, 'cat-file', 'blob', objectId];
      env = gitCommandEnvironment();
      maximumOutputBytes = MAX_TOOLING_BYTES;
      break;
    }
    case 'docker-context-show':
      assertExactDataKeys(
        operation,
        GIT_OPERATION_KEYS,
        'Docker readiness docker-context-show operation',
      );
      command = 'docker';
      argv = ['context', 'show'];
      env = dockerContextCommandEnvironment();
      maximumOutputBytes = MAX_CONTEXT_OUTPUT_BYTES;
      break;
    case 'docker-context-endpoint': {
      assertExactDataKeys(
        operation,
        DOCKER_CONTEXT_OPERATION_KEYS,
        'Docker readiness docker-context-endpoint operation',
      );
      const contextName = patternedString(
        operation.contextName,
        CONTEXT_NAME_PATTERN,
        'Docker readiness docker-context-endpoint operation.contextName',
      );
      command = 'docker';
      argv = [
        'context',
        'inspect',
        '--format',
        '{{json .Endpoints.docker.Host}}',
        contextName,
      ];
      env = dockerContextCommandEnvironment();
      maximumOutputBytes = MAX_CONTEXT_OUTPUT_BYTES;
      break;
    }
    case 'docker-info': {
      assertExactDataKeys(
        operation,
        DOCKER_ENDPOINT_OPERATION_KEYS,
        'Docker readiness docker-info operation',
      );
      const endpoint = localUnixEndpoint(
        operation.endpoint,
        'Docker readiness docker-info operation.endpoint',
      );
      command = 'docker';
      argv = ['--host', endpoint, 'info', '--format', DOCKER_INFO_FORMAT];
      env = dockerDaemonCommandEnvironment();
      maximumOutputBytes = MAX_CONTEXT_OUTPUT_BYTES;
      break;
    }
    case 'docker-image-inspect': {
      assertExactDataKeys(
        operation,
        DOCKER_IMAGE_OPERATION_KEYS,
        'Docker readiness docker-image-inspect operation',
      );
      const endpoint = localUnixEndpoint(
        operation.endpoint,
        'Docker readiness docker-image-inspect operation.endpoint',
      );
      const imageId = patternedString(
        operation.imageId,
        IMAGE_ID_PATTERN,
        'Docker readiness docker-image-inspect operation.imageId',
      );
      command = 'docker';
      argv = [
        '--host',
        endpoint,
        'image',
        'inspect',
        '--format',
        DOCKER_IMAGE_FORMAT,
        imageId,
      ];
      env = dockerDaemonCommandEnvironment();
      maximumOutputBytes = MAX_DOCKER_FACT_OUTPUT_BYTES;
      break;
    }
    case 'docker-container-list': {
      assertExactDataKeys(
        operation,
        DOCKER_CONTAINER_LIST_OPERATION_KEYS,
        'Docker readiness docker-container-list operation',
      );
      const endpoint = localUnixEndpoint(
        operation.endpoint,
        'Docker readiness docker-container-list operation.endpoint',
      );
      const containerName = patternedString(
        operation.containerName,
        CONTAINER_NAME_PATTERN,
        'Docker readiness docker-container-list operation.containerName',
      );
      command = 'docker';
      argv = [
        '--host',
        endpoint,
        'container',
        'ls',
        '--all',
        '--no-trunc',
        '--filter',
        `name=^/${containerName}$`,
        '--format',
        '{{json .ID}}',
      ];
      env = dockerDaemonCommandEnvironment();
      maximumOutputBytes = MAX_CONTEXT_OUTPUT_BYTES;
      break;
    }
    case 'docker-container-inspect': {
      assertExactDataKeys(
        operation,
        DOCKER_CONTAINER_INSPECT_OPERATION_KEYS,
        'Docker readiness docker-container-inspect operation',
      );
      const endpoint = localUnixEndpoint(
        operation.endpoint,
        'Docker readiness docker-container-inspect operation.endpoint',
      );
      const containerId = patternedString(
        operation.containerId,
        CONTAINER_ID_PATTERN,
        'Docker readiness docker-container-inspect operation.containerId',
      );
      command = 'docker';
      argv = [
        '--host',
        endpoint,
        'container',
        'inspect',
        '--format',
        DOCKER_CONTAINER_FORMAT,
        containerId,
      ];
      env = dockerDaemonCommandEnvironment();
      maximumOutputBytes = MAX_CONTEXT_OUTPUT_BYTES;
      break;
    }
    default:
      throw new TypeError(
        `Docker readiness read operation '${kind}' is not supported.`,
      );
  }

  return deepFreeze({
    command,
    argv,
    cwd: LIVE_REPOSITORY_ROOT,
    env,
    maximumOutputBytes,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
}

/** @param {import('node:child_process').ChildProcess} child @returns {void} */
function killReadProcessGroup(child) {
  if (
    process.platform !== 'win32' &&
    typeof child.pid === 'number' &&
    child.pid > 0
  ) {
    try {
      process.kill(-child.pid, 'SIGKILL');
      return;
    } catch {
      // Fall through to killing the direct child.
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // The close/error event remains the authoritative reap result.
  }
}

/** @param {unknown} [error] @returns {void} */
function rethrowReadinessInterruption(error) {
  if (error instanceof DockerReadinessInterruptedError) throw error;
  if (interruptedSignal !== undefined) {
    throw new DockerReadinessInterruptedError(interruptedSignal);
  }
}

/**
 * Execute only a descriptor created by the positive compiler above.
 * @param {unknown} operation
 * @returns {Promise<Readonly<{stdout: Buffer, stderr: Buffer}>>}
 */
async function runReadOperation(operation) {
  rethrowReadinessInterruption();
  const descriptor =
    compileAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessOperationForTest(
      operation,
    );
  return await new Promise((resolve, reject) => {
    const child = spawn(descriptor.command, [...descriptor.argv], {
      cwd: descriptor.cwd,
      env: descriptor.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    /** @type {Buffer[]} */
    const stdout = [];
    /** @type {Buffer[]} */
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    /** @type {unknown} */
    let pendingFailure;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let reapTimeout;
    /** @param {NodeJS.Signals} signal */
    const handleSignal = (signal) => {
      if (interruptedSignal === undefined) interruptedSignal = signal;
      process.exitCode = signal === 'SIGINT' ? 130 : 143;
      fail(new DockerReadinessInterruptedError(signal));
    };
    const removeSignalHandlers = () => {
      process.removeListener('SIGINT', handleSignal);
      process.removeListener('SIGTERM', handleSignal);
    };

    /** @param {unknown} error */
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (reapTimeout !== undefined) clearTimeout(reapTimeout);
      removeSignalHandlers();
      reject(error);
    };
    /** @param {unknown} error */
    const fail = (error) => {
      if (settled || pendingFailure !== undefined) return;
      pendingFailure = error;
      clearTimeout(timeout);
      if (child.pid === undefined) {
        rejectOnce(error);
        return;
      }
      killReadProcessGroup(child);
      reapTimeout = setTimeout(() => {
        rejectOnce(
          new AggregateError(
            [error],
            `Read operation '${descriptor.command}' did not close after forced termination.`,
          ),
        );
      }, COMMAND_REAP_TIMEOUT_MS);
    };
    const timeout = setTimeout(() => {
      fail(
        new Error(
          `Read operation '${descriptor.command}' exceeded its wall-clock limit.`,
        ),
      );
    }, descriptor.timeoutMs);
    process.once('SIGINT', handleSignal);
    process.once('SIGTERM', handleSignal);

    child.stdout.on('data', (chunk) => {
      if (pendingFailure !== undefined) return;
      const bytes = Buffer.from(chunk);
      stdoutBytes += bytes.length;
      if (
        stdoutBytes > descriptor.maximumOutputBytes ||
        stdoutBytes + stderrBytes > descriptor.maximumOutputBytes
      ) {
        fail(
          new Error(
            `Read operation '${descriptor.command}' emitted oversized output.`,
          ),
        );
        return;
      }
      stdout.push(bytes);
    });
    child.stderr.on('data', (chunk) => {
      if (pendingFailure !== undefined) return;
      const bytes = Buffer.from(chunk);
      stderrBytes += bytes.length;
      if (
        stderrBytes > descriptor.maximumOutputBytes ||
        stdoutBytes + stderrBytes > descriptor.maximumOutputBytes
      ) {
        fail(
          new Error(
            `Read operation '${descriptor.command}' emitted oversized output.`,
          ),
        );
        return;
      }
      stderr.push(bytes);
    });
    child.once('error', fail);
    child.once('close', (status, signal) => {
      if (settled) return;
      clearTimeout(timeout);
      if (reapTimeout !== undefined) clearTimeout(reapTimeout);
      removeSignalHandlers();
      if (pendingFailure !== undefined) {
        settled = true;
        reject(pendingFailure);
        return;
      }
      settled = true;
      if (signal !== null || status !== 0) {
        reject(
          new Error(`Read operation '${descriptor.command}' did not succeed.`),
        );
        return;
      }
      resolve(
        Object.freeze({
          stdout: Buffer.concat(stdout, stdoutBytes),
          stderr: Buffer.concat(stderr, stderrBytes),
        }),
      );
    });
  });
}

/** @param {Buffer} bytes @returns {string} */
function decodeUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Read operation output is not valid UTF-8.');
  }
}

/** @param {Readonly<{stdout: Buffer, stderr: Buffer}>} result @param {string} label @returns {unknown} */
function parseOneJsonLine(result, label) {
  if (result.stderr.length !== 0) {
    throw new Error(`${label} emitted unexpected diagnostic output.`);
  }
  const text = decodeUtf8(result.stdout);
  if (
    text.length < 2 ||
    !text.endsWith('\n') ||
    text.slice(0, -1).includes('\n')
  ) {
    throw new Error(`${label} did not return one bounded JSON line.`);
  }
  try {
    return JSON.parse(text.slice(0, -1));
  } catch {
    throw new Error(`${label} did not return valid JSON.`);
  }
}

/** @param {Buffer} bytes @returns {Readonly<{byteDigest: Readonly<{algorithm: 'sha256', value: string}>, size: number}>} */
function byteObservation(bytes) {
  return deepFreeze({
    byteDigest: {
      algorithm: /** @type {'sha256'} */ ('sha256'),
      value: createHash('sha256').update(bytes).digest('base64url'),
    },
    size: bytes.length,
  });
}

/** @param {import('node:fs').BigIntStats} left @param {import('node:fs').BigIntStats} right @returns {boolean} */
function sameStableFile(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

/** @param {import('node:fs').BigIntStats} left @param {import('node:fs').BigIntStats} right @returns {boolean} */
function sameDirectoryIdentity(left, right) {
  return (
    left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
  );
}

/**
 * Read one fixed live tooling file through a stable no-follow descriptor.
 * @param {string} logicalPath
 * @returns {Promise<{state: 'safe-regular', bytes: Buffer} | {state: 'unsafe'}>}
 */
async function readStableLiveToolingFile(logicalPath) {
  const canonical = canonicalLogicalPath(logicalPath, 'Readiness tooling path');
  const absolutePath = path.join(LIVE_REPOSITORY_ROOT, ...canonical.split('/'));
  const relative = path.relative(LIVE_REPOSITORY_ROOT, absolutePath);
  if (
    relative.length === 0 ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    return { state: 'unsafe' };
  }
  try {
    const beforePath = await lstat(absolutePath, { bigint: true });
    if (
      beforePath.isSymbolicLink() ||
      !beforePath.isFile() ||
      beforePath.size < 1n ||
      beforePath.size > BigInt(MAX_TOOLING_BYTES) ||
      (await realpath(absolutePath)) !== absolutePath
    ) {
      return { state: 'unsafe' };
    }
    const noFollow =
      typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
    const nonblocking =
      typeof fsConstants.O_NONBLOCK === 'number' ? fsConstants.O_NONBLOCK : 0;
    const handle = await open(
      absolutePath,
      fsConstants.O_RDONLY | noFollow | nonblocking,
    );
    try {
      const opened = await handle.stat({ bigint: true });
      if (
        !opened.isFile() ||
        !sameStableFile(beforePath, opened) ||
        opened.size < 1n ||
        opened.size > BigInt(MAX_TOOLING_BYTES)
      ) {
        return { state: 'unsafe' };
      }
      /** @type {Buffer[]} */
      const chunks = [];
      let used = 0;
      while (true) {
        const remaining = MAX_TOOLING_BYTES + 1 - used;
        if (remaining < 1) return { state: 'unsafe' };
        const buffer = Buffer.alloc(Math.min(64 * 1024, remaining));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, used);
        if (bytesRead === 0) break;
        used += bytesRead;
        if (used > MAX_TOOLING_BYTES) return { state: 'unsafe' };
        chunks.push(buffer.subarray(0, bytesRead));
      }
      const [after, afterPath, realAfter] = await Promise.all([
        handle.stat({ bigint: true }),
        lstat(absolutePath, { bigint: true }),
        realpath(absolutePath),
      ]);
      if (
        !sameStableFile(opened, after) ||
        afterPath.isSymbolicLink() ||
        !afterPath.isFile() ||
        !sameStableFile(after, afterPath) ||
        BigInt(used) !== opened.size ||
        realAfter !== absolutePath
      ) {
        return { state: 'unsafe' };
      }
      return {
        state: 'safe-regular',
        bytes: Buffer.concat(chunks, used),
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    rethrowReadinessInterruption(error);
    return { state: 'unsafe' };
  }
}

/** @param {string} logicalPath @param {string} commit @returns {Promise<{treeEntry: 'regular-blob'|'invalid', bytes: Buffer|null}>} */
async function readCommittedToolingFile(logicalPath, commit) {
  try {
    const listed = await runReadOperation({
      kind: 'git-ls-tree',
      commit,
      logicalPath,
    });
    if (listed.stderr.length !== 0) {
      return { treeEntry: 'invalid', bytes: null };
    }
    const text = decodeUtf8(listed.stdout);
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t([^\0\n]+)\0$/u.exec(
      text,
    );
    if (!match || match[3] !== logicalPath) {
      return { treeEntry: 'invalid', bytes: null };
    }
    const content = await runReadOperation({
      kind: 'git-cat-file',
      objectId: match[2],
    });
    if (
      content.stderr.length !== 0 ||
      content.stdout.length < 1 ||
      content.stdout.length > MAX_TOOLING_BYTES
    ) {
      return { treeEntry: 'invalid', bytes: null };
    }
    return { treeEntry: 'regular-blob', bytes: content.stdout };
  } catch (error) {
    rethrowReadinessInterruption(error);
    return { treeEntry: 'invalid', bytes: null };
  }
}

/** @returns {Promise<Readonly<Record<string, any>>>} */
async function observeRepository() {
  try {
    if ((await realpath(LIVE_REPOSITORY_ROOT)) !== LIVE_REPOSITORY_ROOT) {
      return Object.freeze({ state: 'unobservable' });
    }
    const [headResult, statusResult] = await Promise.all([
      runReadOperation({ kind: 'git-head' }),
      runReadOperation({ kind: 'git-status' }),
    ]);
    if (headResult.stderr.length !== 0 || statusResult.stderr.length !== 0) {
      return Object.freeze({ state: 'unobservable' });
    }
    const headText = decodeUtf8(headResult.stdout);
    if (!/^[0-9a-f]{40}\n$/u.test(headText)) {
      return Object.freeze({ state: 'unobservable' });
    }
    const commit = headText.slice(0, -1);
    const tooling = [];
    for (const logicalPathValue of AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_TOOLING_PATHS) {
      const logicalPath = canonicalLogicalPath(
        logicalPathValue,
        'Readiness tooling path',
      );
      const [committed, live] = await Promise.all([
        readCommittedToolingFile(logicalPath, commit),
        readStableLiveToolingFile(logicalPath),
      ]);
      const committedBytes =
        committed.bytes === null ? null : byteObservation(committed.bytes);
      const liveBytes =
        live.state === 'safe-regular' ? byteObservation(live.bytes) : null;
      tooling.push(
        deepFreeze({
          logicalPath,
          treeEntry: committed.treeEntry,
          liveFile: live.state,
          committedBytes,
          liveBytes,
          matchesHead:
            committed.bytes !== null &&
            live.state === 'safe-regular' &&
            committed.bytes.equals(live.bytes),
        }),
      );
    }
    return deepFreeze({
      state: 'observed',
      commit,
      worktree: statusResult.stdout.length === 0 ? 'clean' : 'dirty',
      tooling,
    });
  } catch (error) {
    rethrowReadinessInterruption(error);
    return Object.freeze({ state: 'unobservable' });
  }
}

/** @param {unknown} value @returns {'local-unix'|'remote-or-unsupported'} */
function classifyDockerEndpoint(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4096 ||
    value.trim() !== value ||
    value.includes('\0') ||
    value.includes('\n') ||
    value.includes('\r') ||
    !value.startsWith('unix://')
  ) {
    return 'remote-or-unsupported';
  }
  try {
    localUnixEndpoint(value, 'Docker endpoint');
    return 'local-unix';
  } catch {
    return 'remote-or-unsupported';
  }
}

/**
 * Resolve the effective Docker endpoint without contacting a daemon. The
 * endpoint itself stays private and is projected only as a locality class.
 * @returns {Promise<{state: 'unobservable'} | {state: 'observed', locality: 'local-unix'|'remote-or-unsupported', endpoint: string|null}>}
 */
async function readDockerEndpoint() {
  try {
    let contextName = process.env.DOCKER_CONTEXT;
    if (typeof contextName !== 'string' || contextName.length === 0) {
      const environmentHost = process.env.DOCKER_HOST;
      if (typeof environmentHost === 'string' && environmentHost.length > 0) {
        const locality = classifyDockerEndpoint(environmentHost);
        return {
          state: 'observed',
          locality,
          endpoint: locality === 'local-unix' ? environmentHost : null,
        };
      }
      const shown = await runReadOperation({ kind: 'docker-context-show' });
      if (shown.stderr.length !== 0) return { state: 'unobservable' };
      const text = decodeUtf8(shown.stdout);
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\n$/u.test(text)) {
        return { state: 'unobservable' };
      }
      contextName = text.slice(0, -1);
    }
    if (!CONTEXT_NAME_PATTERN.test(contextName)) {
      return { state: 'unobservable' };
    }
    const inspected = await runReadOperation({
      kind: 'docker-context-endpoint',
      contextName,
    });
    const endpoint = parseOneJsonLine(
      inspected,
      'Docker context endpoint inspection',
    );
    if (typeof endpoint !== 'string') return { state: 'unobservable' };
    const locality = classifyDockerEndpoint(endpoint);
    return {
      state: 'observed',
      locality,
      endpoint: locality === 'local-unix' ? endpoint : null,
    };
  } catch (error) {
    rethrowReadinessInterruption(error);
    return { state: 'unobservable' };
  }
}

/** @param {() => Promise<Readonly<Record<string, any>>>} readEndpoint @returns {Promise<Readonly<Record<string, any>>>} */
async function observeDockerEndpoint(readEndpoint) {
  const observation = await readEndpoint();
  if (observation.state === 'unobservable') {
    return Object.freeze({ state: 'unobservable' });
  }
  return Object.freeze({
    state: 'observed',
    locality: observation.locality,
  });
}

/** @param {() => Promise<Readonly<Record<string, any>>>} readEndpoint @returns {Promise<Readonly<Record<string, any>>>} */
async function observeDockerDaemon(readEndpoint) {
  const endpoint = await readEndpoint();
  if (
    endpoint.state !== 'observed' ||
    endpoint.locality !== 'local-unix' ||
    endpoint.endpoint === null
  ) {
    return Object.freeze({ state: 'unobservable' });
  }
  try {
    const decoded = exactObject(
      parseOneJsonLine(
        await runReadOperation({
          kind: 'docker-info',
          endpoint: endpoint.endpoint,
        }),
        'Docker daemon inspection',
      ),
      'Docker daemon inspection',
    );
    assertExactDataKeys(
      decoded,
      new Set([
        'operatingSystem',
        'architecture',
        'cpuCount',
        'memoryBytes',
        'serverVersion',
      ]),
      'Docker daemon inspection',
    );
    const operatingSystem = smallToken(
      decoded.operatingSystem,
      'Docker daemon operating system',
    );
    const architecture = smallToken(
      decoded.architecture,
      'Docker daemon architecture',
    );
    const cpuCountText = canonicalDecimal(
      decoded.cpuCount,
      'Docker daemon CPU count',
    );
    const cpuCount = Number(cpuCountText);
    if (!Number.isSafeInteger(cpuCount) || cpuCount < 1 || cpuCount > 65_536) {
      throw new TypeError('Docker daemon CPU count is invalid.');
    }
    const memoryBytes = canonicalDecimal(
      decoded.memoryBytes,
      'Docker daemon memory bytes',
    );
    if (BigInt(memoryBytes) < 1n) {
      throw new TypeError('Docker daemon memory bytes are invalid.');
    }
    let executionMode = /** @type {'native'|'emulated'|'unsupported'} */ (
      'unsupported'
    );
    if (architecture === 'amd64' || architecture === 'x86_64') {
      executionMode = 'native';
    } else if (architecture === 'arm64' || architecture === 'aarch64') {
      executionMode = 'emulated';
    }
    return deepFreeze({
      state: 'observed',
      operatingSystem,
      architecture,
      executionMode,
      cpuCount,
      memoryBytes,
      serverVersion: smallToken(
        decoded.serverVersion,
        'Docker daemon server version',
      ),
    });
  } catch (error) {
    rethrowReadinessInterruption(error);
    return Object.freeze({ state: 'unobservable' });
  }
}

/** @param {unknown} inputValue @param {() => Promise<Readonly<Record<string, any>>>} readEndpoint @returns {Promise<Readonly<Record<string, any>>>} */
async function observeDockerImage(inputValue, readEndpoint) {
  const input = exactObject(inputValue, 'Docker readiness image input');
  assertExactDataKeys(
    input,
    IMAGE_OBSERVATION_INPUT_KEYS,
    'Docker readiness image input',
  );
  const imageId = patternedString(
    input.imageId,
    IMAGE_ID_PATTERN,
    'Docker readiness image input.imageId',
  );
  const endpoint = await readEndpoint();
  if (
    endpoint.state !== 'observed' ||
    endpoint.locality !== 'local-unix' ||
    endpoint.endpoint === null
  ) {
    return Object.freeze({ state: 'unobservable' });
  }
  try {
    const decoded = exactObject(
      parseOneJsonLine(
        await runReadOperation({
          kind: 'docker-image-inspect',
          endpoint: endpoint.endpoint,
          imageId,
        }),
        'Docker image inspection',
      ),
      'Docker image inspection',
    );
    assertExactDataKeys(
      decoded,
      new Set([
        'id',
        'operatingSystem',
        'architecture',
        'rootfsType',
        'rootfsLayers',
      ]),
      'Docker image inspection',
    );
    const id = patternedString(
      decoded.id,
      IMAGE_ID_PATTERN,
      'Docker image inspection.id',
    );
    const operatingSystem = smallToken(
      decoded.operatingSystem,
      'Docker image operating system',
    );
    const architecture = smallToken(
      decoded.architecture,
      'Docker image architecture',
    );
    const rootfsType = safeSimpleValue(
      decoded.rootfsType,
      'Docker image rootfs type',
    );
    if (
      !Array.isArray(decoded.rootfsLayers) ||
      decoded.rootfsLayers.length > 4096 ||
      decoded.rootfsLayers.some(
        (layer) =>
          typeof layer !== 'string' || !ROOTFS_LAYER_PATTERN.test(layer),
      )
    ) {
      throw new TypeError('Docker image rootfs layers are invalid.');
    }
    const rootfsBytes = Buffer.from(
      `${JSON.stringify(
        sortCanonicalJsonValue({
          type: rootfsType,
          layers: [...decoded.rootfsLayers],
        }),
      )}\n`,
      'utf8',
    );
    return deepFreeze({
      state: 'observed',
      id,
      operatingSystem,
      architecture,
      rootfsDigest: {
        algorithm: 'sha256',
        value: createHash('sha256').update(rootfsBytes).digest('base64url'),
      },
    });
  } catch (error) {
    rethrowReadinessInterruption(error);
    return Object.freeze({ state: 'unobservable' });
  }
}

/** @param {Readonly<{stdout: Buffer, stderr: Buffer}>} result @returns {string[]} */
function parseDockerContainerIds(result) {
  if (result.stderr.length !== 0) {
    throw new Error('Docker container listing emitted diagnostics.');
  }
  if (result.stdout.length === 0) return [];
  const text = decodeUtf8(result.stdout);
  if (!text.endsWith('\n')) {
    throw new Error('Docker container listing is not newline terminated.');
  }
  const lines = text.slice(0, -1).split('\n');
  const ids = lines.map((line) => {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error('Docker container listing is not valid JSON framing.');
    }
    return patternedString(
      value,
      CONTAINER_ID_PATTERN,
      'Docker container listing ID',
    );
  });
  if (new Set(ids).size !== ids.length) {
    throw new Error('Docker container listing contains duplicate IDs.');
  }
  return ids;
}

/** @param {unknown} inputValue @param {() => Promise<Readonly<Record<string, any>>>} readEndpoint @returns {Promise<Readonly<Record<string, any>>>} */
async function observeDockerContainer(inputValue, readEndpoint) {
  const input = exactObject(inputValue, 'Docker readiness container input');
  assertExactDataKeys(
    input,
    CONTAINER_OBSERVATION_INPUT_KEYS,
    'Docker readiness container input',
  );
  const imageId = patternedString(
    input.imageId,
    IMAGE_ID_PATTERN,
    'Docker readiness container input.imageId',
  );
  const sourceCommit = patternedString(
    input.sourceCommit,
    COMMIT_PATTERN,
    'Docker readiness container input.sourceCommit',
  );
  const toolingCommit = patternedString(
    input.toolingCommit,
    COMMIT_PATTERN,
    'Docker readiness container input.toolingCommit',
  );
  const containerName = patternedString(
    input.containerName,
    CONTAINER_NAME_PATTERN,
    'Docker readiness container input.containerName',
  );
  if (containerName !== `wharfie-sea-proof-${sourceCommit}`) {
    throw new TypeError(
      'Docker readiness container name does not match its exact source commit.',
    );
  }
  const endpoint = await readEndpoint();
  if (
    endpoint.state !== 'observed' ||
    endpoint.locality !== 'local-unix' ||
    endpoint.endpoint === null
  ) {
    return Object.freeze({ state: 'unobservable' });
  }
  try {
    const ids = parseDockerContainerIds(
      await runReadOperation({
        kind: 'docker-container-list',
        endpoint: endpoint.endpoint,
        containerName,
      }),
    );
    if (ids.length === 0) return Object.freeze({ state: 'absent' });
    if (ids.length !== 1) return Object.freeze({ state: 'unobservable' });
    const decoded = exactObject(
      parseOneJsonLine(
        await runReadOperation({
          kind: 'docker-container-inspect',
          endpoint: endpoint.endpoint,
          containerId: ids[0],
        }),
        'Docker container inspection',
      ),
      'Docker container inspection',
    );
    assertExactDataKeys(
      decoded,
      new Set([
        'containerId',
        'name',
        'imageId',
        'running',
        'kind',
        'sourceCommit',
        'toolingCommit',
        'invocationId',
      ]),
      'Docker container inspection',
    );
    const containerId = patternedString(
      decoded.containerId,
      CONTAINER_ID_PATTERN,
      'Docker container inspection.containerId',
    );
    if (
      containerId !== ids[0] ||
      typeof decoded.name !== 'string' ||
      typeof decoded.running !== 'boolean'
    ) {
      throw new TypeError('Docker container inspection identity is invalid.');
    }
    const expectedName = `/${containerName}`;
    const owned =
      decoded.name === expectedName &&
      decoded.imageId === imageId &&
      decoded.kind === PROOF_KIND &&
      decoded.sourceCommit === sourceCommit &&
      decoded.toolingCommit === toolingCommit &&
      typeof decoded.invocationId === 'string' &&
      INVOCATION_ID_PATTERN.test(decoded.invocationId);
    const runtimeState = decoded.running ? 'running' : 'stopped';
    const collisionClass = owned
      ? decoded.running
        ? 'running-owned'
        : 'stopped-owned-reconcilable'
      : 'foreign';
    return Object.freeze({
      state: 'observed',
      containerId,
      runtimeState,
      collisionClass,
    });
  } catch (error) {
    rethrowReadinessInterruption(error);
    return Object.freeze({ state: 'unobservable' });
  }
}

/** @param {unknown} error @returns {boolean} */
function isNotFound(error) {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

/** @param {unknown} value @param {string} valuePath @returns {bigint} */
function nonnegativeBigInt(value, valuePath) {
  if (typeof value !== 'bigint' || value < 0n) {
    throw new TypeError(`${valuePath} must be a nonnegative bigint.`);
  }
  return value;
}

/**
 * Observe one already-existing real directory without creating or opening it
 * for write. The caller controls whether an unsafe result is distinct from an
 * unavailable observation.
 * @param {string} directory
 * @returns {Promise<{state: 'observed', writable: boolean, device: string, availableBytes: string} | {state: 'unsafe'} | {state: 'unobservable'}>}
 */
async function observeExistingDirectory(directory) {
  try {
    const before = await lstat(directory, { bigint: true });
    if (
      before.isSymbolicLink() ||
      !before.isDirectory() ||
      (await realpath(directory)) !== directory
    ) {
      return { state: 'unsafe' };
    }
    let writable = true;
    try {
      await access(directory, fsConstants.W_OK | fsConstants.X_OK);
    } catch (error) {
      rethrowReadinessInterruption(error);
      writable = false;
    }
    const filesystem = await statfs(directory, { bigint: true });
    const blockSize = nonnegativeBigInt(
      filesystem.bsize,
      'Filesystem block size',
    );
    const availableBlocks = nonnegativeBigInt(
      filesystem.bavail,
      'Filesystem available blocks',
    );
    if (blockSize < 1n) return { state: 'unobservable' };
    const after = await lstat(directory, { bigint: true });
    if (
      after.isSymbolicLink() ||
      !after.isDirectory() ||
      !sameDirectoryIdentity(before, after) ||
      (await realpath(directory)) !== directory
    ) {
      return { state: 'unsafe' };
    }
    return {
      state: 'observed',
      writable,
      device: before.dev.toString(10),
      availableBytes: (availableBlocks * blockSize).toString(10),
    };
  } catch (error) {
    rethrowReadinessInterruption(error);
    return { state: 'unobservable' };
  }
}

/** @returns {Promise<Readonly<Record<string, any>>>} */
async function observeHostTemp() {
  const rawTemp = os.tmpdir();
  try {
    canonicalAbsoluteNonRootPath(rawTemp, 'Node temporary directory');
  } catch {
    return Object.freeze({ state: 'unsafe' });
  }
  if (rawTemp.includes(',')) {
    return Object.freeze({ state: 'unsafe' });
  }
  let canonicalTemp;
  try {
    canonicalTemp = await realpath(rawTemp);
  } catch (error) {
    rethrowReadinessInterruption(error);
    return Object.freeze({ state: 'unobservable' });
  }
  try {
    canonicalAbsoluteNonRootPath(
      canonicalTemp,
      'Resolved Node temporary directory',
    );
  } catch {
    return Object.freeze({ state: 'unsafe' });
  }
  const observation = await observeExistingDirectory(canonicalTemp);
  if (observation.state === 'unobservable') {
    return Object.freeze({ state: 'unobservable' });
  }
  if (observation.state === 'unsafe') {
    return Object.freeze({ state: 'unsafe' });
  }
  return Object.freeze({
    state: 'observed',
    writable: observation.writable,
    device: observation.device,
    availableBytes: observation.availableBytes,
  });
}

/**
 * Find the nearest existing path without creating missing descendants.
 * @param {string} target
 * @returns {Promise<{targetExists: boolean, existingPath: string, stats: import('node:fs').BigIntStats} | null>}
 */
async function findNearestExistingPath(target) {
  let current = target;
  let targetExists = true;
  while (true) {
    try {
      const stats = await lstat(current, { bigint: true });
      return { targetExists, existingPath: current, stats };
    } catch (error) {
      rethrowReadinessInterruption(error);
      if (!isNotFound(error)) return null;
      targetExists = false;
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

/** @param {unknown} inputValue @returns {Promise<Readonly<Record<string, any>>>} */
async function observeOutput(inputValue) {
  const input = exactObject(inputValue, 'Docker readiness output input');
  assertExactDataKeys(
    input,
    OUTPUT_OBSERVATION_INPUT_KEYS,
    'Docker readiness output input',
  );
  const outputRoot = canonicalAbsoluteNonRootPath(
    input.outputRoot,
    'Docker readiness output input.outputRoot',
  );
  const sourceCommit =
    input.sourceCommit === null
      ? null
      : patternedString(
          input.sourceCommit,
          COMMIT_PATTERN,
          'Docker readiness output input.sourceCommit',
        );
  if (sourceCommit === null) {
    return Object.freeze({ state: 'unobservable' });
  }
  try {
    const nearest = await findNearestExistingPath(outputRoot);
    if (nearest === null) return Object.freeze({ state: 'unobservable' });
    if (
      nearest.stats.isSymbolicLink() ||
      !nearest.stats.isDirectory() ||
      (await realpath(nearest.existingPath)) !== nearest.existingPath
    ) {
      return Object.freeze({ state: 'unsafe' });
    }
    const capacity = await observeExistingDirectory(nearest.existingPath);
    if (capacity.state === 'unobservable') {
      return Object.freeze({ state: 'unobservable' });
    }
    if (capacity.state === 'unsafe') {
      return Object.freeze({ state: 'unsafe' });
    }

    let proofCommitPath = /** @type {'absent'|'present'} */ ('absent');
    if (nearest.targetExists) {
      const exactProofPath = path.join(outputRoot, sourceCommit);
      try {
        await lstat(exactProofPath);
        proofCommitPath = 'present';
      } catch (error) {
        rethrowReadinessInterruption(error);
        if (!isNotFound(error)) {
          return Object.freeze({ state: 'unobservable' });
        }
      }
    }
    return Object.freeze({
      state: 'observed',
      rootState: nearest.targetExists ? 'existing' : 'absent',
      proofCommitPath,
      writable: capacity.writable,
      device: capacity.device,
      availableBytes: capacity.availableBytes,
    });
  } catch (error) {
    rethrowReadinessInterruption(error);
    return Object.freeze({ state: 'unobservable' });
  }
}

/** @returns {Readonly<Record<string, Function>>} */
function createProductionPorts() {
  /** @type {Promise<Readonly<Record<string, any>>> | undefined} */
  let endpointPromise;
  const readBoundEndpoint = () => {
    if (endpointPromise === undefined) endpointPromise = readDockerEndpoint();
    return endpointPromise;
  };
  return Object.freeze({
    readObservedAt() {
      return new Date().toISOString();
    },
    observeRepository,
    observeDockerEndpoint() {
      return observeDockerEndpoint(readBoundEndpoint);
    },
    observeDockerDaemon() {
      return observeDockerDaemon(readBoundEndpoint);
    },
    /** @param {unknown} input */
    observeDockerImage(input) {
      return observeDockerImage(input, readBoundEndpoint);
    },
    /** @param {unknown} input */
    observeDockerContainer(input) {
      return observeDockerContainer(input, readBoundEndpoint);
    },
    observeHostTemp,
    observeOutput,
  });
}

/**
 * Inspect one local Docker proof attempt without creating a container, writing
 * a file, or invoking a mutating Docker/Git operation.
 * @param {unknown} argv
 * @returns {Promise<0|2>}
 */
export async function main(argv = process.argv) {
  const input =
    parseAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessArguments(argv);
  const inspector =
    createAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessInspector(
      Object.freeze({ ports: createProductionPorts() }),
    );
  const report = await inspector.inspect(input);
  const output =
    stringifyAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessReport(
      report,
    );
  if (
    typeof output !== 'string' ||
    output.length < 2 ||
    !output.endsWith('\n') ||
    output.slice(0, -1).includes('\n')
  ) {
    throw new Error(
      'Docker readiness report serializer returned invalid canonical framing.',
    );
  }
  process.stdout.write(output);
  return report.readyForBoundedAttempt ? 0 : 2;
}

const invokedPath =
  typeof process.argv[1] === 'string'
    ? pathToFileURL(path.resolve(process.argv[1])).href
    : null;
if (invokedPath === import.meta.url) {
  main(process.argv)
    .then((exitCode) => {
      if (process.exitCode !== 130 && process.exitCode !== 143) {
        process.exitCode = exitCode;
      }
    })
    .catch(() => {
      process.stderr.write(
        'AWS retained-storage host preflight SEA Linux Docker readiness inspection failed.\n',
      );
      if (
        process.exitCode === undefined ||
        process.exitCode === 0 ||
        process.exitCode === 2
      ) {
        process.exitCode = 1;
      }
    });
}
