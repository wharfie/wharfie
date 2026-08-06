import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { x as extractTarball } from 'tar';

import {
  createPackageTarball,
  NPM_COMMAND,
  readJson,
  REPO_ROOT,
  runCommand,
} from './package-verification.js';

const PROOF_PREFIX = 'wharfie-magnetic-first-run-';
const PACKAGE_NAME = '@wharfie/wharfie';
const DEPENDENCY_PACKAGE_BUDGET = 170;
const INSTALLED_LOGICAL_BYTE_BUDGET = 85 * 1024 * 1024;

/**
 * @param {string} directory - Installed tree to measure.
 * @returns {number} - Logical bytes in regular files below the tree.
 */
function logicalFileBytes(directory) {
  let bytes = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      bytes += logicalFileBytes(entryPath);
    } else if (entry.isFile()) {
      bytes += lstatSync(entryPath).size;
    }
  }
  return bytes;
}

/**
 * @param {string} directory - Installed starter directory.
 * @param {NodeJS.ProcessEnv} env - Isolated npm environment.
 * @returns {number} - Installed dependency package directories.
 */
function dependencyPackageCount(directory, env) {
  const listed = runCommand(NPM_COMMAND, ['ls', '--all', '--parseable'], {
    cwd: directory,
    env,
    capture: true,
  }).stdout;
  return Math.max(0, listed.split(/\r?\n/u).filter(Boolean).length - 1);
}

/**
 * @returns {string | null} - Exact published package spec, or null for the
 * current working-tree tarball.
 */
function parsePackageSpec() {
  const args = process.argv.slice(2);
  if (args.length === 0) return null;
  if (args.length !== 2 || args[0] !== '--package') {
    throw new TypeError(
      'Usage: node scripts/verify-magnetic-first-run.js [--package @wharfie/wharfie@<exact-version>]',
    );
  }
  return args[1];
}

/**
 * @param {string} root - Candidate proof root.
 */
function removeProofRoot(root) {
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith(PROOF_PREFIX));
  rmSync(resolved, { recursive: true, force: true });
}

/**
 * @param {string} packageSpec - Exact published package spec.
 * @param {string} root - Disposable proof root.
 * @param {string} npmCache - Isolated npm cache.
 * @returns {{manifest: Record<string, any>, tarballPath: string}} - Packed
 * published dependency.
 */
function packPublishedDependency(packageSpec, root, npmCache) {
  const { stdout } = runCommand(
    NPM_COMMAND,
    [
      'pack',
      '--json',
      '--ignore-scripts',
      '--pack-destination',
      root,
      packageSpec,
    ],
    {
      cwd: root,
      capture: true,
      env: {
        ...process.env,
        npm_config_cache: npmCache,
        npm_config_update_notifier: 'false',
      },
    },
  );
  const results = JSON.parse(stdout);
  assert.ok(Array.isArray(results) && results.length === 1);
  const manifest = results[0];
  return {
    manifest,
    tarballPath: path.join(root, manifest.filename),
  };
}

const packageSpec = parsePackageSpec();
const packageMetadata = readJson(path.join(REPO_ROOT, 'package.json'));
const exactPublishedSpec = `${PACKAGE_NAME}@${packageMetadata.version}`;
if (packageSpec !== null && packageSpec !== exactPublishedSpec) {
  throw new TypeError(
    `Magnetic acceptance requires the exact package spec ${exactPublishedSpec}.`,
  );
}

const proofRoot = mkdtempSync(path.join(os.tmpdir(), PROOF_PREFIX));
const unpackedRoot = path.join(proofRoot, 'unpacked-package');
const starterRoot = path.join(proofRoot, 'hello-world');
const npmCache = path.join(proofRoot, 'npm-cache');
let localPackage;

try {
  const packed =
    packageSpec === null
      ? (localPackage = createPackageTarball())
      : packPublishedDependency(packageSpec, proofRoot, npmCache);
  assert.equal(packed.manifest.name, PACKAGE_NAME);
  assert.equal(packed.manifest.version, packageMetadata.version);
  assert.equal(lstatSync(packed.tarballPath).isFile(), true);

  mkdirSync(unpackedRoot);
  await extractTarball({
    cwd: unpackedRoot,
    file: packed.tarballPath,
    strict: true,
  });
  const packedStarterRoot = path.join(
    unpackedRoot,
    'package',
    'examples',
    'hello-world',
  );
  cpSync(packedStarterRoot, starterRoot, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });

  const starterMetadataPath = path.join(starterRoot, 'package.json');
  const starterMetadataBefore = readFileSync(starterMetadataPath, 'utf8');
  const starterMetadata = JSON.parse(starterMetadataBefore);
  assert.equal(
    starterMetadata.devDependencies?.[PACKAGE_NAME],
    packageMetadata.version,
    'the copied starter must pin the exact Wharfie preview version',
  );

  const installArgs =
    packageSpec === null
      ? [
          'install',
          '--no-audit',
          '--no-fund',
          '--no-save',
          '--package-lock=false',
          packed.tarballPath,
        ]
      : ['install', '--no-audit', '--no-fund'];
  const installEnvironment = {
    ...process.env,
    npm_config_cache: npmCache,
    npm_config_update_notifier: 'false',
  };
  process.stdout.write(
    packageSpec === null
      ? `Installing ${PACKAGE_NAME}@${packageMetadata.version} from one packed tarball\n`
      : `Running the copied starter's npm install for ${packageSpec}\n`,
  );
  runCommand(NPM_COMMAND, installArgs, {
    cwd: starterRoot,
    env: installEnvironment,
  });
  assert.equal(
    readFileSync(starterMetadataPath, 'utf8'),
    starterMetadataBefore,
    'acceptance installation must not rewrite the copied starter',
  );

  const installedPackageRoot = path.join(
    starterRoot,
    'node_modules',
    '@wharfie',
    'wharfie',
  );
  const installedMetadata = readJson(
    path.join(installedPackageRoot, 'package.json'),
  );
  assert.equal(installedMetadata.name, PACKAGE_NAME);
  assert.equal(installedMetadata.version, packageMetadata.version);
  assert.ok(
    realpathSync(installedPackageRoot).startsWith(
      `${realpathSync(starterRoot)}${path.sep}`,
    ),
    'the starter resolved Wharfie outside its copied workspace',
  );
  const installedNodeModules = path.join(starterRoot, 'node_modules');
  assert.equal(
    existsSync(path.join(installedNodeModules, '@aws-sdk')),
    false,
    'the canonical starter must not install @aws-sdk packages',
  );
  assert.equal(
    existsSync(path.join(installedNodeModules, '@smithy')),
    false,
    'the canonical starter must not install @smithy packages',
  );
  const dependencyPackages = dependencyPackageCount(
    starterRoot,
    installEnvironment,
  );
  const installedLogicalBytes = logicalFileBytes(installedNodeModules);
  assert.ok(
    dependencyPackages <= DEPENDENCY_PACKAGE_BUDGET,
    `canonical starter dependency count ${dependencyPackages} exceeds ${DEPENDENCY_PACKAGE_BUDGET}`,
  );
  assert.ok(
    installedLogicalBytes <= INSTALLED_LOGICAL_BYTE_BUDGET,
    `canonical starter logical bytes ${installedLogicalBytes} exceed ${INSTALLED_LOGICAL_BYTE_BUDGET}`,
  );

  process.stdout.write('Running the copied magnetic starter\n');
  runCommand(NPM_COMMAND, ['run', 'demo', '--', 'Ada'], {
    cwd: starterRoot,
    env: {
      ...process.env,
      NODE_PATH: undefined,
      WHARFIE_MAGNETIC_ACCEPTANCE_BUILDER_ROOT: starterRoot,
      npm_config_cache: npmCache,
      npm_config_update_notifier: 'false',
    },
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        magneticFirstRun: 'ok',
        package: packed.manifest.filename,
        dependencyPackages,
        dependencyPackageBudget: DEPENDENCY_PACKAGE_BUDGET,
        installedLogicalBytes,
        installedLogicalByteBudget: INSTALLED_LOGICAL_BYTE_BUDGET,
        providerSdkPackages: 0,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  localPackage?.cleanup();
  removeProofRoot(proofRoot);
}
