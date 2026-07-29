/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME,
  CORE_RUNTIME_DEPENDENCY_ACTIVITY,
  CORE_RUNTIME_DEPENDENCY_ASSET_KIND,
  CORE_RUNTIME_DEPENDENCY_ASSET_SCHEMA_VERSION,
  CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME,
  CORE_RUNTIME_DEPENDENCY_PURPOSE,
  CORE_RUNTIME_DEPENDENCY_ROOT,
} from '../../../src/core/resources/builds/lib/core-runtime-dependency-asset.js';
import { digestFrozenDependencyClosurePlan } from '../../../src/core/resources/builds/lib/frozen-dependency-closure-plan.js';
import { sortCanonicalJsonValue } from '../../../src/core/runtime/canonical-order.js';

const CHILD_PROCESS_IMPORT = 'node:child_process';
const MISMATCHED_NODE_VERSION =
  process.versions.node === '0.0.0' ? '0.0.1' : '0.0.0';
const NODE_SEA_SENTINEL_FUSE = Buffer.from(
  'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  'ascii',
);

/** @param {string} value @returns {{digest: import('../../../src/core/runtime/application-revision.js').Sha256Digest, size: number}} */
const evidenceFor = (value) => ({
  digest: {
    algorithm: /** @type {'sha256'} */ ('sha256'),
    value: createHash('sha256').update(value).digest('base64url'),
  },
  size: Buffer.byteLength(value),
});

const emptySeaEvidence = () => ({
  codeBundleEvidence: evidenceFor('mock-code-bundle'),
  seaBlobEvidence: evidenceFor('mock-sea-blob'),
  assetEvidence: {},
  functionAssetEvidence: {},
});

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

  it('disables inherited execution arguments while allowing explicit runtime options', async () => {
    const generatedBlob = Buffer.from('generated-sea-blob', 'utf8');
    /** @type {Record<string, any> | undefined} */
    let observedConfig;
    const execFile = jest.fn(
      /**
       * @param {string} _file
       * @param {string[]} args
       * @param {Record<string, any>} _options
       * @param {boolean} _rejectOnStderr
       */
      async (_file, args, _options, _rejectOnStderr) => {
        const configPath = args[2];
        const parsedConfig = JSON.parse(await fsp.readFile(configPath, 'utf8'));
        observedConfig = parsedConfig;
        await fsp.writeFile(parsedConfig.output, generatedBlob);
      },
    );
    const inject = jest.fn(
      /**
       * @param {string} _binaryPath
       * @param {string} _resourceName
       * @param {Buffer} _blob
       * @param {Record<string, any>} _options
       */
      async (_binaryPath, _resourceName, _blob, _options) => {},
    );
    jest.unstable_mockModule(CHILD_PROCESS_IMPORT, () => ({
      execFile: jest.fn(),
      spawn: jest.fn(),
      spawnSync: jest.fn(() => ({
        stdout: 'Usage: node\n  --experimental-sea-config=...\n',
        stderr: '',
        status: 0,
      })),
    }));
    jest.unstable_mockModule('../../../src/core/lib/cmd.js', () => ({
      execFile,
      runCmd: jest.fn(),
    }));
    jest.unstable_mockModule('postject', () => ({ inject }));

    const { default: SeaBuild } =
      await import('../../../src/core/resources/builds/sea-build.js');
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-sea-exec-argv-'),
    );
    const buildDir = path.join(tmpRoot, 'build');
    const nodeBinaryPath = path.join(tmpRoot, 'node');
    const codeBundle = Buffer.from('void 0;\n', 'utf8');
    await fsp.mkdir(buildDir, { mode: 0o700 });
    await Promise.all([
      fsp.writeFile(path.join(buildDir, 'esbundle.js'), codeBundle),
      fsp.writeFile(nodeBinaryPath, 'node-binary', 'utf8'),
    ]);
    const build = new SeaBuild({
      name: 'closed-exec-argv',
      properties: {
        entryCode: codeBundle.toString('utf8'),
        resolveDir: tmpRoot,
        nodeBinaryPath,
        nodeVersion: process.versions.node,
        platform: process.platform,
        architecture: process.arch,
      },
    });

    try {
      const evidence = await build.seaBuild(buildDir, nodeBinaryPath);

      expect(observedConfig).toMatchObject({
        main: path.join(buildDir, 'esbundle.js'),
        output: path.join(buildDir, 'sea.blob'),
        execArgv: [],
        execArgvExtension: 'cli',
        assets: {},
      });
      expect(execFile).toHaveBeenCalledWith(
        process.execPath,
        [
          '--no-warnings',
          '--experimental-sea-config',
          path.join(buildDir, 'sea-config.json'),
        ],
        {},
        true,
      );
      expect(inject).toHaveBeenCalledWith(
        nodeBinaryPath,
        'NODE_SEA_BLOB',
        generatedBlob,
        expect.any(Object),
      );
      expect(evidence.codeBundleEvidence).toEqual(
        evidenceFor(codeBundle.toString('utf8')),
      );
      expect(evidence.seaBlobEvidence).toEqual(
        evidenceFor(generatedBlob.toString('utf8')),
      );

      const mutationBuildDir = path.join(tmpRoot, 'mutation-build');
      await fsp.mkdir(mutationBuildDir, { mode: 0o700 });
      await fsp.writeFile(
        path.join(mutationBuildDir, 'esbundle.js'),
        codeBundle,
      );
      inject.mockImplementationOnce(async (...args) => {
        const injectedBlob = args[2];
        injectedBlob.fill(0, 0, 1);
      });
      await expect(
        build.seaBuild(mutationBuildDir, nodeBinaryPath),
      ).rejects.toThrow(/SEA blob changed while it was being injected/i);
      await expect(
        fsp.readFile(path.join(mutationBuildDir, 'sea.blob')),
      ).resolves.toEqual(generatedBlob);
    } finally {
      await fsp.rm(tmpRoot, { force: true, recursive: true });
    }
  });

  it.each([
    ['linux', 1, false],
    ['linux', 3, true],
    ['darwin', 1, false],
    ['darwin', 3, false],
  ])(
    'masks and positionally restores nested Node fuses for %s injection (count %i)',
    async (platform, nestedFuseCount, straddlesScanBoundary) => {
      const targetPlatform = /** @type {'linux'|'darwin'} */ (platform);
      const generatedBlob = Buffer.from(
        [
          'blob-prefix',
          ...Array.from(
            { length: nestedFuseCount },
            (_, index) =>
              `${NODE_SEA_SENTINEL_FUSE.toString('ascii')}:1:nested-${index}`,
          ),
          'blob-suffix',
        ].join('|'),
        'ascii',
      );
      const codeBundle = Buffer.from('void 0;\n', 'utf8');
      const outerBinaryCore = Buffer.from(
        `binary-prefix|${NODE_SEA_SENTINEL_FUSE.toString(
          'ascii',
        )}:0|binary-suffix`,
        'ascii',
      );
      const sectionPrefix = Buffer.from('|postject-resource|', 'ascii');
      const firstGeneratedFuseOffset = generatedBlob.indexOf(
        NODE_SEA_SENTINEL_FUSE,
      );
      const boundaryPaddingLength = straddlesScanBoundary
        ? 1024 * 1024 -
          Math.floor(NODE_SEA_SENTINEL_FUSE.length / 2) -
          outerBinaryCore.length -
          sectionPrefix.length -
          firstGeneratedFuseOffset
        : 0;
      const outerBinary = Buffer.concat([
        Buffer.alloc(boundaryPaddingLength, 'x'),
        outerBinaryCore,
      ]);
      /** @type {Buffer | undefined} */
      let observedInjectionBlob;
      const execFile = jest.fn(
        /**
         * @param {string} _file
         * @param {string[]} args
         */
        async (_file, args) => {
          const config = JSON.parse(await fsp.readFile(args[2], 'utf8'));
          await fsp.writeFile(config.output, generatedBlob);
        },
      );
      const runCmd = jest.fn();
      const inject = jest.fn(
        /**
         * Simulate postject's relevant contract: place the resource in the
         * executable, require one exact outer fuse name, and flip its :0.
         * @param {string} binaryPath
         * @param {string} _resourceName
         * @param {Buffer} resourceData
         * @param {Record<string, any>} _options
         */
        async (binaryPath, _resourceName, resourceData, _options) => {
          observedInjectionBlob = Buffer.from(resourceData);
          const executable = Buffer.concat([
            await fsp.readFile(binaryPath),
            sectionPrefix,
            resourceData,
          ]);
          const firstFuse = executable.indexOf(NODE_SEA_SENTINEL_FUSE);
          expect(firstFuse).not.toBe(-1);
          expect(executable.lastIndexOf(NODE_SEA_SENTINEL_FUSE)).toBe(
            firstFuse,
          );
          const colonOffset = firstFuse + NODE_SEA_SENTINEL_FUSE.length;
          expect(executable[colonOffset]).toBe(':'.charCodeAt(0));
          expect(executable[colonOffset + 1]).toBe('0'.charCodeAt(0));
          executable[colonOffset + 1] = '1'.charCodeAt(0);
          await fsp.writeFile(binaryPath, executable);
        },
      );
      jest.unstable_mockModule(CHILD_PROCESS_IMPORT, () => ({
        execFile: jest.fn(),
        spawn: jest.fn(),
        spawnSync: jest.fn(() => ({
          stdout: 'Usage: node\n  --experimental-sea-config=...\n',
          stderr: '',
          status: 0,
        })),
      }));
      jest.unstable_mockModule('../../../src/core/lib/cmd.js', () => ({
        execFile,
        runCmd,
      }));
      jest.unstable_mockModule('postject', () => ({ inject }));

      const { default: SeaBuild } =
        await import('../../../src/core/resources/builds/sea-build.js');
      const tmpRoot = await fsp.mkdtemp(
        path.join(os.tmpdir(), `wharfie-sea-nested-fuse-${platform}-`),
      );
      const buildDir = path.join(tmpRoot, 'build');
      const nodeBinaryPath = path.join(tmpRoot, 'node');
      await fsp.mkdir(buildDir, { mode: 0o700 });
      await Promise.all([
        fsp.writeFile(path.join(buildDir, 'esbundle.js'), codeBundle),
        fsp.writeFile(nodeBinaryPath, outerBinary),
      ]);
      const build = new SeaBuild({
        name: `nested-fuse-${platform}-${nestedFuseCount}`,
        properties: {
          entryCode: codeBundle.toString('utf8'),
          resolveDir: tmpRoot,
          nodeBinaryPath,
          nodeVersion: process.versions.node,
          platform: targetPlatform,
          architecture: 'x64',
          ...(platform === 'linux' ? { libc: 'glibc' } : {}),
        },
      });

      try {
        const evidence = await build.seaBuild(buildDir, nodeBinaryPath);

        if (!observedInjectionBlob) {
          throw new Error('postject did not receive an injection blob');
        }
        const injectedBlob = observedInjectionBlob;
        expect(injectedBlob).toHaveLength(generatedBlob.length);
        expect(injectedBlob.indexOf(NODE_SEA_SENTINEL_FUSE)).toBe(-1);
        const firstNestedOffset = generatedBlob.indexOf(NODE_SEA_SENTINEL_FUSE);
        const marker = injectedBlob.subarray(
          firstNestedOffset,
          firstNestedOffset + NODE_SEA_SENTINEL_FUSE.length,
        );
        expect(marker.toString('ascii')).toMatch(/^WHARFIE_SEA_MASK_/);
        const reconstructedBlob = Buffer.from(injectedBlob);
        let nestedOffset = firstNestedOffset;
        let observedNestedFuseCount = 0;
        while (nestedOffset !== -1) {
          expect(
            injectedBlob.subarray(nestedOffset, nestedOffset + marker.length),
          ).toEqual(marker);
          NODE_SEA_SENTINEL_FUSE.copy(reconstructedBlob, nestedOffset);
          observedNestedFuseCount += 1;
          nestedOffset = generatedBlob.indexOf(
            NODE_SEA_SENTINEL_FUSE,
            nestedOffset + NODE_SEA_SENTINEL_FUSE.length,
          );
        }
        expect(observedNestedFuseCount).toBe(nestedFuseCount);
        expect(reconstructedBlob).toEqual(generatedBlob);

        const handledOuterBinary = Buffer.from(outerBinary);
        const outerFuseOffset = handledOuterBinary.indexOf(
          NODE_SEA_SENTINEL_FUSE,
        );
        handledOuterBinary[
          outerFuseOffset + NODE_SEA_SENTINEL_FUSE.length + 1
        ] = '1'.charCodeAt(0);
        await expect(fsp.readFile(nodeBinaryPath)).resolves.toEqual(
          Buffer.concat([handledOuterBinary, sectionPrefix, generatedBlob]),
        );
        expect(inject).toHaveBeenCalledWith(
          nodeBinaryPath,
          'NODE_SEA_BLOB',
          expect.any(Buffer),
          {
            sentinelFuse: NODE_SEA_SENTINEL_FUSE.toString('ascii'),
            ...(platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {}),
          },
        );
        if (platform === 'darwin') {
          expect(runCmd).toHaveBeenCalledWith('codesign', [
            '--remove-signature',
            nodeBinaryPath,
          ]);
        } else {
          expect(runCmd).not.toHaveBeenCalled();
        }
        expect(evidence.seaBlobEvidence).toEqual({
          digest: {
            algorithm: 'sha256',
            value: createHash('sha256')
              .update(generatedBlob)
              .digest('base64url'),
          },
          size: generatedBlob.length,
        });
        await expect(
          fsp.readFile(path.join(buildDir, 'sea.blob')),
        ).resolves.toEqual(generatedBlob);
      } finally {
        await fsp.rm(tmpRoot, { force: true, recursive: true });
      }
    },
  );

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
      return emptySeaEvidence();
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

  it('resolves entryCode once and uses the same captured string for bundling and evidence', async () => {
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
      path.join(os.tmpdir(), 'wharfie-sea-entry-capture-'),
    );
    const sourceBinary = path.join(tmpRoot, 'source-node');
    const capturedEntry = 'process.stdout.write("captured");\n';
    const resolveEntryCode = jest.fn(() => capturedEntry);
    await fsp.writeFile(sourceBinary, 'node-binary', 'utf8');
    SeaBuild.BUILD_DIR = path.join(tmpRoot, 'builds');
    SeaBuild.BINARIES_DIR = path.join(tmpRoot, 'binaries');
    const build = new SeaBuild({
      name: 'entry-capture',
      properties: {
        entryCode: resolveEntryCode,
        resolveDir: process.cwd(),
        nodeBinaryPath: sourceBinary,
        nodeVersion: process.versions.node,
        platform: process.platform,
        architecture: process.arch,
      },
    });
    const esbuild = jest
      .spyOn(build, 'esbuild')
      .mockImplementation(async () => {});
    jest.spyOn(build, 'seaBuild').mockImplementation(async () => {
      return emptySeaEvidence();
    });

    try {
      await build.build();
      const artifactBytes = await fsp.readFile(build.get('binaryPath'));
      const evidence = build.getSuccessfulBuildEvidence(artifactBytes);

      expect(resolveEntryCode).toHaveBeenCalledTimes(1);
      expect(esbuild).toHaveBeenCalledWith(expect.any(String), capturedEntry);
      expect(evidence.entryCode).toEqual(evidenceFor(capturedEntry));
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
          return emptySeaEvidence();
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
    jest
      .spyOn(build, 'seaBuild')
      .mockImplementation(async () => emptySeaEvidence());

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

  it('binds successful-build evidence to the exact final artifact bytes', async () => {
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
      path.join(os.tmpdir(), 'wharfie-sea-evidence-bytes-'),
    );
    const sourceBinary = path.join(tmpRoot, 'source-node');
    await fsp.writeFile(sourceBinary, 'source-node-bytes', 'utf8');
    SeaBuild.BUILD_DIR = path.join(tmpRoot, 'builds');
    SeaBuild.BINARIES_DIR = path.join(tmpRoot, 'binaries');
    const build = new SeaBuild({
      name: 'bind-final-artifact',
      properties: {
        entryCode: 'void 0;',
        resolveDir: process.cwd(),
        nodeBinaryPath: sourceBinary,
        nodeVersion: process.versions.node,
        platform: process.platform,
        architecture: process.arch,
        ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
      },
    });
    jest.spyOn(build, 'esbuild').mockImplementation(async () => {});
    jest
      .spyOn(build, 'seaBuild')
      .mockImplementation(async (_buildDir, nodeBinaryPath) => {
        await fsp.writeFile(nodeBinaryPath, 'completed-sea-bytes', 'utf8');
        return emptySeaEvidence();
      });

    try {
      await build.build();
      const artifactBytes = await fsp.readFile(build.get('binaryPath'));
      const evidence = build.getSuccessfulBuildEvidence(artifactBytes);

      expect(evidence.binaryPath).toBe(build.get('binaryPath'));
      expect(evidence.entryCode).toEqual({
        digest: {
          algorithm: 'sha256',
          value: createHash('sha256')
            .update('void 0;', 'utf8')
            .digest('base64url'),
        },
        size: Buffer.byteLength('void 0;', 'utf8'),
      });
      expect(Object.isFrozen(evidence.entryCode)).toBe(true);
      expect(Object.isFrozen(evidence.entryCode.digest)).toBe(true);
      expect(evidence.codeBundle).toEqual(evidenceFor('mock-code-bundle'));
      expect(evidence.seaBlob).toEqual(evidenceFor('mock-sea-blob'));
      expect(evidence.signing).toEqual({ mode: 'unsigned' });
      expect(() =>
        build.getSuccessfulBuildEvidence(Buffer.from('different-sea-bytes')),
      ).toThrow(/artifact bytes do not match.*build generation/i);
    } finally {
      SeaBuild.BUILD_DIR = originalBuildDir;
      SeaBuild.BINARIES_DIR = originalBinariesDir;
      await fsp.rm(tmpRoot, { force: true, recursive: true });
    }
  });

  it('seals Node archive receipt evidence with the source bytes generation', async () => {
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
    const { default: NodeBinary } =
      await import('../../../src/core/resources/builds/node-binary.js');
    const originalBuildDir = SeaBuild.BUILD_DIR;
    const originalBinariesDir = SeaBuild.BINARIES_DIR;
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-sea-node-receipt-evidence-'),
    );
    const sourceBinary = path.join(tmpRoot, 'source-node');
    const sourceBytes = Buffer.from('receipt-bound-node-source');
    await fsp.writeFile(sourceBinary, sourceBytes);
    SeaBuild.BUILD_DIR = path.join(tmpRoot, 'builds');
    SeaBuild.BINARIES_DIR = path.join(tmpRoot, 'binaries');

    const nodeBinary = new NodeBinary({
      name: 'receipt-node',
      properties: {
        version: process.versions.node,
        platform: process.platform,
        architecture: process.arch,
      },
    });
    nodeBinary._setUNSAFE('binaryPath', sourceBinary);
    nodeBinary._setUNSAFE('exactVersion', `v${process.versions.node}`);
    const { normPlatform, normArch, ext } = NodeBinary.resolveTargetSpec(
      process.platform,
      process.arch,
    );
    const archiveSha256 = 'ab'.repeat(32);
    const receiptPath = await nodeBinary.getIntegrityReceiptPath(sourceBinary);
    await fsp.writeFile(
      receiptPath,
      JSON.stringify({
        version: 1,
        target: {
          nodeVersion: `v${process.versions.node}`,
          platform: process.platform,
          architecture: process.arch,
        },
        archive: {
          fileName: `node-v${process.versions.node}-${normPlatform}-${normArch}${ext}`,
          sha256: archiveSha256,
        },
        binary: {
          sha256: createHash('sha256').update(sourceBytes).digest('hex'),
          size: sourceBytes.length,
        },
      }),
    );
    const build = new SeaBuild({
      name: 'seal-node-receipt',
      dependsOn: [nodeBinary],
      properties: {
        entryCode: 'void 0;',
        resolveDir: process.cwd(),
        nodeBinaryPath: sourceBinary,
        nodeVersion: process.versions.node,
        platform: process.platform,
        architecture: process.arch,
        ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
      },
    });
    jest.spyOn(build, 'esbuild').mockImplementation(async () => {});
    jest
      .spyOn(build, 'seaBuild')
      .mockImplementation(async (_buildDir, nodeBinaryPath) => {
        await fsp.writeFile(nodeBinaryPath, 'completed-sea-bytes', 'utf8');
        return emptySeaEvidence();
      });

    try {
      await build.build();
      const artifactBytes = await fsp.readFile(build.get('binaryPath'));
      const beforeMutation = build.getSuccessfulBuildEvidence(artifactBytes);
      expect(beforeMutation.nodeSource.archive).toEqual({
        fileName: `node-v${process.versions.node}-${normPlatform}-${normArch}${ext}`,
        digest: {
          algorithm: 'sha256',
          value: Buffer.from(archiveSha256, 'hex').toString('base64url'),
        },
      });

      await fsp.writeFile(receiptPath, '{"replaced":true}');
      expect(build.getSuccessfulBuildEvidence(artifactBytes)).toBe(
        beforeMutation,
      );
      expect(beforeMutation.nodeSource.archive).toEqual({
        fileName: `node-v${process.versions.node}-${normPlatform}-${normArch}${ext}`,
        digest: {
          algorithm: 'sha256',
          value: Buffer.from(archiveSha256, 'hex').toString('base64url'),
        },
      });
      await expect(build.build()).rejects.toThrow(
        /receipt does not match the exact target binary selected for SEA generation/i,
      );
      await fsp.rm(receiptPath);
      await expect(build.build()).rejects.toThrow(
        /integrity receipt is required for SEA generation provenance/i,
      );
    } finally {
      SeaBuild.BUILD_DIR = originalBuildDir;
      SeaBuild.BINARIES_DIR = originalBinariesDir;
      await fsp.rm(tmpRoot, { force: true, recursive: true });
    }
  });

  it('does not let public asset preparation replace committed generation evidence', async () => {
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
      path.join(os.tmpdir(), 'wharfie-sea-evidence-inspection-'),
    );
    const sourceBinary = path.join(tmpRoot, 'source-node');
    const inspectionAsset = path.join(tmpRoot, 'inspection.asset');
    const inspectionBytes = Buffer.from('inspection-only-asset');
    await Promise.all([
      fsp.writeFile(sourceBinary, 'source-node-bytes', 'utf8'),
      fsp.writeFile(inspectionAsset, inspectionBytes),
    ]);
    SeaBuild.BUILD_DIR = path.join(tmpRoot, 'builds');
    SeaBuild.BINARIES_DIR = path.join(tmpRoot, 'binaries');
    const inspectionDigest = createHash('sha256')
      .update(inspectionBytes)
      .digest('base64url');
    const committedDigest = {
      algorithm: /** @type {'sha256'} */ ('sha256'),
      value: createHash('sha256')
        .update('committed-generation-asset')
        .digest('base64url'),
    };
    const build = new SeaBuild({
      name: 'preserve-generation-evidence',
      properties: {
        entryCode: 'void 0;',
        resolveDir: process.cwd(),
        nodeBinaryPath: sourceBinary,
        nodeVersion: process.versions.node,
        platform: process.platform,
        architecture: process.arch,
        ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
        assets: { inspection: inspectionAsset },
        assetDigests: {
          inspection: { algorithm: 'sha256', value: inspectionDigest },
        },
      },
    });
    jest.spyOn(build, 'esbuild').mockImplementation(async () => {});
    jest.spyOn(build, 'seaBuild').mockImplementation(async () => ({
      codeBundleEvidence: evidenceFor('committed-code-bundle'),
      seaBlobEvidence: evidenceFor('committed-sea-blob'),
      assetEvidence: { committed: committedDigest },
      functionAssetEvidence: {},
    }));

    try {
      await build.build();
      const artifactBytes = await fsp.readFile(build.get('binaryPath'));
      const committed = build.getSuccessfulBuildEvidence(artifactBytes);
      const inspectionDir = path.join(tmpRoot, 'inspection-build');
      await fsp.mkdir(inspectionDir, { mode: 0o700 });

      await build.prepareSeaAssets(inspectionDir);
      const afterInspection = build.getSuccessfulBuildEvidence(artifactBytes);

      expect(afterInspection).toBe(committed);
      expect(afterInspection.assets).toEqual({ committed: committedDigest });
      expect(build.get('embeddedAssetDigests')).toEqual({
        inspection: { algorithm: 'sha256', value: inspectionDigest },
      });
    } finally {
      SeaBuild.BUILD_DIR = originalBuildDir;
      SeaBuild.BINARIES_DIR = originalBinariesDir;
      await fsp.rm(tmpRoot, { force: true, recursive: true });
    }
  });

  it('advances a Darwin generation only from exact unsigned bytes to signed bytes', async () => {
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
      path.join(os.tmpdir(), 'wharfie-sea-signing-evidence-'),
    );
    const sourceBinary = path.join(tmpRoot, 'source-node');
    await fsp.writeFile(sourceBinary, 'source-node-bytes', 'utf8');
    SeaBuild.BUILD_DIR = path.join(tmpRoot, 'builds');
    SeaBuild.BINARIES_DIR = path.join(tmpRoot, 'binaries');
    const build = new SeaBuild({
      name: 'advance-signing-evidence',
      properties: {
        entryCode: 'void 0;',
        resolveDir: process.cwd(),
        nodeBinaryPath: sourceBinary,
        nodeVersion: process.versions.node,
        platform: 'darwin',
        architecture: process.arch,
      },
    });
    jest.spyOn(build, 'esbuild').mockImplementation(async () => {});
    jest
      .spyOn(build, 'seaBuild')
      .mockImplementation(async (_buildDir, nodeBinaryPath) => {
        await fsp.writeFile(nodeBinaryPath, 'unsigned-sea-bytes', 'utf8');
        return emptySeaEvidence();
      });

    try {
      await build.build();
      const unsignedBytes = await fsp.readFile(build.get('binaryPath'));
      const signedBytes = Buffer.from('signed-sea-bytes');

      expect(() =>
        build.advanceSuccessfulBuildEvidence(
          Buffer.from('wrong-unsigned-bytes'),
          signedBytes,
          { mode: 'ad-hoc' },
        ),
      ).toThrow(/artifact bytes do not match.*build generation/i);
      build.advanceSuccessfulBuildEvidence(unsignedBytes, signedBytes, {
        mode: 'ad-hoc',
      });

      expect(() => build.getSuccessfulBuildEvidence(unsignedBytes)).toThrow(
        /artifact bytes do not match.*build generation/i,
      );
      expect(build.getSuccessfulBuildEvidence(signedBytes).signing).toEqual({
        mode: 'ad-hoc',
      });
      expect(() =>
        build.advanceSuccessfulBuildEvidence(signedBytes, signedBytes, {
          mode: 'ad-hoc',
        }),
      ).toThrow(/already been signed/i);
    } finally {
      SeaBuild.BUILD_DIR = originalBuildDir;
      SeaBuild.BINARIES_DIR = originalBinariesDir;
      await fsp.rm(tmpRoot, { force: true, recursive: true });
    }
  });

  it('bundles the running Wharfie app API instead of an app-local copy', async () => {
    const { default: SeaBuild } =
      await import('../../../src/core/resources/builds/sea-build.js');
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-sea-runtime-alias-'),
    );
    const buildDir = path.join(tmpRoot, 'build');
    const localWharfie = path.join(
      tmpRoot,
      'node_modules',
      '@wharfie',
      'wharfie',
    );

    try {
      await Promise.all([
        fsp.mkdir(buildDir, { recursive: true }),
        fsp.mkdir(localWharfie, { recursive: true }),
      ]);
      await Promise.all([
        fsp.writeFile(
          path.join(localWharfie, 'package.json'),
          JSON.stringify({
            name: '@wharfie/wharfie',
            version: '0.0.0-poisoned',
            type: 'module',
            exports: { './app': './app.js' },
          }),
        ),
        fsp.writeFile(
          path.join(localWharfie, 'app.js'),
          "export const defineApp = () => ({ source: 'poisoned-app-local-runtime' });\n",
        ),
      ]);
      const build = new SeaBuild({
        name: 'sea-runtime-alias',
        properties: {
          entryCode: [
            "import { defineApp } from '@wharfie/wharfie/app';",
            "globalThis.__runtimeAlias = defineApp({ source: 'revision-runtime' });",
          ].join('\n'),
          resolveDir: tmpRoot,
          nodeBinaryPath: process.execPath,
          nodeVersion: process.versions.node,
          platform: process.platform,
          architecture: process.arch,
        },
      });

      await build.esbuild(buildDir);
      const code = await fsp.readFile(build.get('codeBundlePath'), 'utf8');
      expect(code).toContain('revision-runtime');
      expect(code).not.toContain('poisoned-app-local-runtime');
    } finally {
      await fsp.rm(tmpRoot, { force: true, recursive: true });
    }
  });

  it('seals assets in canonical order and records their exact digests', async () => {
    const { default: SeaBuild } =
      await import('../../../src/core/resources/builds/sea-build.js');
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-sea-assets-'),
    );
    const buildDir = path.join(tmpRoot, 'build');
    const alphaPath = path.join(tmpRoot, 'alpha.asset');
    const zetaPath = path.join(tmpRoot, 'zeta.asset');
    const alphaBytes = Buffer.from('sealed alpha bytes');
    const zetaBytes = Buffer.from('sealed zeta bytes');
    await fsp.mkdir(buildDir, { mode: 0o700 });
    await Promise.all([
      fsp.writeFile(alphaPath, alphaBytes),
      fsp.writeFile(zetaPath, zetaBytes),
    ]);
    const alphaDigest = createHash('sha256')
      .update(alphaBytes)
      .digest('base64url');
    const zetaDigest = createHash('sha256')
      .update(zetaBytes)
      .digest('base64url');
    const build = new SeaBuild({
      name: 'seal-assets',
      properties: {
        entryCode: 'void 0;',
        resolveDir: process.cwd(),
        nodeBinaryPath: process.execPath,
        nodeVersion: process.versions.node,
        platform: process.platform,
        architecture: process.arch,
        assets: {
          zeta: zetaPath,
          alpha: alphaPath,
        },
        assetDigests: {
          zeta: { algorithm: 'sha256', value: zetaDigest },
          alpha: { algorithm: 'sha256', value: alphaDigest },
        },
      },
    });

    try {
      const sealed = await build.prepareSeaAssets(buildDir);

      expect(Object.keys(sealed)).toEqual(['alpha', 'zeta']);
      expect(path.basename(sealed.alpha)).toBe('00000000.asset');
      expect(path.basename(sealed.zeta)).toBe('00000001.asset');
      expect(path.dirname(sealed.alpha)).toBe(path.join(buildDir, 'assets'));
      await expect(fsp.readFile(sealed.alpha)).resolves.toEqual(alphaBytes);
      await expect(fsp.readFile(sealed.zeta)).resolves.toEqual(zetaBytes);
      expect((await fsp.stat(path.dirname(sealed.alpha))).mode & 0o777).toBe(
        0o700,
      );
      expect((await fsp.stat(sealed.alpha)).mode & 0o777).toBe(0o400);
      expect(build.get('embeddedAssetDigests')).toEqual({
        alpha: { algorithm: 'sha256', value: alphaDigest },
        zeta: { algorithm: 'sha256', value: zetaDigest },
      });
    } finally {
      await fsp.rm(tmpRoot, { force: true, recursive: true });
    }
  });

  it('seals a matched core LMDB receipt and archive as one target-bound pair', async () => {
    const { default: SeaBuild } =
      await import('../../../src/core/resources/builds/sea-build.js');
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-sea-core-assets-'),
    );
    const buildDir = path.join(tmpRoot, 'build');
    const manifestPath = path.join(tmpRoot, 'core-manifest.json');
    const archivePath = path.join(tmpRoot, 'core-archive.tgz');
    /** @type {import('../../../src/core/runtime/build-target.js').BuildTarget} */
    const target = {
      nodeVersion: process.versions.node,
      platform: /** @type {'darwin'|'linux'|'win32'} */ (process.platform),
      architecture: /** @type {'arm64'|'x64'} */ (process.arch),
      ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
    };
    const archiveBytes = Buffer.from('sealed core closure');
    /** @param {string | Buffer | Uint8Array} value */
    const digest = (value) => ({
      algorithm: /** @type {'sha256'} */ ('sha256'),
      value: createHash('sha256').update(value).digest('base64url'),
    });
    const dependencyLockInput = {
      format: 'wharfie-npm-package-lock-v3-closure-v1',
      digest: digest('core lock'),
    };
    const plan = {
      schemaVersion: 2,
      kind: 'frozenDependencyClosure',
      activity: CORE_RUNTIME_DEPENDENCY_ACTIVITY,
      lock: dependencyLockInput,
      target,
      installScripts: 'ignored',
      binLinks: 'not-created',
      selectedOptionalFailures: 'fatal',
      roots: [
        {
          ...CORE_RUNTIME_DEPENDENCY_ROOT,
          location: 'node_modules/lmdb',
        },
      ],
      packages: [
        {
          location: 'node_modules/lmdb',
          ...CORE_RUNTIME_DEPENDENCY_ROOT,
          resolved: 'https://registry.npmjs.org/lmdb/-/lmdb-3.4.4.tgz',
          integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
          hasInstallScript: false,
          manifestContract: sortCanonicalJsonValue({
            ...CORE_RUNTIME_DEPENDENCY_ROOT,
            bundleDependencies: [],
            hasInstallScript: false,
          }),
          edges: [],
        },
      ],
    };
    const manifest = {
      schemaVersion: CORE_RUNTIME_DEPENDENCY_ASSET_SCHEMA_VERSION,
      kind: CORE_RUNTIME_DEPENDENCY_ASSET_KIND,
      purpose: CORE_RUNTIME_DEPENDENCY_PURPOSE,
      target,
      roots: [{ ...CORE_RUNTIME_DEPENDENCY_ROOT }],
      dependencyLockInput,
      closureDigest: digestFrozenDependencyClosurePlan(plan),
      plan,
      archive: {
        assetName: CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME,
        digest: digest(archiveBytes),
      },
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
    await fsp.mkdir(buildDir, { mode: 0o700 });
    await Promise.all([
      fsp.writeFile(manifestPath, manifestBytes),
      fsp.writeFile(archivePath, archiveBytes),
    ]);
    const build = new SeaBuild({
      name: 'seal-core-assets',
      properties: {
        entryCode: 'void 0;',
        resolveDir: process.cwd(),
        nodeBinaryPath: process.execPath,
        nodeVersion: target.nodeVersion,
        platform: target.platform,
        architecture: target.architecture,
        ...(target.platform === 'linux' ? { libc: target.libc } : {}),
        assets: {
          [CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME]: manifestPath,
          [CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME]: archivePath,
        },
        assetDigests: {
          [CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME]: digest(manifestBytes),
          [CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME]: digest(archiveBytes),
        },
      },
    });

    try {
      const sealed = await build._prepareSeaAssetsWithEvidence(buildDir);
      expect(sealed.coreRuntimeDependencyEvidence).toEqual({
        manifestDigest: digest(manifestBytes),
        target,
        roots: [{ ...CORE_RUNTIME_DEPENDENCY_ROOT }],
        dependencyLockInput: manifest.dependencyLockInput,
        closureDigest: manifest.closureDigest,
        plan: manifest.plan,
        archive: manifest.archive,
      });

      const incomplete = new SeaBuild({
        name: 'reject-incomplete-core-assets',
        properties: {
          entryCode: 'void 0;',
          resolveDir: process.cwd(),
          nodeBinaryPath: process.execPath,
          nodeVersion: target.nodeVersion,
          platform: target.platform,
          architecture: target.architecture,
          ...(target.platform === 'linux' ? { libc: target.libc } : {}),
          assets: {
            [CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME]: manifestPath,
          },
          assetDigests: {
            [CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME]:
              digest(manifestBytes),
          },
        },
      });
      const incompleteDir = path.join(tmpRoot, 'incomplete');
      await fsp.mkdir(incompleteDir, { mode: 0o700 });
      await expect(
        incomplete._prepareSeaAssetsWithEvidence(incompleteDir),
      ).rejects.toThrow(/must include both manifest and archive/i);
    } finally {
      await fsp.rm(tmpRoot, { force: true, recursive: true });
    }
  });

  it('rejects an asset mutated after its expected digest was recorded', async () => {
    const { default: SeaBuild } =
      await import('../../../src/core/resources/builds/sea-build.js');
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-sea-asset-mutation-'),
    );
    const buildDir = path.join(tmpRoot, 'build');
    const assetPath = path.join(tmpRoot, 'activity.asset');
    const originalBytes = Buffer.from('original activity bytes');
    await fsp.mkdir(buildDir, { mode: 0o700 });
    await fsp.writeFile(assetPath, originalBytes);
    const originalDigest = createHash('sha256')
      .update(originalBytes)
      .digest('base64url');
    await fsp.writeFile(assetPath, 'mutated activity bytes');
    const build = new SeaBuild({
      name: 'reject-mutated-asset',
      properties: {
        entryCode: 'void 0;',
        resolveDir: process.cwd(),
        nodeBinaryPath: process.execPath,
        nodeVersion: process.versions.node,
        platform: process.platform,
        architecture: process.arch,
        assets: { activity: assetPath },
        assetDigests: {
          activity: { algorithm: 'sha256', value: originalDigest },
        },
      },
    });

    try {
      await expect(build.prepareSeaAssets(buildDir)).rejects.toThrow(
        /does not match its expected SHA-256 digest/i,
      );
      expect(build.has('embeddedAssetDigests')).toBe(false);
    } finally {
      await fsp.rm(tmpRoot, { force: true, recursive: true });
    }
  });

  it('rejects symbolic-link asset sources', async () => {
    const { default: SeaBuild } =
      await import('../../../src/core/resources/builds/sea-build.js');
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-sea-asset-symlink-'),
    );
    const buildDir = path.join(tmpRoot, 'build');
    const sourcePath = path.join(tmpRoot, 'source.asset');
    const linkPath = path.join(tmpRoot, 'linked.asset');
    await fsp.mkdir(buildDir, { mode: 0o700 });
    await fsp.writeFile(sourcePath, 'linked activity bytes');
    await fsp.symlink(sourcePath, linkPath);
    const build = new SeaBuild({
      name: 'reject-symlink-asset',
      properties: {
        entryCode: 'void 0;',
        resolveDir: process.cwd(),
        nodeBinaryPath: process.execPath,
        nodeVersion: process.versions.node,
        platform: process.platform,
        architecture: process.arch,
        assets: { activity: linkPath },
      },
    });

    try {
      await expect(build.prepareSeaAssets(buildDir)).rejects.toThrow(
        /regular non-symbolic file/i,
      );
      expect(build.has('embeddedAssetDigests')).toBe(false);
    } finally {
      await fsp.rm(tmpRoot, { force: true, recursive: true });
    }
  });

  it.each([
    [
      'an unexpected digest name',
      { activity: '/unused' },
      {
        other: {
          algorithm: 'sha256',
          value: createHash('sha256').update('unused').digest('base64url'),
        },
      },
      /does not name a configured asset/i,
    ],
    [
      'a malformed digest',
      { activity: '/unused' },
      { activity: { algorithm: 'sha1', value: 'not-a-sha256' } },
      /algorithm must be 'sha256'/i,
    ],
    ['a malformed asset mapping', [], {}, /assets must be an object/i],
  ])(
    'rejects %s before reading asset bytes',
    async (_label, invalidAssets, digests, error) => {
      const { default: SeaBuild } =
        await import('../../../src/core/resources/builds/sea-build.js');
      const tmpRoot = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'wharfie-sea-asset-invalid-'),
      );
      const build = new SeaBuild({
        name: 'reject-invalid-asset-metadata',
        properties: {
          entryCode: 'void 0;',
          resolveDir: process.cwd(),
          nodeBinaryPath: process.execPath,
          nodeVersion: process.versions.node,
          platform: process.platform,
          architecture: process.arch,
          assets: /** @type {any} */ (invalidAssets),
          assetDigests: /** @type {any} */ (digests),
        },
      });

      try {
        await expect(build.prepareSeaAssets(tmpRoot)).rejects.toThrow(error);
        expect(build.has('embeddedAssetDigests')).toBe(false);
      } finally {
        await fsp.rm(tmpRoot, { force: true, recursive: true });
      }
    },
  );
});
