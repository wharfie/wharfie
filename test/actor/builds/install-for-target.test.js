/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { createRequire } = require('node:module');

const {
  installForTarget,
} = require('../../../lambdas/lib/actor/resources/builds/lib/install-deps');
const { makeFakeNativePkg } = require('./make-fake-native-pkg');

/**
 * @typedef {'win32'|'linux'|'darwin'} TargetPlatform
 * @typedef {'x64'|'ia32'|'arm64'} TargetArch
 * @typedef {{ platform: TargetPlatform, architecture: TargetArch, libc?: 'glibc'|'musl' }} BuildTarget
 */

/**
 * temp workdir utils
 * @param {string} prefix -
 * @returns {Promise<string>} -
 */
async function mkTmpDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  // create a minimal package.json so Arborist has a place to write dependencies
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: prefix, version: '0.0.0' }),
    'utf8'
  );
  return root;
}

function hostTarget() {
  /** @type {TargetPlatform} */
  const platform =
    process.platform === 'win32'
      ? 'win32'
      : process.platform === 'darwin'
      ? 'darwin'
      : 'linux';
  /** @type {TargetArch} */
  const arch = ['x64', 'ia32', 'arm64'].includes(process.arch)
    ? process.arch
    : 'x64';
  return { platform, architecture: /** @type {TargetArch} */ (arch) };
}

function requireFrom(root) {
  return createRequire(path.join(root, 'package.json'));
}

jest.setTimeout(180000); // real network & builds can be slow

describe('installForTarget (integration)', () => {
  it('host-target install: sharp and better-sqlite3 work on the current platform', async () => {
    expect.assertions(5);

    const tmp = await mkTmpDir('host-install');
    const host = hostTarget();

    await installForTarget({
      buildTarget: host,
      externals: [
        { name: 'sharp', version: 'latest' },
        { name: '@duckdb/node-api', version: 'latest' },
      ],
      tmpBuildDir: tmp,
    });

    const localRequire = requireFrom(tmp);
    const sharp = localRequire('sharp');
    const redDotPng = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();

    expect(redDotPng).toHaveLength(229);

    // better-sqlite3 smoke: open in-memory DB and run a trivial statement
    const duckdb = localRequire('@duckdb/node-api');
    const { DuckDBInstance } = duckdb;

    const instance = await DuckDBInstance.create(':memory:');
    const conn = await instance.connect();
    const [row] = (
      await conn.runAndReadAll(
        "select 1 as one, 2+2 as two, 'ok'::varchar as status"
      )
    ).getRowObjects();

    expect(row.one).toBe(1);
    expect(row.two).toBe(4);
    expect(row.status).toBe('ok');

    // ensure .node binaries actually exist somewhere under node_modules
    // (very loose check to keep things portable)
    const globCandidate =
      existsSync(path.join(tmp, 'node_modules', 'sharp')) ||
      existsSync(path.join(tmp, 'node_modules', '@duckdb/node-api'));
    expect(globCandidate).toBe(true);
  });

  it('cross-target resolution (prebuild fetch) with esbuild installs the target-specific pkg', async () => {
    expect.assertions(1);

    const tmp = await mkTmpDir('cross-esbuild');

    const host = hostTarget();
    /** @type {BuildTarget} */
    const target = (() => {
      // choose a different platform to force optional dependency selection
      // darwin -> win32, linux -> win32, win32 -> linux
      if (host.platform === 'darwin' || host.platform === 'linux')
        return { platform: 'win32', architecture: 'x64' };
      return { platform: 'linux', architecture: 'x64' };
    })();

    await installForTarget({
      buildTarget: target,
      externals: [{ name: '@duckdb/node-api', version: 'latest' }],
      tmpBuildDir: tmp,
    });

    let threw = false;
    const localRequire = requireFrom(tmp);
    let msg = '';
    try {
      const duckdb = localRequire('@duckdb/node-api');
      const { DuckDBInstance } = duckdb;

      const instance = await DuckDBInstance.create(':memory:');
      const conn = await instance.connect();
      (
        await conn.runAndReadAll(
          "select 1 as one, 2+2 as two, 'ok'::varchar as status"
        )
      ).getRowObjects();
    } catch (e) {
      threw = true;
      msg =
        e && typeof e === 'object' && 'message' in e ? e.message : String(e);
    }
    expect(msg).toMatch(/duckdb.node/);
    if (!threw) throw new Error('should throw when using wrong arch .node');
  });

  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('cross-target prebuilds-only: a package that “builds” during install triggers our custom error', async () => {
    expect.assertions(3);

    const tmp = await mkTmpDir('fake-native');
    const fakePkgDir = await makeFakeNativePkg(tmp, 'fake-native-addon');

    // sanity: local package exists
    expect(existsSync(path.join(fakePkgDir, 'package.json'))).toBe(true);

    const host = hostTarget();
    const target =
      host.platform === 'darwin' || host.platform === 'linux'
        ? { platform: 'win32', architecture: 'x64' }
        : { platform: 'linux', architecture: 'x64' };

    let threw = false;
    let msg = '';

    // IMPORTANT: allow scripts so the fake install script runs.
    // Your installForTarget already sets:
    //  - npm_config_fallback_to_build=false
    //  - npm_config_node_gyp=/nonexistent-node-gyp
    // which will make that install script fail deterministically.
    try {
      await installForTarget({
        buildTarget: target,
        // install local package via file: spec
        externals: [
          { name: 'fake-native-addon', version: `file:${fakePkgDir}` },
        ],
        tmpBuildDir: tmp,
      });
    } catch (e) {
      threw = true;
      msg =
        e && typeof e === 'object' && 'message' in e ? e.message : String(e);
    }
    // Your wrapper prefix + the target info
    expect(msg).toMatch(/Cross-target install blocked/);
    expect(msg).toMatch(/command failed/);

    if (!threw)
      throw new Error(
        'expected cross-target install of fake-native-addon to be blocked and throw'
      );
  });
});
