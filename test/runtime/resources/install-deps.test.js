/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { existsSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const INSTALL_DEPS_IMPORT =
  '../../../lambdas/lib/actor/resources/builds/lib/install-deps.js';

/**
 * @param {string} spec - spec.
 * @returns {{ name: string, version: string }} - Result.
 */
function parseSpec(spec) {
  const separatorIndex = spec.lastIndexOf('@');
  if (separatorIndex <= 0) {
    throw new Error(`Unexpected spec format: ${spec}`);
  }

  return {
    name: spec.slice(0, separatorIndex),
    version: spec.slice(separatorIndex + 1),
  };
}

describe('installForTarget', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('reifies normal deps, extracts target prebuilds, and only installs matching optional packages', async () => {
    const tmpBuildDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-install-for-target-'),
    );
    const consoleLogSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);

    /**
     * @param {Record<string, any>} _options - options.
     * @returns {Promise<void>} - Result.
     */
    const buildIdealTreeImpl = async (_options) => {};
    const buildIdealTree = jest.fn(buildIdealTreeImpl);
    /**
     * @param {Record<string, any>} _options - options.
     * @returns {Promise<void>} - Result.
     */
    const reifyImpl = async (_options) => {
      const basePackageDir = path.join(tmpBuildDir, 'node_modules', 'base-lib');
      await fsp.mkdir(path.join(basePackageDir, 'build'), {
        recursive: true,
      });
      await fsp.writeFile(
        path.join(basePackageDir, 'package.json'),
        JSON.stringify(
          {
            name: 'base-lib',
            version: '1.0.0',
            optionalDependencies: {
              'base-lib-linux-x64-gnu': '1.0.0',
              'base-lib-win32-x64': '1.0.0',
            },
          },
          null,
          2,
        ),
        'utf8',
      );
      await fsp.writeFile(
        path.join(basePackageDir, 'build', 'artifact.txt'),
        'remove me',
        'utf8',
      );
    };
    const reify = jest.fn(reifyImpl);

    class FakeArborist {
      /**
       * @param {Record<string, any>} options - options.
       */
      constructor(options) {
        this.options = options;
      }

      /**
       * @param {Record<string, any>} options - options.
       * @returns {Promise<void>} - Result.
       */
      async buildIdealTree(options) {
        return await buildIdealTree(options);
      }

      /**
       * @param {Record<string, any>} options - options.
       * @returns {Promise<void>} - Result.
       */
      async reify(options) {
        return await reify(options);
      }
    }

    /**
     * @param {string} spec - spec.
     * @returns {Promise<Record<string, any>>} - Result.
     */
    const manifestImpl = async (spec) => {
      switch (spec) {
        case 'base-lib@1.0.0':
          return { name: 'base-lib' };
        case '@scope/prebuilt-linux-x64@2.0.0':
          return {
            name: '@scope/prebuilt-linux-x64',
            os: ['linux'],
            cpu: ['x64'],
          };
        case 'base-lib-linux-x64-gnu@1.0.0':
          return {
            name: 'base-lib-linux-x64-gnu',
            os: ['linux'],
            cpu: ['x64'],
            libc: ['glibc'],
          };
        case 'base-lib-win32-x64@1.0.0':
          return {
            name: 'base-lib-win32-x64',
            os: ['win32'],
            cpu: ['x64'],
          };
        default:
          throw new Error(`Unexpected manifest lookup: ${spec}`);
      }
    };
    const manifest = jest.fn(manifestImpl);

    /**
     * @param {string} spec - spec.
     * @param {string} destination - destination.
     * @param {Record<string, any>} _options - options.
     * @returns {Promise<void>} - Result.
     */
    const extractImpl = async (spec, destination, _options) => {
      const parsed = parseSpec(spec);
      await fsp.mkdir(destination, { recursive: true });
      await fsp.writeFile(
        path.join(destination, 'package.json'),
        JSON.stringify(parsed, null, 2),
        'utf8',
      );
      await fsp.writeFile(
        path.join(destination, 'index.js'),
        `module.exports = ${JSON.stringify(parsed.name)};\n`,
        'utf8',
      );
    };
    const extract = jest.fn(extractImpl);

    await jest.unstable_mockModule('@npmcli/arborist', () => ({
      default: FakeArborist,
    }));
    await jest.unstable_mockModule('pacote', () => ({
      default: {
        manifest,
        extract,
      },
    }));

    const { installForTarget } = await import(INSTALL_DEPS_IMPORT);

    await installForTarget({
      buildTarget: {
        nodeVersion: '24.13.1',
        platform: 'linux',
        architecture: 'x64',
        libc: 'glibc',
      },
      externals: [
        { name: 'base-lib', version: '1.0.0' },
        { name: '@scope/prebuilt-linux-x64', version: '2.0.0' },
      ],
      tmpBuildDir,
    });

    expect(buildIdealTree).toHaveBeenCalledWith({
      add: ['base-lib@1.0.0'],
      saveType: 'prod',
      update: { all: true },
    });
    expect(reify).toHaveBeenCalledWith({
      save: true,
      omit: ['optional'],
    });
    expect(extract).toHaveBeenCalledTimes(2);
    expect(extract).toHaveBeenNthCalledWith(
      1,
      '@scope/prebuilt-linux-x64@2.0.0',
      path.join(tmpBuildDir, 'node_modules', '@scope', 'prebuilt-linux-x64'),
      expect.objectContaining({
        npmConfig: expect.objectContaining({ get: expect.any(Function) }),
      }),
    );
    expect(extract).toHaveBeenNthCalledWith(
      2,
      'base-lib-linux-x64-gnu@1.0.0',
      path.join(tmpBuildDir, 'node_modules', 'base-lib-linux-x64-gnu'),
      expect.objectContaining({
        npmConfig: expect.objectContaining({ get: expect.any(Function) }),
      }),
    );

    expect(
      existsSync(path.join(tmpBuildDir, 'node_modules', 'base-lib-win32-x64')),
    ).toBe(false);
    expect(
      existsSync(path.join(tmpBuildDir, 'node_modules', 'base-lib', 'build')),
    ).toBe(false);
    await expect(
      fsp.readFile(path.join(tmpBuildDir, '.npmrc'), 'utf8'),
    ).resolves.toContain('libc=glibc');
    await expect(
      fsp.readFile(path.join(tmpBuildDir, '.npmrc'), 'utf8'),
    ).resolves.toContain('ignore-scripts=true');
    expect(consoleLogSpy).toHaveBeenCalled();

    await fsp.rm(tmpBuildDir, { recursive: true, force: true });
  });
});
