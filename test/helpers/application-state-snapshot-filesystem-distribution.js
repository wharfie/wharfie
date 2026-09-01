import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import {
  ApplicationStateSnapshotNotFoundError,
  createApplicationStateSnapshotDistribution,
} from '../../src/core/runtime/application-state-snapshot-distribution.js';

/** @param {unknown} error @param {string} code */
function hasErrorCode(error, code) {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code
  );
}

/** @param {string} root */
async function synchronizeDirectory(root) {
  const directory = await fsp.open(root, 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

/** @param {string} root @param {string} snapshotId */
export function applicationStateSnapshotArtifactPath(root, snapshotId) {
  if (
    typeof root !== 'string' ||
    root.length === 0 ||
    typeof snapshotId !== 'string' ||
    snapshotId.length === 0 ||
    basename(snapshotId) !== snapshotId ||
    !/^[A-Za-z0-9_-]+$/u.test(snapshotId)
  ) {
    throw new TypeError('Snapshot filesystem artifact scope is invalid.');
  }
  return join(root, `${snapshotId}.snapshot`);
}

/** @param {string} target @param {Buffer} bytes */
async function publishFile(target, bytes) {
  const root = dirname(target);
  await fsp.mkdir(root, { recursive: true });
  const temporary = join(root, `.snapshot-${randomUUID()}.tmp`);
  try {
    const file = await fsp.open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }

    try {
      await fsp.link(temporary, target);
      await synchronizeDirectory(root);
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) {
        throw error;
      }
      const retained = await fsp.readFile(target);
      if (!retained.equals(bytes)) {
        throw new Error(
          'Filesystem snapshot distribution found different immutable bytes.',
        );
      }
    }
  } finally {
    await fsp.unlink(temporary).catch((error) => {
      if (!hasErrorCode(error, 'ENOENT')) {
        throw error;
      }
    });
    // Synchronizing this already-created test root is enough for a process-kill
    // proof. The helper deliberately makes no host-power-loss durability claim.
    await synchronizeDirectory(root);
  }
}

/**
 * Build a test-only immutable distribution whose bytes survive process death.
 * @param {{identity: unknown, root: string}} options
 */
export function createFilesystemApplicationStateSnapshotDistribution(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'Filesystem application-state snapshot distribution requires options.',
    );
  }
  const root = options.root;
  const identity = options.identity;
  if (typeof root !== 'string' || root.length === 0) {
    throw new TypeError(
      'Filesystem application-state snapshot distribution requires a root.',
    );
  }

  return createApplicationStateSnapshotDistribution({
    identity,
    async publishImmutable({ reference, bytes }) {
      await publishFile(
        applicationStateSnapshotArtifactPath(root, reference.snapshotId),
        bytes,
      );
    },
    async readBytes(reference) {
      try {
        return await fsp.readFile(
          applicationStateSnapshotArtifactPath(root, reference.snapshotId),
        );
      } catch (error) {
        if (hasErrorCode(error, 'ENOENT')) {
          throw new ApplicationStateSnapshotNotFoundError(reference.snapshotId);
        }
        throw error;
      }
    },
  });
}
