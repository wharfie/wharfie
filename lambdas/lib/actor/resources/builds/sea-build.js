// const bluebirdPromise = require('bluebird');

// eslint-disable-next-line node/no-extraneous-require
const uuid = require('uuid');
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('../../../esbuild');
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
 * @typedef SeaBuildProperties
 * @property {string | function(): string} handler -
 * @property {string | function(): string} nodeBinaryPath -
 * @property {string | function(): string} nodeVersion -
 * @property {SeaBinaryPlatform | function(): SeaBinaryPlatform} platform -
 * @property {SeaBinaryArch | function(): SeaBinaryArch} architecture -
 * @property {Object<string,string> | function(): Object<string,string>} [environmentVariables] -
 */

/**
 * @typedef SeaBuildOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {import('../reconcilable')[]} [dependsOn] -
 * @property {SeaBuildProperties & import('../../typedefs').SharedProperties} properties -
 */

class SeaBuild extends BaseResource {
  /**
   * @param {SeaBuildOptions} options - SeaBuild Class Options
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

  getHandlerExportName() {
    // Expect a string in the form "filePath.exportName"
    const dotIndex = this.get('handler').lastIndexOf('.');
    if (dotIndex < 0) {
      throw new Error(
        "Invalid handler format. Use '/absolute/path/to/module.exportName'"
      );
    }
    return this.get('handler').slice(dotIndex + 1);
  }

  getHandlerAbsolutePath() {
    // Expect a string in the form "filePath.exportName"
    const dotIndex = this.get('handler').lastIndexOf('.');
    if (dotIndex < 0) {
      throw new Error(
        "Invalid handler format. Use '/absolute/path/to/module.exportName'"
      );
    }
    const handlerFile = this.get('handler').slice(0, dotIndex);
    // Resolve to absolute path if relative
    if (!path.isAbsolute(handlerFile)) {
      throw new Error(
        "Invalid handler format. Use '/absolute/path/to/module.exportName'"
      );
    }
    return handlerFile;
  }

  async build() {
    const distFile = `${this.name}-${this.get('nodeVersion')}--${this.get(
      'platform'
    )}-${this.get('architecture')}`;
    const binaryPath = path.join(SeaBuild.BINARIES_DIR, distFile);
    const tmpBuildDir = path.join(SeaBuild.BUILD_DIR, `build-${uuid.v4()}`);
    await fs.promises.mkdir(tmpBuildDir, { recursive: true });
    await this.esbuild(tmpBuildDir);
    await this.prepareExternalBinaries();
    const tempNodeBinaryPath = path.join(tmpBuildDir, 'node-binary');
    await fs.promises.copyFile(
      await this.get('nodeBinaryPath'),
      tempNodeBinaryPath
    );
    await this.seaBuild(tmpBuildDir, tempNodeBinaryPath);
    if (!fs.existsSync(SeaBuild.BINARIES_DIR)) {
      await fs.promises.mkdir(SeaBuild.BINARIES_DIR, { recursive: true });
    }
    await fs.promises.copyFile(tempNodeBinaryPath, binaryPath);

    this._setUNSAFE('binaryPath', binaryPath);
  }

  async prepareExternalBinaries() {
    // await this.nodeBinary.reconcile();
    // await this.fetchUserDefinedBinaries();
  }

  async fetchUserDefinedBinaries() {}

  formatEnvVars() {
    return Object.entries(this.get('environmentVariables', {}))
      .map(
        ([key, value]) =>
          `process.env['${key.toString()}'] = '${value.toString()}';`
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
   * @param {string} buildDir -
   */
  async esbuild(buildDir) {
    const handlerPath = this.getHandlerAbsolutePath();
    const handlerExportName = this.getHandlerExportName();
    const entryCode = `
    require('v8').startupSnapshot.setDeserializeMainFunction(() => {
        try {
            ${this.formatEnvVars()}
        } catch (e) {}
        function ${this._entrypointParameters.toString()}
        require('${handlerPath}')['${handlerExportName}'](..._entrypointParameters());
    })
    `;
    // const entryCode = `
    //     // Auto-generated entry file
    //     require(${JSON.stringify(this.callerFile)});
    //     // Execute the actor function captured from the original context.
    //     global.__actorFn();
    // `;
    console.log(entryCode);
    const { errors, warnings } = await esbuild.build({
      stdin: {
        contents: entryCode,
        resolveDir: path.dirname(handlerPath),
        sourcefile: 'index.js',
      },
      outfile: path.join(buildDir, 'esbundle.js'),
      bundle: true,
      platform: 'node',
      minify: true,
      keepNames: true,
      sourcemap: 'inline',
      target: `node${this.get('nodeVersion')}`,
      logLevel: 'silent',
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

  /**
   * @param {string} buildDir -
   * @param {string} nodeBinaryPath -
   */
  async seaBuild(buildDir, nodeBinaryPath) {
    const seaConfigPath = path.join(buildDir, 'sea-config.json');
    const blobPath = path.join(buildDir, 'sea.blob');
    const seaConfig = {
      main: path.join(buildDir, 'esbundle.js'),
      output: blobPath,
      disableExperimentalSEAWarning: true,
      useSnapshot: true,
      assets: {},
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
    await postject.inject(nodeBinaryPath, 'NODE_SEA_BLOB', blobData, {
      sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
      machoSegmentName: 'NODE_SEA',
    });
  }

  async _reconcile() {
    if (!fs.existsSync(path.join(paths.data, 'builds'))) {
      await fs.promises.mkdir(path.join(paths.data, 'builds'), {
        recursive: true,
      });
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

SeaBuild.BINARIES_DIR = path.join(paths.data, 'actor_binaries');

SeaBuild.BUILD_DIR = path.join(paths.temp, 'builds');

module.exports = SeaBuild;
