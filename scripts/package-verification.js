import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { WHARFIE_VERSION } from '../src/core/lib/version.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
export const NPM_COMMAND = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const EXCLUDED_LEGACY_CLI_FILES = new Set([
  'src/cli/config.js',
  'src/cli/input.js',
  'src/cli/upgrade.js',
  'src/cli/cmds/config.js',
  'src/cli/cmds/init.js',
  'src/cli/cmds/list.js',
]);

/**
 * @param {string} filePath - JSON file to read.
 * @returns {Record<string, any>} - Parsed JSON object.
 */
export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

/**
 * @param {string} command - Executable to run.
 * @param {string[]} args - Command arguments.
 * @param {{ cwd?: string, env?: Record<string, string | undefined>, capture?: boolean }} [options] - Execution options.
 * @returns {{ stdout: string, stderr: string }} - Captured output, when requested.
 */
export function runCommand(command, args, options = {}) {
  const capture = options.capture === true;
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? 'pipe' : 'inherit',
    maxBuffer: capture ? 20 * 1024 * 1024 : undefined,
  });

  if (result.error) throw result.error;

  if (result.status !== 0) {
    const rendered = [
      `${command} ${args.join(' ')} exited with status ${result.status}`,
      capture && result.stdout ? `stdout:\n${result.stdout}` : '',
      capture && result.stderr ? `stderr:\n${result.stderr}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    throw new Error(rendered);
  }

  return {
    stdout: capture && result.stdout ? result.stdout : '',
    stderr: capture && result.stderr ? result.stderr : '',
  };
}

/**
 * @param {string} absoluteDirectory - Directory to traverse.
 * @param {string} relativeDirectory - Repository-relative directory name.
 * @returns {string[]} - Repository-relative file paths using POSIX separators.
 */
function listFiles(absoluteDirectory, relativeDirectory) {
  /** @type {string[]} */
  const files = [];

  for (const entry of readdirSync(absoluteDirectory, {
    withFileTypes: true,
  })) {
    const absolutePath = path.join(absoluteDirectory, entry.name);
    const relativePath = path.posix.join(relativeDirectory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listFiles(absolutePath, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

/**
 * @returns {string[]} - Runtime files that must be present in the npm tarball.
 */
function requiredRuntimeFiles() {
  const coreFiles = listFiles(path.join(REPO_ROOT, 'src', 'core'), 'src/core');
  const cliFiles = listFiles(
    path.join(REPO_ROOT, 'src', 'cli'),
    'src/cli',
  ).filter(
    (filePath) =>
      !filePath.startsWith('src/cli/assets/') &&
      !EXCLUDED_LEGACY_CLI_FILES.has(filePath) &&
      !filePath.startsWith('src/cli/project/project_structure_examples/'),
  );
  const verificationFiles = listFiles(
    path.join(REPO_ROOT, 'scripts'),
    'scripts',
  );

  return [
    'LICENSE',
    'README.md',
    'package.json',
    'bin/wharfie',
    'src/app.js',
    'src/app.d.ts',
    ...verificationFiles,
    ...coreFiles,
    ...cliFiles,
  ];
}

/**
 * @param {{ files?: Array<{ path?: string }> }} manifest - `npm pack --json` result.
 * @returns {void}
 */
export function assertPackageContents(manifest) {
  const packedFiles = new Set(
    (manifest.files || [])
      .map((file) => file.path)
      .filter((filePath) => typeof filePath === 'string'),
  );

  for (const requiredPath of requiredRuntimeFiles()) {
    assert.ok(
      packedFiles.has(requiredPath),
      `npm tarball is missing required runtime file: ${requiredPath}`,
    );
  }

  for (const packedPath of packedFiles) {
    assert.ok(
      !packedPath.startsWith('apps/wharfie-v1/'),
      `npm tarball includes obsolete v1 app content: ${packedPath}`,
    );
    assert.ok(
      !packedPath.startsWith('src/cli/project/project_structure_examples/'),
      `npm tarball includes intentionally unsupported v1 init assets: ${packedPath}`,
    );
    assert.ok(
      !packedPath.startsWith('src/cli/assets/'),
      `npm tarball includes obsolete v1 init asset helpers: ${packedPath}`,
    );
    assert.ok(
      !EXCLUDED_LEGACY_CLI_FILES.has(packedPath),
      `npm tarball includes obsolete legacy CLI module: ${packedPath}`,
    );
    assert.ok(
      !packedPath.startsWith('scratch/'),
      `npm tarball includes scratch content: ${packedPath}`,
    );
  }

  const packageMetadata = readJson(path.join(REPO_ROOT, 'package.json'));
  assert.equal(
    WHARFIE_VERSION,
    packageMetadata.version,
    'runtime version must come from package.json',
  );
  assert.equal(packageMetadata.license, 'Apache-2.0');
  assert.equal(packageMetadata.exports?.['./app']?.types, './src/app.d.ts');
  assert.equal(packageMetadata.exports?.['./app']?.import, './src/app.js');
  assert.match(packageMetadata.packageManager, /^npm@\d+\.\d+\.\d+$/);
  assert.equal(
    Object.hasOwn(packageMetadata.engines || {}, 'npm'),
    false,
    'npm is a contributor tool pin, not a runtime engine requirement',
  );
}

/**
 * Create and validate the package tarball without installing dependencies.
 * @returns {{ directory: string, manifest: Record<string, any>, tarballPath: string, cleanup: () => void }} - Packed artifact and cleanup handle.
 */
export function createPackageTarball() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'wharfie-package-'));

  try {
    const { stdout } = runCommand(
      NPM_COMMAND,
      ['pack', '--json', '--ignore-scripts', '--pack-destination', directory],
      {
        cwd: REPO_ROOT,
        capture: true,
        env: {
          ...process.env,
          npm_config_cache: path.join(directory, 'npm-cache'),
        },
      },
    );
    const results = JSON.parse(stdout);
    assert.ok(Array.isArray(results) && results.length === 1);

    const manifest = results[0];
    assertPackageContents(manifest);

    const tarballPath = path.join(directory, manifest.filename);
    assert.ok(existsSync(tarballPath), `Missing npm tarball: ${tarballPath}`);

    return {
      directory,
      manifest,
      tarballPath,
      cleanup: () => rmSync(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
