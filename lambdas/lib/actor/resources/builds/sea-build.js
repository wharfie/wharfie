import { v4 } from 'uuid';
import { join } from 'node:path';
import { promises, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { build as _build } from '../../../esbuild.js';
import paths from '../../../paths.js';
import { runCmd, execFile } from '../../../cmd.js';
// @ts-ignore
import { inject } from 'postject';
import BaseResource from '../base-resource.js';

/**
 * @typedef {import('node:process')['platform']} TargetPlatform -
 * @typedef {import('node:process')['arch']} TargetArch -
 * @typedef {import('detect-libc').GLIBC|import('detect-libc').MUSL} TargetLibc
 */

/**
 * @typedef SeaBuildProperties
 * @property {string | function(): string} entryCode -
 * @property {string | function(): string} resolveDir -
 * @property {string | function(): string} nodeBinaryPath -
 * @property {string | function(): string} nodeVersion -
 * @property {TargetPlatform | function(): TargetPlatform} platform -
 * @property {TargetArch | function(): TargetArch} architecture -
 * @property {TargetLibc | function(): TargetLibc} [libc] -
 * @property {Object<string,string> | function(): Object<string,string>} [environmentVariables] -
 * @property {Object<string,string> | function(): Object<string,string>} [assets] -
 */

/**
 * @typedef SeaBuildOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable.js').default.Status} [status] -
 * @property {import('../reconcilable.js').default[]} [dependsOn] -
 * @property {SeaBuildProperties & import('../../typedefs.js').SharedProperties} properties -
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

  async build() {
    const distFile = `${this.name}`;
    const finalName =
      this.get('platform') === 'win32' ? `${distFile}.exe` : distFile;
    const binaryPath = join(SeaBuild.BINARIES_DIR, finalName);
    const tmpBuildDir = join(SeaBuild.BUILD_DIR, `build-${v4()}`);
    await promises.mkdir(tmpBuildDir, { recursive: true });
    await this.esbuild(tmpBuildDir);
    await this.prepareExternalBinaries();
    const tempNodeBinaryPath = join(tmpBuildDir, 'node-binary');
    await promises.copyFile(
      await this.get('nodeBinaryPath'),
      tempNodeBinaryPath
    );
    await this.seaBuild(tmpBuildDir, tempNodeBinaryPath);
    if (!existsSync(SeaBuild.BINARIES_DIR)) {
      await promises.mkdir(SeaBuild.BINARIES_DIR, { recursive: true });
    }
    await promises.copyFile(tempNodeBinaryPath, binaryPath);
    this._setUNSAFE('binaryPath', binaryPath);
  }

  async prepareExternalBinaries() {}

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
    const outputPath = join(buildDir, 'esbundle.js');
    const { errors, warnings } = await _build({
      stdin: {
        contents: this.get('entryCode'),
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
      target: `node${this.get('nodeVersion')}`,
      logLevel: 'silent',
      external: [
        'esbuild',
        'node-gyp/bin/node-gyp.js',
        'lmdb',
        '@duckdb/node-api',
      ],
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
    this.set('codeBundlePath', outputPath);
  }

  /**
   * @param {string} buildDir -
   * @param {string} nodeBinaryPath -
   */
  async seaBuild(buildDir, nodeBinaryPath) {
    const seaConfigPath = join(buildDir, 'sea-config.json');
    const blobPath = join(buildDir, 'sea.blob');
    const seaConfig = {
      main: join(buildDir, 'esbundle.js'),
      output: blobPath,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
      assets: this.get('assets', {}),
    };

    writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2), 'utf8');
    await execFile(
      process.execPath,
      ['--no-warnings', '--experimental-sea-config', seaConfigPath],
      {},
      true
    );
    if (this.get('platform') === 'darwin') {
      await runCmd('codesign', ['--remove-signature', nodeBinaryPath]);
    }
    const blobData = readFileSync(blobPath);
    // base64 encoded fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
    // see https://github.com/nodejs/postject/issues/92#issuecomment-2283508514
    await inject(nodeBinaryPath, 'NODE_SEA_BLOB', blobData, {
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
    if (!existsSync(join(paths.data, 'builds'))) {
      await promises.mkdir(join(paths.data, 'builds'), {
        recursive: true,
      });
    }
    const hostVersion = process.version.slice(1);
    const targetVersion = this.get('nodeVersion');
    if (
      Number(hostVersion.split('.')[0]) < Number(targetVersion.split('.')[0])
    ) {
      throw new Error(
        `Cannot build target (${this.name}) with node version (${targetVersion}) when using ${hostVersion}. Upgrade to at least ${targetVersion}`
      );
    }

    await this.build();
    console.log(this.get('binaryPath'));
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
