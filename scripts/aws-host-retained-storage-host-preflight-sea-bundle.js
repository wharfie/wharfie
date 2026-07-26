/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- This closed build boundary keeps its compact schemas and injected port beside the implementation. */

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { pathToFileURL } from 'node:url';

import { build as esbuild } from '../src/core/lib/esbuild.js';

const NODE_TARGET = 'node24.13.1';
const GENERATED_SOURCE_NAME =
  '<wharfie-aws-host-retained-storage-host-preflight-sea-entry>';
const OUTPUT_FILE_NAME =
  'aws-host-retained-storage-host-preflight-sea-bundle.cjs';
const DELIVERY_MODULE_PATH =
  'scripts/aws-host-retained-storage-host-preflight-sea-delivery.js';
const COLLECTOR_MODULE_PATH =
  'scripts/collect-aws-host-retained-storage-preflight-linux.js';
const COLLECTOR_MODULE_FILTER =
  /collect-aws-host-retained-storage-preflight-linux\.js$/;
const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const ARCHITECTURES = new Set(['x86_64', 'arm64']);
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
const INPUT_KEYS = new Set([
  'snapshotRoot',
  'sourceCommit',
  'expectedArchitecture',
]);
const TEST_OPTION_KEYS = new Set(['ports']);
const PORT_KEYS = new Set(['build']);
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

const COLLECTOR_DIRECT_INVOCATION_SUFFIX = `
const invokedPath =
  typeof process.argv[1] === 'string'
    ? pathToFileURL(path.resolve(process.argv[1])).href
    : null;
if (invokedPath === import.meta.url) {
  try {
    await main(process.argv);
  } catch {
    process.stderr.write('AWS retained-storage host preflight failed.\\n');
    process.exitCode = 1;
  }
}
`;

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} valuePath @returns {void} */
function assertExactKeys(value, keys, valuePath) {
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))
  ) {
    throw new TypeError(
      `${valuePath} must contain only its exact required keys.`,
    );
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${valuePath}.${key} is required.`);
    }
  }
}

/** @param {Record<string, any>} value @param {string} key @param {string} valuePath @returns {any} */
function ownData(value, key, valuePath) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    throw new TypeError(`${valuePath}.${key} must be an own data property.`);
  }
  return descriptor.value;
}

/** @param {unknown} value @returns {Readonly<{snapshotRoot: string, sourceCommit: string, expectedArchitecture: 'x86_64'|'arm64'}>} */
function validateInput(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA bundle input must be an object.',
    );
  }
  assertExactKeys(
    value,
    INPUT_KEYS,
    'AWS retained-storage host preflight SEA bundle input',
  );

  const snapshotRoot = ownData(
    value,
    'snapshotRoot',
    'AWS retained-storage host preflight SEA bundle input',
  );
  const sourceCommit = ownData(
    value,
    'sourceCommit',
    'AWS retained-storage host preflight SEA bundle input',
  );
  const expectedArchitecture = ownData(
    value,
    'expectedArchitecture',
    'AWS retained-storage host preflight SEA bundle input',
  );

  if (
    typeof snapshotRoot !== 'string' ||
    snapshotRoot.includes('\0') ||
    !path.isAbsolute(snapshotRoot) ||
    path.resolve(snapshotRoot) !== snapshotRoot ||
    path.parse(snapshotRoot).root === snapshotRoot
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA bundle snapshotRoot must be a canonical absolute non-root path.',
    );
  }
  if (
    typeof sourceCommit !== 'string' ||
    !SOURCE_COMMIT_PATTERN.test(sourceCommit)
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA bundle sourceCommit must be 40 lowercase hexadecimal characters.',
    );
  }
  if (
    typeof expectedArchitecture !== 'string' ||
    !ARCHITECTURES.has(expectedArchitecture)
  ) {
    throw new TypeError(
      "AWS retained-storage host preflight SEA bundle expectedArchitecture must be 'x86_64' or 'arm64'.",
    );
  }

  const validatedArchitecture = /** @type {'x86_64'|'arm64'} */ (
    expectedArchitecture
  );
  return Object.freeze({
    snapshotRoot,
    sourceCommit,
    expectedArchitecture: validatedArchitecture,
  });
}

/** @param {string} snapshotRoot @returns {Promise<void>} */
async function validateSnapshotDirectory(snapshotRoot) {
  let stats;
  let resolved;
  try {
    stats = await fsp.lstat(snapshotRoot);
    resolved = await fsp.realpath(snapshotRoot);
  } catch {
    throw new TypeError(
      'AWS retained-storage host preflight SEA bundle snapshotRoot must name an existing directory.',
    );
  }
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    resolved !== snapshotRoot
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA bundle snapshotRoot must name one canonical real directory.',
    );
  }
}

/** @param {string} sourceCommit @param {'x86_64'|'arm64'} expectedArchitecture @returns {string} */
function createEntrySource(sourceCommit, expectedArchitecture) {
  return [
    "import process from 'node:process';",
    `import { createAwsRetainedStorageHostPreflightSeaRuntime } from './${DELIVERY_MODULE_PATH}';`,
    '',
    'void (async () => {',
    '  await createAwsRetainedStorageHostPreflightSeaRuntime({',
    `    sourceCommit: ${JSON.stringify(sourceCommit)},`,
    `    expectedArchitecture: ${JSON.stringify(expectedArchitecture)},`,
    '  }).run(process.argv);',
    '})().catch(() => {',
    "  process.stderr.write('AWS retained-storage host preflight SEA delivery failed.\\n');",
    '  process.exitCode = 1;',
    '});',
    '',
  ].join('\n');
}

/**
 * The archived collector is also a directly executable ESM script. Its
 * top-level await cannot be represented in the required CommonJS SEA blob.
 * Strip only its exact, fixed direct-execution tail while preserving the
 * archived exported collector implementation used by the delivery runtime.
 * @param {string} snapshotRoot - Canonical exact-snapshot root.
 * @returns {import('esbuild').Plugin}
 */
function createImportOnlyCollectorPlugin(snapshotRoot) {
  const expectedCollectorPath = path.join(snapshotRoot, COLLECTOR_MODULE_PATH);
  return {
    name: 'wharfie-aws-host-preflight-import-only-collector',
    setup(build) {
      build.onLoad({ filter: COLLECTOR_MODULE_FILTER }, async (args) => {
        if (
          args.namespace !== 'file' ||
          path.resolve(args.path) !== expectedCollectorPath
        ) {
          return null;
        }
        const source = await fsp.readFile(expectedCollectorPath, 'utf8');
        if (!source.endsWith(COLLECTOR_DIRECT_INVOCATION_SUFFIX)) {
          throw new Error(
            'Archived AWS retained-storage host preflight collector has an unsupported direct-execution boundary.',
          );
        }
        return {
          contents: `${source.slice(
            0,
            -COLLECTOR_DIRECT_INVOCATION_SUFFIX.length,
          )}\n`,
          loader: 'js',
          resolveDir: path.dirname(expectedCollectorPath),
        };
      });
    },
  };
}

/** @param {string} root @param {string} candidate @returns {boolean} */
function isWithin(root, candidate) {
  const relation = path.relative(root, candidate);
  return (
    relation === '' ||
    (relation !== '..' &&
      !relation.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relation))
  );
}

/**
 * Reject malformed metafile import records and prove that every external is a
 * `node:` built-in. A single-output bundle cannot retain an internal output
 * import.
 * @param {unknown} imports - Metafile import collection.
 * @param {string} valuePath - Stable diagnostic path.
 * @param {boolean} requireExternal - Whether every import must be external.
 * @returns {void}
 */
function validateImports(imports, valuePath, requireExternal) {
  if (!Array.isArray(imports)) {
    throw new Error(`${valuePath} must describe its imports.`);
  }
  for (const [index, entry] of imports.entries()) {
    const entryPath = `${valuePath}.imports[${index}]`;
    if (
      !isPlainObject(entry) ||
      !Object.hasOwn(entry, 'path') ||
      typeof ownData(entry, 'path', entryPath) !== 'string' ||
      ownData(entry, 'path', entryPath).length === 0 ||
      ownData(entry, 'path', entryPath).includes('\0')
    ) {
      throw new Error(`${entryPath} is invalid.`);
    }
    const importPath = ownData(entry, 'path', entryPath);
    const externalDescriptor = Object.getOwnPropertyDescriptor(
      entry,
      'external',
    );
    if (
      externalDescriptor &&
      (!externalDescriptor.enumerable ||
        !Object.hasOwn(externalDescriptor, 'value') ||
        typeof externalDescriptor.value !== 'boolean')
    ) {
      throw new Error(`${entryPath}.external must be a boolean data property.`);
    }
    const external = externalDescriptor?.value === true;
    if (requireExternal && !external) {
      throw new Error(
        'AWS retained-storage host preflight SEA bundle output contains an internal import.',
      );
    }
    if (external && !importPath.startsWith('node:')) {
      throw new Error(
        'AWS retained-storage host preflight SEA bundle contains a non-node external import.',
      );
    }
    if (!external && importPath.startsWith('node:')) {
      throw new Error(
        'AWS retained-storage host preflight SEA bundle contains a malformed node external import.',
      );
    }
  }
}

/** @param {string} snapshotRoot @param {string} absoluteInput @returns {Promise<void>} */
async function validateSnapshotInputFile(snapshotRoot, absoluteInput) {
  let stats;
  let resolved;
  try {
    stats = await fsp.lstat(absoluteInput);
    resolved = await fsp.realpath(absoluteInput);
  } catch {
    throw new Error(
      'AWS retained-storage host preflight SEA bundle metadata names a missing snapshot input.',
    );
  }
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    resolved !== absoluteInput ||
    !isWithin(snapshotRoot, resolved)
  ) {
    throw new Error(
      'AWS retained-storage host preflight SEA bundle input must be one real regular file inside its exact snapshot.',
    );
  }
}

/**
 * Prove that esbuild consumed only the generated source, archived files, and
 * `node:` built-ins, and returned exactly the requested JavaScript output.
 * @param {unknown} resultValue - Esbuild result to validate.
 * @param {string} snapshotRoot - Canonical exact-snapshot root.
 * @returns {Promise<Buffer>}
 */
async function validateBuildResult(resultValue, snapshotRoot) {
  if (!isPlainObject(resultValue)) {
    throw new Error(
      'AWS retained-storage host preflight SEA bundle build result is invalid.',
    );
  }
  const result = resultValue;
  const metafile = result.metafile;
  if (
    !isPlainObject(metafile) ||
    !isPlainObject(metafile.inputs) ||
    !isPlainObject(metafile.outputs)
  ) {
    throw new Error(
      'AWS retained-storage host preflight SEA bundle requires esbuild metadata.',
    );
  }

  const inputPaths = Object.keys(metafile.inputs);
  if (!inputPaths.includes(GENERATED_SOURCE_NAME)) {
    throw new Error(
      'AWS retained-storage host preflight SEA bundle metadata omits its generated entry.',
    );
  }

  const resolvedInputs = new Set();
  for (const inputPath of inputPaths) {
    const inputMetadata = metafile.inputs[inputPath];
    if (!isPlainObject(inputMetadata)) {
      throw new Error(
        'AWS retained-storage host preflight SEA bundle input metadata is invalid.',
      );
    }
    validateImports(
      inputMetadata.imports,
      'AWS retained-storage host preflight SEA bundle input metadata',
      false,
    );
    if (inputPath === GENERATED_SOURCE_NAME) continue;
    if (
      typeof inputPath !== 'string' ||
      inputPath.length === 0 ||
      inputPath.startsWith('<') ||
      inputPath.includes('\0') ||
      inputPath.includes(':') ||
      inputPath.includes('\\')
    ) {
      throw new Error(
        'AWS retained-storage host preflight SEA bundle contains an unsupported virtual or namespaced input.',
      );
    }

    const absoluteInput = path.isAbsolute(inputPath)
      ? path.normalize(inputPath)
      : path.resolve(snapshotRoot, inputPath);
    if (
      (path.isAbsolute(inputPath)
        ? path.normalize(inputPath) !== inputPath
        : path.normalize(inputPath) !== inputPath || inputPath === '.') ||
      resolvedInputs.has(absoluteInput)
    ) {
      throw new Error(
        'AWS retained-storage host preflight SEA bundle contains an ambiguous snapshot input.',
      );
    }
    if (!isWithin(snapshotRoot, absoluteInput)) {
      throw new Error(
        'AWS retained-storage host preflight SEA bundle contains an input outside its exact snapshot.',
      );
    }
    const inputSegments = path
      .relative(snapshotRoot, absoluteInput)
      .split(/[\\/]/u);
    if (
      inputSegments.some((segment) => segment.toLowerCase() === 'node_modules')
    ) {
      throw new Error(
        'AWS retained-storage host preflight SEA bundle must not consume a node_modules closure.',
      );
    }
    await validateSnapshotInputFile(snapshotRoot, absoluteInput);
    resolvedInputs.add(absoluteInput);
  }

  for (const requiredPath of [DELIVERY_MODULE_PATH, COLLECTOR_MODULE_PATH]) {
    if (!resolvedInputs.has(path.join(snapshotRoot, requiredPath))) {
      throw new Error(
        'AWS retained-storage host preflight SEA bundle omits a required archived runtime module.',
      );
    }
  }

  const outputNames = Object.keys(metafile.outputs);
  if (
    outputNames.length !== 1 ||
    outputNames[0] !== OUTPUT_FILE_NAME ||
    !isPlainObject(metafile.outputs[OUTPUT_FILE_NAME])
  ) {
    throw new Error(
      'AWS retained-storage host preflight SEA bundle must produce exactly one CommonJS output.',
    );
  }
  const outputMetadata = metafile.outputs[OUTPUT_FILE_NAME];
  validateImports(
    outputMetadata.imports,
    'AWS retained-storage host preflight SEA bundle output metadata',
    true,
  );
  if (outputMetadata.entryPoint !== GENERATED_SOURCE_NAME) {
    throw new Error(
      'AWS retained-storage host preflight SEA bundle output has an invalid entrypoint.',
    );
  }

  if (!Array.isArray(result.outputFiles) || result.outputFiles.length !== 1) {
    throw new Error(
      'AWS retained-storage host preflight SEA bundle must return exactly one JavaScript output.',
    );
  }
  const outputFile = result.outputFiles[0];
  if (
    !outputFile ||
    typeof outputFile !== 'object' ||
    typeof outputFile.path !== 'string' ||
    path.resolve(outputFile.path) !==
      path.join(snapshotRoot, OUTPUT_FILE_NAME) ||
    !(outputFile.contents instanceof Uint8Array) ||
    outputFile.contents.byteLength === 0 ||
    outputFile.contents.byteLength > MAX_BUNDLE_BYTES
  ) {
    throw new Error(
      `AWS retained-storage host preflight SEA bundle JavaScript output must contain between 1 and ${MAX_BUNDLE_BYTES} bytes.`,
    );
  }
  const bytes = Buffer.from(outputFile.contents);
  if (
    !Number.isSafeInteger(outputMetadata.bytes) ||
    outputMetadata.bytes !== bytes.byteLength
  ) {
    throw new Error(
      'AWS retained-storage host preflight SEA bundle output byte evidence is invalid.',
    );
  }

  let outputText;
  try {
    outputText = UTF8_DECODER.decode(bytes);
  } catch {
    throw new Error(
      'AWS retained-storage host preflight SEA bundle output must be UTF-8 JavaScript.',
    );
  }
  const posixSnapshotRoot = snapshotRoot.split(path.sep).join('/');
  const forbiddenPaths = new Set([
    snapshotRoot,
    posixSnapshotRoot,
    JSON.stringify(snapshotRoot).slice(1, -1),
    JSON.stringify(posixSnapshotRoot).slice(1, -1),
    pathToFileURL(snapshotRoot).href,
  ]);
  if (
    [...forbiddenPaths].some(
      (forbiddenPath) =>
        forbiddenPath.length > 0 && outputText.includes(forbiddenPath),
    )
  ) {
    throw new Error(
      'AWS retained-storage host preflight SEA bundle output contains its snapshot path.',
    );
  }
  return bytes;
}

/** @param {unknown} portsValue @returns {Readonly<{build: (options: import('esbuild').BuildOptions) => Promise<unknown>} >} */
function capturePorts(portsValue) {
  if (!isPlainObject(portsValue)) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA bundle ports must be an object.',
    );
  }
  assertExactKeys(
    portsValue,
    PORT_KEYS,
    'AWS retained-storage host preflight SEA bundle ports',
  );
  const build = ownData(
    portsValue,
    'build',
    'AWS retained-storage host preflight SEA bundle ports',
  );
  if (typeof build !== 'function') {
    throw new TypeError(
      'AWS retained-storage host preflight SEA bundle ports.build must be a function.',
    );
  }
  return Object.freeze({ build: build.bind(portsValue) });
}

/** @param {Readonly<{build: (options: import('esbuild').BuildOptions) => Promise<unknown>} >} ports - Captured build port. */
function createBundler(ports) {
  return Object.freeze({
    /** @param {unknown} value @returns {Promise<Readonly<{bytes: Buffer, byteDigest: Readonly<{algorithm: 'sha256', value: string}>, size: number}>>} */
    async bundle(value) {
      if (arguments.length !== 1) {
        throw new TypeError(
          'AWS retained-storage host preflight SEA bundler requires one input.',
        );
      }
      const input = validateInput(value);
      await validateSnapshotDirectory(input.snapshotRoot);
      const entrySource = createEntrySource(
        input.sourceCommit,
        input.expectedArchitecture,
      );
      const result = await ports.build({
        absWorkingDir: input.snapshotRoot,
        stdin: {
          contents: entrySource,
          resolveDir: input.snapshotRoot,
          sourcefile: GENERATED_SOURCE_NAME,
          loader: 'js',
        },
        outfile: OUTPUT_FILE_NAME,
        write: false,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: NODE_TARGET,
        metafile: true,
        sourcemap: false,
        minify: true,
        keepNames: false,
        legalComments: 'none',
        charset: 'utf8',
        treeShaking: true,
        packages: 'bundle',
        logLevel: 'silent',
        plugins: [createImportOnlyCollectorPlugin(input.snapshotRoot)],
      });
      const bytes = await validateBuildResult(result, input.snapshotRoot);
      const privateBytes = Buffer.from(bytes);
      return Object.freeze({
        bytes: privateBytes,
        byteDigest: Object.freeze({
          algorithm: /** @type {'sha256'} */ ('sha256'),
          value: createHash('sha256').update(privateBytes).digest('base64url'),
        }),
        size: privateBytes.byteLength,
      });
    },
  });
}

const PRODUCTION_BUNDLER = createBundler(
  Object.freeze({
    build: esbuild,
  }),
);

/**
 * Bundle the selected host-preflight runtime solely from one exact commit
 * snapshot.
 * @param {unknown} inputValue - Exact snapshot and baked runtime expectation.
 * @returns {Promise<Readonly<{bytes: Buffer, byteDigest: Readonly<{algorithm: 'sha256', value: string}>, size: number}>>}
 */
export async function bundleAwsRetainedStorageHostPreflightSea(inputValue) {
  if (arguments.length !== 1) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA bundle requires one input.',
    );
  }
  return PRODUCTION_BUNDLER.bundle(inputValue);
}

/**
 * Create a closed test bundler with one injected esbuild-compatible port.
 * @param {unknown} optionsValue - Exact test options.
 * @returns {Readonly<{bundle: (input: unknown) => Promise<Readonly<{bytes: Buffer, byteDigest: Readonly<{algorithm: 'sha256', value: string}>, size: number}>>}>}
 */
export function createAwsRetainedStorageHostPreflightSeaBundlerForTest(
  optionsValue,
) {
  if (!isPlainObject(optionsValue)) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA bundle test options must be an object.',
    );
  }
  assertExactKeys(
    optionsValue,
    TEST_OPTION_KEYS,
    'AWS retained-storage host preflight SEA bundle test options',
  );
  return createBundler(
    capturePorts(
      ownData(
        optionsValue,
        'ports',
        'AWS retained-storage host preflight SEA bundle test options',
      ),
    ),
  );
}

export default bundleAwsRetainedStorageHostPreflightSea;
