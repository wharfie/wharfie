import { createHash } from 'node:crypto';

import { sortCanonicalJsonValue } from './canonical-order.js';
import { sha256Base64Url } from './content-id.js';
import { cloneJsonObject } from './json-value.js';
import { assertManifestIsSecretFree } from './manifest-security.js';
import {
  assertSingleNodeDeploymentIncarnationId,
  assertSingleNodeDeploymentInstanceId,
} from './single-node-deployment-identity.js';
import { SINGLE_NODE_RUNTIME_ACCOUNT } from './single-node-runtime-account.js';

export const SINGLE_NODE_CLOUD_INIT_CONTRACT_VERSION = 1;
export const SINGLE_NODE_CLOUD_INIT_MAX_BYTES = 16 * 1024;
export const SINGLE_NODE_BOOTSTRAP_IDENTITY_PATH =
  '/etc/wharfie/bootstrap-v1.json';
export const SINGLE_NODE_BOOTSTRAP_COMPLETE_PATH =
  '/var/lib/wharfie-bootstrap-v1.complete';
export const SINGLE_NODE_DATA_ROOT =
  '/home/wharfie/.local/share/wharfie-nodejs';
export const SINGLE_NODE_DEPLOYMENT_ROOT = `${SINGLE_NODE_DATA_ROOT}/deployments`;

const SSH_ED25519_ALGORITHM = 'ssh-ed25519';
const SSH_FINGERPRINT_PATTERN = /^SHA256:[A-Za-z0-9+/]{43}$/;
const PUBLIC_KEY_LINE_PATTERN = /^(ssh-ed25519) ([A-Za-z0-9+/]+={0,2})$/;
const INPUT_KEYS = new Set([
  'deploymentInstanceId',
  'incarnationId',
  'publicKey',
  'publicKeyFingerprint',
]);

/**
 * @param {Record<string, any>} value - Object to inspect.
 * @param {Set<string>} expectedKeys - Exact required keys.
 * @param {string} valuePath - Human-readable value path.
 * @returns {void}
 */
function assertAllKeys(value, expectedKeys, valuePath) {
  for (const key of Object.keys(value)) {
    if (!expectedKeys.has(key)) {
      throw new TypeError(`${valuePath}.${key} is not supported.`);
    }
  }
  for (const key of expectedKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`${valuePath}.${key} is required.`);
    }
  }
}

/**
 * Read one length-prefixed SSH wire string.
 * @param {Buffer} bytes - Complete SSH public-key blob.
 * @param {number} offset - Current byte offset.
 * @param {string} valuePath - Human-readable value path.
 * @returns {{value: Buffer, offset: number}} - Parsed string and next offset.
 */
function readSshWireString(bytes, offset, valuePath) {
  if (offset + 4 > bytes.byteLength) {
    throw new TypeError(`${valuePath} has a truncated SSH wire value.`);
  }
  const length = bytes.readUInt32BE(offset);
  const start = offset + 4;
  const end = start + length;
  if (end > bytes.byteLength) {
    throw new TypeError(`${valuePath} has a truncated SSH wire value.`);
  }
  return { value: bytes.subarray(start, end), offset: end };
}

/**
 * Validate and canonicalize one OpenSSH Ed25519 public-key line.
 * @param {unknown} value - Candidate public-key line.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {{publicKey: string, fingerprint: string}} - Canonical public evidence.
 */
export function validateSshEd25519PublicKey(value, valuePath = 'publicKey') {
  if (typeof value !== 'string' || value.length > 1024) {
    throw new TypeError(
      `${valuePath} must be one bounded canonical ssh-ed25519 public-key line.`,
    );
  }
  const match = PUBLIC_KEY_LINE_PATTERN.exec(value);
  if (!match) {
    throw new TypeError(
      `${valuePath} must be one bounded canonical ssh-ed25519 public-key line.`,
    );
  }

  const blob = Buffer.from(match[2], 'base64');
  if (blob.toString('base64') !== match[2]) {
    throw new TypeError(`${valuePath} must use canonical base64 encoding.`);
  }
  const algorithm = readSshWireString(blob, 0, valuePath);
  const key = readSshWireString(blob, algorithm.offset, valuePath);
  if (
    algorithm.value.toString('ascii') !== SSH_ED25519_ALGORITHM ||
    key.value.byteLength !== 32 ||
    key.offset !== blob.byteLength
  ) {
    throw new TypeError(
      `${valuePath} must contain exactly one Ed25519 SSH public key.`,
    );
  }

  const fingerprint = `SHA256:${createHash('sha256')
    .update(blob)
    .digest('base64')
    .replace(/=+$/, '')}`;
  return {
    publicKey: `${match[1]} ${match[2]}`,
    fingerprint,
  };
}

/**
 * Create deterministic, secret-free cloud-init for the fixed non-root runtime.
 * @param {{deploymentInstanceId: string, incarnationId: string, publicKey: string, publicKeyFingerprint: string}} value - Exact bootstrap authority.
 * @returns {{bytes: Buffer, digest: {algorithm: 'sha256', value: string}, contractVersion: 1, runtimeAccount: typeof SINGLE_NODE_RUNTIME_ACCOUNT, bootstrapIdentity: Readonly<Record<string, any>>}} - Bootstrap bytes and public evidence.
 */
export function createSingleNodeCloudInit(value) {
  const input = cloneJsonObject(value, 'singleNodeCloudInit');
  assertAllKeys(input, INPUT_KEYS, 'singleNodeCloudInit');
  assertSingleNodeDeploymentInstanceId(
    input.deploymentInstanceId,
    'singleNodeCloudInit.deploymentInstanceId',
  );
  assertSingleNodeDeploymentIncarnationId(
    input.incarnationId,
    'singleNodeCloudInit.incarnationId',
  );
  const publicKey = validateSshEd25519PublicKey(
    input.publicKey,
    'singleNodeCloudInit.publicKey',
  );
  if (
    typeof input.publicKeyFingerprint !== 'string' ||
    !SSH_FINGERPRINT_PATTERN.test(input.publicKeyFingerprint) ||
    input.publicKeyFingerprint !== publicKey.fingerprint
  ) {
    throw new TypeError(
      'singleNodeCloudInit.publicKeyFingerprint must match the canonical public key.',
    );
  }

  const bootstrapIdentity = Object.freeze(
    sortCanonicalJsonValue({
      schemaVersion: 1,
      kind: 'singleNodeBootstrapIdentity',
      deploymentInstanceId: input.deploymentInstanceId,
      incarnationId: input.incarnationId,
      contract: {
        kind: 'single-node-systemd-user',
        version: SINGLE_NODE_CLOUD_INIT_CONTRACT_VERSION,
      },
      runtimeAccount: SINGLE_NODE_RUNTIME_ACCOUNT,
      sshPublicKeyFingerprint: publicKey.fingerprint,
    }),
  );
  const bootstrapIdentityJson = `${JSON.stringify(bootstrapIdentity)}\n`;
  assertManifestIsSecretFree(
    { bootstrapIdentity, publicKey: publicKey.publicKey },
    'singleNodeCloudInit',
  );
  const cloudConfig = sortCanonicalJsonValue({
    disable_root: true,
    package_update: false,
    package_upgrade: false,
    runcmd: [
      [
        '/usr/bin/install',
        '-d',
        '-m',
        '0700',
        '-o',
        SINGLE_NODE_RUNTIME_ACCOUNT.user,
        '-g',
        SINGLE_NODE_RUNTIME_ACCOUNT.user,
        SINGLE_NODE_DATA_ROOT,
      ],
      [
        '/usr/bin/install',
        '-d',
        '-m',
        '0700',
        '-o',
        SINGLE_NODE_RUNTIME_ACCOUNT.user,
        '-g',
        SINGLE_NODE_RUNTIME_ACCOUNT.user,
        SINGLE_NODE_DEPLOYMENT_ROOT,
      ],
      ['/usr/bin/loginctl', 'enable-linger', SINGLE_NODE_RUNTIME_ACCOUNT.user],
      [
        '/usr/bin/systemctl',
        'start',
        `user@${SINGLE_NODE_RUNTIME_ACCOUNT.uid}.service`,
      ],
      [
        '/usr/bin/install',
        '-m',
        '0644',
        '-o',
        'root',
        '-g',
        'root',
        '/dev/null',
        SINGLE_NODE_BOOTSTRAP_COMPLETE_PATH,
      ],
    ],
    ssh_pwauth: false,
    users: [
      {
        gecos: 'Wharfie runtime',
        homedir: SINGLE_NODE_RUNTIME_ACCOUNT.home,
        lock_passwd: true,
        name: SINGLE_NODE_RUNTIME_ACCOUNT.user,
        shell: SINGLE_NODE_RUNTIME_ACCOUNT.shell,
        ssh_authorized_keys: [publicKey.publicKey],
        uid: SINGLE_NODE_RUNTIME_ACCOUNT.uid,
      },
    ],
    write_files: [
      {
        content: bootstrapIdentityJson,
        owner: 'root:root',
        path: SINGLE_NODE_BOOTSTRAP_IDENTITY_PATH,
        permissions: '0644',
      },
    ],
  });
  const bytes = Buffer.from(
    `#cloud-config\n${JSON.stringify(cloudConfig, null, 2)}\n`,
    'utf8',
  );
  if (bytes.byteLength > SINGLE_NODE_CLOUD_INIT_MAX_BYTES) {
    throw new RangeError(
      `singleNodeCloudInit must not exceed ${SINGLE_NODE_CLOUD_INIT_MAX_BYTES} UTF-8 bytes.`,
    );
  }
  return {
    bytes,
    digest: { algorithm: 'sha256', value: sha256Base64Url(bytes) },
    contractVersion: SINGLE_NODE_CLOUD_INIT_CONTRACT_VERSION,
    runtimeAccount: SINGLE_NODE_RUNTIME_ACCOUNT,
    bootstrapIdentity,
  };
}

export default {
  SINGLE_NODE_BOOTSTRAP_COMPLETE_PATH,
  SINGLE_NODE_BOOTSTRAP_IDENTITY_PATH,
  SINGLE_NODE_CLOUD_INIT_CONTRACT_VERSION,
  SINGLE_NODE_CLOUD_INIT_MAX_BYTES,
  SINGLE_NODE_DATA_ROOT,
  SINGLE_NODE_DEPLOYMENT_ROOT,
  createSingleNodeCloudInit,
  validateSshEd25519PublicKey,
};
