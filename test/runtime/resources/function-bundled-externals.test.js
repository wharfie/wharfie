/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const seaAssets = new Map();

jest.unstable_mockModule('node:sea', () => ({
  getAsset: async (/** @type {string} */ name) => {
    const assetDescription = seaAssets.get(name);
    if (!assetDescription) {
      throw new Error(`Unexpected asset request: ${name}`);
    }
    return Buffer.from(JSON.stringify(assetDescription), 'utf8');
  },
  isSea: () => false,
}));

const INSTALL_DEPS_IMPORT =
  '../../../lambdas/lib/actor/resources/builds/lib/install-deps.js';
const FUNCTION_RESOURCE_IMPORT =
  '../../../lambdas/lib/actor/resources/builds/function-resource.js';
const FUNCTION_IMPORT =
  '../../../lambdas/lib/actor/resources/builds/function.js';
const WORKER_IMPORT = '../../../lambdas/lib/code-execution/worker.js';

describe('FunctionResource bundled externals', () => {
  beforeEach(() => {
    seaAssets.clear();
    jest.resetModules();
  });

  afterEach(async () => {
    const { default: worker } = await import(WORKER_IMPORT);
    await worker._destroyWorker();
    worker._clearSandboxCache();
    jest.restoreAllMocks();
  });

  it('packages hermetic externals and extracts them in the sandbox runtime', async () => {
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-function-externals-'),
    );
    const entryPath = path.join(tmpRoot, 'handler.js');
    const outputFile = path.join(tmpRoot, 'marker.txt');
    const functionName = 'bundled-native-externals';
    const installForTarget = jest.fn(async ({ tmpBuildDir, externals }) => {
      expect(externals).toEqual([{ name: 'fake-native', version: '1.0.0' }]);

      const packageDir = path.join(tmpBuildDir, 'node_modules', 'fake-native');
      await fsp.mkdir(packageDir, { recursive: true });
      await fsp.writeFile(
        path.join(packageDir, 'package.json'),
        JSON.stringify(
          {
            name: 'fake-native',
            version: '1.0.0',
            main: 'index.js',
          },
          null,
          2,
        ),
        'utf8',
      );
      await fsp.writeFile(
        path.join(packageDir, 'binding.node'),
        'FAKE_NATIVE_BINARY\n',
        'utf8',
      );
      await fsp.writeFile(
        path.join(packageDir, 'index.js'),
        [
          "const fs = require('node:fs');",
          "const path = require('node:path');",
          'exports.writeMarker = (outputPath, who) => {',
          "  const binding = fs.readFileSync(path.join(__dirname, 'binding.node'), 'utf8').trim();",
          "  fs.writeFileSync(outputPath, `${binding}:${who}`, 'utf8');",
          '};',
        ].join('\n'),
        'utf8',
      );
    });

    await fsp.writeFile(
      entryPath,
      [
        "import * as fakeNativeModule from 'fake-native';",
        'const fakeNative = fakeNativeModule.default ?? fakeNativeModule;',
        'export async function handler(event) {',
        '  fakeNative.writeMarker(event.outputFile, event.who);',
        '}',
      ].join('\n'),
      'utf8',
    );

    await jest.unstable_mockModule(INSTALL_DEPS_IMPORT, () => ({
      installForTarget,
    }));

    const { default: FunctionResource } = await import(
      FUNCTION_RESOURCE_IMPORT
    );
    const { default: Function } = await import(FUNCTION_IMPORT);

    const resource = new FunctionResource({
      name: functionName,
      properties: {
        functionName,
        entrypoint: { path: entryPath, export: 'handler' },
        buildTarget: {
          nodeVersion: process.versions.node.split('.')[0],
          platform: process.platform,
          architecture: process.arch,
        },
        external: [{ name: 'fake-native', version: '1.0.0' }],
      },
    });

    try {
      await resource.reconcile();
      const assetDescription = JSON.parse(
        await fsp.readFile(resource.get('singleExecutableAssetPath'), 'utf8'),
      );
      seaAssets.set(functionName, assetDescription);

      expect(assetDescription.externalsTar).toEqual(expect.any(String));
      expect(assetDescription.externalsTar.length).toBeGreaterThan(0);

      await Function.run(
        functionName,
        { outputFile, who: 'bundle-user' },
        { requestId: 'req-1' },
      );

      await expect(fsp.readFile(outputFile, 'utf8')).resolves.toEqual(
        'FAKE_NATIVE_BINARY:bundle-user',
      );
      expect(installForTarget).toHaveBeenCalledTimes(1);
      expect(installForTarget).toHaveBeenCalledWith(
        expect.objectContaining({
          buildTarget: expect.objectContaining({
            nodeVersion: process.versions.node.split('.')[0],
            platform: process.platform,
            architecture: process.arch,
          }),
          externals: [{ name: 'fake-native', version: '1.0.0' }],
          tmpBuildDir: expect.any(String),
        }),
      );
    } finally {
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
  });
});
