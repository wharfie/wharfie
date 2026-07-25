/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- This privileged host boundary keeps its exact command and test-port contracts inline. */

import { execFile as nodeExecFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { constants as fsConstants, promises as fsp } from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';

import {
  assertApplicationRevisionId,
  validateSha256Digest,
} from './application-revision.js';
import { ARTIFACT_ID_PREFIX, assertArtifactId } from './artifact-record.js';
import { getBuildTargetId } from './build-target.js';
import { assertDomainSeparatedSha256Id } from './content-id.js';
import { DEPLOYMENT_ARTIFACT_STAGE_MAX_BYTES } from './deployment-artifact-stage.js';
import { AWS_SINGLE_NODE_HOST_ACTIVATION_INTENT_ID_PREFIX } from './deployment-aws-host-activation.js';
import { AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX } from './deployment-aws-host-agent-contract.js';
import { AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_ROOT } from './deployment-aws-host-artifact-projection.js';
import { assertDeploymentInstanceId } from './deployment-provider-scope.js';
import { assertLogicalId } from './logical-id.js';
import { validateEmbeddedRevisionRuntimePair } from '../resources/builds/lib/revision-runtime-assets.js';

export const AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_USER = 'wharfie-runtime';
export const AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_GROUP = 'wharfie-runtime';
export const AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_HOME =
  '/var/lib/wharfie-runtime';
export const AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_SHELL = '/usr/sbin/nologin';

const RUNTIME_TMP = `${AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_HOME}/tmp`;
const RUNTIME_CONFIG = `${AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_HOME}/.config`;
const RUNTIME_DATA = `${AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_HOME}/.local/share`;
const GETENT_PATH = '/usr/bin/getent';
const ID_PATH = '/usr/bin/id';
const SETPRIV_PATH = '/usr/bin/setpriv';
const ENV_PATH = '/usr/bin/env';
const SYSTEMD_RUN_PATH = '/usr/bin/systemd-run';
const SYSTEMCTL_PATH = '/usr/bin/systemctl';
const ARTIFACT_FILE_NAME = 'app';
const ARTIFACT_MODE = 0o550;
const NOBODY_IDS = new Set([65_534, 4_294_967_294]);
const TARGET_ID_PATTERN =
  /^node-v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)-linux-(?:x64|arm64)-glibc$/;

const INPUT_KEYS = new Set([
  'requestId',
  'intentId',
  'attemptGeneration',
  'deploymentInstanceId',
  'appId',
  'artifactId',
  'revisionId',
  'targetId',
  'artifactPath',
  'contentLength',
  'byteDigest',
]);
const DIGEST_KEYS = new Set(['algorithm', 'value']);
const METADATA_KEYS = new Set(['artifact', 'revision', 'runtime']);
const METADATA_ARTIFACT_KEYS = new Set(['artifactId', 'byteDigest', 'size']);
const DESIRED_CONVERGENCE_KEYS = new Set([
  'schemaVersion',
  'kind',
  'appId',
  'unit',
  'desired',
  'disposition',
  'basis',
]);
const DESIRED_RELEASE_KEYS = new Set(['artifactId', 'revisionId']);
const DESIRED_CONVERGENCE_DISPOSITIONS = new Set([
  'authorized',
  'conflict',
  'unknown',
]);
const DESIRED_CONVERGENCE_AUTHORIZED_BASES = new Set([
  'physical-absence',
  'durable-install',
  'durable-change',
  'durable-active',
]);
const TEST_ONLY_PORT_KEYS = new Set([
  'projectionRoot',
  'platform',
  'getuid',
  'geteuid',
  'openArtifact',
  'runProcess',
  'wait',
]);
const TEST_ONLY_PORT_METHOD_KEYS = Object.freeze([
  'platform',
  'getuid',
  'geteuid',
  'openArtifact',
  'runProcess',
  'wait',
]);
const PROCESS_OUTCOME_KEYS = new Set([
  'status',
  'exitCode',
  'timedOut',
  'stdout',
  'stderr',
]);
const SERVICE_STATUS_SCHEMA_VERSION = 3;
const SERVICE_STATUS_KIND = 'wharfie.service.status';
const DESIRED_CONVERGENCE_SCHEMA_VERSION = 1;
const DESIRED_CONVERGENCE_KIND = 'wharfie.service.desired-convergence';

const ACCOUNT_COMMAND_TIMEOUT_MILLISECONDS = 5_000;
const ACCOUNT_RECORD_MAX_OUTPUT_BYTES = 16 * 1024;
const ACCOUNT_DATABASE_MAX_OUTPUT_BYTES = 1024 * 1024;
const SERVICE_RUNTIME_MAX_SECONDS = 300;
const SERVICE_STOP_TIMEOUT_SECONDS = 30;
const SERVICE_COMMAND_TIMEOUT_MILLISECONDS =
  (SERVICE_RUNTIME_MAX_SECONDS + SERVICE_STOP_TIMEOUT_SECONDS + 15) * 1_000;
const SERVICE_COMMAND_MAX_OUTPUT_BYTES = 1024 * 1024;
const CLEANUP_STOP_TIMEOUT_MILLISECONDS =
  (SERVICE_STOP_TIMEOUT_SECONDS + 5) * 1_000;
const CLEANUP_SHOW_TIMEOUT_MILLISECONDS = 5_000;
const CLEANUP_MAX_OUTPUT_BYTES = 64 * 1024;
const CLEANUP_POLL_ATTEMPTS = 7;
const CLEANUP_POLL_MILLISECONDS = 100;
const JSON_MAX_DEPTH = 64;
const TRANSIENT_INVOCATION_RANDOM_BYTES = 32;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const TRANSIENT_LOADER_ENVIRONMENT_NAMES = Object.freeze([
  'GCONV_PATH',
  'GLIBC_TUNABLES',
  'LD_ASSUME_KERNEL',
  'LD_AUDIT',
  'LD_BIND_NOT',
  'LD_BIND_NOW',
  'LD_DEBUG',
  'LD_DEBUG_OUTPUT',
  'LD_DYNAMIC_WEAK',
  'LD_HWCAP_MASK',
  'LD_LIBRARY_PATH',
  'LD_ORIGIN_PATH',
  'LD_POINTER_GUARD',
  'LD_PRELOAD',
  'LD_PROFILE',
  'LD_PROFILE_OUTPUT',
  'LD_SHOW_AUXV',
  'LD_TRACE_LOADED_OBJECTS',
  'LD_TRACE_PRELINKING',
  'LD_USE_LOAD_BIAS',
  'LD_VERBOSE',
  'LD_WARN',
  'LOCPATH',
  'MALLOC_CHECK_',
  'MALLOC_PERTURB_',
  'MALLOC_TRACE',
  'NLSPATH',
]);

const OUTER_PROCESS_ENVIRONMENT = Object.freeze({
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  PATH: '/usr/bin:/bin',
});

/** Host platform or root authority does not match the privileged contract. */
export class AwsSingleNodeHostRuntimeServiceAuthorityError extends Error {
  constructor() {
    super(
      'AWS single-node host runtime service command requires real and effective root on Linux.',
    );
    this.name = 'AwsSingleNodeHostRuntimeServiceAuthorityError';
    this.code = 'AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_AUTHORITY_INVALID';
  }
}

/** The fixed runtime user/group identity could not be established exactly. */
export class AwsSingleNodeHostRuntimeServiceAccountError extends Error {
  constructor() {
    super(
      'AWS single-node host runtime service account does not match its fixed contract.',
    );
    this.name = 'AwsSingleNodeHostRuntimeServiceAccountError';
    this.code = 'AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_ACCOUNT_INVALID';
  }
}

/** The projected executable no longer matches its immutable byte envelope. */
export class AwsSingleNodeHostRuntimeServiceArtifactError extends Error {
  constructor() {
    super(
      'AWS single-node host runtime service artifact does not match its fixed projection.',
    );
    this.name = 'AwsSingleNodeHostRuntimeServiceArtifactError';
    this.code = 'AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_ARTIFACT_INVALID';
  }
}

/** A finite command response violated the exact bounded response contract. */
export class AwsSingleNodeHostRuntimeServiceResponseError extends Error {
  constructor() {
    super(
      'AWS single-node host runtime service command returned an invalid response.',
    );
    this.name = 'AwsSingleNodeHostRuntimeServiceResponseError';
    this.code = 'AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_RESPONSE_INVALID';
  }
}

/** An ambiguous launcher was terminated and proven inactive. */
export class AwsSingleNodeHostRuntimeServiceExecutionError extends Error {
  constructor(timedOut = false) {
    super(
      timedOut
        ? 'AWS single-node host runtime service command timed out.'
        : 'AWS single-node host runtime service command execution was interrupted.',
    );
    this.name = 'AwsSingleNodeHostRuntimeServiceExecutionError';
    this.code = timedOut
      ? 'AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_TIMEOUT'
      : 'AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_INTERRUPTED';
    this.timedOut = timedOut;
  }
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Read an exact enumerable own data object without invoking accessors.
 * @param {unknown} value - Candidate object.
 * @param {Set<string>} keys - Required exact string keys.
 * @param {string} valuePath - Human-readable path.
 * @returns {Record<string, any>} - Independently allocated shallow snapshot.
 */
function snapshotExactDataObject(value, keys, valuePath) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${valuePath} must be an object.`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))
  ) {
    throw new TypeError(`${valuePath} must contain only its exact keys.`);
  }
  /** @type {Record<string, any>} */
  const snapshot = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${valuePath}.${key} must be an enumerable value.`);
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

/**
 * Capture one exact own data method against its original receiver.
 * @param {Record<string, any>} value - Port owner.
 * @param {string} key - Method name.
 * @returns {Function} - Stable receiver-bound projection.
 */
function snapshotPortMethod(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    descriptor === undefined ||
    descriptor.enumerable !== true ||
    !Object.hasOwn(descriptor, 'value') ||
    typeof descriptor.value !== 'function'
  ) {
    throw new TypeError(
      `awsSingleNodeHostRuntimeService testOnlyPorts.${key} must be an enumerable function.`,
    );
  }
  const capability = descriptor.value;
  return /** @param {...any} args - Exact invocation arguments. */ (...args) =>
    Reflect.apply(capability, value, args);
}

/** @param {unknown} value @param {string} valuePath @returns {string} */
function canonicalAbsolutePath(value, valuePath) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4096 ||
    value.trim() !== value ||
    value.includes('\0') ||
    value.includes('\n') ||
    value.includes('\r') ||
    !path.isAbsolute(value) ||
    path.normalize(value) !== value
  ) {
    throw new TypeError(`${valuePath} must be a canonical absolute path.`);
  }
  return value;
}

/** @param {unknown} value @param {string} valuePath @returns {number} */
function nonnegativeSafeInteger(value, valuePath) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${valuePath} must be a nonnegative safe integer.`);
  }
  return Number(value);
}

/** @param {unknown} value @param {string} valuePath @returns {number} */
function positiveLinuxIdentity(value, valuePath) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 1 ||
    Number(value) > 4_294_967_294 ||
    NOBODY_IDS.has(Number(value))
  ) {
    throw new AwsSingleNodeHostRuntimeServiceAccountError();
  }
  return Number(value);
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validateInput(value) {
  const input = snapshotExactDataObject(
    value,
    INPUT_KEYS,
    'awsSingleNodeHostRuntimeService input',
  );
  assertDomainSeparatedSha256Id(
    input.requestId,
    AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX,
    'awsSingleNodeHostRuntimeService input.requestId',
  );
  assertDomainSeparatedSha256Id(
    input.intentId,
    AWS_SINGLE_NODE_HOST_ACTIVATION_INTENT_ID_PREFIX,
    'awsSingleNodeHostRuntimeService input.intentId',
  );
  const attemptGeneration = nonnegativeSafeInteger(
    input.attemptGeneration,
    'awsSingleNodeHostRuntimeService input.attemptGeneration',
  );
  assertDeploymentInstanceId(
    input.deploymentInstanceId,
    'awsSingleNodeHostRuntimeService input.deploymentInstanceId',
  );
  assertLogicalId(input.appId, 'awsSingleNodeHostRuntimeService input.appId');
  assertArtifactId(
    input.artifactId,
    'awsSingleNodeHostRuntimeService input.artifactId',
  );
  assertApplicationRevisionId(
    input.revisionId,
    'awsSingleNodeHostRuntimeService input.revisionId',
  );
  if (
    typeof input.targetId !== 'string' ||
    !TARGET_ID_PATTERN.test(input.targetId)
  ) {
    throw new TypeError(
      'awsSingleNodeHostRuntimeService input.targetId must be a canonical supported Linux build target ID.',
    );
  }
  const contentLength = nonnegativeSafeInteger(
    input.contentLength,
    'awsSingleNodeHostRuntimeService input.contentLength',
  );
  if (contentLength > DEPLOYMENT_ARTIFACT_STAGE_MAX_BYTES) {
    throw new TypeError(
      `awsSingleNodeHostRuntimeService input.contentLength must not exceed ${DEPLOYMENT_ARTIFACT_STAGE_MAX_BYTES}.`,
    );
  }
  const digestInput = snapshotExactDataObject(
    input.byteDigest,
    DIGEST_KEYS,
    'awsSingleNodeHostRuntimeService input.byteDigest',
  );
  const byteDigest = validateSha256Digest(
    digestInput,
    'awsSingleNodeHostRuntimeService input.byteDigest',
  );
  if (input.artifactId !== `${ARTIFACT_ID_PREFIX}_${byteDigest.value}`) {
    throw new Error(
      'awsSingleNodeHostRuntimeService input.artifactId must name the exact byteDigest.',
    );
  }
  const artifactPath = canonicalAbsolutePath(
    input.artifactPath,
    'awsSingleNodeHostRuntimeService input.artifactPath',
  );
  return Object.freeze({
    requestId: input.requestId,
    intentId: input.intentId,
    attemptGeneration,
    deploymentInstanceId: input.deploymentInstanceId,
    appId: input.appId,
    artifactId: input.artifactId,
    revisionId: input.revisionId,
    targetId: input.targetId,
    artifactPath,
    contentLength,
    byteDigest: Object.freeze({ ...byteDigest }),
  });
}

/**
 * Run one absolute executable with bounded binary output and a hard timeout.
 * All callers pass absolute commands and argv; no shell participates.
 * @param {string} command - Absolute executable path.
 * @param {readonly string[]} args - Exact argv.
 * @param {{timeoutMilliseconds: number, maxOutputBytes: number}} options - Bounds.
 * @returns {Promise<Readonly<Record<string, any>>>} - Terminal/ambiguous outcome.
 */
function productionRunProcess(command, args, options) {
  return new Promise((resolve) => {
    try {
      nodeExecFile(
        command,
        [...args],
        {
          encoding: 'buffer',
          env: OUTER_PROCESS_ENVIRONMENT,
          maxBuffer: options.maxOutputBytes,
          timeout: options.timeoutMilliseconds,
          killSignal: 'SIGKILL',
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          const stdoutBytes = Buffer.from(stdout || []);
          const stderrBytes = Buffer.from(stderr || []);
          const finiteExit =
            error === null ||
            (typeof error?.code === 'number' &&
              error.killed !== true &&
              (error.signal === null || error.signal === undefined));
          resolve(
            Object.freeze({
              status: finiteExit ? 'exited' : 'ambiguous',
              exitCode:
                error === null ? 0 : finiteExit ? Number(error.code) : null,
              timedOut: error?.killed === true,
              stdout: stdoutBytes,
              stderr: stderrBytes,
            }),
          );
        },
      );
    } catch {
      resolve(
        Object.freeze({
          status: 'ambiguous',
          exitCode: null,
          timedOut: false,
          stdout: Buffer.alloc(0),
          stderr: Buffer.alloc(0),
        }),
      );
    }
  });
}

/** @param {number} milliseconds @returns {Promise<void>} */
async function productionWait(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** @returns {Readonly<Record<string, any>>} */
function createProductionPorts() {
  return Object.freeze({
    projectionRoot: AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_ROOT,
    platform: () => process.platform,
    getuid: () =>
      typeof process.getuid === 'function' ? process.getuid() : undefined,
    geteuid: () =>
      typeof process.geteuid === 'function' ? process.geteuid() : undefined,
    openArtifact:
      /** @param {string} artifactPath @param {number} flags */
      (artifactPath, flags) => fsp.open(artifactPath, flags),
    runProcess: productionRunProcess,
    wait: productionWait,
  });
}

/**
 * Validate and snapshot the explicitly test-only host ports.
 * @param {unknown} value - Candidate test ports.
 * @returns {Readonly<Record<string, any>>} - Stable capabilities.
 */
function validateAndSnapshotPorts(value) {
  const ports = snapshotExactDataObject(
    value,
    TEST_ONLY_PORT_KEYS,
    'awsSingleNodeHostRuntimeService testOnlyPorts',
  );
  const projectionRoot = canonicalAbsolutePath(
    ports.projectionRoot,
    'awsSingleNodeHostRuntimeService testOnlyPorts.projectionRoot',
  );
  /** @type {Record<string, any>} */
  const snapshot = { projectionRoot };
  for (const key of TEST_ONLY_PORT_METHOD_KEYS) {
    snapshot[key] = snapshotPortMethod(
      /** @type {Record<string, any>} */ (value),
      key,
    );
  }
  return Object.freeze(snapshot);
}

/** @param {Readonly<Record<string, any>>} ports @returns {void} */
function assertLinuxRoot(ports) {
  let platform;
  let uid;
  let euid;
  try {
    platform = ports.platform();
    uid = ports.getuid();
    euid = ports.geteuid();
  } catch {
    throw new AwsSingleNodeHostRuntimeServiceAuthorityError();
  }
  if (platform !== 'linux' || uid !== 0 || euid !== 0) {
    throw new AwsSingleNodeHostRuntimeServiceAuthorityError();
  }
}

/**
 * Normalize a trusted process-port response without retaining mutable bytes.
 * @param {unknown} value - Candidate outcome.
 * @param {number} maximumBytes - Combined output bound.
 * @returns {Readonly<Record<string, any>>} - Exact outcome.
 */
function normalizeProcessOutcome(value, maximumBytes) {
  const outcome = snapshotExactDataObject(
    value,
    PROCESS_OUTCOME_KEYS,
    'awsSingleNodeHostRuntimeService process outcome',
  );
  if (!['exited', 'ambiguous'].includes(outcome.status)) {
    throw new TypeError(
      'awsSingleNodeHostRuntimeService process outcome.status is invalid.',
    );
  }
  if (
    (outcome.status === 'exited' &&
      (!Number.isSafeInteger(outcome.exitCode) ||
        Number(outcome.exitCode) < 0 ||
        Number(outcome.exitCode) > 255)) ||
    (outcome.status === 'ambiguous' && outcome.exitCode !== null) ||
    typeof outcome.timedOut !== 'boolean' ||
    !Buffer.isBuffer(outcome.stdout) ||
    !Buffer.isBuffer(outcome.stderr) ||
    outcome.stdout.byteLength > maximumBytes ||
    outcome.stderr.byteLength > maximumBytes ||
    outcome.stdout.byteLength + outcome.stderr.byteLength > maximumBytes
  ) {
    throw new TypeError(
      'awsSingleNodeHostRuntimeService process outcome is invalid.',
    );
  }
  return Object.freeze({
    status: outcome.status,
    exitCode: outcome.status === 'exited' ? Number(outcome.exitCode) : null,
    timedOut: outcome.timedOut,
    stdout: Buffer.from(outcome.stdout),
    stderr: Buffer.from(outcome.stderr),
  });
}

/**
 * Invoke the snapshotted process capability and contain all raw failures.
 * @param {Readonly<Record<string, any>>} ports - Stable host ports.
 * @param {string} command - Absolute executable.
 * @param {readonly string[]} args - Exact argv.
 * @param {number} timeoutMilliseconds - Hard timeout.
 * @param {number} maxOutputBytes - Combined output cap.
 * @returns {Promise<Readonly<Record<string, any>>>} - Safe outcome.
 */
async function invokeProcess(
  ports,
  command,
  args,
  timeoutMilliseconds,
  maxOutputBytes,
) {
  const frozenArgs = Object.freeze([...args]);
  const options = Object.freeze({ timeoutMilliseconds, maxOutputBytes });
  try {
    const outcome = await ports.runProcess(command, frozenArgs, options);
    return normalizeProcessOutcome(outcome, maxOutputBytes);
  } catch {
    return Object.freeze({
      status: 'ambiguous',
      exitCode: null,
      timedOut: false,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
    });
  }
}

/**
 * Require a successful, silent bounded system database query.
 * @param {Readonly<Record<string, any>>} ports - Host ports.
 * @param {string} command - Absolute command.
 * @param {readonly string[]} args - Exact argv.
 * @param {number} maximumBytes - Output cap.
 * @returns {Promise<Buffer>} - Independently owned stdout.
 */
async function queryAccountDatabase(ports, command, args, maximumBytes) {
  const outcome = await invokeProcess(
    ports,
    command,
    args,
    ACCOUNT_COMMAND_TIMEOUT_MILLISECONDS,
    maximumBytes,
  );
  if (
    outcome.status !== 'exited' ||
    outcome.exitCode !== 0 ||
    outcome.stderr.byteLength !== 0
  ) {
    throw new AwsSingleNodeHostRuntimeServiceAccountError();
  }
  return Buffer.from(outcome.stdout);
}

/** @param {Buffer} bytes @returns {string[]} */
function decodeCanonicalLines(bytes) {
  try {
    if (
      bytes.byteLength === 0 ||
      bytes.at(-1) !== 0x0a ||
      bytes.includes(0x00) ||
      bytes.includes(0x0d)
    ) {
      throw new Error();
    }
    const text = UTF8_DECODER.decode(bytes);
    const lines = text.slice(0, -1).split('\n');
    if (lines.length === 0 || lines.some((line) => line.length === 0)) {
      throw new Error();
    }
    return lines;
  } catch {
    throw new AwsSingleNodeHostRuntimeServiceAccountError();
  }
}

/** @param {string} value @returns {number} */
function parseUnsignedLinuxIdentity(value) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new AwsSingleNodeHostRuntimeServiceAccountError();
  }
  const identity = Number(value);
  if (
    !Number.isSafeInteger(identity) ||
    identity < 0 ||
    identity > 4_294_967_294
  ) {
    throw new AwsSingleNodeHostRuntimeServiceAccountError();
  }
  return identity;
}

/** @param {string} value @returns {number} */
function parseRuntimeLinuxIdentity(value) {
  return positiveLinuxIdentity(
    parseUnsignedLinuxIdentity(value),
    'runtime identity',
  );
}

/** @param {string} line @returns {Readonly<Record<string, any>>} */
function parsePasswdLine(line) {
  const fields = line.split(':');
  if (fields.length !== 7 || fields[0].length === 0) {
    throw new AwsSingleNodeHostRuntimeServiceAccountError();
  }
  return Object.freeze({
    text: line,
    name: fields[0],
    marker: fields[1],
    uid: parseUnsignedLinuxIdentity(fields[2]),
    gid: parseUnsignedLinuxIdentity(fields[3]),
    gecos: fields[4],
    home: fields[5],
    shell: fields[6],
  });
}

/** @param {string} line @returns {Readonly<Record<string, any>>} */
function parseGroupLine(line) {
  const fields = line.split(':');
  if (fields.length !== 4 || fields[0].length === 0) {
    throw new AwsSingleNodeHostRuntimeServiceAccountError();
  }
  const members =
    fields[3] === ''
      ? []
      : fields[3].split(',').map((member) => {
          if (member.length === 0) {
            throw new AwsSingleNodeHostRuntimeServiceAccountError();
          }
          return member;
        });
  return Object.freeze({
    text: line,
    name: fields[0],
    marker: fields[1],
    gid: parseUnsignedLinuxIdentity(fields[2]),
    members: Object.freeze(members),
  });
}

/** @param {Buffer} bytes @returns {number} */
function parseSingleId(bytes) {
  const lines = decodeCanonicalLines(bytes);
  if (lines.length !== 1) {
    throw new AwsSingleNodeHostRuntimeServiceAccountError();
  }
  return parseRuntimeLinuxIdentity(lines[0]);
}

/** @param {Buffer} bytes @returns {number[]} */
function parseIdGroups(bytes) {
  const lines = decodeCanonicalLines(bytes);
  if (
    lines.length !== 1 ||
    !/^(?:0|[1-9][0-9]*)(?: (?:0|[1-9][0-9]*))*$/u.test(lines[0])
  ) {
    throw new AwsSingleNodeHostRuntimeServiceAccountError();
  }
  return lines[0].split(' ').map(parseRuntimeLinuxIdentity);
}

/**
 * Resolve and cross-check the exact fixed NSS account/group projection.
 * @param {Readonly<Record<string, any>>} ports - Stable host ports.
 * @returns {Promise<Readonly<{uid: number, gid: number}>>} - Exact IDs.
 */
async function resolveRuntimeAccount(ports) {
  try {
    const [
      selectedPasswdBytes,
      selectedGroupBytes,
      allPasswdBytes,
      allGroupBytes,
      idUidBytes,
      idGidBytes,
      idGroupsBytes,
    ] = await Promise.all([
      queryAccountDatabase(
        ports,
        GETENT_PATH,
        ['passwd', AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_USER],
        ACCOUNT_RECORD_MAX_OUTPUT_BYTES,
      ),
      queryAccountDatabase(
        ports,
        GETENT_PATH,
        ['group', AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_GROUP],
        ACCOUNT_RECORD_MAX_OUTPUT_BYTES,
      ),
      queryAccountDatabase(
        ports,
        GETENT_PATH,
        ['passwd'],
        ACCOUNT_DATABASE_MAX_OUTPUT_BYTES,
      ),
      queryAccountDatabase(
        ports,
        GETENT_PATH,
        ['group'],
        ACCOUNT_DATABASE_MAX_OUTPUT_BYTES,
      ),
      queryAccountDatabase(
        ports,
        ID_PATH,
        ['-u', AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_USER],
        ACCOUNT_RECORD_MAX_OUTPUT_BYTES,
      ),
      queryAccountDatabase(
        ports,
        ID_PATH,
        ['-g', AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_USER],
        ACCOUNT_RECORD_MAX_OUTPUT_BYTES,
      ),
      queryAccountDatabase(
        ports,
        ID_PATH,
        ['-G', AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_USER],
        ACCOUNT_RECORD_MAX_OUTPUT_BYTES,
      ),
    ]);
    const selectedPasswdLines = decodeCanonicalLines(selectedPasswdBytes);
    const selectedGroupLines = decodeCanonicalLines(selectedGroupBytes);
    if (selectedPasswdLines.length !== 1 || selectedGroupLines.length !== 1) {
      throw new AwsSingleNodeHostRuntimeServiceAccountError();
    }
    const selectedPasswd = parsePasswdLine(selectedPasswdLines[0]);
    const selectedGroup = parseGroupLine(selectedGroupLines[0]);
    if (
      selectedPasswd.name !== AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_USER ||
      selectedPasswd.marker !== 'x' ||
      positiveLinuxIdentity(selectedPasswd.uid, 'runtime uid') !==
        selectedPasswd.uid ||
      selectedPasswd.home !== AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_HOME ||
      selectedPasswd.shell !== AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_SHELL ||
      selectedGroup.name !== AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_GROUP ||
      selectedGroup.marker !== 'x' ||
      positiveLinuxIdentity(selectedGroup.gid, 'runtime gid') !==
        selectedGroup.gid ||
      selectedGroup.members.length !== 0 ||
      selectedPasswd.gid !== selectedGroup.gid
    ) {
      throw new AwsSingleNodeHostRuntimeServiceAccountError();
    }
    const allPasswd = decodeCanonicalLines(allPasswdBytes).map(parsePasswdLine);
    const allGroups = decodeCanonicalLines(allGroupBytes).map(parseGroupLine);
    const passwdNameMatches = allPasswd.filter(
      (record) => record.name === AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_USER,
    );
    const groupNameMatches = allGroups.filter(
      (record) => record.name === AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_GROUP,
    );
    const uidMatches = allPasswd.filter(
      (record) => record.uid === selectedPasswd.uid,
    );
    const primaryGidMatches = allPasswd.filter(
      (record) => record.gid === selectedGroup.gid,
    );
    const groupGidMatches = allGroups.filter(
      (record) => record.gid === selectedGroup.gid,
    );
    const ambiguousUserNames = new Set([
      String(selectedPasswd.uid),
      `+${selectedPasswd.uid}`,
    ]);
    const ambiguousGroupNames = new Set([
      String(selectedGroup.gid),
      `+${selectedGroup.gid}`,
    ]);
    if (
      passwdNameMatches.length !== 1 ||
      passwdNameMatches[0].text !== selectedPasswd.text ||
      groupNameMatches.length !== 1 ||
      groupNameMatches[0].text !== selectedGroup.text ||
      uidMatches.length !== 1 ||
      uidMatches[0].text !== selectedPasswd.text ||
      primaryGidMatches.length !== 1 ||
      primaryGidMatches[0].text !== selectedPasswd.text ||
      groupGidMatches.length !== 1 ||
      groupGidMatches[0].text !== selectedGroup.text ||
      allPasswd.some((record) => ambiguousUserNames.has(record.name)) ||
      allGroups.some((record) => ambiguousGroupNames.has(record.name)) ||
      allGroups.some((record) =>
        record.members.includes(AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_USER),
      )
    ) {
      throw new AwsSingleNodeHostRuntimeServiceAccountError();
    }
    const idUid = parseSingleId(idUidBytes);
    const idGid = parseSingleId(idGidBytes);
    const idGroups = parseIdGroups(idGroupsBytes);
    if (
      idUid !== selectedPasswd.uid ||
      idGid !== selectedGroup.gid ||
      idGroups.length !== 1 ||
      idGroups[0] !== selectedGroup.gid
    ) {
      throw new AwsSingleNodeHostRuntimeServiceAccountError();
    }
    return Object.freeze({ uid: selectedPasswd.uid, gid: selectedGroup.gid });
  } catch (error) {
    if (error instanceof AwsSingleNodeHostRuntimeServiceAccountError) {
      throw error;
    }
    throw new AwsSingleNodeHostRuntimeServiceAccountError();
  }
}

/** @param {import('node:fs').Stats} stats @param {number} runtimeGid @returns {void} */
function assertArtifactStats(stats, runtimeGid) {
  if (
    stats === null ||
    typeof stats !== 'object' ||
    typeof stats.isFile !== 'function' ||
    stats.isFile() !== true ||
    !Number.isSafeInteger(stats.uid) ||
    stats.uid !== 0 ||
    !Number.isSafeInteger(stats.gid) ||
    stats.gid !== runtimeGid ||
    !Number.isSafeInteger(stats.mode) ||
    (stats.mode & 0o7777) !== ARTIFACT_MODE ||
    !Number.isSafeInteger(stats.nlink) ||
    stats.nlink !== 1 ||
    !Number.isSafeInteger(stats.size) ||
    stats.size < 0
  ) {
    throw new AwsSingleNodeHostRuntimeServiceArtifactError();
  }
}

/** @param {import('node:fs').Stats} before @param {import('node:fs').Stats} after @returns {boolean} */
function sameArtifactIdentity(before, after) {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.uid === after.uid &&
    before.gid === after.gid &&
    before.mode === after.mode &&
    before.nlink === after.nlink &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  );
}

/**
 * Re-open and hash the exact executable through one held no-follow descriptor.
 * @param {Readonly<Record<string, any>>} ports - Stable host ports.
 * @param {Readonly<Record<string, any>>} input - Validated request projection.
 * @param {number} runtimeGid - Exact runtime group.
 * @returns {Promise<void>} - Resolves only after descriptor closure.
 */
async function verifyProjectedArtifact(ports, input, runtimeGid) {
  let handle;
  let failure;
  try {
    const flags =
      fsConstants.O_RDONLY |
      (fsConstants.O_NOFOLLOW || 0) |
      (fsConstants.O_NONBLOCK || 0);
    handle = await ports.openArtifact(input.artifactPath, flags);
    if (
      handle === null ||
      typeof handle !== 'object' ||
      typeof handle.stat !== 'function' ||
      typeof handle.read !== 'function' ||
      typeof handle.close !== 'function'
    ) {
      throw new AwsSingleNodeHostRuntimeServiceArtifactError();
    }
    const before = await handle.stat();
    assertArtifactStats(before, runtimeGid);
    if (before.size !== input.contentLength) {
      throw new AwsSingleNodeHostRuntimeServiceArtifactError();
    }
    const hash = createHash('sha256');
    let position = 0;
    while (position < input.contentLength) {
      const requested = Math.min(64 * 1024, input.contentLength - position);
      const buffer = Buffer.allocUnsafe(requested);
      const readResult = await handle.read(buffer, 0, requested, position);
      const bytesRead = readResult?.bytesRead;
      if (
        !Number.isSafeInteger(bytesRead) ||
        bytesRead < 1 ||
        bytesRead > requested
      ) {
        throw new AwsSingleNodeHostRuntimeServiceArtifactError();
      }
      hash.update(
        bytesRead === requested ? buffer : buffer.subarray(0, bytesRead),
      );
      position += bytesRead;
    }
    const eof = Buffer.allocUnsafe(1);
    const eofResult = await handle.read(eof, 0, 1, input.contentLength);
    if (eofResult?.bytesRead !== 0) {
      throw new AwsSingleNodeHostRuntimeServiceArtifactError();
    }
    const after = await handle.stat();
    assertArtifactStats(after, runtimeGid);
    if (
      !sameArtifactIdentity(before, after) ||
      after.size !== input.contentLength
    ) {
      throw new AwsSingleNodeHostRuntimeServiceArtifactError();
    }
    const digest = hash.digest('base64url');
    if (
      digest !== input.byteDigest.value ||
      input.artifactId !== `${ARTIFACT_ID_PREFIX}_${digest}`
    ) {
      throw new AwsSingleNodeHostRuntimeServiceArtifactError();
    }
  } catch (error) {
    failure =
      error instanceof AwsSingleNodeHostRuntimeServiceArtifactError
        ? error
        : new AwsSingleNodeHostRuntimeServiceArtifactError();
  } finally {
    if (handle !== undefined && typeof handle.close === 'function') {
      try {
        await handle.close();
      } catch {
        failure = new AwsSingleNodeHostRuntimeServiceArtifactError();
      }
    }
  }
  if (failure !== undefined) throw failure;
}

/** @param {Readonly<{uid: number, gid: number}>} account @returns {readonly string[]} */
function runtimeEnvironment(account) {
  return Object.freeze([
    `HOME=${AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_HOME}`,
    `USER=${AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_USER}`,
    `LOGNAME=${AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_USER}`,
    `XDG_CONFIG_HOME=${RUNTIME_CONFIG}`,
    `XDG_DATA_HOME=${RUNTIME_DATA}`,
    `XDG_RUNTIME_DIR=/run/user/${account.uid}`,
    `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${account.uid}/bus`,
    'LANG=C.UTF-8',
    'LC_ALL=C.UTF-8',
    'PATH=/usr/bin:/bin',
    `TMPDIR=${RUNTIME_TMP}`,
  ]);
}

/**
 * Build the fixed privilege-drop prefix through the clean client environment.
 * @param {Readonly<{uid: number, gid: number}>} account - Runtime identity.
 * @returns {string[]} - Mutable internal argv prefix.
 */
function setprivClientPrefix(account) {
  return [
    '--reuid',
    `+${account.uid}`,
    '--regid',
    `+${account.gid}`,
    '--clear-groups',
    '--bounding-set=-all',
    '--inh-caps=-all',
    '--ambient-caps=-all',
    '--no-new-privs',
    ENV_PATH,
    '-i',
    ...runtimeEnvironment(account),
  ];
}

/** @param {'metadata'|'inspect'|'converge'} action @param {string} appId @returns {string} */
function transientUnitName(action, appId) {
  let invocationId;
  try {
    invocationId = randomBytes(TRANSIENT_INVOCATION_RANDOM_BYTES).toString(
      'hex',
    );
  } catch {
    throw new AwsSingleNodeHostRuntimeServiceExecutionError(false);
  }
  const namespace = action === 'metadata' ? 'metadata' : 'service';
  return `wharfie-host-runtime-${namespace}-${appId}-${invocationId}.service`;
}

/**
 * Construct one exact systemd-run launcher.
 * @param {'metadata'|'inspect'|'converge'} action - Stable operation identity.
 * @param {Readonly<Record<string, any>>} input - Exact artifact request.
 * @param {Readonly<{uid: number, gid: number}>} account - Runtime account.
 * @returns {Readonly<{unitName: string, args: readonly string[]}>} - Fixed launch.
 */
function createLauncher(action, input, account) {
  const unitName = transientUnitName(action, input.appId);
  const artifactArguments =
    action === 'metadata'
      ? ['wharfie', 'metadata', '--json', '--no-pretty']
      : [
          'wharfie',
          'service',
          action === 'inspect' ? 'status' : 'converge',
          '--json',
        ];
  const args = [
    ...setprivClientPrefix(account),
    SYSTEMD_RUN_PATH,
    '--user',
    '--quiet',
    '--wait',
    '--pipe',
    '--collect',
    `--unit=${unitName}`,
    `--working-directory=${AWS_SINGLE_NODE_HOST_RUNTIME_SERVICE_HOME}`,
    '--property=Type=exec',
    '--property=NoNewPrivileges=yes',
    '--property=UMask=0077',
    '--property=KillMode=control-group',
    `--property=UnsetEnvironment=${TRANSIENT_LOADER_ENVIRONMENT_NAMES.join(
      ' ',
    )}`,
    `--property=RuntimeMaxSec=${SERVICE_RUNTIME_MAX_SECONDS}s`,
    `--property=TimeoutStopSec=${SERVICE_STOP_TIMEOUT_SECONDS}s`,
    '--',
    ENV_PATH,
    '-i',
    ...runtimeEnvironment(account),
    input.artifactPath,
    ...artifactArguments,
  ];
  // Availability of the user bus is proven by systemd-run itself. Attestation
  // that user@UID.service still carries the bootstrap IPAddressDeny IMDS
  // drop-in is intentionally not owned by this command boundary yet.
  return Object.freeze({ unitName, args: Object.freeze(args) });
}

/**
 * Decode precisely `JSON.stringify(object) + "\n"` and deeply freeze it.
 * @param {Buffer} stdout - Exact process bytes.
 * @param {Buffer} stderr - Exact process error bytes.
 * @returns {Readonly<Record<string, any>>} - Parsed response.
 */
function decodeExactJsonObject(stdout, stderr) {
  try {
    if (
      stderr.byteLength !== 0 ||
      stdout.byteLength === 0 ||
      stdout.at(-1) !== 0x0a
    ) {
      throw new Error();
    }
    const text = UTF8_DECODER.decode(stdout);
    const parsed = JSON.parse(text);
    if (!isPlainObject(parsed)) throw new Error();
    const canonical = Buffer.from(`${JSON.stringify(parsed)}\n`, 'utf8');
    if (!canonical.equals(stdout)) throw new Error();

    /** @param {any} value @param {number} depth @returns {void} */
    function validateAndFreeze(value, depth) {
      if (value === null || typeof value !== 'object') return;
      if (depth > JSON_MAX_DEPTH) throw new Error();
      const prototype = Object.getPrototypeOf(value);
      if (
        !Array.isArray(value) &&
        prototype !== Object.prototype &&
        prototype !== null
      ) {
        throw new Error();
      }
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string') throw new Error();
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (
          descriptor === undefined ||
          descriptor.enumerable !== true ||
          !Object.hasOwn(descriptor, 'value')
        ) {
          throw new Error();
        }
        validateAndFreeze(descriptor.value, depth + 1);
      }
      Object.freeze(value);
    }

    validateAndFreeze(parsed, 0);
    return parsed;
  } catch {
    throw new AwsSingleNodeHostRuntimeServiceResponseError();
  }
}

/**
 * Bind a strict metadata preflight to the exact projected bytes and request.
 * @param {unknown} value - Canonically decoded metadata command response.
 * @param {Readonly<Record<string, any>>} input - Exact service command input.
 * @returns {void}
 */
function validateExactArtifactMetadata(value, input) {
  try {
    const metadata = snapshotExactDataObject(
      value,
      METADATA_KEYS,
      'awsSingleNodeHostRuntimeService metadata',
    );
    const artifact = snapshotExactDataObject(
      metadata.artifact,
      METADATA_ARTIFACT_KEYS,
      'awsSingleNodeHostRuntimeService metadata.artifact',
    );
    assertArtifactId(
      artifact.artifactId,
      'awsSingleNodeHostRuntimeService metadata.artifact.artifactId',
    );
    const byteDigestInput = snapshotExactDataObject(
      artifact.byteDigest,
      DIGEST_KEYS,
      'awsSingleNodeHostRuntimeService metadata.artifact.byteDigest',
    );
    const byteDigest = validateSha256Digest(
      byteDigestInput,
      'awsSingleNodeHostRuntimeService metadata.artifact.byteDigest',
    );
    const size = nonnegativeSafeInteger(
      artifact.size,
      'awsSingleNodeHostRuntimeService metadata.artifact.size',
    );
    const pair = validateEmbeddedRevisionRuntimePair(
      metadata.revision,
      metadata.runtime,
      'awsSingleNodeHostRuntimeService metadata',
    );
    if (
      pair.runtime.appId !== input.appId ||
      pair.runtime.revisionId !== input.revisionId ||
      pair.revision.revisionId !== input.revisionId ||
      getBuildTargetId(
        pair.runtime.target,
        'awsSingleNodeHostRuntimeService metadata.runtime.target',
      ) !== input.targetId ||
      artifact.artifactId !== input.artifactId ||
      byteDigest.algorithm !== input.byteDigest.algorithm ||
      byteDigest.value !== input.byteDigest.value ||
      size !== input.contentLength
    ) {
      throw new Error();
    }
  } catch {
    throw new AwsSingleNodeHostRuntimeServiceArtifactError();
  }
}

/**
 * Require status V3 to carry one exact read-only convergence decision bound to
 * the independently verified SEA. The manager owns the decision; this root
 * boundary prevents a stale or different desired artifact from borrowing it.
 * @param {unknown} value - Canonically decoded service-status response.
 * @param {Readonly<Record<string, any>>} input - Exact verified service input.
 * @returns {void}
 */
function validateExactDesiredConvergenceStatus(value, input) {
  try {
    if (!isPlainObject(value)) throw new Error();
    const status = /** @type {Record<string, any>} */ (value);
    const expectedUnit = `wharfie-${input.appId}.service`;
    if (
      status.schemaVersion !== SERVICE_STATUS_SCHEMA_VERSION ||
      status.kind !== SERVICE_STATUS_KIND ||
      status.appId !== input.appId ||
      status.unit !== expectedUnit
    ) {
      throw new Error();
    }
    const proof = snapshotExactDataObject(
      status.desiredConvergence,
      DESIRED_CONVERGENCE_KEYS,
      'awsSingleNodeHostRuntimeService desired convergence',
    );
    const desired = snapshotExactDataObject(
      proof.desired,
      DESIRED_RELEASE_KEYS,
      'awsSingleNodeHostRuntimeService desired convergence.desired',
    );
    assertArtifactId(
      desired.artifactId,
      'awsSingleNodeHostRuntimeService desired convergence.desired.artifactId',
    );
    assertApplicationRevisionId(
      desired.revisionId,
      'awsSingleNodeHostRuntimeService desired convergence.desired.revisionId',
    );
    if (
      proof.schemaVersion !== DESIRED_CONVERGENCE_SCHEMA_VERSION ||
      proof.kind !== DESIRED_CONVERGENCE_KIND ||
      proof.appId !== input.appId ||
      proof.unit !== expectedUnit ||
      desired.artifactId !== input.artifactId ||
      desired.revisionId !== input.revisionId ||
      !DESIRED_CONVERGENCE_DISPOSITIONS.has(proof.disposition) ||
      (proof.disposition === 'authorized'
        ? !DESIRED_CONVERGENCE_AUTHORIZED_BASES.has(proof.basis)
        : proof.basis !== null)
    ) {
      throw new Error();
    }
  } catch {
    throw new AwsSingleNodeHostRuntimeServiceResponseError();
  }
}

/**
 * Parse the exact two-property systemctl show readback.
 * @param {Readonly<Record<string, any>>} outcome - Process response.
 * @returns {boolean} - Whether the transient unit has no live process.
 */
function isTerminalUnitReadback(outcome) {
  if (
    outcome.status !== 'exited' ||
    outcome.exitCode !== 0 ||
    outcome.stderr.byteLength !== 0
  ) {
    return false;
  }
  try {
    const lines = decodeCanonicalLines(outcome.stdout);
    if (lines.length !== 2) return false;
    /** @type {Record<string, string>} */
    const properties = {};
    for (const line of lines) {
      const separator = line.indexOf('=');
      if (separator < 1) return false;
      const key = line.slice(0, separator);
      if (
        !['LoadState', 'ActiveState'].includes(key) ||
        Object.hasOwn(properties, key)
      ) {
        return false;
      }
      properties[key] = line.slice(separator + 1);
    }
    if (!Object.hasOwn(properties, 'LoadState')) return false;
    if (!Object.hasOwn(properties, 'ActiveState')) return false;
    return (
      (properties.LoadState === 'not-found' &&
        properties.ActiveState === 'inactive') ||
      (properties.LoadState !== 'not-found' &&
        properties.ActiveState === 'inactive')
    );
  } catch {
    return false;
  }
}

/**
 * Force-stop and independently prove one ambiguous transient unit terminal.
 * @param {Readonly<Record<string, any>>} ports - Stable host ports.
 * @param {Readonly<{uid: number, gid: number}>} account - Runtime account.
 * @param {string} unitName - Stable unit name.
 * @returns {Promise<boolean>} - Whether terminality was proven.
 */
async function stopAndProveTransientUnitTerminal(ports, account, unitName) {
  const prefix = setprivClientPrefix(account);
  await invokeProcess(
    ports,
    SETPRIV_PATH,
    [...prefix, SYSTEMCTL_PATH, '--user', 'stop', unitName],
    CLEANUP_STOP_TIMEOUT_MILLISECONDS,
    CLEANUP_MAX_OUTPUT_BYTES,
  );
  for (let attempt = 0; attempt < CLEANUP_POLL_ATTEMPTS; attempt += 1) {
    const outcome = await invokeProcess(
      ports,
      SETPRIV_PATH,
      [
        ...prefix,
        SYSTEMCTL_PATH,
        '--user',
        'show',
        '--property=LoadState',
        '--property=ActiveState',
        unitName,
      ],
      CLEANUP_SHOW_TIMEOUT_MILLISECONDS,
      CLEANUP_MAX_OUTPUT_BYTES,
    );
    if (isTerminalUnitReadback(outcome)) return true;
    if (attempt + 1 < CLEANUP_POLL_ATTEMPTS) {
      try {
        await ports.wait(CLEANUP_POLL_MILLISECONDS);
      } catch {
        return false;
      }
    }
  }
  return false;
}

/**
 * Execute one tracked transient unit, containing ambiguous process loss.
 * @param {Readonly<Record<string, any>>} ports - Stable host ports.
 * @param {Readonly<{uid: number, gid: number}>} account - Runtime account.
 * @param {Readonly<{unitName: string, args: readonly string[]}>} launcher - Fixed launch.
 * @returns {Promise<Readonly<Record<string, any>>>} - Finite process outcome.
 */
async function runTrackedLauncher(ports, account, launcher) {
  const outcome = await invokeProcess(
    ports,
    SETPRIV_PATH,
    launcher.args,
    SERVICE_COMMAND_TIMEOUT_MILLISECONDS,
    SERVICE_COMMAND_MAX_OUTPUT_BYTES,
  );
  if (outcome.status === 'ambiguous' || outcome.exitCode !== 0) {
    // A nonzero systemd-run result is not proof that the transient unit never
    // started: the client can lose its bus/event result after dispatch. Never
    // release the host's dispatch boundary while this app-scoped unit may
    // still execute. A supervisor may replace this root process; the stable
    // The cryptographic per-launch unit name is never intentionally reused,
    // so delayed cleanup cannot address a successor through a stable-name
    // ABA. The invoked V64 status/converge boundary separately holds its
    // app-scoped kernel operation lock across every service effect.
    for (;;) {
      const terminal = await stopAndProveTransientUnitTerminal(
        ports,
        account,
        launcher.unitName,
      );
      if (terminal) {
        if (outcome.status === 'ambiguous') {
          throw new AwsSingleNodeHostRuntimeServiceExecutionError(
            outcome.timedOut,
          );
        }
        return outcome;
      }
      try {
        await ports.wait(CLEANUP_POLL_MILLISECONDS);
      } catch {
        // A broken injected clock cannot safely turn ambiguity into return.
        await new Promise(() => {});
      }
    }
  }
  return outcome;
}

/**
 * Build the immutable exact runtime service command.
 * @param {Readonly<Record<string, any>>} ports - Snapshotted host ports.
 * @returns {Readonly<{inspectExactService: Function, convergeExactService: Function}>}
 */
function createCommandFromPorts(ports) {
  /**
   * @param {'inspect'|'converge'} action - Fixed command action.
   * @param {unknown} value - Exact request/artifact projection.
   * @returns {Promise<Readonly<Record<string, any>>>} - Parsed command document.
   */
  async function execute(action, value) {
    const input = validateInput(value);
    if (action === 'converge' && input.attemptGeneration < 1) {
      throw new TypeError(
        'awsSingleNodeHostRuntimeService converge requires a positive attemptGeneration.',
      );
    }
    const expectedArtifactPath = path.join(
      ports.projectionRoot,
      input.deploymentInstanceId,
      input.requestId,
      ARTIFACT_FILE_NAME,
    );
    if (input.artifactPath !== expectedArtifactPath) {
      throw new AwsSingleNodeHostRuntimeServiceArtifactError();
    }
    assertLinuxRoot(ports);
    const account = await resolveRuntimeAccount(ports);
    const metadataLauncher = createLauncher('metadata', input, account);
    const launcher = createLauncher(action, input, account);

    // Each launch has its own final descriptor read. A path replacement after
    // metadata inspection therefore cannot reach the mutating service action.
    await verifyProjectedArtifact(ports, input, account.gid);
    const metadataOutcome = await runTrackedLauncher(
      ports,
      account,
      metadataLauncher,
    );
    if (metadataOutcome.exitCode !== 0) {
      throw new AwsSingleNodeHostRuntimeServiceResponseError();
    }
    validateExactArtifactMetadata(
      decodeExactJsonObject(metadataOutcome.stdout, metadataOutcome.stderr),
      input,
    );

    // This is deliberately the final awaited preparation before starting the
    // requested service unit.
    await verifyProjectedArtifact(ports, input, account.gid);
    const outcome = await runTrackedLauncher(ports, account, launcher);
    if (action === 'inspect' && outcome.exitCode !== 0) {
      throw new AwsSingleNodeHostRuntimeServiceResponseError();
    }
    const response = decodeExactJsonObject(outcome.stdout, outcome.stderr);
    if (action === 'inspect') {
      validateExactDesiredConvergenceStatus(response, input);
    }
    return response;
  }

  return Object.freeze({
    inspectExactService: Object.freeze(
      /** @param {unknown} input - Exact service inspection request. */
      async (input) => await execute('inspect', input),
    ),
    convergeExactService: Object.freeze(
      /** @param {unknown} input - Exact service convergence request. */
      async (input) => await execute('converge', input),
    ),
  });
}

/**
 * Create the production privileged command using only fixed host facilities.
 * The factory intentionally accepts no options.
 * @returns {Readonly<{inspectExactService: Function, convergeExactService: Function}>}
 */
export function createAwsSingleNodeHostRuntimeServiceCommand() {
  if (arguments.length !== 0) {
    throw new TypeError(
      'createAwsSingleNodeHostRuntimeServiceCommand does not accept options.',
    );
  }
  const ports = validateAndSnapshotPorts(createProductionPorts());
  assertLinuxRoot(ports);
  return createCommandFromPorts(ports);
}

/**
 * Explicit test-only seam for deterministic host/process/filesystem tests.
 * This export must never be wired into a production host agent.
 * @param {unknown} testOnlyPorts - Exact replacement ports and projection root.
 * @returns {Readonly<{inspectExactService: Function, convergeExactService: Function}>}
 */
export function createAwsSingleNodeHostRuntimeServiceCommandForTest(
  testOnlyPorts,
) {
  return createCommandFromPorts(validateAndSnapshotPorts(testOnlyPorts));
}

export default createAwsSingleNodeHostRuntimeServiceCommand;
