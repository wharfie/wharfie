import assert from 'node:assert/strict';
import { chmodSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MAGNETIC_PROOF_PREFIX = 'wharfie-magnetic-first-run-';

/** @typedef {(root: string, options: import('node:fs').RmOptions) => void} ProofRootRemover */

/**
 * @param {unknown} error - Filesystem failure.
 * @returns {unknown} Error code.
 */
function errorCode(error) {
  return error && typeof error === 'object' && 'code' in error
    ? error.code
    : undefined;
}

/**
 * Restore only owner directory access in the quiescent, proof-owned tree.
 * Files and symlink targets retain their permissions.
 * @param {string} directory - Owned directory or descendant.
 * @returns {void}
 */
function restoreDirectoryAccess(directory) {
  try {
    const stats = lstatSync(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) return;
    chmodSync(directory, stats.mode | 0o700);
    for (const name of readdirSync(directory)) {
      restoreDirectoryAccess(path.join(directory, name));
    }
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
}

/**
 * Remove only a magnetic proof's temporary root after its children have exited.
 * @param {string} root - Root created by the proof with mkdtemp.
 * @param {ProofRootRemover} remove - Removal boundary.
 * @returns {void}
 */
function removeProofRoot(root, remove) {
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith(MAGNETIC_PROOF_PREFIX));
  const options = {
    recursive: true,
    force: true,
    maxRetries: 2,
    retryDelay: 20,
  };
  try {
    remove(resolved, options);
  } catch (error) {
    if (!['EACCES', 'EPERM', 'ENOTEMPTY'].includes(String(errorCode(error)))) {
      throw error;
    }
    restoreDirectoryAccess(resolved);
    remove(resolved, options);
  }
}

/**
 * Attempt both owned cleanups without replacing an existing proof failure.
 * @param {{root: string, cleanupPackage?: () => void, failure?: {error: unknown}}} input - Owned work and optional primary failure.
 * @param {{remove?: ProofRootRemover}} [dependencies] - Deterministic removal seam.
 * @returns {void}
 */
export function cleanupMagneticFirstRun(input, dependencies = {}) {
  const failures = [];
  try {
    input.cleanupPackage?.();
  } catch (error) {
    failures.push(error);
  }
  try {
    removeProofRoot(input.root, dependencies.remove ?? rmSync);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 0) return;
  if (input.failure) {
    throw new AggregateError(
      [input.failure.error, ...failures],
      'Magnetic first-run proof and temporary cleanup failed.',
      { cause: input.failure.error },
    );
  }
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(
    failures,
    'Magnetic first-run temporary cleanup failed.',
  );
}
