// const bluebirdPromise = require('bluebird');

// eslint-disable-next-line node/no-extraneous-require
const uuid = require('uuid');
const path = require('node:path');
const fs = require('node:fs');
const paths = require('../../../paths');
const { runCmd, execFile } = require('../../../cmd');
// @ts-ignore
const postject = require('postject');
const BaseResource = require('../base-resource');

/**
 * @typedef {('darwin'|'win'|'linux')} SeaBinaryPlatform
 */
/**
 * @typedef {('x64'|'arm64')} SeaBinaryArch
 */
/**
 * @typedef NodeSingleExecutableApplicationProperties
 * @property {string | function(): string} bundlePath -
 * @property {string | function(): string} nodeBinaryPath -
 * @property {string | function(): string} nodeVersion -
 * @property {SeaBinaryPlatform | function(): SeaBinaryPlatform} platform -
 * @property {SeaBinaryArch | function(): SeaBinaryArch} architecture -
 * @property {Object<string,string> | function(): Object<string,string>} [assets] -
 */

/**
 * @typedef NodeSingleExecutableApplicationOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {import('../reconcilable')[]} [dependsOn] -
 * @property {NodeSingleExecutableApplicationProperties & import('../../typedefs').SharedProperties} properties -
 */

class NodeSingleExecutableApplication extends BaseResource {
  /**
   * @param {NodeSingleExecutableApplicationOptions} options - NodeSingleExecutableApplication Class Options
   */
  constructor({ name, parent, status, dependsOn, properties }) {
    const propertiesWithDefaults = Object.assign(
      {
        nodeVersion: '23',
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

  async build() {
    const distFile = `${this.name}-${this.get('nodeVersion')}-${this.get(
      'platform'
    )}-${this.get('architecture')}`;
    const binaryPath = path.join(
      NodeSingleExecutableApplication.BINARIES_DIR,
      distFile
    );
    const tmpBuildDir = path.join(
      NodeSingleExecutableApplication.TMP_DIR,
      `build-${uuid.v4()}`
    );
    await fs.promises.mkdir(tmpBuildDir, { recursive: true });
    const tempNodeBinaryPath = path.join(tmpBuildDir, 'node-binary');
    await fs.promises.copyFile(
      await this.get('nodeBinaryPath'),
      tempNodeBinaryPath
    );
    await this.seaBuild(tmpBuildDir, tempNodeBinaryPath);
    if (!fs.existsSync(NodeSingleExecutableApplication.BINARIES_DIR)) {
      await fs.promises.mkdir(NodeSingleExecutableApplication.BINARIES_DIR, {
        recursive: true,
      });
    }
    await fs.promises.copyFile(tempNodeBinaryPath, binaryPath);
    console.log('BINARYPATH', binaryPath);

    this._setUNSAFE('binaryPath', binaryPath);
  }

  /**
   * @param {string} buildDir -
   * @param {string} nodeBinaryPath -
   */
  async seaBuild(buildDir, nodeBinaryPath) {
    const seaConfigPath = path.join(buildDir, 'sea-config.json');
    const blobPath = path.join(buildDir, 'sea.blob');
    const seaConfig = {
      main: this.get('bundlePath'),
      output: blobPath,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      assets: this.get('assets', {}),
    };

    fs.writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2), 'utf8');
    await execFile(nodeBinaryPath, [
      '--no-warnings',
      '--experimental-sea-config',
      seaConfigPath,
    ]);
    if (this.get('platform') === 'darwin') {
      await runCmd('codesign', ['--remove-signature', nodeBinaryPath]);
    }
    const blobData = fs.readFileSync(blobPath);
    console.log('NODE BINARY PATH', nodeBinaryPath);
    // base64 encoded fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
    // see https://github.com/nodejs/postject/issues/92#issuecomment-2283508514
    await postject.inject(nodeBinaryPath, 'NODE_SEA_BLOB', blobData, {
      sentinelFuse: Buffer.from(
        'Tk9ERV9TRUFfRlVTRV9mY2U2ODBhYjJjYzQ2N2I2ZTA3MmI4YjVkZjE5OTZiMg==',
        'base64'
      ).toString(),
      ...(this.get('platform') === 'darwin'
        ? { machoSegmentName: 'NODE_SEA' }
        : {}),
    });
  }

  async _reconcile() {
    if (this.has('binaryPath') && fs.existsSync(this.get('binaryPath'))) {
      return;
    }
    await this.build();
  }

  async _destroy() {
    if (!fs.existsSync(this.get('binaryPath'))) {
      return;
    }
    await fs.promises.unlink(this.get('binaryPath'));
  }
}

NodeSingleExecutableApplication.BINARIES_DIR = path.join(
  paths.data,
  'node-single-executable-application'
);

NodeSingleExecutableApplication.TMP_DIR = path.join(
  paths.temp,
  'node-single-executable-application'
);

module.exports = NodeSingleExecutableApplication;
