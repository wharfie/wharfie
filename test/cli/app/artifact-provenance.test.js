/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { brotliCompressSync } from 'node:zlib';

import {
  createArtifactProvenance,
  createArtifactToolchainDigest,
} from '../../../src/cli/app/artifact-provenance.js';
import CoreRuntimeDependenciesResource from '../../../src/core/resources/builds/core-runtime-dependencies.js';
import FunctionResource from '../../../src/core/resources/builds/function-resource.js';
import MacOSBinarySignature from '../../../src/core/resources/builds/macos-binary-signature.js';
import NodeBinary from '../../../src/core/resources/builds/node-binary.js';
import SeaBuild from '../../../src/core/resources/builds/sea-build.js';
import {
  FUNCTION_ASSET_SCHEMA_VERSION,
  parseFunctionAssetDescription,
  serializeFunctionAssetDescription,
} from '../../../src/core/resources/builds/lib/function-asset.js';
import {
  CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME,
  CORE_RUNTIME_DEPENDENCY_ACTIVITY,
  CORE_RUNTIME_DEPENDENCY_ASSET_KIND,
  CORE_RUNTIME_DEPENDENCY_ASSET_SCHEMA_VERSION,
  CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME,
  CORE_RUNTIME_DEPENDENCY_PURPOSE,
  CORE_RUNTIME_DEPENDENCY_ROOT,
} from '../../../src/core/resources/builds/lib/core-runtime-dependency-asset.js';
import { digestFrozenDependencyClosurePlan } from '../../../src/core/resources/builds/lib/frozen-dependency-closure-plan.js';
import {
  APP_MANIFEST_ASSET_NAME,
  stringifyEmbeddedAppManifest,
} from '../../../src/core/resources/builds/lib/app-manifest-asset.js';
import {
  APPLICATION_REVISION_ASSET_NAME,
  ARTIFACT_RUNTIME_ASSET_NAME,
  ARTIFACT_RUNTIME_KIND,
  ARTIFACT_RUNTIME_SCHEMA_VERSION,
  stringifyEmbeddedApplicationRevision,
  stringifyEmbeddedArtifactRuntime,
} from '../../../src/core/resources/builds/lib/revision-runtime-assets.js';
import { createApplicationRevision } from '../../../src/core/runtime/application-revision.js';
import { sortCanonicalJsonValue } from '../../../src/core/runtime/canonical-order.js';
import { sha256Base64Url } from '../../../src/core/runtime/content-id.js';

const BUILDER_VERSION = '0.0.15';
/** @type {import('../../../src/core/runtime/build-target.js').BuildTarget} */
const LINUX_TARGET = {
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
};
/** @type {import('../../../src/core/runtime/build-target.js').BuildTarget} */
const DARWIN_TARGET = {
  nodeVersion: '24.13.1',
  platform: 'darwin',
  architecture: 'arm64',
};
const ORIGINAL_FUNCTION_ASSET_PATH = FunctionResource.TEMP_ASSET_PATH;

/** @type {string[]} */
const temporaryDirectories = [];

afterEach(async () => {
  jest.restoreAllMocks();
  FunctionResource.TEMP_ASSET_PATH = ORIGINAL_FUNCTION_ASSET_PATH;
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fsp.rm(directory, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

/** @param {string} label */
async function makeTemporaryDirectory(label) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), label));
  temporaryDirectories.push(directory);
  return directory;
}

/**
 * @param {string | Buffer | Uint8Array | ArrayBuffer} value
 * @returns {import('../../../src/core/runtime/application-revision.js').Sha256Digest}
 */
function digest(value) {
  return {
    algorithm: /** @type {'sha256'} */ ('sha256'),
    value: sha256Base64Url(value),
  };
}

/**
 * @param {FunctionResource[]} [functionResources]
 * @param {import('../../../src/core/runtime/application-revision.js').RevisionAssetInput[]} [assets]
 */
function makeRevision(functionResources = [], assets = []) {
  const activities = Object.fromEntries(
    functionResources.map((resource) => {
      const activity = String(resource.get('functionName'));
      const externals = resource.get('external', []);
      return [
        activity,
        {
          entrypoint: {
            kind: 'node',
            path: `src/${activity}.js`,
            export: 'default',
          },
          ...(externals.length ? { externalPackages: externals } : {}),
        },
      ];
    }),
  );
  return createApplicationRevision({
    contract: {
      schemaVersion: 2,
      app: { id: 'provenance-test' },
      cli: {
        entrypoint: {
          kind: 'node',
          path: 'src/cli.js',
          export: 'main',
        },
      },
      ...(Object.keys(activities).length ? { activities } : {}),
    },
    inputs: {
      source: {
        format: 'wharfie-source-tree-v1',
        digest: digest('source'),
      },
      dependencies: {
        format: 'wharfie-npm-package-lock-v3-closure-v1',
        digest: digest('dependency-lock'),
      },
      runtime: {
        format: 'wharfie-runtime-v1',
        digest: digest('runtime'),
      },
      ...(assets.length ? { assets } : {}),
    },
  });
}

/**
 * @param {import('../../../src/core/runtime/build-target.js').BuildTarget} target
 * @param {string} binaryPath
 */
function makeNodeBinary(target, binaryPath) {
  const nodeBinary = new NodeBinary({
    name: `node-${target.platform}-${target.architecture}`,
    properties: {
      version: target.nodeVersion,
      platform: /** @type {NodeJS.Platform} */ (target.platform),
      architecture: /** @type {NodeJS.Architecture} */ (target.architecture),
    },
  });
  nodeBinary._setUNSAFE('binaryPath', binaryPath);
  nodeBinary._setUNSAFE('exactVersion', `v${target.nodeVersion}`);
  return nodeBinary;
}

/**
 * @param {{
 *   name: string,
 *   target: import('../../../src/core/runtime/build-target.js').BuildTarget,
 *   externals?: {name: string, version: string}[],
 *   archiveBytes?: Buffer | Uint8Array | string,
 *   closureDigest?: import('../../../src/core/runtime/application-revision.js').Sha256Digest,
 *   dependencyLockInput?: import('../../../src/core/runtime/application-revision.js').LockedInputDescriptor
 * }} options
 */
function makeFunctionResource({
  name,
  target,
  externals = [],
  archiveBytes,
  closureDigest,
  dependencyLockInput,
}) {
  const resource = new FunctionResource({
    name: `${name}-${target.platform}-${target.architecture}`,
    properties: {
      functionName: name,
      entrypoint: { path: `/tmp/${name}.js`, export: 'default' },
      buildTarget: target,
      ...(externals.length ? { external: externals } : {}),
    },
  });
  resource._setUNSAFE(
    'singleExecutableAssetDigest',
    digest(`${name} function asset`),
  );
  if (archiveBytes !== undefined) {
    const exactArchiveBytes = Buffer.from(archiveBytes);
    /** @type {any} */ (resource)._testExternalArchiveBytes = exactArchiveBytes;
    resource._setUNSAFE(
      'externalDependencyLockInput',
      dependencyLockInput || makeRevision().inputs.dependencies,
    );
    resource._setUNSAFE(
      'externalClosureDigest',
      closureDigest || digest(`${name} frozen closure`),
    );
    resource._setUNSAFE('externalArchiveDigest', digest(exactArchiveBytes));
  }
  return resource;
}

/**
 * @param {import('../../../src/core/runtime/build-target.js').BuildTarget} target
 * @param {string} marker
 */
function makeCoreRuntimeDependenciesResource(target, marker) {
  const resource = new CoreRuntimeDependenciesResource({
    name: `core-runtime-dependencies-${marker}`,
    properties: { buildTarget: target },
  });
  const archiveDigest = digest(`${marker} core archive`);
  const dependencyLockInput = {
    format: 'wharfie-npm-package-lock-v3-closure-v1',
    digest: digest(`${marker} core dependency lock`),
  };
  const plan = {
    schemaVersion: 2,
    kind: 'frozenDependencyClosure',
    activity: CORE_RUNTIME_DEPENDENCY_ACTIVITY,
    lock: dependencyLockInput,
    target,
    installScripts: 'ignored',
    binLinks: 'not-created',
    selectedOptionalFailures: 'fatal',
    roots: [
      {
        ...CORE_RUNTIME_DEPENDENCY_ROOT,
        location: 'node_modules/lmdb',
      },
    ],
    packages: [
      {
        location: 'node_modules/lmdb',
        ...CORE_RUNTIME_DEPENDENCY_ROOT,
        resolved: 'https://registry.npmjs.org/lmdb/-/lmdb-3.4.4.tgz',
        integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
        hasInstallScript: false,
        manifestContract: sortCanonicalJsonValue({
          ...CORE_RUNTIME_DEPENDENCY_ROOT,
          bundleDependencies: [],
          hasInstallScript: false,
        }),
        edges: [],
      },
    ],
  };
  const receipt = {
    schemaVersion: CORE_RUNTIME_DEPENDENCY_ASSET_SCHEMA_VERSION,
    kind: CORE_RUNTIME_DEPENDENCY_ASSET_KIND,
    purpose: CORE_RUNTIME_DEPENDENCY_PURPOSE,
    target,
    roots: [{ ...CORE_RUNTIME_DEPENDENCY_ROOT }],
    dependencyLockInput,
    closureDigest: digestFrozenDependencyClosurePlan(plan),
    plan,
    archive: {
      assetName: CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME,
      digest: archiveDigest,
    },
  };
  resource._setUNSAFE('receipt', receipt);
  resource._setUNSAFE('assetDigests', {
    [CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME]: digest(
      `${marker} core manifest`,
    ),
    [CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME]: archiveDigest,
  });
  return resource;
}

/**
 * @param {import('../../../src/core/runtime/build-target.js').BuildTarget} target
 * @param {string} binaryPath
 * @param {any[]} dependencies
 * @param {import('../../../src/core/runtime/application-revision.js').ApplicationRevision} revision
 * @returns {Promise<SeaBuild>}
 */
async function makeBuild(target, binaryPath, dependencies, revision) {
  const directory = await makeTemporaryDirectory('wharfie-sealed-assets-');
  /** @type {Record<string, string>} */
  const assets = {};
  /** @type {Record<string, import('../../../src/core/runtime/application-revision.js').Sha256Digest>} */
  const functionAssetDigests = {};
  /** @type {Record<string, any>} */
  const functionAssetEvidence = {};
  const functionResources = dependencies.filter(
    (dependency) => dependency instanceof FunctionResource,
  );
  const coreResources = dependencies.filter(
    (dependency) => dependency instanceof CoreRuntimeDependenciesResource,
  );
  if (coreResources.length > 1) {
    throw new Error(
      'Test SEA build has more than one core dependency resource.',
    );
  }
  for (const [index, resource] of functionResources.entries()) {
    const activity = String(resource.get('functionName'));
    const externalArchiveBytes = Buffer.from(
      /** @type {any} */ (resource)._testExternalArchiveBytes || '',
    );
    const hasReceipt =
      resource.has('externalDependencyLockInput') &&
      resource.has('externalClosureDigest') &&
      resource.has('externalArchiveDigest');
    const assetBytes = serializeFunctionAssetDescription({
      schemaVersion: FUNCTION_ASSET_SCHEMA_VERSION,
      activity,
      target: resource.get('buildTarget'),
      externals: resource.get('external', []),
      codeBundle: brotliCompressSync(
        `globalThis[Symbol.for(${JSON.stringify(activity)})] = () => {};`,
      ).toString('base64'),
      externalsTar: externalArchiveBytes.toString('base64'),
      externalDependencyReceipt: hasReceipt
        ? {
            dependencyLockInput: resource.get('externalDependencyLockInput'),
            closureDigest: resource.get('externalClosureDigest'),
            archiveDigest: resource.get('externalArchiveDigest'),
          }
        : null,
    });
    const assetPath = path.join(directory, `${index}.asset`);
    await fsp.writeFile(assetPath, assetBytes);
    const assetDigest = digest(assetBytes);
    resource._setUNSAFE('singleExecutableAssetDigest', assetDigest);
    assets[activity] = assetPath;
    functionAssetDigests[activity] = assetDigest;
    const parsed = parseFunctionAssetDescription(
      assetBytes,
      `test function asset '${activity}'`,
    ).description;
    functionAssetEvidence[activity] = {
      assetDigest,
      activity: parsed.activity,
      target: parsed.target,
      externals: parsed.externals,
      externalDependencyReceipt: parsed.externalDependencyReceipt,
    };
  }
  const build = new SeaBuild({
    name: `build-${target.platform}-${target.architecture}`,
    dependsOn: dependencies,
    properties: {
      entryCode: 'void 0;',
      resolveDir: '/tmp',
      nodeBinaryPath: binaryPath,
      nodeVersion: target.nodeVersion,
      platform: /** @type {NodeJS.Platform} */ (target.platform),
      architecture: /** @type {NodeJS.Architecture} */ (target.architecture),
      ...('libc' in target ? { libc: target.libc } : {}),
      assets,
      functionAssetDigests,
    },
  });
  build._setUNSAFE('binaryPath', binaryPath);

  const binaryBytes = await fsp.readFile(binaryPath);
  /** @type {null | {fileName: string, digest: import('../../../src/core/runtime/application-revision.js').Sha256Digest}} */
  let nodeArchive = null;
  const nodeDependencies = dependencies.filter(
    (dependency) => dependency instanceof NodeBinary,
  );
  if (nodeDependencies.length === 1) {
    const receiptPath =
      await nodeDependencies[0].getIntegrityReceiptPath(binaryPath);
    try {
      const receipt = JSON.parse(await fsp.readFile(receiptPath, 'utf8'));
      nodeArchive = {
        fileName: receipt.archive.fileName,
        digest: {
          algorithm: 'sha256',
          value: Buffer.from(receipt.archive.sha256, 'hex').toString(
            'base64url',
          ),
        },
      };
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      ) {
        throw error;
      }
    }
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
  /** @type {import('../../../src/core/resources/builds/sea-build.js').SuccessfulBuildEvidence} */
  const generation = {
    binaryPath,
    binaryDigest: digest(binaryBytes),
    nodeSource: {
      path: binaryPath,
      digest: digest(binaryBytes),
      size: binaryBytes.length,
      archive: nodeArchive,
    },
    assets: {
      ...Object.fromEntries(
        (revision.inputs.assets || []).map((asset) => [
          asset.name,
          asset.digest,
        ]),
      ),
      [APP_MANIFEST_ASSET_NAME]: digest(
        `${stringifyEmbeddedAppManifest(embeddedManifest, { pretty: true })}\n`,
      ),
      [APPLICATION_REVISION_ASSET_NAME]: digest(
        `${stringifyEmbeddedApplicationRevision(revision, { pretty: true })}\n`,
      ),
      [ARTIFACT_RUNTIME_ASSET_NAME]: digest(
        `${stringifyEmbeddedArtifactRuntime(runtime, { pretty: true })}\n`,
      ),
      ...functionAssetDigests,
    },
    functionAssets: functionAssetEvidence,
    signing: { mode: 'unsigned' },
  };
  if (coreResources.length === 1) {
    const coreReceipt = coreResources[0].get('receipt');
    const coreAssetDigests = coreResources[0].get('assetDigests');
    generation.assets[CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME] =
      coreAssetDigests[CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME];
    generation.assets[coreReceipt.archive.assetName] =
      coreAssetDigests[coreReceipt.archive.assetName];
    generation.coreRuntimeDependencies = {
      manifestDigest:
        coreAssetDigests[CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME],
      target: coreReceipt.target,
      roots: coreReceipt.roots,
      dependencyLockInput: coreReceipt.dependencyLockInput,
      closureDigest: coreReceipt.closureDigest,
      plan: coreReceipt.plan,
      archive: coreReceipt.archive,
    };
  }
  successfulGenerations.set(build, generation);
  jest
    .spyOn(build, 'getSuccessfulBuildEvidence')
    .mockImplementation((artifactBytes) => {
      if (digest(artifactBytes).value !== generation.binaryDigest.value) {
        throw new Error(
          'SEA artifact bytes do not match the committed build generation.',
        );
      }
      return generation;
    });
  return build;
}

/** @type {WeakMap<SeaBuild, import('../../../src/core/resources/builds/sea-build.js').SuccessfulBuildEvidence>} */
const successfulGenerations = new WeakMap();

/** @param {SeaBuild} build */
async function readArtifactBytes(build) {
  return fsp.readFile(build.get('binaryPath'));
}

/**
 * @param {SeaBuild} build
 * @param {{mode: 'unsigned'} | {mode: 'ad-hoc'} | {mode: 'identity', signer: string}} signing
 */
function setSuccessfulGenerationSigning(build, signing) {
  const generation = successfulGenerations.get(build);
  if (!generation) throw new Error('Test build has no successful generation.');
  generation.signing = signing;
}

/** @param {any[]} [resources] */
function makeActorSystem(resources = []) {
  return { getResources: () => resources };
}

describe('package-time artifact provenance', () => {
  it('freezes an official Node receipt into the successful build generation', async () => {
    const directory = await makeTemporaryDirectory('wharfie-receipt-');
    const binaryPath = path.join(directory, 'node');
    const binaryBytes = Buffer.from('official extracted node bytes');
    await fsp.writeFile(binaryPath, binaryBytes);
    const nodeBinary = makeNodeBinary(LINUX_TARGET, binaryPath);
    const archiveSha256 = 'ab'.repeat(32);
    await fsp.writeFile(
      await nodeBinary.getIntegrityReceiptPath(binaryPath),
      JSON.stringify({
        version: 1,
        target: {
          nodeVersion: `v${LINUX_TARGET.nodeVersion}`,
          platform: LINUX_TARGET.platform,
          architecture: LINUX_TARGET.architecture,
        },
        archive: {
          fileName: `node-v${LINUX_TARGET.nodeVersion}-linux-x64.tar.gz`,
          sha256: archiveSha256,
        },
        binary: {
          sha256: createHash('sha256').update(binaryBytes).digest('hex'),
          size: binaryBytes.length,
        },
      }),
    );
    const revision = makeRevision();
    const build = await makeBuild(
      LINUX_TARGET,
      binaryPath,
      [nodeBinary],
      revision,
    );
    const artifactBytes = await readArtifactBytes(build);

    const provenance = await createArtifactProvenance({
      build,
      actorSystem: makeActorSystem(),
      revision,
      builderVersion: BUILDER_VERSION,
      artifactBytes,
    });

    expect(provenance.node).toEqual({
      version: LINUX_TARGET.nodeVersion,
      archive: {
        fileName: `node-v${LINUX_TARGET.nodeVersion}-linux-x64.tar.gz`,
        digest: {
          algorithm: 'sha256',
          value: Buffer.from(archiveSha256, 'hex').toString('base64url'),
        },
      },
      binary: { digest: digest(binaryBytes) },
    });
    expect(provenance.builder).toEqual({
      name: '@wharfie/wharfie',
      version: BUILDER_VERSION,
      runtimeDigest: revision.inputs.runtime.digest,
      toolchainDigest: createArtifactToolchainDigest(BUILDER_VERSION),
    });

    const receiptPath = await nodeBinary.getIntegrityReceiptPath(binaryPath);
    const receipt = JSON.parse(await fsp.readFile(receiptPath, 'utf8'));
    receipt.binary.sha256 = 'cd'.repeat(32);
    await fsp.writeFile(receiptPath, JSON.stringify(receipt));
    await expect(
      createArtifactProvenance({
        build,
        actorSystem: makeActorSystem(),
        revision,
        builderVersion: BUILDER_VERSION,
        artifactBytes,
      }),
    ).resolves.toEqual(provenance);
    await fsp.rm(receiptPath);
    await expect(
      createArtifactProvenance({
        build,
        actorSystem: makeActorSystem(),
        revision,
        builderVersion: BUILDER_VERSION,
        artifactBytes,
      }),
    ).resolves.toEqual(provenance);
  });

  it('hashes a local Node binary and truthfully omits absent archive evidence', async () => {
    const directory = await makeTemporaryDirectory('wharfie-local-node-');
    const binaryPath = path.join(directory, 'local-node');
    const binaryBytes = Buffer.from('locally supplied node bytes');
    await fsp.writeFile(binaryPath, binaryBytes);
    const nodeBinary = makeNodeBinary(LINUX_TARGET, binaryPath);
    const revision = makeRevision();
    const build = await makeBuild(
      LINUX_TARGET,
      binaryPath,
      [nodeBinary],
      revision,
    );
    const artifactBytes = await readArtifactBytes(build);

    const provenance = await createArtifactProvenance({
      build,
      actorSystem: makeActorSystem(),
      revision,
      builderVersion: BUILDER_VERSION,
      artifactBytes,
    });

    expect(provenance.node).toEqual({
      version: LINUX_TARGET.nodeVersion,
      binary: { digest: digest(binaryBytes) },
    });
    expect(provenance.node).not.toHaveProperty('archive');
    expect(provenance.signing).toEqual({ mode: 'unsigned' });

    await expect(
      createArtifactProvenance({
        build,
        actorSystem: makeActorSystem(),
        revision,
        builderVersion: BUILDER_VERSION,
        artifactBytes: Buffer.from('different final artifact bytes'),
      }),
    ).rejects.toThrow(/do not match the committed build generation/i);
  });

  it('retains the digest of the exact external archive embedded by a function', async () => {
    const directory = await makeTemporaryDirectory('wharfie-function-asset-');
    FunctionResource.TEMP_ASSET_PATH = directory;
    const externalArchive = Buffer.from('exact target external tar bytes');
    const resource = makeFunctionResource({
      name: 'image',
      target: LINUX_TARGET,
      externals: [{ name: 'sharp', version: '0.34.4' }],
    });
    const revision = makeRevision();
    jest.spyOn(resource, 'esbuild').mockResolvedValue('activity code');
    jest.spyOn(resource, 'bundleExternals').mockResolvedValue({
      externalsTar: externalArchive.toString('base64'),
      receipt: {
        dependencyLockInput: revision.inputs.dependencies,
        closureDigest: digest('image frozen closure'),
        plan: {
          activity: 'image',
          target: LINUX_TARGET,
          roots: [
            {
              name: 'sharp',
              version: '0.34.4',
              location: 'node_modules/sharp',
            },
          ],
          lock: revision.inputs.dependencies,
        },
      },
    });

    await resource._reconcile();

    expect(resource.get('externalArchiveDigest')).toEqual(
      digest(externalArchive),
    );
    expect(resource.get('externalClosureDigest')).toEqual(
      digest('image frozen closure'),
    );
    expect(resource.get('externalDependencyLockInput')).toEqual(
      revision.inputs.dependencies,
    );
    const assetBytes = await fsp.readFile(
      resource.get('singleExecutableAssetPath'),
    );
    expect(resource.get('singleExecutableAssetDigest')).toEqual(
      digest(assetBytes),
    );
    expect(
      (await fsp.stat(resource.get('singleExecutableAssetPath'))).mode & 0o777,
    ).toBe(0o400);
    const embedded = JSON.parse(assetBytes.toString('utf8'));
    expect(Buffer.from(embedded.externalsTar, 'base64')).toEqual(
      externalArchive,
    );
    expect(embedded.externalDependencyReceipt).toEqual({
      dependencyLockInput: revision.inputs.dependencies,
      closureDigest: digest('image frozen closure'),
      archiveDigest: digest(externalArchive),
    });
    expect(embedded).toMatchObject({
      activity: 'image',
      target: LINUX_TARGET,
      externals: [{ name: 'sharp', version: '0.34.4' }],
    });
  });

  it('clears stale external receipts before a failed reconciliation retry', async () => {
    const directory = await makeTemporaryDirectory('wharfie-stale-receipt-');
    FunctionResource.TEMP_ASSET_PATH = directory;
    const revision = makeRevision();
    const resource = makeFunctionResource({
      name: 'retrying-image',
      target: LINUX_TARGET,
      externals: [{ name: 'sharp', version: '0.34.4' }],
    });
    jest.spyOn(resource, 'esbuild').mockResolvedValue('activity code');
    jest
      .spyOn(resource, 'bundleExternals')
      .mockResolvedValueOnce({
        externalsTar: Buffer.from('first external archive').toString('base64'),
        receipt: {
          dependencyLockInput: revision.inputs.dependencies,
          closureDigest: digest('first frozen closure'),
          plan: {
            activity: 'retrying-image',
            target: LINUX_TARGET,
            roots: [
              {
                name: 'sharp',
                version: '0.34.4',
                location: 'node_modules/sharp',
              },
            ],
            lock: revision.inputs.dependencies,
          },
        },
      })
      .mockRejectedValueOnce(new Error('second external build failed'));

    await resource._reconcile();
    expect(resource.has('externalArchiveDigest')).toBe(true);
    expect(resource.has('externalClosureDigest')).toBe(true);
    expect(resource.has('externalDependencyLockInput')).toBe(true);
    const firstAssetPath = resource.get('singleExecutableAssetPath');
    expect(resource.has('singleExecutableAssetDigest')).toBe(true);

    await expect(resource._reconcile()).rejects.toThrow(
      'second external build failed',
    );
    expect(resource.has('externalArchiveDigest')).toBe(false);
    expect(resource.has('externalClosureDigest')).toBe(false);
    expect(resource.has('externalDependencyLockInput')).toBe(false);
    expect(resource.has('singleExecutableAssetPath')).toBe(false);
    expect(resource.has('singleExecutableAssetDigest')).toBe(false);
    expect(existsSync(firstAssetPath)).toBe(false);
  });

  it('seals closure-plan identity when mutable resource fields change during installation', async () => {
    const directory = await makeTemporaryDirectory(
      'wharfie-plan-identity-race-',
    );
    FunctionResource.TEMP_ASSET_PATH = directory;
    const revision = makeRevision();
    const resource = makeFunctionResource({
      name: 'planned-image',
      target: LINUX_TARGET,
      externals: [{ name: 'sharp', version: '0.34.4' }],
    });
    const externalArchive = Buffer.from('plan-owned archive');
    /** @type {(value: any) => void} */
    let releaseBundle = () => {};
    /** @type {Promise<any>} */
    const bundleReady = new Promise((resolve) => {
      releaseBundle = (value) => resolve(value);
    });
    /** @type {() => void} */
    let markBundleStarted = () => {};
    /** @type {Promise<void>} */
    const bundleStarted = new Promise((resolve) => {
      markBundleStarted = () => resolve();
    });
    jest.spyOn(resource, 'esbuild').mockResolvedValue('activity code');
    jest.spyOn(resource, 'bundleExternals').mockImplementation(async () => {
      markBundleStarted();
      return await bundleReady;
    });

    const reconcile = resource._reconcile();
    await bundleStarted;
    resource._setUNSAFE('functionName', 'mutated-image');
    resource._setUNSAFE('buildTarget', DARWIN_TARGET);
    resource._setUNSAFE('external', [{ name: 'lmdb', version: '3.4.4' }]);
    releaseBundle({
      externalsTar: externalArchive.toString('base64'),
      receipt: {
        dependencyLockInput: revision.inputs.dependencies,
        closureDigest: digest('planned closure'),
        plan: {
          activity: 'planned-image',
          target: LINUX_TARGET,
          roots: [
            {
              name: 'sharp',
              version: '0.34.4',
              location: 'node_modules/sharp',
            },
          ],
          lock: revision.inputs.dependencies,
        },
      },
    });
    await reconcile;

    const embedded = JSON.parse(
      await fsp.readFile(resource.get('singleExecutableAssetPath'), 'utf8'),
    );
    expect(embedded.externalDependencyReceipt).toEqual({
      dependencyLockInput: revision.inputs.dependencies,
      closureDigest: digest('planned closure'),
      archiveDigest: digest(externalArchive),
    });
    expect(embedded).toMatchObject({
      activity: 'planned-image',
      target: LINUX_TARGET,
      externals: [{ name: 'sharp', version: '0.34.4' }],
    });
  });

  it('represents an activity with no externals as an exact empty archive', async () => {
    const directory = await makeTemporaryDirectory('wharfie-empty-function-');
    FunctionResource.TEMP_ASSET_PATH = directory;
    const resource = makeFunctionResource({
      name: 'plain',
      target: LINUX_TARGET,
    });
    jest.spyOn(resource, 'esbuild').mockResolvedValue('activity code');
    jest
      .spyOn(resource, 'bundleExternals')
      .mockResolvedValue({ externalsTar: '', receipt: null });

    await resource._reconcile();

    expect(resource.has('externalArchiveDigest')).toBe(false);
    expect(resource.has('externalClosureDigest')).toBe(false);
    expect(resource.has('externalDependencyLockInput')).toBe(false);
    const embedded = JSON.parse(
      await fsp.readFile(resource.get('singleExecutableAssetPath'), 'utf8'),
    );
    expect(embedded.schemaVersion).toBe(FUNCTION_ASSET_SCHEMA_VERSION);
    expect(embedded.externalsTar).toBe('');
    expect(embedded.externalDependencyReceipt).toBeNull();
    expect(embedded).not.toHaveProperty('resourceSpecs');
    expect(() =>
      serializeFunctionAssetDescription({
        ...embedded,
        schemaVersion: 3,
      }),
    ).toThrow(/schemaVersion must be the integer 4/i);
    expect(() =>
      serializeFunctionAssetDescription({
        ...embedded,
        resourceSpecs: {},
      }),
    ).toThrow(/resourceSpecs is not supported/i);
  });

  it('canonically digests target external closures and fails on unreconciled archives', async () => {
    const directory = await makeTemporaryDirectory('wharfie-closure-');
    const binaryPath = path.join(directory, 'node');
    await fsp.writeFile(binaryPath, 'node bytes');
    const nodeBinary = makeNodeBinary(LINUX_TARGET, binaryPath);
    const image = makeFunctionResource({
      name: 'image',
      target: LINUX_TARGET,
      externals: [{ name: 'sharp', version: '0.34.4' }],
      archiveBytes: 'sharp target archive',
    });
    const database = makeFunctionResource({
      name: 'database',
      target: LINUX_TARGET,
      externals: [{ name: 'lmdb', version: '3.4.2' }],
      archiveBytes: 'lmdb target archive',
    });
    const revision = makeRevision([image, database]);
    const firstBuild = await makeBuild(
      LINUX_TARGET,
      binaryPath,
      [nodeBinary, image, database],
      revision,
    );
    const first = await createArtifactProvenance({
      build: firstBuild,
      actorSystem: makeActorSystem(),
      revision,
      builderVersion: BUILDER_VERSION,
      artifactBytes: await readArtifactBytes(firstBuild),
    });
    const secondBuild = await makeBuild(
      LINUX_TARGET,
      binaryPath,
      [database, nodeBinary, image],
      revision,
    );
    const second = await createArtifactProvenance({
      build: secondBuild,
      actorSystem: makeActorSystem(),
      revision,
      builderVersion: BUILDER_VERSION,
      artifactBytes: await readArtifactBytes(secondBuild),
    });
    expect(second.dependencies.digest).toEqual(first.dependencies.digest);

    const unreconciled = makeFunctionResource({
      name: 'unreconciled',
      target: LINUX_TARGET,
      externals: [{ name: 'sharp', version: '0.34.4' }],
      archiveBytes: 'sealed before output fields were lost',
    });
    const unreconciledRevision = makeRevision([unreconciled]);
    const unreconciledBuild = await makeBuild(
      LINUX_TARGET,
      binaryPath,
      [nodeBinary, unreconciled],
      unreconciledRevision,
    );
    delete unreconciled.properties.externalArchiveDigest;
    delete unreconciled.properties.externalClosureDigest;
    delete unreconciled.properties.externalDependencyLockInput;
    await expect(
      createArtifactProvenance({
        build: unreconciledBuild,
        actorSystem: makeActorSystem(),
        revision: unreconciledRevision,
        builderVersion: BUILDER_VERSION,
        artifactBytes: await readArtifactBytes(unreconciledBuild),
      }),
    ).rejects.toThrow(/no reconciled external archive digest/i);
  });

  it('binds the core LMDB closure receipt into artifact provenance', async () => {
    const directory = await makeTemporaryDirectory('wharfie-core-closure-');
    const binaryPath = path.join(directory, 'node');
    await fsp.writeFile(binaryPath, 'node bytes');
    const revision = makeRevision();
    const firstCore = makeCoreRuntimeDependenciesResource(
      LINUX_TARGET,
      'first',
    );
    const firstBuild = await makeBuild(
      LINUX_TARGET,
      binaryPath,
      [firstCore],
      revision,
    );
    const first = await createArtifactProvenance({
      build: firstBuild,
      actorSystem: makeActorSystem(),
      revision,
      builderVersion: BUILDER_VERSION,
      artifactBytes: await readArtifactBytes(firstBuild),
    });

    const secondCore = makeCoreRuntimeDependenciesResource(
      LINUX_TARGET,
      'second',
    );
    const secondBuild = await makeBuild(
      LINUX_TARGET,
      binaryPath,
      [secondCore],
      revision,
    );
    const second = await createArtifactProvenance({
      build: secondBuild,
      actorSystem: makeActorSystem(),
      revision,
      builderVersion: BUILDER_VERSION,
      artifactBytes: await readArtifactBytes(secondBuild),
    });
    expect(second.dependencies.digest).not.toEqual(first.dependencies.digest);

    firstCore._setUNSAFE('assetDigests', {
      ...firstCore.get('assetDigests'),
      [CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME]: digest(
        'mutated core archive',
      ),
    });
    await expect(
      createArtifactProvenance({
        build: firstBuild,
        actorSystem: makeActorSystem(),
        revision,
        builderVersion: BUILDER_VERSION,
        artifactBytes: await readArtifactBytes(firstBuild),
      }),
    ).rejects.toThrow(/core runtime dependency archive does not match/i);
  });

  it('rejects a core resource without sealed SEA evidence', async () => {
    const directory = await makeTemporaryDirectory(
      'wharfie-missing-core-evidence-',
    );
    const binaryPath = path.join(directory, 'node');
    await fsp.writeFile(binaryPath, 'node bytes');
    const revision = makeRevision();
    const core = makeCoreRuntimeDependenciesResource(LINUX_TARGET, 'missing');
    const build = await makeBuild(LINUX_TARGET, binaryPath, [core], revision);
    const generation = successfulGenerations.get(build);
    if (!generation) throw new Error('Expected a successful build generation.');
    delete generation.coreRuntimeDependencies;
    delete generation.assets[CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME];
    delete generation.assets[CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME];

    await expect(
      createArtifactProvenance({
        build,
        actorSystem: makeActorSystem(),
        revision,
        builderVersion: BUILDER_VERSION,
        artifactBytes: await readArtifactBytes(build),
      }),
    ).rejects.toThrow(/resource and sealed generation evidence/i);
  });

  it('rejects an activity receipt from a different dependency lock', async () => {
    const directory = await makeTemporaryDirectory('wharfie-lock-mismatch-');
    const binaryPath = path.join(directory, 'node');
    await fsp.writeFile(binaryPath, 'node bytes');
    const baseRevision = makeRevision();
    const resource = makeFunctionResource({
      name: 'foreign-lock',
      target: LINUX_TARGET,
      externals: [{ name: 'sharp', version: '0.34.4' }],
      archiveBytes: 'foreign-lock archive',
      dependencyLockInput: {
        ...baseRevision.inputs.dependencies,
        digest: digest('different dependency lock'),
      },
    });
    const revision = makeRevision([resource]);
    const build = await makeBuild(
      LINUX_TARGET,
      binaryPath,
      [resource],
      revision,
    );

    await expect(
      createArtifactProvenance({
        build,
        actorSystem: makeActorSystem(),
        revision,
        builderVersion: BUILDER_VERSION,
        artifactBytes: await readArtifactBytes(build),
      }),
    ).rejects.toThrow(/dependency lock does not match the owning revision/i);
  });

  it('rejects provenance when the SEA embedded a different function asset', async () => {
    const directory = await makeTemporaryDirectory(
      'wharfie-function-asset-mismatch-',
    );
    const binaryPath = path.join(directory, 'node');
    await fsp.writeFile(binaryPath, 'node bytes');
    const resource = makeFunctionResource({
      name: 'mismatched-asset',
      target: LINUX_TARGET,
    });
    const revision = makeRevision([resource]);
    const build = await makeBuild(
      LINUX_TARGET,
      binaryPath,
      [resource],
      revision,
    );
    resource._setUNSAFE(
      'singleExecutableAssetDigest',
      digest('different function asset'),
    );

    await expect(
      createArtifactProvenance({
        build,
        actorSystem: makeActorSystem(),
        revision,
        builderVersion: BUILDER_VERSION,
        artifactBytes: await readArtifactBytes(build),
      }),
    ).rejects.toThrow(/does not match the bytes embedded in its SEA build/i);
  });

  it('rejects revision externals that disagree with sealed function assets', async () => {
    const directory = await makeTemporaryDirectory(
      'wharfie-revision-activity-mismatch-',
    );
    const binaryPath = path.join(directory, 'node');
    await fsp.writeFile(binaryPath, 'node bytes');

    const sealedExternal = makeFunctionResource({
      name: 'external-activity',
      target: LINUX_TARGET,
      externals: [{ name: 'sharp', version: '0.34.4' }],
      archiveBytes: 'sealed external archive',
    });
    const mutatedExternalContract = makeFunctionResource({
      name: 'external-activity',
      target: LINUX_TARGET,
      externals: [{ name: 'sharp', version: '0.34.3' }],
    });
    const externalRevision = makeRevision([mutatedExternalContract]);
    const externalBuild = await makeBuild(
      LINUX_TARGET,
      binaryPath,
      [sealedExternal],
      externalRevision,
    );
    await expect(
      createArtifactProvenance({
        build: externalBuild,
        actorSystem: makeActorSystem(),
        revision: externalRevision,
        builderVersion: BUILDER_VERSION,
        artifactBytes: await readArtifactBytes(externalBuild),
      }),
    ).rejects.toThrow(
      /external packages do not match its sealed function asset and revision contract/i,
    );
  });

  it('rejects mutable external outputs that diverge from the sealed SEA receipt', async () => {
    const directory = await makeTemporaryDirectory(
      'wharfie-sealed-receipt-mutation-',
    );
    const binaryPath = path.join(directory, 'node');
    await fsp.writeFile(binaryPath, 'node bytes');
    const resource = makeFunctionResource({
      name: 'sealed-external',
      target: LINUX_TARGET,
      externals: [{ name: 'sharp', version: '0.34.4' }],
      archiveBytes: 'sealed archive bytes',
    });
    const revision = makeRevision([resource]);
    const build = await makeBuild(
      LINUX_TARGET,
      binaryPath,
      [resource],
      revision,
    );
    const artifactBytes = await readArtifactBytes(build);
    const originalLock = resource.get('externalDependencyLockInput');
    const originalClosure = resource.get('externalClosureDigest');
    const originalArchive = resource.get('externalArchiveDigest');
    const originalExternals = resource.get('external');
    const originalTarget = resource.get('buildTarget');

    resource._setUNSAFE('externalClosureDigest', digest('mutated closure'));
    await expect(
      createArtifactProvenance({
        build,
        actorSystem: makeActorSystem(),
        revision,
        builderVersion: BUILDER_VERSION,
        artifactBytes,
      }),
    ).rejects.toThrow(/closure digest does not match its sealed SEA receipt/i);

    resource._setUNSAFE('externalClosureDigest', originalClosure);
    resource._setUNSAFE('externalArchiveDigest', digest('mutated archive'));
    await expect(
      createArtifactProvenance({
        build,
        actorSystem: makeActorSystem(),
        revision,
        builderVersion: BUILDER_VERSION,
        artifactBytes,
      }),
    ).rejects.toThrow(/archive digest does not match its sealed SEA receipt/i);

    resource._setUNSAFE('externalArchiveDigest', originalArchive);
    resource._setUNSAFE('externalDependencyLockInput', {
      ...originalLock,
      digest: digest('mutated dependency lock'),
    });
    await expect(
      createArtifactProvenance({
        build,
        actorSystem: makeActorSystem(),
        revision,
        builderVersion: BUILDER_VERSION,
        artifactBytes,
      }),
    ).rejects.toThrow(/dependency lock does not match its sealed SEA receipt/i);

    resource._setUNSAFE('externalDependencyLockInput', originalLock);
    resource._setUNSAFE('external', [{ name: 'sharp', version: '0.34.3' }]);
    await expect(
      createArtifactProvenance({
        build,
        actorSystem: makeActorSystem(),
        revision,
        builderVersion: BUILDER_VERSION,
        artifactBytes,
      }),
    ).rejects.toThrow(
      /external packages do not match its sealed function asset and revision contract/i,
    );

    resource._setUNSAFE('external', originalExternals);
    resource._setUNSAFE('buildTarget', DARWIN_TARGET);
    await expect(
      createArtifactProvenance({
        build,
        actorSystem: makeActorSystem(),
        revision,
        builderVersion: BUILDER_VERSION,
        artifactBytes,
      }),
    ).rejects.toThrow(
      /reconciled build target does not match its sealed function asset/i,
    );

    resource._setUNSAFE('buildTarget', originalTarget);
    resource._setUNSAFE('functionName', 'renamed-external');
    await expect(
      createArtifactProvenance({
        build,
        actorSystem: makeActorSystem(),
        revision,
        builderVersion: BUILDER_VERSION,
        artifactBytes,
      }),
    ).rejects.toThrow(
      /functionresource dependencies, and revision contract activities do not exactly match/i,
    );
  });

  it('reports completed ad-hoc and public identity signing results', async () => {
    const directory = await makeTemporaryDirectory('wharfie-signing-');
    const binaryPath = path.join(directory, 'node');
    await fsp.writeFile(binaryPath, 'darwin node bytes');
    const nodeBinary = makeNodeBinary(DARWIN_TARGET, binaryPath);
    const revision = makeRevision();
    const build = await makeBuild(
      DARWIN_TARGET,
      binaryPath,
      [nodeBinary],
      revision,
    );
    const artifactBytes = await readArtifactBytes(build);
    const signature = new MacOSBinarySignature({
      name: 'signature',
      dependsOn: [build],
      properties: { binaryPath },
    });
    signature._setUNSAFE('signingResult', { mode: 'ad-hoc' });
    setSuccessfulGenerationSigning(build, { mode: 'ad-hoc' });

    const adHoc = await createArtifactProvenance({
      build,
      actorSystem: makeActorSystem([signature]),
      revision,
      builderVersion: BUILDER_VERSION,
      artifactBytes,
    });
    expect(adHoc.signing).toEqual({ mode: 'ad-hoc' });

    signature._setUNSAFE('signingResult', {
      mode: 'identity',
      signer:
        'Developer ID Application: Example [0123456789ABCDEF0123456789ABCDEF01234567]',
    });
    setSuccessfulGenerationSigning(build, signature.get('signingResult'));
    const identity = await createArtifactProvenance({
      build,
      actorSystem: makeActorSystem([signature]),
      revision,
      builderVersion: BUILDER_VERSION,
      artifactBytes,
    });
    expect(identity.signing).toEqual(signature.get('signingResult'));
  });
});
