// const bluebirdPromise = require('bluebird');

// eslint-disable-next-line node/no-extraneous-require
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');
const paths = require('../../../paths');
const BaseResource = require('../base-resource');

/**
 * @typedef JSBundleProperties
 * @property {string | function(): string} entryCode -
 * @property {string | function(): string} resolveDir -
 * @property {string | function(): string} nodeVersion -
 * @property {Object<string,string> | function(): Object<string,string>} [environmentVariables] -
 * @property {Object<string,string> | function(): Object<string,string>} [assets] -
 */

/**
 * @typedef JSBundleOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {import('../reconcilable')[]} [dependsOn] -
 * @property {JSBundleProperties & import('../../typedefs').SharedProperties} properties -
 */

class JSBundle extends BaseResource {
  /**
   * @param {JSBundleOptions} options - JSBundle Class Options
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
    const distFile = `${this.name}-${this.get('nodeVersion')}.js`;
    const bundlePath = path.join(JSBundle.BUILD_DIR, distFile);
    await this.esbuild(bundlePath);
    this._setUNSAFE('bundlePath', bundlePath);
  }

  /**
   * @param {string} buildDir -
   */
  async esbuild(buildDir) {
    console.log(this.get('entryCode'));
    console.log(this.get('resolveDir'));
    const { errors, warnings } = await esbuild.build({
      stdin: {
        contents: this.get('entryCode'),
        resolveDir: this.get('resolveDir'),
        sourcefile: 'index.js',
      },
      outfile: path.join(buildDir, 'esbundle.js'),
      bundle: true,
      platform: 'node',
      minify: true,
      keepNames: false,
      sourcemap: 'inline',
      target: `node${this.get('nodeVersion')}`,
      logLevel: 'silent',
      define: {
        __WILLEM_BUILD_RECONCILE_TERMINATOR: '1', // injects this variable definition into the global scope
      },
    });

    if (errors.length > 0) {
      console.error(errors);
      // eslint-disable-next-line no-process-exit
      process.exit(1);
    }

    if (warnings.length > 0) {
      console.warn(warnings);
    }
  }

  async _reconcile() {
    if (!fs.existsSync(JSBundle.BUILD_DIR)) {
      await fs.promises.mkdir(JSBundle.BUILD_DIR, {
        recursive: true,
      });
    }
    await this.build();
  }

  async _destroy() {
    if (!fs.existsSync(this.get('bundlePath'))) {
      return;
    }
    await fs.promises.unlink(this.get('bundlePath'));
  }
}

JSBundle.BUILD_DIR = path.join(paths.data, 'js-bundle');

module.exports = JSBundle;
