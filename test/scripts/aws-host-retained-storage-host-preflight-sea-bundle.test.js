import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, jest } from '@jest/globals';

import {
  bundleAwsRetainedStorageHostPreflightSea,
  createAwsRetainedStorageHostPreflightSeaBundlerForTest,
} from '../../scripts/aws-host-retained-storage-host-preflight-sea-bundle.js';

const REPO_ROOT = path.resolve(
  fileURLToPath(new URL('../../', import.meta.url)),
);
const SOURCE_COMMIT = 'a'.repeat(40);
const GENERATED_SOURCE_NAME =
  '<wharfie-aws-host-retained-storage-host-preflight-sea-entry>';
const OUTPUT_FILE_NAME =
  'aws-host-retained-storage-host-preflight-sea-bundle.cjs';
const DELIVERY_MODULE_PATH =
  'scripts/aws-host-retained-storage-host-preflight-sea-delivery.js';
const COLLECTOR_MODULE_PATH =
  'scripts/collect-aws-host-retained-storage-preflight-linux.js';
const BASE_INPUT = Object.freeze({
  snapshotRoot: REPO_ROOT,
  sourceCommit: SOURCE_COMMIT,
  expectedArchitecture: 'x86_64',
});

/** @param {Buffer|Uint8Array} contents @param {{snapshotRoot?: string, inputs?: Record<string, any>, inputImports?: any[], outputImports?: any[], outputs?: Record<string, any>, outputFiles?: any[]}} [options] */
function createBuildResult(contents, options = {}) {
  const snapshotRoot = options.snapshotRoot || REPO_ROOT;
  const inputs = {
    [DELIVERY_MODULE_PATH]: { bytes: 1, imports: [] },
    [COLLECTOR_MODULE_PATH]: { bytes: 1, imports: [] },
    [GENERATED_SOURCE_NAME]: {
      bytes: 1,
      imports: options.inputImports || [
        { path: 'node:process', external: true },
      ],
    },
    ...(options.inputs || {}),
  };
  const outputs = options.outputs || {
    [OUTPUT_FILE_NAME]: {
      bytes: contents.byteLength,
      inputs: {},
      imports: options.outputImports || [
        { path: 'node:process', external: true },
      ],
      exports: [],
      entryPoint: GENERATED_SOURCE_NAME,
    },
  };
  return {
    errors: [],
    warnings: [],
    metafile: { inputs, outputs },
    outputFiles: options.outputFiles || [
      {
        path: path.join(snapshotRoot, OUTPUT_FILE_NAME),
        contents,
      },
    ],
  };
}

/** @param {(options: Record<string, any>) => Promise<any>} [implementation] */
function createHarness(implementation) {
  const build = jest.fn(
    implementation ||
      (async () => createBuildResult(Buffer.from('console.log("ok");\n'))),
  );
  const bundler = createAwsRetainedStorageHostPreflightSeaBundlerForTest({
    ports: { build },
  });
  return { build, bundler };
}

describe('AWS retained-storage host-preflight SEA snapshot bundle', () => {
  it('builds one deterministic CommonJS entry and returns cloned frozen byte evidence', async () => {
    const buildBytes = Buffer.from('console.log("portable");\n');
    const { build, bundler } = createHarness(async () =>
      createBuildResult(buildBytes),
    );

    const result = await bundler.bundle(BASE_INPUT);

    expect(build).toHaveBeenCalledTimes(1);
    const options = build.mock.calls[0][0];
    expect(Object.keys(options).sort()).toEqual(
      [
        'absWorkingDir',
        'bundle',
        'charset',
        'format',
        'keepNames',
        'legalComments',
        'logLevel',
        'metafile',
        'minify',
        'outfile',
        'packages',
        'platform',
        'plugins',
        'sourcemap',
        'stdin',
        'target',
        'treeShaking',
        'write',
      ].sort(),
    );
    expect(options).toMatchObject({
      absWorkingDir: REPO_ROOT,
      outfile: OUTPUT_FILE_NAME,
      write: false,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node24.13.1',
      metafile: true,
      sourcemap: false,
      minify: true,
      keepNames: false,
      legalComments: 'none',
      charset: 'utf8',
      treeShaking: true,
      packages: 'bundle',
      logLevel: 'silent',
    });
    expect(options.stdin).toEqual({
      contents: [
        "import process from 'node:process';",
        "import { createAwsRetainedStorageHostPreflightSeaRuntime } from './scripts/aws-host-retained-storage-host-preflight-sea-delivery.js';",
        '',
        'void (async () => {',
        '  await createAwsRetainedStorageHostPreflightSeaRuntime({',
        `    sourceCommit: "${SOURCE_COMMIT}",`,
        '    expectedArchitecture: "x86_64",',
        '  }).run(process.argv);',
        '})().catch(() => {',
        "  process.stderr.write('AWS retained-storage host preflight SEA delivery failed.\\n');",
        '  process.exitCode = 1;',
        '});',
        '',
      ].join('\n'),
      resolveDir: REPO_ROOT,
      sourcefile: GENERATED_SOURCE_NAME,
      loader: 'js',
    });
    expect(options.plugins).toHaveLength(1);
    expect(options.plugins[0].name).toBe(
      'wharfie-aws-host-preflight-import-only-collector',
    );

    expect(result).toEqual({
      bytes: buildBytes,
      byteDigest: {
        algorithm: 'sha256',
        value: createHash('sha256').update(buildBytes).digest('base64url'),
      },
      size: buildBytes.byteLength,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.byteDigest)).toBe(true);
    expect(Object.isFrozen(result.bytes)).toBe(false);
    expect(result.bytes).not.toBe(buildBytes);
    buildBytes.fill(0);
    expect(result.bytes.toString('utf8')).toBe('console.log("portable");\n');
  });

  it.each([
    ['null input', null],
    ['missing key', { ...BASE_INPUT, sourceCommit: undefined }],
    ['extra key', { ...BASE_INPUT, extra: true }],
    ['relative root', { ...BASE_INPUT, snapshotRoot: 'snapshot' }],
    [
      'noncanonical root',
      { ...BASE_INPUT, snapshotRoot: `${REPO_ROOT}${path.sep}` },
    ],
    ['short commit', { ...BASE_INPUT, sourceCommit: 'a'.repeat(39) }],
    ['uppercase commit', { ...BASE_INPUT, sourceCommit: 'A'.repeat(40) }],
    ['unknown architecture', { ...BASE_INPUT, expectedArchitecture: 'amd64' }],
  ])('rejects %s before invoking esbuild', async (_label, input) => {
    const { build, bundler } = createHarness();
    await expect(bundler.bundle(input)).rejects.toThrow();
    expect(build).not.toHaveBeenCalled();
  });

  it('rejects accessors and invalid injected port surfaces without invoking them', async () => {
    let inputAccessorInvoked = false;
    const input = {
      snapshotRoot: REPO_ROOT,
      expectedArchitecture: 'x86_64',
    };
    Object.defineProperty(input, 'sourceCommit', {
      enumerable: true,
      get() {
        inputAccessorInvoked = true;
        return SOURCE_COMMIT;
      },
    });
    const { build, bundler } = createHarness();

    await expect(bundler.bundle(input)).rejects.toThrow(/own data property/i);
    expect(inputAccessorInvoked).toBe(false);
    expect(build).not.toHaveBeenCalled();

    expect(() =>
      createAwsRetainedStorageHostPreflightSeaBundlerForTest({
        ports: { build, extra: true },
      }),
    ).toThrow(/exact required keys/i);
    expect(() =>
      createAwsRetainedStorageHostPreflightSeaBundlerForTest({
        ports: { build: null },
      }),
    ).toThrow(/must be a function/i);
  });

  it.each([
    [
      'a bare external package',
      {
        inputImports: [{ path: 'semver', external: true }],
      },
      /non-node external import/i,
    ],
    [
      'an input outside the snapshot',
      {
        inputs: {
          '../live-package/index.js': { bytes: 1, imports: [] },
        },
      },
      /outside its exact snapshot/i,
    ],
    [
      'a node_modules closure inside the snapshot',
      {
        inputs: {
          'node_modules/semver/index.js': { bytes: 1, imports: [] },
        },
      },
      /node_modules closure/i,
    ],
    [
      'another virtual input',
      {
        inputs: {
          '<live-package>': { bytes: 1, imports: [] },
        },
      },
      /unsupported virtual or namespaced input/i,
    ],
    [
      'a plugin namespace',
      {
        inputs: {
          'plugin-namespace:secret': { bytes: 1, imports: [] },
        },
      },
      /unsupported virtual or namespaced input/i,
    ],
    [
      'a non-node output import',
      {
        outputImports: [{ path: 'semver', external: true }],
      },
      /non-node external import/i,
    ],
    [
      'a malformed input import record',
      {
        inputImports: [null],
      },
      /imports\[0\] is invalid/i,
    ],
    [
      'a node import not marked external',
      {
        inputImports: [{ path: 'node:process', external: false }],
      },
      /malformed node external import/i,
    ],
    [
      'an internal output import',
      {
        outputImports: [{ path: 'node:process' }],
      },
      /output contains an internal import/i,
    ],
  ])(
    'rejects build metadata containing %s',
    async (_label, mutation, error) => {
      const { bundler } = createHarness(async () =>
        createBuildResult(Buffer.from('console.log("ok");\n'), mutation),
      );
      await expect(bundler.bundle(BASE_INPUT)).rejects.toThrow(error);
    },
  );

  it('rejects missing metadata, multiple outputs, and snapshot paths in output bytes', async () => {
    const missingMetadata = createHarness(async () => ({
      outputFiles: [],
    }));
    await expect(missingMetadata.bundler.bundle(BASE_INPUT)).rejects.toThrow(
      /requires esbuild metadata/i,
    );

    const twoOutputBytes = Buffer.from('console.log("ok");\n');
    const twoOutputs = createHarness(async () =>
      createBuildResult(twoOutputBytes, {
        outputs: {
          [OUTPUT_FILE_NAME]: {
            bytes: twoOutputBytes.byteLength,
            imports: [],
            entryPoint: GENERATED_SOURCE_NAME,
          },
          'unexpected.css': {
            bytes: 1,
            imports: [],
          },
        },
      }),
    );
    await expect(twoOutputs.bundler.bundle(BASE_INPUT)).rejects.toThrow(
      /exactly one CommonJS output/i,
    );

    const leakedBytes = Buffer.from(
      `const root = ${JSON.stringify(REPO_ROOT)};`,
    );
    const leakedPath = createHarness(async () =>
      createBuildResult(leakedBytes),
    );
    await expect(leakedPath.bundler.bundle(BASE_INPUT)).rejects.toThrow(
      /contains its snapshot path/i,
    );
  });

  it('rejects outputs larger than the internal 8 MiB ceiling', async () => {
    const oversizedBytes = Buffer.alloc(8 * 1024 * 1024 + 1, 0x61);
    const oversized = createHarness(async () =>
      createBuildResult(oversizedBytes),
    );

    await expect(oversized.bundler.bundle(BASE_INPUT)).rejects.toThrow(
      /between 1 and 8388608 bytes/i,
    );
  });

  it('rejects a symlinked file inside an otherwise real snapshot root', async () => {
    const temporaryRoot = await fsp.mkdtemp(
      '/private/tmp/wharfie-sea-bundle-symlink-',
    );
    try {
      const scriptsDirectory = path.join(temporaryRoot, 'scripts');
      await fsp.mkdir(scriptsDirectory);
      await fsp.writeFile(
        path.join(scriptsDirectory, path.basename(COLLECTOR_MODULE_PATH)),
        'export async function main() {}\n',
      );
      const realDelivery = path.join(scriptsDirectory, 'real-delivery.js');
      await fsp.writeFile(realDelivery, 'export function create() {}\n');
      await fsp.symlink(
        realDelivery,
        path.join(scriptsDirectory, path.basename(DELIVERY_MODULE_PATH)),
      );
      const input = {
        ...BASE_INPUT,
        snapshotRoot: temporaryRoot,
      };
      const { bundler } = createHarness(async () =>
        createBuildResult(Buffer.from('console.log("ok");\n'), {
          snapshotRoot: temporaryRoot,
        }),
      );

      await expect(bundler.bundle(input)).rejects.toThrow(
        /one real regular file inside its exact snapshot/i,
      );
    } finally {
      await fsp.rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('bundles the selected archive graph using only snapshot files and node built-ins', async () => {
    const result = await bundleAwsRetainedStorageHostPreflightSea(BASE_INPUT);

    expect(Buffer.isBuffer(result.bytes)).toBe(true);
    expect(result.size).toBe(result.bytes.byteLength);
    expect(result.size).toBeGreaterThan(1_000);
    expect(result.byteDigest).toEqual({
      algorithm: 'sha256',
      value: createHash('sha256').update(result.bytes).digest('base64url'),
    });
    const source = result.bytes.toString('utf8');
    expect(source).toContain(
      'AWS retained-storage host preflight SEA delivery failed.',
    );
    expect(source).not.toContain(REPO_ROOT);
    expect(source).not.toContain('node_modules');
  }, 20_000);
});
