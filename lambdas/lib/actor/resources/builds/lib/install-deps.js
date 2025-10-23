// install-deps.js
'use strict';

const path = require('node:path');
// const Arborist = require('@npmcli/arborist');
const importFresh = require('import-fresh');
// const Arborist = importFresh('@npmcli/arborist')
const { runWithVirtualEnv } = require('./env-virtualizer');
const { family, GLIBC, MUSL } = require('detect-libc');

/**
 * @typedef {NodeJS.Process["platform"]} TargetPlatform
 * @typedef {NodeJS.Architecture} TargetArch
 * @typedef {GLIBC|MUSL} TargetLibc
 * @typedef {{ platform: TargetPlatform, architecture: TargetArch, libc?: TargetLibc }} BuildTarget
 * @typedef {{ name: string, version: string }} ExternalDep
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

  const host = { platform: process.platform, architecture: process.arch };
  const samePlatform = host.platform === buildTarget.platform;
  const sameArch = host.architecture === buildTarget.architecture;
  // family returns null for non linux, need to force unset buildtarget.libc to null for strict equality
  const sameLibc = (await family()) === (buildTarget.libc || null);

  if (samePlatform && sameArch && sameLibc) {
    // Fast path: host matches target → run as-is.
    await runWithVirtualEnv({}, async () => {
      const FreshArborist = importFresh('@npmcli/arborist');
      const arb = new FreshArborist({ path: tmpBuildDir });
      await arb.buildIdealTree({
        add: externals.map((x) => `${x.name}@${x.version}`),
        saveType: 'prod',
      });
      await arb.reify({ save: true });
    });
    return;
  }

  // Cross-target path: virtualize npm_config_* and block source builds.
  const overrides = {
    npm_config_prebuild_download: 'true',
    npm_config_build_from_source: 'false',
    npm_config_fallback_to_build: 'false', // honored by node-pre-gyp (no “download failed → build”)

    npm_config_platform: buildTarget.platform,
    npm_config_arch: buildTarget.architecture,
    npm_config_os: buildTarget.platform, // win32 | linux | darwin
    npm_config_cpu: buildTarget.architecture, // x64 | arm64 | ia32
    ...(buildTarget.platform === 'linux' && buildTarget.libc
      ? { npm_config_libc: buildTarget.libc }
      : {}),
    // Guardrails to prevent building from source:

    npm_config_node_gyp: path.resolve('/nonexistent-node-gyp'), // make raw node-gyp fail immediately
    // npm_config_ignore_scripts: 'false',

    // optional hardening
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    // npm_config_foreground_scripts: 'true', // stream lifecycle output
    // npm_config_loglevel: 'silly',
  };

  try {
    await runWithVirtualEnv(overrides, async () => {
      const FreshArborist = importFresh('@npmcli/arborist');
      const arb = new FreshArborist({ path: tmpBuildDir });
      await arb.buildIdealTree({
        add: externals.map((x) => `${x.name}@${x.version}`),
        saveType: 'prod',
      });
      await arb.reify({ save: true });
    });
  } catch (err) {
    // Wrap with a precise, developer-facing message.
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
    // Preserve original stack for debugging if present.
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
