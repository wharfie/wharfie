/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { existsSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { packageLocalApp } from '../../../src/cli/app/local-app.js';
import ActorSystem from '../../../src/core/resources/builds/actor-system.js';
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
};

/**
 * @param {{ nodeVersion: string, platform: string, architecture: string, libc?: string }} target - target.
 * @returns {string} - Result.
 */
function getTargetSelector(target) {
  return `node${target.nodeVersion}-${target.platform}-${target.architecture}${
    target.libc ? `-${target.libc}` : ''
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
          `export async function main(argv = process.argv) {\n  return argv;\n}\n\nexport default main;\n`,
          'utf8',
        ),
        fsp.writeFile(
          path.join(dir, 'src', 'activities', 'hello.js'),
          `export async function hello(event = {}) {\n  return { ok: true, event };\n}\n\nexport default hello;\n`,
          'utf8',
        ),
        fsp.writeFile(
          path.join(dir, 'wharfie.app.js'),
          `export default {\n  name: 'plain-object-package-demo',\n  cli: {\n    entrypoint: './src/cli.js',\n    export: 'main',\n  },\n  targets: [\n    {\n      nodeVersion: process.versions.node,\n      platform: process.platform,\n      architecture: process.arch,\n    },\n  ],\n  resources: {\n    db: {\n      adapter: 'vanilla',\n      options: { path: '.wharfie/runtime' },\n    },\n  },\n  activities: {\n    hello: {\n      entrypoint: {\n        path: './src/activities/hello.js',\n        export: 'hello',\n      },\n    },\n  },\n};\n`,
          'utf8',
        ),
      ]);

      jest
        .spyOn(ActorSystem.prototype, 'initializeEnvironment')
        .mockImplementation(
          /** @this {ActorSystem} */ async function () {
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
});
