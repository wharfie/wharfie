/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it } from '@jest/globals';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  compileApplicationRevision,
  createBehaviorAssetInputs,
  createDependencyLockInput,
  getTargetIndependentAppContract,
  prepareApplicationRevision,
} from '../../../src/cli/app/compile-application-revision.js';

/** @type {string[]} */
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fsp.rm(directory, { force: true, recursive: true })),
  );
});

/** @param {string} prefix - Temporary directory prefix. */
async function makeDirectory(prefix) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function makeRuntimeFixture() {
  const root = await makeDirectory('wharfie-revision-runtime-');
  await Promise.all([
    fsp.mkdir(path.join(root, 'src'), { recursive: true }),
    fsp.mkdir(path.join(root, 'bin'), { recursive: true }),
  ]);
  await Promise.all([
    fsp.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ name: '@wharfie/wharfie', version: '1.2.3' }),
    ),
    fsp.writeFile(
      path.join(root, 'src', 'runtime.js'),
      'export const v = 1;\n',
    ),
    fsp.writeFile(path.join(root, 'bin', 'wharfie'), '#!/usr/bin/env node\n'),
  ]);
  return root;
}

/**
 * @param {{ nodeVersion: string, platform: string, architecture: string, libc?: string }[]} [targets] - Build requests.
 * @returns {Record<string, any>} - Strict manifest fixture.
 */
function makeManifest(
  targets = [
    {
      nodeVersion: '24.13.1',
      platform: 'darwin',
      architecture: 'arm64',
    },
  ],
) {
  return {
    schemaVersion: 2,
    app: { id: 'revision-demo' },
    cli: {
      entrypoint: { kind: 'node', path: 'src/cli.js', export: 'main' },
    },
    targets,
    activities: {
      greet: {
        entrypoint: {
          kind: 'node',
          path: 'src/activity.js',
          export: 'greet',
        },
      },
    },
  };
}

async function makeAppFixture() {
  const root = await makeDirectory('wharfie-revision-app-');
  await fsp.mkdir(path.join(root, 'src'), { recursive: true });
  await Promise.all([
    fsp.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'revision-demo', private: true, type: 'module' }),
    ),
    fsp.writeFile(
      path.join(root, 'wharfie.app.js'),
      'export default { targets: ["build-request-only"] };\n',
    ),
    fsp.writeFile(
      path.join(root, 'src', 'cli.js'),
      'export async function main() { return "one"; }\n',
    ),
    fsp.writeFile(
      path.join(root, 'src', 'activity.js'),
      'export async function greet() { return "hello"; }\n',
    ),
  ]);
  return root;
}

describe('compileApplicationRevision', () => {
  it('builds and executes from a sealed snapshot instead of later authored edits', async () => {
    const appDir = await makeAppFixture();
    const runtimeRoot = await makeRuntimeFixture();
    const sourcePath = path.join(appDir, 'src', 'cli.js');
    const originalSource = await fsp.readFile(sourcePath, 'utf8');
    const prepared = await prepareApplicationRevision({
      appDir,
      manifest: makeManifest(),
      runtimeRoot,
    });

    try {
      expect(prepared.appDir).not.toBe(appDir);
      await fsp.writeFile(
        sourcePath,
        'export async function main() { return "edited"; }\n',
      );
      await expect(
        fsp.readFile(path.join(prepared.appDir, 'src', 'cli.js'), 'utf8'),
      ).resolves.toBe(originalSource);
      await expect(
        fsp.writeFile(
          path.join(prepared.appDir, 'src', 'cli.js'),
          'mutated snapshot',
        ),
      ).rejects.toThrow();

      const changed = await compileApplicationRevision({
        appDir,
        manifest: makeManifest(),
        runtimeRoot,
      });
      expect(changed.revisionId).not.toBe(prepared.revision.revisionId);
    } finally {
      await prepared.cleanup();
    }
  });

  it('rejects transitive source escapes and undeclared installed packages', async () => {
    const appDir = await makeAppFixture();
    const runtimeRoot = await makeRuntimeFixture();
    const outsidePath = path.join(
      path.dirname(appDir),
      `${path.basename(appDir)}-outside.js`,
    );
    temporaryDirectories.push(outsidePath);
    await fsp.writeFile(
      outsidePath,
      'export async function main() { return "outside"; }\n',
    );
    await fsp.writeFile(
      path.join(appDir, 'src', 'cli.js'),
      `export { main } from '../../${path.basename(outsidePath)}';\n`,
    );

    await expect(
      compileApplicationRevision({
        appDir,
        manifest: makeManifest(),
        runtimeRoot,
      }),
    ).rejects.toThrow(/closed portable module graph/i);

    await Promise.all([
      fsp.mkdir(path.join(appDir, 'node_modules', 'rogue'), {
        recursive: true,
      }),
      fsp.writeFile(
        path.join(appDir, 'src', 'cli.js'),
        `import { value } from 'rogue';\nexport async function main() { return value; }\n`,
      ),
    ]);
    await Promise.all([
      fsp.writeFile(
        path.join(appDir, 'node_modules', 'rogue', 'package.json'),
        JSON.stringify({ name: 'rogue', version: '1.0.0', type: 'module' }),
      ),
      fsp.writeFile(
        path.join(appDir, 'node_modules', 'rogue', 'index.js'),
        'export const value = "mutable install";\n',
      ),
    ]);

    await expect(
      compileApplicationRevision({
        appDir,
        manifest: makeManifest(),
        runtimeRoot,
      }),
    ).rejects.toThrow(/outside the immutable app snapshot/i);
  });

  it('rejects declared entrypoints in revision-excluded directories', async () => {
    const appDir = await makeAppFixture();
    const runtimeRoot = await makeRuntimeFixture();
    await fsp.mkdir(path.join(appDir, 'dist'), { recursive: true });
    await fsp.writeFile(
      path.join(appDir, 'dist', 'cli.js'),
      'export async function main() {}\n',
    );
    const manifest = makeManifest();
    manifest.cli.entrypoint.path = 'dist/cli.js';

    await expect(
      compileApplicationRevision({ appDir, manifest, runtimeRoot }),
    ).rejects.toThrow(/excluded from immutable application revisions/i);
  });

  it('keeps target and output changes out while fencing source changes', async () => {
    const appDir = await makeAppFixture();
    const runtimeRoot = await makeRuntimeFixture();
    const outputDir = path.join(appDir, 'dist');
    await fsp.mkdir(outputDir);

    const first = await compileApplicationRevision({
      appDir,
      manifest: makeManifest(),
      outputDir,
      runtimeRoot,
    });

    await Promise.all([
      fsp.writeFile(path.join(outputDir, 'old-artifact'), 'ignored output'),
      fsp.mkdir(path.join(appDir, '.wharfie'), { recursive: true }),
      fsp.writeFile(
        path.join(appDir, 'wharfie.app.js'),
        'export default { targets: ["another-build-request"] };\n',
      ),
    ]);
    await fsp.writeFile(
      path.join(appDir, '.wharfie', 'runtime-state'),
      'ignored mutable state',
    );
    const second = await compileApplicationRevision({
      appDir,
      manifest: makeManifest([
        {
          nodeVersion: '24.13.1',
          platform: 'linux',
          architecture: 'x64',
          libc: 'glibc',
        },
      ]),
      outputDir,
      runtimeRoot,
    });

    expect(second.revisionId).toBe(first.revisionId);
    expect(second.contract).not.toHaveProperty('targets');

    await fsp.writeFile(
      path.join(appDir, 'src', 'cli.js'),
      'export async function main() { return "two"; }\n',
    );
    const changed = await compileApplicationRevision({
      appDir,
      manifest: makeManifest(),
      outputDir,
      runtimeRoot,
    });
    expect(changed.revisionId).not.toBe(first.revisionId);
  });

  it('locks dependency, runtime, and named behavior-asset bytes', async () => {
    const appDir = await makeAppFixture();
    const runtimeRoot = await makeRuntimeFixture();
    const assetPath = path.join(appDir, 'policy.txt');
    const lockPath = path.join(appDir, 'package-lock.json');
    await Promise.all([
      fsp.writeFile(assetPath, 'allow one\n'),
      fsp.writeFile(
        lockPath,
        JSON.stringify({ packages: {}, lockfileVersion: 3 }),
      ),
    ]);

    const first = await compileApplicationRevision({
      appDir,
      manifest: makeManifest(),
      assets: { policy: assetPath },
      runtimeRoot,
    });

    await fsp.writeFile(assetPath, 'allow two\n');
    const changedAsset = await compileApplicationRevision({
      appDir,
      manifest: makeManifest(),
      assets: { policy: assetPath },
      runtimeRoot,
    });
    expect(changedAsset.revisionId).not.toBe(first.revisionId);

    await fsp.writeFile(
      path.join(runtimeRoot, 'src', 'runtime.js'),
      'export const v = 2;\n',
    );
    const changedRuntime = await compileApplicationRevision({
      appDir,
      manifest: makeManifest(),
      assets: { policy: assetPath },
      runtimeRoot,
    });
    expect(changedRuntime.revisionId).not.toBe(changedAsset.revisionId);

    await fsp.writeFile(
      lockPath,
      JSON.stringify({ lockfileVersion: 3, packages: {}, changed: true }),
    );
    const changedLock = await compileApplicationRevision({
      appDir,
      manifest: makeManifest(),
      assets: { policy: assetPath },
      runtimeRoot,
    });
    expect(changedLock.revisionId).not.toBe(changedRuntime.revisionId);
  });

  it('requires exact locked external packages and dependency declarations', async () => {
    const appDir = await makeAppFixture();
    const contract = getTargetIndependentAppContract({
      ...makeManifest(),
      activities: {
        greet: {
          entrypoint: {
            kind: 'node',
            path: 'src/activity.js',
            export: 'greet',
          },
          externalPackages: [{ name: 'sharp', version: '1.2.3' }],
        },
      },
    });

    await expect(createDependencyLockInput(appDir, contract)).rejects.toThrow(
      'require a package-lock.json',
    );

    const lockPath = path.join(appDir, 'package-lock.json');
    await fsp.writeFile(
      lockPath,
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { dependencies: { sharp: '^1.0.0' } },
          'node_modules/sharp': { version: '1.2.2' },
        },
      }),
    );
    await expect(createDependencyLockInput(appDir, contract)).rejects.toThrow(
      "must lock exact external version '1.2.3'",
    );

    await fsp.writeFile(
      lockPath,
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { devDependencies: { sharp: '1.2.3' } },
          'node_modules/sharp': { version: '1.2.3' },
        },
      }),
    );
    await expect(createDependencyLockInput(appDir, contract)).rejects.toThrow(
      "must declare external 'sharp' as a production or optional dependency",
    );

    await fsp.writeFile(
      lockPath,
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { dependencies: { sharp: '^1.0.0' } },
          'node_modules/sharp': { version: '1.2.3' },
        },
      }),
    );
    await expect(createDependencyLockInput(appDir, contract)).resolves.toEqual(
      expect.objectContaining({
        format: 'wharfie-npm-package-lock-v3-closure-v1',
      }),
    );
  });

  it('rejects an enclosing workspace lock until its package root is explicit', async () => {
    const workspaceDir = await makeDirectory('wharfie-workspace-lock-');
    const appDir = path.join(workspaceDir, 'apps', 'revision-demo');
    await fsp.mkdir(appDir, { recursive: true });
    await Promise.all([
      fsp.writeFile(
        path.join(appDir, 'package.json'),
        JSON.stringify({
          name: 'revision-demo',
          private: true,
          dependencies: { sharp: '1.2.3' },
        }),
      ),
      fsp.writeFile(
        path.join(workspaceDir, 'package-lock.json'),
        JSON.stringify({
          lockfileVersion: 3,
          packages: {
            '': { dependencies: { sharp: '1.2.3' } },
            'node_modules/sharp': { version: '1.2.3' },
          },
        }),
      ),
    ]);

    await expect(
      createDependencyLockInput(
        appDir,
        getTargetIndependentAppContract(makeManifest()),
      ),
    ).rejects.toThrow(/require a package-lock\.json/i);
  });

  it('rejects source symlinks and noncanonical behavior asset names', async () => {
    const appDir = await makeAppFixture();
    const runtimeRoot = await makeRuntimeFixture();
    const externalFile = path.join(
      await makeDirectory('wharfie-external-'),
      'x',
    );
    await fsp.writeFile(externalFile, 'outside');
    await fsp.symlink(externalFile, path.join(appDir, 'src', 'linked.js'));

    await expect(
      compileApplicationRevision({
        appDir,
        manifest: makeManifest(),
        runtimeRoot,
      }),
    ).rejects.toThrow('must not be a symbolic link');

    await expect(
      createBehaviorAssetInputs({ 'Not Canonical': externalFile }),
    ).rejects.toThrow('canonical logical ID');
  });
});
