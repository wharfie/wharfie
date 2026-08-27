import { createHash } from 'node:crypto';
import { createReadStream, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extract as extractTar } from 'tar';

import { AWS_PROVIDER_EMBEDDING_POLICY } from '../../core/lib/esbuild.js';

import { packageFrameworkOwnedApp } from './local-app.js';

const WHARFIE_PACKAGE_NAME = '@wharfie/wharfie';
const WHARFIE_LOCK_PATH = 'node_modules/@wharfie/wharfie';

/**
 * @typedef InstalledWharfieReleaseIdentity
 * @property {string} version - Exact version produced by npm pack.
 * @property {string} integrity - Exact sha512 integrity produced by npm pack.
 * @property {string} tarballPath - Exact candidate tarball supplied by the release builder.
 */

/**
 * @param {unknown} value - Candidate npm integrity.
 * @param {string} label - Diagnostic label.
 * @returns {string} - Canonical sha512 integrity.
 */
function assertSha512Integrity(value, label) {
  if (
    typeof value !== 'string' ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(value)
  ) {
    throw new TypeError(`${label} must be a canonical sha512 integrity.`);
  }
  const encoded = value.slice('sha512-'.length);
  const digest = Buffer.from(encoded, 'base64');
  if (digest.length !== 64 || digest.toString('base64') !== encoded) {
    throw new TypeError(`${label} must be a canonical sha512 integrity.`);
  }
  return value;
}

/**
 * @param {unknown} value - Candidate release identity.
 * @returns {InstalledWharfieReleaseIdentity} - Validated identity.
 */
function assertExpectedReleaseIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      'Wharfie self-host packaging requires the expected packed release identity.',
    );
  }
  const identity = /** @type {Record<string, unknown>} */ (value);
  if (typeof identity.version !== 'string' || identity.version.length === 0) {
    throw new TypeError(
      'Wharfie self-host packaging requires the expected packed version.',
    );
  }
  if (
    typeof identity.tarballPath !== 'string' ||
    identity.tarballPath.length === 0
  ) {
    throw new TypeError(
      'Wharfie self-host packaging requires the expected packed tarball path.',
    );
  }
  return Object.freeze({
    version: identity.version,
    integrity: assertSha512Integrity(
      identity.integrity,
      'Expected packed release integrity',
    ),
    tarballPath: path.resolve(identity.tarballPath),
  });
}

/**
 * @param {string} filePath - File to hash.
 * @returns {Promise<string>} - Canonical SHA-512 SRI.
 */
async function sha512Integrity(filePath) {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return `sha512-${hash.digest('base64')}`;
}

/**
 * @param {string} root - Owned tree root.
 * @returns {Promise<Map<string, Buffer>>} - Exact regular-file tree.
 */
async function readRegularFileTree(root) {
  /** @type {Map<string, Buffer>} */
  const files = new Map();
  /**
   * @param {string} directory - Directory to visit.
   * @param {string} relativeDirectory - Package-relative directory.
   */
  async function visit(directory, relativeDirectory) {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? path.join(relativeDirectory, entry.name)
        : entry.name;
      const filePath = path.join(directory, entry.name);
      const stats = await fsp.lstat(filePath);
      if (stats.isSymbolicLink()) {
        throw new TypeError(
          `Wharfie self-host packaging rejects symlinks in package bytes: ${relativePath}`,
        );
      }
      if (stats.isDirectory()) {
        await visit(filePath, relativePath);
        continue;
      }
      if (!stats.isFile()) {
        throw new TypeError(
          `Wharfie self-host packaging requires regular package files: ${relativePath}`,
        );
      }
      files.set(relativePath, await fsp.readFile(filePath));
    }
  }
  await visit(root, '');
  return files;
}

/**
 * Bind the installed tree to independently extracted candidate bytes.
 * @param {string} installedRoot - Validated installed package root.
 * @param {InstalledWharfieReleaseIdentity} expected - Candidate identity.
 * @returns {Promise<void>}
 */
async function assertInstalledBytesMatchCandidate(installedRoot, expected) {
  await assertNonSymlinkEntry(
    expected.tarballPath,
    'file',
    'Expected packed Wharfie tarball',
  );
  if ((await sha512Integrity(expected.tarballPath)) !== expected.integrity) {
    throw new TypeError(
      'Expected packed Wharfie tarball bytes do not match their integrity.',
    );
  }

  const extractionRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'wharfie-self-package-candidate-'),
  );
  try {
    await extractTar({
      cwd: extractionRoot,
      file: expected.tarballPath,
      preservePaths: false,
      strict: true,
    });
    const candidateRoot = path.join(extractionRoot, 'package');
    await assertNonSymlinkEntry(
      candidateRoot,
      'directory',
      'Extracted packed Wharfie package root',
    );
    const [candidateFiles, installedFiles] = await Promise.all([
      readRegularFileTree(candidateRoot),
      readRegularFileTree(installedRoot),
    ]);
    if (candidateFiles.size !== installedFiles.size) {
      throw new TypeError(
        'Installed Wharfie package tree does not match the packed candidate.',
      );
    }
    for (const [relativePath, candidateBytes] of candidateFiles) {
      const installedBytes = installedFiles.get(relativePath);
      if (!installedBytes || !candidateBytes.equals(installedBytes)) {
        throw new TypeError(
          `Installed Wharfie package bytes do not match the packed candidate: ${relativePath}`,
        );
      }
    }
  } finally {
    await fsp.rm(extractionRoot, { recursive: true, force: true });
  }
}

/**
 * @param {string} filePath - Exact path whose final entry must be regular.
 * @param {'directory'|'file'} kind - Required entry kind.
 * @param {string} label - Diagnostic label.
 * @returns {Promise<void>}
 */
async function assertNonSymlinkEntry(filePath, kind, label) {
  const stats = await fsp.lstat(filePath);
  const correctKind =
    kind === 'directory' ? stats.isDirectory() : stats.isFile();
  if (stats.isSymbolicLink() || !correctKind) {
    throw new TypeError(`${label} must be a non-symlink ${kind}.`);
  }
}

/**
 * Resolve and validate the clean consumer lock that installed this package.
 * Only a tarball/registry installation at node_modules/@wharfie/wharfie may
 * cross the framework-owned module-graph boundary.
 * @param {string} packageRoot - Installed Wharfie package root.
 * @param {string} dependencyLockPath - Consumer package lock.
 * @param {InstalledWharfieReleaseIdentity} expectedRelease - Exact npm-pack identity supplied by the release builder.
 * @returns {Promise<{root: string, lockPath: string, version: string, integrity: string, tarballPath: string}>} - Validated release inputs.
 */
export async function validateInstalledWharfieSelfHost(
  packageRoot,
  dependencyLockPath,
  expectedRelease,
) {
  const expected = assertExpectedReleaseIdentity(expectedRelease);
  const root = path.resolve(packageRoot);
  const scopeDirectory = path.dirname(root);
  const nodeModulesDirectory = path.dirname(scopeDirectory);
  const installRoot = path.dirname(nodeModulesDirectory);
  if (
    path.basename(root) !== 'wharfie' ||
    path.basename(scopeDirectory) !== '@wharfie' ||
    path.basename(nodeModulesDirectory) !== 'node_modules'
  ) {
    throw new TypeError(
      'Wharfie self-host packaging requires a clean node_modules/@wharfie/wharfie installation.',
    );
  }

  const lockPath = path.resolve(dependencyLockPath);
  if (lockPath !== path.join(installRoot, 'package-lock.json')) {
    throw new TypeError(
      'Wharfie self-host packaging requires the installing consumer package-lock.json.',
    );
  }

  await Promise.all([
    assertNonSymlinkEntry(root, 'directory', 'Installed Wharfie package root'),
    assertNonSymlinkEntry(lockPath, 'file', 'Consumer package lock'),
  ]);
  const canonicalInstallRoot = await fsp.realpath(installRoot);
  const [canonicalRoot, canonicalLockPath] = await Promise.all([
    fsp.realpath(root),
    fsp.realpath(lockPath),
  ]);
  if (
    canonicalRoot !==
    path.join(canonicalInstallRoot, 'node_modules', '@wharfie', 'wharfie')
  ) {
    throw new TypeError(
      'Wharfie self-host packaging rejects symlinked installed-package paths.',
    );
  }
  if (
    canonicalLockPath !== path.join(canonicalInstallRoot, 'package-lock.json')
  ) {
    throw new TypeError(
      'Wharfie self-host packaging rejects a symlinked consumer package lock.',
    );
  }

  const metadataPath = path.join(root, 'package.json');
  await assertNonSymlinkEntry(
    metadataPath,
    'file',
    'Installed Wharfie package metadata',
  );
  const [metadata, lock] = await Promise.all(
    [metadataPath, lockPath].map(async (filePath) =>
      JSON.parse(await fsp.readFile(filePath, 'utf8')),
    ),
  );
  if (
    metadata.name !== WHARFIE_PACKAGE_NAME ||
    metadata.main !== './src/cli/entry.js' ||
    metadata.version !== expected.version
  ) {
    throw new TypeError(
      'Wharfie self-host packaging requires the canonical installed package.',
    );
  }
  if (lock.lockfileVersion !== 3) {
    throw new TypeError(
      'Wharfie self-host packaging requires a lockfileVersion 3 consumer lock.',
    );
  }
  const installed = lock.packages?.[WHARFIE_LOCK_PATH];
  if (
    !installed ||
    installed.version !== expected.version ||
    installed.integrity !== expected.integrity
  ) {
    throw new TypeError(
      'The consumer lock must bind this exact installed Wharfie version and tarball integrity.',
    );
  }

  await assertInstalledBytesMatchCandidate(root, expected);

  return {
    root,
    lockPath,
    version: expected.version,
    integrity: expected.integrity,
    tarballPath: expected.tarballPath,
  };
}

/**
 * Build the installed Wharfie package as a SEA through the normal artifact
 * transaction while treating its exact locked runtime graph as framework-owned.
 * @param {import('./local-app.js').PackageLocalAppOptions & {dependencyLockPath: string, expectedRelease: InstalledWharfieReleaseIdentity}} options - Installed-package build request.
 * @param {{packageApplication?: typeof packageFrameworkOwnedApp}} [dependencies] - Test seam.
 * @returns {Promise<import('./local-app.js').PackageLocalAppResult>} - Result.
 */
export async function packageInstalledWharfieCli(options, dependencies = {}) {
  if (Object.hasOwn(options, 'awsProviderEmbeddingPolicy')) {
    throw new TypeError(
      'Wharfie self-host packaging owns the AWS provider embedding policy.',
    );
  }
  const { dependencyLockPath, expectedRelease, ...packageOptions } = options;
  const validated = await validateInstalledWharfieSelfHost(
    options.dir,
    dependencyLockPath,
    expectedRelease,
  );
  const packageApplication =
    dependencies.packageApplication || packageFrameworkOwnedApp;
  return await packageApplication(
    {
      ...packageOptions,
      dir: validated.root,
      awsProviderEmbeddingPolicy: AWS_PROVIDER_EMBEDDING_POLICY.PROVIDER_FREE,
    },
    {
      dependencyLockPath: validated.lockPath,
      runtimeRoot: validated.root,
      trustInstalledRuntimeGraph: true,
    },
  );
}
