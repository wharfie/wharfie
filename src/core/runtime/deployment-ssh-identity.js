/* eslint-disable jsdoc/valid-types -- The current JSDoc parser does not understand object method signatures. */

import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { validateSshEd25519PublicKey } from './single-node-cloud-init.js';
import {
  assertSingleNodeDeploymentIncarnationId,
  assertSingleNodeDeploymentInstanceId,
} from './single-node-deployment-identity.js';

export const DEPLOYMENT_SSH_KEYGEN_PATH = '/usr/bin/ssh-keygen';

const IDENTITY_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const PUBLIC_FILE_MODE = 0o644;
const EXPECTED_FILES = Object.freeze([
  'id_ed25519',
  'id_ed25519.pub',
  'known_hosts',
]);
const PROCESS_ENVIRONMENT = Object.freeze({
  LANG: 'C',
  LC_ALL: 'C',
  PATH: '/usr/bin:/bin',
});

/**
 * @param {string} path - Directory path to durably publish.
 * @returns {Promise<void>}
 */
async function syncDirectory(path) {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Create or adopt one private ordinary directory without following a symlink.
 * @param {string} path - Exact directory path.
 * @returns {Promise<void>}
 */
async function ensurePrivateDirectory(path) {
  await mkdir(path, { recursive: true, mode: IDENTITY_DIRECTORY_MODE });
  const stats = await lstat(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(
      'deploymentSshIdentity path is not an exact private directory.',
    );
  }
  await chmod(path, IDENTITY_DIRECTORY_MODE);
}

/**
 * Require one ordinary file with exact access mode and a finite size.
 * @param {string} path - Exact expected file.
 * @param {number} mode - Exact permission bits.
 * @param {number} maximumBytes - Maximum file size.
 * @param {string} valuePath - Human-readable path.
 * @returns {Promise<import('node:fs').Stats>} - Exact lstat evidence.
 */
async function inspectFile(path, mode, maximumBytes, valuePath) {
  const stats = await lstat(path);
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    (stats.mode & 0o777) !== mode ||
    stats.size > maximumBytes
  ) {
    throw new Error(`${valuePath} is not an exact private identity file.`);
  }
  return stats;
}

/**
 * Normalize ssh-keygen output to the two public fields Wharfie accepts.
 * @param {Buffer|string} value - Public-key output.
 * @param {string} valuePath - Human-readable value path.
 * @returns {{publicKey: string, fingerprint: string}} - Canonical public evidence.
 */
function normalizeGeneratedPublicKey(value, valuePath) {
  const fields = String(value).trim().split(/\s+/);
  if (fields.length < 2) {
    throw new Error(`${valuePath} did not contain an Ed25519 public key.`);
  }
  return validateSshEd25519PublicKey(`${fields[0]} ${fields[1]}`, valuePath);
}

/**
 * Validate an atomically published identity and prove its private/public pair.
 * @param {{directory: string, privateKeyPath: string, publicKeyPath: string, knownHostsPath: string, runProcess: {run(options: unknown): Promise<import('./bounded-process.js').BoundedProcessOutcome>}}} value - Identity paths and process authority.
 * @returns {Promise<{privateKeyPath: string, publicKey: string, publicKeyFingerprint: string, knownHostsPath: string}>} - Private paths and public evidence.
 */
async function inspectIdentity(value) {
  const directoryStats = await lstat(value.directory);
  if (
    !directoryStats.isDirectory() ||
    directoryStats.isSymbolicLink() ||
    (directoryStats.mode & 0o777) !== IDENTITY_DIRECTORY_MODE
  ) {
    throw new Error(
      'deploymentSshIdentity directory is not an exact private directory.',
    );
  }
  const entries = (await readdir(value.directory)).sort();
  if (
    entries.length !== EXPECTED_FILES.length ||
    entries.some((entry, index) => entry !== [...EXPECTED_FILES].sort()[index])
  ) {
    throw new Error(
      'deploymentSshIdentity directory contains unexpected entries.',
    );
  }
  await inspectFile(
    value.privateKeyPath,
    PRIVATE_FILE_MODE,
    16 * 1024,
    'deploymentSshIdentity.privateKey',
  );
  await inspectFile(
    value.publicKeyPath,
    PUBLIC_FILE_MODE,
    2 * 1024,
    'deploymentSshIdentity.publicKey',
  );
  await inspectFile(
    value.knownHostsPath,
    PRIVATE_FILE_MODE,
    64 * 1024,
    'deploymentSshIdentity.knownHosts',
  );

  const publicKey = normalizeGeneratedPublicKey(
    await readFile(value.publicKeyPath),
    'deploymentSshIdentity.publicKey',
  );
  const derived = await value.runProcess.run({
    file: DEPLOYMENT_SSH_KEYGEN_PATH,
    args: ['-y', '-f', value.privateKeyPath],
    stdin: null,
    environment: PROCESS_ENVIRONMENT,
    timeoutMilliseconds: 10_000,
    maximumStdoutBytes: 2 * 1024,
    maximumStderrBytes: 2 * 1024,
  });
  if (derived.status !== 'exited' || derived.exitCode !== 0) {
    throw new Error(
      'deploymentSshIdentity private/public key verification failed.',
    );
  }
  const derivedPublicKey = normalizeGeneratedPublicKey(
    derived.stdout,
    'deploymentSshIdentity.derivedPublicKey',
  );
  if (
    derivedPublicKey.publicKey !== publicKey.publicKey ||
    derivedPublicKey.fingerprint !== publicKey.fingerprint
  ) {
    throw new Error(
      'deploymentSshIdentity private and public keys do not match.',
    );
  }

  return Object.freeze({
    privateKeyPath: value.privateKeyPath,
    publicKey: publicKey.publicKey,
    publicKeyFingerprint: publicKey.fingerprint,
    knownHostsPath: value.knownHostsPath,
  });
}

/**
 * Create a private deployment SSH identity store.
 * @param {{root: string, runProcess: {run(options: unknown): Promise<import('./bounded-process.js').BoundedProcessOutcome>}}} options - Local private root and shell-free process authority.
 * @returns {{ensureIdentity(value: unknown): Promise<Readonly<Record<string, string>>>, removeIdentity(value: unknown): Promise<void>}} - Identity lifecycle.
 */
export function createDeploymentSshIdentityStore(options) {
  if (
    typeof options?.root !== 'string' ||
    !isAbsolute(options.root) ||
    options.root.includes('\0')
  ) {
    throw new TypeError(
      'deploymentSshIdentity.root must be an absolute local path.',
    );
  }
  if (
    options?.runProcess === null ||
    typeof options?.runProcess !== 'object' ||
    typeof options.runProcess.run !== 'function'
  ) {
    throw new TypeError('deploymentSshIdentity.runProcess must provide run().');
  }
  const root = options.root;
  const runProcess = options.runProcess;

  /**
   * @param {unknown} value - Candidate identity selection.
   * @returns {{deploymentInstanceId: string, incarnationId: string}} - Exact identities.
   */
  function validateSelection(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('deploymentSshIdentity selection must be an object.');
    }
    const selection = /** @type {Record<string, any>} */ (value);
    const keys = new Set(['deploymentInstanceId', 'incarnationId']);
    for (const key of Object.keys(selection)) {
      if (!keys.has(key)) {
        throw new TypeError(`deploymentSshIdentity.${key} is not supported.`);
      }
    }
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(selection, key)) {
        throw new TypeError(`deploymentSshIdentity.${key} is required.`);
      }
    }
    assertSingleNodeDeploymentInstanceId(
      selection.deploymentInstanceId,
      'deploymentSshIdentity.deploymentInstanceId',
    );
    assertSingleNodeDeploymentIncarnationId(
      selection.incarnationId,
      'deploymentSshIdentity.incarnationId',
    );
    return {
      deploymentInstanceId: selection.deploymentInstanceId,
      incarnationId: selection.incarnationId,
    };
  }

  /**
   * @param {{deploymentInstanceId: string, incarnationId: string}} selection - Exact selection.
   * @returns {{instanceDirectory: string, directory: string, privateKeyPath: string, publicKeyPath: string, knownHostsPath: string}} - Exact contained paths.
   */
  function getPaths(selection) {
    const instanceDirectory = join(root, selection.deploymentInstanceId);
    const directory = join(instanceDirectory, selection.incarnationId);
    return {
      instanceDirectory,
      directory,
      privateKeyPath: join(directory, 'id_ed25519'),
      publicKeyPath: join(directory, 'id_ed25519.pub'),
      knownHostsPath: join(directory, 'known_hosts'),
    };
  }

  return Object.freeze({
    /**
     * Generate once or adopt and reverify one existing identity.
     * @param {unknown} value - Deployment and incarnation identities.
     * @returns {Promise<Readonly<Record<string, string>>>} - Private paths and public evidence.
     */
    async ensureIdentity(value) {
      const selection = validateSelection(value);
      const paths = getPaths(selection);
      await ensurePrivateDirectory(root);
      await ensurePrivateDirectory(paths.instanceDirectory);

      try {
        return await inspectIdentity({ ...paths, runProcess });
      } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') {
          throw error;
        }
      }

      const temporaryDirectory = await mkdtemp(
        join(paths.instanceDirectory, '.identity-'),
      );
      await chmod(temporaryDirectory, IDENTITY_DIRECTORY_MODE);
      const temporaryPaths = {
        directory: temporaryDirectory,
        privateKeyPath: join(temporaryDirectory, 'id_ed25519'),
        publicKeyPath: join(temporaryDirectory, 'id_ed25519.pub'),
        knownHostsPath: join(temporaryDirectory, 'known_hosts'),
      };
      try {
        const generated = await runProcess.run({
          file: DEPLOYMENT_SSH_KEYGEN_PATH,
          args: [
            '-q',
            '-t',
            'ed25519',
            '-N',
            '',
            '-C',
            '',
            '-f',
            temporaryPaths.privateKeyPath,
          ],
          stdin: null,
          environment: PROCESS_ENVIRONMENT,
          timeoutMilliseconds: 10_000,
          maximumStdoutBytes: 2 * 1024,
          maximumStderrBytes: 2 * 1024,
        });
        if (generated.status !== 'exited' || generated.exitCode !== 0) {
          throw new Error('deploymentSshIdentity key generation failed.');
        }
        await chmod(temporaryPaths.privateKeyPath, PRIVATE_FILE_MODE);
        const generatedPublicKey = normalizeGeneratedPublicKey(
          await readFile(temporaryPaths.publicKeyPath),
          'deploymentSshIdentity.generatedPublicKey',
        );
        await writeFile(
          temporaryPaths.publicKeyPath,
          `${generatedPublicKey.publicKey}\n`,
          { mode: PUBLIC_FILE_MODE },
        );
        await chmod(temporaryPaths.publicKeyPath, PUBLIC_FILE_MODE);
        await writeFile(temporaryPaths.knownHostsPath, '', {
          flag: 'wx',
          mode: PRIVATE_FILE_MODE,
        });
        await syncDirectory(temporaryDirectory);

        try {
          await rename(temporaryDirectory, paths.directory);
          await syncDirectory(paths.instanceDirectory);
        } catch (error) {
          if (
            /** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST' &&
            /** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOTEMPTY'
          ) {
            throw error;
          }
        }
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
      return await inspectIdentity({ ...paths, runProcess });
    },

    /**
     * Remove one exact bounded identity after provider absence is proven.
     * @param {unknown} value - Deployment and incarnation identities.
     * @returns {Promise<void>}
     */
    async removeIdentity(value) {
      const selection = validateSelection(value);
      const paths = getPaths(selection);
      try {
        await inspectIdentity({ ...paths, runProcess });
      } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
          return;
        }
        throw error;
      }
      await rm(paths.directory, { recursive: true, force: false });
      await syncDirectory(paths.instanceDirectory);
    },
  });
}

export default {
  DEPLOYMENT_SSH_KEYGEN_PATH,
  createDeploymentSshIdentityStore,
};
