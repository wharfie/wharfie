// install-deps.js
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const cp = require('node:child_process');
const { family } = require('detect-libc');

/**
 * @typedef {NodeJS.Process["platform"]} TargetPlatform
 * @typedef {NodeJS.Architecture} TargetArch
 * @typedef {import('detect-libc').GLIBC|import('detect-libc').MUSL} TargetLibc
 */
/**
 * @typedef BuildTarget
 * @property {string} nodeVersion
 * @property {TargetPlatform} platform
 * @property {TargetArch} architecture
 * @property {TargetLibc} [libc]
 */
/**
 * @typedef ExternalDep
 * @property {string} name
 * @property {string} version
 */

// ---- helpers ---------------------------------------------------------------

/** @param {string[]} args @param {NodeJS.ProcessEnv} env */
function execLocalNpm(args, env) {
  return new Promise((resolve, reject) => {
    const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = cp.spawn(npmBin, args, {
      stdio: 'inherit',
      env,
      cwd: env.__TMP_BUILD_DIR || process.cwd(),
      shell: false,
    });
    child.on('exit', (code) => {
      if (code === 0) return resolve({});
      reject(new Error(`npm ${args.join(' ')} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

/**
 * run a shell command and capture exit code
 * @param {string} cmd
 * @param {any[] | readonly string[]} args
 */
function execCmd(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = cp.spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('exit', (code) =>
      code === 0
        ? resolve({})
        : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))
    );
    p.on('error', reject);
  });
}

/** @param {unknown} err */
function stringifyError(err) {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err && 'message' in err)
    return /** @type {any} */ (err).message || String(err);
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Ensure tmp root is clean and ready
 * @param {string} tmpBuildDir
 */
async function prepareTmpRoot(tmpBuildDir) {
  await fs.promises.mkdir(tmpBuildDir, { recursive: true });
  await fs.promises.rm(path.join(tmpBuildDir, 'package-lock.json'), {
    force: true,
  });
  await fs.promises.rm(path.join(tmpBuildDir, 'npm-shrinkwrap.json'), {
    force: true,
  });
  await fs.promises.rm(path.join(tmpBuildDir, 'node_modules'), {
    recursive: true,
    force: true,
  });

  const pkgJsonPath = path.join(tmpBuildDir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) {
    await fs.promises.writeFile(
      pkgJsonPath,
      JSON.stringify(
        {
          name: 'tmp-prebuild-installer',
          private: true,
          version: '0.0.0',
        },
        null,
        2
      )
    );
  }
}

/** pick docker image & platform string for linux targets */
function selectDockerTarget(nodeMajor, arch, libc) {
  /** @type {('amd64'|'arm64')} */
  const platArch = arch === 'arm64' ? 'arm64' : 'amd64';
  const platform = `linux/${platArch}`;
  const base =
    libc === 'musl' ? `${nodeMajor}-alpine` : `${nodeMajor}-bullseye`;
  const image = `node:${base}`;
  const shell = libc === 'musl' ? 'sh' : 'bash';
  return { image, platform, shell };
}

/** quick presence check for docker */
async function ensureDocker() {
  try {
    await execCmd('docker', ['version', '--format', '{{.Server.Version}}'], {
      stdio: 'ignore',
    });
  } catch {
    throw new Error(
      'Docker is required for cross-platform installs but was not found. ' +
        'Install Docker Desktop or run this on a host matching the target.'
    );
  }
}

// ---- main ------------------------------------------------------------------

/**
 * Install dependencies for a specific build target using Docker for cross installs.
 *
 * @param {{ buildTarget: BuildTarget, externals: ExternalDep[], tmpBuildDir: string }} opts
 */
async function installForTarget(opts) {
  const { buildTarget, externals, tmpBuildDir } = opts;

  const host = { platform: process.platform, architecture: process.arch };
  const hostLibc = await family(); // 'glibc' | 'musl' | null
  const samePlatform = host.platform === buildTarget.platform;
  const sameArch = host.architecture === buildTarget.architecture;
  const sameLibc =
    (host.platform === 'linux' ? hostLibc || null : null) ===
    (buildTarget.platform === 'linux' ? buildTarget.libc || null : null);

  await prepareTmpRoot(tmpBuildDir);

  const specs = externals.map((x) => `${x.name}@${x.version}`);
  if (specs.length === 0) return;

  const cacheDir = path.join(tmpBuildDir, '.npm-cache');
  await fs.promises.mkdir(cacheDir, { recursive: true });

  // common npm flags: scripts ON so prebuilt download hooks and node-gyp run
  const baseFlags = [
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    `--cache=${cacheDir}`,
    `--prefix=/work`, // inside container we use /work; for local we’ll override cwd via env
  ];

  // allow source builds; prefer prebuilts if available
  const baseEnv = {
    ...process.env,
    __TMP_BUILD_DIR: tmpBuildDir, // used for local cwd
    npm_config_cache: cacheDir,
    npm_config_prefer_binary: 'true',
    npm_config_prebuild_download: 'true',
    npm_config_build_from_source: 'true',
    npm_config_fallback_to_build: 'true',
  };

  // Fast path: native install on host
  if (samePlatform && sameArch && sameLibc) {
    await execLocalNpm(
      [
        'install',
        '--no-save',
        ...baseFlags.map((f) => f.replace('/work', tmpBuildDir)),
        ...specs,
      ],
      baseEnv
    );
    return;
  }

  // Cross: only Linux targets are supported via Docker from a single host
  if (buildTarget.platform !== 'linux') {
    throw new Error(
      `Cross install for non-Linux targets is not supported via Docker (requested ${buildTarget.platform}). ` +
        `Run this on a native ${buildTarget.platform} host or CI runner.`
    );
  }

  // Guard: docker present
  await ensureDocker();

  // Pick Node image & docker platform
  const nodeMajor = (buildTarget.nodeVersion || process.versions.node).split(
    '.'
  )[0];
  const { image, platform, shell } = selectDockerTarget(
    nodeMajor,
    buildTarget.architecture,
    buildTarget.libc || 'glibc'
  );

  // Build the container command
  const pkgJsonExists = fs.existsSync(path.join(tmpBuildDir, 'package.json'));
  const initPkg = pkgJsonExists ? '' : 'npm init -y >/dev/null 2>&1 || true';

  // Install a toolchain in the container so source builds can succeed.
  const toolchainCmd =
    (buildTarget.libc || 'glibc') === 'musl'
      ? 'apk add --no-cache make g++ python3 pkgconfig'
      : 'apt-get update && apt-get install -y --no-install-recommends build-essential python3 pkg-config';

  // Compose steps safely (no stray ";;")
  const innerSteps = [
    'set -e',
    initPkg,
    'mkdir -p /work/.npm-cache',
    toolchainCmd,
    `npm install --no-save ${baseFlags.join(' ')} ${specs
      .map((s) => JSON.stringify(s))
      .join(' ')}`,
  ].filter(Boolean);

  // Use && so any failure aborts
  const innerCmd = innerSteps.join(' && ');

  const dockerArgs = [
    'run',
    '--rm',
    '--platform',
    platform,
    '-v',
    `${tmpBuildDir}:/work`,
    '-w',
    '/work',
    // pass through npm config to allow builds inside container
    '-e',
    'npm_config_prefer_binary=true',
    '-e',
    'npm_config_prebuild_download=true',
    '-e',
    'npm_config_build_from_source=true',
    '-e',
    'npm_config_fallback_to_build=true',
    '-e',
    'PYTHON=python3',
    '-e',
    'npm_config_python=python3',
    image,
    shell,
    '-lc',
    innerCmd,
  ];

  // Helpful logs
  console.error('[x-deps] docker image:', image);
  console.error('[x-deps] docker platform:', platform);
  console.error('[x-deps] npm specs:', specs.join(', '));

  try {
    await execCmd('docker', dockerArgs);
  } catch (err) {
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
      host.platform === 'linux' && hostLibc ? hostLibc : null,
    ]
      .filter(Boolean)
      .join('-');

    const msg =
      'Cross-target install failed inside Docker. Either no prebuilt exists and the source build failed, or the dependency’s build step errored.\n\n' +
      `Target: ${targetTag}\n` +
      `Host:   ${hostTag}\n` +
      `Docker: image=${image} platform=${platform}\n` +
      `Original error: ${stringifyError(err)}`;

    const e = new Error(msg);
    if (err && typeof err === 'object' && /** @type {any} */ (err).stack) {
      e.stack = `${e.stack}\nCaused by:\n${/** @type {any} */ (err).stack}`;
    }
    throw e;
  }
}

module.exports = {
  installForTarget,
};
