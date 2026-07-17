import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pipeline } from 'node:stream/promises';

import FunctionResource from '../../core/resources/builds/function-resource.js';
import MacOSBinarySignature from '../../core/resources/builds/macos-binary-signature.js';
import NodeBinary from '../../core/resources/builds/node-binary.js';
import {
  validateApplicationRevision,
  validateSha256Digest,
} from '../../core/runtime/application-revision.js';
import { validateArtifactProvenance } from '../../core/runtime/artifact-record.js';
import {
  getBuildTargetId,
  validateBuildTarget,
} from '../../core/runtime/build-target.js';
import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from '../../core/runtime/canonical-order.js';
import { cloneJsonValue } from '../../core/runtime/json-value.js';

export const ARTIFACT_TOOLCHAIN_DIGEST_DOMAIN = 'wharfie:artifact-toolchain:v1';
export const ARTIFACT_DEPENDENCY_CLOSURE_DIGEST_DOMAIN =
  'wharfie:artifact-dependency-closure:v1';
export const ARTIFACT_PROVENANCE_BUILDER_NAME = '@wharfie/wharfie';

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;
const require = createRequire(import.meta.url);
const TOOLCHAIN_PACKAGE_NAMES = Object.freeze([
  '@npmcli/arborist',
  'esbuild',
  'pacote',
  'postject',
  'tar',
]);

/**
 * @typedef FileDigest
 * @property {string} hex - Lowercase hexadecimal SHA-256.
 * @property {string} base64url - Unpadded base64url SHA-256.
 * @property {number} size - Exact file size.
 */

/**
 * @typedef DependencyClosureActivity
 * @property {string} activity - Canonical activity name.
 * @property {{name: string, version: string}[]} externals - Exact direct external declarations.
 * @property {import('../../core/runtime/application-revision.js').Sha256Digest} archiveDigest - Exact embedded target archive digest.
 */

/**
 * Hash one canonical JSON value in a named domain.
 * @param {string} domain - Digest domain.
 * @param {unknown} value - Canonical JSON input.
 * @param {string} valuePath - Input boundary label.
 * @returns {import('../../core/runtime/application-revision.js').Sha256Digest} - Domain-separated digest.
 */
function createCanonicalDigest(domain, value, valuePath) {
  const canonicalJson = JSON.stringify(
    sortCanonicalJsonValue(cloneJsonValue(value, valuePath)),
  );
  return {
    algorithm: 'sha256',
    value: createHash('sha256')
      .update(domain, 'utf8')
      .update('\0', 'utf8')
      .update(canonicalJson, 'utf8')
      .digest('base64url'),
  };
}

/**
 * Read the installed version of one tool actually used by the package builder.
 * @param {string} packageName - Installed package name.
 * @param {unknown} value - Installed package manifest.
 * @returns {string} - Exact installed package version.
 */
function getInstalledPackageVersion(packageName, value) {
  const packageManifest = /** @type {{version?: unknown}} */ (value);
  if (
    typeof packageManifest.version !== 'string' ||
    !packageManifest.version.trim()
  ) {
    throw new Error(
      `Cannot identify installed artifact toolchain component '${packageName}'.`,
    );
  }
  return packageManifest.version;
}

/**
 * Describe and digest the concrete package-time toolchain.
 * @param {string} builderVersion - Exact Wharfie builder version.
 * @returns {import('../../core/runtime/application-revision.js').Sha256Digest} - Canonical toolchain digest.
 */
export function createArtifactToolchainDigest(builderVersion) {
  const components = [
    { name: 'node', version: process.versions.node },
    { name: 'zlib', version: process.versions.zlib },
    ...TOOLCHAIN_PACKAGE_NAMES.map((packageName) => ({
      name: packageName,
      version: getInstalledPackageVersion(
        packageName,
        require(`${packageName}/package.json`),
      ),
    })),
  ].sort((left, right) => compareCanonicalStrings(left.name, right.name));

  return createCanonicalDigest(
    ARTIFACT_TOOLCHAIN_DIGEST_DOMAIN,
    {
      schemaVersion: 1,
      builder: {
        name: ARTIFACT_PROVENANCE_BUILDER_NAME,
        version: builderVersion,
      },
      artifactFormat: { kind: 'node-sea', version: 1 },
      components,
    },
    'artifact toolchain',
  );
}

/**
 * Resolve the strict target represented by a SEA build resource.
 * @param {any} build - SEA build resource.
 * @returns {import('../../core/runtime/build-target.js').BuildTarget} - Canonical target.
 */
export function getArtifactBuildTarget(build) {
  if (!build || typeof build.get !== 'function') {
    throw new TypeError('build must be a SEA build resource.');
  }

  const platform = build.get('platform');
  const libc = build.get('libc');
  return validateBuildTarget(
    {
      nodeVersion: String(build.get('nodeVersion')).replace(/^v/, ''),
      platform,
      architecture: build.get('architecture'),
      ...(platform === 'linux' || libc !== undefined ? { libc } : {}),
    },
    'build target',
  );
}

/**
 * Hash one exact file without buffering a Node executable into memory.
 * @param {string} filePath - Exact file path.
 * @param {string} valuePath - Human-readable path label.
 * @returns {Promise<FileDigest>} - Exact file digest and size.
 */
async function digestFile(filePath, valuePath) {
  if (typeof filePath !== 'string' || !filePath) {
    throw new TypeError(`${valuePath} must be a nonempty file path.`);
  }
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new TypeError(`${valuePath} must identify a regular file.`);
  }

  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  const digestBytes = hash.digest();
  return {
    hex: digestBytes.toString('hex'),
    base64url: digestBytes.toString('base64url'),
    size: fileStat.size,
  };
}

/**
 * Convert a validated hexadecimal digest into the durable digest shape.
 * @param {unknown} value - Candidate hexadecimal SHA-256.
 * @param {string} valuePath - Human-readable path.
 * @returns {import('../../core/runtime/application-revision.js').Sha256Digest} - Durable digest.
 */
function digestFromHex(value, valuePath) {
  if (typeof value !== 'string' || !SHA256_HEX_PATTERN.test(value)) {
    throw new TypeError(`${valuePath} must be a hexadecimal SHA-256 digest.`);
  }
  return {
    algorithm: 'sha256',
    value: Buffer.from(value, 'hex').toString('base64url'),
  };
}

/**
 * Return the official archive name for a canonical Node target.
 * @param {import('../../core/runtime/build-target.js').BuildTarget} target - Canonical target.
 * @returns {string} - Official Node distribution filename.
 */
function getOfficialNodeArchiveName(target) {
  const { normPlatform, normArch, ext } = NodeBinary.resolveTargetSpec(
    target.platform,
    target.architecture,
  );
  return `node-v${target.nodeVersion}-${normPlatform}-${normArch}${ext}`;
}

/**
 * Read a receipt if it exists; malformed or unreadable present receipts fail.
 * @param {string} receiptPath - Receipt path.
 * @returns {Promise<Record<string, any> | null>} - Parsed receipt or null.
 */
async function readOptionalIntegrityReceipt(receiptPath) {
  let contents;
  try {
    contents = await readFile(receiptPath, 'utf8');
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return null;
    }
    throw error;
  }

  try {
    const receipt = JSON.parse(contents);
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
      throw new TypeError('receipt root must be an object');
    }
    return receipt;
  } catch {
    throw new Error(`Invalid Node binary integrity receipt ${receiptPath}.`);
  }
}

/**
 * Build exact Node binary provenance and cross-check any official receipt.
 * @param {any} build - SEA build resource.
 * @param {import('../../core/runtime/build-target.js').BuildTarget} target - Canonical target.
 * @returns {Promise<import('../../core/runtime/artifact-record.js').ArtifactProvenance['node']>} - Node provenance.
 */
async function createNodeProvenance(build, target) {
  const nodeBinaryPath = build.get('nodeBinaryPath');
  const actualBinary = await digestFile(nodeBinaryPath, 'build.nodeBinaryPath');
  const nodeDependencies = Array.isArray(build.dependsOn)
    ? build.dependsOn.filter(
        (/** @type {any} */ dependency) => dependency instanceof NodeBinary,
      )
    : [];
  if (nodeDependencies.length > 1) {
    throw new Error('SEA build has more than one NodeBinary dependency.');
  }

  const binary = {
    digest: {
      algorithm: /** @type {'sha256'} */ ('sha256'),
      value: actualBinary.base64url,
    },
  };
  if (nodeDependencies.length === 0) {
    return { version: target.nodeVersion, binary };
  }

  const receiptPath =
    await nodeDependencies[0].getIntegrityReceiptPath(nodeBinaryPath);
  const receipt = await readOptionalIntegrityReceipt(receiptPath);
  if (!receipt) {
    return { version: target.nodeVersion, binary };
  }

  const receiptNodeVersion = String(receipt.target?.nodeVersion || '').replace(
    /^v/,
    '',
  );
  const receiptBinarySha256 = String(
    receipt.binary?.sha256 || '',
  ).toLowerCase();
  const receiptArchiveSha256 = String(receipt.archive?.sha256 || '');
  if (
    receipt.version !== 1 ||
    receiptNodeVersion !== target.nodeVersion ||
    receipt.target?.platform !== target.platform ||
    receipt.target?.architecture !== target.architecture ||
    receipt.archive?.fileName !== getOfficialNodeArchiveName(target) ||
    !SHA256_HEX_PATTERN.test(receiptBinarySha256) ||
    receiptBinarySha256 !== actualBinary.hex ||
    receipt.binary?.size !== actualBinary.size
  ) {
    throw new Error(
      'Node binary integrity receipt does not match the exact target binary.',
    );
  }

  return {
    version: target.nodeVersion,
    archive: {
      fileName: receipt.archive.fileName,
      digest: digestFromHex(
        receiptArchiveSha256,
        'Node integrity receipt archive.sha256',
      ),
    },
    binary,
  };
}

/**
 * Resolve and canonicalize declared external dependencies for one activity.
 * @param {FunctionResource} resource - Function build resource.
 * @returns {{name: string, version: string}[]} - Sorted exact declarations.
 */
function getDeclaredExternals(resource) {
  const declared = resource.get('external', []);
  if (!Array.isArray(declared)) {
    throw new TypeError(
      `Activity '${resource.get('functionName')}' external dependencies must be an array.`,
    );
  }

  const externals = declared.map((external, index) => {
    if (
      !external ||
      typeof external !== 'object' ||
      typeof external.name !== 'string' ||
      !external.name ||
      external.name.trim() !== external.name ||
      typeof external.version !== 'string' ||
      !external.version ||
      external.version.trim() !== external.version
    ) {
      throw new TypeError(
        `Activity '${resource.get('functionName')}' external[${index}] must have canonical name and version strings.`,
      );
    }
    return { name: external.name, version: external.version };
  });
  externals.sort((left, right) =>
    compareCanonicalStrings(
      `${left.name}\0${left.version}`,
      `${right.name}\0${right.version}`,
    ),
  );

  for (let index = 1; index < externals.length; index += 1) {
    if (externals[index - 1].name === externals[index].name) {
      throw new Error(
        `Activity '${resource.get('functionName')}' declares external '${externals[index].name}' more than once.`,
      );
    }
  }
  return externals;
}

/**
 * Digest the exact target external archives embedded by this SEA build.
 * @param {any} build - SEA build resource.
 * @param {import('../../core/runtime/build-target.js').BuildTarget} target - Canonical target.
 * @returns {import('../../core/runtime/application-revision.js').Sha256Digest} - Canonical dependency closure digest.
 */
export function createArtifactDependencyClosureDigest(build, target) {
  const functionResources = /** @type {FunctionResource[]} */ (
    Array.isArray(build.dependsOn)
      ? build.dependsOn.filter(
          (/** @type {any} */ dependency) =>
            dependency instanceof FunctionResource,
        )
      : []
  );
  const activities = functionResources.reduce(
    (
      /** @type {DependencyClosureActivity[]} */ entries,
      /** @type {FunctionResource} */ resource,
    ) => {
      const externals = getDeclaredExternals(resource);
      if (externals.length === 0) return entries;

      const resourceTargetValue = resource.get('buildTarget');
      const resourceTarget = validateBuildTarget(
        {
          nodeVersion: String(resourceTargetValue?.nodeVersion).replace(
            /^v/,
            '',
          ),
          platform: resourceTargetValue?.platform,
          architecture: resourceTargetValue?.architecture,
          ...(resourceTargetValue?.platform === 'linux' ||
          resourceTargetValue?.libc !== undefined
            ? { libc: resourceTargetValue?.libc }
            : {}),
        },
        `Activity '${resource.get('functionName')}' build target`,
      );
      if (getBuildTargetId(resourceTarget) !== getBuildTargetId(target)) {
        throw new Error(
          `Activity '${resource.get('functionName')}' external archive target does not match its SEA build.`,
        );
      }

      if (!resource.has('externalArchiveDigest')) {
        throw new Error(
          `Activity '${resource.get('functionName')}' declares external dependencies but has no reconciled external archive digest.`,
        );
      }
      entries.push({
        activity: String(resource.get('functionName')),
        externals,
        archiveDigest: validateSha256Digest(
          resource.get('externalArchiveDigest'),
          `Activity '${resource.get('functionName')}' external archive digest`,
        ),
      });
      return entries;
    },
    /** @type {DependencyClosureActivity[]} */ ([]),
  );

  activities.sort((left, right) =>
    compareCanonicalStrings(left.activity, right.activity),
  );
  for (let index = 1; index < activities.length; index += 1) {
    if (activities[index - 1].activity === activities[index].activity) {
      throw new Error(
        `SEA build has duplicate FunctionResource activity '${activities[index].activity}'.`,
      );
    }
  }

  return createCanonicalDigest(
    ARTIFACT_DEPENDENCY_CLOSURE_DIGEST_DOMAIN,
    { schemaVersion: 1, target, activities },
    'artifact dependency closure',
  );
}

/**
 * Resolve the completed non-secret signing result associated with a build.
 * @param {any} actorSystem - Owning actor system.
 * @param {any} build - SEA build resource.
 * @param {import('../../core/runtime/build-target.js').BuildTarget} target - Canonical target.
 * @returns {import('../../core/runtime/artifact-record.js').ArtifactProvenance['signing']} - Signing result.
 */
function getArtifactSigning(actorSystem, build, target) {
  if (!actorSystem || typeof actorSystem.getResources !== 'function') {
    throw new TypeError('actorSystem must expose its build resources.');
  }
  const signatures = actorSystem
    .getResources()
    .filter(
      (/** @type {any} */ resource) =>
        resource instanceof MacOSBinarySignature &&
        Array.isArray(resource.dependsOn) &&
        resource.dependsOn.includes(build),
    );
  if (signatures.length > 1) {
    throw new Error('SEA build has more than one macOS signing resource.');
  }
  if (signatures.length === 0) return { mode: 'unsigned' };
  if (target.platform !== 'darwin') {
    throw new Error('Only darwin artifacts may have a macOS signing resource.');
  }
  if (!signatures[0].has('signingResult')) {
    throw new Error('macOS signing resource has no completed signing result.');
  }

  const result = signatures[0].get('signingResult');
  if (result?.mode === 'ad-hoc') return { mode: 'ad-hoc' };
  if (
    result?.mode === 'identity' &&
    typeof result.signer === 'string' &&
    result.signer &&
    result.signer.trim() === result.signer
  ) {
    return { mode: 'identity', signer: result.signer };
  }
  throw new TypeError('macOS signing resource result is not canonical.');
}

/**
 * Construct truthful package-time provenance from reconciled build resources.
 * @param {{build: any, actorSystem: any, revision: unknown, builderVersion: string}} options - Packaging inputs.
 * @returns {Promise<import('../../core/runtime/artifact-record.js').ArtifactProvenance>} - Validated artifact provenance.
 */
export async function createArtifactProvenance({
  build,
  actorSystem,
  revision,
  builderVersion,
}) {
  const validatedRevision = validateApplicationRevision(
    revision,
    'application revision',
  );
  const target = getArtifactBuildTarget(build);
  const provenance = {
    schemaVersion: 1,
    builder: {
      name: ARTIFACT_PROVENANCE_BUILDER_NAME,
      version: builderVersion,
      runtimeDigest: validatedRevision.inputs.runtime.digest,
      toolchainDigest: createArtifactToolchainDigest(builderVersion),
    },
    node: await createNodeProvenance(build, target),
    dependencies: {
      digest: createArtifactDependencyClosureDigest(build, target),
    },
    signing: getArtifactSigning(actorSystem, build, target),
  };

  return validateArtifactProvenance(
    provenance,
    target,
    validatedRevision,
    'artifact provenance',
  );
}

export default createArtifactProvenance;
