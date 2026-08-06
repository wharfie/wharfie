import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  AWS_PROVIDER_PACKAGE_NAME,
  AWS_PROVIDER_PACKAGE_VERSION,
  AwsProviderUnavailableError,
  validateAwsProviderModule,
} from '../runtime/aws-provider-module.js';

const require = createRequire(import.meta.url);
const AWS_PROVIDER_LOADER_PATH = fileURLToPath(
  new URL('../runtime/aws-provider-module.js', import.meta.url),
);
const AWS_PROVIDER_BOUNDARY_MARKER =
  '/* wharfie:fixed-aws-provider-boundary:v1 */';
const PACKAGED_APP_ENTRY_MARKERS = Object.freeze([
  'import runtimeOperatorCli from',
  'await runPackagedApp({',
  "'ledger-service': ledgerServiceCmd",
]);

/**
 * @param {unknown} cause - Provider resolution or import failure.
 * @returns {AwsProviderUnavailableError} - Stable incompatible-provider error.
 */
function incompatibleProvider(cause) {
  if (
    cause instanceof AwsProviderUnavailableError &&
    cause.reason === 'incompatible'
  ) {
    return cause;
  }
  return new AwsProviderUnavailableError({ cause, reason: 'incompatible' });
}

/**
 * @param {unknown} cause - `require.resolve` failure.
 * @returns {boolean} - Whether the fixed companion itself is absent.
 */
function isMissingProviderPackageJson(cause) {
  if (
    cause === null ||
    typeof cause !== 'object' ||
    /** @type {{code?: unknown}} */ (cause).code !== 'MODULE_NOT_FOUND'
  ) {
    return false;
  }
  const message =
    typeof (/** @type {{message?: unknown}} */ (cause).message) === 'string'
      ? /** @type {{message: string}} */ (cause).message
      : '';
  return /^Cannot find module ['"]@wharfie\/aws\/package\.json['"]/u.test(
    message,
  );
}

/**
 * Resolve and bind the fixed companion's package identity before importing it.
 * The exported provider version is validated separately after import.
 * @param {{requireRef?: typeof require, readPackageJson?: (packageJsonPath: string) => string}} [dependencies] - Focused test seams.
 * @returns {Readonly<{entrypoint: string, packageJsonPath: string, packageRoot: string}> | undefined} - Exact companion resolution, or undefined only when absent.
 */
function resolveAwsProviderEmbedding(dependencies = {}) {
  const requireRef = dependencies.requireRef ?? require;
  const readPackageJson =
    dependencies.readPackageJson ??
    ((packageJsonPath) => readFileSync(packageJsonPath, 'utf8'));
  let packageJsonPath;
  try {
    packageJsonPath = requireRef.resolve(
      `${AWS_PROVIDER_PACKAGE_NAME}/package.json`,
    );
  } catch (cause) {
    if (isMissingProviderPackageJson(cause)) return undefined;
    throw incompatibleProvider(cause);
  }

  try {
    if (
      typeof packageJsonPath !== 'string' ||
      !path.isAbsolute(packageJsonPath) ||
      path.basename(packageJsonPath) !== 'package.json'
    ) {
      throw new Error('AWS companion package.json resolution is invalid.');
    }
    const metadata = JSON.parse(readPackageJson(packageJsonPath));
    if (
      metadata === null ||
      typeof metadata !== 'object' ||
      Array.isArray(metadata) ||
      metadata.name !== AWS_PROVIDER_PACKAGE_NAME ||
      metadata.version !== AWS_PROVIDER_PACKAGE_VERSION
    ) {
      throw new Error('AWS companion package identity is incompatible.');
    }

    const packageRoot = path.dirname(packageJsonPath);
    const entrypoint = requireRef.resolve(AWS_PROVIDER_PACKAGE_NAME);
    const relativeEntrypoint = path.relative(packageRoot, entrypoint);
    if (
      typeof entrypoint !== 'string' ||
      !path.isAbsolute(entrypoint) ||
      relativeEntrypoint === '' ||
      relativeEntrypoint === '..' ||
      relativeEntrypoint.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeEntrypoint)
    ) {
      throw new Error('AWS companion entrypoint escaped its package root.');
    }
    return Object.freeze({ entrypoint, packageJsonPath, packageRoot });
  } catch (cause) {
    throw incompatibleProvider(cause);
  }
}

/**
 * Add the fixed packaged-app provider boundary. The error boundary is present
 * in every generated app. The AWS SDK graph is added only when the one exact
 * optional companion resolves beside core and passes package plus export
 * validation. Already-prepared input is returned unchanged so evidence capture
 * may prepare the entry before the ordinary build wrapper sees it.
 * @param {import('esbuild').BuildOptions} args - Candidate build options.
 * @param {{resolveProvider?: typeof resolveAwsProviderEmbedding, importProvider?: (entrypoint: string) => Promise<unknown>}} [dependencies] - Focused test seams.
 * @returns {Promise<import('esbuild').BuildOptions>} - Exact build options.
 */
async function withEmbeddedAwsProvider(args, dependencies = {}) {
  const contents = args.stdin?.contents;
  if (
    typeof contents === 'string' &&
    contents.startsWith(`${AWS_PROVIDER_BOUNDARY_MARKER}\n`)
  ) {
    return args;
  }
  if (
    typeof contents !== 'string' ||
    !PACKAGED_APP_ENTRY_MARKERS.every((marker) => contents.includes(marker))
  ) {
    return args;
  }

  let providerResolution;
  try {
    providerResolution = (
      dependencies.resolveProvider ?? resolveAwsProviderEmbedding
    )();
  } catch (cause) {
    throw incompatibleProvider(cause);
  }

  const boundaryImports = [
    `import { AwsProviderUnavailableError as WharfieAwsProviderUnavailableError${
      providerResolution
        ? ', registerAwsProviderModule as registerWharfieEmbeddedAwsProvider'
        : ', sealAwsProviderUnavailable as sealWharfieAwsProviderUnavailable'
    } } from ${JSON.stringify(AWS_PROVIDER_LOADER_PATH)};`,
  ];
  if (providerResolution) {
    let providerNamespace;
    try {
      providerNamespace = await (
        dependencies.importProvider ??
        ((entrypoint) => import(pathToFileURL(entrypoint).href))
      )(providerResolution.entrypoint);
      validateAwsProviderModule(providerNamespace);
    } catch (cause) {
      throw incompatibleProvider(cause);
    }
    boundaryImports.push(
      `import * as wharfieEmbeddedAwsProvider from ${JSON.stringify(providerResolution.entrypoint)};`,
      'registerWharfieEmbeddedAwsProvider(wharfieEmbeddedAwsProvider);',
    );
  } else {
    boundaryImports.push('sealWharfieAwsProviderUnavailable();');
  }

  const guardedContents = contents.replace(
    /\}\)\(\);\s*$/u,
    `})().catch((error) => {
      console.error(error instanceof WharfieAwsProviderUnavailableError ? error.message : error);
      process.exitCode = 1;
    });`,
  );
  if (guardedContents === contents) {
    throw new Error(
      'Generated packaged-app entry is missing its terminal async invocation.',
    );
  }

  return {
    ...args,
    stdin: {
      ...args.stdin,
      contents: `${AWS_PROVIDER_BOUNDARY_MARKER}\n${boundaryImports.join('\n')}\n${guardedContents}`,
    },
  };
}

/**
 * @param {import('esbuild').BuildOptions} args - args.
 * @returns {Promise<import('esbuild').BuildResult>} - Result.
 */
async function build(args) {
  const esbuild = require('esbuild');
  return esbuild.build(await withEmbeddedAwsProvider(args));
}

export { build, resolveAwsProviderEmbedding, withEmbeddedAwsProvider };
