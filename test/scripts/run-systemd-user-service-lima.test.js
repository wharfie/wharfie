/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const imageBytes = 'offline systemd-driver test image\n';
const imageDigest = createHash('sha256').update(imageBytes).digest('hex');
/** @type {string[]} */
const ownedRoots = [];

function gitEnvironment() {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith('GIT_')) delete environment[key];
  }
  return {
    ...environment,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_OPTIONAL_LOCKS: '0',
  };
}

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Wharfie offline driver test',
      '-c',
      'user.email=driver-test@wharfie.invalid',
      '-c',
      'commit.gpgSign=false',
      '-c',
      'core.hooksPath=/dev/null',
      ...args,
    ],
    {
      cwd,
      env: gitEnvironment(),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  ).trim();
}

/** @param {string} file @param {string} contents */
function writeExecutable(file, contents) {
  fs.writeFileSync(file, `#!${process.execPath}\n${contents}`, { mode: 0o755 });
}

/**
 * Every command called by the driver is an offline fixture except Git/Node and
 * ordinary local filesystem utilities. The real limactl/curl are never used.
 * The stub embeds its task paths because the real driver's env -i must remove
 * arbitrary test overrides, just as it removes inherited Lima/credential vars.
 * @param {{failure?: string, credential?: boolean}} [options]
 */
function fixture(options = {}) {
  const parent =
    process.platform === 'darwin'
      ? '/private/tmp'
      : fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, 'wsd-'));
  ownedRoots.push(root);
  const source = path.join(root, 'repo');
  const bin = path.join(root, 'bin');
  const temp = path.join(root, 'tmp');
  const receipts = path.join(root, 'receipts');
  const callsFile = path.join(root, 'calls.jsonl');
  const guestAgent = path.join(root, 'guestagent.gz');
  for (const directory of [
    source,
    bin,
    temp,
    path.join(source, 'scripts'),
    path.join(source, 'test'),
    path.join(source, 'test', 'systemd'),
  ])
    fs.mkdirSync(directory);
  fs.writeFileSync(guestAgent, 'offline installed guest agent fixture');
  fs.writeFileSync(path.join(source, 'package.json'), '{"type":"module"}\n');
  fs.writeFileSync(
    path.join(source, '.gitignore'),
    'llm_artifacts/\nnode_modules/\nignored/\n',
  );
  fs.writeFileSync(
    path.join(source, 'source.js'),
    'export const source = 1;\n',
  );
  for (const name of [
    'run-systemd-user-service-lima.sh',
    'systemd-proof-host.js',
  ])
    fs.copyFileSync(
      path.join(repoRoot, 'scripts', name),
      path.join(source, 'scripts', name),
    );
  const config = fs
    .readFileSync(path.join(repoRoot, 'test', 'systemd', 'lima.yaml'), 'utf8')
    .replace(/sha256:[a-f0-9]{64}/g, `sha256:${imageDigest}`);
  fs.writeFileSync(path.join(source, 'test', 'systemd', 'lima.yaml'), config);
  if (options.credential)
    fs.writeFileSync(
      path.join(source, '.npmrc'),
      '//registry.example.invalid/:_authToken=fixture-not-a-real-token\n',
    );
  const setup = JSON.stringify({
    callsFile,
    guestAgent,
    failure: options.failure ?? '',
    imageBytes,
    sourceHelper: path.join(source, 'scripts', 'systemd-proof-host.js'),
  });
  const prelude = `const fs = require('node:fs');\nconst path = require('node:path');\nconst fixture = ${setup};\nconst args = process.argv.slice(2);\nfunction record(program) { fs.appendFileSync(fixture.callsFile, JSON.stringify({program, args, home: process.env.HOME, limaHome: process.env.LIMA_HOME, cache: process.env.XDG_CACHE_HOME, config: process.env.XDG_CONFIG_HOME, tmpdir: process.env.TMPDIR, inheritedLimaInstance: process.env.LIMA_INSTANCE ?? null, inheritedTestSecret: process.env.WHARFIE_TEST_SECRET ?? null, nodeOptions: process.env.NODE_OPTIONS ?? null, nodePath: process.env.NODE_PATH ?? null, httpProxy: process.env.HTTP_PROXY ?? null, httpsProxy: process.env.HTTPS_PROXY ?? null, allProxy: process.env.ALL_PROXY ?? null, curlCaBundle: process.env.CURL_CA_BUNDLE ?? null, sslCertFile: process.env.SSL_CERT_FILE ?? null}) + '\\n'); }\n`;
  writeExecutable(
    path.join(bin, 'uname'),
    "process.stdout.write(process.argv[2] === '-m' ? 'arm64\\n' : 'Darwin\\n');\n",
  );
  if (options.failure === 'publish') {
    writeExecutable(
      path.join(bin, 'node'),
      `
const {spawnSync} = require('node:child_process');
const args = process.argv.slice(2);
if (args[1] === 'publish' && args.at(-1) === 'success') {
  process.stderr.write('offline post-seal publication failure\\n');
  process.exitCode = 8;
} else {
  const result = spawnSync(process.execPath, args, {env: process.env, stdio: 'inherit'});
  process.exitCode = result.status ?? 1;
}
`,
    );
  }
  writeExecutable(
    path.join(bin, 'curl'),
    `${prelude}
record('curl');
fs.writeFileSync(args[args.indexOf('--output') + 1], fixture.failure === 'image-digest' ? 'incorrect image' : fixture.imageBytes);
if (fixture.failure === 'download') { process.stderr.write('offline download failure\\n'); process.exitCode = 7; }
`,
  );
  writeExecutable(
    path.join(bin, 'limactl'),
    `${prelude}
record('limactl');
if (!process.env.LIMA_HOME || !process.env.LIMA_HOME.startsWith(${JSON.stringify(temp + path.sep)})) throw new Error('Non-private Lima invocation');
const statePath = path.join(process.env.LIMA_HOME, 'offline-instance.json');
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null;
switch (args[0]) {
  case 'info':
    process.stdout.write(JSON.stringify({version: '2.1.4', hostOS: 'darwin', hostArch: 'aarch64', limaHome: process.env.LIMA_HOME, guestAgents: {aarch64: {location: fixture.guestAgent}}}));
    break;
  case 'list':
    if (state) process.stdout.write(state.name + '\\n');
    break;
  case 'create': {
    const name = args[args.indexOf('--name') + 1];
    fs.mkdirSync(path.join(process.env.LIMA_HOME, name));
    fs.writeFileSync(path.join(process.env.LIMA_HOME, name, 'owned-disk'), 'offline VM disk');
    fs.writeFileSync(statePath, JSON.stringify({name}));
    if (fixture.failure === 'create') { process.stderr.write('offline partial create failure\\n'); process.exitCode = 4; }
    break;
  }
  case 'start':
  case 'stop':
    if (args[0] === 'start' && fixture.failure === 'checkout-helper') fs.writeFileSync(fixture.sourceHelper, 'throw new Error("Mutable checkout helper must not execute after capture");\\n');
    process.stdout.write('offline ' + args[0] + '\\n');
    break;
  case 'delete':
    if (fixture.failure === 'delete') { process.stderr.write('offline delete failure\\n'); process.exitCode = 5; break; }
    if (state) fs.rmSync(path.join(process.env.LIMA_HOME, state.name), {recursive: true});
    fs.rmSync(statePath, {force: true});
    break;
  case 'copy': {
    const from = args.at(-2);
    const to = args.at(-1);
    if (from.includes(':/')) fs.writeFileSync(to, JSON.stringify({schemaVersion: from.includes('boot-receipt') ? 2 : 4, kind: 'offline-receipt', from}) + '\\n');
    else if (!fs.statSync(from).isFile()) throw new Error('Missing source archive');
    break;
  }
  case 'shell':
    if (args.includes('/usr/bin/test')) { process.exitCode = fixture.failure ? 0 : 1; break; }
    if (args.includes('prepare')) {
      process.stdout.write('offline prepare log\\n');
      if (fixture.failure === 'prepare') { process.stderr.write('offline prepare failure\\n'); process.exitCode = 6; }
    } else if (args.includes('verify')) {
      process.stdout.write('offline verify log\\n');
      if (fixture.failure === 'verify') { process.stderr.write('offline verify failure\\n'); process.exitCode = 6; }
    } else process.stdout.write('offline guest command\\n');
    break;
  default: throw new Error('Unexpected offline Lima command');
}
`,
  );
  git(source, ['init', '--quiet', '--initial-branch=driver-test']);
  git(source, ['add', '--all']);
  git(source, [
    'commit',
    '--quiet',
    '-m',
    'Independent offline driver fixture',
  ]);
  const head = git(source, ['rev-parse', 'HEAD']);

  return {
    root,
    source,
    bin,
    temp,
    receipts,
    head,
    calls: () =>
      fs.existsSync(callsFile)
        ? fs
            .readFileSync(callsFile, 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        : [],
    run: (
      /** @type {string[]} */ args = [],
      /** @type {NodeJS.ProcessEnv} */ overrides = {},
    ) =>
      spawnSync(
        '/bin/bash',
        [
          path.join(source, 'scripts', 'run-systemd-user-service-lima.sh'),
          ...args,
        ],
        {
          cwd: source,
          env: {
            ...process.env,
            PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`,
            WHARFIE_SYSTEMD_PROOF_OUTPUT_DIR: receipts,
            WHARFIE_SYSTEMD_PROOF_TEMP_PARENT: temp,
            WHARFIE_SYSTEMD_PROOF_INSTANCE: 'offline-proof',
            WHARFIE_SYSTEMD_PROOF_KEEP_VM: '0',
            WHARFIE_SYSTEMD_PROOF_SCENARIO: 'lifecycle',
            LIMA_HOME: path.join(root, 'must-not-use-global-lima'),
            LIMA_INSTANCE: 'must-not-inherit',
            WHARFIE_TEST_SECRET: 'fixture-env-must-not-reach-lima',
            ...overrides,
          },
          encoding: 'utf8',
          timeout: 30000,
          maxBuffer: 2 * 1024 * 1024,
        },
      ),
  };
}

/** @param {string} directory @param {string} name @returns {Record<string, any>} */
function json(directory, name) {
  return JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
}

/** @param {string} directory */
function assertChecksums(directory) {
  const lines = fs
    .readFileSync(path.join(directory, 'SHA256SUMS'), 'utf8')
    .trim()
    .split('\n');
  const files = fs
    .readdirSync(directory)
    .filter((name) => name !== 'SHA256SUMS')
    .sort();
  expect(lines.map((line) => line.slice(66)).sort()).toEqual(files);
  for (const line of lines) {
    const contents = fs.readFileSync(path.join(directory, line.slice(66)));
    expect(createHash('sha256').update(contents).digest('hex')).toBe(
      line.slice(0, 64),
    );
  }
}

/** @param {ReturnType<typeof fixture>} test */
function failureReceipt(test) {
  const failures = fs.readdirSync(path.join(test.receipts, 'failures'));
  expect(failures).toHaveLength(1);
  return path.join(test.receipts, 'failures', failures[0]);
}

afterEach(() => {
  for (const root of ownedRoots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe('isolated systemd proof Lima driver (offline command stubs)', () => {
  it('completes a clean committed lifecycle with only private Lima state, local image, and checksummed evidence', () => {
    const test = fixture();
    const indexBefore = fs.readFileSync(
      path.join(test.source, '.git', 'index'),
    );
    const result = test.run();
    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 0,
      stderr: '',
    });
    const receipt = path.join(test.receipts, test.head);
    assertChecksums(receipt);
    const source = json(receipt, 'source-provenance.json');
    expect(source).toMatchObject({
      mode: 'commit',
      commit: test.head,
      originalHead: test.head,
      originalRepositoryWritten: false,
    });
    expect(source.archive.sha256).toBe(
      createHash('sha256')
        .update(fs.readFileSync(path.join(receipt, 'source.tar')))
        .digest('hex'),
    );
    expect(json(receipt, 'cleanup.json')).toMatchObject({
      instanceAbsent: true,
      instanceRetained: false,
      taskRootAbsent: true,
      privateImageCacheAbsent: true,
      homeRepurposed: false,
      exitStatus: 0,
    });
    const calls = test.calls();
    const lima = calls.filter((call) => call.program === 'limactl');
    for (const call of lima) {
      expect(call.home).toBe(process.env.HOME);
      expect(call.limaHome).toMatch(
        new RegExp(`^${test.temp}/wfs\\.[^/]+/lima$`),
      );
      expect(call.cache).toBe(path.join(path.dirname(call.limaHome), 'cache'));
      expect(call.inheritedLimaInstance).toBeNull();
      expect(call.inheritedTestSecret).toBeNull();
      expect(fs.existsSync(path.dirname(call.limaHome))).toBe(false);
    }
    const create = lima.find((call) => call.args[0] === 'create');
    expect(create.args).toEqual(
      expect.arrayContaining([
        '--mount-none',
        '--plain',
        '--containerd',
        'none',
        '--name',
        'offline-proof',
      ]),
    );
    expect(lima.filter((call) => call.args[0] === 'start')).toHaveLength(2);
    expect(lima.filter((call) => call.args[0] === 'stop')).toHaveLength(1);
    expect(lima.filter((call) => call.args[0] === 'delete')).toHaveLength(1);
    const curl = calls.filter((call) => call.program === 'curl');
    expect(curl).toHaveLength(1);
    expect(curl[0]).not.toHaveProperty('home');
    expect(curl[0]).toMatchObject({
      nodeOptions: null,
      nodePath: null,
      httpProxy: null,
      httpsProxy: null,
      allProxy: null,
      curlCaBundle: null,
      sslCertFile: null,
    });
    expect(
      fs.readFileSync(path.join(receipt, 'lima.yaml'), 'utf8'),
    ).not.toMatch(/^ {2}- location: https:/m);
    expect(json(receipt, 'image-provenance.json')).toMatchObject({
      actualDigest: `sha256:${imageDigest}`,
      digestVerified: true,
      remoteFallbacks: 0,
      hostMounts: [],
    });
    expect(fs.readFileSync(path.join(test.source, '.git', 'index'))).toEqual(
      indexBefore,
    );
    expect(git(test.source, ['rev-parse', 'HEAD'])).toBe(test.head);
    expect(fs.readdirSync(test.temp)).toEqual([]);
  });

  it('strips Node startup hooks and proxy or TLS credentials from host proof commands', () => {
    const test = fixture();
    const preloadMarker = path.join(test.root, 'host-helper-preloaded');
    const preload = path.join(test.root, 'startup-hook.cjs');
    fs.writeFileSync(
      preload,
      `if ((process.argv[1] || '').includes('host-helper.mjs')) require('node:fs').writeFileSync(${JSON.stringify(
        preloadMarker,
      )}, 'ambient preload executed');\n`,
    );
    const result = test.run([], {
      NODE_OPTIONS: `--require=${preload}`,
      NODE_PATH: path.join(test.root, 'ambient-node-path'),
      HTTP_PROXY: 'http://proxy-credential.invalid',
      HTTPS_PROXY: 'https://proxy-credential.invalid',
      ALL_PROXY: 'socks5://proxy-credential.invalid',
      CURL_CA_BUNDLE: path.join(test.root, 'ambient-ca.pem'),
      SSL_CERT_FILE: path.join(test.root, 'ambient-cert.pem'),
    });

    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 0,
      stderr: '',
    });
    expect(fs.existsSync(preloadMarker)).toBe(false);
    const curl = test.calls().find((call) => call.program === 'curl');
    expect(curl).toBeDefined();
    expect(curl).not.toHaveProperty('home');
    expect(curl).toMatchObject({
      nodeOptions: null,
      nodePath: null,
      httpProxy: null,
      httpsProxy: null,
      allProxy: null,
      curlCaBundle: null,
      sslCertFile: null,
    });
  });

  it('requires explicit snapshot mode for dirty source and leaves the original index/HEAD/status unchanged', () => {
    const test = fixture({ credential: true });
    fs.writeFileSync(
      path.join(test.source, 'source.js'),
      'export const source = 2;\n',
    );
    fs.writeFileSync(
      path.join(test.source, 'new-source.js'),
      'export const added = true;\n',
    );
    const status = git(test.source, [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
    ]);
    const index = fs.readFileSync(path.join(test.source, '.git', 'index'));
    const refused = test.run();
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('--snapshot');
    expect(test.calls()).toEqual([]);
    const result = test.run(['--snapshot']);
    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 0,
      stderr: '',
    });
    const name = fs.readdirSync(test.receipts)[0];
    expect(name).not.toBe(test.head);
    const receipt = path.join(test.receipts, name);
    const source = json(receipt, 'source-provenance.json');
    expect(source).toMatchObject({
      mode: 'snapshot',
      commit: name,
      snapshotCommit: name,
      originalHead: test.head,
      exclusionScope: 'snapshot-archive',
    });
    expect(
      source.files.map((/** @type {{path: string}} */ entry) => entry.path),
    ).toContain('new-source.js');
    expect(
      source.files.map((/** @type {{path: string}} */ entry) => entry.path),
    ).not.toContain('.npmrc');
    expect(git(test.source, ['rev-parse', 'HEAD'])).toBe(test.head);
    expect(
      git(test.source, ['status', '--porcelain=v1', '--untracked-files=all']),
    ).toBe(status);
    expect(fs.readFileSync(path.join(test.source, '.git', 'index'))).toEqual(
      index,
    );
    assertChecksums(receipt);
  });

  it.each(['existing-receipts', 'concurrent-reservation'])(
    'refuses %s before invoking Lima or downloading',
    (kind) => {
      const test = fixture();
      fs.mkdirSync(test.receipts);
      const existing = path.join(
        test.receipts,
        kind === 'existing-receipts' ? test.head : `.${test.head}.in-progress`,
      );
      fs.mkdirSync(existing);
      fs.writeFileSync(path.join(existing, 'sentinel'), 'must not overwrite');
      const result = test.run();
      expect(result.status).toBe(1);
      expect(test.calls()).toEqual([]);
      expect(fs.readFileSync(path.join(existing, 'sentinel'), 'utf8')).toBe(
        'must not overwrite',
      );
      expect(fs.readdirSync(test.temp)).toEqual([]);
    },
  );

  it('preserves the steady-file prepare/verify scenario without a forced power cycle', () => {
    const test = fixture();
    const result = test.run([], {
      WHARFIE_SYSTEMD_PROOF_SCENARIO: 'steady-file',
    });
    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 0,
      stderr: '',
    });
    const calls = test.calls().filter((call) => call.program === 'limactl');
    const verifiers = calls.filter((call) =>
      call.args.includes('scripts/verify-steady-file-systemd-linux.js'),
    );
    expect(verifiers).toHaveLength(2);
    expect(verifiers[0].args).toContain('prepare');
    expect(verifiers[1].args).toContain('verify');
    expect(calls.filter((call) => call.args[0] === 'start')).toHaveLength(1);
    expect(calls.filter((call) => call.args[0] === 'stop')).toHaveLength(0);
    const receipt = path.join(test.receipts, test.head);
    expect(fs.existsSync(path.join(receipt, 'boot-receipt.json'))).toBe(false);
    expect(json(receipt, 'cleanup.json').kind).toBe(
      'wharfie.steady-file-systemd-proof.host-cleanup',
    );
    assertChecksums(receipt);
  });

  it.each(['download', 'image-digest', 'create', 'prepare', 'verify'])(
    'retains checksummed logs and source while cleaning an offline %s failure',
    (failure) => {
      const test = fixture({ failure });
      const result = test.run();
      expect(result.status).not.toBe(0);
      const receipt = failureReceipt(test);
      assertChecksums(receipt);
      expect(json(receipt, 'cleanup.json')).toMatchObject({
        instanceAbsent: true,
        instanceRetained: false,
        taskRootAbsent: true,
        privateImageCacheAbsent: true,
      });
      expect(fs.readFileSync(path.join(receipt, 'host.log'), 'utf8')).toContain(
        'limactl info',
      );
      expect(fs.existsSync(path.join(receipt, 'source.tar'))).toBe(true);
      expect(fs.existsSync(path.join(test.receipts, test.head))).toBe(false);
      expect(fs.readdirSync(test.temp)).toEqual([]);
      const creates = test
        .calls()
        .filter(
          (call) => call.program === 'limactl' && call.args[0] === 'create',
        );
      expect(creates).toHaveLength(
        failure === 'download' || failure === 'image-digest' ? 0 : 1,
      );
    },
  );

  it('retains the exact private VM storage if deletion cannot be proved', () => {
    const test = fixture({ failure: 'delete' });
    const result = test.run();
    expect(result.status).toBe(1);
    const receipt = failureReceipt(test);
    const cleanup = json(receipt, 'cleanup.json');
    expect(cleanup).toMatchObject({
      instanceAbsent: false,
      instanceRetained: true,
      taskRootAbsent: false,
      privateImageCacheAbsent: false,
      exitStatus: 1,
    });
    expect(
      fs.readFileSync(
        path.join(cleanup.limaHome, 'offline-proof', 'owned-disk'),
        'utf8',
      ),
    ).toBe('offline VM disk');
    expect(result.stderr).toContain(cleanup.limaHome);
    assertChecksums(receipt);
  });

  it('reports deliberate KEEP_VM retention without claiming the private cache was removed', () => {
    const test = fixture();
    const result = test.run([], { WHARFIE_SYSTEMD_PROOF_KEEP_VM: '1' });
    expect(result.status).toBe(0);
    const receipt = path.join(test.receipts, test.head);
    const cleanup = json(receipt, 'cleanup.json');
    expect(cleanup).toMatchObject({
      instanceAbsent: false,
      instanceRetained: true,
      taskRootAbsent: false,
      privateImageCacheAbsent: false,
      exitStatus: 0,
    });
    expect(
      fs.existsSync(path.join(cleanup.limaHome, 'offline-proof', 'owned-disk')),
    ).toBe(true);
    expect(
      test
        .calls()
        .filter(
          (call) => call.program === 'limactl' && call.args[0] === 'delete',
        ),
    ).toHaveLength(0);
    expect(result.stderr).toContain(cleanup.limaHome);
    assertChecksums(receipt);
  });

  it('refuses an overlong socket namespace before any external command', () => {
    const test = fixture();
    const result = test.run([], {
      WHARFIE_SYSTEMD_PROOF_INSTANCE: 'x'.repeat(104),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('socket path is too long');
    expect(test.calls()).toEqual([]);
    expect(fs.readdirSync(test.temp)).toEqual([]);
  });

  it('uses the captured standalone host helper after the checkout helper changes', () => {
    const test = fixture({ failure: 'checkout-helper' });
    const result = test.run();
    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 0,
      stderr: '',
    });
    const receipt = path.join(test.receipts, test.head);
    const provenance = json(receipt, 'source-provenance.json');
    const capturedHelper = provenance.files.find(
      (/** @type {{path: string}} */ entry) =>
        entry.path === 'scripts/systemd-proof-host.js',
    );
    const helperName = fs
      .readdirSync(receipt)
      .find((name) => name.endsWith('.mjs'));
    expect(helperName).toBeDefined();
    if (!helperName) throw new Error('Missing frozen helper in receipt');
    expect(
      createHash('sha256')
        .update(fs.readFileSync(path.join(receipt, helperName)))
        .digest('hex'),
    ).toBe(capturedHelper.sha256);
    expect(
      fs.readFileSync(
        path.join(test.source, 'scripts', 'systemd-proof-host.js'),
        'utf8',
      ),
    ).toContain('Mutable checkout helper');
    assertChecksums(receipt);
  });

  it('preserves valid sealed evidence if success publication fails with a retained VM', () => {
    const test = fixture({ failure: 'publish' });
    const result = test.run([], { WHARFIE_SYSTEMD_PROOF_KEEP_VM: '1' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('offline post-seal publication failure');
    const receipt = failureReceipt(test);
    assertChecksums(receipt);
    const cleanup = json(receipt, 'cleanup.json');
    expect(cleanup).toMatchObject({
      instanceAbsent: false,
      instanceRetained: true,
      taskRootAbsent: false,
    });
    expect(
      fs.existsSync(path.join(cleanup.limaHome, 'offline-proof', 'owned-disk')),
    ).toBe(true);
  });
});
