/* eslint-disable jsdoc/valid-types -- The current JSDoc parser does not understand object method signatures. */

import { constants as fsConstants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isIPv4 } from 'node:net';
import { isAbsolute, normalize } from 'node:path';

import { validateSshEd25519PublicKey } from './single-node-cloud-init.js';

export const DEPLOYMENT_SSH_KEYSCAN_PATH = '/usr/bin/ssh-keyscan';

const MAX_KNOWN_HOSTS_BYTES = 64 * 1024;
const PROCESS_ENVIRONMENT = Object.freeze({
  LANG: 'C',
  LC_ALL: 'C',
  PATH: '/usr/bin:/bin',
});

/**
 * @param {unknown} value - Candidate address.
 * @returns {string} - Canonical numeric IPv4 address.
 */
function addressValue(value) {
  if (
    typeof value !== 'string' ||
    value.length > 15 ||
    !isIPv4(value) ||
    value !== value.split('.').map(Number).join('.')
  ) {
    throw new TypeError(
      'deploymentSshHostKey.address must be one canonical numeric IPv4 address.',
    );
  }
  return value;
}

/**
 * @param {unknown} value - Candidate local path.
 * @returns {string} - Canonical absolute path.
 */
function knownHostsPathValue(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > 16 * 1024 ||
    value.includes('\0') ||
    value.includes('\n') ||
    value.includes('\r') ||
    !isAbsolute(value) ||
    normalize(value) !== value
  ) {
    throw new TypeError(
      'deploymentSshHostKey.knownHostsPath must be a canonical absolute path.',
    );
  }
  return value;
}

/**
 * @param {string} line - Candidate known-host line.
 * @param {string} address - Exact provider-observed endpoint.
 * @returns {Readonly<{address: string, algorithm: 'ssh-ed25519', fingerprint: string, line: string}>} - Canonical host-key evidence.
 */
function parseKnownHost(line, address) {
  if (
    Buffer.byteLength(line, 'utf8') > 2048 ||
    line.includes('\0') ||
    line.includes('\n') ||
    line.includes('\r')
  ) {
    throw new Error('deploymentSshHostKey contains invalid host-key evidence.');
  }
  const fields = line.split(' ');
  if (fields.length !== 3 || fields[0] !== address) {
    throw new Error(
      'deploymentSshHostKey does not match the exact provider address.',
    );
  }
  const publicKey = validateSshEd25519PublicKey(
    `${fields[1]} ${fields[2]}`,
    'deploymentSshHostKey.publicKey',
  );
  return Object.freeze({
    address,
    algorithm: /** @type {const} */ ('ssh-ed25519'),
    fingerprint: publicKey.fingerprint,
    line: `${address} ${publicKey.publicKey}`,
  });
}

/**
 * @param {Buffer} bytes - Bounded ssh-keyscan output.
 * @param {string} address - Exact provider-observed endpoint.
 * @returns {ReturnType<typeof parseKnownHost>} - One unique host key.
 */
function parseKeyscan(bytes, address) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(
      'deploymentSshHostKey scan returned invalid host-key evidence.',
    );
  }
  const candidates = [
    ...new Set(
      text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#')),
    ),
  ];
  if (candidates.length !== 1) {
    throw new Error(
      'deploymentSshHostKey scan did not return exactly one unique Ed25519 key.',
    );
  }
  return parseKnownHost(candidates[0], address);
}

/**
 * Enroll or reverify one first-use Ed25519 SSH host key. The caller must first
 * cross-check `address` against the exact provider-owned server; this boundary
 * records TOFU evidence and makes no provider-attestation claim.
 * @param {{address: string, knownHostsPath: string, runProcess: {run(options: unknown): Promise<import('./bounded-process.js').BoundedProcessOutcome>}}} value - Exact address, private store path, and subprocess port.
 * @returns {Promise<Readonly<{address: string, algorithm: 'ssh-ed25519', fingerprint: string}>>} - Durable public host-key evidence.
 */
export async function ensureDeploymentSshHostKey(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Reflect.ownKeys(value).length !== 3 ||
    !['address', 'knownHostsPath', 'runProcess'].every((key) =>
      Object.hasOwn(value, key),
    )
  ) {
    throw new TypeError('deploymentSshHostKey input is invalid.');
  }
  const address = addressValue(value.address);
  const knownHostsPath = knownHostsPathValue(value.knownHostsPath);
  if (
    value.runProcess === null ||
    typeof value.runProcess !== 'object' ||
    typeof value.runProcess.run !== 'function'
  ) {
    throw new TypeError('deploymentSshHostKey.runProcess must provide run().');
  }
  const runProcess = value.runProcess.run.bind(value.runProcess);
  const handle = await open(
    knownHostsPath,
    fsConstants.O_RDWR | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
  );
  try {
    const stats = await handle.stat();
    if (
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      (stats.mode & 0o777) !== 0o600 ||
      stats.size > MAX_KNOWN_HOSTS_BYTES
    ) {
      throw new Error(
        'deploymentSshHostKey known-hosts state is not an exact private file.',
      );
    }
    const current = Buffer.alloc(stats.size);
    if (current.byteLength > 0) {
      const { bytesRead } = await handle.read(
        current,
        0,
        current.byteLength,
        0,
      );
      if (bytesRead !== current.byteLength) {
        throw new Error(
          'deploymentSshHostKey known-hosts state changed while read.',
        );
      }
      const line = current.toString('utf8').trimEnd();
      const evidence = parseKnownHost(line, address);
      return Object.freeze({
        address: evidence.address,
        algorithm: evidence.algorithm,
        fingerprint: evidence.fingerprint,
      });
    }

    const outcome = await runProcess({
      file: DEPLOYMENT_SSH_KEYSCAN_PATH,
      args: ['-4', '-T', '10', '-t', 'ed25519', address],
      stdin: null,
      environment: { ...PROCESS_ENVIRONMENT },
      timeoutMilliseconds: 20_000,
      maximumStdoutBytes: 16 * 1024,
      maximumStderrBytes: 16 * 1024,
    });
    if (outcome.status !== 'exited' || outcome.exitCode !== 0) {
      throw new Error('deploymentSshHostKey scan failed.');
    }
    const scanned = parseKeyscan(outcome.stdout, address);
    const encoded = Buffer.from(`${scanned.line}\n`, 'utf8');
    await handle.truncate(0);
    let offset = 0;
    while (offset < encoded.byteLength) {
      const { bytesWritten } = await handle.write(
        encoded,
        offset,
        encoded.byteLength - offset,
        offset,
      );
      if (bytesWritten === 0) {
        throw new Error(
          'deploymentSshHostKey known-hosts state could not be written.',
        );
      }
      offset += bytesWritten;
    }
    await handle.sync();
    return Object.freeze({
      address: scanned.address,
      algorithm: scanned.algorithm,
      fingerprint: scanned.fingerprint,
    });
  } finally {
    await handle.close();
  }
}

export default {
  DEPLOYMENT_SSH_KEYSCAN_PATH,
  ensureDeploymentSshHostKey,
};
