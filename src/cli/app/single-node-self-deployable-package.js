import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { validateApplicationRevision } from '../../core/runtime/application-revision.js';
import {
  getBuildTargetId,
  validateBuildTarget,
} from '../../core/runtime/build-target.js';
import { createSingleNodeDeploymentPayloadAssets } from '../../core/runtime/single-node-deployment-payload.js';

import { packageLocalApp } from './local-app.js';

const PACKAGE_OPTION_NAMES = new Set([
  'build',
  'dir',
  'outputDir',
  'targetFilters',
]);

export const SINGLE_NODE_DEPLOYMENT_PACKAGE_TARGET = Object.freeze(
  validateBuildTarget(
    {
      nodeVersion: process.versions.node,
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
    'single-node deployment package target',
  ),
);

/**
 * @typedef PackageSingleNodeSelfDeployableAppOptions
 * @property {string} dir - Source application directory.
 * @property {string} [outputDir] - Public operator artifact directory.
 * @property {string[]} [targetFilters] - Requested operator artifact targets.
 * @property {import('./local-app.js').LocalAppBuildConfig} [build] - Ephemeral package build configuration.
 */

/**
 * @typedef SingleNodeDeploymentPayloadAssetsHandle
 * @property {Readonly<Record<string, any>>} manifest - Authenticated payload manifest.
 * @property {Readonly<Record<string, string>>} assets - Exact private asset paths.
 * @property {Readonly<Record<string, Readonly<{algorithm: 'sha256', value: string}>>>} assetDigests - Exact private asset digests.
 * @property {() => Promise<void>} cleanup - Idempotent private snapshot cleanup.
 */

/**
 * @param {unknown} value - Candidate options.
 * @returns {void} - Throws unless the package request has the closed public shape.
 */
function assertPackageOptions(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((name) => !PACKAGE_OPTION_NAMES.has(name)) ||
    typeof (/** @type {Record<string, any>} */ (value).dir) !== 'string' ||
    !(/** @type {Record<string, any>} */ (value).dir)
  ) {
    throw new TypeError(
      'Single-node self-deployable package options are invalid.',
    );
  }
}

/**
 * @param {PackageSingleNodeSelfDeployableAppOptions} options - Public request.
 * @returns {import('./local-app.js').PackageLocalAppOptions} - Shared ordinary package options.
 */
function createSharedPackageOptions(options) {
  return {
    dir: options.dir,
    ...(options.outputDir !== undefined
      ? { outputDir: options.outputDir }
      : {}),
    ...(options.build !== undefined ? { build: options.build } : {}),
  };
}

/**
 * @param {unknown} value - First-pass package result.
 * @returns {{artifact: Record<string, any>, revision: import('../../core/runtime/application-revision.js').ApplicationRevision}} - Exact deployable artifact.
 */
function validateDeploymentPackageResult(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Array.isArray(/** @type {Record<string, any>} */ (value).artifacts) ||
    /** @type {Record<string, any>} */ (value).artifacts.length !== 1
  ) {
    throw new Error(
      'Deployment package pass did not produce exactly one Linux SEA.',
    );
  }
  const result = /** @type {Record<string, any>} */ (value);
  const artifact = result.artifacts[0];
  if (
    artifact === null ||
    typeof artifact !== 'object' ||
    Array.isArray(artifact)
  ) {
    throw new Error('Deployment package pass returned an invalid artifact.');
  }
  const target = validateBuildTarget(
    artifact.target,
    'deployment package artifact target',
  );
  if (
    getBuildTargetId(target) !==
    getBuildTargetId(SINGLE_NODE_DEPLOYMENT_PACKAGE_TARGET)
  ) {
    throw new Error(
      'Deployment package pass did not produce the exact Linux x64 glibc target.',
    );
  }
  const revision = validateApplicationRevision(
    result.revision,
    'deployment package application revision',
  );
  return { artifact, revision };
}

/**
 * Package one application twice: first as the exact disposable Linux
 * deployment SEA, then as the requested operator SEA set containing that
 * authenticated deployment payload. Framework assets are attached after
 * revision preparation and therefore do not alter logical app identity.
 * @param {PackageSingleNodeSelfDeployableAppOptions} options - Package request.
 * @returns {Promise<import('./local-app.js').PackageLocalAppResult & {deploymentPayload: Readonly<Record<string, any>>}>} - Public operator artifacts and embedded payload identity.
 */
export async function packageSingleNodeSelfDeployableApp(options) {
  assertPackageOptions(options);

  /** @type {string | undefined} */
  let privateOutputDir;
  /** @type {SingleNodeDeploymentPayloadAssetsHandle | undefined} */
  let payload;
  /** @type {unknown} */
  let packageError;
  /** @type {(import('./local-app.js').PackageLocalAppResult & {deploymentPayload: Readonly<Record<string, any>>}) | undefined} */
  let result;

  try {
    privateOutputDir = await fsp.mkdtemp(
      path.join(tmpdir(), 'wharfie-self-deployable-package-'),
    );
    await fsp.chmod(privateOutputDir, 0o700);

    const deploymentPackage = await packageLocalApp({
      ...createSharedPackageOptions(options),
      outputDir: privateOutputDir,
      targetFilters: [
        `node${SINGLE_NODE_DEPLOYMENT_PACKAGE_TARGET.nodeVersion}-linux-x64-glibc`,
      ],
    });
    const deployment = validateDeploymentPackageResult(deploymentPackage);
    payload = await createSingleNodeDeploymentPayloadAssets({
      artifactPath: deployment.artifact.path,
      artifactRecord: deployment.artifact.record,
      revision: deployment.revision,
    });

    const operatorPackage = await packageLocalApp({
      ...createSharedPackageOptions(options),
      ...(options.targetFilters !== undefined
        ? { targetFilters: options.targetFilters }
        : {}),
      frameworkAssets: {
        assets: payload.assets,
        assetDigests: payload.assetDigests,
      },
      expectedRevisionId: deployment.revision.revisionId,
    });
    const operatorRevision = validateApplicationRevision(
      operatorPackage.revision,
      'operator package application revision',
    );
    if (operatorRevision.revisionId !== deployment.revision.revisionId) {
      throw new Error(
        'Deployment and operator package passes produced different application revisions.',
      );
    }
    result = {
      ...operatorPackage,
      deploymentPayload: payload.manifest,
    };
  } catch (error) {
    packageError = error;
  }

  const cleanupResults = await Promise.allSettled([
    ...(payload ? [payload.cleanup()] : []),
    ...(privateOutputDir
      ? [fsp.rm(privateOutputDir, { recursive: true, force: true })]
      : []),
  ]);
  const cleanupErrors = cleanupResults
    .filter((outcome) => outcome.status === 'rejected')
    .map((outcome) => outcome.reason);
  if (packageError && cleanupErrors.length > 0) {
    throw new AggregateError(
      [packageError, ...cleanupErrors],
      'Self-deployable application packaging failed and temporary payload cleanup was incomplete.',
    );
  }
  if (packageError) throw packageError;
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      'Self-deployable application packaging completed but temporary payload cleanup was incomplete.',
    );
  }
  return /** @type {import('./local-app.js').PackageLocalAppResult & {deploymentPayload: Readonly<Record<string, any>>}} */ (
    result
  );
}

export default packageSingleNodeSelfDeployableApp;
