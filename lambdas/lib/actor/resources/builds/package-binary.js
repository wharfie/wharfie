const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const fspromise = require('node:fs/promises');
const path = require('node:path');
// eslint-disable-next-line node/no-unpublished-require
const tar = require('tar');
const BaseResource = require('../base-resource');
const paths = require('../../../paths');

/**
 * @typedef {('darwin'|'win'|'linux')} BinaryPlatform
 */
/**
 * @typedef {('x64'|'arm64')} BinaryArch
 */
/**
 * @typedef PackageBinaryProperties
 * @property {string | function(): string} version - The version of the npm package.
 * @property {BinaryPlatform | function(): BinaryPlatform} platform - Target platform.
 * @property {BinaryArch | function(): BinaryArch} architecture - Target CPU architecture.
 * @property {string | function(): string} packageName - Name of the npm package containing the binary.
 * @property {string | function(): string} binaryRelativePath - The relative path inside the tarball to the desired binary.
 * @property {string} [archiveExtension] - Archive extension (defaults to '.zip' on Windows, '.tar.gz' otherwise).
 * @property {string} [registryUrl] - Base URL for the npm registry (defaults to 'https://registry.npmjs.org').
 */

/**
 * @typedef PackageBinaryOptions
 * @property {string} name - Resource name.
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {import('../reconcilable')[]} [dependsOn] -
 * @property {PackageBinaryProperties & import('../../typedefs').SharedProperties} properties -
 */

class PackageBinary extends BaseResource {
  /**
   * @param {PackageBinaryOptions} options -
   */
  constructor({ name, parent, status, dependsOn, properties }) {
    super({ name, parent, status, dependsOn, properties });
  }

  /**
   * Build the binary file name from the package name, version, platform and architecture.
   * Optionally appends an executable extension for Windows.
   * @returns {string} -
   */
  getBinaryName() {
    const ext = this.get('platform') === 'win' ? '.exe' : '';
    return `${this.get('packageName')}-${this.get('version')}-${this.get(
      'platform'
    )}-${this.get('architecture')}${ext}`;
  }

  /**
   * Determines the destination path where the binary will be installed.
   * @returns {Promise<string>} -
   */
  async getBinaryPath() {
    if (this.has('binaryPath')) return this.get('binaryPath');
    if (!fs.existsSync(PackageBinary.BINARIES_DIR)) {
      await fspromise.mkdir(PackageBinary.BINARIES_DIR, { recursive: true });
    }
    this._setUNSAFE(
      'binaryPath',
      path.join(PackageBinary.BINARIES_DIR, this.getBinaryName())
    );
    return this.get('binaryPath');
  }

  /**
   * Determines the file path for the downloaded archive.
   * @returns {Promise<string>} -
   */
  async getArchivePath() {
    if (this._archivePath) return this._archivePath;
    const defaultExt = this.get('platform') === 'win' ? '.zip' : '.tar.gz';
    const ext = this.get('archiveExtension') || defaultExt;
    const archiveName = `${this.get('packageName')}-${this.get(
      'version'
    )}-${this.get('platform')}-${this.get('architecture')}${ext}`;
    this._archivePath = path.join(PackageBinary.TEMP_DIR, archiveName);
    return this._archivePath;
  }

  /**
   * Downloads the npm tarball for the package and then extracts the binary.
   */
  async downloadTarball() {
    if (!fs.existsSync(PackageBinary.TEMP_DIR)) {
      await fspromise.mkdir(PackageBinary.TEMP_DIR, { recursive: true });
    }
    const registryUrl = this.get('registryUrl') || 'https://registry.npmjs.org';
    const packageName = this.get('packageName');
    const metadataUrl = `${registryUrl}/${packageName}/${this.get('version')}`;
    const packageMetadata = JSON.parse(await this.download(metadataUrl));
    console.log(packageMetadata);
    const tarballUrl = packageMetadata.dist.tarball;
    console.log(`Downloading ${tarballUrl}`);
    console.log(await this.getArchivePath());
    await this.downloadFile(tarballUrl, await this.getArchivePath());
    await this.extract();
  }

  /**
   * Utility: Downloads content from the given URL and returns it as a string.
   * @param {string} url -
   * @returns {Promise<string>} -
   */
  async download(url) {
    const protocol = url.startsWith('https:') ? https : http;
    return await new Promise((resolve, reject) => {
      protocol
        .get(url, (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve(data));
        })
        .on('error', reject);
    });
  }

  /**
   * Utility: Downloads a file from a URL to a specified destination path.
   * @param {string} url -
   * @param {string} destPath -
   */
  async downloadFile(url, destPath) {
    // Ensure the destination directory exists.
    await fspromise.mkdir(path.dirname(destPath), { recursive: true });
    const fileStream = fs.createWriteStream(destPath);
    const protocol = url.startsWith('https:') ? https : http;
    await new Promise((resolve, reject) => {
      protocol
        .get(url, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed with status: ${res.statusCode}`));
            return;
          }
          res.pipe(fileStream);
          fileStream.on('finish', () => fileStream.close(resolve));
        })
        .on('error', reject);
    });
  }

  /**
   * Extracts the downloaded archive and moves the desired binary to the binary destination.
   */
  async extract() {
    const archivePath = await this.getArchivePath();

    const extractedBinaryPath = await this.extractUnixTar(archivePath);
    const binaryPath = await this.getBinaryPath();
    // Make sure the binary path dir exists
    await fspromise.mkdir(path.dirname(binaryPath), { recursive: true });
    // Move the extracted binary to the final binary path.
    await fspromise.rename(extractedBinaryPath, binaryPath);
    // Cleanup the downloaded archive.
    await fspromise.unlink(archivePath);
  }

  /**
   * Extracts a .tar.gz archive (Unix) and returns the path to the desired binary.
   * @param {string} archivePath -
   * @returns {Promise<string>} -
   */
  async extractUnixTar(archivePath) {
    const extractDir = `${archivePath}-extract`;
    await fspromise.mkdir(extractDir, { recursive: true });
    await tar.extract({
      file: archivePath,
      cwd: extractDir,
      strict: true,
    });
    // Assumes the tarball contains a single top-level directory.
    const subDirs = await fspromise.readdir(extractDir);
    if (subDirs.length !== 1) {
      throw new Error(
        `Expected exactly 1 top-level directory in tar, got: ${subDirs.length}`
      );
    }
    const targetPath = path.join(
      extractDir,
      subDirs[0],
      this.get('binaryRelativePath')
    );
    if (!fs.existsSync(targetPath)) {
      throw new Error(`Binary not found at expected path: ${targetPath}`);
    }
    return targetPath;
  }

  async _reconcile() {
    if (await fs.existsSync(await this.getBinaryPath())) return;
    await this.downloadTarball();
  }

  async _destroy() {
    if (!fs.existsSync(await this.getBinaryPath())) return;
    await fspromise.unlink(await this.getBinaryPath());
  }
}

PackageBinary.BINARIES_DIR = path.join(paths.data, 'binaries');
PackageBinary.TEMP_DIR = path.join(paths.temp, 'extracts');

module.exports = PackageBinary;
