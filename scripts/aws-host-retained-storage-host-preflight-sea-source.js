/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- This closed source-snapshot boundary keeps its compact capability types beside the implementation. */

import { execFile as nodeExecFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

import { extract as extractTar, list as listTar } from 'tar';

export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_ARCHIVE_FORMAT =
  'git-archive-tar-v1';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_MAX_ARCHIVE_BYTES =
  32 * 1024 * 1024;
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_MAX_EXPANDED_BYTES =
  32 * 1024 * 1024;
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_MAX_FILE_BYTES =
  2 * 1024 * 1024;
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_MAX_ENTRIES = 4096;

const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const GIT_OBJECT_FORMAT_PATTERN = /^(sha1|sha256)\n$/u;
const GIT_TREE_MODE_PATTERN = /^(100644|100755)$/u;
const GIT_TEXT_MAX_BYTES = 128;
const GIT_TIMEOUT_MILLISECONDS = 60 * 1000;
const TAR_BLOCK_BYTES = 512;
const TAR_END_BYTES = 2 * TAR_BLOCK_BYTES;
const MAX_PATH_BYTES = 4 * 1024;
const TEMP_DIRECTORY_PREFIX = 'wharfie-host-preflight-sea-source-';
const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(MODULE_DIRECTORY, '..');
const INPUT_KEYS = new Set(['sourceCommit']);
const TEST_INPUT_KEYS = new Set(['sourceCommit', 'gitPort']);
const GIT_PORT_KEYS = new Set(['run']);
const REQUIRED_SOURCE_FILES = new Set([
  'package.json',
  'package-lock.json',
  'scripts/aws-host-retained-storage-host-preflight-sea-delivery.js',
  'scripts/collect-aws-host-retained-storage-preflight-linux.js',
  'scripts/aws-host-retained-storage-host-preflight.js',
  'src/core/lib/node-sea.js',
  'src/core/runtime/canonical-order.js',
  'src/core/runtime/content-id.js',
  'src/core/runtime/json-value.js',
  'src/core/runtime/manifest-security.js',
]);

/** One fixed Git-boundary failure that never includes child output. */
export class AwsRetainedStorageHostPreflightSeaSourceGitError extends Error {
  constructor() {
    super('AWS retained-storage host preflight source Git operation failed.');
    this.name = 'AwsRetainedStorageHostPreflightSeaSourceGitError';
    this.code = 'AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_GIT_FAILED';
  }
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} pathLabel @returns {void} */
function assertExactKeys(value, keys, pathLabel) {
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))
  ) {
    throw new TypeError(
      `${pathLabel} must contain only its exact required keys.`,
    );
  }
}

/** @param {Record<string, any>} value @param {string} key @param {string} pathLabel @returns {any} */
function ownData(value, key, pathLabel) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    throw new TypeError(`${pathLabel}.${key} must be an own data property.`);
  }
  return descriptor.value;
}

/** @param {unknown} value @returns {string} */
function validateSourceCommit(value) {
  if (typeof value !== 'string' || !SOURCE_COMMIT_PATTERN.test(value)) {
    throw new TypeError(
      'AWS retained-storage host preflight sourceCommit must be one lowercase 40-hex Git commit ID.',
    );
  }
  return value;
}

/** @param {unknown} value @param {Set<string>} keys @param {string} pathLabel @returns {Readonly<Record<string, Function>>} */
function captureMethods(value, keys, pathLabel) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${pathLabel} must be a plain object.`);
  }
  assertExactKeys(value, keys, pathLabel);
  /** @type {Record<string, Function>} */
  const methods = {};
  for (const key of keys) {
    const method = ownData(value, key, pathLabel);
    if (typeof method !== 'function') {
      throw new TypeError(`${pathLabel}.${key} must be a function.`);
    }
    methods[key] = method.bind(value);
  }
  return Object.freeze(methods);
}

/** @returns {NodeJS.ProcessEnv} */
function createGitEnvironment() {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (name.startsWith('GIT_')) delete environment[name];
  }
  environment.GIT_NO_REPLACE_OBJECTS = '1';
  environment.GIT_OPTIONAL_LOCKS = '0';
  environment.GIT_ATTR_NOSYSTEM = '1';
  environment.GIT_CONFIG_NOSYSTEM = '1';
  environment.GIT_CONFIG_GLOBAL = os.devNull;
  environment.GIT_CONFIG_SYSTEM = os.devNull;
  environment.LC_ALL = 'C';
  return environment;
}

/**
 * Run one fixed Git argv without a shell and capture bounded stdout. Child
 * output is intentionally never rendered into errors.
 * @param {Readonly<string[]>} args - Complete fixed Git argv.
 * @param {Buffer | null} input - Optional bounded stdin bytes.
 * @param {number} maxOutputBytes - Exact stdout/stderr buffer ceiling.
 * @returns {Promise<Buffer>}
 */
async function runProductionGit(args, input, maxOutputBytes) {
  return await new Promise((resolve, reject) => {
    const child = nodeExecFile(
      'git',
      [
        '-c',
        `core.attributesFile=${os.devNull}`,
        '-c',
        'tar.umask=0022',
        ...args,
      ],
      {
        cwd: REPOSITORY_ROOT,
        encoding: null,
        env: createGitEnvironment(),
        killSignal: 'SIGKILL',
        maxBuffer: maxOutputBytes,
        shell: false,
        timeout: GIT_TIMEOUT_MILLISECONDS,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error || !Buffer.isBuffer(stdout)) {
          reject(new AwsRetainedStorageHostPreflightSeaSourceGitError());
          return;
        }
        resolve(stdout);
      },
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(input || undefined);
  });
}

/** @returns {Readonly<{run: typeof runProductionGit}>} */
function createProductionGitPort() {
  return Object.freeze({ run: runProductionGit });
}

/** @param {unknown} value @param {number} maxBytes @param {string} pathLabel @returns {Buffer} */
function snapshotBoundedBytes(value, maxBytes, pathLabel) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new TypeError(`${pathLabel} must return bytes.`);
  }
  const byteLength = value.byteLength;
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength < 1 ||
    byteLength > maxBytes
  ) {
    throw new RangeError(`${pathLabel} exceeds its byte limit.`);
  }
  return Buffer.from(value);
}

/** @param {Buffer} value @param {string} expected @param {string} pathLabel @returns {void} */
function assertExactGitCommitOutput(value, expected, pathLabel) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch {
    throw new AwsRetainedStorageHostPreflightSeaSourceGitError();
  }
  if (text !== `${expected}\n`) {
    throw new Error(
      `${pathLabel} did not identify the exact requested commit.`,
    );
  }
}

/** @param {Buffer} value @param {string} sourceCommit @returns {'sha1'|'sha256'} */
function parseGitObjectFormat(value, sourceCommit) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch {
    throw new AwsRetainedStorageHostPreflightSeaSourceGitError();
  }
  if (!GIT_OBJECT_FORMAT_PATTERN.test(text)) {
    throw new Error(
      'AWS retained-storage host preflight source repository object format is unsupported.',
    );
  }
  const objectFormat = /** @type {'sha1'|'sha256'} */ (text.slice(0, -1));
  const objectIdLength = objectFormat === 'sha1' ? 40 : 64;
  if (sourceCommit.length !== objectIdLength) {
    throw new Error(
      'AWS retained-storage host preflight source repository object format does not match the requested commit ID.',
    );
  }
  return objectFormat;
}

/**
 * Parse one bounded `git ls-tree -r -z --full-tree` result. Only regular and
 * executable blobs are accepted: symlinks, gitlinks, trees, and unknown modes
 * cannot become executable build input.
 * @param {Buffer} bytes - Exact bounded Git tree listing.
 * @param {'sha1'|'sha256'} objectFormat - Repository object format.
 * @returns {Map<string, Readonly<{mode: '100644'|'100755', objectId: string}>>}
 */
function parseGitTree(bytes, objectFormat) {
  const objectIdLength = objectFormat === 'sha1' ? 40 : 64;
  /** @type {Map<string, Readonly<{mode: '100644'|'100755', objectId: string}>>} */
  const tree = new Map();
  let offset = 0;
  while (offset < bytes.length) {
    const terminal = bytes.indexOf(0, offset);
    if (terminal < 0 || terminal === offset) {
      throw new Error(
        'AWS retained-storage host preflight source Git tree listing is malformed.',
      );
    }
    const record = bytes.subarray(offset, terminal);
    offset = terminal + 1;
    const separator = record.indexOf(0x09);
    if (separator < 0) {
      throw new Error(
        'AWS retained-storage host preflight source Git tree listing is malformed.',
      );
    }
    let metadata;
    let rawPath;
    try {
      metadata = new TextDecoder('utf-8', { fatal: true }).decode(
        record.subarray(0, separator),
      );
      rawPath = new TextDecoder('utf-8', { fatal: true }).decode(
        record.subarray(separator + 1),
      );
    } catch {
      throw new Error(
        'AWS retained-storage host preflight source Git tree listing is malformed.',
      );
    }
    const fields = metadata.split(' ');
    if (fields.length !== 3) {
      throw new Error(
        'AWS retained-storage host preflight source Git tree listing is malformed.',
      );
    }
    const [mode, type, objectId] = fields;
    if (!GIT_TREE_MODE_PATTERN.test(mode) || type !== 'blob') {
      throw new Error(
        'AWS retained-storage host preflight source Git tree contains a non-regular entry.',
      );
    }
    if (objectId.length !== objectIdLength || !/^[0-9a-f]+$/u.test(objectId)) {
      throw new Error(
        'AWS retained-storage host preflight source Git tree listing is malformed.',
      );
    }
    const logicalPath = validateArchivePath(rawPath, 'File');
    if (
      tree.size >= AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_MAX_ENTRIES
    ) {
      throw new RangeError(
        'AWS retained-storage host preflight source Git tree contains too many entries.',
      );
    }
    if (tree.has(logicalPath)) {
      throw new Error(
        'AWS retained-storage host preflight source Git tree contains a duplicate path.',
      );
    }
    const regularMode = /** @type {'100644'|'100755'} */ (mode);
    tree.set(
      logicalPath,
      Object.freeze({
        mode: regularMode,
        objectId,
      }),
    );
  }
  if (tree.size === 0 || bytes.at(-1) !== 0) {
    throw new Error(
      'AWS retained-storage host preflight source Git tree listing is malformed.',
    );
  }
  return tree;
}

/**
 * Feed the same bounded in-memory tar bytes through a parser or unpacker and
 * await its successful terminal event.
 * @param {any} stream - Tar parser or unpacker.
 * @param {Buffer} bytes - Exact archive bytes.
 * @param {'end'|'close'} completionEvent - Expected successful terminal event.
 * @returns {Promise<void>}
 */
async function consumeTarBytes(stream, bytes, completionEvent) {
  await new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.once(completionEvent, resolve);
    try {
      stream.end(bytes);
    } catch (error) {
      reject(error);
    }
  });
}

/** @param {string} rawPath @param {'File'|'Directory'} type @returns {string} */
function validateArchivePath(rawPath, type) {
  if (
    !rawPath ||
    rawPath.includes('\\') ||
    rawPath.includes('\0') ||
    path.posix.isAbsolute(rawPath) ||
    Buffer.byteLength(rawPath, 'utf8') > MAX_PATH_BYTES
  ) {
    throw new Error(
      'AWS retained-storage host preflight source archive contains a non-canonical path.',
    );
  }
  const hasTerminalSlash = rawPath.endsWith('/');
  if (
    (type === 'Directory' && !hasTerminalSlash) ||
    (type === 'File' && hasTerminalSlash)
  ) {
    throw new Error(
      'AWS retained-storage host preflight source archive path type is not canonical.',
    );
  }
  const logicalPath = hasTerminalSlash ? rawPath.slice(0, -1) : rawPath;
  if (
    !logicalPath ||
    path.posix.normalize(logicalPath) !== logicalPath ||
    logicalPath
      .split('/')
      .some(
        (component) => !component || component === '.' || component === '..',
      )
  ) {
    throw new Error(
      'AWS retained-storage host preflight source archive contains a non-canonical path.',
    );
  }
  return logicalPath;
}

/**
 * Validate exact Git tar bytes before creating any filesystem path.
 * @param {Buffer} bytes - Exact bounded archive.
 * @param {Map<string, Readonly<{mode: '100644'|'100755', objectId: string}>>} commitTree - Exact selected commit blobs.
 * @param {'sha1'|'sha256'} objectFormat - Repository object format.
 * @returns {Promise<Map<string, 'file'|'directory'>>}
 */
async function validateSourceArchive(bytes, commitTree, objectFormat) {
  if (bytes.length < TAR_END_BYTES || bytes.length % TAR_BLOCK_BYTES !== 0) {
    throw new Error(
      'AWS retained-storage host preflight source archive framing is invalid.',
    );
  }
  /** @type {Map<string, 'file'|'directory'>} */
  const entries = new Map();
  /** @type {Map<string, {hash: import('node:crypto').Hash, mode: '100644'|'100755', objectId?: string}>} */
  const archiveBlobs = new Map();
  let expandedBytes = 0;
  const parser = listTar({
    strict: true,
    onReadEntry(entry) {
      if (entry.type !== 'File' && entry.type !== 'Directory') {
        throw new Error(
          'AWS retained-storage host preflight source archive contains a non-regular entry.',
        );
      }
      if (
        entries.size >=
        AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_MAX_ENTRIES
      ) {
        throw new RangeError(
          'AWS retained-storage host preflight source archive contains too many entries.',
        );
      }
      const logicalPath = validateArchivePath(entry.path, entry.type);
      if (entries.has(logicalPath)) {
        throw new Error(
          'AWS retained-storage host preflight source archive contains a duplicate path.',
        );
      }
      const size = entry.size;
      if (!Number.isSafeInteger(size) || size < 0) {
        throw new Error(
          'AWS retained-storage host preflight source archive entry size is invalid.',
        );
      }
      if (
        entry.type === 'File' &&
        size > AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_MAX_FILE_BYTES
      ) {
        throw new RangeError(
          'AWS retained-storage host preflight source archive file exceeds its byte limit.',
        );
      }
      expandedBytes += size;
      if (
        !Number.isSafeInteger(expandedBytes) ||
        expandedBytes >
          AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_MAX_EXPANDED_BYTES
      ) {
        throw new RangeError(
          'AWS retained-storage host preflight source archive exceeds its expanded byte limit.',
        );
      }
      entries.set(logicalPath, entry.type === 'File' ? 'file' : 'directory');
      if (entry.type === 'File') {
        const archivePermissionMode = entry.mode;
        if (
          archivePermissionMode !== 0o644 &&
          archivePermissionMode !== 0o755
        ) {
          throw new Error(
            'AWS retained-storage host preflight source archive file mode is not canonical.',
          );
        }
        /** @type {{hash: import('node:crypto').Hash, mode: '100644'|'100755', objectId?: string}} */
        const observation = {
          hash: createHash(objectFormat).update(`blob ${size}\0`),
          mode:
            archivePermissionMode === 0o755
              ? /** @type {'100755'} */ ('100755')
              : /** @type {'100644'} */ ('100644'),
        };
        archiveBlobs.set(logicalPath, observation);
        entry.on('data', (chunk) => observation.hash.update(chunk));
        entry.once('end', () => {
          observation.objectId = observation.hash.digest('hex');
        });
      } else if (entry.mode !== 0o755) {
        throw new Error(
          'AWS retained-storage host preflight source archive directory mode is not canonical.',
        );
      }
    },
  });
  await consumeTarBytes(parser, bytes, 'end');

  for (const [logicalPath, type] of entries) {
    const components = logicalPath.split('/');
    for (let index = 1; index < components.length; index += 1) {
      const parent = components.slice(0, index).join('/');
      const parentType = entries.get(parent);
      if (parentType === 'file') {
        throw new Error(
          'AWS retained-storage host preflight source archive places an entry beneath a regular file.',
        );
      }
      if (parentType !== 'directory') {
        throw new Error(
          'AWS retained-storage host preflight source archive omits an explicit parent directory.',
        );
      }
    }
    if (type === 'directory' && REQUIRED_SOURCE_FILES.has(logicalPath)) {
      throw new Error(
        'AWS retained-storage host preflight source archive replaces a required file with a directory.',
      );
    }
  }
  for (const requiredPath of REQUIRED_SOURCE_FILES) {
    if (entries.get(requiredPath) !== 'file') {
      throw new Error(
        `AWS retained-storage host preflight source archive is missing required file '${requiredPath}'.`,
      );
    }
  }
  if (archiveBlobs.size !== commitTree.size) {
    throw new Error(
      'AWS retained-storage host preflight source archive file set does not match the exact selected commit.',
    );
  }
  for (const [logicalPath, committed] of commitTree) {
    const observed = archiveBlobs.get(logicalPath);
    if (
      !observed ||
      observed.objectId !== committed.objectId ||
      observed.mode !== committed.mode
    ) {
      throw new Error(
        'AWS retained-storage host preflight source archive bytes or modes do not match the exact selected commit.',
      );
    }
  }
  return entries;
}

/** @param {Buffer} bytes @param {string} destination @returns {Promise<void>} */
async function extractSourceArchive(bytes, destination) {
  const unpacker = extractTar({
    cwd: destination,
    strict: true,
    preserveOwner: false,
    noMtime: true,
    unlink: false,
    umask: 0o077,
  });
  await consumeTarBytes(unpacker, bytes, 'close');
}

/**
 * Reject any extraction result that differs from the first-pass regular tree.
 * Re-bind every extracted file to the selected Git tree, normalize private
 * permissions beneath the mode-0700 capability root, and verify the resulting
 * modes before returning the capability.
 * @param {string} root - Empty private extraction root.
 * @param {Map<string, 'file'|'directory'>} expected - First-pass tree.
 * @param {Map<string, Readonly<{mode: '100644'|'100755', objectId: string}>>} commitTree - Exact selected commit blobs.
 * @param {'sha1'|'sha256'} objectFormat - Repository object format.
 * @returns {Promise<void>}
 */
async function verifyExtractedTree(root, expected, commitTree, objectFormat) {
  /** @type {Map<string, 'file'|'directory'>} */
  const observed = new Map();

  /** @param {import('node:fs').BigIntStats} left @param {import('node:fs').BigIntStats} right @returns {boolean} */
  function sameFile(left, right) {
    return (
      left.dev === right.dev &&
      left.ino === right.ino &&
      left.size === right.size &&
      left.mode === right.mode &&
      left.mtimeNs === right.mtimeNs &&
      left.ctimeNs === right.ctimeNs
    );
  }

  /** @param {string} absolutePath @param {'file'|'directory'} type @param {number} expectedMode @returns {Promise<import('node:fs').BigIntStats>} */
  async function normalizeAndVerifyMode(absolutePath, type, expectedMode) {
    await fsp.chmod(absolutePath, expectedMode);
    const stats = await fsp.lstat(absolutePath, { bigint: true });
    const hasExpectedType =
      type === 'file' ? stats.isFile() : stats.isDirectory();
    if (!hasExpectedType || (stats.mode & 0o7777n) !== BigInt(expectedMode)) {
      throw new Error(
        'AWS retained-storage host preflight source extraction permissions are not normalized and private.',
      );
    }
    return stats;
  }

  /** @param {string} absolutePath @param {import('node:fs').BigIntStats} before @returns {Promise<Buffer>} */
  async function readStableBoundedFile(absolutePath, before) {
    const maximum = BigInt(
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_MAX_FILE_BYTES,
    );
    if (before.size > maximum) {
      throw new RangeError(
        'AWS retained-storage host preflight source extracted file exceeds its byte limit.',
      );
    }
    const noFollow =
      typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
    const handle = await fsp.open(
      absolutePath,
      fsConstants.O_RDONLY | noFollow,
    );
    try {
      const opened = await handle.stat({ bigint: true });
      if (!opened.isFile() || !sameFile(before, opened)) {
        throw new Error(
          'AWS retained-storage host preflight source extracted file changed before it could be verified.',
        );
      }
      const bytes = Buffer.allocUnsafe(Number(opened.size));
      let offset = 0;
      while (offset < bytes.length) {
        const result = await handle.read(
          bytes,
          offset,
          bytes.length - offset,
          offset,
        );
        if (result.bytesRead === 0) {
          throw new Error(
            'AWS retained-storage host preflight source extracted file changed while it was being verified.',
          );
        }
        offset += result.bytesRead;
      }
      const [after, afterPath] = await Promise.all([
        handle.stat({ bigint: true }),
        fsp.lstat(absolutePath, { bigint: true }),
      ]);
      if (
        !after.isFile() ||
        afterPath.isSymbolicLink() ||
        !afterPath.isFile() ||
        !sameFile(opened, after) ||
        !sameFile(after, afterPath)
      ) {
        throw new Error(
          'AWS retained-storage host preflight source extracted file changed while it was being verified.',
        );
      }
      return bytes;
    } finally {
      await handle.close();
    }
  }

  /** @param {string} directory @param {string} relativeDirectory @returns {Promise<void>} */
  async function visit(directory, relativeDirectory) {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const logicalPath = relativeDirectory
        ? path.posix.join(relativeDirectory, entry.name)
        : entry.name;
      const absolutePath = path.join(directory, entry.name);
      const stats = await fsp.lstat(absolutePath);
      if (stats.isDirectory()) {
        observed.set(logicalPath, 'directory');
        await visit(absolutePath, logicalPath);
        await normalizeAndVerifyMode(absolutePath, 'directory', 0o700);
      } else if (stats.isFile()) {
        observed.set(logicalPath, 'file');
        const normalized = await normalizeAndVerifyMode(
          absolutePath,
          'file',
          0o600,
        );
        const bytes = await readStableBoundedFile(absolutePath, normalized);
        const committed = commitTree.get(logicalPath);
        const objectId = createHash(objectFormat)
          .update(`blob ${bytes.length}\0`)
          .update(bytes)
          .digest('hex');
        if (!committed || objectId !== committed.objectId) {
          throw new Error(
            'AWS retained-storage host preflight source extracted file bytes do not match the exact selected commit.',
          );
        }
      } else {
        throw new Error(
          'AWS retained-storage host preflight source extraction produced a non-regular path.',
        );
      }
    }
  }

  await visit(root, '');
  await normalizeAndVerifyMode(root, 'directory', 0o700);
  if (observed.size !== expected.size) {
    throw new Error(
      'AWS retained-storage host preflight source extraction does not match its validated archive.',
    );
  }
  for (const [logicalPath, type] of expected) {
    if (observed.get(logicalPath) !== type) {
      throw new Error(
        'AWS retained-storage host preflight source extraction does not match its validated archive.',
      );
    }
  }
}

/** @param {unknown} value @param {Set<string>} keys @param {string} pathLabel @returns {Record<string, any>} */
function validateInputObject(value, keys, pathLabel) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${pathLabel} must be a plain object.`);
  }
  assertExactKeys(value, keys, pathLabel);
  return value;
}

/**
 * Create one exact source snapshot through a captured Git port.
 * @param {string} sourceCommit - Exact validated commit.
 * @param {Readonly<Record<string, Function>>} gitPort - Captured Git port.
 * @returns {Promise<Readonly<{sourceCommit: string, root: string, archive: Readonly<Record<string, any>>, close: () => Promise<void>}>>}
 */
async function createSnapshot(sourceCommit, gitPort) {
  const commitSuffix = `${sourceCommit}^{commit}`;
  const resolvedCommitBytes = snapshotBoundedBytes(
    await gitPort.run(
      Object.freeze([
        '-C',
        REPOSITORY_ROOT,
        'rev-parse',
        '--verify',
        '--end-of-options',
        commitSuffix,
      ]),
      null,
      GIT_TEXT_MAX_BYTES,
    ),
    GIT_TEXT_MAX_BYTES,
    'AWS retained-storage host preflight source Git commit verification',
  );
  assertExactGitCommitOutput(
    resolvedCommitBytes,
    sourceCommit,
    'AWS retained-storage host preflight source Git commit verification',
  );

  const objectFormat = parseGitObjectFormat(
    snapshotBoundedBytes(
      await gitPort.run(
        Object.freeze([
          '-C',
          REPOSITORY_ROOT,
          'rev-parse',
          '--show-object-format',
        ]),
        null,
        GIT_TEXT_MAX_BYTES,
      ),
      GIT_TEXT_MAX_BYTES,
      'AWS retained-storage host preflight source Git object format',
    ),
    sourceCommit,
  );
  const commitTree = parseGitTree(
    snapshotBoundedBytes(
      await gitPort.run(
        Object.freeze([
          '-C',
          REPOSITORY_ROOT,
          'ls-tree',
          '-r',
          '-z',
          '--full-tree',
          sourceCommit,
        ]),
        null,
        AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_MAX_ARCHIVE_BYTES,
      ),
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_MAX_ARCHIVE_BYTES,
      'AWS retained-storage host preflight source Git tree',
    ),
    objectFormat,
  );
  const archiveBytes = snapshotBoundedBytes(
    await gitPort.run(
      Object.freeze([
        '-C',
        REPOSITORY_ROOT,
        'archive',
        '--format=tar',
        sourceCommit,
      ]),
      null,
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_MAX_ARCHIVE_BYTES,
    ),
    AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_MAX_ARCHIVE_BYTES,
    'AWS retained-storage host preflight source Git archive',
  );
  const archiveCommitBytes = snapshotBoundedBytes(
    await gitPort.run(
      Object.freeze(['-C', REPOSITORY_ROOT, 'get-tar-commit-id']),
      archiveBytes.subarray(0, TAR_END_BYTES),
      GIT_TEXT_MAX_BYTES,
    ),
    GIT_TEXT_MAX_BYTES,
    'AWS retained-storage host preflight source Git archive commit verification',
  );
  assertExactGitCommitOutput(
    archiveCommitBytes,
    sourceCommit,
    'AWS retained-storage host preflight source Git archive commit verification',
  );
  const expectedTree = await validateSourceArchive(
    archiveBytes,
    commitTree,
    objectFormat,
  );
  const archive = Object.freeze({
    format: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_ARCHIVE_FORMAT,
    byteDigest: Object.freeze({
      algorithm: 'sha256',
      value: createHash('sha256').update(archiveBytes).digest('base64url'),
    }),
    size: archiveBytes.length,
  });

  /** @type {string | undefined} */
  let ownedRoot;
  try {
    const canonicalTemporaryDirectory = await fsp.realpath(os.tmpdir());
    ownedRoot = await fsp.mkdtemp(
      path.join(canonicalTemporaryDirectory, TEMP_DIRECTORY_PREFIX),
    );
    await fsp.chmod(ownedRoot, 0o700);
    const sourceRoot = path.join(ownedRoot, 'source');
    await fsp.mkdir(sourceRoot, { mode: 0o700 });
    await extractSourceArchive(archiveBytes, sourceRoot);
    await verifyExtractedTree(
      sourceRoot,
      expectedTree,
      commitTree,
      objectFormat,
    );

    /** @type {Promise<void> | undefined} */
    let closePromise;
    let closed = false;
    const close = async () => {
      if (closed) return;
      if (!closePromise) {
        closePromise = fsp
          .rm(/** @type {string} */ (ownedRoot), {
            recursive: true,
            force: true,
          })
          .then(
            () => {
              closed = true;
            },
            (error) => {
              closePromise = undefined;
              throw error;
            },
          );
      }
      return await closePromise;
    };
    return Object.freeze({
      sourceCommit,
      root: sourceRoot,
      archive,
      close,
    });
  } catch (error) {
    if (!ownedRoot) throw error;
    try {
      await fsp.rm(ownedRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'AWS retained-storage host preflight source snapshot creation failed and its owned temporary root could not be removed.',
      );
    }
    throw error;
  }
}

/**
 * Materialize one source snapshot from an exact caller-selected Git commit.
 * @param {unknown} value - Exact `{sourceCommit}` request.
 * @returns {Promise<Readonly<{sourceCommit: string, root: string, archive: Readonly<Record<string, any>>, close: () => Promise<void>}>>}
 */
export async function createAwsRetainedStorageHostPreflightSeaSourceSnapshot(
  value,
) {
  const input = validateInputObject(
    value,
    INPUT_KEYS,
    'AWS retained-storage host preflight source snapshot input',
  );
  const sourceCommit = validateSourceCommit(
    ownData(
      input,
      'sourceCommit',
      'AWS retained-storage host preflight source snapshot input',
    ),
  );
  return await createSnapshot(sourceCommit, createProductionGitPort());
}

/**
 * Test-only snapshot factory with one exact captured Git port.
 * @param {unknown} value - Exact source commit and injected Git port.
 * @returns {Promise<Readonly<{sourceCommit: string, root: string, archive: Readonly<Record<string, any>>, close: () => Promise<void>}>>}
 */
export async function createAwsRetainedStorageHostPreflightSeaSourceSnapshotForTest(
  value,
) {
  const input = validateInputObject(
    value,
    TEST_INPUT_KEYS,
    'AWS retained-storage host preflight source snapshot test input',
  );
  const sourceCommit = validateSourceCommit(
    ownData(
      input,
      'sourceCommit',
      'AWS retained-storage host preflight source snapshot test input',
    ),
  );
  const gitPort = captureMethods(
    ownData(
      input,
      'gitPort',
      'AWS retained-storage host preflight source snapshot test input',
    ),
    GIT_PORT_KEYS,
    'AWS retained-storage host preflight source snapshot Git port',
  );
  return await createSnapshot(sourceCommit, gitPort);
}

export default createAwsRetainedStorageHostPreflightSeaSourceSnapshot;
