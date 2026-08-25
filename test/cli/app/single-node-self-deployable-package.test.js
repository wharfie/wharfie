/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createApplicationRevision } from '../../../src/core/runtime/application-revision.js';

/** @type {jest.Mock<(...args: any[]) => any>} */
const packageLocalApp = jest.fn();
/** @type {jest.Mock<(...args: any[]) => any>} */
const createSingleNodeDeploymentPayloadAssets = jest.fn();

jest.unstable_mockModule('../../../src/cli/app/local-app.js', () => ({
  packageLocalApp,
}));
jest.unstable_mockModule(
  '../../../src/core/runtime/single-node-deployment-payload.js',
  () => ({
    createSingleNodeDeploymentPayloadAssets,
  }),
);

const {
  SINGLE_NODE_DEPLOYMENT_PACKAGE_TARGET,
  packageSingleNodeSelfDeployableApp,
} = await import('../../../src/cli/app/single-node-self-deployable-package.js');

/** @type {string[]} */
const temporaryDirectories = [];

afterEach(async () => {
  jest.resetAllMocks();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fsp.rm(directory, { recursive: true, force: true })),
  );
});

/** @param {string | Buffer} value */
function digest(value) {
  return {
    algorithm: /** @type {const} */ ('sha256'),
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

function makeRevision(marker = 'same') {
  return createApplicationRevision({
    contract: {
      schemaVersion: 4,
      app: { id: 'self-deployable-test' },
      cli: {
        entrypoint: {
          kind: 'node',
          path: 'src/cli.js',
          export: 'default',
        },
      },
    },
    inputs: {
      source: {
        format: 'wharfie-source-tree-v1',
        digest: digest(`source:${marker}`),
      },
      dependencies: {
        format: 'wharfie-npm-package-lock-v3-closure-v1',
        digest: digest('dependencies'),
      },
      runtime: {
        format: 'wharfie-runtime-v1',
        digest: digest('runtime'),
      },
    },
  });
}

/**
 * @param {import('../../../src/core/runtime/application-revision.js').ApplicationRevision} revision
 * @param {import('../../../src/core/runtime/build-target.js').BuildTarget} target
 * @param {string} artifactPath
 */
function makePackageResult(revision, target, artifactPath) {
  return {
    app: { id: 'self-deployable-test' },
    revision,
    targets: [target],
    outputDir: path.dirname(artifactPath),
    artifacts: [
      {
        path: artifactPath,
        target,
        record: { marker: 'artifact-record' },
      },
    ],
  };
}

describe('packageSingleNodeSelfDeployableApp', () => {
  it('packages a private Linux child then embeds its exact payload without changing revision identity', async () => {
    const revision = makeRevision();
    const publicOutput = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-self-deployable-public-'),
    );
    temporaryDirectories.push(publicOutput);
    const payloadDirectory = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-self-deployable-payload-test-'),
    );
    temporaryDirectories.push(payloadDirectory);
    const manifestPath = path.join(payloadDirectory, 'manifest.json');
    const seaPath = path.join(payloadDirectory, 'app-sea');
    await Promise.all([
      fsp.writeFile(manifestPath, '{}\n'),
      fsp.writeFile(seaPath, 'linux sea'),
    ]);
    const payloadCleanup = jest.fn(async () => {
      await fsp.rm(payloadDirectory, { recursive: true, force: true });
    });
    const payload = {
      manifest: {
        payloadId: 'wsdp1_payload',
        artifactRecord: { marker: 'artifact-record' },
      },
      assets: {
        '<WHARFIE_DEPLOYMENT>/payload/v1/manifest.json': manifestPath,
        '<WHARFIE_DEPLOYMENT>/payload/v1/app-sea': seaPath,
      },
      assetDigests: {
        '<WHARFIE_DEPLOYMENT>/payload/v1/manifest.json': digest('{}\n'),
        '<WHARFIE_DEPLOYMENT>/payload/v1/app-sea': digest('linux sea'),
      },
      cleanup: payloadCleanup,
    };
    /** @type {string | undefined} */
    let privateOutput;
    packageLocalApp
      .mockImplementationOnce(async (request) => {
        privateOutput = request.outputDir;
        const artifactPath = path.join(request.outputDir, 'deployment-sea');
        await fsp.writeFile(artifactPath, 'linux sea');
        return makePackageResult(
          revision,
          SINGLE_NODE_DEPLOYMENT_PACKAGE_TARGET,
          artifactPath,
        );
      })
      .mockResolvedValueOnce({
        app: { id: 'self-deployable-test' },
        revision,
        targets: [
          {
            nodeVersion: process.versions.node,
            platform: 'darwin',
            architecture: 'arm64',
          },
        ],
        outputDir: publicOutput,
        artifacts: [{ path: path.join(publicOutput, 'operator-sea') }],
      });
    createSingleNodeDeploymentPayloadAssets.mockResolvedValueOnce(payload);

    const build = { assets: { prompt: './prompt.txt' } };
    const onProgress = jest.fn();
    const result = await packageSingleNodeSelfDeployableApp({
      dir: '/app',
      outputDir: publicOutput,
      targetFilters: ['darwin-arm64'],
      build,
      onProgress,
    });

    expect(packageLocalApp).toHaveBeenCalledTimes(2);
    expect(packageLocalApp.mock.calls[0][0]).toEqual({
      dir: '/app',
      outputDir: privateOutput,
      targetOverrides: [SINGLE_NODE_DEPLOYMENT_PACKAGE_TARGET],
      build,
      onProgress,
    });
    expect(createSingleNodeDeploymentPayloadAssets).toHaveBeenCalledWith({
      artifactPath: path.join(String(privateOutput), 'deployment-sea'),
      artifactRecord: { marker: 'artifact-record' },
      revision,
    });
    expect(packageLocalApp.mock.calls[1][0]).toEqual({
      dir: '/app',
      outputDir: publicOutput,
      targetFilters: ['darwin-arm64'],
      build,
      onProgress,
      frameworkAssets: {
        assets: payload.assets,
        assetDigests: payload.assetDigests,
      },
      expectedRevisionId: revision.revisionId,
    });
    expect(result.deploymentPayload).toBe(payload.manifest);
    expect(result.revision.revisionId).toBe(revision.revisionId);
    expect(payloadCleanup).toHaveBeenCalledTimes(1);
    expect(existsSync(String(privateOutput))).toBe(false);
    expect(existsSync(payloadDirectory)).toBe(false);
  });

  it('cleans both private layers when the operator package pass fails', async () => {
    const revision = makeRevision();
    const payloadDirectory = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-self-deployable-failure-payload-'),
    );
    temporaryDirectories.push(payloadDirectory);
    const manifestPath = path.join(payloadDirectory, 'manifest.json');
    const seaPath = path.join(payloadDirectory, 'app-sea');
    await Promise.all([
      fsp.writeFile(manifestPath, '{}\n'),
      fsp.writeFile(seaPath, 'linux sea'),
    ]);
    const payloadCleanup = jest.fn(async () => {
      await fsp.rm(payloadDirectory, { recursive: true, force: true });
    });
    /** @type {string | undefined} */
    let privateOutput;
    packageLocalApp
      .mockImplementationOnce(async (request) => {
        privateOutput = request.outputDir;
        const artifactPath = path.join(request.outputDir, 'deployment-sea');
        await fsp.writeFile(artifactPath, 'linux sea');
        return makePackageResult(
          revision,
          SINGLE_NODE_DEPLOYMENT_PACKAGE_TARGET,
          artifactPath,
        );
      })
      .mockRejectedValueOnce(new Error('operator package failed'));
    createSingleNodeDeploymentPayloadAssets.mockResolvedValueOnce({
      manifest: { payloadId: 'wsdp1_payload' },
      assets: {
        '<WHARFIE_DEPLOYMENT>/payload/v1/manifest.json': manifestPath,
        '<WHARFIE_DEPLOYMENT>/payload/v1/app-sea': seaPath,
      },
      assetDigests: {
        '<WHARFIE_DEPLOYMENT>/payload/v1/manifest.json': digest('{}\n'),
        '<WHARFIE_DEPLOYMENT>/payload/v1/app-sea': digest('linux sea'),
      },
      cleanup: payloadCleanup,
    });

    await expect(
      packageSingleNodeSelfDeployableApp({ dir: '/app' }),
    ).rejects.toThrow('operator package failed');

    expect(packageLocalApp.mock.calls[0][0]).toEqual({
      dir: '/app',
      outputDir: privateOutput,
      targetOverrides: [SINGLE_NODE_DEPLOYMENT_PACKAGE_TARGET],
    });
    expect(packageLocalApp.mock.calls[1][0]).toEqual({
      dir: '/app',
      frameworkAssets: expect.any(Object),
      expectedRevisionId: revision.revisionId,
    });
    expect(packageLocalApp.mock.calls[1][0]).not.toHaveProperty(
      'targetFilters',
    );

    expect(payloadCleanup).toHaveBeenCalledTimes(1);
    expect(existsSync(String(privateOutput))).toBe(false);
    expect(existsSync(payloadDirectory)).toBe(false);
  });
});
