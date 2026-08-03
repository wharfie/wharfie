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
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DEPENDENCY_LOCK_INPUT_FORMAT } from '../../../src/core/runtime/application-revision.js';
import {
  ACTIVITY_PROTOCOL_NAME,
  ACTIVITY_PROTOCOL_VERSION,
} from '../../../src/core/runtime/activity-protocol.js';

const NODE_SEA_IMPORT = '../../../src/core/lib/node-sea.js';

const seaAssets = new Map();

jest.unstable_mockModule(NODE_SEA_IMPORT, () => ({
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
  '../../../src/core/resources/builds/lib/install-deps.js';
const FUNCTION_RESOURCE_IMPORT =
  '../../../src/core/resources/builds/function-resource.js';
const FUNCTION_IMPORT = '../../../src/core/resources/builds/function.js';
const WORKER_IMPORT = '../../../src/core/lib/code-execution/worker.js';

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
    const dependencyLockPath = path.join(tmpRoot, 'package-lock.json');
    const outputFile = path.join(tmpRoot, 'marker.txt');
    const functionName = 'bundled-native-externals';
    const dependencyLockBytes = Buffer.from(
      `${JSON.stringify({
        name: 'function-bundled-externals-test',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': {
            name: 'function-bundled-externals-test',
            version: '1.0.0',
            dependencies: { 'fake-native': '1.0.0' },
          },
          'node_modules/fake-native': {
            version: '1.0.0',
            resolved:
              'https://registry.npmjs.org/fake-native/-/fake-native-1.0.0.tgz',
            integrity:
              'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
          },
        },
      })}\n`,
      'utf8',
    );
    const dependencyLock = {
      path: dependencyLockPath,
      input: {
        format: DEPENDENCY_LOCK_INPUT_FORMAT,
        digest: {
          algorithm: 'sha256',
          value: createHash('sha256')
            .update(dependencyLockBytes)
            .digest('base64url'),
        },
      },
    };
    const closureDigest = {
      algorithm: 'sha256',
      value: createHash('sha256')
        .update('fake-native frozen closure')
        .digest('base64url'),
    };
    /** @type {string | undefined} */
    let externalsTmpDir;
    const installForTarget = jest.fn(
      async ({
        activity,
        buildTarget,
        tmpBuildDir,
        dependencyLock: receivedLock,
        externals,
      }) => {
        externalsTmpDir = tmpBuildDir;
        expect(activity).toBe(functionName);
        expect(receivedLock).toBe(dependencyLock);
        expect(externals).toEqual([{ name: 'fake-native', version: '1.0.0' }]);

        const packageDir = path.join(
          tmpBuildDir,
          'node_modules',
          'fake-native',
        );
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
        return {
          dependencyLockInput: dependencyLock.input,
          closureDigest,
          plan: {
            activity,
            target: buildTarget,
            roots: [
              {
                name: 'fake-native',
                version: '1.0.0',
                location: 'node_modules/fake-native',
              },
            ],
            lock: dependencyLock.input,
          },
        };
      },
    );

    await fsp.writeFile(
      entryPath,
      [
        "import * as fakeNativeModule from 'fake-native';",
        'const fakeNative = fakeNativeModule.default ?? fakeNativeModule;',
        'export async function handler(event) {',
        '  fakeNative.writeMarker(event.outputFile, event.who);',
        '  return { written: true };',
        '}',
      ].join('\n'),
      'utf8',
    );
    await fsp.writeFile(dependencyLockPath, dependencyLockBytes);

    await jest.unstable_mockModule(INSTALL_DEPS_IMPORT, () => ({
      installForTarget,
    }));

    const { default: FunctionResource } = await import(
      FUNCTION_RESOURCE_IMPORT
    );
    const { default: Function } = await import(FUNCTION_IMPORT);

    const resource = new FunctionResource({
      name: functionName,
      dependencyLock,
      properties: {
        functionName,
        entrypoint: { path: entryPath, export: 'handler' },
        buildTarget: {
          nodeVersion: process.versions.node,
          platform: process.platform,
          architecture: process.arch,
          ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
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
      expect(assetDescription.externalDependencyReceipt.archiveDigest).toEqual({
        algorithm: 'sha256',
        value: createHash('sha256')
          .update(Buffer.from(assetDescription.externalsTar, 'base64'))
          .digest('base64url'),
      });
      expect(resource.get('externalDependencyLockInput')).toEqual(
        dependencyLock.input,
      );
      expect(resource.get('externalClosureDigest')).toEqual(closureDigest);

      const evidence = await Function.runActivityAttempt(functionName, {
        protocol: ACTIVITY_PROTOCOL_NAME,
        protocolVersion: ACTIVITY_PROTOCOL_VERSION,
        type: 'start',
        revisionId: `wrv1_${'A'.repeat(43)}`,
        activityId: functionName,
        runId: 'run-bundled-native',
        invocationId: 'invocation-bundled-native',
        attemptId: 'attempt-bundled-native',
        fencingToken: 'fence-bundled-native',
        input: { outputFile, who: 'bundle-user' },
        caller: { metadata: { requestId: 'req-1' } },
      });

      expect(evidence.status).toBe('completed');
      expect(evidence.terminal.result).toEqual({ written: true });
      await expect(fsp.readFile(outputFile, 'utf8')).resolves.toEqual(
        'FAKE_NATIVE_BINARY:bundle-user',
      );
      expect(installForTarget).toHaveBeenCalledTimes(1);
      expect(installForTarget).toHaveBeenCalledWith(
        expect.objectContaining({
          buildTarget: expect.objectContaining({
            nodeVersion: process.versions.node,
            platform: process.platform,
            architecture: process.arch,
          }),
          externals: [{ name: 'fake-native', version: '1.0.0' }],
          tmpBuildDir: expect.any(String),
        }),
      );
      await expect(fsp.stat(String(externalsTmpDir))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await fsp.rm(resource.get('singleExecutableAssetPath'), { force: true });
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
  });
});
