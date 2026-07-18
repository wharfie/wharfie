import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

import FunctionResource from '../../core/resources/builds/function-resource.js';
import CoreRuntimeDependenciesResource from '../../core/resources/builds/core-runtime-dependencies.js';
import MacOSBinarySignature from '../../core/resources/builds/macos-binary-signature.js';
import NodeBinary from '../../core/resources/builds/node-binary.js';
import {
  APP_MANIFEST_ASSET_NAME,
  stringifyEmbeddedAppManifest,
} from '../../core/resources/builds/lib/app-manifest-asset.js';
import {
  CORE_RUNTIME_DEPENDENCY_ASSET_KIND,
  CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME,
  CORE_RUNTIME_DEPENDENCY_PURPOSE,
  CORE_RUNTIME_DEPENDENCY_ASSET_SCHEMA_VERSION,
  validateCoreRuntimeDependencyManifest,
} from '../../core/resources/builds/lib/core-runtime-dependency-asset.js';
import {
  APPLICATION_REVISION_ASSET_NAME,
  ARTIFACT_RUNTIME_ASSET_NAME,
  ARTIFACT_RUNTIME_KIND,
  ARTIFACT_RUNTIME_SCHEMA_VERSION,
  stringifyEmbeddedApplicationRevision,
  stringifyEmbeddedArtifactRuntime,
} from '../../core/resources/builds/lib/revision-runtime-assets.js';
import {
  validateApplicationRevision,
  validateDependencyLockInput,
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
  'wharfie:artifact-dependency-closure:v3';
export const ARTIFACT_PROVENANCE_BUILDER_NAME = '@wharfie/wharfie';

const require = createRequire(import.meta.url);
const TOOLCHAIN_PACKAGE_NAMES = Object.freeze([
  '@npmcli/arborist',
  'esbuild',
  'pacote',
  'postject',
  'semver',
  'tar',
]);

/**
 * @typedef DependencyClosureActivity
 * @property {string} activity - Canonical activity name.
 * @property {{name: string, version: string}[]} externals - Exact direct external declarations.
 * @property {import('../../core/runtime/application-revision.js').Sha256Digest} closureDigest - Exact semantic target closure digest.
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
 * @param {unknown} left - First JSON value.
 * @param {unknown} right - Second JSON value.
 * @returns {boolean} - Whether both values have one canonical JSON encoding.
 */
function hasSameCanonicalJson(left, right) {
  return (
    JSON.stringify(
      sortCanonicalJsonValue(cloneJsonValue(left, 'left value')),
    ) ===
    JSON.stringify(sortCanonicalJsonValue(cloneJsonValue(right, 'right value')))
  );
}

/**
 * @param {string | Buffer} bytes - Exact bytes.
 * @returns {import('../../core/runtime/application-revision.js').Sha256Digest} - Digest.
 */
function digestBytes(bytes) {
  return {
    algorithm: 'sha256',
    value: createHash('sha256').update(bytes).digest('base64url'),
  };
}

/**
 * Cross-check every behavior-bearing SEA asset against the immutable revision
 * and deterministic reserved metadata encodings.
 * @param {Record<string, any>} generation - Successful build generation.
 * @param {import('../../core/runtime/application-revision.js').ApplicationRevision} revision - Owning revision.
 * @param {import('../../core/runtime/build-target.js').BuildTarget} target - Artifact target.
 * @returns {void}
 */
function validateGenerationAssets(generation, revision, target) {
  const actualAssets = generation.assets;
  if (
    !actualAssets ||
    typeof actualAssets !== 'object' ||
    Array.isArray(actualAssets)
  ) {
    throw new TypeError('SEA build generation has no exact asset evidence.');
  }
  const embeddedManifest = {
    ...revision.contract,
    targets: [{ ...target }],
  };
  const runtime = {
    schemaVersion: ARTIFACT_RUNTIME_SCHEMA_VERSION,
    kind: ARTIFACT_RUNTIME_KIND,
    appId: revision.contract.app.id,
    revisionId: revision.revisionId,
    target,
  };
  /** @type {Record<string, import('../../core/runtime/application-revision.js').Sha256Digest>} */
  const expectedAssets = {
    ...Object.fromEntries(
      (revision.inputs.assets || []).map((asset) => [asset.name, asset.digest]),
    ),
    [APP_MANIFEST_ASSET_NAME]: digestBytes(
      `${stringifyEmbeddedAppManifest(embeddedManifest, { pretty: true })}\n`,
    ),
    [APPLICATION_REVISION_ASSET_NAME]: digestBytes(
      `${stringifyEmbeddedApplicationRevision(revision, { pretty: true })}\n`,
    ),
    [ARTIFACT_RUNTIME_ASSET_NAME]: digestBytes(
      `${stringifyEmbeddedArtifactRuntime(runtime, { pretty: true })}\n`,
    ),
  };
  for (const [activity, evidence] of Object.entries(
    generation.functionAssets || {},
  )) {
    expectedAssets[activity] = validateSha256Digest(
      evidence.assetDigest,
      `Activity '${activity}' sealed asset digest`,
    );
  }
  const coreEvidence = generation.coreRuntimeDependencies;
  if (coreEvidence !== null && coreEvidence !== undefined) {
    const coreManifest = validateCoreRuntimeDependencyManifest(
      {
        schemaVersion: CORE_RUNTIME_DEPENDENCY_ASSET_SCHEMA_VERSION,
        kind: CORE_RUNTIME_DEPENDENCY_ASSET_KIND,
        purpose: CORE_RUNTIME_DEPENDENCY_PURPOSE,
        target: coreEvidence.target,
        roots: coreEvidence.roots,
        dependencyLockInput: coreEvidence.dependencyLockInput,
        closureDigest: coreEvidence.closureDigest,
        plan: coreEvidence.plan,
        archive: coreEvidence.archive,
      },
      'SEA core runtime dependency evidence',
    );
    if (getBuildTargetId(coreManifest.target) !== getBuildTargetId(target)) {
      throw new Error(
        'SEA core runtime dependency evidence does not match the artifact target.',
      );
    }
    expectedAssets[CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME] =
      validateSha256Digest(
        coreEvidence.manifestDigest,
        'SEA core runtime dependency manifest digest',
      );
    expectedAssets[coreManifest.archive.assetName] =
      coreManifest.archive.digest;
  }
  const actualNames = Object.keys(actualAssets).sort(compareCanonicalStrings);
  const expectedNames = Object.keys(expectedAssets).sort(
    compareCanonicalStrings,
  );
  if (
    actualNames.length !== expectedNames.length ||
    actualNames.some((name, index) => name !== expectedNames[index])
  ) {
    throw new Error(
      'SEA build generation assets do not exactly match its revision, activities, and reserved metadata.',
    );
  }
  for (const name of expectedNames) {
    const actual = validateSha256Digest(
      actualAssets[name],
      `SEA generation asset '${name}'`,
    );
    const expected = validateSha256Digest(
      expectedAssets[name],
      `Expected SEA asset '${name}'`,
    );
    if (actual.value !== expected.value) {
      throw new Error(
        `SEA generation asset '${name}' does not match its immutable input.`,
      );
    }
  }
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
 * Build exact Node binary provenance and cross-check any official receipt.
 * @param {any} build - SEA build resource.
 * @param {import('../../core/runtime/build-target.js').BuildTarget} target - Canonical target.
 * @param {Record<string, any>} generation - Successful SEA build evidence.
 * @returns {Promise<import('../../core/runtime/artifact-record.js').ArtifactProvenance['node']>} - Node provenance.
 */
async function createNodeProvenance(build, target, generation) {
  const nodeSource = generation.nodeSource;
  const nodeBinaryPath = build.get('nodeBinaryPath');
  if (
    !nodeSource ||
    nodeBinaryPath !== nodeSource.path ||
    typeof nodeSource.size !== 'number'
  ) {
    throw new Error(
      'SEA build Node source does not match its committed build generation.',
    );
  }
  const nodeSourceDigest = validateSha256Digest(
    nodeSource.digest,
    'SEA build Node source digest',
  );
  const actualBinary = {
    hex: Buffer.from(nodeSourceDigest.value, 'base64url').toString('hex'),
    base64url: nodeSourceDigest.value,
    size: nodeSource.size,
  };
  const nodeDependencies = Array.isArray(build.dependsOn)
    ? build.dependsOn.filter(
        (/** @type {any} */ dependency) => dependency instanceof NodeBinary,
      )
    : [];
  if (nodeDependencies.length > 1) {
    throw new Error('SEA build has more than one NodeBinary dependency.');
  }
  if (
    nodeDependencies.length === 1 &&
    nodeDependencies[0].get('binaryPath') !== nodeSource.path
  ) {
    throw new Error(
      'NodeBinary output path does not match the Node source sealed into the SEA build generation.',
    );
  }

  const binary = {
    digest: {
      algorithm: /** @type {'sha256'} */ ('sha256'),
      value: actualBinary.base64url,
    },
  };
  if (!Object.prototype.hasOwnProperty.call(nodeSource, 'archive')) {
    throw new Error(
      'SEA build Node source has no same-generation archive evidence state.',
    );
  }
  const archive = nodeSource.archive;
  if (nodeDependencies.length === 0 && archive !== null) {
    throw new Error(
      'SEA build exposes Node archive evidence without a NodeBinary dependency.',
    );
  }
  if (archive === null) {
    return { version: target.nodeVersion, binary };
  }
  if (
    !archive ||
    typeof archive !== 'object' ||
    archive.fileName !== getOfficialNodeArchiveName(target)
  ) {
    throw new Error(
      'SEA build Node archive evidence does not match the exact target.',
    );
  }
  const archiveDigest = validateSha256Digest(
    archive.digest,
    'SEA build Node archive digest',
  );

  return {
    version: target.nodeVersion,
    archive: {
      fileName: archive.fileName,
      digest: archiveDigest,
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
 * @param {unknown} revision - Owning immutable application revision.
 * @param {Record<string, any>} generation - Successful SEA build generation evidence.
 * @returns {import('../../core/runtime/application-revision.js').Sha256Digest} - Canonical dependency closure digest.
 */
export function createArtifactDependencyClosureDigest(
  build,
  target,
  revision,
  generation,
) {
  const validatedRevision = validateApplicationRevision(
    revision,
    'artifact application revision',
  );
  const expectedLock = validatedRevision.inputs.dependencies;
  const contractActivities = validatedRevision.contract.activities || {};
  const functionResources = /** @type {FunctionResource[]} */ (
    Array.isArray(build.dependsOn)
      ? build.dependsOn.filter(
          (/** @type {any} */ dependency) =>
            dependency instanceof FunctionResource,
        )
      : []
  );
  const functionEvidence = generation?.functionAssets;
  if (
    !functionEvidence ||
    typeof functionEvidence !== 'object' ||
    Array.isArray(functionEvidence)
  ) {
    throw new TypeError(
      'SEA build generation does not expose sealed function asset evidence.',
    );
  }

  const resourcesByActivity = new Map();
  for (const resource of functionResources) {
    const activity = String(resource.get('functionName'));
    if (resourcesByActivity.has(activity)) {
      throw new Error(
        `SEA build has duplicate FunctionResource activity '${activity}'.`,
      );
    }
    resourcesByActivity.set(activity, resource);
  }
  const resourceNames = [...resourcesByActivity.keys()].sort(
    compareCanonicalStrings,
  );
  const evidenceNames = Object.keys(functionEvidence).sort(
    compareCanonicalStrings,
  );
  const contractNames = Object.keys(contractActivities).sort(
    compareCanonicalStrings,
  );
  if (
    resourceNames.length !== evidenceNames.length ||
    resourceNames.some((name, index) => name !== evidenceNames[index]) ||
    resourceNames.length !== contractNames.length ||
    resourceNames.some((name, index) => name !== contractNames[index])
  ) {
    throw new Error(
      'SEA sealed function assets, FunctionResource dependencies, and revision contract activities do not exactly match.',
    );
  }

  for (const [activity, resource] of resourcesByActivity) {
    if (!resource.has('singleExecutableAssetDigest')) {
      throw new Error(
        `Activity '${activity}' has no reconciled function asset digest.`,
      );
    }
    const expectedAssetDigest = validateSha256Digest(
      resource.get('singleExecutableAssetDigest'),
      `Activity '${activity}' function asset digest`,
    );
    const sealedEvidence = functionEvidence[activity];
    if (sealedEvidence?.activity !== activity) {
      throw new Error(
        `Activity '${activity}' does not match its sealed function asset identity.`,
      );
    }
    const embeddedAssetDigest = validateSha256Digest(
      sealedEvidence.assetDigest,
      `SEA sealed function asset digest for activity '${activity}'`,
    );
    if (
      embeddedAssetDigest.algorithm !== expectedAssetDigest.algorithm ||
      embeddedAssetDigest.value !== expectedAssetDigest.value
    ) {
      throw new Error(
        `Activity '${activity}' function asset does not match the bytes embedded in its SEA build.`,
      );
    }

    const sealedTarget = validateBuildTarget(
      sealedEvidence.target,
      `Activity '${activity}' sealed build target`,
    );
    const resourceTargetValue = resource.get('buildTarget');
    const resourceTarget = validateBuildTarget(
      {
        nodeVersion: String(resourceTargetValue?.nodeVersion).replace(/^v/, ''),
        platform: resourceTargetValue?.platform,
        architecture: resourceTargetValue?.architecture,
        ...(resourceTargetValue?.platform === 'linux' ||
        resourceTargetValue?.libc !== undefined
          ? { libc: resourceTargetValue?.libc }
          : {}),
      },
      `Activity '${activity}' reconciled build target`,
    );
    if (getBuildTargetId(sealedTarget) !== getBuildTargetId(target)) {
      throw new Error(
        `Activity '${activity}' sealed target does not match its SEA build.`,
      );
    }
    if (getBuildTargetId(resourceTarget) !== getBuildTargetId(sealedTarget)) {
      throw new Error(
        `Activity '${activity}' reconciled build target does not match its sealed function asset.`,
      );
    }

    const resourceExternals = getDeclaredExternals(resource);
    const sealedExternals = sealedEvidence.externals;
    const contractDefinition = contractActivities[activity];
    const contractExternals = Array.isArray(contractDefinition.externalPackages)
      ? contractDefinition.externalPackages
      : [];
    if (
      !hasSameCanonicalJson(resourceExternals, sealedExternals) ||
      !hasSameCanonicalJson(sealedExternals, contractExternals)
    ) {
      throw new Error(
        `Activity '${activity}' external packages do not match its sealed function asset and revision contract.`,
      );
    }
  }
  const activities = functionResources.reduce(
    (
      /** @type {DependencyClosureActivity[]} */ entries,
      /** @type {FunctionResource} */ resource,
    ) => {
      const activity = String(resource.get('functionName'));
      const externals = getDeclaredExternals(resource);
      const sealedEvidence = functionEvidence[activity];
      const embeddedReceipt = sealedEvidence.externalDependencyReceipt;
      if (externals.length === 0) {
        if (embeddedReceipt !== null) {
          throw new Error(
            `Activity '${activity}' embeds an external dependency receipt without declaring externals.`,
          );
        }
        if (
          resource.has('externalArchiveDigest') ||
          resource.has('externalClosureDigest') ||
          resource.has('externalDependencyLockInput')
        ) {
          throw new Error(
            `Activity '${activity}' has stale external dependency output fields without declared externals.`,
          );
        }
        return entries;
      }
      if (!embeddedReceipt) {
        throw new Error(
          `Activity '${activity}' declares external dependencies but its SEA asset has no sealed dependency receipt.`,
        );
      }

      if (!resource.has('externalArchiveDigest')) {
        throw new Error(
          `Activity '${activity}' declares external dependencies but has no reconciled external archive digest.`,
        );
      }
      if (!resource.has('externalClosureDigest')) {
        throw new Error(
          `Activity '${activity}' has no reconciled frozen closure digest.`,
        );
      }
      if (!resource.has('externalDependencyLockInput')) {
        throw new Error(
          `Activity '${activity}' has no reconciled dependency lock input.`,
        );
      }
      const embeddedLock = validateDependencyLockInput(
        embeddedReceipt.dependencyLockInput,
        `Activity '${activity}' sealed dependency lock`,
      );
      const resourceLock = validateDependencyLockInput(
        resource.get('externalDependencyLockInput'),
        `Activity '${activity}' reconciled dependency lock`,
      );
      if (
        embeddedLock.format !== expectedLock.format ||
        embeddedLock.digest.algorithm !== expectedLock.digest.algorithm ||
        embeddedLock.digest.value !== expectedLock.digest.value
      ) {
        throw new Error(
          `Activity '${activity}' sealed dependency lock does not match the owning revision.`,
        );
      }
      if (
        resourceLock.format !== embeddedLock.format ||
        resourceLock.digest.algorithm !== embeddedLock.digest.algorithm ||
        resourceLock.digest.value !== embeddedLock.digest.value
      ) {
        throw new Error(
          `Activity '${activity}' reconciled dependency lock does not match its sealed SEA receipt.`,
        );
      }
      const embeddedClosureDigest = validateSha256Digest(
        embeddedReceipt.closureDigest,
        `Activity '${activity}' sealed frozen closure digest`,
      );
      const resourceClosureDigest = validateSha256Digest(
        resource.get('externalClosureDigest'),
        `Activity '${activity}' reconciled frozen closure digest`,
      );
      if (
        resourceClosureDigest.algorithm !== embeddedClosureDigest.algorithm ||
        resourceClosureDigest.value !== embeddedClosureDigest.value
      ) {
        throw new Error(
          `Activity '${activity}' reconciled frozen closure digest does not match its sealed SEA receipt.`,
        );
      }
      const embeddedArchiveDigest = validateSha256Digest(
        embeddedReceipt.archiveDigest,
        `Activity '${activity}' sealed external archive digest`,
      );
      const resourceArchiveDigest = validateSha256Digest(
        resource.get('externalArchiveDigest'),
        `Activity '${activity}' reconciled external archive digest`,
      );
      if (
        resourceArchiveDigest.algorithm !== embeddedArchiveDigest.algorithm ||
        resourceArchiveDigest.value !== embeddedArchiveDigest.value
      ) {
        throw new Error(
          `Activity '${activity}' reconciled external archive digest does not match its sealed SEA receipt.`,
        );
      }
      entries.push({
        activity,
        externals: sealedEvidence.externals.map(
          (/** @type {{name: string, version: string}} */ external) => ({
            ...external,
          }),
        ),
        closureDigest: embeddedClosureDigest,
        archiveDigest: embeddedArchiveDigest,
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

  /** @type {Record<string, any> | null} */
  let coreRuntimeDependencies = null;
  const coreResources = /** @type {CoreRuntimeDependenciesResource[]} */ (
    Array.isArray(build.dependsOn)
      ? build.dependsOn.filter(
          (/** @type {any} */ dependency) =>
            dependency instanceof CoreRuntimeDependenciesResource,
        )
      : []
  );
  if (coreResources.length > 1) {
    throw new Error(
      'SEA build has more than one core runtime dependency resource.',
    );
  }
  const coreEvidence = generation?.coreRuntimeDependencies;
  if (
    (coreResources.length === 1) !==
    (coreEvidence !== null && coreEvidence !== undefined)
  ) {
    throw new Error(
      'SEA core runtime dependency resource and sealed generation evidence must either both be present or both be absent.',
    );
  }
  if (coreEvidence !== null && coreEvidence !== undefined) {
    const coreManifest = validateCoreRuntimeDependencyManifest(
      {
        schemaVersion: CORE_RUNTIME_DEPENDENCY_ASSET_SCHEMA_VERSION,
        kind: CORE_RUNTIME_DEPENDENCY_ASSET_KIND,
        purpose: CORE_RUNTIME_DEPENDENCY_PURPOSE,
        target: coreEvidence.target,
        roots: coreEvidence.roots,
        dependencyLockInput: coreEvidence.dependencyLockInput,
        closureDigest: coreEvidence.closureDigest,
        plan: coreEvidence.plan,
        archive: coreEvidence.archive,
      },
      'SEA core runtime dependency evidence',
    );
    if (getBuildTargetId(coreManifest.target) !== getBuildTargetId(target)) {
      throw new Error(
        'SEA core runtime dependency evidence does not match the artifact target.',
      );
    }
    const resourceReceipt = coreResources[0].get('receipt');
    const reconciledManifest = validateCoreRuntimeDependencyManifest(
      resourceReceipt,
      'reconciled core runtime dependency receipt',
    );
    if (!hasSameCanonicalJson(reconciledManifest, coreManifest)) {
      throw new Error(
        'Reconciled core runtime dependency receipt does not match its sealed SEA evidence.',
      );
    }
    const resourceAssetDigests = coreResources[0].get('assetDigests', {});
    const reconciledManifestDigest = validateSha256Digest(
      resourceAssetDigests[CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME],
      'reconciled core runtime dependency manifest digest',
    );
    const sealedManifestDigest = validateSha256Digest(
      coreEvidence.manifestDigest,
      'SEA core runtime dependency manifest digest',
    );
    if (reconciledManifestDigest.value !== sealedManifestDigest.value) {
      throw new Error(
        'Reconciled core runtime dependency manifest does not match its sealed SEA evidence.',
      );
    }
    const reconciledArchiveDigest = validateSha256Digest(
      resourceAssetDigests[coreManifest.archive.assetName],
      'reconciled core runtime dependency archive digest',
    );
    if (reconciledArchiveDigest.value !== coreManifest.archive.digest.value) {
      throw new Error(
        'Reconciled core runtime dependency archive does not match its sealed SEA evidence.',
      );
    }
    coreRuntimeDependencies = {
      manifestDigest: sealedManifestDigest,
      roots: coreManifest.roots,
      dependencyLockInput: coreManifest.dependencyLockInput,
      closureDigest: coreManifest.closureDigest,
      archiveDigest: coreManifest.archive.digest,
    };
  }

  return createCanonicalDigest(
    ARTIFACT_DEPENDENCY_CLOSURE_DIGEST_DOMAIN,
    {
      schemaVersion: 3,
      lock: expectedLock,
      target,
      activities,
      coreRuntimeDependencies,
    },
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
 * @param {{build: any, actorSystem: any, revision: unknown, builderVersion: string, artifactBytes: Buffer | Uint8Array}} options - Packaging inputs.
 * @returns {Promise<import('../../core/runtime/artifact-record.js').ArtifactProvenance>} - Validated artifact provenance.
 */
export async function createArtifactProvenance({
  build,
  actorSystem,
  revision,
  builderVersion,
  artifactBytes,
}) {
  const validatedRevision = validateApplicationRevision(
    revision,
    'application revision',
  );
  const target = getArtifactBuildTarget(build);
  if (typeof build.getSuccessfulBuildEvidence !== 'function') {
    throw new TypeError(
      'SEA build does not expose successful generation evidence.',
    );
  }
  const generation = build.getSuccessfulBuildEvidence(artifactBytes);
  validateGenerationAssets(generation, validatedRevision, target);
  const signing = getArtifactSigning(actorSystem, build, target);
  if (!hasSameCanonicalJson(signing, generation.signing)) {
    throw new Error(
      'SEA signing result does not match its committed build generation.',
    );
  }
  const provenance = {
    schemaVersion: 1,
    builder: {
      name: ARTIFACT_PROVENANCE_BUILDER_NAME,
      version: builderVersion,
      runtimeDigest: validatedRevision.inputs.runtime.digest,
      toolchainDigest: createArtifactToolchainDigest(builderVersion),
    },
    node: await createNodeProvenance(build, target, generation),
    dependencies: {
      lock: validatedRevision.inputs.dependencies,
      digest: createArtifactDependencyClosureDigest(
        build,
        target,
        validatedRevision,
        generation,
      ),
    },
    signing,
  };

  return validateArtifactProvenance(
    provenance,
    target,
    validatedRevision,
    'artifact provenance',
  );
}

export default createArtifactProvenance;
