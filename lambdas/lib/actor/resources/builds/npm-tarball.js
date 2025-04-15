const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
// eslint-disable-next-line node/no-unpublished-require
const tar = require('tar');
const { isSea, getAsset } = require('node:sea');
const fspromise = require('node:fs/promises');
const path = require('node:path');
const BuildResource = require('./build-resource');
const paths = require('../../../paths');

/**
 * @typedef NPMTarballProperties
 * @property {string | function(): string} version - The version of the npm package.
 * @property {string | function(): string} packageName - Name of the npm package containing the binary.
 * @property {string} [registryUrl] - Base URL for the npm registry (defaults to 'https://registry.npmjs.org').
 */

/**
 * @typedef NPMTarballOptions
 * @property {string} name - Resource name.
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {import('../reconcilable')[]} [dependsOn] -
 * @property {NPMTarballProperties & import('../../typedefs').SharedProperties} properties -
 */

class NPMTarball extends BuildResource {
  /**
   * @param {NPMTarballOptions} options -
   */
  constructor({ name, parent, status, dependsOn, properties }) {
    super({ name, parent, status, dependsOn, properties });
  }

  /**
   * Determines the file path for the downloaded archive.
   * @returns {Promise<string>} -
   */
  async getArchivePath() {
    if (this.has('archivePath')) return this.get('archivePath');
    const defaultExt = this.get('platform') === 'win' ? '.zip' : '.tar.gz';
    const ext = this.get('archiveExtension') || defaultExt;
    const archiveName = `${this.get('packageName')}-${this.get(
      'version'
    )}-${this.get('platform')}-${this.get('architecture')}${ext}`;
    this._setUNSAFE('archivePath', path.join(NPMTarball.TEMP_DIR, archiveName));
    return this.get('archivePath');
  }

  /**
   * Downloads the npm tarball for the package and then extracts the binary.
   */
  async downloadTarball() {
    if (!fs.existsSync(NPMTarball.TEMP_DIR)) {
      await fspromise.mkdir(NPMTarball.TEMP_DIR, { recursive: true });
    }
    const registryUrl = this.get('registryUrl') || 'https://registry.npmjs.org';
    const packageName = this.get('packageName');
    const metadataUrl = `${registryUrl}/${packageName}/${this.get('version')}`;
    console.log(metadataUrl);
    const packageMetadata = JSON.parse(await this.download(metadataUrl));
    console.log(packageMetadata);
    const tarballUrl = packageMetadata.dist.tarball;
    console.log(`Downloading ${tarballUrl}`);
    console.log(await this.getArchivePath());
    await this.downloadFile(tarballUrl, await this.getArchivePath());
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

  async _reconcile() {
    if (await fs.existsSync(await this.getArchivePath())) return;
    await this.downloadTarball();
  }

  async _destroy() {
    if (!fs.existsSync(await this.getArchivePath())) return;
    await fspromise.unlink(await this.getArchivePath());
  }

  async initializeEnvironment() {
    console.log('initializing npm tarball', this.name);
    if (!isSea()) {
      return;
    }

    // Define paths.
    const targetDir = path.join(paths.cache, 'lmbd');
    const tempTarPath = path.join(paths.temp, 'lmdb.tar');

    // Check if the target directory exists and is non-empty.
    if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
      console.log('Extraction already completed; skipping.');
    } else {
      // Ensure the target directory exists.
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const assetBuffer = getAsset(this.name);
      const buffer = Buffer.from(assetBuffer);
      // Write the Buffer to a temporary tar file.
      fs.writeFileSync(tempTarPath, buffer);
      try {
        // Extract the tarball into the target directory.
        await tar.x({
          file: tempTarPath,
          cwd: targetDir,
        });
        console.log('Extraction complete.');
      } catch (err) {
        console.error('Extraction error:', err);
        throw err;
      } finally {
        await fs.promises.unlink(tempTarPath);
      }
    }
    process.env[
      `${this.get('packageName').toUpperCase().replace(/-/g, '_')}_PREBUILD`
    ] = targetDir;
  }
}

NPMTarball.BINARIES_DIR = path.join(paths.data, 'binaries');
NPMTarball.TEMP_DIR = path.join(paths.temp, 'extracts');

module.exports = NPMTarball;
