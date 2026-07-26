import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  constants as fsConstants,
  promises,
  existsSync,
  writeFileSync,
} from 'node:fs';
import { build as _build } from '../../lib/esbuild.js';
import paths from '../../lib/paths.js';
import { runCmd, execFile } from '../../lib/cmd.js';
import { inject } from 'postject';
import BaseResource from '../base-resource.js';
import NodeBinary from './node-binary.js';
import { assertSeaNodeVersionCompatible } from './lib/sea-node-version.js';
import {
  CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME,
  CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME,
  validateCoreRuntimeDependencyManifest,
} from './lib/core-runtime-dependency-asset.js';
import { parseFunctionAssetDescription } from './lib/function-asset.js';
import { validateSha256Digest } from '../../runtime/application-revision.js';
import {
  getBuildTargetId,
  validateBuildTarget,
} from '../../runtime/build-target.js';
import { compareCanonicalStrings } from '../../runtime/canonical-order.js';

const LIEF_SECTION_NAME_WARNING =
  "Can't find string offset for section name '.note";
const WHARFIE_PUBLIC_APP_SPECIFIER = '@wharfie/wharfie/app';
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Resolve the source-tree public app API only when a nested build is actually
 * requested. Packaged CommonJS/SEA bundles replace import.meta.url with a
 * filesystem string and must still be able to boot for runtime commands.
 * @returns {string} - Absolute source module path.
 */
function getWharfiePublicAppEntrypoint() {
  const moduleUrl = import.meta.url;
  if (typeof moduleUrl !== 'string' || !moduleUrl.startsWith('file:')) {
    throw new Error(
      'This packaged Wharfie runtime cannot resolve source build modules.',
    );
  }
  return fileURLToPath(new URL('../../../app.js', moduleUrl));
}

let _postjectWarningSuppressionDepth = 0;
/** @type {typeof process.stdout.write | null} */
let _originalStdoutWrite = null;
/** @type {typeof process.stderr.write | null} */
let _originalStderrWrite = null;

/**
 * @typedef SuccessfulBuildEvidence
 * @property {string} binaryPath - Final SEA path for this generation.
 * @property {import('../../runtime/application-revision.js').Sha256Digest} binaryDigest - Exact current final-byte digest.
 * @property {{digest: import('../../runtime/application-revision.js').Sha256Digest, size: number}} entryCode - Exact UTF-8 entry code handed to esbuild for this generation.
 * @property {{digest: import('../../runtime/application-revision.js').Sha256Digest, size: number}} codeBundle - Exact JavaScript bundle handed to Node's SEA blob generator.
 * @property {{digest: import('../../runtime/application-revision.js').Sha256Digest, size: number}} seaBlob - Exact generated SEA blob handed to postject.
 * @property {{path: string, digest: import('../../runtime/application-revision.js').Sha256Digest, size: number, archive: null | {fileName: string, digest: import('../../runtime/application-revision.js').Sha256Digest}}} nodeSource - Exact pre-injection Node source and same-generation archive evidence.
 * @property {Record<string, import('../../runtime/application-revision.js').Sha256Digest>} assets - Exact generic asset bytes consumed by SEA.
 * @property {Record<string, any>} functionAssets - Strict parsed function-asset evidence.
 * @property {null | {manifestDigest: import('../../runtime/application-revision.js').Sha256Digest, target: import('../../runtime/build-target.js').BuildTarget, roots: {name: string, version: string}[], dependencyLockInput: import('../../runtime/application-revision.js').LockedInputDescriptor, closureDigest: import('../../runtime/application-revision.js').Sha256Digest, plan: Readonly<Record<string, any>>, archive: {assetName: string, digest: import('../../runtime/application-revision.js').Sha256Digest}}} [coreRuntimeDependencies] - Strict core-native closure receipt when embedded.
 * @property {{mode: 'unsigned'} | {mode: 'ad-hoc'} | {mode: 'identity', signer: string}} signing - Generation signing state.
 */

/**
 * Evidence committed only after one final SEA binary has been copied
 * successfully. Public asset preparation cannot replace this generation.
 * @type {WeakMap<SeaBuild, Readonly<SuccessfulBuildEvidence>>}
 */
const successfulBuildEvidence = new WeakMap();

/**
 * Deeply freeze one already validated JSON snapshot.
 * @param {any} value - JSON value.
 * @returns {any} - Frozen value.
 */
function freezeJsonSnapshot(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) freezeJsonSnapshot(child);
  return Object.freeze(value);
}

/**
 * Observe one immutable byte snapshot without retaining the potentially large
 * bytes in successful-build evidence.
 * @param {Buffer | Uint8Array} bytes - Exact same-generation bytes.
 * @returns {{digest: import('../../runtime/application-revision.js').Sha256Digest, size: number}} - Digest and length.
 */
function observeBytes(bytes) {
  const snapshot = Buffer.from(bytes);
  return {
    digest: {
      algorithm: /** @type {'sha256'} */ ('sha256'),
      value: createHash('sha256').update(snapshot).digest('base64url'),
    },
    size: snapshot.length,
  };
}

/**
 * postject uses LIEF under the hood. When injecting into the official Node.js Linux binaries,
 * LIEF may emit noisy (but harmless) warnings about `.note.*` sections.
 *
 * Examples:
 * - warning: Can't find string offset for section name '.note.100'
 * - warning: Can't find string offset for section name '.note'
 *
 * See: https://github.com/nodejs/postject/issues/76
 * @param {unknown} chunk - A chunk passed to stream.write().
 * @param {unknown} encoding - Optional encoding passed to stream.write().
 * @returns {boolean} - True if the chunk should be suppressed.
 */
function _shouldSuppressPostjectChunk(chunk, encoding) {
  if (chunk == null) return false;

  try {
    if (typeof chunk === 'string') {
      return chunk.includes(LIEF_SECTION_NAME_WARNING);
    }

    if (chunk instanceof Uint8Array) {
      /** @type {any | undefined} */
      const enc =
        typeof encoding === 'string' && Buffer.isEncoding(encoding)
          ? /** @type {any} */ (encoding)
          : undefined;
      const text = Buffer.from(chunk).toString(enc);
      return text.includes(LIEF_SECTION_NAME_WARNING);
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * @typedef {(chunk: string | Uint8Array, encoding?: string | (() => void), callback?: (() => void)) => boolean} StreamWriteFn
 */

/**
 * @param {import('node:stream').Writable} stream - Stream to wrap.
 * @param {typeof process.stdout.write} originalWrite - Original write function.
 * @returns {typeof process.stdout.write} - Wrapped write function.
 */
function _wrapWrite(stream, originalWrite) {
  /** @type {StreamWriteFn} */
  const write = function write(chunk, encoding, callback) {
    /** @type {unknown} */
    let enc = encoding;
    /** @type {unknown} */
    let cb = callback;

    if (typeof enc === 'function') {
      cb = enc;
      enc = undefined;
    }

    if (_shouldSuppressPostjectChunk(chunk, enc)) {
      if (typeof cb === 'function') {
        cb();
      }
      return true;
    }

    const writer = /** @type {StreamWriteFn} */ (originalWrite);
    return writer.call(
      stream,
      /** @type {string | Uint8Array} */ (chunk),
      /** @type {string | (() => void) | undefined} */ (enc),
      /** @type {(() => void) | undefined} */ (cb),
    );
  };
  return write;
}

/**
 * @returns {void}
 */
function _installPostjectWarningFilter() {
  if (_originalStdoutWrite || _originalStderrWrite) return;

  _originalStdoutWrite = process.stdout.write;
  _originalStderrWrite = process.stderr.write;

  process.stdout.write = _wrapWrite(process.stdout, _originalStdoutWrite);
  process.stderr.write = _wrapWrite(process.stderr, _originalStderrWrite);
}

/**
 * @returns {void}
 */
function _uninstallPostjectWarningFilter() {
  if (!_originalStdoutWrite || !_originalStderrWrite) return;

  process.stdout.write = _originalStdoutWrite;
  process.stderr.write = _originalStderrWrite;

  _originalStdoutWrite = null;
  _originalStderrWrite = null;
}

/**
 * @template T
 * @param {() => Promise<T>} fn - Function to run.
 * @returns {Promise<T>} - Result.
 */
async function _withSuppressedPostjectWarnings(fn) {
  _postjectWarningSuppressionDepth += 1;
  if (_postjectWarningSuppressionDepth === 1) {
    _installPostjectWarningFilter();
  }

  try {
    return await fn();
  } finally {
    _postjectWarningSuppressionDepth -= 1;
    if (_postjectWarningSuppressionDepth === 0) {
      _uninstallPostjectWarningFilter();
    }
  }
}

/** @type {boolean | undefined} */
let _supportsExperimentalSeaConfig;

/**
 * @returns {boolean} - Result.
 */
function supportsExperimentalSeaConfig() {
  if (typeof _supportsExperimentalSeaConfig === 'boolean') {
    return _supportsExperimentalSeaConfig;
  }

  const result = spawnSync(process.execPath, ['--help'], {
    encoding: 'utf8',
  });
  const output = `${result.stdout || ''}
${result.stderr || ''}`;
  _supportsExperimentalSeaConfig = output.includes('--experimental-sea-config');
  return _supportsExperimentalSeaConfig;
}

/**
 * @param {import('node:fs').BigIntStats} left - First file snapshot.
 * @param {import('node:fs').BigIntStats} right - Second file snapshot.
 * @returns {boolean} - Whether both snapshots name unchanged bytes.
 */
function hasStableFileIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

/**
 * Read one regular file twice through the same non-symlink descriptor.
 * @param {string} filePath - File to consume.
 * @param {string} valuePath - Human-readable label.
 * @returns {Promise<Buffer>} - Stable exact bytes.
 */
async function readStableRegularFile(filePath, valuePath) {
  /** @type {import('node:fs').BigIntStats} */
  let pathBefore;
  try {
    pathBefore = await promises.lstat(filePath, { bigint: true });
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : '';
    throw new TypeError(`${valuePath} must be a readable file.${detail}`);
  }
  if (pathBefore.isSymbolicLink() || !pathBefore.isFile()) {
    throw new TypeError(`${valuePath} must be a regular non-symbolic file.`);
  }

  const noFollow =
    typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
  /** @type {import('node:fs/promises').FileHandle} */
  let handle;
  try {
    handle = await promises.open(filePath, fsConstants.O_RDONLY | noFollow);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : '';
    throw new TypeError(
      `${valuePath} must be a readable non-symbolic file.${detail}`,
    );
  }

  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !hasStableFileIdentity(pathBefore, before)) {
      throw new Error(`${valuePath} changed before it could be read.`);
    }
    if (before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new TypeError(`${valuePath} is too large to consume safely.`);
    }
    const size = Number(before.size);

    /** @returns {Promise<Buffer>} One exact descriptor read. */
    async function readPass() {
      const bytes = Buffer.allocUnsafe(size);
      let offset = 0;
      while (offset < size) {
        const result = await handle.read(bytes, offset, size - offset, offset);
        if (result.bytesRead === 0) {
          throw new Error(`${valuePath} changed while it was being read.`);
        }
        offset += result.bytesRead;
      }
      return bytes;
    }

    const first = await readPass();
    const second = await readPass();
    if (!first.equals(second)) {
      throw new Error(`${valuePath} changed while it was being read.`);
    }

    const [after, pathAfter] = await Promise.all([
      handle.stat({ bigint: true }),
      promises.lstat(filePath, { bigint: true }),
    ]);
    if (
      !after.isFile() ||
      pathAfter.isSymbolicLink() ||
      !pathAfter.isFile() ||
      !hasStableFileIdentity(before, after) ||
      !hasStableFileIdentity(after, pathAfter)
    ) {
      throw new Error(`${valuePath} changed while it was being read.`);
    }
    return first;
  } finally {
    await handle.close();
  }
}

/**
 * @param {unknown} value - Candidate string mapping.
 * @param {string} valuePath - Human-readable label.
 * @returns {Record<string, string>} - Validated mapping.
 */
function validateAssetMapping(value, valuePath) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      `${valuePath} must be an object mapping names to paths.`,
    );
  }

  /** @type {Record<string, string>} */
  const result = Object.create(null);
  for (const name of Object.keys(value)) {
    if (name.length === 0 || name.includes('\0')) {
      throw new TypeError(`${valuePath} contains an invalid logical name.`);
    }
    const filePath = /** @type {Record<string, unknown>} */ (value)[name];
    if (
      typeof filePath !== 'string' ||
      filePath.length === 0 ||
      filePath.includes('\0')
    ) {
      throw new TypeError(
        `${valuePath}[${JSON.stringify(name)}] must be a non-empty file path.`,
      );
    }
    result[name] = filePath;
  }
  return result;
}

/**
 * @param {unknown} value - Candidate digest mapping.
 * @param {Record<string, string>} assets - Validated asset mapping.
 * @param {string} valuePath - Human-readable label.
 * @returns {Record<string, import('../../runtime/application-revision.js').Sha256Digest>} - Validated mapping.
 */
function validateAssetDigestMapping(value, assets, valuePath) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      `${valuePath} must be an object mapping names to digests.`,
    );
  }

  /** @type {Record<string, import('../../runtime/application-revision.js').Sha256Digest>} */
  const result = Object.create(null);
  for (const name of Object.keys(value)) {
    if (!Object.prototype.hasOwnProperty.call(assets, name)) {
      throw new TypeError(
        `${valuePath}[${JSON.stringify(name)}] does not name a configured asset.`,
      );
    }
    result[name] = validateSha256Digest(
      /** @type {Record<string, unknown>} */ (value)[name],
      `${valuePath}[${JSON.stringify(name)}]`,
    );
  }
  return result;
}

/**
 * Return the official distribution filename for one supported target.
 * @param {import('../../runtime/build-target.js').BuildTarget} target - Exact build target.
 * @returns {string} - Official Node archive filename.
 */
function getOfficialNodeArchiveName(target) {
  const { normPlatform, normArch, ext } = NodeBinary.resolveTargetSpec(
    target.platform,
    target.architecture,
  );
  return `node-v${target.nodeVersion}-${normPlatform}-${normArch}${ext}`;
}

/**
 * Freeze optional official archive evidence from the exact NodeBinary receipt
 * present when the source Node bytes are selected for this SEA generation.
 * @param {SeaBuild} build - Owning SEA build.
 * @param {string} nodeSourcePath - Exact source Node path.
 * @param {Buffer} nodeSourceBytes - Stable source Node bytes.
 * @param {import('../../runtime/application-revision.js').Sha256Digest} nodeSourceDigest - Exact source Node digest.
 * @returns {Promise<null | {fileName: string, digest: import('../../runtime/application-revision.js').Sha256Digest}>} - Same-generation archive evidence.
 */
async function captureNodeArchiveEvidence(
  build,
  nodeSourcePath,
  nodeSourceBytes,
  nodeSourceDigest,
) {
  const dependencies = Array.isArray(build.dependsOn)
    ? build.dependsOn.filter((dependency) => dependency instanceof NodeBinary)
    : [];
  if (dependencies.length > 1) {
    throw new Error('SEA build has more than one NodeBinary dependency.');
  }
  if (dependencies.length === 0) return null;

  const nodeBinary = dependencies[0];
  if (nodeBinary.get('binaryPath') !== nodeSourcePath) {
    throw new Error(
      'NodeBinary output path does not match the Node source selected for SEA generation.',
    );
  }
  const receiptPath = await nodeBinary.getIntegrityReceiptPath(nodeSourcePath);
  try {
    await promises.lstat(receiptPath);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      throw new Error(
        'NodeBinary integrity receipt is required for SEA generation provenance.',
      );
    }
    throw error;
  }

  const receiptBytes = await readStableRegularFile(
    receiptPath,
    'Node binary integrity receipt',
  );
  let receipt;
  try {
    receipt = JSON.parse(receiptBytes.toString('utf8'));
  } catch {
    throw new Error(`Invalid Node binary integrity receipt ${receiptPath}.`);
  }
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error(`Invalid Node binary integrity receipt ${receiptPath}.`);
  }

  const target = validateBuildTarget(
    {
      nodeVersion: String(build.get('nodeVersion')).replace(/^v/, ''),
      platform: build.get('platform'),
      architecture: build.get('architecture'),
      ...(build.get('platform') === 'linux' ? { libc: build.get('libc') } : {}),
    },
    'SEA build target',
  );
  const binarySha256 = Buffer.from(
    nodeSourceDigest.value,
    'base64url',
  ).toString('hex');
  const archiveSha256 = String(receipt.archive?.sha256 || '').toLowerCase();
  if (
    receipt.version !== 1 ||
    String(receipt.target?.nodeVersion || '').replace(/^v/, '') !==
      target.nodeVersion ||
    receipt.target?.platform !== target.platform ||
    receipt.target?.architecture !== target.architecture ||
    receipt.archive?.fileName !== getOfficialNodeArchiveName(target) ||
    !SHA256_HEX_PATTERN.test(archiveSha256) ||
    String(receipt.binary?.sha256 || '').toLowerCase() !== binarySha256 ||
    receipt.binary?.size !== nodeSourceBytes.length
  ) {
    throw new Error(
      'Node binary integrity receipt does not match the exact target binary selected for SEA generation.',
    );
  }
  return {
    fileName: receipt.archive.fileName,
    digest: {
      algorithm: 'sha256',
      value: Buffer.from(archiveSha256, 'hex').toString('base64url'),
    },
  };
}

/**
 * @typedef {import('node:process')['platform']} TargetPlatform -
 * @typedef {import('node:process')['arch']} TargetArch -
 * @typedef {'glibc'|'musl'} TargetLibc
 */

/**
 * @typedef SeaBuildProperties
 * @property {string | function(): string} entryCode - entryCode.
 * @property {string | function(): string} resolveDir - resolveDir.
 * @property {string | function(): string} nodeBinaryPath - nodeBinaryPath.
 * @property {string | function(): string} nodeVersion - Exact Node.js target version; must match the builder runtime.
 * @property {TargetPlatform | function(): TargetPlatform} platform - platform.
 * @property {TargetArch | function(): TargetArch} architecture - architecture.
 * @property {TargetLibc | function(): TargetLibc} [libc] - libc.
 * @property {Object<string,string> | function(): Object<string,string>} [environmentVariables] - environmentVariables.
 * @property {Object<string,string> | function(): Object<string,string>} [assets] - assets.
 * @property {Object<string,import('../../runtime/application-revision.js').Sha256Digest> | function(): Object<string,import('../../runtime/application-revision.js').Sha256Digest>} [assetDigests] - Optional expected SHA-256 digest for each named asset.
 * @property {Object<string,import('../../runtime/application-revision.js').Sha256Digest> | function(): Object<string,import('../../runtime/application-revision.js').Sha256Digest>} [functionAssetDigests] - Expected SHA-256 digest for each strict Wharfie function asset.
 */

/**
 * @typedef SeaBuildOptions
 * @property {string} name - name.
 * @property {string} [parent] - parent.
 * @property {import('../reconcilable.js').default.Status} [status] - status.
 * @property {import('../reconcilable.js').default[]} [dependsOn] - dependsOn.
 * @property {SeaBuildProperties & import('../../actors/typedefs.js').SharedProperties} properties - properties.
 */

class SeaBuild extends BaseResource {
  /**
   * @param {SeaBuildOptions} options - SeaBuild Class Options
   */
  constructor({ name, parent, status, dependsOn, properties }) {
    super({
      name,
      parent,
      status,
      dependsOn,
      properties,
    });
  }

  /**
   * Return immutable evidence parsed from the exact function asset bytes SEA
   * consumed, not from mutable FunctionResource output properties.
   * @param {string} name - Logical activity asset name.
   * @returns {Readonly<{assetDigest: import('../../runtime/application-revision.js').Sha256Digest, externalDependencyReceipt: import('./lib/function-asset.js').FunctionExternalDependencyReceipt | null}>} - Sealed evidence.
   */
  getEmbeddedFunctionAssetEvidence(name) {
    const generation = successfulBuildEvidence.get(this);
    const evidence = generation?.functionAssets;
    if (!evidence || !Object.prototype.hasOwnProperty.call(evidence, name)) {
      throw new Error(
        `SEA build has no sealed function asset evidence for activity '${name}'.`,
      );
    }
    return evidence[name];
  }

  /**
   * List the exact logical names for which strict function assets were sealed.
   * @returns {string[]} - Canonically ordered activity names.
   */
  getEmbeddedFunctionAssetNames() {
    const evidence = successfulBuildEvidence.get(this)?.functionAssets;
    return evidence ? Object.keys(evidence) : [];
  }

  /**
   * Return sealed core-native dependency evidence from the exact asset bytes
   * consumed by this generation. A null result means this low-level SeaBuild
   * was not constructed through an ActorSystem target.
   * @returns {SuccessfulBuildEvidence['coreRuntimeDependencies']} - Sealed receipt.
   */
  getEmbeddedCoreRuntimeDependencyEvidence() {
    const evidence = successfulBuildEvidence.get(this);
    if (!evidence) {
      throw new Error('SEA build has no committed successful-build evidence.');
    }
    return evidence.coreRuntimeDependencies;
  }

  /**
   * Bind package-time provenance to the exact bytes from this successful
   * build generation.
   * @param {Buffer | Uint8Array} artifactBytes - Exact SEA bytes being recorded.
   * @returns {Readonly<SuccessfulBuildEvidence>} - Successful generation evidence.
   */
  getSuccessfulBuildEvidence(artifactBytes) {
    const evidence = successfulBuildEvidence.get(this);
    if (!evidence) {
      throw new Error('SEA build has no committed successful-build evidence.');
    }
    if (this.get('binaryPath') !== evidence.binaryPath) {
      throw new Error(
        'SEA build binaryPath does not match its committed build generation.',
      );
    }
    const actualDigest = createHash('sha256')
      .update(Buffer.from(artifactBytes))
      .digest('base64url');
    if (actualDigest !== evidence.binaryDigest.value) {
      throw new Error(
        'SEA artifact bytes do not match the committed build generation.',
      );
    }
    return evidence;
  }

  /**
   * Authorize the in-place macOS signing transition performed by this build's
   * dependent signing resource.
   * @param {Buffer | Uint8Array} beforeBytes - Exact pre-sign SEA bytes.
   * @param {Buffer | Uint8Array} afterBytes - Exact post-sign SEA bytes.
   * @param {{mode: 'ad-hoc'} | {mode: 'identity', signer: string}} signing - Verified result.
   * @returns {void}
   */
  advanceSuccessfulBuildEvidence(beforeBytes, afterBytes, signing) {
    const evidence = this.getSuccessfulBuildEvidence(beforeBytes);
    if (this.get('platform') !== 'darwin') {
      throw new Error('Only a Darwin SEA build may advance through signing.');
    }
    if (evidence.signing?.mode !== 'unsigned') {
      throw new Error('SEA build generation has already been signed.');
    }
    if (
      !signing ||
      (signing.mode !== 'ad-hoc' &&
        !(
          signing.mode === 'identity' &&
          typeof signing.signer === 'string' &&
          signing.signer.length > 0
        ))
    ) {
      throw new TypeError(
        'SEA signing transition requires a canonical result.',
      );
    }
    successfulBuildEvidence.set(
      this,
      freezeJsonSnapshot({
        ...evidence,
        binaryDigest: {
          algorithm: 'sha256',
          value: createHash('sha256')
            .update(Buffer.from(afterBytes))
            .digest('base64url'),
        },
        signing: { ...signing },
      }),
    );
  }

  async build() {
    this.assertNodeVersionCompatible();
    this.assertSeaBuildSupported();
    successfulBuildEvidence.delete(this);
    delete this.properties.binaryPath;

    const buildId = randomUUID();
    const distFile = `${this.name}-${buildId}`;
    const finalName =
      this.get('platform') === 'win32' ? `${distFile}.exe` : distFile;
    const binaryPath = join(SeaBuild.BINARIES_DIR, finalName);
    const tmpBuildDir = join(SeaBuild.BUILD_DIR, `build-${buildId}`);
    /** @type {unknown} */
    let buildError;
    /** @type {SuccessfulBuildEvidence | undefined} */
    let completedEvidence;

    try {
      await promises.mkdir(tmpBuildDir, { mode: 0o700, recursive: true });
      await promises.chmod(tmpBuildDir, 0o700);
      const entryCode = this.get('entryCode');
      if (typeof entryCode !== 'string') {
        throw new TypeError('SEA build entryCode must resolve to a string.');
      }
      const entryCodeBytes = Buffer.from(entryCode, 'utf8');
      const entryCodeEvidence = {
        digest: {
          algorithm: /** @type {'sha256'} */ ('sha256'),
          value: createHash('sha256')
            .update(entryCodeBytes)
            .digest('base64url'),
        },
        size: entryCodeBytes.length,
      };
      await this.esbuild(tmpBuildDir, entryCode);
      await this.prepareExternalBinaries();

      if (!existsSync(SeaBuild.BINARIES_DIR)) {
        await promises.mkdir(SeaBuild.BINARIES_DIR, { recursive: true });
      }

      const tempNodeBinaryPath = join(tmpBuildDir, 'node-binary');
      const nodeSourcePath = String(await this.get('nodeBinaryPath'));
      const nodeSourceBytes = await readStableRegularFile(
        nodeSourcePath,
        'nodeBinaryPath',
      );
      const nodeSourceDigest = {
        algorithm: /** @type {'sha256'} */ ('sha256'),
        value: createHash('sha256').update(nodeSourceBytes).digest('base64url'),
      };
      const nodeArchive = await captureNodeArchiveEvidence(
        this,
        nodeSourcePath,
        nodeSourceBytes,
        nodeSourceDigest,
      );
      await promises.writeFile(tempNodeBinaryPath, nodeSourceBytes, {
        flag: 'wx',
        mode: 0o700,
      });
      await promises.chmod(tempNodeBinaryPath, 0o700);
      const seaResult = await this.seaBuild(tmpBuildDir, tempNodeBinaryPath);
      if (
        !seaResult ||
        typeof seaResult !== 'object' ||
        !seaResult.assetEvidence ||
        !seaResult.functionAssetEvidence ||
        !seaResult.codeBundleEvidence ||
        !seaResult.seaBlobEvidence
      ) {
        throw new Error(
          'SEA build did not return complete same-generation evidence.',
        );
      }
      await promises.copyFile(tempNodeBinaryPath, binaryPath);
      const binaryBytes = await readStableRegularFile(
        binaryPath,
        'completed SEA binary',
      );
      completedEvidence = {
        binaryPath,
        binaryDigest: {
          algorithm: 'sha256',
          value: createHash('sha256').update(binaryBytes).digest('base64url'),
        },
        entryCode: entryCodeEvidence,
        codeBundle: seaResult.codeBundleEvidence,
        seaBlob: seaResult.seaBlobEvidence,
        nodeSource: {
          path: nodeSourcePath,
          digest: nodeSourceDigest,
          size: nodeSourceBytes.length,
          archive: nodeArchive,
        },
        assets: seaResult.assetEvidence,
        functionAssets: seaResult.functionAssetEvidence,
        coreRuntimeDependencies:
          seaResult.coreRuntimeDependencyEvidence || null,
        signing: { mode: 'unsigned' },
      };
    } catch (error) {
      buildError = error;
    }

    /** @type {unknown[]} */
    const cleanupErrors = [];
    try {
      await promises.rm(tmpBuildDir, { force: true, recursive: true });
    } catch (error) {
      cleanupErrors.push(error);
    }

    if (buildError || cleanupErrors.length > 0) {
      try {
        await promises.rm(binaryPath, { force: true });
      } catch (error) {
        cleanupErrors.push(error);
      }

      if (buildError && cleanupErrors.length === 0) {
        throw buildError;
      }
      throw new AggregateError(
        [...(buildError ? [buildError] : []), ...cleanupErrors],
        buildError
          ? 'SEA build failed and temporary output cleanup was incomplete.'
          : 'SEA build output was created, but temporary build cleanup failed.',
      );
    }

    if (!completedEvidence) {
      throw new Error('SEA build completed without generation evidence.');
    }
    this._setUNSAFE('binaryPath', binaryPath);
    successfulBuildEvidence.set(this, freezeJsonSnapshot(completedEvidence));
  }

  /**
   * @returns {string} - Normalized exact target Node.js version.
   */
  assertNodeVersionCompatible() {
    return assertSeaNodeVersionCompatible(this.get('nodeVersion'));
  }

  /**
   * @returns {void}
   */
  assertSeaBuildSupported() {
    const nodeVersion = this.assertNodeVersionCompatible();
    if (supportsExperimentalSeaConfig()) {
      return;
    }

    const target = `${this.get('platform')}/${this.get('architecture')} node ${nodeVersion}`;
    throw new Error(
      `Cannot build ${this.name} for ${target}: Wharfie packaged artifacts must be real Node SEA executables, but the builder runtime ${process.execPath} (${process.version}) does not support --experimental-sea-config. Install and run Wharfie with a SEA-capable Node runtime.`,
    );
  }

  async prepareExternalBinaries() {}

  async fetchUserDefinedBinaries() {}

  formatEnvVars() {
    return Object.entries(this.get('environmentVariables', {}))
      .map(
        ([key, value]) =>
          `process.env['${key.toString()}'] = '${value.toString()}';`,
      )
      .join('\n');
  }

  _entrypointParameters() {
    const args = process.argv.slice(2);
    let wharfie_event = {};
    let wharfie_context = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--event') {
        wharfie_event = JSON.parse(args[i + 1]);
        i++;
      } else if (args[i] === '--context') {
        wharfie_context = JSON.parse(args[i + 1]);
        i++;
      }
    }
    // if (!wharfie_event) throw new Error('Missing event');
    if (!wharfie_event) wharfie_event = { foo: 'bar' };
    // if (!wharfie_context) throw new Error('Missing context');
    if (!wharfie_context) wharfie_context = { some: 'thing' };
    return [wharfie_event, wharfie_context];
  }

  /**
   * @param {string} buildDir - buildDir.
   * @param {string} [capturedEntryCode] - Exact entry code captured by build().
   */
  async esbuild(buildDir, capturedEntryCode) {
    const nodeVersion = this.assertNodeVersionCompatible();
    const outputPath = join(buildDir, 'esbundle.js');
    const entryCode =
      capturedEntryCode === undefined
        ? this.get('entryCode')
        : capturedEntryCode;
    if (typeof entryCode !== 'string') {
      throw new TypeError('SEA build entryCode must resolve to a string.');
    }
    const { errors, warnings } = await _build({
      stdin: {
        contents: entryCode,
        resolveDir: this.get('resolveDir'),
        sourcefile: 'index.js',
      },
      loader: {
        '.worker.js': 'text',
      },
      outfile: outputPath,
      bundle: true,
      platform: 'node',
      minify: true,
      keepNames: false,
      sourcemap: 'inline',
      target: `node${nodeVersion}`,
      logLevel: 'silent',
      external: ['esbuild', 'node-gyp/bin/node-gyp.js', 'lmdb'],
      alias: {
        [WHARFIE_PUBLIC_APP_SPECIFIER]: getWharfiePublicAppEntrypoint(),
      },
      define: {
        __WILLEM_BUILD_RECONCILE_TERMINATOR: '1', // injects this variable definition into the global scope
        'import.meta.url': '__filename',
        'import.meta.dirname': '__dirname',
      },
    });

    if (errors.length > 0) {
      throw new Error('SEA JavaScript bundling failed.');
    }

    if (warnings.length > 0) {
      console.warn(warnings);
    }
    this.set('codeBundlePath', outputPath);
  }

  /**
   * Seal configured SEA assets into the private build tree.
   * @param {string} buildDir - Private mode-0700 build directory.
   * @returns {Promise<{assets: Record<string, string>, assetEvidence: Record<string, import('../../runtime/application-revision.js').Sha256Digest>, functionAssetEvidence: Record<string, any>, coreRuntimeDependencyEvidence?: SuccessfulBuildEvidence['coreRuntimeDependencies']}>} - Sealed paths and exact evidence.
   */
  async _prepareSeaAssetsWithEvidence(buildDir) {
    delete this.properties.embeddedAssetDigests;

    const assets = validateAssetMapping(this.get('assets', {}), 'assets');
    const expectedDigests = validateAssetDigestMapping(
      this.get('assetDigests', {}),
      assets,
      'assetDigests',
    );
    const functionAssetDigests = validateAssetDigestMapping(
      this.get('functionAssetDigests', {}),
      assets,
      'functionAssetDigests',
    );
    for (const name of Object.keys(functionAssetDigests)) {
      const genericExpected = expectedDigests[name];
      const functionExpected = functionAssetDigests[name];
      if (genericExpected && genericExpected.value !== functionExpected.value) {
        throw new Error(
          `assetDigests[${JSON.stringify(name)}] conflicts with functionAssetDigests for the same asset.`,
        );
      }
    }
    const names = Object.keys(assets).sort(compareCanonicalStrings);
    const assetsDir = join(buildDir, 'assets');
    await promises.mkdir(assetsDir, { mode: 0o700 });
    await promises.chmod(assetsDir, 0o700);

    /** @type {Record<string, string>} */
    const sealedAssets = Object.create(null);
    /** @type {Record<string, import('../../runtime/application-revision.js').Sha256Digest>} */
    const embeddedAssetDigests = Object.create(null);
    /** @type {Record<string, any>} */
    const functionEvidence = Object.create(null);
    /** @type {Buffer | null} */
    let coreManifestBytes = null;
    /** @type {import('../../runtime/application-revision.js').Sha256Digest | null} */
    let coreManifestDigest = null;
    const buildTarget = validateBuildTarget(
      {
        nodeVersion: String(this.get('nodeVersion')).replace(/^v/, ''),
        platform: this.get('platform'),
        architecture: this.get('architecture'),
        ...(this.get('platform') === 'linux' ? { libc: this.get('libc') } : {}),
      },
      'SEA build target',
    );

    for (const [index, name] of names.entries()) {
      const bytes = await readStableRegularFile(
        assets[name],
        `assets[${JSON.stringify(name)}]`,
      );
      const digest = {
        algorithm: /** @type {'sha256'} */ ('sha256'),
        value: createHash('sha256').update(bytes).digest('base64url'),
      };
      const expected = functionAssetDigests[name] || expectedDigests[name];
      if (expected && expected.value !== digest.value) {
        throw new Error(
          `assets[${JSON.stringify(name)}] does not match its expected SHA-256 digest.`,
        );
      }

      const sealedPath = join(
        assetsDir,
        `${String(index).padStart(8, '0')}.asset`,
      );
      await promises.writeFile(sealedPath, bytes, {
        flag: 'wx',
        mode: 0o400,
      });
      await promises.chmod(sealedPath, 0o400);
      sealedAssets[name] = sealedPath;
      embeddedAssetDigests[name] = digest;
      if (name === CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME) {
        coreManifestBytes = bytes;
        coreManifestDigest = { ...digest };
      }
      if (functionAssetDigests[name]) {
        const parsed = parseFunctionAssetDescription(
          bytes,
          `assets[${JSON.stringify(name)}]`,
        );
        if (parsed.description.activity !== name) {
          throw new Error(
            `Function asset '${name}' declares activity '${parsed.description.activity}'.`,
          );
        }
        if (
          getBuildTargetId(parsed.description.target) !==
          getBuildTargetId(buildTarget)
        ) {
          throw new Error(
            `Function asset '${name}' target does not match its SEA build.`,
          );
        }
        functionEvidence[name] = {
          assetDigest: { ...digest },
          activity: parsed.description.activity,
          target: parsed.description.target,
          externals: parsed.description.externals,
          externalDependencyReceipt:
            parsed.description.externalDependencyReceipt,
        };
      }
    }

    const hasCoreManifest = coreManifestBytes !== null;
    const hasCoreArchive = Object.prototype.hasOwnProperty.call(
      embeddedAssetDigests,
      CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME,
    );
    if (hasCoreManifest !== hasCoreArchive) {
      throw new Error(
        'SEA core runtime dependency assets must include both manifest and archive.',
      );
    }
    /** @type {SuccessfulBuildEvidence['coreRuntimeDependencies']} */
    let coreRuntimeDependencyEvidence = null;
    if (coreManifestBytes && coreManifestDigest) {
      let parsed;
      try {
        parsed = JSON.parse(coreManifestBytes.toString('utf8'));
      } catch {
        throw new Error(
          'SEA core runtime dependency manifest is not valid JSON.',
        );
      }
      const manifest = validateCoreRuntimeDependencyManifest(
        parsed,
        `assets[${JSON.stringify(CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME)}]`,
      );
      if (getBuildTargetId(manifest.target) !== getBuildTargetId(buildTarget)) {
        throw new Error(
          'SEA core runtime dependency target does not match its SEA build.',
        );
      }
      const embeddedArchiveDigest =
        embeddedAssetDigests[manifest.archive.assetName];
      if (
        !embeddedArchiveDigest ||
        embeddedArchiveDigest.value !== manifest.archive.digest.value
      ) {
        throw new Error(
          'SEA core runtime dependency archive does not match its sealed manifest receipt.',
        );
      }
      coreRuntimeDependencyEvidence = {
        manifestDigest: coreManifestDigest,
        target: manifest.target,
        roots: manifest.roots,
        dependencyLockInput: manifest.dependencyLockInput,
        closureDigest: manifest.closureDigest,
        plan: manifest.plan,
        archive: manifest.archive,
      };
    }

    this._setUNSAFE('embeddedAssetDigests', embeddedAssetDigests);
    return {
      assets: sealedAssets,
      assetEvidence: freezeJsonSnapshot(embeddedAssetDigests),
      functionAssetEvidence: freezeJsonSnapshot(functionEvidence),
      coreRuntimeDependencyEvidence: freezeJsonSnapshot(
        coreRuntimeDependencyEvidence,
      ),
    };
  }

  /**
   * Seal configured assets for inspection without replacing evidence committed
   * to an already-built SEA generation.
   * @param {string} buildDir - Private mode-0700 build directory.
   * @returns {Promise<Record<string, string>>} - Logical names to sealed paths.
   */
  async prepareSeaAssets(buildDir) {
    return (await this._prepareSeaAssetsWithEvidence(buildDir)).assets;
  }

  /**
   * @param {string} buildDir - buildDir.
   * @param {string} nodeBinaryPath - nodeBinaryPath.
   * @returns {Promise<{assetEvidence: Record<string, import('../../runtime/application-revision.js').Sha256Digest>, functionAssetEvidence: Record<string, any>, coreRuntimeDependencyEvidence?: SuccessfulBuildEvidence['coreRuntimeDependencies'], codeBundleEvidence: SuccessfulBuildEvidence['codeBundle'], seaBlobEvidence: SuccessfulBuildEvidence['seaBlob']}>} - Exact code, blob, and asset evidence consumed by SEA generation.
   */
  async seaBuild(buildDir, nodeBinaryPath) {
    this.assertNodeVersionCompatible();
    const seaConfigPath = join(buildDir, 'sea-config.json');
    const codeBundlePath = join(buildDir, 'esbundle.js');
    const blobPath = join(buildDir, 'sea.blob');
    const preparedAssets = await this._prepareSeaAssetsWithEvidence(buildDir);
    const assets = preparedAssets.assets;
    const seaConfig = {
      main: join(buildDir, 'esbundle.js'),
      output: blobPath,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
      execArgv: [],
      execArgvExtension: 'none',
      assets,
    };

    writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2), 'utf8');
    const codeBundleBefore = await readStableRegularFile(
      codeBundlePath,
      'SEA JavaScript bundle',
    );
    if (codeBundleBefore.length === 0) {
      throw new Error('SEA JavaScript bundle must not be empty.');
    }
    await execFile(
      process.execPath,
      ['--no-warnings', '--experimental-sea-config', seaConfigPath],
      {},
      true,
    );
    const codeBundleAfter = await readStableRegularFile(
      codeBundlePath,
      'SEA JavaScript bundle',
    );
    if (!codeBundleAfter.equals(codeBundleBefore)) {
      throw new Error(
        'SEA JavaScript bundle changed while its blob was generated.',
      );
    }
    if (this.get('platform') === 'darwin') {
      await runCmd('codesign', ['--remove-signature', nodeBinaryPath]);
    }
    const blobData = await readStableRegularFile(blobPath, 'SEA blob');
    if (blobData.length === 0) {
      throw new Error('SEA blob must not be empty.');
    }
    const seaBlobEvidence = freezeJsonSnapshot(observeBytes(blobData));
    const injectionBlob = Buffer.from(blobData);
    // base64 encoded fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
    // see https://github.com/nodejs/postject/issues/92#issuecomment-2283508514
    await _withSuppressedPostjectWarnings(async () => {
      await inject(nodeBinaryPath, 'NODE_SEA_BLOB', injectionBlob, {
        sentinelFuse: Buffer.from(
          'Tk9ERV9TRUFfRlVTRV9mY2U2ODBhYjJjYzQ2N2I2ZTA3MmI4YjVkZjE5OTZiMg==',
          'base64',
        ).toString(),
        ...(this.get('platform') === 'darwin'
          ? { machoSegmentName: 'NODE_SEA' }
          : {}),
      });
    });
    if (!injectionBlob.equals(blobData)) {
      throw new Error('SEA blob changed while it was being injected.');
    }
    return {
      codeBundleEvidence: freezeJsonSnapshot(observeBytes(codeBundleBefore)),
      seaBlobEvidence,
      assetEvidence: preparedAssets.assetEvidence,
      functionAssetEvidence: preparedAssets.functionAssetEvidence,
      coreRuntimeDependencyEvidence:
        preparedAssets.coreRuntimeDependencyEvidence,
    };
  }

  async _reconcile() {
    if (!existsSync(join(paths.data, 'builds'))) {
      await promises.mkdir(join(paths.data, 'builds'), {
        recursive: true,
      });
    }
    await this.build();
  }

  async _destroy() {
    if (!existsSync(this.get('binaryPath'))) {
      return;
    }
    await promises.unlink(this.get('binaryPath'));
  }
}

SeaBuild.BINARIES_DIR = join(paths.data, 'actor_binaries');

SeaBuild.BUILD_DIR = join(paths.temp, 'builds');

export default SeaBuild;
