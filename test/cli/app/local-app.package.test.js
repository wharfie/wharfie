/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { packageLocalApp } from '../../../src/cli/app/local-app.js';
import {
  APP_MANIFEST_ASSET_NAME,
  APP_MANIFEST_ASSET_PREFIX,
} from '../../../src/core/resources/builds/lib/app-manifest-asset.js';
import ActorSystem from '../../../src/core/resources/builds/actor-system.js';
import FunctionResource from '../../../src/core/resources/builds/function-resource.js';
import NodeBinary from '../../../src/core/resources/builds/node-binary.js';
import SeaBuild from '../../../src/core/resources/builds/sea-build.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const helloWorldDir = path.join(
  repoRoot,
  'scratch',
  'examples',
  'actor-systems',
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
 */
async function writeTransactionalPackageApp(dir, appName, targets) {
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
  name: ${JSON.stringify(appName)},
  cli: { entrypoint: './src/cli.js' },
  targets: ${JSON.stringify(targets, null, 2)},
};
`,
      'utf8',
    ),
  ]);
}

/**
 * @param {string} appName - App name.
 * @param {{ nodeVersion: string, platform: string, architecture: string, libc?: string }} target - Build target.
 * @returns {string} - Artifact file name.
 */
function getArtifactFileName(appName, target) {
  const canonicalTarget =
    target.platform === 'linux' && !target.libc
      ? { ...target, libc: 'glibc' }
      : target;
  return `${appName}-${getTargetSelector(canonicalTarget)}${
    target.platform === 'win32' ? '.exe' : ''
  }`;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('packageLocalApp', () => {
  it('packages a plain-object app through the v2 packaging path', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-plain-object-package-'),
    );
    const outputDir = path.join(dir, 'dist-output');
    /** @type {string | undefined} */
    let temporaryManifestPath;

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
  name: 'plain-object-package-demo',
  cli: {
    entrypoint: './src/cli.js',
    export: 'launch',
  },
  targets: [
    {
      nodeVersion: process.versions.node,
      platform: process.platform,
      architecture: process.arch,
    },
  ],
  packaging: {
    signing: {
      macos: {
        certificateBase64: 'certificate-data',
        certificatePassword: 'certificate-password',
        keychainPassword: 'keychain-password',
      },
    },
  },
  resources: {
    db: {
      adapter: 'vanilla',
      options: { path: '.wharfie/runtime' },
    },
  },
  activities: {
    hello: {
      entrypoint: {
        path: './src/activities/hello.js',
        export: 'hello',
      },
    },
  },
};
`,
          'utf8',
        ),
      ]);

      jest
        .spyOn(ActorSystem.prototype, 'initializeEnvironment')
        .mockImplementation(
          /** @this {ActorSystem} */ async function () {
            expect(this.get('cli')).toEqual({
              entrypoint: path.join(dir, 'src', 'cli.js'),
              export: 'launch',
            });
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
          const buildDir = path.join(dir, '.fake-builds');
          await fsp.mkdir(buildDir, { recursive: true });

          for (const resource of this.getResources()) {
            if (resource instanceof SeaBuild) {
              const manifestAssetPath = resource.get('assets', {})[
                APP_MANIFEST_ASSET_NAME
              ];
              temporaryManifestPath = manifestAssetPath;
              expect((await fsp.stat(manifestAssetPath)).mode & 0o777).toBe(
                0o600,
              );
              const embeddedManifest = JSON.parse(
                await fsp.readFile(manifestAssetPath, 'utf8'),
              );
              expect(embeddedManifest.cli).toEqual({
                entrypoint: 'wharfie:embedded/cli',
                export: 'launch',
              });
              expect(embeddedManifest.activities.hello.entrypoint).toEqual({
                path: 'wharfie:embedded/activity/hello',
                export: 'hello',
              });
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
      });

      expect(result.app).toEqual({ name: 'plain-object-package-demo' });
      expect(result.targets).toEqual([currentTarget]);
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0]).toEqual(
        expect.objectContaining({
          fileName: `plain-object-package-demo-${getTargetSelector(currentTarget)}${
            process.platform === 'win32' ? '.exe' : ''
          }`,
          target: currentTarget,
        }),
      );
      expect(existsSync(result.artifacts[0].path)).toBe(true);
      await expect(
        fsp.readFile(result.artifacts[0].path, 'utf8'),
      ).resolves.toBe(`#!/bin/sh\necho ${getTargetSelector(currentTarget)}\n`);
      expect(temporaryManifestPath).toEqual(expect.any(String));
      expect(existsSync(String(temporaryManifestPath))).toBe(false);
      expect(
        (await fsp.readdir(outputDir)).some((entry) =>
          entry.startsWith('.wharfie-package-'),
        ),
      ).toBe(false);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('packages ActorSystem apps before NodeBinary exactVersion exists', async () => {
    const outputDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-actor-system-package-'),
    );

    jest.spyOn(ActorSystem.prototype, 'reconcile').mockImplementation(
      /** @this {ActorSystem} */ async function () {
        const buildDir = path.join(outputDir, '.fake-builds');
        await fsp.mkdir(buildDir, { recursive: true });

        for (const resource of this.getResources()) {
          if (resource instanceof NodeBinary) {
            expect(resource.has('exactVersion')).toBe(false);
          }

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
      });

      expect(result.app).toEqual({ name: 'hello-world-demo' });
      expect(result.targets).toEqual([currentTarget]);
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0]).toEqual(
        expect.objectContaining({
          fileName: `hello-world-demo-${getTargetSelector(currentTarget)}${
            process.platform === 'win32' ? '.exe' : ''
          }`,
          target: currentTarget,
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
  name: 'incompatible-target-demo',
  cli: { entrypoint: './src/cli.js' },
  targets: [{
    nodeVersion: '${mismatchedNodeVersion}',
    platform: process.platform,
    architecture: process.arch,
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
  name: 'musl-target-demo',
  cli: { entrypoint: './src/cli.js' },
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
        /official Node\.js Linux binaries require glibc/i,
      );
      expect(initializeEnvironment).not.toHaveBeenCalled();
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ['platform', 'macos', 'x64', /Expected darwin, linux, or win32/i],
    ['architecture', 'linux', 'amd64', /Expected arm64 or x64/i],
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
  name: 'invalid-target-demo',
  cli: { entrypoint: './src/cli.js' },
  targets: [{
    nodeVersion: process.versions.node,
    platform: '${platform}',
    architecture: '${architecture}',
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
  name: '../escaped-app',
  cli: { entrypoint: './src/cli.js' },
  targets: [{
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
  }],
};
`,
        ),
      ]);

      await expect(packageLocalApp({ dir })).rejects.toThrow(
        /app\.name must be a lowercase portable identifier/i,
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
      /names beginning with '<WHARFIE_APP>\/' are reserved/i,
    ],
    [
      'an unembedded host-native resource adapter',
      'activity',
      "resources: { db: { adapter: 'lmdb' } },",
      /adapter 'lmdb'.*native runtime is not embedded/i,
    ],
    [
      'a scheduler without a portable durable store',
      'activity',
      "scheduler: { triggers: [{ activity: 'activity', cron: '* * * * *' }] },",
      /cannot package scheduler triggers.*durable operations store/i,
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
  name: 'nonportable-demo',
  cli: { entrypoint: './src/cli.js' },
  targets: [{
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
  }],
  ${contractDeclaration}
  activities: {
    ${JSON.stringify(activityName)}: {
      entrypoint: { path: './src/activity.js' },
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
  name: 'duplicate-target-demo',
  cli: { entrypoint: './src/cli.js' },
  targets: [target, { ...target, libc: 'glibc' }],
};
`,
        ),
      ]);

      await expect(packageLocalApp({ dir })).rejects.toThrow(
        /build targets must be unique/i,
      );
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('revalidates selector-dependent ActorSystem manifests after reloading', async () => {
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

const selectorDependent = Boolean(
  ActorSystem.getRequestedBuildTargetSelectors()?.length,
);

export default new ActorSystem({
  name: 'filtered-portability',
  properties: {
    targets: [{
      nodeVersion: process.versions.node,
      platform: process.platform,
      architecture: process.arch,
    }],
    resources: selectorDependent ? { db: { adapter: 'lmdb' } } : {},
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
      expect(output.message).toMatch(
        /adapter 'lmdb'.*native runtime is not embedded/i,
      );
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ['hello', './src/activity.js', /reserved for Wharfie runtime content/i],
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
  name: 'invalid-asset-demo',
  cli: { entrypoint: './src/cli.js' },
  targets: [{
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
  }],
  activities: {
    hello: { entrypoint: { path: './src/activity.js' } },
  },
  packaging: {
    assets: { ${JSON.stringify(assetName)}: ${JSON.stringify(assetPath)} },
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
  name: 'inline-env-demo',
  cli: { entrypoint: './src/cli.js' },
  targets: [{
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
  }],
  activities: {
    activity: {
      entrypoint: { path: './src/activity.js' },
      environmentVariables: { API_TOKEN_VALUE: '${secret}' },
    },
  },
};
`,
        ),
      ]);

      const result = packageLocalApp({ dir });
      await expect(result).rejects.toThrow(
        /activity 'activity'.*environmentVariables.*not supported/i,
      );
      await expect(result).rejects.not.toThrow(secret);
      expect(initializeEnvironment).not.toHaveBeenCalled();
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects inline secret-like resource options without rendering values', async () => {
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
  name: 'inline-secret-demo',
  cli: { entrypoint: './src/cli.js' },
  targets: [{
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
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
        /inline secret-like values.*inspectable manifest/i,
      );
      await expect(result).rejects.not.toThrow(secret);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects unreviewed resource options without embedding or rendering values', async () => {
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
          path.join(dir, 'wharfie.app.js'),
          `export default {
  name: 'unreviewed-option-demo',
  cli: { entrypoint: './src/cli.js' },
  targets: [{
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
  }],
  resources: {
    db: {
      adapter: 'vanilla',
      options: { opaqueRuntimeValue: '${secret}' },
    },
  },
};
`,
        ),
      ]);

      const result = packageLocalApp({ dir });
      await expect(result).rejects.toThrow(
        /opaqueRuntimeValue.*not part of.*portable public configuration schema/i,
      );
      await expect(result).rejects.not.toThrow(secret);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects workflows before embedding arbitrary inputs', async () => {
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
  name: 'workflow-package-demo',
  cli: { entrypoint: './src/cli.js' },
  targets: [{
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
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
        /cannot package workflows yet.*reviewed portable public schema/i,
      );
      await expect(result).rejects.not.toThrow(secret);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('removes function and manifest temp assets when reconciliation fails', async () => {
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

  it('leaves existing outputs untouched and removes staging when a staged copy fails', async () => {
    const dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-package-copy-transaction-'),
    );
    const outputDir = path.join(dir, 'dist');
    const appName = 'copy-transaction-demo';
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
    const firstOutput = path.join(
      outputDir,
      getArtifactFileName(appName, targets[0]),
    );
    const secondOutput = path.join(
      outputDir,
      getArtifactFileName(appName, targets[1]),
    );

    try {
      await writeTransactionalPackageApp(dir, appName, targets);
      await fsp.mkdir(outputDir, { recursive: true });
      await fsp.writeFile(firstOutput, 'previous-artifact', 'utf8');

      jest.spyOn(ActorSystem.prototype, 'reconcile').mockImplementation(
        /** @this {ActorSystem} */ async function () {
          const buildDir = path.join(dir, '.fake-builds');
          await fsp.mkdir(buildDir, { recursive: true });
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

      const copyFile = fsp.copyFile.bind(fsp);
      let stagedCopyCount = 0;
      jest
        .spyOn(fsp, 'copyFile')
        .mockImplementation(async (source, destination, mode) => {
          if (String(destination).includes('.wharfie-package-')) {
            stagedCopyCount += 1;
            if (stagedCopyCount === 2) {
              throw new Error('staged-copy-failure-sentinel');
            }
          }
          if (mode === undefined) return copyFile(source, destination);
          return copyFile(source, destination, mode);
        });

      await expect(packageLocalApp({ dir, outputDir })).rejects.toThrow(
        'staged-copy-failure-sentinel',
      );
      await expect(fsp.readFile(firstOutput, 'utf8')).resolves.toBe(
        'previous-artifact',
      );
      expect(existsSync(secondOutput)).toBe(false);
      expect(await fsp.readdir(outputDir)).toEqual([
        path.basename(firstOutput),
      ]);
    } finally {
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
    const firstOutput = path.join(
      outputDir,
      getArtifactFileName(appName, targets[0]),
    );
    const secondOutput = path.join(
      outputDir,
      getArtifactFileName(appName, targets[1]),
    );

    try {
      await writeTransactionalPackageApp(dir, appName, targets);
      await fsp.mkdir(outputDir, { recursive: true });
      await fsp.writeFile(firstOutput, 'previous-artifact', 'utf8');

      jest.spyOn(ActorSystem.prototype, 'reconcile').mockImplementation(
        /** @this {ActorSystem} */ async function () {
          const buildDir = path.join(dir, '.fake-builds');
          await fsp.mkdir(buildDir, { recursive: true });
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

      const rename = fsp.rename.bind(fsp);
      let publishRenameCount = 0;
      jest
        .spyOn(fsp, 'rename')
        .mockImplementation(async (source, destination) => {
          if (
            String(source).includes('.wharfie-package-') &&
            path.dirname(String(destination)) === outputDir &&
            path.basename(path.dirname(String(source))) === 'ready'
          ) {
            publishRenameCount += 1;
            if (publishRenameCount === 2) {
              throw new Error('publish-rename-failure-sentinel');
            }
          }
          return rename(source, destination);
        });

      await expect(packageLocalApp({ dir, outputDir })).rejects.toThrow(
        'publish-rename-failure-sentinel',
      );
      await expect(fsp.readFile(firstOutput, 'utf8')).resolves.toBe(
        'previous-artifact',
      );
      expect(existsSync(secondOutput)).toBe(false);
      expect(await fsp.readdir(outputDir)).toEqual([
        path.basename(firstOutput),
      ]);
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
          await fsp.mkdir(buildDir, { recursive: true });
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
        expect.objectContaining({ app: { name: appName } }),
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

  it('preserves transaction backups when rollback restoration is incomplete', async () => {
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
    const firstOutput = path.join(
      outputDir,
      getArtifactFileName(appName, targets[0]),
    );
    const secondOutput = path.join(
      outputDir,
      getArtifactFileName(appName, targets[1]),
    );

    try {
      await writeTransactionalPackageApp(dir, appName, targets);
      await fsp.mkdir(outputDir, { recursive: true });
      await fsp.writeFile(firstOutput, 'previous-artifact', 'utf8');

      jest.spyOn(ActorSystem.prototype, 'reconcile').mockImplementation(
        /** @this {ActorSystem} */ async function () {
          const buildDir = path.join(dir, '.fake-builds');
          await fsp.mkdir(buildDir, { recursive: true });
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

      const rename = fsp.rename.bind(fsp);
      jest
        .spyOn(fsp, 'rename')
        .mockImplementation(async (source, destination) => {
          const sourcePath = String(source);
          const destinationPath = String(destination);
          if (
            path.basename(path.dirname(sourcePath)) === 'ready' &&
            destinationPath === secondOutput
          ) {
            throw new Error('publish-failure-sentinel');
          }
          if (
            path.basename(path.dirname(sourcePath)) === 'backups' &&
            destinationPath === firstOutput
          ) {
            throw new Error('restore-failure-sentinel');
          }
          return rename(source, destination);
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
      await expect(
        fsp.readFile(path.join(recoveryPath, 'backups', '0'), 'utf8'),
      ).resolves.toBe('previous-artifact');
      expect(existsSync(firstOutput)).toBe(false);
      expect(existsSync(secondOutput)).toBe(false);
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
