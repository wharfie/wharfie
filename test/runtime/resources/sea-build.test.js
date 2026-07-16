/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHILD_PROCESS_IMPORT = 'node:child_process';
const MISMATCHED_NODE_VERSION =
  process.versions.node === '0.0.0' ? '0.0.1' : '0.0.0';

describe('SeaBuild', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it('fails instead of writing a non-SEA script fallback when builder Node lacks SEA support', async () => {
    jest.unstable_mockModule(CHILD_PROCESS_IMPORT, () => ({
      execFile: jest.fn(),
      spawn: jest.fn(),
      spawnSync: jest.fn(() => ({
        stdout: 'Usage: node\n',
        stderr: '',
        status: 0,
      })),
    }));

    const { default: SeaBuild } =
      await import('../../../src/core/resources/builds/sea-build.js');

    const build = new SeaBuild({
      name: 'no-sea-fallback',
      properties: {
        entryCode: 'console.log("never bundled")',
        resolveDir: process.cwd(),
        nodeBinaryPath: process.execPath,
        nodeVersion: process.versions.node,
        platform: process.platform,
        architecture: process.arch,
      },
    });

    await expect(build.build()).rejects.toThrow(
      /must be real Node SEA executables/i,
    );
  });

  it('rejects a different exact target Node version before checking SEA support', async () => {
    const spawnSync = jest.fn(() => ({
      stdout: 'Usage: node\n  --experimental-sea-config=...\n',
      stderr: '',
      status: 0,
    }));
    jest.unstable_mockModule(CHILD_PROCESS_IMPORT, () => ({
      execFile: jest.fn(),
      spawn: jest.fn(),
      spawnSync,
    }));

    const { default: SeaBuild } =
      await import('../../../src/core/resources/builds/sea-build.js');

    const build = new SeaBuild({
      name: 'mismatched-node-version',
      properties: {
        entryCode: 'console.log("never bundled")',
        resolveDir: process.cwd(),
        nodeBinaryPath: process.execPath,
        nodeVersion: MISMATCHED_NODE_VERSION,
        platform: process.platform,
        architecture: process.arch,
      },
    });

    await expect(build.build()).rejects.toThrow(
      /blob generator and target binary.*same exact Node version/i,
    );
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it.each([
    ['success', false],
    ['failure', true],
  ])('removes private SEA build trees after %s', async (_label, shouldFail) => {
    jest.unstable_mockModule(CHILD_PROCESS_IMPORT, () => ({
      execFile: jest.fn(),
      spawn: jest.fn(),
      spawnSync: jest.fn(() => ({
        stdout: 'Usage: node\n  --experimental-sea-config=...\n',
        stderr: '',
        status: 0,
      })),
    }));

    const { default: SeaBuild } =
      await import('../../../src/core/resources/builds/sea-build.js');
    const originalBuildDir = SeaBuild.BUILD_DIR;
    const originalBinariesDir = SeaBuild.BINARIES_DIR;
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-sea-build-cleanup-'),
    );
    const sourceBinary = path.join(tmpRoot, 'source-node');
    await fsp.writeFile(sourceBinary, 'node-binary', 'utf8');
    SeaBuild.BUILD_DIR = path.join(tmpRoot, 'builds');
    SeaBuild.BINARIES_DIR = path.join(tmpRoot, 'binaries');

    /** @type {string | undefined} */
    let observedBuildDir;
    /** @type {number | undefined} */
    let observedMode;
    const build = new SeaBuild({
      name: `cleanup-${shouldFail ? 'failure' : 'success'}`,
      properties: {
        entryCode: 'console.log("test")',
        resolveDir: process.cwd(),
        nodeBinaryPath: sourceBinary,
        nodeVersion: process.versions.node,
        platform: process.platform,
        architecture: process.arch,
      },
    });
    jest.spyOn(build, 'esbuild').mockImplementation(async (buildDir) => {
      observedBuildDir = buildDir;
      observedMode = (await fsp.stat(buildDir)).mode & 0o777;
    });
    jest.spyOn(build, 'seaBuild').mockImplementation(async () => {
      if (shouldFail) throw new Error('sea-build-failure-sentinel');
    });

    try {
      if (shouldFail) {
        await expect(build.build()).rejects.toThrow(
          'sea-build-failure-sentinel',
        );
      } else {
        await expect(build.build()).resolves.toBeUndefined();
        expect(existsSync(build.get('binaryPath'))).toBe(true);
      }
      expect(observedMode).toBe(0o700);
      expect(existsSync(String(observedBuildDir))).toBe(false);
    } finally {
      SeaBuild.BUILD_DIR = originalBuildDir;
      SeaBuild.BINARIES_DIR = originalBinariesDir;
      await fsp.rm(tmpRoot, { force: true, recursive: true });
    }
  });

  it('uses distinct binary paths for concurrent builds with the same resource name', async () => {
    jest.unstable_mockModule(CHILD_PROCESS_IMPORT, () => ({
      execFile: jest.fn(),
      spawn: jest.fn(),
      spawnSync: jest.fn(() => ({
        stdout: 'Usage: node\n  --experimental-sea-config=...\n',
        stderr: '',
        status: 0,
      })),
    }));

    const { default: SeaBuild } =
      await import('../../../src/core/resources/builds/sea-build.js');
    const originalBuildDir = SeaBuild.BUILD_DIR;
    const originalBinariesDir = SeaBuild.BINARIES_DIR;
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-sea-build-concurrent-'),
    );
    SeaBuild.BUILD_DIR = path.join(tmpRoot, 'builds');
    SeaBuild.BINARIES_DIR = path.join(tmpRoot, 'binaries');

    /**
     * @param {string} marker - Build output marker.
     * @returns {Promise<InstanceType<typeof SeaBuild>>} - Configured build.
     */
    const makeBuild = async (marker) => {
      const sourceBinary = path.join(tmpRoot, `source-node-${marker}`);
      await fsp.writeFile(sourceBinary, `node-${marker}`, 'utf8');
      const build = new SeaBuild({
        name: 'same-name',
        properties: {
          entryCode: 'console.log("test")',
          resolveDir: process.cwd(),
          nodeBinaryPath: sourceBinary,
          nodeVersion: process.versions.node,
          platform: process.platform,
          architecture: process.arch,
        },
      });
      jest.spyOn(build, 'esbuild').mockImplementation(async () => {});
      jest
        .spyOn(build, 'seaBuild')
        .mockImplementation(async (_buildDir, nodeBinaryPath) => {
          await fsp.writeFile(nodeBinaryPath, `built-${marker}`, 'utf8');
        });
      return build;
    };

    try {
      const [first, second] = await Promise.all([
        makeBuild('first'),
        makeBuild('second'),
      ]);
      await Promise.all([first.build(), second.build()]);

      expect(first.get('binaryPath')).not.toBe(second.get('binaryPath'));
      await expect(fsp.readFile(first.get('binaryPath'), 'utf8')).resolves.toBe(
        'built-first',
      );
      await expect(
        fsp.readFile(second.get('binaryPath'), 'utf8'),
      ).resolves.toBe('built-second');
    } finally {
      SeaBuild.BUILD_DIR = originalBuildDir;
      SeaBuild.BINARIES_DIR = originalBinariesDir;
      await fsp.rm(tmpRoot, { force: true, recursive: true });
    }
  });

  it('removes a partial unique binary when final publication fails', async () => {
    jest.unstable_mockModule(CHILD_PROCESS_IMPORT, () => ({
      execFile: jest.fn(),
      spawn: jest.fn(),
      spawnSync: jest.fn(() => ({
        stdout: 'Usage: node\n  --experimental-sea-config=...\n',
        stderr: '',
        status: 0,
      })),
    }));

    const { default: SeaBuild } =
      await import('../../../src/core/resources/builds/sea-build.js');
    const originalBuildDir = SeaBuild.BUILD_DIR;
    const originalBinariesDir = SeaBuild.BINARIES_DIR;
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-sea-build-partial-output-'),
    );
    const sourceBinary = path.join(tmpRoot, 'source-node');
    await fsp.writeFile(sourceBinary, 'node-binary', 'utf8');
    SeaBuild.BUILD_DIR = path.join(tmpRoot, 'builds');
    SeaBuild.BINARIES_DIR = path.join(tmpRoot, 'binaries');

    const build = new SeaBuild({
      name: 'partial-output-cleanup',
      properties: {
        entryCode: 'console.log("test")',
        resolveDir: process.cwd(),
        nodeBinaryPath: sourceBinary,
        nodeVersion: process.versions.node,
        platform: process.platform,
        architecture: process.arch,
      },
    });
    jest.spyOn(build, 'esbuild').mockImplementation(async () => {});
    jest.spyOn(build, 'seaBuild').mockImplementation(async () => {});

    const copyFile = fsp.copyFile.bind(fsp);
    jest
      .spyOn(fsp, 'copyFile')
      .mockImplementation(async (source, destination, mode) => {
        if (path.dirname(String(destination)) === SeaBuild.BINARIES_DIR) {
          await fsp.writeFile(destination, 'partial-binary', 'utf8');
          throw new Error('final-copy-failure-sentinel');
        }
        if (mode === undefined) return copyFile(source, destination);
        return copyFile(source, destination, mode);
      });

    try {
      await expect(build.build()).rejects.toThrow(
        'final-copy-failure-sentinel',
      );
      await expect(fsp.readdir(SeaBuild.BINARIES_DIR)).resolves.toEqual([]);
      await expect(fsp.readdir(SeaBuild.BUILD_DIR)).resolves.toEqual([]);
      expect(build.has('binaryPath')).toBe(false);
    } finally {
      SeaBuild.BUILD_DIR = originalBuildDir;
      SeaBuild.BINARIES_DIR = originalBinariesDir;
      await fsp.rm(tmpRoot, { force: true, recursive: true });
    }
  });
});
