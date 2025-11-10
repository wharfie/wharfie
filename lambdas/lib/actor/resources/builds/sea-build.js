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
 * @typedef {import('node:process')['platform']} TargetPlatform -
 * @typedef {import('node:process')['arch']} TargetArch -
 * @typedef {import('detect-libc').GLIBC|import('detect-libc').MUSL} TargetLibc
 */

/**
 * @typedef SeaBuildProperties
 * @property {string | function(): string} entryCode -
 * @property {string | function(): string} resolveDir -
 * @property {string | function(): string} callerFile -
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
 * @property {import('../reconcilable').Status} [status] -
 * @property {import('../reconcilable')[]} [dependsOn] -
 * @property {SeaBuildProperties & import('../../typedefs').SharedProperties} properties -
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
    const binaryPath = path.join(SeaBuild.BINARIES_DIR, finalName);
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
    const outputPath = path.join(buildDir, 'esbundle.js');
    const callerFile = path.resolve(this.get('callerFile'));
    const { errors, warnings } = await esbuild.build({
      stdin: {
        contents: this.get('entryCode'),
        resolveDir: this.get('resolveDir'),
        sourcefile: 'index.js',
      },
      outfile: outputPath,
      bundle: true,
      platform: 'node',
      minify: true,
      keepNames: false,
      sourcemap: 'inline',
      target: `node${this.get('nodeVersion')}`,
      logLevel: 'silent',
      external: ['esbuild', 'node-gyp/bin/node-gyp.js'],
      define: {
        __WILLEM_BUILD_RECONCILE_TERMINATOR: '1', // injects this variable definition into the global scope
      },
      // SEA-only: turn the first arg of `new Function(<fn>, ...)` into a noop in the caller file
      plugins: [
        {
          name: 'sea-noop-inline-function-arg',
          setup(build) {
            const acorn = require('acorn');
            const walk = require('acorn-walk');

            build.onLoad({ filter: /.*/ }, async (args) => {
              if (path.resolve(args.path) !== callerFile) return;
              const src = await fs.promises.readFile(args.path, 'utf8');

              // Parse and collect ranges to mutate
              const ast = acorn.parse(src, {
                ecmaVersion: 'latest',
                sourceType: 'script', // CommonJS entrypoint
                allowReturnOutsideFunction: true,
                locations: false,
              });

              /** @type {Array<{start:number,end:number}>} */
              const toReplace = [];
              walk.simple(ast, {
                NewExpression(node) {
                  // Match: new Function(<arg0>, ...)
                  if (
                    node.callee &&
                    node.callee.type === 'Identifier' &&
                    node.callee.name === 'Function'
                  ) {
                    if (node.arguments && node.arguments.length > 0) {
                      const first = node.arguments[0];
                      // Only replace if the first arg is an expression we can safely overwrite (FunctionExpression or ArrowFunctionExpression typical)
                      // In practice we can replace anything (object, identifier, etc.) because we only need a noop.
                      toReplace.push({ start: first.start, end: first.end });
                    }
                  }
                },
              });

              if (toReplace.length === 0) {
                return { contents: src, loader: 'js' };
              }

              // Apply replacements from right to left to keep offsets stable
              let out = src;
              for (const r of toReplace.sort((a, b) => b.start - a.start)) {
                out = out.slice(0, r.start) + '(()=>{})' + out.slice(r.end);
              }
              return { contents: out, loader: 'js' };
            });
          },
        },
      ],
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
    const seaConfigPath = path.join(buildDir, 'sea-config.json');
    const blobPath = path.join(buildDir, 'sea.blob');
    const seaConfig = {
      main: path.join(buildDir, 'esbundle.js'),
      output: blobPath,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
      assets: this.get('assets', {}),
    };

    fs.writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2), 'utf8');
    await execFile(
      process.execPath,
      ['--no-warnings', '--experimental-sea-config', seaConfigPath],
      {},
      true
    );
    if (this.get('platform') === 'darwin') {
      await runCmd('codesign', ['--remove-signature', nodeBinaryPath]);
    }
    const blobData = fs.readFileSync(blobPath);
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
    if (!fs.existsSync(path.join(paths.data, 'builds'))) {
      await fs.promises.mkdir(path.join(paths.data, 'builds'), {
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
    if (!fs.existsSync(this.get('binaryPath'))) {
      return;
    }
    await fs.promises.unlink(this.get('binaryPath'));
  }
}

SeaBuild.BINARIES_DIR = path.join(paths.data, 'actor_binaries');

SeaBuild.BUILD_DIR = path.join(paths.temp, 'builds');

module.exports = SeaBuild;
