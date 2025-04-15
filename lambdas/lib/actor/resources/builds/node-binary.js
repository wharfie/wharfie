const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const fspromise = require('node:fs/promises');
const path = require('node:path');
const JSZip = require('jszip');
// eslint-disable-next-line node/no-unpublished-require
const tar = require('tar');
const paths = require('../../../paths');
const BaseResource = require('../base-resource');

/**
 * @typedef {('darwin'|'win'|'linux')} NodeBinaryPlatform
 */
/**
 * @typedef {('x64'|'arm64')} NodeBinaryArch
 */
/**
 * @typedef NodeBinaryProperties
 * @property {string | function(): string} version -
 * @property {NodeBinaryPlatform | function(): NodeBinaryPlatform} platform -
 * @property {NodeBinaryArch | function(): NodeBinaryArch} architecture -
 */

/**
 * @typedef NodeBinaryOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {import('../reconcilable')[]} [dependsOn] -
 * @property {NodeBinaryProperties & import('../../typedefs').SharedProperties} properties -
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
      properties
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
    if (this._exactVersion) return this._exactVersion;
    const versions = await NodeBinary.getVersions();
    const matchingVersions = versions.filter((v) =>
      v.version.startsWith(`v${this.get('version')}`)
    );
    if (matchingVersions.length === 0) {
      throw new Error(`No Node.js version found for ${this.get('version')}`);
    }
    const latestVersion = matchingVersions[0].version;
    this._exactVersion = latestVersion;
    return latestVersion;
  }

  /**
   * Get the list of all Node.js versions from nodejs.org.
   * @returns {Promise<Array<NodeVersionDescription>>} - List of all Node.js versions.
   */
  static async getVersions() {
    if (NodeBinary.versions) return NodeBinary.versions;
    return new Promise((resolve, reject) => {
      https
        .get(`https://nodejs.org/dist/index.json`, (response) => {
          let data = '';
          response.on('data', (chunk) => {
            data += chunk;
          });
          response.on('end', () => {
            const versions = JSON.parse(data);
            NodeBinary.versions = versions;
            resolve(versions);
          });
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }

  /**
   * Get the name of the Node.js binary.
   * @returns {Promise<string>} - name of the Node.js binary
   */
  async getBinaryName() {
    const ext = this.get('platform') === 'windows' ? '.exe' : '';
    return `node-${await this.getExactVersion()}-${this.get(
      'platform'
    )}-${this.get('architecture')}${ext}`;
  }

  /**
   * Get the path of the Node.js binary.
   * @returns {Promise<string>} - path of the Node.js binary
   */
  async getBinaryPath() {
    if (this.has('binaryPath')) return this.get('binaryPath');
    if (!fs.existsSync(NodeBinary.BINARIES_DIR)) {
      await fspromise.mkdir(NodeBinary.BINARIES_DIR, { recursive: true });
    }
    this._setUNSAFE(
      'binaryPath',
      path.join(NodeBinary.BINARIES_DIR, await this.getBinaryName())
    );
    return this.get('binaryPath');
  }

  /**
   * Get the name of the Node.js archive.
   * @returns {Promise<string>} - path of the Node.js archive
   */
  async getArchivePath() {
    if (this._archivePath) return this._archivePath;
    const ext = this.get('platform') === 'windows' ? '.zip' : '.tar.gz';
    const archiveName = `node-${await this.getExactVersion()}-${this.get(
      'platform'
    )}-${this.get('architecture')}${ext}`;
    this._archivePath = path.join(NodeBinary.TEMP_DIR, archiveName);
    return this._archivePath;
  }

  /**
   * Get the URL of the Node.js binary to download.
   * @returns {Promise<string>} - URL of the Node.js binary to download.
   */
  async getUrl() {
    const ext = this.get('platform') === 'windows' ? '.zip' : '.tar.gz';
    return `https://nodejs.org/dist/${await this.getExactVersion()}/node-${await this.getExactVersion()}-${this.get(
      'platform'
    )}-${this.get('architecture')}${ext}`;
  }

  async download() {
    if (!fs.existsSync(NodeBinary.TEMP_DIR)) {
      await fspromise.mkdir(NodeBinary.TEMP_DIR, { recursive: true });
    }
    const file = fs.createWriteStream(await this.getArchivePath());
    const url = await this.getUrl();
    const request = url.startsWith('https') ? https : http;
    const archivePath = await this.getArchivePath();
    return new Promise((resolve, reject) => {
      request
        .get(url, (response) => {
          response.pipe(file);
          file.on('finish', () => {
            file.close(resolve);
          });
        })
        .on('error', (error) => {
          fs.unlink(archivePath, () => {
            reject(error);
          });
        });
    });
  }

  async extract() {
    // Extract node binary
    let extractedBinary;
    if (this.get('platform') === 'windows') {
      extractedBinary = await this.extractWindowsZip(
        await this.getArchivePath()
      );
    } else {
      extractedBinary = await this.extractUnixTar(await this.getArchivePath());
    }

    // Move out of the temp extraction to localPath
    await fspromise.rename(extractedBinary, await this.getBinaryPath());

    // Cleanup archive
    await fspromise.unlink(await this.getArchivePath());
  }

  /**
   * Extract a .zip for Windows, returning path to the 'node.exe'.
   * Uses JSZip for in-memory extraction.
   * @param {string} archivePath -
   * @returns {Promise<string>} - Path to the extracted 'node.exe' binary.
   */
  async extractWindowsZip(archivePath) {
    const zipData = await fspromise.readFile(archivePath);
    const jszip = new JSZip();
    const zip = await jszip.loadAsync(zipData);

    // Typically: node-v22.0.0-win-x64/node.exe
    let nodeExePath = '';
    const extractDir = `${archivePath}-extract`;
    await fspromise.mkdir(extractDir, { recursive: true });

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
    const finalPath = path.join(extractDir, 'node.exe');
    await fspromise.writeFile(finalPath, fileData);

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
    await fspromise.mkdir(extractDir, { recursive: true });

    await tar.extract({
      file: archivePath,
      cwd: extractDir,
      strict: true,
    });

    const subDirs = await fspromise.readdir(extractDir);
    if (subDirs.length !== 1) {
      throw new Error(
        `Expected exactly 1 top-level dir in tar, got: ${subDirs.length}`
      );
    }

    const nodeBinary = path.join(extractDir, subDirs[0], 'bin', 'node');
    if (!fs.existsSync(nodeBinary)) {
      throw new Error(`Node binary not found at: ${nodeBinary}`);
    }

    return nodeBinary;
  }

  async _reconcile() {
    console.log(await this.getBinaryPath());
    if (await fs.existsSync(await this.getBinaryPath())) return;
    await this.download();
    await this.extract();
  }

  async _destroy() {
    if (!fs.existsSync(this.get('binaryPath'))) {
      return;
    }
    await fs.promises.unlink(this.get('binaryPath'));
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

NodeBinary.BINARIES_DIR = path.join(paths.data, 'node_binaries');

NodeBinary.TEMP_DIR = path.join(paths.temp, 'extracts');

module.exports = NodeBinary;
