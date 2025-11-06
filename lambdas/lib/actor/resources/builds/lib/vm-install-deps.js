// install-deps.js
'use strict';

// const path = require('node:path');
// const Arborist = require('@npmcli/arborist');
// const importFresh = require('import-fresh');
// const Arborist = importFresh('@npmcli/arborist')
// const { runWithVirtualEnv } = require('./env-virtualizer');
const esbuild = require('../../../../esbuild');
const vm = require('../../../../vm');
// const { family } = require('detect-libc');

/**
 * @typedef {NodeJS.Process["platform"]} TargetPlatform
 * @typedef {NodeJS.Architecture} TargetArch
 * @typedef {import('detect-libc').GLIBC|import('detect-libc').MUSL} TargetLibc
 */
/**
 * @typedef BuildTarget
 * @property {string} nodeVersion -
 * @property {TargetPlatform} platform -
 * @property {TargetArch} architecture -
 * @property {TargetLibc} [libc] -
 */
/**
 * @typedef ExternalDep
 * @property {string} name -
 * @property {string} version -
 */

/**
 * Install dependencies for a specific build target.
 * - If target equals host, install normally.
 * - Otherwise, install in "prebuilds-only" mode and emit a custom error if a source build is attempted.
 *
 * @param {Object} opts
 * @param {BuildTarget} opts.buildTarget
 * @param {ExternalDep[]} opts.externals
 * @param {string} opts.tmpBuildDir
 * @returns {Promise<void>}
 */
async function installForTarget(opts) {
  const { buildTarget, externals, tmpBuildDir } = opts;
  if (externals.length === 0) return;
  const host = { platform: process.platform, architecture: process.arch };
  try {
    const externalsDepArray = JSON.stringify(
      externals.map((x) => `${x.name}@${x.version}`)
    );
    console.log('INSTALLING, ', externalsDepArray);
    const installTemplateString = `
  (async () => {
    const Arborist = require('@npmcli/arborist');
    const pacote = require('pacote');
    const path = require('node:path');
    const fs = require('node:fs');

    // Clean state (important if you reuse tmpBuildDir)
    try { fs.rmSync(path.join('${tmpBuildDir}', 'node_modules'), { recursive: true, force: true }); } catch {}
    try { fs.rmSync(path.join('${tmpBuildDir}', 'package-lock.json'), { force: true }); } catch {}
    await fs.promises.writeFile(
      path.join('${tmpBuildDir}', 'package.json'),
      JSON.stringify({ name: 'install-sandbox', private: true }, null, 2)
    );

    // Project-scoped .npmrc so @npmcli/config → Arborist sees the target triplet.
    // Write BOTH legacy (platform/arch) and modern (os/cpu) keys.
    const npmrcLines = [
      'platform=${buildTarget.platform}',
      'arch=${buildTarget.architecture}',
      'os=${buildTarget.platform}',
      'cpu=${buildTarget.architecture}',
      ${
        buildTarget.platform === 'linux' && buildTarget.libc
          ? `'libc=${buildTarget.libc}',`
          : ''
      }

      // sharp’s prebuilts are optional deps; do not omit them
      'optional=true',
      'omit=',
      // make sure scripts run (sharp uses postinstall)
      'ignore-scripts=false'
    ];
    await fs.promises.writeFile(path.join('${tmpBuildDir}', '.npmrc'), npmrcLines.join('\\n'));

    // npmConfig shim (Arborist calls npmConfig.get)
    let npmConfig = {
      get: (key) => {
        switch (key) {
          case 'platform': return '${buildTarget.platform}';
          case 'arch':     return '${buildTarget.architecture}';
          case 'os':       return '${buildTarget.platform}';
          case 'cpu':      return '${buildTarget.architecture}';
          case 'libc':     return ${
            buildTarget.platform === 'linux' && buildTarget.libc
              ? `'${buildTarget.libc}'`
              : 'undefined'
          };
          case 'optional': return true;
          case 'omit':     return [];              // explicitly: don’t omit optional
          case 'ignore-scripts': return false;
          case 'audit': return false;
          case 'fund':  return false;
          default: return undefined;
        }
      }
    };

    const arb = new Arborist({ path: '${tmpBuildDir}', npmConfig });

    await arb.buildIdealTree({
      add: ${externalsDepArray},     // e.g. ["sharp@0.34.4"]
      saveType: 'prod',
      // fresh resolve; don’t obey stale lockfiles
      update: { all: true },
      npmConfig
    });

    await arb.reify({
      save: true,
      ignoreScripts: false,
      npmConfig
    });

    console.log('installed ${externalsDepArray} in ${tmpBuildDir}');

    // Sanity: what optionals does sharp advertise for this triplet?
    npmConfig = { get: (k) => (
      k === 'platform' ? '${buildTarget.platform}' :
      k === 'arch'     ? '${buildTarget.architecture}' :
      k === 'os'       ? '${buildTarget.platform}' :
      k === 'cpu'      ? '${buildTarget.architecture}' :
      k === 'libc'     ? ${
        buildTarget.platform === 'linux' && buildTarget.libc
          ? `'${buildTarget.libc}'`
          : 'undefined'
      } :
      k === 'optional' ? true :
      undefined
    )};
    const mani = await pacote.manifest('sharp@0.34.4', { npmConfig });
    console.log('optionalDependencies:', mani.optionalDependencies || {});

    // Post-install: enforce that the expected prebuilt actually exists
    const prebuiltName = (() => {
      if ('${buildTarget.platform}' === 'linux') {
        return ${
          buildTarget.libc === 'musl'
            ? `'@img/sharp-linuxmusl-${buildTarget.architecture}'`
            : `'@img/sharp-linux-${buildTarget.architecture}'`
        };
      }
      if ('${buildTarget.platform}' === 'darwin') {
        return '@img/sharp-darwin-${buildTarget.architecture}';
      }
      if ('${buildTarget.platform}' === 'win32') {
        return '@img/sharp-win32-${buildTarget.architecture}';
      }
      return null;
    })();

    if (prebuiltName) {
      const prebuiltDir = path.join('${tmpBuildDir}', 'node_modules', prebuiltName);
      if (!fs.existsSync(prebuiltDir)) {
        throw new Error('Expected prebuilt not found: ' + prebuiltDir);
      }
      const libvipsName = prebuiltName.replace('@img/sharp-', '@img/sharp-libvips-');
      const libvipsDir = path.join('${tmpBuildDir}', 'node_modules', libvipsName);
      if (!fs.existsSync(libvipsDir)) {
        throw new Error('Expected libvips prebuilt not found: ' + libvipsDir);
      }
      console.log('OK: found prebuilts:', prebuiltName, 'and', libvipsName);
    }
  })();
`;
    const buildResult = await esbuild.build({
      stdin: {
        contents: installTemplateString,
        resolveDir: process.cwd(),
        sourcefile: 'index.js',
        loader: 'js',
      },
      bundle: true,
      minify: false,
      keepNames: true,
      sourcemap: 'inline',
      platform: 'node',
      write: false,
      target: 'node24',
      external: ['node-gyp/bin/node-gyp.js'],
    });
    if (!buildResult.outputFiles || buildResult.outputFiles.length === 0) {
      throw new Error('unable to build dependency install script');
    }
    const installScriptString = buildResult.outputFiles[0].text;
    const nodeGypBin = require.resolve('node-gyp/bin/node-gyp.js');
    const env = {
      npm_config_os: buildTarget.platform,
      npm_config_cpu: buildTarget.architecture,
      ...(buildTarget.platform === 'linux' && buildTarget.libc
        ? { npm_config_libc: buildTarget.libc }
        : {}),
      npm_config_include: 'optional',
      npm_config_optional: 'true',
      npm_config_ignore_optional: 'false',
      npm_config_omit: '',
      npm_config_ignore_scripts: 'false',
    };
    await vm.runInSandbox('dep-installs', installScriptString, [], {
      env,
      arch: buildTarget.architecture,
      platform: buildTarget.platform,
      version: buildTarget.nodeVersion,
      links: ['node-gyp'],
    });
    console.log('install done');
  } catch (err) {
    throw err;
    const targetTag = [
      buildTarget.platform,
      buildTarget.architecture,
      buildTarget.platform === 'linux' && buildTarget.libc
        ? buildTarget.libc
        : null,
    ]
      .filter(Boolean)
      .join('-');

    const hostTag = [
      host.platform,
      host.architecture,
      host.platform === 'linux' && process.env.npm_config_libc
        ? process.env.npm_config_libc
        : null,
    ]
      .filter(Boolean)
      .join('-');

    const msg =
      'Cross-target install blocked: a package attempted to build a native addon ' +
      `(node-gyp/prebuild fallback) while running in prebuilds-only mode.\n\n` +
      `Target: ${targetTag}\n` +
      `Host:   ${hostTag}\n\n` +
      `We only allow fetching prebuilts for cross-target installs. ` +
      `Ensure the dependency publishes prebuilts for this target or run the install on a native runner for that platform.\n` +
      `Original error: ${stringifyError(err)}`;

    const e = new Error(msg);
    if (err && typeof err === 'object' && 'stack' in err && err.stack) {
      e.stack = `${e.stack}\nCaused by:\n${err.stack}`;
    }
    throw e;
  }
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function stringifyError(err) {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  if (
    typeof err === 'object' &&
    'message' in err &&
    typeof err.message === 'string'
  )
    return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

module.exports = {
  installForTarget,
};
