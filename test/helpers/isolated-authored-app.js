import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GENERATED_DIRECTORY_NAMES = new Set(['.wharfie', 'node_modules']);
const REPOSITORY_ROOT = path.resolve(
  fileURLToPath(new URL('../..', import.meta.url)),
);
const REPOSITORY_NODE_MODULES = path.join(REPOSITORY_ROOT, 'node_modules');

/**
 * Restore owner access after a killed process strands a sealed revision tree.
 * Symlinks are deliberately never followed because fixtures link back to the
 * repository and its dependency tree.
 * @param {string} absolutePath - Owned fixture path to make removable.
 */
function restoreOwnedTreeAccess(absolutePath) {
  const stat = lstatSync(absolutePath);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    chmodSync(absolutePath, 0o700);
    for (const name of readdirSync(absolutePath)) {
      restoreOwnedTreeAccess(path.join(absolutePath, name));
    }
    return;
  }
  if (stat.isFile()) chmodSync(absolutePath, 0o600);
}

/** @param {string} root - Owned fixture root to remove. */
function removeOwnedFixtureRoot(root) {
  const options = {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 20,
  };
  try {
    rmSync(root, options);
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? error.code
        : undefined;
    if (code !== 'EACCES' && code !== 'ENOTEMPTY' && code !== 'EPERM') {
      throw error;
    }
    restoreOwnedTreeAccess(root);
    rmSync(root, options);
  }
}

/**
 * Hash one fixture tree so a real source command cannot silently mutate the
 * authored checkout. `node_modules` is represented by its root entry without
 * traversing a potentially large dependency tree; `.wharfie` stays in the
 * fingerprint because revision preparation must never reach the source copy.
 * @param {string} root - Absolute authored fixture root.
 * @returns {string} - Stable tree fingerprint.
 */
function fingerprintTree(root) {
  const hash = createHash('sha256');

  /** @param {string} absolutePath @param {string} relativePath */
  function visit(absolutePath, relativePath) {
    const stat = lstatSync(absolutePath);
    const normalizedPath = relativePath.split(path.sep).join('/');
    if (stat.isSymbolicLink()) {
      hash.update(`link\0${normalizedPath}\0${readlinkSync(absolutePath)}\0`);
      return;
    }
    if (stat.isDirectory()) {
      hash.update(`directory\0${normalizedPath}\0${stat.mode}\0`);
      if (relativePath && path.basename(relativePath) === 'node_modules') {
        return;
      }
      for (const name of readdirSync(absolutePath).sort()) {
        visit(
          path.join(absolutePath, name),
          relativePath ? path.join(relativePath, name) : name,
        );
      }
      return;
    }
    if (stat.isFile()) {
      hash.update(`file\0${normalizedPath}\0${stat.mode}\0${stat.size}\0`);
      hash.update(readFileSync(absolutePath));
      hash.update('\0');
      return;
    }
    hash.update(`other\0${normalizedPath}\0${stat.mode}\0${stat.size}\0`);
  }

  visit(root, '');
  return hash.digest('hex');
}

/**
 * Copy one authored application into an owned temporary root. Generated
 * dependency and revision trees are deliberately never propagated.
 * @param {string} sourceDirectory - Tracked authored application directory.
 * @param {{prefix?: string}} [options] - Temporary-root naming options.
 * @returns {Readonly<{appDir: string, root: string, assertSourceUnchanged: () => void, cleanup: () => void}>} - Isolated app and owned cleanup.
 */
export function createIsolatedAuthoredAppFixture(
  sourceDirectory,
  options = {},
) {
  const sourceRoot = path.resolve(sourceDirectory);
  const stat = lstatSync(sourceRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new TypeError(
      'Authored application fixture source must be a directory.',
    );
  }
  const prefix = options.prefix || 'wharfie-authored-app-';
  if (
    typeof prefix !== 'string' ||
    prefix.length === 0 ||
    prefix === '.' ||
    prefix === '..' ||
    prefix.includes('\0') ||
    path.posix.basename(prefix) !== prefix ||
    path.win32.basename(prefix) !== prefix
  ) {
    throw new TypeError(
      'Authored application fixture prefix must be a nonempty path segment.',
    );
  }

  const sourceFingerprint = fingerprintTree(sourceRoot);
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  const appDir = path.join(root, 'app');
  let cleaned = false;

  try {
    writeFileSync(
      path.join(root, 'package.json'),
      '{"private":true,"type":"module"}\n',
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
    cpSync(sourceRoot, appDir, {
      recursive: true,
      filter(candidate) {
        const relativePath = path.relative(sourceRoot, candidate);
        return (
          relativePath === '' ||
          !relativePath
            .split(path.sep)
            .some((part) => GENERATED_DIRECTORY_NAMES.has(part))
        );
      },
    });
    const packageScope = path.join(appDir, 'node_modules', '@wharfie');
    mkdirSync(packageScope, { recursive: true });
    symlinkSync(
      REPOSITORY_ROOT,
      path.join(packageScope, 'wharfie'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    symlinkSync(
      REPOSITORY_NODE_MODULES,
      path.join(root, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  } catch (error) {
    removeOwnedFixtureRoot(root);
    throw error;
  }

  function assertSourceUnchanged() {
    if (fingerprintTree(sourceRoot) !== sourceFingerprint) {
      throw new Error(
        `Tracked authored application fixture was mutated: ${sourceRoot}`,
      );
    }
  }

  function cleanup() {
    if (cleaned) return;
    /** @type {unknown} */
    let assertionError;
    try {
      assertSourceUnchanged();
    } catch (error) {
      assertionError = error;
    }
    /** @type {unknown} */
    let cleanupError;
    try {
      removeOwnedFixtureRoot(root);
    } catch (error) {
      cleanupError = error;
    }
    if (!cleanupError) cleaned = true;
    if (assertionError && cleanupError) {
      throw new AggregateError(
        [assertionError, cleanupError],
        'Authored fixture containment assertion and cleanup both failed.',
      );
    }
    if (assertionError) throw assertionError;
    if (cleanupError) throw cleanupError;
  }

  return Object.freeze({ appDir, root, assertSourceUnchanged, cleanup });
}

/**
 * Clean every per-test fixture even when one containment assertion fails.
 * @param {Array<ReturnType<typeof createIsolatedAuthoredAppFixture>>} fixtures - Owned fixtures.
 */
export function cleanupIsolatedAuthoredAppFixtures(fixtures) {
  /** @type {unknown[]} */
  const errors = [];
  while (fixtures.length > 0) {
    try {
      fixtures.pop()?.cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Cleaning authored app fixtures failed.');
  }
}
