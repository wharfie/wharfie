/* eslint-disable jsdoc/valid-types -- The current JSDoc parser does not understand object method signatures. */

import { isIPv4 } from 'node:net';
import { isAbsolute, normalize, posix } from 'node:path';
import { Readable } from 'node:stream';

import { createBoundedProcessRunner } from './bounded-process.js';
import { SINGLE_NODE_RUNTIME_ACCOUNT } from './single-node-runtime-account.js';

export const DEPLOYMENT_OPENSSH_PATH = '/usr/bin/ssh';
export const DEPLOYMENT_OPENSSH_PORT = 22;
export const DEPLOYMENT_OPENSSH_MAX_REMOTE_ARGUMENTS = 128;
export const DEPLOYMENT_OPENSSH_MAX_REMOTE_COMMAND_BYTES = 32 * 1024;
export const DEPLOYMENT_OPENSSH_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
export const DEPLOYMENT_OPENSSH_MAX_DURATION_MILLISECONDS = 10 * 60 * 1000;

const LOCAL_PROCESS_ENVIRONMENT = Object.freeze({
  LANG: 'C',
  LC_ALL: 'C',
  PATH: '/usr/bin:/bin',
});
const FACTORY_KEYS = new Set([
  'address',
  'privateKeyPath',
  'knownHostsPath',
  'runProcess',
]);
const RUN_KEYS = new Set([
  'argv',
  'stdin',
  'timeoutMilliseconds',
  'maximumStdoutBytes',
  'maximumStderrBytes',
]);
const MAX_LOCAL_PATH_BYTES = 16 * 1024;

/**
 * Snapshot one exact plain object without invoking accessors.
 * @param {unknown} value - Candidate object.
 * @param {Set<string>} expectedKeys - Exact required keys.
 * @param {string} valuePath - Human-readable value path.
 * @returns {Record<string, any>} - Independent shallow snapshot.
 */
function snapshotExactObject(value, expectedKeys, valuePath) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError(`${valuePath} must be a plain object.`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedKeys.size ||
    ownKeys.some(
      (key) =>
        typeof key !== 'string' ||
        !expectedKeys.has(/** @type {string} */ (key)),
    )
  ) {
    throw new TypeError(`${valuePath} must contain only its exact fields.`);
  }
  /** @type {Record<string, any>} */
  const snapshot = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(
        `${valuePath}.${key} must be an own enumerable data property.`,
      );
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

/**
 * Require one canonical numeric IPv4 endpoint.
 * @param {unknown} value - Candidate address.
 * @returns {string} - Canonical address.
 */
function validateAddress(value) {
  if (
    typeof value !== 'string' ||
    value.length > 15 ||
    !isIPv4(value) ||
    value !== value.split('.').map(Number).join('.')
  ) {
    throw new TypeError(
      'deploymentOpenSshTransport.address must be one canonical numeric IPv4 address.',
    );
  }
  return value;
}

/**
 * Require one bounded canonical absolute local path.
 * @param {unknown} value - Candidate path.
 * @param {string} valuePath - Human-readable value path.
 * @returns {string} - Canonical path.
 */
function validateLocalPath(value, valuePath) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > MAX_LOCAL_PATH_BYTES ||
    value.includes('\0') ||
    value.includes('\n') ||
    value.includes('\r') ||
    !isAbsolute(value) ||
    normalize(value) !== value
  ) {
    throw new TypeError(
      `${valuePath} must be one bounded canonical absolute local path.`,
    );
  }
  return value;
}

/**
 * Validate a bounded nonnegative integer.
 * @param {unknown} value - Candidate bound.
 * @param {string} valuePath - Human-readable value path.
 * @param {number} maximum - Inclusive upper bound.
 * @param {boolean} positive - Whether zero is forbidden.
 * @returns {number} - Exact validated value.
 */
function validateBound(value, valuePath, maximum, positive) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < (positive ? 1 : 0) ||
    value > maximum
  ) {
    throw new TypeError(
      `${valuePath} must be a ${positive ? 'positive' : 'nonnegative'} safe integer not exceeding ${maximum}.`,
    );
  }
  return value;
}

/**
 * Validate supported standard input without reading or cloning it.
 * @param {unknown} value - Candidate input.
 * @returns {Buffer|Readable|null} - Supported input.
 */
function validateInput(value) {
  if (value === null) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof Readable) return value;
  throw new TypeError(
    'deploymentOpenSshTransport.stdin must be a Buffer, Uint8Array, Readable, or null.',
  );
}

/**
 * Encode exact argv for the POSIX shell used by the SSH exec protocol.
 * Every word is single-quoted; no input is ever interpreted as shell source.
 * @param {unknown} value - Candidate remote argv.
 * @returns {string} - One bounded remote command string.
 */
export function encodePosixArgv(value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > DEPLOYMENT_OPENSSH_MAX_REMOTE_ARGUMENTS
  ) {
    throw new TypeError(
      `deploymentOpenSshTransport.argv must contain between 1 and ${DEPLOYMENT_OPENSSH_MAX_REMOTE_ARGUMENTS} strings.`,
    );
  }
  const argv = value.map((argument, index) => {
    if (typeof argument !== 'string' || argument.includes('\0')) {
      throw new TypeError(
        `deploymentOpenSshTransport.argv[${index}] must be a string without NUL.`,
      );
    }
    return argument;
  });
  if (!posix.isAbsolute(argv[0]) || posix.normalize(argv[0]) !== argv[0]) {
    throw new TypeError(
      'deploymentOpenSshTransport.argv[0] must be a canonical absolute remote executable path.',
    );
  }
  const command = argv
    .map((argument) => `'${argument.replaceAll("'", "'\"'\"'")}'`)
    .join(' ');
  if (
    Buffer.byteLength(command, 'utf8') >
    DEPLOYMENT_OPENSSH_MAX_REMOTE_COMMAND_BYTES
  ) {
    throw new TypeError(
      `deploymentOpenSshTransport remote command must not exceed ${DEPLOYMENT_OPENSSH_MAX_REMOTE_COMMAND_BYTES} UTF-8 bytes.`,
    );
  }
  return command;
}

/**
 * Create one strict OpenSSH transport to the fixed Wharfie runtime account.
 * The only remote execution surface accepts argv; callers cannot supply raw
 * shell text, SSH options, a user, or a port.
 * @param {{address: string, privateKeyPath: string, knownHostsPath: string, runProcess: {run(options: unknown): Promise<import('./bounded-process.js').BoundedProcessOutcome>}}} options - Exact endpoint, identity paths, and process port.
 * @returns {{runRemoteArgv(value: unknown): Promise<import('./bounded-process.js').BoundedProcessOutcome>}} - Bounded remote argv execution.
 */
export function createDeploymentOpenSshTransport(options) {
  const input = snapshotExactObject(
    options,
    FACTORY_KEYS,
    'deploymentOpenSshTransport',
  );
  const address = validateAddress(input.address);
  const privateKeyPath = validateLocalPath(
    input.privateKeyPath,
    'deploymentOpenSshTransport.privateKeyPath',
  );
  const knownHostsPath = validateLocalPath(
    input.knownHostsPath,
    'deploymentOpenSshTransport.knownHostsPath',
  );
  if (privateKeyPath === knownHostsPath) {
    throw new TypeError(
      'deploymentOpenSshTransport identity and known-host paths must differ.',
    );
  }
  if (
    input.runProcess === null ||
    typeof input.runProcess !== 'object' ||
    typeof input.runProcess.run !== 'function'
  ) {
    throw new TypeError(
      'deploymentOpenSshTransport.runProcess must provide run().',
    );
  }
  const runProcess = input.runProcess.run.bind(input.runProcess);
  const destination = `${SINGLE_NODE_RUNTIME_ACCOUNT.user}@${address}`;
  const fixedArguments = Object.freeze([
    '-F',
    '/dev/null',
    '-T',
    '-o',
    'AddKeysToAgent=no',
    '-o',
    'BatchMode=yes',
    '-o',
    'CanonicalizeHostname=no',
    '-o',
    'CheckHostIP=yes',
    '-o',
    'ClearAllForwardings=yes',
    '-o',
    'ConnectionAttempts=1',
    '-o',
    'ConnectTimeout=10',
    '-o',
    'ControlMaster=no',
    '-o',
    'ControlPath=none',
    '-o',
    'ControlPersist=no',
    '-o',
    'EnableSSHKeysign=no',
    '-o',
    'EscapeChar=none',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'ForwardAgent=no',
    '-o',
    'ForwardX11=no',
    '-o',
    'ForwardX11Trusted=no',
    '-o',
    'GlobalKnownHostsFile=/dev/null',
    '-o',
    'GSSAPIAuthentication=no',
    '-o',
    'HostbasedAuthentication=no',
    '-o',
    'HostKeyAlgorithms=ssh-ed25519',
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'IdentityAgent=none',
    '-o',
    'KbdInteractiveAuthentication=no',
    '-o',
    'LogLevel=ERROR',
    '-o',
    'NumberOfPasswordPrompts=0',
    '-o',
    'PasswordAuthentication=no',
    '-o',
    'PermitLocalCommand=no',
    '-o',
    'PreferredAuthentications=publickey',
    '-o',
    'ProxyCommand=none',
    '-o',
    'ProxyJump=none',
    '-o',
    'PubkeyAuthentication=yes',
    '-o',
    'RequestTTY=no',
    '-o',
    'ServerAliveCountMax=2',
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'Tunnel=no',
    '-o',
    `UserKnownHostsFile=${knownHostsPath}`,
    '-o',
    'UpdateHostKeys=no',
    '-o',
    'VerifyHostKeyDNS=no',
    '-i',
    privateKeyPath,
    '-p',
    String(DEPLOYMENT_OPENSSH_PORT),
    '--',
    destination,
  ]);

  return Object.freeze({
    /**
     * Execute one exact remote argv through the fixed strict transport.
     * @param {unknown} value - Remote argv, input, and finite bounds.
     * @returns {Promise<import('./bounded-process.js').BoundedProcessOutcome>} - Exact process outcome.
     */
    async runRemoteArgv(value) {
      const request = snapshotExactObject(
        value,
        RUN_KEYS,
        'deploymentOpenSshTransport.runRemoteArgv',
      );
      const remoteCommand = encodePosixArgv(request.argv);
      const stdin = validateInput(request.stdin);
      const timeoutMilliseconds = validateBound(
        request.timeoutMilliseconds,
        'deploymentOpenSshTransport.timeoutMilliseconds',
        DEPLOYMENT_OPENSSH_MAX_DURATION_MILLISECONDS,
        true,
      );
      const maximumStdoutBytes = validateBound(
        request.maximumStdoutBytes,
        'deploymentOpenSshTransport.maximumStdoutBytes',
        DEPLOYMENT_OPENSSH_MAX_OUTPUT_BYTES,
        false,
      );
      const maximumStderrBytes = validateBound(
        request.maximumStderrBytes,
        'deploymentOpenSshTransport.maximumStderrBytes',
        DEPLOYMENT_OPENSSH_MAX_OUTPUT_BYTES,
        false,
      );
      return await runProcess({
        file: DEPLOYMENT_OPENSSH_PATH,
        args: [...fixedArguments, remoteCommand],
        stdin,
        environment: { ...LOCAL_PROCESS_ENVIRONMENT },
        timeoutMilliseconds,
        maximumStdoutBytes,
        maximumStderrBytes,
      });
    },
  });
}

/**
 * Production factory using the bounded subprocess implementation.
 * @param {Omit<Parameters<typeof createDeploymentOpenSshTransport>[0], 'runProcess'>} options - Exact endpoint and identity paths.
 * @returns {ReturnType<typeof createDeploymentOpenSshTransport>} - Strict transport.
 */
export function createProductionDeploymentOpenSshTransport(options) {
  return createDeploymentOpenSshTransport({
    ...options,
    runProcess: createBoundedProcessRunner(),
  });
}

export default {
  DEPLOYMENT_OPENSSH_MAX_DURATION_MILLISECONDS,
  DEPLOYMENT_OPENSSH_MAX_OUTPUT_BYTES,
  DEPLOYMENT_OPENSSH_MAX_REMOTE_ARGUMENTS,
  DEPLOYMENT_OPENSSH_MAX_REMOTE_COMMAND_BYTES,
  DEPLOYMENT_OPENSSH_PATH,
  DEPLOYMENT_OPENSSH_PORT,
  createDeploymentOpenSshTransport,
  createProductionDeploymentOpenSshTransport,
  encodePosixArgv,
};
