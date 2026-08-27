import assert from 'node:assert/strict';
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export const SYSTEMD_PROOF_PARENT = '/var/tmp';
export const SYSTEMD_PROOF_ROOT_LEAF = 'wharfie-systemd-proof';
export const SYSTEMD_PROOF_ROOT = path.join(
  SYSTEMD_PROOF_PARENT,
  SYSTEMD_PROOF_ROOT_LEAF,
);
export const SYSTEMD_PROOF_ROOT_MARKER = '.wharfie-systemd-proof-root.json';

const MARKER_SCHEMA_VERSION = 1;
const MARKER_KIND = 'wharfie.systemd-proof-root';
const ROOT_MODE = 0o700;
const MARKER_MODE = 0o600;
const MARKER_KEYS = Object.freeze([
  'canonicalRoot',
  'kind',
  'schemaVersion',
  'uid',
]);

/**
 * @typedef SystemdProofRootOptions
 * @property {string} [approvedParent] - Canonical parent directory.
 * @property {string} [proofRoot] - Exact proof-root leaf.
 */

/**
 * @typedef SystemdProofRootMarker
 * @property {number} schemaVersion - Marker schema version.
 * @property {string} kind - Marker discriminator.
 * @property {string} canonicalRoot - Exact canonical owned root.
 * @property {number} uid - Owning process UID.
 */

/**
 * Return the one production proof root, rejecting even an empty override.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [environment] - Environment to inspect.
 * @returns {string} - Fixed production proof root.
 */
export function resolveSystemdProofRoot(environment = process.env) {
  assert.equal(
    Object.hasOwn(environment, 'WHARFIE_SYSTEMD_PROOF_ROOT'),
    false,
    'WHARFIE_SYSTEMD_PROOF_ROOT overrides are forbidden',
  );
  return SYSTEMD_PROOF_ROOT;
}

/**
 * Return the current numeric UID.
 * @returns {number} - Current UID.
 */
function currentUid() {
  const uid = process.getuid?.();
  if (uid === undefined || !Number.isSafeInteger(uid) || uid < 0) {
    throw new Error(
      'systemd proof-root ownership requires a numeric current UID',
    );
  }
  return uid;
}

/**
 * Read lstat while distinguishing an absent path from every other failure.
 * @param {string} target - Path to inspect.
 * @returns {import('node:fs').Stats | null} - Stats or null when absent.
 */
function lstatIfPresent(target) {
  try {
    return lstatSync(target);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Validate the exact direct-leaf topology before inspecting ownership.
 * @param {SystemdProofRootOptions} [options] - Optional test-owned location.
 * @returns {{approvedParent: string, proofRoot: string, markerPath: string, uid: number, rootStats: import('node:fs').Stats | null}} - Validated location.
 */
function validateLocation(options = {}) {
  const approvedParent = options.approvedParent ?? SYSTEMD_PROOF_PARENT;
  const proofRoot = options.proofRoot ?? SYSTEMD_PROOF_ROOT;
  assert.equal(typeof approvedParent, 'string');
  assert.equal(typeof proofRoot, 'string');
  assert.ok(
    path.isAbsolute(approvedParent),
    'approved parent must be absolute',
  );
  assert.ok(path.isAbsolute(proofRoot), 'proof root must be absolute');
  assert.equal(
    path.resolve(approvedParent),
    approvedParent,
    'approved parent must be lexically canonical',
  );
  assert.equal(
    path.resolve(proofRoot),
    proofRoot,
    'proof root must be lexically canonical',
  );
  assert.equal(
    proofRoot,
    path.join(approvedParent, SYSTEMD_PROOF_ROOT_LEAF),
    'proof root must be the exact approved direct leaf',
  );

  const parentStats = lstatSync(approvedParent);
  assert.equal(
    parentStats.isSymbolicLink(),
    false,
    'approved parent must not be a symbolic link',
  );
  assert.ok(parentStats.isDirectory(), 'approved parent must be a directory');
  assert.equal(
    realpathSync(approvedParent),
    approvedParent,
    'approved parent must not contain symbolic-link components',
  );

  const rootStats = lstatIfPresent(proofRoot);
  if (rootStats) {
    assert.equal(
      rootStats.isSymbolicLink(),
      false,
      'proof root must not be a symbolic link',
    );
    assert.ok(rootStats.isDirectory(), 'proof root must be a directory');
    assert.equal(
      realpathSync(proofRoot),
      proofRoot,
      'proof root must not contain symbolic-link components',
    );
  }

  return {
    approvedParent,
    proofRoot,
    markerPath: path.join(proofRoot, SYSTEMD_PROOF_ROOT_MARKER),
    uid: currentUid(),
    rootStats,
  };
}

/**
 * Build the exact ownership marker for a validated root.
 * @param {{proofRoot: string, uid: number}} location - Validated location.
 * @returns {SystemdProofRootMarker} - Exact marker document.
 */
function expectedMarker(location) {
  return Object.freeze({
    schemaVersion: MARKER_SCHEMA_VERSION,
    kind: MARKER_KIND,
    canonicalRoot: location.proofRoot,
    uid: location.uid,
  });
}

/**
 * Read a marker without following a final symlink.
 * @param {string} markerPath - Marker path.
 * @returns {{document: unknown, stats: import('node:fs').Stats}} - Parsed marker and descriptor stats.
 */
function readMarker(markerPath) {
  let descriptor;
  try {
    descriptor = openSync(
      markerPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const stats = fstatSync(descriptor);
    assert.ok(stats.isFile(), 'proof-root marker must be a regular file');
    assert.equal(stats.nlink, 1, 'proof-root marker must have one hard link');
    assert.ok(
      stats.size > 0 && stats.size <= 4096,
      'proof-root marker has an invalid size',
    );
    return {
      document: JSON.parse(readFileSync(descriptor, 'utf8')),
      stats,
    };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/**
 * Assert that an existing root carries the exact marker created for this UID.
 * @param {SystemdProofRootOptions} [options] - Optional test-owned location.
 * @returns {Readonly<SystemdProofRootMarker>} - Validated marker.
 */
export function assertOwnedSystemdProofRoot(options = {}) {
  const location = validateLocation(options);
  assert.ok(location.rootStats, 'owned systemd proof root must exist');
  assert.equal(
    location.rootStats.uid,
    location.uid,
    'systemd proof root must be owned by the current UID',
  );
  assert.equal(
    location.rootStats.mode & 0o777,
    ROOT_MODE,
    'systemd proof root must use mode 0700',
  );

  const marker = readMarker(location.markerPath);
  assert.equal(
    marker.stats.uid,
    location.uid,
    'proof-root marker must be owned by the current UID',
  );
  assert.equal(
    marker.stats.mode & 0o777,
    MARKER_MODE,
    'proof-root marker must use mode 0600',
  );
  assert.ok(
    marker.document !== null &&
      typeof marker.document === 'object' &&
      !Array.isArray(marker.document),
    'proof-root marker must be a JSON object',
  );
  assert.deepEqual(
    Object.keys(marker.document).sort(),
    [...MARKER_KEYS].sort(),
    'proof-root marker must contain only the ownership schema',
  );
  assert.deepEqual(
    marker.document,
    expectedMarker(location),
    'proof-root marker does not attest this canonical root and UID',
  );
  return Object.freeze({ ...marker.document });
}

/**
 * Create a new root and its ownership marker without adopting existing state.
 * @param {SystemdProofRootOptions} [options] - Optional test-owned location.
 * @returns {Readonly<SystemdProofRootMarker>} - Created marker.
 */
export function initializeOwnedSystemdProofRoot(options = {}) {
  const location = validateLocation(options);
  if (location.rootStats) return assertOwnedSystemdProofRoot(options);

  mkdirSync(location.proofRoot, { mode: ROOT_MODE });
  chmodSync(location.proofRoot, ROOT_MODE);
  const marker = expectedMarker(location);
  let descriptor;
  try {
    descriptor = openSync(
      location.markerPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      MARKER_MODE,
    );
    fchmodSync(descriptor, MARKER_MODE);
    writeFileSync(descriptor, `${JSON.stringify(marker)}\n`, 'utf8');
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  return assertOwnedSystemdProofRoot(options);
}

/**
 * Reset only a root whose exact current-UID ownership marker was validated.
 * @param {SystemdProofRootOptions} [options] - Optional test-owned location.
 * @returns {Readonly<SystemdProofRootMarker>} - Fresh marker.
 */
export function resetOwnedSystemdProofRoot(options = {}) {
  const location = validateLocation(options);
  if (location.rootStats) {
    assertOwnedSystemdProofRoot(options);
    rmSync(location.proofRoot, { recursive: true, force: false });
  }
  return initializeOwnedSystemdProofRoot(options);
}
