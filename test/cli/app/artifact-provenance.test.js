/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createArtifactProvenance,
  createArtifactToolchainDigest,
} from '../../../src/cli/app/artifact-provenance.js';
import FunctionResource from '../../../src/core/resources/builds/function-resource.js';
import MacOSBinarySignature from '../../../src/core/resources/builds/macos-binary-signature.js';
import NodeBinary from '../../../src/core/resources/builds/node-binary.js';
import SeaBuild from '../../../src/core/resources/builds/sea-build.js';
import { createApplicationRevision } from '../../../src/core/runtime/application-revision.js';
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

function makeRevision() {
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
      activities: {
        start: {
          entrypoint: {
            kind: 'node',
            path: 'src/start.js',
            export: 'start',
          },
        },
      },
    },
    inputs: {
      source: {
        format: 'wharfie-source-tree-v1',
        digest: digest('source'),
      },
      dependencies: {
        format: 'npm-package-lock-v3',
        digest: digest('dependency-lock'),
      },
      runtime: {
        format: 'wharfie-runtime-v1',
        digest: digest('runtime'),
      },
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
 *   archiveDigest?: import('../../../src/core/runtime/application-revision.js').Sha256Digest
 * }} options
 */
function makeFunctionResource({ name, target, externals = [], archiveDigest }) {
  const resource = new FunctionResource({
    name: `${name}-${target.platform}-${target.architecture}`,
    properties: {
      functionName: name,
      entrypoint: { path: `/tmp/${name}.js`, export: 'default' },
      buildTarget: target,
      ...(externals.length ? { external: externals } : {}),
    },
  });
  if (archiveDigest) {
    resource._setUNSAFE('externalArchiveDigest', archiveDigest);
  }
  return resource;
}

/**
 * @param {import('../../../src/core/runtime/build-target.js').BuildTarget} target
 * @param {string} binaryPath
 * @param {any[]} dependencies
 */
function makeBuild(target, binaryPath, dependencies) {
  return new SeaBuild({
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
    },
  });
}

/** @param {any[]} [resources] */
function makeActorSystem(resources = []) {
  return { getResources: () => resources };
}

describe('package-time artifact provenance', () => {
  it('cross-checks an official Node receipt against exact target binary bytes', async () => {
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
    const build = makeBuild(LINUX_TARGET, binaryPath, [nodeBinary]);
    const revision = makeRevision();

    const provenance = await createArtifactProvenance({
      build,
      actorSystem: makeActorSystem(),
      revision,
      builderVersion: BUILDER_VERSION,
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
      }),
    ).rejects.toThrow(/receipt does not match the exact target binary/i);
  });

  it('hashes a local Node binary and truthfully omits absent archive evidence', async () => {
    const directory = await makeTemporaryDirectory('wharfie-local-node-');
    const binaryPath = path.join(directory, 'local-node');
    const binaryBytes = Buffer.from('locally supplied node bytes');
    await fsp.writeFile(binaryPath, binaryBytes);
    const nodeBinary = makeNodeBinary(LINUX_TARGET, binaryPath);
    const build = makeBuild(LINUX_TARGET, binaryPath, [nodeBinary]);

    const provenance = await createArtifactProvenance({
      build,
      actorSystem: makeActorSystem(),
      revision: makeRevision(),
      builderVersion: BUILDER_VERSION,
    });

    expect(provenance.node).toEqual({
      version: LINUX_TARGET.nodeVersion,
      binary: { digest: digest(binaryBytes) },
    });
    expect(provenance.node).not.toHaveProperty('archive');
    expect(provenance.signing).toEqual({ mode: 'unsigned' });
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
    jest.spyOn(resource, 'esbuild').mockResolvedValue('activity code');
    jest
      .spyOn(resource, 'bundleExternals')
      .mockResolvedValue(externalArchive.toString('base64'));

    await resource._reconcile();

    expect(resource.get('externalArchiveDigest')).toEqual(
      digest(externalArchive),
    );
    const embedded = JSON.parse(
      await fsp.readFile(resource.get('singleExecutableAssetPath'), 'utf8'),
    );
    expect(Buffer.from(embedded.externalsTar, 'base64')).toEqual(
      externalArchive,
    );
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
      .mockResolvedValue(/** @type {any} */ (undefined));

    await resource._reconcile();

    expect(resource.get('externalArchiveDigest')).toEqual(
      digest(Buffer.alloc(0)),
    );
    const embedded = JSON.parse(
      await fsp.readFile(resource.get('singleExecutableAssetPath'), 'utf8'),
    );
    expect(embedded.externalsTar).toBe('');
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
      archiveDigest: digest('sharp target archive'),
    });
    const database = makeFunctionResource({
      name: 'database',
      target: LINUX_TARGET,
      externals: [{ name: 'lmdb', version: '3.4.2' }],
      archiveDigest: digest('lmdb target archive'),
    });
    const revision = makeRevision();
    const first = await createArtifactProvenance({
      build: makeBuild(LINUX_TARGET, binaryPath, [nodeBinary, image, database]),
      actorSystem: makeActorSystem(),
      revision,
      builderVersion: BUILDER_VERSION,
    });
    const second = await createArtifactProvenance({
      build: makeBuild(LINUX_TARGET, binaryPath, [database, nodeBinary, image]),
      actorSystem: makeActorSystem(),
      revision,
      builderVersion: BUILDER_VERSION,
    });
    expect(second.dependencies.digest).toEqual(first.dependencies.digest);

    const unreconciled = makeFunctionResource({
      name: 'unreconciled',
      target: LINUX_TARGET,
      externals: [{ name: 'sharp', version: '0.34.4' }],
    });
    await expect(
      createArtifactProvenance({
        build: makeBuild(LINUX_TARGET, binaryPath, [nodeBinary, unreconciled]),
        actorSystem: makeActorSystem(),
        revision,
        builderVersion: BUILDER_VERSION,
      }),
    ).rejects.toThrow(/no reconciled external archive digest/i);
  });

  it('reports completed ad-hoc and public identity signing results', async () => {
    const directory = await makeTemporaryDirectory('wharfie-signing-');
    const binaryPath = path.join(directory, 'node');
    await fsp.writeFile(binaryPath, 'darwin node bytes');
    const nodeBinary = makeNodeBinary(DARWIN_TARGET, binaryPath);
    const build = makeBuild(DARWIN_TARGET, binaryPath, [nodeBinary]);
    const signature = new MacOSBinarySignature({
      name: 'signature',
      dependsOn: [build],
      properties: { binaryPath },
    });
    signature._setUNSAFE('signingResult', { mode: 'ad-hoc' });
    const revision = makeRevision();

    const adHoc = await createArtifactProvenance({
      build,
      actorSystem: makeActorSystem([signature]),
      revision,
      builderVersion: BUILDER_VERSION,
    });
    expect(adHoc.signing).toEqual({ mode: 'ad-hoc' });

    signature._setUNSAFE('signingResult', {
      mode: 'identity',
      signer:
        'Developer ID Application: Example [0123456789ABCDEF0123456789ABCDEF01234567]',
    });
    const identity = await createArtifactProvenance({
      build,
      actorSystem: makeActorSystem([signature]),
      revision,
      builderVersion: BUILDER_VERSION,
    });
    expect(identity.signing).toEqual(signature.get('signingResult'));
  });
});
