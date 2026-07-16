import { createHash, randomUUID } from 'node:crypto';
import https, { get } from 'node:https';
import http from 'node:http';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import {
  mkdir,
  rename,
  readFile,
  writeFile,
  readdir,
  rm,
  stat,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import JSZip from 'jszip';
import { extract as _extract } from 'tar';
import paths from '../../lib/paths.js';
import BaseResource from '../base-resource.js';

const INTEGRITY_RECEIPT_VERSION = 1;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

/**
 * @typedef DownloadedArchive
 * @property {string} path - Verified local archive path.
 * @property {string} fileName - Official Node.js distribution filename.
 * @property {string} sha256 - SHA-256 from the official checksum manifest.
 * @property {string} version - Exact Node.js version including the leading `v`.
 */

/**
 * @typedef NodeBinaryIntegrityReceipt
 * @property {number} version - Receipt schema version.
 * @property {{ nodeVersion: string, platform: string, architecture: string }} target - Cached build target.
 * @property {{ fileName: string, sha256: string }} archive - Verified upstream archive identity.
 * @property {{ sha256: string, size: number }} binary - Extracted binary integrity.
 */

/**
 * @param {string} filePath - File to hash.
 * @returns {Promise<string>} - Lowercase SHA-256 digest.
 */
async function sha256File(filePath) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

/**
 * @param {string} temporaryPath - Complete temporary file.
 * @param {string} finalPath - Destination path.
 * @returns {Promise<void>}
 */
async function replaceFileAtomically(temporaryPath, finalPath) {
  try {
    await rename(temporaryPath, finalPath);
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error ? error.code : '';
    if (!['EEXIST', 'EPERM'].includes(String(code))) {
      throw error;
    }

    // Windows does not replace an existing destination with rename(). The
    // downloaded bytes are already complete and verified at this point, so the
    // fallback can safely remove the old file before placing the new one.
    await rm(finalPath, { force: true });
    await rename(temporaryPath, finalPath);
  }
}

/**
 * @param {string} finalPath - Destination path.
 * @returns {string} - Unique temporary path in the destination directory.
 */
function createAtomicTemporaryPath(finalPath) {
  return join(
    dirname(finalPath),
    `.${basename(finalPath)}.${process.pid}.${randomUUID()}.download`,
  );
}

/**
 * @typedef {import('node:process')['platform']} TargetPlatform
 * @typedef {import('node:process')['arch']} TargetArch
 */
/**
 * @typedef NodeBinaryProperties
 * @property {string | function(): string} version - version.
 * @property {TargetPlatform | function(): TargetPlatform} platform - platform.
 * @property {TargetArch | function(): TargetArch} architecture - architecture.
 */

/**
 * @typedef NodeBinaryOptions
 * @property {string} name - name.
 * @property {string} [parent] - parent.
 * @property {import('../reconcilable.js').default.Status} [status] - status.
 * @property {import('../reconcilable.js').default[]} [dependsOn] - dependsOn.
 * @property {NodeBinaryProperties & import('../../actors/typedefs.js').SharedProperties} properties - properties.
 */

class NodeBinary extends BaseResource {
  /**
   * @param {NodeBinaryOptions} options - options.
   */
  constructor({ name, parent, status, dependsOn, properties }) {
    const propertiesWithDefaults = Object.assign(
      {
        version: '23',
      },
      properties,
    );
    super({
      name,
      parent,
      status,
      dependsOn,
      properties: propertiesWithDefaults,
    });
  }

  /**
   * Get the exact version of Node.js to download.
   * @returns {Promise<string>} - Exact version of Node.js to download.
   */
  async getExactVersion() {
    if (this.has('exactVersion')) return this.get('exactVersion');
    const versions = await NodeBinary.getVersions();
    const requestedVersion = String(this.get('version')).replace(/^v/, '');
    const isExactVersion = /^\d+\.\d+\.\d+(?:[-+].+)?$/.test(requestedVersion);
    const matchingVersions = versions.filter((v) =>
      isExactVersion
        ? v.version === `v${requestedVersion}`
        : v.version.startsWith(`v${requestedVersion}`),
    );
    if (matchingVersions.length === 0) {
      throw new Error(`No Node.js version found for ${this.get('version')}`);
    }

    const latestVersion = matchingVersions[0].version;
    this.set('exactVersion', latestVersion);
    return latestVersion;
  }

  /**
   * Get the list of all Node.js versions from nodejs.org.
   * @returns {Promise<Array<NodeVersionDescription>>} - List of all Node.js versions.
   */
  static async getVersions() {
    if (NodeBinary.versions) return NodeBinary.versions;
    return new Promise((resolve, reject) => {
      get(`https://nodejs.org/dist/index.json`, (response) => {
        let data = '';
        response.on('data', (chunk) => {
          data += chunk;
        });
        response.on('end', () => {
          const versions = JSON.parse(data);
          NodeBinary.versions = versions;
          resolve(versions);
        });
      }).on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Get the name of the Node.js binary.
   * @returns {Promise<string>} - name of the Node.js binary
   */
  async getBinaryName() {
    const ext = this.get('platform') === 'win32' ? '.exe' : '';
    return `node-${await this.getExactVersion()}-${this.get(
      'platform',
    )}-${this.get('architecture')}${ext}`;
  }

  /**
   * Get the path of the Node.js binary.
   * @returns {Promise<string>} - path of the Node.js binary
   */
  async getBinaryPath() {
    if (this.has('binaryPath')) return this.get('binaryPath');
    if (!existsSync(NodeBinary.BINARIES_DIR)) {
      await mkdir(NodeBinary.BINARIES_DIR, { recursive: true });
    }
    this._setUNSAFE(
      'binaryPath',
      join(NodeBinary.BINARIES_DIR, await this.getBinaryName()),
    );
    return this.get('binaryPath');
  }

  /**
   * Get the name of the Node.js archive.
   * @returns {Promise<string>} - path of the Node.js archive
   */
  async getArchivePath() {
    if (this._archivePath) return this._archivePath;
    const ext = this.get('platform') === 'win32' ? '.zip' : '.tar.gz';
    const archiveName = `node-${await this.getExactVersion()}-${this.get(
      'platform',
    )}-${this.get('architecture')}${ext}`;
    this._archivePath = join(NodeBinary.TEMP_DIR, archiveName);
    return this._archivePath;
  }

  /**
   * @typedef targetSpec
   * @property {string} token - token.
   * @property {string} normPlatform - normPlatform.
   * @property {string} normArch - normArch.
   * @property {string} ext - ext.
   * @property {string} packagingKey - packagingKey.
   * @property {boolean} isWin - isWin.
   * @property {boolean} isMac - isMac.
   */
  /**
   * Map Node/OS tokens and choose packaging for our extractor.
   * - We extract .zip on Windows.
   * - We extract .tar.gz on macOS (Node publishes osx-*-tar).
   * - For everything else we keep your existing .tar.gz assumption.
   * @param {string} platform - platform.
   * @param {string} arch - arch.
   * @returns {targetSpec} - Result.
   */
  static resolveTargetSpec(platform, arch) {
    // Normalize platform
    const isWin = platform === 'win32';
    const isMac = platform === 'darwin';
    const token = isWin ? 'win' : isMac ? 'osx' : platform;
    // Normalize arch (Node uses x64/arm64; windows 32-bit is x86)
    const normArch = arch === 'ia32' ? 'x86' : arch;
    const normPlatform = isWin ? 'win' : platform;

    // What packaging do we intend to download?
    // (Keep your extractor expectations: zip on win; tar.gz elsewhere)
    const ext = isWin ? '.zip' : '.tar.gz';
    const packagingKey = isWin ? 'zip' : 'tar';

    return { token, normPlatform, normArch, ext, packagingKey, isWin, isMac };
  }

  /**
   * Build candidate "files" keys to validate against index.json.
   * Node's `files` array sometimes lists either a base key (linux-x64)
   * and sometimes keyed by packaging (osx-arm64-tar, win-x64-zip).
   * @param {string} token - token.
   * @param {string} normArch - normArch.
   * @param {string} packagingKey - packagingKey.
   * @returns {string[]} - Result.
   */
  static candidateFilesKeys(token, normArch, packagingKey) {
    const base = `${token}-${normArch}`;
    // Try most-specific first, then fallback to base:
    return [
      `${base}-${packagingKey}`, // e.g. osx-arm64-tar, win-x64-zip
      base, // e.g. linux-x64
    ];
  }

  /**
   * Get the URL of the Node.js binary to download.
   * Validates against index.json "files" to ensure artifact exists,
   * and maps darwin->osx properly.
   * @returns {Promise<string>} URL of the Node.js binary to download.
   */
  async getUrl() {
    const version = await this.getExactVersion();
    const versions = await NodeBinary.getVersions();
    const meta = versions.find((v) => v.version === version);
    if (!meta) {
      throw new Error(`No metadata found for Node.js ${version}`);
    }

    const { token, normPlatform, normArch, ext, packagingKey } =
      NodeBinary.resolveTargetSpec(
        this.get('platform'),
        this.get('architecture'),
      );

    // Validate that at least one acceptable "files" key exists
    const keys = NodeBinary.candidateFilesKeys(token, normArch, packagingKey);
    const available = new Set(meta.files);
    const ok = keys.some((k) => available.has(k));
    if (!ok) {
      throw new Error(
        `Node.js ${version} does not publish binaries for ${token}-${normArch}. Available: ${meta.files.join(
          ', ',
        )}`,
      );
    }
    // node-v23.11.1-darwin-x64.tar.gz

    // Construct URL with our normalized token + arch + chosen ext
    // Examples:
    //  - mac:  https://nodejs.org/dist/v23.11.1/node-v23.11.1-osx-arm64.tar.gz
    //  - win:  https://nodejs.org/dist/v24.11.0/node-v24.11.0-win-x64.zip
    //  - linux (kept as .tar.gz per your extractor): node-vX-linux-x64.tar.gz
    return `https://nodejs.org/dist/${version}/node-${version}-${normPlatform}-${normArch}${ext}`;
  }

  /**
   * @returns {Promise<string>} - Official checksum manifest URL.
   */
  async getChecksumsUrl() {
    return `https://nodejs.org/dist/${await this.getExactVersion()}/SHASUMS256.txt`;
  }

  /**
   * @param {string} url - HTTP(S) URL.
   * @returns {Promise<import('node:http').IncomingMessage>} - Response stream.
   */
  async requestUrl(url) {
    const request = url.startsWith('https:') ? https : http;
    return await new Promise((resolve, reject) => {
      const pendingRequest = request.get(url, resolve);
      pendingRequest.on('error', reject);
    });
  }

  /**
   * @param {string} url - HTTP(S) URL.
   * @returns {Promise<string>} - UTF-8 response body.
   */
  async fetchText(url) {
    const response = await this.requestUrl(url);
    if (response.statusCode !== 200) {
      response.resume();
      throw new Error(`Download failed: ${response.statusCode} ${url}`);
    }

    const chunks = [];
    for await (const chunk of response) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  /**
   * @param {string} url - HTTP(S) URL.
   * @param {string} destinationPath - Temporary destination path.
   * @returns {Promise<void>}
   */
  async downloadUrlToFile(url, destinationPath) {
    const response = await this.requestUrl(url);
    if (response.statusCode !== 200) {
      response.resume();
      throw new Error(`Download failed: ${response.statusCode} ${url}`);
    }

    const contentType = String(
      response.headers['content-type'] || '',
    ).toLowerCase();
    if (!/zip|tar|gzip|octet-stream/.test(contentType)) {
      response.resume();
      throw new Error(`Unexpected content-type '${contentType}' from ${url}`);
    }

    await pipeline(
      response,
      createWriteStream(destinationPath, { flags: 'wx', mode: 0o600 }),
    );
  }

  /**
   * @param {string} manifest - Official SHASUMS256.txt contents.
   * @param {string} fileName - Exact target distribution filename.
   * @returns {string} - Lowercase expected SHA-256.
   */
  static findChecksum(manifest, fileName) {
    for (const line of String(manifest).split(/\r?\n/)) {
      const match = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line);
      if (match && match[2] === fileName) {
        return match[1].toLowerCase();
      }
    }

    throw new Error(
      `Official Node.js checksum manifest does not include ${fileName}`,
    );
  }

  /**
   * @param {string} fileName - Exact target distribution filename.
   * @returns {Promise<string>} - Official lowercase SHA-256.
   */
  async getExpectedArchiveChecksum(fileName) {
    const checksumsUrl = await this.getChecksumsUrl();
    const manifest = await this.fetchText(checksumsUrl);
    return NodeBinary.findChecksum(manifest, fileName);
  }

  /**
   * Download the Node.js archive and verify status + content-type.
   * @returns {Promise<DownloadedArchive>} - Verified archive metadata.
   */
  async download() {
    await mkdir(NodeBinary.TEMP_DIR, { recursive: true });
    const url = await this.getUrl();
    const archivePath = await this.getArchivePath();
    const officialFileName = basename(new URL(url).pathname);
    const expectedSha256 =
      await this.getExpectedArchiveChecksum(officialFileName);
    const temporaryPath = createAtomicTemporaryPath(archivePath);

    try {
      await this.downloadUrlToFile(url, temporaryPath);
      const actualSha256 = await sha256File(temporaryPath);
      if (actualSha256 !== expectedSha256) {
        throw new Error(
          `Node.js archive checksum mismatch for ${officialFileName}: expected ${expectedSha256}, received ${actualSha256}`,
        );
      }

      await replaceFileAtomically(temporaryPath, archivePath);
      return {
        path: archivePath,
        fileName: officialFileName,
        sha256: expectedSha256,
        version: await this.getExactVersion(),
      };
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  /**
   * @param {string} [binaryPath] - Cached binary path.
   * @returns {Promise<string>} - Integrity receipt path.
   */
  async getIntegrityReceiptPath(binaryPath) {
    return `${binaryPath || (await this.getBinaryPath())}.integrity.json`;
  }

  /**
   * @param {DownloadedArchive} downloadedArchive - Verified archive metadata.
   * @param {string} binaryPath - Extracted binary path.
   * @returns {Promise<NodeBinaryIntegrityReceipt>} - Written receipt.
   */
  async writeIntegrityReceipt(downloadedArchive, binaryPath) {
    const exactVersion = await this.getExactVersion();
    const officialFileName = basename(new URL(await this.getUrl()).pathname);
    const archiveSha256 = String(downloadedArchive.sha256 || '').toLowerCase();

    if (
      downloadedArchive.version !== exactVersion ||
      downloadedArchive.fileName !== officialFileName ||
      !SHA256_PATTERN.test(archiveSha256)
    ) {
      throw new Error(
        'Cannot write integrity receipt for an unverified archive',
      );
    }

    const binaryStat = await stat(binaryPath);
    const receipt = /** @type {NodeBinaryIntegrityReceipt} */ ({
      version: INTEGRITY_RECEIPT_VERSION,
      target: {
        nodeVersion: exactVersion,
        platform: String(this.get('platform')),
        architecture: String(this.get('architecture')),
      },
      archive: {
        fileName: officialFileName,
        sha256: archiveSha256,
      },
      binary: {
        sha256: await sha256File(binaryPath),
        size: binaryStat.size,
      },
    });

    const receiptPath = await this.getIntegrityReceiptPath(binaryPath);
    const temporaryReceiptPath = createAtomicTemporaryPath(receiptPath);
    try {
      await writeFile(
        temporaryReceiptPath,
        `${JSON.stringify(receipt, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      );
      await replaceFileAtomically(temporaryReceiptPath, receiptPath);
    } catch (error) {
      await rm(temporaryReceiptPath, { force: true });
      throw error;
    }

    return receipt;
  }

  /**
   * Validate both receipt identity and current cached binary bytes.
   * @param {string} [binaryPath] - Cached binary path.
   * @returns {Promise<boolean>} - Whether the cache entry is safe to reuse.
   */
  async validateCachedBinary(binaryPath) {
    const resolvedBinaryPath = binaryPath || (await this.getBinaryPath());
    if (!existsSync(resolvedBinaryPath)) return false;

    try {
      const receiptPath =
        await this.getIntegrityReceiptPath(resolvedBinaryPath);
      const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
      const exactVersion = await this.getExactVersion();
      const officialFileName = basename(new URL(await this.getUrl()).pathname);
      const binaryStat = await stat(resolvedBinaryPath);

      if (
        receipt?.version !== INTEGRITY_RECEIPT_VERSION ||
        receipt?.target?.nodeVersion !== exactVersion ||
        receipt?.target?.platform !== String(this.get('platform')) ||
        receipt?.target?.architecture !== String(this.get('architecture')) ||
        receipt?.archive?.fileName !== officialFileName ||
        !SHA256_PATTERN.test(String(receipt?.archive?.sha256 || '')) ||
        !SHA256_PATTERN.test(String(receipt?.binary?.sha256 || '')) ||
        receipt?.binary?.size !== binaryStat.size ||
        !binaryStat.isFile()
      ) {
        return false;
      }

      return (await sha256File(resolvedBinaryPath)) === receipt.binary.sha256;
    } catch {
      return false;
    }
  }

  /**
   * @param {string} [binaryPath] - Cached binary path.
   * @returns {Promise<void>}
   */
  async removeCachedBinary(binaryPath) {
    const resolvedBinaryPath = binaryPath || (await this.getBinaryPath());
    await Promise.all([
      rm(resolvedBinaryPath, { force: true }),
      rm(await this.getIntegrityReceiptPath(resolvedBinaryPath), {
        force: true,
      }),
    ]);
  }

  /**
   * Re-hash the placed archive immediately before extraction, closing the
   * download-to-extraction tampering window.
   * @param {DownloadedArchive | undefined} downloadedArchive - Download metadata.
   * @returns {Promise<DownloadedArchive>} - Revalidated archive metadata.
   */
  async verifyArchiveBeforeExtraction(downloadedArchive) {
    const archivePath =
      downloadedArchive?.path || (await this.getArchivePath());
    const exactVersion = await this.getExactVersion();
    const officialFileName = basename(new URL(await this.getUrl()).pathname);
    const expectedSha256 = downloadedArchive
      ? String(downloadedArchive.sha256 || '').toLowerCase()
      : await this.getExpectedArchiveChecksum(officialFileName);

    if (
      (downloadedArchive && downloadedArchive.version !== exactVersion) ||
      (downloadedArchive && downloadedArchive.fileName !== officialFileName) ||
      !SHA256_PATTERN.test(expectedSha256)
    ) {
      throw new Error('Cannot extract an unverified Node.js archive');
    }

    const actualSha256 = await sha256File(archivePath);
    if (actualSha256 !== expectedSha256) {
      await rm(archivePath, { force: true });
      throw new Error(
        `Node.js archive checksum mismatch for ${officialFileName}: expected ${expectedSha256}, received ${actualSha256}`,
      );
    }

    return {
      path: archivePath,
      fileName: officialFileName,
      sha256: expectedSha256,
      version: exactVersion,
    };
  }

  /**
   * @param {DownloadedArchive} [downloadedArchive] - Verified download metadata.
   * @returns {Promise<void>}
   */
  async extract(downloadedArchive) {
    const verifiedArchive =
      await this.verifyArchiveBeforeExtraction(downloadedArchive);
    const binaryPath = await this.getBinaryPath();
    const extractionPath = `${verifiedArchive.path}-extract`;

    try {
      const extractedBinary =
        this.get('platform') === 'win32'
          ? await this.extractWindowsZip(verifiedArchive.path)
          : await this.extractUnixTar(verifiedArchive.path);

      await replaceFileAtomically(extractedBinary, binaryPath);
      await this.writeIntegrityReceipt(verifiedArchive, binaryPath);
    } catch (error) {
      await this.removeCachedBinary(binaryPath);
      throw error;
    } finally {
      await Promise.all([
        rm(verifiedArchive.path, { force: true }),
        rm(extractionPath, { force: true, recursive: true }),
      ]);
    }
  }

  /**
   * Extract a .zip for Windows, returning path to the 'node.exe'.
   * Uses JSZip for in-memory extraction.
   * @param {string} archivePath - archivePath.
   * @returns {Promise<string>} - Path to the extracted 'node.exe' binary.
   */
  async extractWindowsZip(archivePath) {
    const zipData = await readFile(archivePath);
    const jszip = new JSZip();
    const zip = await jszip.loadAsync(zipData);

    // Typically: node-v22.0.0-win-x64/node.exe
    let nodeExePath = '';
    const extractDir = `${archivePath}-extract`;
    await mkdir(extractDir, { recursive: true });

    // Iterate through zip files
    const fileNames = Object.keys(zip.files);
    // We want something like: "node.exe" in "node-v22.0.0-win-x64/"
    for (const fname of fileNames) {
      if (/\/node\.exe$/.test(fname)) {
        nodeExePath = fname;
        break;
      }
    }
    if (!nodeExePath) {
      throw new Error('Could not find node.exe in the downloaded zip');
    }

    // Extract just node.exe
    const fileData = await zip.files[nodeExePath].async('nodebuffer');

    // We'll place it in extractDir/node.exe
    const finalPath = join(extractDir, 'node.exe');
    await writeFile(finalPath, fileData);

    return finalPath;
  }

  /**
   * Extract a .tar.xz and return the path to the extracted 'node' binary.
   * @param {string} archivePath - archivePath.
   * @returns {Promise<string>} - Path to the extracted 'node' binary.
   */
  async extractUnixTar(archivePath) {
    // Extract to a new folder
    const extractDir = `${archivePath}-extract`;
    await mkdir(extractDir, { recursive: true });

    await _extract({
      file: archivePath,
      cwd: extractDir,
      strict: true,
    });

    const subDirs = await readdir(extractDir);
    if (subDirs.length !== 1) {
      throw new Error(
        `Expected exactly 1 top-level dir in tar, got: ${subDirs.length}`,
      );
    }

    const nodeBinary = join(extractDir, subDirs[0], 'bin', 'node');
    if (!existsSync(nodeBinary)) {
      throw new Error(`Node binary not found at: ${nodeBinary}`);
    }

    return nodeBinary;
  }

  async _reconcile() {
    const binaryPath = await this.getBinaryPath();
    if (existsSync(binaryPath)) {
      if (await this.validateCachedBinary(binaryPath)) return;
      await this.removeCachedBinary(binaryPath);
    } else {
      await rm(await this.getIntegrityReceiptPath(binaryPath), { force: true });
    }

    const downloadedArchive = await this.download();
    await this.extract(downloadedArchive);
  }

  async _destroy() {
    if (!this.has('binaryPath')) return;
    await this.removeCachedBinary(this.get('binaryPath'));
  }
}

/**
 * @typedef {Object} NodeVersionDescription
 * @property {string} version - The version string.
 * @property {string} date - The release date.
 * @property {string[]} files - The files available for this version.
 * @property {string} npm - The npm version.
 * @property {string} v8 - The v8 version.
 * @property {string} uv - The uv version.
 * @property {string} zlib - The zlib version.
 * @property {string} openssl - The openssl version.
 * @property {string} modules - The modules version.
 * @property {string | false} lts - The LTS codename, or false if the version is not LTS.
 * @property {string} security - The security support status.
 */
/**
 * @type {NodeVersionDescription[] | undefined}
 */
NodeBinary.versions = undefined;

NodeBinary.BINARIES_DIR = join(paths.data, 'node_binaries');

NodeBinary.TEMP_DIR = join(paths.temp, 'extracts');

export default NodeBinary;
