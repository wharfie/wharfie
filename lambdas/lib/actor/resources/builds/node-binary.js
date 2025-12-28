import https, { get } from 'node:https';
import http from 'node:http';
import { existsSync, createWriteStream, unlink, promises } from 'node:fs';
import {
  mkdir,
  rename,
  unlink as _unlink,
  readFile,
  writeFile,
  readdir,
} from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { extract as _extract } from 'tar';
import paths from '../../../paths.js';
import BaseResource from '../base-resource.js';

/**
 * @typedef {import('node:process')['platform']} TargetPlatform
 * @typedef {import('node:process')['arch']} TargetArch
 */
/**
 * @typedef NodeBinaryProperties
 * @property {string | function(): string} version -
 * @property {TargetPlatform | function(): TargetPlatform} platform -
 * @property {TargetArch | function(): TargetArch} architecture -
 */

/**
 * @typedef NodeBinaryOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable.js').default.Status} [status] -
 * @property {import('../reconcilable.js').default[]} [dependsOn] -
 * @property {NodeBinaryProperties & import('../../typedefs.js').SharedProperties} properties -
 */

class NodeBinary extends BaseResource {
  /**
   * @param {NodeBinaryOptions} options -
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
    const matchingVersions = versions.filter((v) =>
      v.version.startsWith(`v${this.get('version')}`),
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
   * @property {string} token -
   * @property {string} normPlatform -
   * @property {string} normArch -
   * @property {string} ext -
   * @property {string} packagingKey -
   * @property {boolean} isWin -
   * @property {boolean} isMac -
   */
  /**
   * Map Node/OS tokens and choose packaging for our extractor.
   * - We extract .zip on Windows.
   * - We extract .tar.gz on macOS (Node publishes osx-*-tar).
   * - For everything else we keep your existing .tar.gz assumption.
   * @param {string} platform -
   * @param {string} arch -
   * @returns {targetSpec} -
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
   * @param {string} token -
   * @param {string} normArch -
   * @param {string} packagingKey -
   * @returns {string[]} -
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
   * Download the Node.js archive and verify status + content-type.
   */
  async download() {
    if (!existsSync(NodeBinary.TEMP_DIR)) {
      await mkdir(NodeBinary.TEMP_DIR, { recursive: true });
    }

    const url = await this.getUrl();
    const archivePath = await this.getArchivePath();

    return new Promise((resolve, reject) => {
      const file = createWriteStream(archivePath);
      const request = url.startsWith('https') ? https : http;

      request
        .get(url, (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            return reject(
              new Error(`Download failed: ${response.statusCode} ${url}`),
            );
          }
          const ct = (response.headers['content-type'] || '').toLowerCase();
          // Accept the usual suspects; Node sometimes serves octet-stream
          if (!/zip|tar|gzip|octet-stream/.test(ct)) {
            response.resume();
            return reject(
              new Error(`Unexpected content-type '${ct}' from ${url}`),
            );
          }

          response.pipe(file);
          file.on('finish', () => file.close(resolve));
        })
        .on('error', (err) => {
          unlink(archivePath, () => reject(err));
        });
    });
  }

  async extract() {
    // Extract node binary
    let extractedBinary;
    if (this.get('platform') === 'win32') {
      extractedBinary = await this.extractWindowsZip(
        await this.getArchivePath(),
      );
    } else {
      extractedBinary = await this.extractUnixTar(await this.getArchivePath());
    }

    // Move out of the temp extraction to localPath
    await rename(extractedBinary, await this.getBinaryPath());

    // Cleanup archive
    await _unlink(await this.getArchivePath());
  }

  /**
   * Extract a .zip for Windows, returning path to the 'node.exe'.
   * Uses JSZip for in-memory extraction.
   * @param {string} archivePath -
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
   * @param {string} archivePath -
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
    if (await existsSync(await this.getBinaryPath())) return;
    await this.download();
    await this.extract();
  }

  async _destroy() {
    if (!existsSync(this.get('binaryPath'))) {
      return;
    }
    await promises.unlink(this.get('binaryPath'));
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
