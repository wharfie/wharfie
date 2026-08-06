/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { packageLocalApp } from '../../../src/cli/app/local-app.js';
import { createApplicationPackageReceipt } from '../../../src/cli/app/package-command-receipt.js';
import { createPackageCommand } from '../../../src/cli/cmds/app_cmds/package.js';
import {
  APP_MANIFEST_ASSET_NAME,
  APP_MANIFEST_ASSET_PREFIX,
} from '../../../src/core/resources/builds/lib/app-manifest-asset.js';
import {
  APPLICATION_REVISION_ASSET_NAME,
  ARTIFACT_RUNTIME_ASSET_NAME,
  validateEmbeddedRevisionRuntimePair,
} from '../../../src/core/resources/builds/lib/revision-runtime-assets.js';
import {
  CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME,
  CORE_RUNTIME_DEPENDENCY_ACTIVITY,
  CORE_RUNTIME_DEPENDENCY_ASSET_KIND,
  CORE_RUNTIME_DEPENDENCY_ASSET_SCHEMA_VERSION,
  CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME,
  CORE_RUNTIME_DEPENDENCY_PURPOSE,
  CORE_RUNTIME_DEPENDENCY_ROOT,
  stringifyCoreRuntimeDependencyManifest,
} from '../../../src/core/resources/builds/lib/core-runtime-dependency-asset.js';
import { digestFrozenDependencyClosurePlan } from '../../../src/core/resources/builds/lib/frozen-dependency-closure-plan.js';
import {
  SINGLE_NODE_DEPLOYMENT_PAYLOAD_MANIFEST_ASSET_NAME,
  SINGLE_NODE_DEPLOYMENT_PAYLOAD_SEA_ASSET_NAME,
} from '../../../src/core/runtime/single-node-deployment-payload.js';
import ActorSystem from '../../../src/core/resources/builds/actor-system.js';
import CoreRuntimeDependenciesResource from '../../../src/core/resources/builds/core-runtime-dependencies.js';
import FunctionResource from '../../../src/core/resources/builds/function-resource.js';
import MacOSBinarySignature from '../../../src/core/resources/builds/macos-binary-signature.js';
import NodeBinary from '../../../src/core/resources/builds/node-binary.js';
import SeaBuild from '../../../src/core/resources/builds/sea-build.js';
import ambientActorStateStore from '../../../src/core/lib/db/state/store.js';
import { sortCanonicalJsonValue } from '../../../src/core/runtime/canonical-order.js';
import {
  cleanupIsolatedAuthoredAppFixtures,
  createIsolatedAuthoredAppFixture,
} from '../../helpers/isolated-authored-app.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const authoredHelloWorldDir = path.join(
  repoRoot,
  'scratch',
  'examples',
  'apps',
  'hello-world',
);
const currentTarget = {
  nodeVersion: process.versions.node,
  platform: process.platform,
  architecture: process.arch,
  ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
};
const actorSystemUrl = new URL(
  '../../../src/core/resources/builds/actor-system.js',
  import.meta.url,
).href;
const localAppUrl = new URL(
  '../../../src/cli/app/local-app.js',
  import.meta.url,
).href;
const mismatchedNodeVersion =
  process.versions.node === '0.0.0' ? '0.0.1' : '0.0.0';
/** @type {Array<ReturnType<typeof createIsolatedAuthoredAppFixture>>} */
const authoredAppFixtures = [];

/** @returns {string} - Fresh copy of the tracked authored application. */
function createHelloWorldDirectory() {
  const fixture = createIsolatedAuthoredAppFixture(authoredHelloWorldDir, {
    prefix: 'wharfie-package-app-',
  });
  authoredAppFixtures.push(fixture);
  return fixture.appDir;
}

/**
 * @param {{ nodeVersion: string, platform: string, architecture: string, libc?: string }} target - target.
 * @returns {string} - Result.
 */
function getTargetSelector(target) {
  return `node${target.nodeVersion}-${target.platform}-${target.architecture}${
    target.libc ? `-${target.libc}` : ''
  }`;
}

/**
 * @param {string} dir - App directory.
 * @param {string} appName - App name.
 * @param {{ nodeVersion: string, platform: string, architecture: string, libc?: string }[]} targets - Build targets.
 * @param {string} [modulePreamble] - Optional authored module preamble.
 */
async function writeTransactionalPackageApp(
  dir,
  appName,
  targets,
  modulePreamble = '',
) {
  const canonicalTargets = targets.map((target) =>
    target.platform === 'linux' && !target.libc
      ? { ...target, libc: 'glibc' }
      : target,
  );
  await fsp.mkdir(path.join(dir, 'src'), { recursive: true });
  await Promise.all([
    fsp.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: appName, private: true, type: 'module' }),
      'utf8',
    ),
    fsp.writeFile(
      path.join(dir, 'src', 'cli.js'),
      'export default async function cli() {}\n',
      'utf8',
    ),
    fsp.writeFile(
      path.join(dir, 'wharfie.app.js'),
      `${modulePreamble}export default {
  schemaVersion: 4,
  app: { id: ${JSON.stringify(appName)} },
  cli: {
    entrypoint: { kind: 'node', path: './src/cli.js', export: 'default' },
  },
  targets: ${JSON.stringify(canonicalTargets, null, 2)},
};
`,
      'utf8',
    ),
  ]);
}

/**
 * @param {string} dir - App directory.
 * @param {string} appName - App name.
 */
async function writeTargetlessPackageApp(dir, appName) {
  await fsp.mkdir(path.join(dir, 'src'), { recursive: true });
  await Promise.all([
    fsp.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: appName, private: true, type: 'module' }),
      'utf8',
    ),
    fsp.writeFile(
      path.join(dir, 'src', 'cli.js'),
      'export default async function cli() {}\n',
      'utf8',
    ),
    fsp.writeFile(
      path.join(dir, 'wharfie.app.js'),
      `export default {
  schemaVersion: 4,
  app: { id: ${JSON.stringify(appName)} },
  cli: {
    entrypoint: { kind: 'node', path: './src/cli.js', export: 'default' },
  },
};
`,
      'utf8',
    ),
  ]);
}

/**
 * @param {string[]} chunks - Captured UTF-8 output.
 * @returns {typeof process.stdout.write} - Stream write replacement.
 */
function captureStreamWrites(chunks) {
  return /** @type {typeof process.stdout.write} */ (
    function write(chunk, encoding, callback) {
      const resolvedEncoding =
        typeof encoding === 'string' && Buffer.isEncoding(encoding)
          ? encoding
          : undefined;
      chunks.push(
        typeof chunk === 'string'
          ? chunk
          : Buffer.from(chunk).toString(resolvedEncoding),
      );
      const resolvedCallback =
        typeof encoding === 'function' ? encoding : callback;
      if (typeof resolvedCallback === 'function') resolvedCallback();
      return true;
    }
  );
}

/**
 * @param {string} appName - App name.
 * @param {string | Buffer} contents - Exact artifact bytes.
 * @param {{ platform: string }} target - Build target.
 * @returns {string} - Artifact file name.
 */
function getArtifactFileName(appName, contents, target) {
  const digest = createHash('sha256').update(contents).digest('hex');
  return `${appName}-sha256-${digest}${
    target.platform === 'win32' ? '.exe' : ''
  }`;
}

/**
 * @param {string | Buffer | Uint8Array} contents - Exact bytes.
 */
function getSha256Digest(contents) {
  return {
    algorithm: /** @type {'sha256'} */ ('sha256'),
    value: createHash('sha256').update(contents).digest('base64url'),
  };
}

/**
 * Supply the reconciled, non-secret inputs normally produced by NodeBinary and
 * MacOSBinarySignature when a package test replaces the actor reconcile loop.
 * @param {ActorSystem} actorSystem - Mocked actor system.
 * @param {string} buildDir - Private fake-build directory.
 */
async function prepareMockArtifactProvenance(actorSystem, buildDir) {
  await fsp.mkdir(buildDir, { recursive: true });

  for (const resource of actorSystem.getResources()) {
    if (resource instanceof NodeBinary) {
      const version = String(resource.get('version')).replace(/^v/, '');
      if (!resource.has('exactVersion')) {
        resource._setUNSAFE('exactVersion', `v${version}`);
      }
      if (!resource.has('binaryPath')) {
        const nodePath = path.join(buildDir, `${resource.name}.node`);
        await fsp.writeFile(nodePath, `mock node ${resource.name}\n`, 'utf8');
        resource._setUNSAFE('binaryPath', nodePath);
      }
    }

    if (resource instanceof MacOSBinarySignature) {
      resource._setUNSAFE('signingResult', { mode: 'ad-hoc' });
    }
  }

  for (const resource of actorSystem.getResources()) {
    if (resource instanceof FunctionResource) {
      await resource._reconcile();
    }
  }

  let coreResourceIndex = 0;
  for (const resource of actorSystem.getResources()) {
    if (!(resource instanceof CoreRuntimeDependenciesResource)) continue;
    const target = resource.get('buildTarget');
    const assetDirectory = path.join(
      buildDir,
      `core-runtime-dependencies-${coreResourceIndex}`,
    );
    coreResourceIndex += 1;
    await fsp.mkdir(assetDirectory, { recursive: true, mode: 0o700 });
    const archiveBytes = Buffer.from(
      `mock core runtime archive ${JSON.stringify(target)}`,
      'utf8',
    );
    const archiveDigest = getSha256Digest(archiveBytes);
    const dependencyLockInput = {
      format: 'wharfie-npm-package-lock-v3-closure-v1',
      digest: getSha256Digest('mock core dependency lock'),
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
    const manifestBytes = Buffer.from(
      `${stringifyCoreRuntimeDependencyManifest(receipt)}\n`,
      'utf8',
    );
    const manifestPath = path.join(assetDirectory, 'manifest.json');
    const archivePath = path.join(assetDirectory, 'core-lmdb.tgz');
    await Promise.all([
      fsp.writeFile(manifestPath, manifestBytes, { mode: 0o400 }),
      fsp.writeFile(archivePath, archiveBytes, { mode: 0o400 }),
    ]);
    resource._setUNSAFE('assets', {
      [CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME]: manifestPath,
      [CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME]: archivePath,
    });
    resource._setUNSAFE('assetDigests', {
      [CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME]:
        getSha256Digest(manifestBytes),
      [CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME]: archiveDigest,
    });
    resource._setUNSAFE('receipt', receipt);
    resource._setUNSAFE('assetDirectory', assetDirectory);
  }

  for (const resource of actorSystem.getResources()) {
    if (!(resource instanceof SeaBuild)) continue;
    const entryCode = String(resource.get('entryCode'));
    const sealedAssetsDir = await fsp.mkdtemp(
      path.join(buildDir, 'sealed-assets-'),
    );
    const preparedAssets =
      await resource._prepareSeaAssetsWithEvidence(sealedAssetsDir);
    const nodeSourcePath = String(resource.get('nodeBinaryPath'));
    const nodeSourceBytes = await fsp.readFile(nodeSourcePath);
    const signingResource = actorSystem
      .getResources()
      .find(
        (candidate) =>
          candidate instanceof MacOSBinarySignature &&
          Array.isArray(candidate.dependsOn) &&
          candidate.dependsOn.includes(resource),
      );
    const signing = signingResource
      ? signingResource.get('signingResult')
      : { mode: 'unsigned' };

    jest
      .spyOn(resource, 'getSuccessfulBuildEvidence')
      .mockImplementation((artifactBytes) => ({
        binaryPath: String(resource.get('binaryPath')),
        binaryDigest: getSha256Digest(artifactBytes),
        entryCode: {
          digest: getSha256Digest(Buffer.from(entryCode, 'utf8')),
          size: Buffer.byteLength(entryCode, 'utf8'),
        },
        codeBundle: {
          digest: getSha256Digest(Buffer.from(entryCode, 'utf8')),
          size: Buffer.byteLength(entryCode, 'utf8'),
        },
        seaBlob: {
          digest: getSha256Digest(artifactBytes),
          size: artifactBytes.byteLength,
        },
        nodeSource: {
          path: nodeSourcePath,
          digest: getSha256Digest(nodeSourceBytes),
          size: nodeSourceBytes.length,
          archive: null,
        },
        assets: preparedAssets.assetEvidence,
        functionAssets: preparedAssets.functionAssetEvidence,
        coreRuntimeDependencies: preparedAssets.coreRuntimeDependencyEvidence,
        signing,
      }));
  }
}

afterEach(() => {
  jest.restoreAllMocks();
  cleanupIsolatedAuthoredAppFixtures(authoredAppFixtures);
});

describe('packageLocalApp', () => {
  it('rejects an invalid internal AWS provider policy before package preparation', async () => {
    await expect(
      packageLocalApp(
        /** @type {any} */ ({
          dir: '/provider-policy-must-not-be-read',
          awsProviderEmbeddingPolicy: 'ambient',
        }),
      ),
    ).rejects.toThrow('AWS provider embedding policy is invalid.');
  });

  it('isolates package reconciliation from ambient actor state', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-package-state-isolation-'),
    );
    const outputDir = path.join(dir, 'dist');
    const ambientStateAccess = new Error(
      'package reconciliation accessed ambient actor state',
    );
    const ambientStateSpies = [
      jest
        .spyOn(ambientActorStateStore, 'putResource')
        .mockRejectedValue(ambientStateAccess),
      jest
        .spyOn(ambientActorStateStore, 'putResourceStatus')
        .mockRejectedValue(ambientStateAccess),
      jest
        .spyOn(ambientActorStateStore, 'getResource')
        .mockRejectedValue(ambientStateAccess),
      jest
        .spyOn(ambientActorStateStore, 'getResourceStatus')
        .mockRejectedValue(ambientStateAccess),
      jest
        .spyOn(ambientActorStateStore, 'getResources')
        .mockRejectedValue(ambientStateAccess),
      jest
        .spyOn(ambientActorStateStore, 'deleteResource')
        .mockRejectedValue(ambientStateAccess),
    ];

    try {
      await writeTransactionalPackageApp(dir, 'package-state-isolation', [
        currentTarget,
      ]);
      jest.spyOn(ActorSystem.prototype, 'reconcile').mockImplementation(
        /** @this {ActorSystem} */ async function () {
          const packageStateStore = this.getStateDB();
          expect(packageStateStore).not.toBe(ambientActorStateStore);
          await packageStateStore.putResource(this);
          await packageStateStore.putResourceStatus(this);
          expect(await packageStateStore.getResource(this)).toBeUndefined();
          expect(
            await packageStateStore.getResourceStatus(this),
          ).toBeUndefined();
          expect(
            await packageStateStore.getResources(this.getName(), 'SeaBuild'),
          ).toEqual([]);
          await packageStateStore.deleteResource(this);

          const buildDir = path.join(dir, '.fake-builds');
          await prepareMockArtifactProvenance(this, buildDir);
          for (const resource of this.getResources()) {
            expect(resource.getStateDB()).toBe(packageStateStore);
            if (!(resource instanceof SeaBuild)) continue;
            const binaryPath = path.join(buildDir, resource.name);
            await fsp.writeFile(binaryPath, 'isolated package bytes', 'utf8');
            resource._setUNSAFE('binaryPath', binaryPath);
          }
        },
      );

      const result = await packageLocalApp({ dir, outputDir });

      expect(result.artifacts).toHaveLength(1);
      expect(existsSync(result.artifacts[0].path)).toBe(true);
      for (const spy of ambientStateSpies) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('infers one exact host target when a manifest omits targets', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-host-target-package-'),
    );
    const outputDir = path.join(dir, 'dist');
    /** @type {Array<{phase: string, message: string}>} */
    const progress = [];
    /** @type {string[]} */
    const observedProviderPolicies = [];

    try {
      await writeTargetlessPackageApp(dir, 'host-target-package');
      jest.spyOn(ActorSystem.prototype, 'reconcile').mockImplementation(
        /** @this {ActorSystem} */ async function () {
          const buildDir = path.join(dir, '.fake-builds');
          const nodeBinary = this.getResources().find(
            (resource) => resource instanceof NodeBinary,
          );
          const downloadProgress = nodeBinary?.onDownloadProgress;
          expect(downloadProgress).toEqual(expect.any(Function));
          if (typeof downloadProgress !== 'function') {
            throw new Error('Node download progress observer was not wired.');
          }
          downloadProgress({
            version: `v${process.versions.node}`,
            downloadedBytes: 1024 * 1024,
            totalBytes: 2 * 1024 * 1024,
          });
          await prepareMockArtifactProvenance(this, buildDir);

          const builds = this.getResources().filter(
            (resource) => resource instanceof SeaBuild,
          );
          expect(builds).toHaveLength(1);
          for (const resource of builds) {
            observedProviderPolicies.push(
              resource.get('awsProviderEmbeddingPolicy'),
            );
            const target = {
              nodeVersion: String(resource.get('nodeVersion')),
              platform: String(resource.get('platform')),
              architecture: String(resource.get('architecture')),
              ...(resource.has('libc')
                ? { libc: String(resource.get('libc')) }
                : {}),
            };
            expect(target).toEqual(currentTarget);
            const binaryPath = path.join(buildDir, resource.name);
            await fsp.writeFile(binaryPath, 'host target bytes', 'utf8');
            resource._setUNSAFE('binaryPath', binaryPath);
          }
        },
      );

      const result = await packageLocalApp({
        dir,
        outputDir,
        onProgress: (event) => progress.push(event),
      });

      expect(result.targets).toEqual([currentTarget]);
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0].target).toEqual(currentTarget);
      expect(result.revision.contract).not.toHaveProperty('targets');
      expect(progress.map((event) => event.phase)).toEqual([
        'resolve',
        'prepare',
        'build',
        'download',
        'publish',
      ]);
      expect(progress[3].message).toBe(
        `Downloading Node v${process.versions.node} (1.0/2.0 MiB)`,
      );

      progress.length = 0;
      const overridden = await packageLocalApp({
        dir,
        outputDir: path.join(dir, 'override-dist'),
        targetOverrides: [currentTarget],
        awsProviderEmbeddingPolicy: 'embed-if-available',
        onProgress: (event) => progress.push(event),
      });
      expect(overridden.targets).toEqual([currentTarget]);
      expect(overridden.artifacts).toHaveLength(1);
      expect(observedProviderPolicies).toEqual([
        'provider-free',
        'embed-if-available',
      ]);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps internal exact target overrides closed from public target filters', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-package-target-overrides-'),
    );

    try {
      await writeTargetlessPackageApp(dir, 'target-override-boundary');
      await expect(
        packageLocalApp({ dir, targetOverrides: [] }),
      ).rejects.toThrow(/targetOverrides must be a nonempty array/);
      await expect(
        packageLocalApp({
          dir,
          targetOverrides: [currentTarget],
          targetFilters: [getTargetSelector(currentTarget)],
        }),
      ).rejects.toThrow(/cannot be combined with targetFilters/);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('requires declared targets when a public target filter is supplied', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-targetless-filter-package-'),
    );

    try {
      await writeTargetlessPackageApp(dir, 'targetless-filter-package');
      await expect(
        packageLocalApp({
          dir,
          targetFilters: [getTargetSelector(currentTarget)],
        }),
      ).rejects.toThrow(/no declared build targets/i);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects targetless Linux packaging on an unknown libc before builds start', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-targetless-unknown-libc-package-'),
    );
    const platformDescriptor = Object.getOwnPropertyDescriptor(
      process,
      'platform',
    );
    const reconcile = jest.spyOn(ActorSystem.prototype, 'reconcile');
    jest
      .spyOn(process.report, 'getReport')
      .mockReturnValue(/** @type {any} */ ({ header: {} }));
    Object.defineProperty(process, 'platform', {
      ...platformDescriptor,
      value: 'linux',
    });

    try {
      await writeTargetlessPackageApp(dir, 'targetless-unknown-libc-package');
      await expect(packageLocalApp({ dir })).rejects.toThrow(
        /positively identified glibc.*musl.*unknown/i,
      );
      expect(reconcile).not.toHaveBeenCalled();
    } finally {
      if (platformDescriptor) {
        Object.defineProperty(process, 'platform', platformDescriptor);
      }
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('reserves command stdout for one receipt while authored setup writes diagnostics', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-package-command-stdout-'),
    );
    const outputDir = path.join(dir, 'dist');
    const sentinel = 'authored-package-stdout-sentinel';
    /** @type {string[]} */
    const stdoutChunks = [];
    /** @type {string[]} */
    const stderrChunks = [];
    const previousExitCode = process.exitCode;

    try {
      await writeTransactionalPackageApp(
        dir,
        'package-stdout-demo',
        [currentTarget],
        `process.stdout.write(${JSON.stringify(`${sentinel}\n`)});\n`,
      );
      jest.spyOn(ActorSystem.prototype, 'reconcile').mockImplementation(
        /** @this {ActorSystem} */ async function () {
          const buildDir = path.join(dir, '.fake-builds');
          await prepareMockArtifactProvenance(this, buildDir);

          for (const resource of this.getResources()) {
            if (!(resource instanceof SeaBuild)) continue;
            const target = {
              nodeVersion: String(resource.get('nodeVersion')),
              platform: String(resource.get('platform')),
              architecture: String(resource.get('architecture')),
              ...(resource.has('libc')
                ? { libc: String(resource.get('libc')) }
                : {}),
            };
            const binaryPath = path.join(
              buildDir,
              `stdout-${getTargetSelector(target)}`,
            );
            await fsp.writeFile(binaryPath, 'package command bytes', 'utf8');
            resource._setUNSAFE('binaryPath', binaryPath);
          }
        },
      );
      const stdoutWrite = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(captureStreamWrites(stdoutChunks));
      const stderrWrite = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(
          /** @type {typeof process.stderr.write} */ (
            captureStreamWrites(stderrChunks)
          ),
        );
      process.exitCode = undefined;

      try {
        await createPackageCommand().parseAsync(
          [dir, '--output-dir', outputDir, '--json', '--no-pretty'],
          { from: 'user' },
        );
      } finally {
        stdoutWrite.mockRestore();
        stderrWrite.mockRestore();
      }

      expect(process.exitCode).toBeUndefined();
      expect(stdoutChunks).toHaveLength(1);
      expect(stdoutChunks[0]).not.toContain(sentinel);
      expect(JSON.parse(stdoutChunks[0])).toMatchObject({
        schemaVersion: 1,
        kind: 'wharfie.application.package',
        appId: 'package-stdout-demo',
        outputDir,
        artifactCount: 1,
      });
      expect(stderrChunks.join('')).toContain(sentinel);
    } finally {
      process.exitCode = previousExitCode;
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects computed transitive module specifiers before packaging', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-computed-module-package-'),
    );
    const outputDir = path.join(dir, 'dist');

    try {
      await writeTransactionalPackageApp(dir, 'computed-module-package-demo', [
        currentTarget,
      ]);
      await Promise.all([
        fsp.writeFile(
          path.join(dir, 'src', 'cli.js'),
          "export { default } from './transitive.js';\n",
          'utf8',
        ),
        fsp.writeFile(
          path.join(dir, 'src', 'transitive.js'),
          "const modulePath = './dependency.js';\nexport default async function cli() { return import(modulePath); }\n",
          'utf8',
        ),
        fsp.writeFile(
          path.join(dir, 'src', 'dependency.js'),
          'export const value = "sealed";\n',
          'utf8',
        ),
      ]);

      await expect(packageLocalApp({ dir, outputDir })).rejects.toThrow(
        /src\/transitive\.js:2:\d+.*runtime-computed import\(\) module specifier/i,
      );
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('packages a plain-object v4 app with workflows into embedded assets', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-plain-object-package-'),
    );
    const outputDir = path.join(dir, 'dist-output');
    /** @type {string | undefined} */
    let temporaryManifestPath;
    /** @type {string[]} */
    const temporaryRevisionRuntimePaths = [];
    const expectedWorkflows = {
      'greet-later': {
        steps: [
          {
            id: 'greet',
            kind: 'activity',
            activity: 'hello',
            input: { kind: 'workflow-input' },
          },
          { id: 'pause', kind: 'timer', delayMs: 1_000 },
          { id: 'approved', kind: 'signal' },
          {
            id: 'greet-again',
            kind: 'activity',
            activity: 'hello',
            input: { kind: 'step-output', step: 'approved' },
          },
        ],
      },
    };
    const expectedSchedules = {
      scheduled: {
        cron: '0 0 * * *',
        workflow: 'greet-later',
        input: {},
        missed: 'latest',
        overlap: 'allow',
      },
    };

    try {
      await fsp.mkdir(path.join(dir, 'src', 'activities'), { recursive: true });
      await Promise.all([
        fsp.writeFile(
          path.join(dir, 'package.json'),
          JSON.stringify({
            name: 'plain-object-package-demo',
            private: true,
            type: 'module',
          }),
          'utf8',
        ),
        fsp.writeFile(
          path.join(dir, 'src', 'cli.js'),
          `export async function launch(argv = process.argv) {\n  return argv;\n}\n`,
          'utf8',
        ),
        fsp.writeFile(
          path.join(dir, 'src', 'activities', 'hello.js'),
          `export async function hello(event = {}) {\n  return { ok: true, event };\n}\n\nexport default hello;\n`,
          'utf8',
        ),
        fsp.writeFile(
          path.join(dir, 'wharfie.app.js'),
          `export default {
  schemaVersion: 4,
  app: { id: 'plain-object-package-demo' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './src/cli.js',
      export: 'launch',
    },
  },
  targets: [
    {
      nodeVersion: process.versions.node,
      platform: process.platform,
      architecture: process.arch,
      ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
    },
  ],
  activities: {
    hello: {
      entrypoint: {
        kind: 'node',
        path: './src/activities/hello.js',
        export: 'hello',
      },
    },
  },
  workflows: ${JSON.stringify(expectedWorkflows, null, 2)},
  schedules: ${JSON.stringify(expectedSchedules, null, 2)},
};
`,
          'utf8',
        ),
      ]);

      jest
        .spyOn(ActorSystem.prototype, 'initializeEnvironment')
        .mockImplementation(
          /** @this {ActorSystem} */ async function () {
            const snapshottedCli = this.get('cli');
            expect(snapshottedCli).toEqual({
              entrypoint: expect.stringMatching(
                /\.wharfie[/\\]revision-snapshots[/\\]revision-[^/\\]+[/\\]app[/\\]src[/\\]cli\.js$/,
              ),
              export: 'launch',
            });
            expect(snapshottedCli.entrypoint).not.toBe(
              path.join(dir, 'src', 'cli.js'),
            );
            expect(this.getMacOSSigningCredentials()).toEqual({
              certificateBase64: 'certificate-data',
              certificatePassword: 'certificate-password',
              keychainPassword: 'keychain-password',
            });
            expect(this.has('macosCertBase64')).toBe(false);
            expect(this.has('macosCertPassword')).toBe(false);
            expect(this.has('macosKeychainPassword')).toBe(false);

            const serialized = JSON.stringify(this.serialize());
            expect(serialized).not.toContain('certificate-data');
            expect(serialized).not.toContain('certificate-password');
            expect(serialized).not.toContain('keychain-password');

            const seaBuild = this.getResources().find(
              (resource) => resource instanceof SeaBuild,
            );
            if (!seaBuild) {
              throw new Error('Expected a SEA build resource');
            }
            const entryCode = String(seaBuild.get('entryCode'));
            expect(entryCode).toContain('cliExportName: "launch"');
            expect(entryCode).toContain('ledger-service-command.js');
            expect(entryCode).toContain("'ledger-service': ledgerServiceCmd");
            expect(entryCode).toContain('const loadDeveloperCliModule = () =>');
            expect(entryCode).toContain('loadDeveloperCliModule,');
            expect(entryCode).not.toContain('await loadDeveloperCliModule()');
            expect(entryCode).toContain(
              'prepareRuntime: preparePackagedCoreRuntimeDependencies',
            );
            expect(entryCode).not.toContain(
              'await preparePackagedCoreRuntimeDependencies()',
            );
            expect(entryCode).toContain(
              'const packagedAppStorage = await resolvePackagedAppStorage()',
            );
            expect(entryCode).toContain(
              'await withLocalAppStorageLayout(packagedAppStorage',
            );
            expect(
              entryCode.indexOf('await resolvePackagedAppStorage()'),
            ).toBeLessThan(entryCode.indexOf('await runPackagedApp({'));
            expect(entryCode).not.toContain('state_cmds');
            expect(entryCode).not.toContain("'serve-lambda':");
            expect(entryCode).not.toContain("'serve-queue':");
            expect(entryCode).not.toContain("'serve-db':");
            expect(entryCode).not.toContain('start: startCmd');
            expect(entryCode).not.toContain("console.time('overall')");
            expect(entryCode).not.toContain("console.timeEnd('overall')");

            for (const resource of this.getResources()) {
              if (resource instanceof NodeBinary) {
                resource._setUNSAFE(
                  'exactVersion',
                  `v${process.versions.node}`,
                );
                resource._setUNSAFE('binaryPath', process.execPath);
              }
            }
          },
        );
      jest.spyOn(ActorSystem.prototype, 'reconcile').mockImplementation(
        /** @this {ActorSystem} */ async function () {
          const buildDir = path.join(dir, '.wharfie', 'mock-builds');
          await prepareMockArtifactProvenance(this, buildDir);

          for (const resource of this.getResources()) {
            if (resource instanceof SeaBuild) {
              const assets = resource.get('assets', {});
              const manifestAssetPath = assets[APP_MANIFEST_ASSET_NAME];
              const revisionAssetPath = assets[APPLICATION_REVISION_ASSET_NAME];
              const runtimeAssetPath = assets[ARTIFACT_RUNTIME_ASSET_NAME];
              temporaryManifestPath = manifestAssetPath;
              temporaryRevisionRuntimePaths.push(
                revisionAssetPath,
                runtimeAssetPath,
              );
              expect((await fsp.stat(manifestAssetPath)).mode & 0o777).toBe(
                0o600,
              );
              expect((await fsp.stat(revisionAssetPath)).mode & 0o777).toBe(
                0o600,
              );
              expect((await fsp.stat(runtimeAssetPath)).mode & 0o777).toBe(
                0o600,
              );
              const embeddedManifest = JSON.parse(
                await fsp.readFile(manifestAssetPath, 'utf8'),
              );
              expect(embeddedManifest.cli).toEqual({
                entrypoint: {
                  kind: 'node',
                  path: 'src/cli.js',
                  export: 'launch',
                },
              });
              expect(embeddedManifest.activities.hello.entrypoint).toEqual({
                kind: 'node',
                path: 'src/activities/hello.js',
                export: 'hello',
              });
              expect(embeddedManifest.workflows).toEqual(expectedWorkflows);
              expect(embeddedManifest.schedules).toEqual(expectedSchedules);
              const embeddedManifestJson = JSON.stringify(embeddedManifest);
              expect(embeddedManifestJson).not.toContain(
                path.join(dir, 'src', 'cli.js'),
              );
              expect(embeddedManifestJson).not.toContain(
                path.join(dir, 'src', 'activities', 'hello.js'),
              );
              expect(embeddedManifestJson).not.toContain('certificate-data');
              expect(embeddedManifestJson).not.toContain(
                'certificate-password',
              );
              expect(embeddedManifestJson).not.toContain('keychain-password');

              const target = {
                nodeVersion: String(resource.get('nodeVersion')),
                platform: String(resource.get('platform')),
                architecture: String(resource.get('architecture')),
                ...(resource.has('libc')
                  ? { libc: String(resource.get('libc')) }
                  : {}),
              };
              const selector = getTargetSelector(target);
              const fakeBinaryPath = path.join(buildDir, selector);
              const embeddedRevisionRuntime =
                validateEmbeddedRevisionRuntimePair(
                  JSON.parse(await fsp.readFile(revisionAssetPath, 'utf8')),
                  JSON.parse(await fsp.readFile(runtimeAssetPath, 'utf8')),
                );
              expect(
                embeddedRevisionRuntime.revision.contract,
              ).not.toHaveProperty('targets');
              expect(
                embeddedRevisionRuntime.revision.contract.workflows,
              ).toEqual(expectedWorkflows);
              expect(
                embeddedRevisionRuntime.revision.contract.schedules,
              ).toEqual(expectedSchedules);
              expect(embeddedRevisionRuntime.runtime.target).toEqual(target);

              await fsp.writeFile(
                fakeBinaryPath,
                `#!/bin/sh\necho ${selector}\n`,
                'utf8',
              );
              resource._setUNSAFE('binaryPath', fakeBinaryPath);
            }
          }
        },
      );

      const result = await packageLocalApp({
        dir,
        outputDir,
        build: {
          signing: {
            macos: {
              certificateBase64: 'certificate-data',
              certificatePassword: 'certificate-password',
              keychainPassword: 'keychain-password',
            },
          },
        },
      });

      expect(result.app).toEqual({ id: 'plain-object-package-demo' });
      expect(result.revision.contract.workflows).toEqual(expectedWorkflows);
      expect(result.revision.contract.schedules).toEqual(expectedSchedules);
      expect(result.targets).toEqual([currentTarget]);
      expect(result.artifacts).toHaveLength(1);
      const artifactContents = `#!/bin/sh\necho ${getTargetSelector(currentTarget)}\n`;
      expect(result.artifacts[0]).toEqual(
        expect.objectContaining({
          fileName: getArtifactFileName(
            'plain-object-package-demo',
            artifactContents,
            currentTarget,
          ),
          target: currentTarget,
          artifactId: expect.stringMatching(/^waf1_[A-Za-z0-9_-]{43}$/),
          revisionId: result.revision.revisionId,
          size: Buffer.byteLength(artifactContents),
        }),
      );
      expect(result.revision.revisionId).toMatch(/^wrv1_[A-Za-z0-9_-]{43}$/);
      expect(result.artifacts[0].record).toEqual(
        expect.objectContaining({
          artifactId: result.artifacts[0].artifactId,
          revisionId: result.revision.revisionId,
          byteDigest: result.artifacts[0].byteDigest,
          size: result.artifacts[0].size,
        }),
      );
      expect(createApplicationPackageReceipt(result)).toEqual({
        schemaVersion: 1,
        kind: 'wharfie.application.package',
        appId: 'plain-object-package-demo',
        revisionId: result.revision.revisionId,
        outputDir,
        artifactCount: 1,
        artifacts: [
          {
            artifactId: result.artifacts[0].artifactId,
            target: currentTarget,
            fileName: result.artifacts[0].fileName,
            path: result.artifacts[0].path,
            recordPath: result.artifacts[0].recordPath,
            byteDigest: result.artifacts[0].byteDigest,
            size: result.artifacts[0].size,
          },
        ],
      });
      expect(existsSync(result.artifacts[0].path)).toBe(true);
      expect(existsSync(result.artifacts[0].recordPath)).toBe(true);
      await expect(
        fsp.readFile(result.artifacts[0].recordPath, 'utf8'),
      ).resolves.toContain(result.artifacts[0].artifactId);
      await expect(
        fsp.readFile(result.artifacts[0].path, 'utf8'),
      ).resolves.toBe(artifactContents);
      expect(temporaryManifestPath).toEqual(expect.any(String));
      expect(existsSync(String(temporaryManifestPath))).toBe(false);
      for (const temporaryPath of temporaryRevisionRuntimePaths) {
        expect(existsSync(temporaryPath)).toBe(false);
      }
      expect(
        (await fsp.readdir(outputDir)).some((entry) =>
          entry.startsWith('.wharfie-package-'),
        ),
      ).toBe(false);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('packages strict manifests before NodeBinary exactVersion exists', async () => {
    const helloWorldDir = createHelloWorldDirectory();
    const outputDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-actor-system-package-'),
    );

    jest.spyOn(ActorSystem.prototype, 'reconcile').mockImplementation(
      /** @this {ActorSystem} */ async function () {
        const buildDir = path.join(outputDir, '.fake-builds');

        for (const resource of this.getResources()) {
          if (resource instanceof NodeBinary) {
            expect(resource.has('exactVersion')).toBe(false);
          }
        }
        await prepareMockArtifactProvenance(this, buildDir);

        for (const resource of this.getResources()) {
          if (resource instanceof SeaBuild) {
            const target = {
              nodeVersion: String(resource.get('nodeVersion')),
              platform: String(resource.get('platform')),
              architecture: String(resource.get('architecture')),
              ...(resource.has('libc')
                ? { libc: String(resource.get('libc')) }
                : {}),
            };
            const selector = getTargetSelector(target);
            const fakeBinaryPath = path.join(buildDir, selector);

            await fsp.writeFile(
              fakeBinaryPath,
              `#!/bin/sh\necho ${selector}\n`,
              'utf8',
            );
            resource._setUNSAFE('binaryPath', fakeBinaryPath);
          }
        }
      },
    );

    try {
      const result = await packageLocalApp({
        dir: helloWorldDir,
        outputDir,
        targetFilters: [getTargetSelector(currentTarget)],
      });

      expect(result.app).toEqual({ id: 'hello-world-demo' });
      expect(result.targets).toEqual([currentTarget]);
      expect(result.artifacts).toHaveLength(1);
      const artifactContents = `#!/bin/sh\necho ${getTargetSelector(currentTarget)}\n`;
      expect(result.artifacts[0]).toEqual(
        expect.objectContaining({
          fileName: getArtifactFileName(
            'hello-world-demo',
            artifactContents,
            currentTarget,
          ),
          target: currentTarget,
          revisionId: result.revision.revisionId,
        }),
      );
      expect(existsSync(result.artifacts[0].path)).toBe(true);
    } finally {
      await fsp.rm(outputDir, { recursive: true, force: true });
    }
  });

  it('rejects incompatible public SEA targets before build initialization', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-incompatible-target-package-'),
    );
    const initializeEnvironment = jest.spyOn(
      ActorSystem.prototype,
      'initializeEnvironment',
    );
    const reconcile = jest.spyOn(ActorSystem.prototype, 'reconcile');

    try {
      await fsp.mkdir(path.join(dir, 'src'), { recursive: true });
      await Promise.all([
        fsp.writeFile(
          path.join(dir, 'package.json'),
          JSON.stringify({
            name: 'incompatible-target-demo',
            private: true,
            type: 'module',
          }),
          'utf8',
        ),
        fsp.writeFile(
          path.join(dir, 'src', 'cli.js'),
          'export default async function cli() {}\n',
          'utf8',
        ),
        fsp.writeFile(
          path.join(dir, 'wharfie.app.js'),
          `export default {
  schemaVersion: 4,
  app: { id: 'incompatible-target-demo' },
  cli: {
    entrypoint: { kind: 'node', path: './src/cli.js', export: 'default' },
  },
  targets: [{
    nodeVersion: '${mismatchedNodeVersion}',
    platform: process.platform,
    architecture: process.arch,
    ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
  }],
};
`,
          'utf8',
        ),
      ]);

      await expect(packageLocalApp({ dir })).rejects.toThrow(
        /requires the SEA blob generator and target binary to use the same exact Node version/i,
      );
      expect(initializeEnvironment).not.toHaveBeenCalled();
      expect(reconcile).not.toHaveBeenCalled();
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects musl targets instead of mislabeling official glibc Node binaries', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-musl-target-package-'),
    );
    const initializeEnvironment = jest.spyOn(
      ActorSystem.prototype,
      'initializeEnvironment',
    );

    try {
      await fsp.mkdir(path.join(dir, 'src'), { recursive: true });
      await Promise.all([
        fsp.writeFile(
          path.join(dir, 'package.json'),
          JSON.stringify({ name: 'musl-target-demo', type: 'module' }),
        ),
        fsp.writeFile(
          path.join(dir, 'src', 'cli.js'),
          'export default async function cli() {}\n',
        ),
        fsp.writeFile(
          path.join(dir, 'wharfie.app.js'),
          `export default {
  schemaVersion: 4,
  app: { id: 'musl-target-demo' },
  cli: {
    entrypoint: { kind: 'node', path: './src/cli.js', export: 'default' },
  },
  targets: [{
    nodeVersion: process.versions.node,
    platform: 'linux',
    architecture: process.arch,
    libc: 'musl',
  }],
};
`,
        ),
      ]);

      await expect(packageLocalApp({ dir })).rejects.toThrow(
        /libc must be 'glibc' for Linux/i,
      );
      expect(initializeEnvironment).not.toHaveBeenCalled();
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ['platform', 'macos', 'x64', /platform must be 'darwin' or 'linux'/i],
    [
      'platform',
      'win32',
      'x64',
      /Windows SEA targets are deferred until private core-runtime extraction is hardened and tested/i,
    ],
    [
      'architecture',
      'linux',
      'amd64',
      /architecture must be 'arm64' or 'x64'/i,
    ],
  ])(
    'rejects unsupported SEA %s labels before building',
    async (_kind, platform, architecture, expectedError) => {
      const dir = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'wharfie-invalid-target-package-'),
      );
      const initializeEnvironment = jest.spyOn(
        ActorSystem.prototype,
        'initializeEnvironment',
      );

      try {
        await fsp.mkdir(path.join(dir, 'src'), { recursive: true });
        await Promise.all([
          fsp.writeFile(
            path.join(dir, 'package.json'),
            JSON.stringify({ name: 'invalid-target-demo', type: 'module' }),
          ),
          fsp.writeFile(
            path.join(dir, 'src', 'cli.js'),
            'export default async function cli() {}\n',
          ),
          fsp.writeFile(
            path.join(dir, 'wharfie.app.js'),
            `export default {
  schemaVersion: 4,
  app: { id: 'invalid-target-demo' },
  cli: {
    entrypoint: { kind: 'node', path: './src/cli.js', export: 'default' },
  },
  targets: [{
    nodeVersion: process.versions.node,
    platform: '${platform}',
    architecture: '${architecture}',
    ...('${platform}' === 'linux' ? { libc: 'glibc' } : {}),
  }],
};
`,
          ),
        ]);

        await expect(packageLocalApp({ dir })).rejects.toThrow(expectedError);
        expect(initializeEnvironment).not.toHaveBeenCalled();
      } finally {
        await fsp.rm(dir, { recursive: true, force: true });
      }
    },
  );

  it('rejects app identifiers that could escape or destabilize build paths', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-invalid-app-id-package-'),
    );

    try {
      await fsp.mkdir(path.join(dir, 'src'), { recursive: true });
      await Promise.all([
        fsp.writeFile(
          path.join(dir, 'package.json'),
          JSON.stringify({ name: 'invalid-app-id', type: 'module' }),
        ),
        fsp.writeFile(
          path.join(dir, 'src', 'cli.js'),
          'export default async function cli() {}\n',
        ),
        fsp.writeFile(
          path.join(dir, 'wharfie.app.js'),
          `export default {
  schemaVersion: 4,
  app: { id: '../escaped-app' },
  cli: {
    entrypoint: { kind: 'node', path: './src/cli.js', export: 'default' },
  },
  targets: [{
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
  }],
};
`,
        ),
      ]);

      await expect(packageLocalApp({ dir })).rejects.toThrow(
        /app\.id must be a canonical logical ID/i,
      );
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it.each([
    [
      'a reserved internal activity name',
      `${APP_MANIFEST_ASSET_PREFIX}manifest.json`,
      '',
      /must be a canonical logical ID/i,
    ],
    [
      'the removed top-level resources field',
      'activity',
      "resources: { db: { adapter: 'lmdb' } },",
      /app\.resources is not supported by schemaVersion 4/i,
    ],
    [
      'a scheduler without a portable durable store',
      'activity',
      "scheduler: { triggers: [{ activity: 'activity', cron: '* * * * *' }] },",
      /app\.scheduler is not supported/i,
    ],
  ])(
    'rejects %s before building',
    async (_description, activityName, contractDeclaration, expectedError) => {
      const dir = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'wharfie-nonportable-contract-package-'),
      );
      const initializeEnvironment = jest.spyOn(
        ActorSystem.prototype,
        'initializeEnvironment',
      );

      try {
        await fsp.mkdir(path.join(dir, 'src'), { recursive: true });
        await Promise.all([
          fsp.writeFile(
            path.join(dir, 'package.json'),
            JSON.stringify({ name: 'nonportable-demo', type: 'module' }),
          ),
          fsp.writeFile(
            path.join(dir, 'src', 'cli.js'),
            'export default async function cli() {}\n',
          ),
          fsp.writeFile(
            path.join(dir, 'src', 'activity.js'),
            'export default async function activity() {}\n',
          ),
          fsp.writeFile(
            path.join(dir, 'wharfie.app.js'),
            `export default {
  schemaVersion: 4,
  app: { id: 'nonportable-demo' },
  cli: {
    entrypoint: { kind: 'node', path: './src/cli.js', export: 'default' },
  },
  targets: [{
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
  }],
  ${contractDeclaration}
  activities: {
    ${JSON.stringify(activityName)}: {
      entrypoint: {
        kind: 'node',
        path: './src/activity.js',
        export: 'default',
      },
    },
  },
};
`,
          ),
        ]);

        await expect(packageLocalApp({ dir })).rejects.toThrow(expectedError);
        expect(initializeEnvironment).not.toHaveBeenCalled();
      } finally {
        await fsp.rm(dir, { recursive: true, force: true });
      }
    },
  );

  it('rejects duplicate normalized SEA targets', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-duplicate-target-package-'),
    );

    try {
      await fsp.mkdir(path.join(dir, 'src'), { recursive: true });
      await Promise.all([
        fsp.writeFile(
          path.join(dir, 'package.json'),
          JSON.stringify({ name: 'duplicate-target-demo', type: 'module' }),
        ),
        fsp.writeFile(
          path.join(dir, 'src', 'cli.js'),
          'export default async function cli() {}\n',
        ),
        fsp.writeFile(
          path.join(dir, 'wharfie.app.js'),
          `const target = {
  nodeVersion: process.versions.node,
  platform: 'linux',
  architecture: 'x64',
};
export default {
  schemaVersion: 4,
  app: { id: 'duplicate-target-demo' },
  cli: {
    entrypoint: { kind: 'node', path: './src/cli.js', export: 'default' },
  },
  targets: [
    { ...target, ...(target.platform === 'linux' ? { libc: 'glibc' } : {}) },
    { ...target, ...(target.platform === 'linux' ? { libc: 'glibc' } : {}) },
  ],
};
`,
        ),
      ]);

      await expect(packageLocalApp({ dir })).rejects.toThrow(
        /duplicates an earlier target/i,
      );
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects ActorSystem authoring before build initialization', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-filtered-portability-package-'),
    );

    try {
      await fsp.writeFile(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'filtered-portability', type: 'module' }),
      );
      await fsp.writeFile(
        path.join(dir, 'wharfie.app.js'),
        `import ActorSystem from ${JSON.stringify(actorSystemUrl)};

export default new ActorSystem({
  name: 'filtered-portability',
  properties: {
    targets: [{
      nodeVersion: process.versions.node,
      platform: process.platform,
      architecture: process.arch,
    }],
  },
});
`,
      );

      // Jest's ESM loader drops search parameters from file: URLs, so it
      // cannot observe the cache-busted second import used by loadApp. Run
      // this reload assertion in native Node ESM instead.
      const child = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `import ActorSystem from ${JSON.stringify(actorSystemUrl)};
import { packageLocalApp } from ${JSON.stringify(localAppUrl)};

ActorSystem.prototype.initializeEnvironment = async () => {
  throw new Error('Packaging reached build initialization.');
};

try {
  await packageLocalApp({
    dir: process.argv[1],
    targetFilters: [process.argv[2]],
  });
  console.log(JSON.stringify({ message: 'Packaging unexpectedly succeeded.' }));
} catch (error) {
  console.log(JSON.stringify({
    message: error instanceof Error ? error.message : String(error),
  }));
}
`,
          dir,
          getTargetSelector(currentTarget),
        ],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          timeout: 5_000,
        },
      );

      expect(child.error).toBeUndefined();
      expect(child.status).toBe(0);
      const output = JSON.parse(child.stdout.trim());
      expect(output.message).toMatch(/must be a JSON object/i);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ['hello', './src/activity.js', /reserved for Wharfie runtime content/i],
    [
      SINGLE_NODE_DEPLOYMENT_PAYLOAD_MANIFEST_ASSET_NAME,
      './src/activity.js',
      /reserved for Wharfie runtime content/i,
    ],
    ['branding', './missing-branding.txt', /does not exist/i],
  ])(
    'rejects invalid packaging asset %s before building',
    async (assetName, assetPath, expectedError) => {
      const dir = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'wharfie-invalid-asset-package-'),
      );
      const initializeEnvironment = jest.spyOn(
        ActorSystem.prototype,
        'initializeEnvironment',
      );

      try {
        await fsp.mkdir(path.join(dir, 'src'), { recursive: true });
        await Promise.all([
          fsp.writeFile(
            path.join(dir, 'package.json'),
            JSON.stringify({ name: 'invalid-asset-demo', type: 'module' }),
          ),
          fsp.writeFile(
            path.join(dir, 'src', 'cli.js'),
            'export default async function cli() {}\n',
          ),
          fsp.writeFile(
            path.join(dir, 'src', 'activity.js'),
            'export default async function activity() {}\n',
          ),
          fsp.writeFile(
            path.join(dir, 'wharfie.app.js'),
            `export default {
  schemaVersion: 4,
  app: { id: 'invalid-asset-demo' },
  cli: {
    entrypoint: { kind: 'node', path: './src/cli.js', export: 'default' },
  },
  targets: [{
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
  }],
  activities: {
    hello: {
      entrypoint: {
        kind: 'node',
        path: './src/activity.js',
        export: 'default',
      },
    },
  },
};
`,
          ),
        ]);

        await expect(
          packageLocalApp({
            dir,
            build: {
              assets: {
                [assetName]: assetPath,
              },
            },
          }),
        ).rejects.toThrow(expectedError);
        expect(initializeEnvironment).not.toHaveBeenCalled();
      } finally {
        await fsp.rm(dir, { recursive: true, force: true });
      }
    },
  );

  it('attaches the exact deployment payload after revision preparation and seals its digest evidence', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-framework-assets-package-'),
    );
    const outputDir = path.join(dir, 'dist');
    const payloadDir = path.join(dir, 'payload');
    const manifestPath = path.join(payloadDir, 'manifest.json');
    const seaPath = path.join(payloadDir, 'app-sea');
    const manifestBytes = '{"kind":"test-deployment-payload"}\n';
    const seaBytes = 'exact nested linux sea bytes';

    try {
      await writeTransactionalPackageApp(dir, 'framework-assets-package', [
        currentTarget,
      ]);
      await fsp.mkdir(payloadDir, { mode: 0o700 });
      await Promise.all([
        fsp.writeFile(manifestPath, manifestBytes),
        fsp.writeFile(seaPath, seaBytes),
      ]);

      jest.spyOn(ActorSystem.prototype, 'reconcile').mockImplementation(
        /** @this {ActorSystem} */ async function () {
          const buildDir = path.join(dir, '.fake-builds');
          await prepareMockArtifactProvenance(this, buildDir);

          for (const resource of this.getResources()) {
            if (!(resource instanceof SeaBuild)) continue;
            const assets = resource.get('assets');
            const assetDigests = resource.get('assetDigests');
            expect(assets).toEqual(
              expect.objectContaining({
                [SINGLE_NODE_DEPLOYMENT_PAYLOAD_MANIFEST_ASSET_NAME]:
                  manifestPath,
                [SINGLE_NODE_DEPLOYMENT_PAYLOAD_SEA_ASSET_NAME]: seaPath,
              }),
            );
            expect(assetDigests).toEqual(
              expect.objectContaining({
                [SINGLE_NODE_DEPLOYMENT_PAYLOAD_MANIFEST_ASSET_NAME]:
                  getSha256Digest(manifestBytes),
                [SINGLE_NODE_DEPLOYMENT_PAYLOAD_SEA_ASSET_NAME]:
                  getSha256Digest(seaBytes),
              }),
            );
            const binaryPath = path.join(buildDir, 'operator-sea');
            await fsp.writeFile(binaryPath, 'operator sea bytes');
            resource._setUNSAFE('binaryPath', binaryPath);
          }
        },
      );

      const result = await packageLocalApp({
        dir,
        outputDir,
        frameworkAssets: {
          assets: {
            [SINGLE_NODE_DEPLOYMENT_PAYLOAD_MANIFEST_ASSET_NAME]: manifestPath,
            [SINGLE_NODE_DEPLOYMENT_PAYLOAD_SEA_ASSET_NAME]: seaPath,
          },
          assetDigests: {
            [SINGLE_NODE_DEPLOYMENT_PAYLOAD_MANIFEST_ASSET_NAME]:
              getSha256Digest(manifestBytes),
            [SINGLE_NODE_DEPLOYMENT_PAYLOAD_SEA_ASSET_NAME]:
              getSha256Digest(seaBytes),
          },
        },
      });

      expect(result.revision.inputs.assets).toBeUndefined();
      expect(result.artifacts).toHaveLength(1);
      expect(existsSync(result.artifacts[0].path)).toBe(true);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('fences an expected revision change before build initialization', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-expected-revision-package-'),
    );
    const initializeEnvironment = jest.spyOn(
      ActorSystem.prototype,
      'initializeEnvironment',
    );

    try {
      await writeTransactionalPackageApp(dir, 'expected-revision-package', [
        currentTarget,
      ]);

      await expect(
        packageLocalApp({
          dir,
          expectedRevisionId: `wrv1_${Buffer.alloc(32).toString('base64url')}`,
        }),
      ).rejects.toThrow(/revision changed between package passes/i);
      expect(initializeEnvironment).not.toHaveBeenCalled();
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ['behavior', 'branding', true],
    ['manifest', APP_MANIFEST_ASSET_NAME, false],
    ['revision', APPLICATION_REVISION_ASSET_NAME, false],
    ['runtime', ARTIFACT_RUNTIME_ASSET_NAME, false],
  ])(
    'rejects a %s asset mutated after its immutable digest is installed',
    async (_label, assetName, includeBehaviorAsset) => {
      const dir = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'wharfie-mutated-package-asset-'),
      );
      const outputDir = path.join(dir, 'dist');

      try {
        await writeTransactionalPackageApp(dir, 'mutated-package-asset', [
          currentTarget,
        ]);
        if (includeBehaviorAsset) {
          await fsp.writeFile(
            path.join(dir, 'branding.txt'),
            'original branding bytes',
          );
        }

        jest.spyOn(ActorSystem.prototype, 'reconcile').mockImplementation(
          /** @this {ActorSystem} */ async function () {
            const build = this.getResources().find(
              (resource) => resource instanceof SeaBuild,
            );
            if (!(build instanceof SeaBuild)) {
              throw new Error('Expected a SEA build resource.');
            }
            const assets = build.get('assets');
            const digests = build.get('assetDigests');
            expect(digests[assetName]).toEqual({
              algorithm: 'sha256',
              value: expect.any(String),
            });
            await fsp.chmod(assets[assetName], 0o600);
            await fsp.writeFile(
              assets[assetName],
              `mutated ${String(assetName)} bytes`,
            );
            const sealDir = await fsp.mkdtemp(
              path.join(dir, '.mutated-sea-assets-'),
            );
            await build.prepareSeaAssets(sealDir);
          },
        );

        await expect(
          packageLocalApp({
            dir,
            outputDir,
            ...(includeBehaviorAsset
              ? { build: { assets: { branding: './branding.txt' } } }
              : {}),
          }),
        ).rejects.toThrow(/does not match its expected SHA-256 digest/i);
      } finally {
        await fsp.rm(dir, { recursive: true, force: true });
      }
    },
  );

  it('rejects unsupported activity environment values before building', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-inline-env-package-'),
    );
    const initializeEnvironment = jest.spyOn(
      ActorSystem.prototype,
      'initializeEnvironment',
    );
    const secret = 'inline-environment-secret-sentinel';

    try {
      await fsp.mkdir(path.join(dir, 'src'), { recursive: true });
      await Promise.all([
        fsp.writeFile(
          path.join(dir, 'package.json'),
          JSON.stringify({ name: 'inline-env-demo', type: 'module' }),
        ),
        fsp.writeFile(
          path.join(dir, 'src', 'cli.js'),
          'export default async function cli() {}\n',
        ),
        fsp.writeFile(
          path.join(dir, 'src', 'activity.js'),
          'export default async function activity() {}\n',
        ),
        fsp.writeFile(
          path.join(dir, 'wharfie.app.js'),
          `export default {
  schemaVersion: 4,
  app: { id: 'inline-env-demo' },
  cli: {
    entrypoint: { kind: 'node', path: './src/cli.js', export: 'default' },
  },
  targets: [{
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
  }],
  activities: {
    activity: {
      entrypoint: {
        kind: 'node',
        path: './src/activity.js',
        export: 'default',
      },
      environmentVariables: { API_TOKEN_VALUE: '${secret}' },
    },
  },
};
`,
        ),
      ]);

      const result = packageLocalApp({ dir });
      await expect(result).rejects.toThrow(
        /environmentVariables is not supported by schemaVersion 4/i,
      );
      await expect(result).rejects.not.toThrow(secret);
      expect(initializeEnvironment).not.toHaveBeenCalled();
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects removed top-level resources without rendering nested values', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-inline-secret-package-'),
    );
    const secret = 'resource-password-sentinel';

    try {
      await fsp.mkdir(path.join(dir, 'src'), { recursive: true });
      await Promise.all([
        fsp.writeFile(
          path.join(dir, 'package.json'),
          JSON.stringify({ name: 'inline-secret-demo', type: 'module' }),
        ),
        fsp.writeFile(
          path.join(dir, 'src', 'cli.js'),
          'export default async function cli() {}\n',
        ),
        fsp.writeFile(
          path.join(dir, 'wharfie.app.js'),
          `export default {
  schemaVersion: 4,
  app: { id: 'inline-secret-demo' },
  cli: {
    entrypoint: { kind: 'node', path: './src/cli.js', export: 'default' },
  },
  targets: [{
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
  }],
  resources: {
    db: { adapter: 'vanilla', options: { password: '${secret}' } },
  },
};
`,
        ),
      ]);

      const result = packageLocalApp({ dir });
      await expect(result).rejects.toThrow(
        /app\.resources is not supported by schemaVersion 4/i,
      );
      await expect(result).rejects.not.toThrow(secret);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects removed activity resources without rendering nested values', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-unreviewed-resource-option-'),
    );
    const secret = 'opaque-resource-option-secret-sentinel';

    try {
      await fsp.mkdir(path.join(dir, 'src'), { recursive: true });
      await Promise.all([
        fsp.writeFile(
          path.join(dir, 'package.json'),
          JSON.stringify({ name: 'unreviewed-option-demo', type: 'module' }),
        ),
        fsp.writeFile(
          path.join(dir, 'src', 'cli.js'),
          'export default async function cli() {}\n',
        ),
        fsp.writeFile(
          path.join(dir, 'src', 'activity.js'),
          'export default async function activity() {}\n',
        ),
        fsp.writeFile(
          path.join(dir, 'wharfie.app.js'),
          `export default {
  schemaVersion: 4,
  app: { id: 'unreviewed-option-demo' },
  cli: {
    entrypoint: { kind: 'node', path: './src/cli.js', export: 'default' },
  },
  targets: [{
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
  }],
  activities: {
    activity: {
      entrypoint: {
        kind: 'node',
        path: './src/activity.js',
        export: 'default',
      },
      resources: {
        db: {
          adapter: 'vanilla',
          options: { opaqueRuntimeValue: '${secret}' },
        },
      },
    },
  },
};
`,
        ),
      ]);

      const result = packageLocalApp({ dir });
      await expect(result).rejects.toThrow(
        /app\.activities\.activity\.resources is not supported by schemaVersion 4/i,
      );
      await expect(result).rejects.not.toThrow(secret);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects obsolete non-object workflow shapes before embedding inputs', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-unreviewed-workflow-package-'),
    );
    const secret = 'opaque-workflow-input-secret-sentinel';

    try {
      await fsp.mkdir(path.join(dir, 'src'), { recursive: true });
      await Promise.all([
        fsp.writeFile(
          path.join(dir, 'package.json'),
          JSON.stringify({ name: 'workflow-package-demo', type: 'module' }),
        ),
        fsp.writeFile(
          path.join(dir, 'src', 'cli.js'),
          'export default async function cli() {}\n',
        ),
        fsp.writeFile(
          path.join(dir, 'wharfie.app.js'),
          `export default {
  schemaVersion: 4,
  app: { id: 'workflow-package-demo' },
  cli: {
    entrypoint: { kind: 'node', path: './src/cli.js', export: 'default' },
  },
  targets: [{
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
  }],
  workflows: [{
    name: 'unsafe-input-workflow',
    actions: [{
      id: 'start',
      type: 'START',
      inputs: { opaqueRuntimeValue: '${secret}' },
    }],
  }],
};
`,
        ),
      ]);

      const result = packageLocalApp({ dir });
      await expect(result).rejects.toThrow(
        /manifest\.workflows must be a JSON object/i,
      );
      await expect(result).rejects.not.toThrow(secret);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('removes function and manifest temp assets when reconciliation fails', async () => {
    const helloWorldDir = createHelloWorldDirectory();
    const outputDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-failed-package-cleanup-'),
    );
    /** @type {string[]} */
    const temporaryPaths = [];

    jest.spyOn(ActorSystem.prototype, 'reconcile').mockImplementation(
      /** @this {ActorSystem} */ async function () {
        for (const resource of this.getResources()) {
          if (resource instanceof SeaBuild) {
            const manifestPath = resource.get('assets', {})[
              APP_MANIFEST_ASSET_NAME
            ];
            if (manifestPath) temporaryPaths.push(manifestPath);
          }
          if (resource instanceof FunctionResource) {
            const assetPath = path.join(
              outputDir,
              `function-${temporaryPaths.length}.json`,
            );
            await fsp.writeFile(assetPath, 'temporary function asset', {
              mode: 0o600,
            });
            resource._setUNSAFE('singleExecutableAssetPath', assetPath);
            temporaryPaths.push(assetPath);
          }
          if (resource instanceof CoreRuntimeDependenciesResource) {
            const assetDirectory = path.join(
              outputDir,
              `core-runtime-dependencies-${temporaryPaths.length}`,
            );
            await fsp.mkdir(assetDirectory, { recursive: true, mode: 0o700 });
            await fsp.writeFile(
              path.join(assetDirectory, 'core-lmdb.tgz'),
              'temporary core dependency archive',
              { mode: 0o600 },
            );
            resource._setUNSAFE('assetDirectory', assetDirectory);
            temporaryPaths.push(assetDirectory);
          }
        }
        throw new Error('reconcile-failure-sentinel');
      },
    );

    try {
      await expect(
        packageLocalApp({ dir: helloWorldDir, outputDir }),
      ).rejects.toThrow('reconcile-failure-sentinel');
      expect(temporaryPaths.length).toBeGreaterThan(0);
      for (const temporaryPath of temporaryPaths) {
        expect(existsSync(temporaryPath)).toBe(false);
      }
    } finally {
      await fsp.rm(outputDir, { recursive: true, force: true });
    }
  });

  it('removes package-owned SEA outputs when staged artifact writing fails', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-package-copy-transaction-'),
    );
    const outputDir = path.join(dir, 'dist');
    const appName = 'copy-transaction-demo';
    const ownedBinariesDir = path.join(dir, 'actor-binaries');
    const originalBinariesDir = SeaBuild.BINARIES_DIR;
    /** @type {string[]} */
    const ownedBinaryPaths = [];
    const targets = [
      {
        nodeVersion: process.versions.node,
        platform: 'linux',
        architecture: 'x64',
      },
      {
        nodeVersion: process.versions.node,
        platform: 'linux',
        architecture: 'arm64',
      },
    ];
    const previousOutput = path.join(outputDir, 'previous-artifact');
    const firstOutput = path.join(
      outputDir,
      getArtifactFileName(appName, 'new-artifact-0', targets[0]),
    );
    const secondOutput = path.join(
      outputDir,
      getArtifactFileName(appName, 'new-artifact-1', targets[1]),
    );

    try {
      SeaBuild.BINARIES_DIR = ownedBinariesDir;
      await fsp.mkdir(ownedBinariesDir, { recursive: true });
      await writeTransactionalPackageApp(dir, appName, targets);
      await fsp.mkdir(outputDir, { recursive: true });
      await fsp.writeFile(previousOutput, 'previous-artifact', 'utf8');

      jest.spyOn(ActorSystem.prototype, 'reconcile').mockImplementation(
        /** @this {ActorSystem} */ async function () {
          const buildDir = path.join(dir, '.wharfie', 'mock-builds');
          await prepareMockArtifactProvenance(this, buildDir);
          let index = 0;
          for (const resource of this.getResources()) {
            if (!(resource instanceof SeaBuild)) continue;
            const sourcePath = path.join(ownedBinariesDir, `binary-${index}`);
            await fsp.writeFile(sourcePath, `new-artifact-${index}`, 'utf8');
            resource._setUNSAFE('binaryPath', sourcePath);
            ownedBinaryPaths.push(sourcePath);
            index += 1;
          }
        },
      );

      const writeFile = fsp.writeFile.bind(fsp);
      let stagedArtifactWriteCount = 0;
      jest
        .spyOn(fsp, 'writeFile')
        .mockImplementation(async (destination, contents, options) => {
          const destinationPath = String(destination);
          if (
            destinationPath.includes('.wharfie-package-') &&
            !destinationPath.endsWith('.artifact.json')
          ) {
            stagedArtifactWriteCount += 1;
            if (stagedArtifactWriteCount === 2) {
              throw new Error('staged-write-failure-sentinel');
            }
          }
          return writeFile(destination, contents, options);
        });

      await expect(packageLocalApp({ dir, outputDir })).rejects.toThrow(
        'staged-write-failure-sentinel',
      );
      await expect(fsp.readFile(previousOutput, 'utf8')).resolves.toBe(
        'previous-artifact',
      );
      expect(existsSync(firstOutput)).toBe(false);
      expect(existsSync(secondOutput)).toBe(false);
      expect(await fsp.readdir(outputDir)).toEqual([
        path.basename(previousOutput),
      ]);
      expect(ownedBinaryPaths).toHaveLength(2);
      for (const ownedBinaryPath of ownedBinaryPaths) {
        expect(existsSync(ownedBinaryPath)).toBe(false);
      }
    } finally {
      SeaBuild.BINARIES_DIR = originalBinariesDir;
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('rolls back the complete output set and removes staging when publication fails', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-package-publish-transaction-'),
    );
    const outputDir = path.join(dir, 'dist');
    const appName = 'publish-transaction-demo';
    const targets = [
      {
        nodeVersion: process.versions.node,
        platform: 'linux',
        architecture: 'x64',
      },
      {
        nodeVersion: process.versions.node,
        platform: 'linux',
        architecture: 'arm64',
      },
    ];
    const previousOutput = path.join(outputDir, 'previous-artifact');
    const firstOutput = path.join(
      outputDir,
      getArtifactFileName(appName, 'new-artifact-0', targets[0]),
    );
    const secondOutput = path.join(
      outputDir,
      getArtifactFileName(appName, 'new-artifact-1', targets[1]),
    );

    try {
      await writeTransactionalPackageApp(dir, appName, targets);
      await fsp.mkdir(outputDir, { recursive: true });
      await fsp.writeFile(previousOutput, 'previous-artifact', 'utf8');

      jest.spyOn(ActorSystem.prototype, 'reconcile').mockImplementation(
        /** @this {ActorSystem} */ async function () {
          const buildDir = path.join(dir, '.fake-builds');
          await prepareMockArtifactProvenance(this, buildDir);
          let index = 0;
          for (const resource of this.getResources()) {
            if (!(resource instanceof SeaBuild)) continue;
            const sourcePath = path.join(buildDir, `binary-${index}`);
            await fsp.writeFile(sourcePath, `new-artifact-${index}`, 'utf8');
            resource._setUNSAFE('binaryPath', sourcePath);
            index += 1;
          }
        },
      );

      const link = fsp.link.bind(fsp);
      jest
        .spyOn(fsp, 'link')
        .mockImplementation(async (source, destination) => {
          if (
            String(source).includes('.wharfie-package-') &&
            String(destination) === secondOutput
          ) {
            throw new Error('publish-link-failure-sentinel');
          }
          return link(source, destination);
        });

      await expect(packageLocalApp({ dir, outputDir })).rejects.toThrow(
        'publish-link-failure-sentinel',
      );
      await expect(fsp.readFile(previousOutput, 'utf8')).resolves.toBe(
        'previous-artifact',
      );
      expect(existsSync(firstOutput)).toBe(false);
      expect(existsSync(secondOutput)).toBe(false);
      expect(await fsp.readdir(outputDir)).toEqual([
        path.basename(previousOutput),
      ]);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('reuses one exact artifact association and rejects the same bytes under a new revision', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-package-association-'),
    );
    const outputDir = path.join(dir, 'dist');
    const appName = 'artifact-association-demo';
    const targets = [
      {
        nodeVersion: process.versions.node,
        platform: 'linux',
        architecture: 'x64',
      },
    ];

    try {
      await writeTransactionalPackageApp(dir, appName, targets);
      jest.spyOn(ActorSystem.prototype, 'reconcile').mockImplementation(
        /** @this {ActorSystem} */ async function () {
          const buildDir = path.join(dir, '.wharfie', 'mock-builds');
          await prepareMockArtifactProvenance(this, buildDir);
          for (const resource of this.getResources()) {
            if (!(resource instanceof SeaBuild)) continue;
            const sourcePath = path.join(buildDir, resource.name);
            await fsp.writeFile(sourcePath, 'identical-artifact', 'utf8');
            resource._setUNSAFE('binaryPath', sourcePath);
          }
        },
      );

      const first = await packageLocalApp({ dir, outputDir });
      const firstArtifact = first.artifacts[0];
      const firstRecordJson = await fsp.readFile(
        firstArtifact.recordPath,
        'utf8',
      );
      const link = jest.spyOn(fsp, 'link');
      const repeated = await packageLocalApp({ dir, outputDir });
      expect(repeated.artifacts[0].artifactId).toBe(firstArtifact.artifactId);
      expect(repeated.artifacts[0].revisionId).toBe(firstArtifact.revisionId);
      expect(link).not.toHaveBeenCalled();

      await fsp.writeFile(
        path.join(dir, 'src', 'cli.js'),
        'export default async function cli() { return "changed"; }\n',
      );
      await expect(packageLocalApp({ dir, outputDir })).rejects.toThrow(
        /revisionId.*trusted inputs|owning revision/i,
      );
      await expect(fsp.readFile(firstArtifact.path, 'utf8')).resolves.toBe(
        'identical-artifact',
      );
      await expect(
        fsp.readFile(firstArtifact.recordPath, 'utf8'),
      ).resolves.toBe(firstRecordJson);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('never overwrites a destination created after publication preflight', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-package-no-replace-'),
    );
    const outputDir = path.join(dir, 'dist');
    const appName = 'no-replace-demo';
    const targets = [
      {
        nodeVersion: process.versions.node,
        platform: 'linux',
        architecture: 'x64',
      },
    ];
    /** @type {string | undefined} */
    let racedPath;

    try {
      await writeTransactionalPackageApp(dir, appName, targets);
      jest.spyOn(ActorSystem.prototype, 'reconcile').mockImplementation(
        /** @this {ActorSystem} */ async function () {
          const buildDir = path.join(dir, '.wharfie', 'mock-builds');
          await prepareMockArtifactProvenance(this, buildDir);
          for (const resource of this.getResources()) {
            if (!(resource instanceof SeaBuild)) continue;
            const sourcePath = path.join(buildDir, resource.name);
            await fsp.writeFile(sourcePath, 'candidate-artifact', 'utf8');
            resource._setUNSAFE('binaryPath', sourcePath);
          }
        },
      );

      const link = fsp.link.bind(fsp);
      jest
        .spyOn(fsp, 'link')
        .mockImplementation(async (source, destination) => {
          if (!String(destination).endsWith('.artifact.json')) {
            racedPath = String(destination);
            await fsp.writeFile(racedPath, 'raced-destination', 'utf8');
          }
          return link(source, destination);
        });

      await expect(packageLocalApp({ dir, outputDir })).rejects.toMatchObject({
        code: 'EEXIST',
      });
      expect(racedPath).toEqual(expect.any(String));
      await expect(fsp.readFile(String(racedPath), 'utf8')).resolves.toBe(
        'raced-destination',
      );
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects a concurrent publisher while the per-app output lock is held', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-package-publication-lock-'),
    );
    const outputDir = path.join(dir, 'dist');
    const appName = 'publication-lock-demo';
    const targets = [
      {
        nodeVersion: process.versions.node,
        platform: 'linux',
        architecture: 'x64',
      },
    ];
    let releaseFirstReconcile = () => {};
    /** @type {Promise<void>} */
    const holdFirstReconcile = new Promise((resolve) => {
      releaseFirstReconcile = () => resolve();
    });
    let signalFirstReconcile = () => {};
    /** @type {Promise<void>} */
    const firstReconcileStarted = new Promise((resolve) => {
      signalFirstReconcile = () => resolve();
    });
    let reconcileCalls = 0;
    /** @type {Promise<any> | undefined} */
    let firstPackage;

    try {
      await writeTransactionalPackageApp(dir, appName, targets);
      jest.spyOn(ActorSystem.prototype, 'reconcile').mockImplementation(
        /** @this {ActorSystem} */ async function () {
          reconcileCalls += 1;
          signalFirstReconcile();
          await holdFirstReconcile;

          const buildDir = path.join(dir, '.fake-builds');
          await prepareMockArtifactProvenance(this, buildDir);
          for (const resource of this.getResources()) {
            if (!(resource instanceof SeaBuild)) continue;
            const sourcePath = path.join(buildDir, resource.name);
            await fsp.writeFile(sourcePath, 'locked-publisher', 'utf8');
            resource._setUNSAFE('binaryPath', sourcePath);
          }
        },
      );

      firstPackage = packageLocalApp({ dir, outputDir });
      await firstReconcileStarted;

      await expect(packageLocalApp({ dir, outputDir })).rejects.toThrow(
        /another Wharfie publisher holds.*\.publish\.lock/i,
      );
      expect(reconcileCalls).toBe(1);

      releaseFirstReconcile();
      await expect(firstPackage).resolves.toEqual(
        expect.objectContaining({ app: { id: appName } }),
      );
      expect(
        (await fsp.readdir(outputDir)).some((entry) =>
          entry.endsWith('.publish.lock'),
        ),
      ).toBe(false);
    } finally {
      releaseFirstReconcile();
      if (firstPackage) await firstPackage.catch(() => {});
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('preserves transaction staging when immutable publication rollback is incomplete', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-package-recovery-preservation-'),
    );
    const outputDir = path.join(dir, 'dist');
    const appName = 'recovery-preservation-demo';
    const targets = [
      {
        nodeVersion: process.versions.node,
        platform: 'linux',
        architecture: 'x64',
      },
      {
        nodeVersion: process.versions.node,
        platform: 'linux',
        architecture: 'arm64',
      },
    ];
    const previousOutput = path.join(outputDir, 'previous-artifact');
    const firstOutput = path.join(
      outputDir,
      getArtifactFileName(appName, 'new-artifact-0', targets[0]),
    );
    const secondOutput = path.join(
      outputDir,
      getArtifactFileName(appName, 'new-artifact-1', targets[1]),
    );

    try {
      await writeTransactionalPackageApp(dir, appName, targets);
      await fsp.mkdir(outputDir, { recursive: true });
      await fsp.writeFile(previousOutput, 'previous-artifact', 'utf8');

      jest.spyOn(ActorSystem.prototype, 'reconcile').mockImplementation(
        /** @this {ActorSystem} */ async function () {
          const buildDir = path.join(dir, '.fake-builds');
          await prepareMockArtifactProvenance(this, buildDir);
          let index = 0;
          for (const resource of this.getResources()) {
            if (!(resource instanceof SeaBuild)) continue;
            const sourcePath = path.join(buildDir, `binary-${index}`);
            await fsp.writeFile(sourcePath, `new-artifact-${index}`, 'utf8');
            resource._setUNSAFE('binaryPath', sourcePath);
            index += 1;
          }
        },
      );

      const link = fsp.link.bind(fsp);
      jest
        .spyOn(fsp, 'link')
        .mockImplementation(async (source, destination) => {
          const destinationPath = String(destination);
          if (destinationPath === secondOutput) {
            throw new Error('publish-failure-sentinel');
          }
          return link(source, destination);
        });
      const rm = fsp.rm.bind(fsp);
      jest.spyOn(fsp, 'rm').mockImplementation(async (targetPath, options) => {
        if (String(targetPath) === firstOutput) {
          throw new Error('rollback-removal-failure-sentinel');
        }
        return rm(targetPath, options);
      });

      /** @type {any} */
      let publicationError;
      try {
        await packageLocalApp({ dir, outputDir });
      } catch (error) {
        publicationError = error;
      }

      expect(publicationError).toBeInstanceOf(AggregateError);
      expect(publicationError.message).toMatch(
        /recovery files have been preserved at/i,
      );
      const recoveryPath = publicationError.recoveryPath;
      expect(recoveryPath).toEqual(expect.any(String));
      expect(existsSync(recoveryPath)).toBe(true);
      await expect(fsp.readFile(previousOutput, 'utf8')).resolves.toBe(
        'previous-artifact',
      );
      expect(existsSync(firstOutput)).toBe(true);
      expect(existsSync(secondOutput)).toBe(false);
      await expect(
        fsp.readFile(
          path.join(recoveryPath, 'ready', path.basename(secondOutput)),
          'utf8',
        ),
      ).resolves.toBe('new-artifact-1');
      expect(
        (await fsp.readdir(outputDir)).some((entry) =>
          entry.endsWith('.publish.lock'),
        ),
      ).toBe(false);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('removes staged package-owned SeaBuild outputs but preserves external paths', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-package-owned-binary-cleanup-'),
    );
    const outputDir = path.join(dir, 'dist');
    const ownedBinariesDir = path.join(dir, 'actor-binaries');
    const externalBinariesDir = path.join(dir, 'external-binaries');
    const originalBinariesDir = SeaBuild.BINARIES_DIR;
    const appName = 'owned-binary-cleanup-demo';
    const targets = [
      {
        nodeVersion: process.versions.node,
        platform: 'linux',
        architecture: 'x64',
      },
      {
        nodeVersion: process.versions.node,
        platform: 'linux',
        architecture: 'arm64',
      },
    ];
    const ownedBinaryPath = path.join(ownedBinariesDir, 'owned-build-output');
    const externalBinaryPath = path.join(
      externalBinariesDir,
      'external-build-output',
    );

    try {
      SeaBuild.BINARIES_DIR = ownedBinariesDir;
      await writeTransactionalPackageApp(dir, appName, targets);
      await Promise.all([
        fsp.mkdir(ownedBinariesDir, { recursive: true }),
        fsp.mkdir(externalBinariesDir, { recursive: true }),
      ]);

      jest.spyOn(ActorSystem.prototype, 'reconcile').mockImplementation(
        /** @this {ActorSystem} */ async function () {
          await prepareMockArtifactProvenance(
            this,
            path.join(dir, '.fake-builds'),
          );
          let index = 0;
          for (const resource of this.getResources()) {
            if (!(resource instanceof SeaBuild)) continue;
            const sourcePath =
              index === 0 ? ownedBinaryPath : externalBinaryPath;
            await fsp.writeFile(sourcePath, `artifact-${index}`, 'utf8');
            resource._setUNSAFE('binaryPath', sourcePath);
            index += 1;
          }
        },
      );

      const result = await packageLocalApp({ dir, outputDir });

      expect(result.artifacts).toHaveLength(2);
      expect(existsSync(ownedBinaryPath)).toBe(false);
      expect(existsSync(externalBinaryPath)).toBe(true);
      for (const artifact of result.artifacts) {
        expect(existsSync(artifact.path)).toBe(true);
      }
    } finally {
      SeaBuild.BINARIES_DIR = originalBinariesDir;
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
