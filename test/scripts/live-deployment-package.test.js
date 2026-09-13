import { afterEach, describe, expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  assertLiveDeploymentPackageVersions,
  buildLiveDeploymentCandidate,
  createLiveDeploymentBuildEnvironment,
  LIVE_DEPLOYMENT_APP_ID,
  LIVE_DEPLOYMENT_INPUT_BYTES,
  LIVE_DEPLOYMENT_TIMER_DELAY_MS,
  prepareLiveDeploymentFixture,
  runLiveDeploymentProcess,
  verifyLiveDeploymentPackageOutput,
} from '../../scripts/live-deployment-package.js';
import {
  capture,
  verify,
} from '../../scripts/live-deployment-fixture-activities.js';
import { getBuildTargetId } from '../../src/core/runtime/build-target.js';
import { REPO_ROOT } from '../../scripts/package-verification.js';

/** @type {string[]} */
const directories = [];
const VERSION = '0.0.15';
const NATIVE_TARGET = Object.freeze({
  platform: 'darwin',
  architecture: 'arm64',
  nodeVersion: '24.13.1',
});
const CORE = Object.freeze({
  name: '@wharfie/wharfie',
  version: VERSION,
  peerDependencies: { '@wharfie/aws': VERSION },
});
const AWS = Object.freeze({
  name: '@wharfie/aws',
  version: VERSION,
  peerDependencies: { '@wharfie/wharfie': VERSION },
});

async function temporaryDirectory() {
  const directory = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'wharfie-live-package-test-')),
  );
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function artifactFixture() {
  const outputDir = await temporaryDirectory();
  const bytes = Buffer.from('portable controller fixture');
  const digest = createHash('sha256').update(bytes).digest('base64url');
  const byteDigest = { algorithm: 'sha256', value: digest };
  const fileName = `${LIVE_DEPLOYMENT_APP_ID}-sha256-${Buffer.from(digest, 'base64url').toString('hex')}`;
  const artifactPath = path.join(outputDir, fileName);
  const recordPath = `${artifactPath}.artifact.json`;
  const artifactId = `waf1_${digest}`;
  const revisionId = `wrv1_${digest}`;
  const record = {
    schemaVersion: 1,
    kind: 'artifactRecord',
    appId: LIVE_DEPLOYMENT_APP_ID,
    artifactId,
    revisionId,
    byteDigest,
    size: bytes.length,
    target: NATIVE_TARGET,
    targetId: getBuildTargetId(NATIVE_TARGET),
    format: { kind: 'node-sea', version: 1 },
    provenance: {
      builder: { name: '@wharfie/wharfie', version: VERSION },
      node: { version: NATIVE_TARGET.nodeVersion },
    },
  };
  await writeFile(artifactPath, bytes, { mode: 0o700 });
  await writeFile(recordPath, JSON.stringify(record));
  const receipt = {
    schemaVersion: 1,
    kind: 'wharfie.application.package',
    appId: LIVE_DEPLOYMENT_APP_ID,
    revisionId,
    outputDir,
    artifactCount: 1,
    artifacts: [
      {
        artifactId,
        target: NATIVE_TARGET,
        fileName,
        path: artifactPath,
        recordPath,
        byteDigest,
        size: bytes.length,
      },
    ],
  };
  return {
    artifactPath,
    recordPath,
    record,
    receipt,
    expected: {
      outputDir,
      packageVersion: VERSION,
      nativeTarget: NATIVE_TARGET,
    },
  };
}

describe('live deployment installed-candidate boundary', () => {
  test('requires an external workspace before any build mutation', async () => {
    await expect(
      buildLiveDeploymentCandidate({ workspace: REPO_ROOT, provider: 'aws' }),
    ).rejects.toThrow('outside the checkout');
  });

  test('build environment excludes ambient credentials and injection settings', () => {
    const environment = createLiveDeploymentBuildEnvironment('/private/build');
    for (const key of [
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_PROFILE',
      'HCLOUD_TOKEN',
      'HETZNER_API_TOKEN',
      'NPM_TOKEN',
      'NODE_OPTIONS',
      'NODE_PATH',
      'SSH_AUTH_SOCK',
      'HTTPS_PROXY',
    ]) {
      expect(Object.hasOwn(environment, key)).toBe(false);
    }
    expect(environment.HOME).toBe('/private/build/home');
    expect(environment.TMPDIR).toBe('/private/build/tmp');
    expect(environment.npm_config_userconfig).toBe(
      '/private/build/empty.npmrc',
    );
    expect(environment.npm_config_registry).toBe('https://registry.npmjs.org/');
  });

  test('accepts the exact AWS pair and provider-free Hetzner install', () => {
    expect(() =>
      assertLiveDeploymentPackageVersions(CORE, AWS, 'aws', VERSION),
    ).not.toThrow();
    expect(() =>
      assertLiveDeploymentPackageVersions(CORE, null, 'hetzner', VERSION),
    ).not.toThrow();
  });

  test.each([
    [CORE, null, 'aws'],
    [CORE, { ...AWS, version: '0.0.16' }, 'aws'],
    [CORE, { ...AWS, peerDependencies: {} }, 'aws'],
    [{ ...CORE, version: '0.0.16' }, AWS, 'aws'],
    [{ ...CORE, peerDependencies: {} }, AWS, 'aws'],
    [CORE, AWS, 'hetzner'],
  ])(
    'rejects mismatched or unintended companion %#',
    (core, companion, provider) => {
      expect(() =>
        assertLiveDeploymentPackageVersions(
          /** @type {typeof CORE} */ (core),
          /** @type {typeof AWS|null} */ (companion),
          /** @type {'aws'|'hetzner'} */ (provider),
          VERSION,
        ),
      ).toThrow();
    },
  );
});

describe('live deployment durable installed starter', () => {
  async function prepareFixture(timerDelayMs = LIVE_DEPLOYMENT_TIMER_DELAY_MS) {
    const root = await temporaryDirectory();
    const fixtureDirectory = path.join(root, 'app');
    await prepareLiveDeploymentFixture({
      installedDirectory: REPO_ROOT,
      fixtureDirectory,
      nativeTarget: NATIVE_TARGET,
      timerDelayMs,
    });
    return { root, fixtureDirectory };
  }

  /** @param {string} root @param {string} source */
  async function fixtureNode(root, source) {
    return await runLiveDeploymentProcess({
      file: process.execPath,
      args: ['--input-type=module', '-e', source],
      cwd: root,
      env: createLiveDeploymentBuildEnvironment(root),
      timeoutMs: 10_000,
    });
  }

  test('packages the installed CLI with two activities and the selected durable timer', async () => {
    const { root, fixtureDirectory } = await prepareFixture(123_456);
    const result = await fixtureNode(
      root,
      `const {default: manifest} = await import(${JSON.stringify(pathToFileURL(path.join(fixtureDirectory, 'wharfie.app.js')).href)});
       process.stdout.write(JSON.stringify(manifest));`,
    );
    const manifest = JSON.parse(result.stdout);
    expect(manifest.app.id).toBe(LIVE_DEPLOYMENT_APP_ID);
    expect(manifest.targets).toEqual([NATIVE_TARGET]);
    expect(manifest.cli).toEqual({
      entrypoint: { kind: 'node', path: './cli.js', export: 'main' },
      durable: { workflow: 'verify-stable', export: 'toDurableInput' },
    });
    expect(manifest.workflows['verify-stable'].steps).toEqual([
      {
        id: 'baseline',
        kind: 'activity',
        activity: 'capture',
        input: { kind: 'workflow-input' },
      },
      { id: 'stability-window', kind: 'timer', delayMs: 123_456 },
      {
        id: 'comparison',
        kind: 'activity',
        activity: 'verify',
        input: { kind: 'step-output', step: 'baseline' },
      },
    ]);
    expect(manifest.activities).toEqual({
      capture: {
        entrypoint: {
          kind: 'node',
          path: './acceptance-activities.js',
          export: 'capture',
        },
      },
      verify: {
        entrypoint: {
          kind: 'node',
          path: './acceptance-activities.js',
          export: 'verify',
        },
      },
    });
  });

  test.each([0, -1, 1.5, 2_147_483_648, Number.NaN])(
    'rejects invalid timer %s before creating a fixture',
    async (timerDelayMs) => {
      const root = await temporaryDirectory();
      const fixtureDirectory = path.join(root, 'app');
      await expect(
        prepareLiveDeploymentFixture({
          installedDirectory: REPO_ROOT,
          fixtureDirectory,
          nativeTarget: NATIVE_TARGET,
          timerDelayMs,
        }),
      ).rejects.toThrow('bounded positive duration');
      await expect(lstat(fixtureDirectory)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  test('ordinary CLI preserves useful output without recording durable activity entries', async () => {
    const { root, fixtureDirectory } = await prepareFixture();
    const inputPath = path.join(root, 'input.txt');
    await writeFile(inputPath, LIVE_DEPLOYMENT_INPUT_BYTES);
    const result = await fixtureNode(
      root,
      `const {main} = await import(${JSON.stringify(pathToFileURL(path.join(fixtureDirectory, 'cli.js')).href)});
       await main(['node', 'fixture', ${JSON.stringify(inputPath)}]);`,
    );
    const fingerprint = {
      bytes: Buffer.byteLength(LIVE_DEPLOYMENT_INPUT_BYTES),
      sha256: createHash('sha256')
        .update(LIVE_DEPLOYMENT_INPUT_BYTES)
        .digest('hex'),
      readStable: true,
    };
    expect(JSON.parse(result.stdout)).toEqual({
      path: inputPath,
      stable: true,
      baseline: fingerprint,
      current: fingerprint,
    });
    await expect(lstat(`${inputPath}.activities.jsonl`)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('activity markers expose repeated execution even when logical output is unchanged', async () => {
    const { root, fixtureDirectory } = await prepareFixture();
    const inputPath = path.join(root, 'input.txt');
    await writeFile(inputPath, LIVE_DEPLOYMENT_INPUT_BYTES);
    const result = await fixtureNode(
      root,
      `const {capture, verify} = await import(${JSON.stringify(pathToFileURL(path.join(fixtureDirectory, 'acceptance-activities.js')).href)});
       const input = {path: ${JSON.stringify(inputPath)}};
       const baseline = await capture(input);
       const output = await verify(baseline);
       const replayed = await capture(input);
       process.stdout.write(JSON.stringify({baseline,output,replayed}));`,
    );
    const { baseline, output, replayed } = JSON.parse(result.stdout);
    expect(output.stable).toBe(true);
    expect(replayed).toEqual(baseline);
    const markers = (await readFile(`${inputPath}.activities.jsonl`, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(markers.map((marker) => marker.activity)).toEqual([
      'capture',
      'verify',
      'capture',
    ]);
    for (const marker of markers) {
      expect(marker).toEqual({
        schemaVersion: 1,
        kind: 'wharfie.live-deployment.activity-entry',
        activity: expect.any(String),
        bootId: process.platform === 'linux' ? expect.any(String) : null,
        processId: expect.any(Number),
      });
    }
    expect((await lstat(`${inputPath}.activities.jsonl`)).mode & 0o777).toBe(
      0o600,
    );
  });

  test('retains the first observation and reports a file changed during the durable wait', async () => {
    const root = await temporaryDirectory();
    const inputPath = path.join(root, 'input.txt');
    await writeFile(inputPath, LIVE_DEPLOYMENT_INPUT_BYTES);
    const baseline = await capture({ path: inputPath });
    await writeFile(inputPath, 'changed during the durable timer\n');
    const result = await verify(baseline);
    expect(result.stable).toBe(false);
    expect(result.baseline.sha256).toBe(baseline.sha256);
    expect(result.current.sha256).not.toBe(baseline.sha256);
    const markers = (await readFile(`${inputPath}.activities.jsonl`, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(markers.map((marker) => marker.activity)).toEqual([
      'capture',
      'verify',
    ]);
  });

  test('refuses symlinked activity evidence without overwriting its target', async () => {
    const { root, fixtureDirectory } = await prepareFixture();
    const inputPath = path.join(root, 'input.txt');
    const unrelated = path.join(root, 'unrelated.txt');
    await writeFile(inputPath, LIVE_DEPLOYMENT_INPUT_BYTES);
    await writeFile(unrelated, 'preserve');
    await symlink(unrelated, `${inputPath}.activities.jsonl`);
    await expect(
      fixtureNode(
        root,
        `const {capture} = await import(${JSON.stringify(pathToFileURL(path.join(fixtureDirectory, 'acceptance-activities.js')).href)});
         await capture({path: ${JSON.stringify(inputPath)}});`,
      ),
    ).rejects.toThrow('Live deployment command failed');
    expect(await readFile(unrelated, 'utf8')).toBe('preserve');
  });
});

describe('live deployment public package evidence', () => {
  test('accepts native Darwin ARM64 controller with matching exact bytes and record', async () => {
    const fixture = await artifactFixture();
    await expect(
      verifyLiveDeploymentPackageOutput(
        JSON.stringify(fixture.receipt),
        fixture.expected,
      ),
    ).resolves.toMatchObject({
      executable: fixture.artifactPath,
      appId: LIVE_DEPLOYMENT_APP_ID,
      revisionId: fixture.receipt.revisionId,
      artifactRecord: fixture.record,
    });
  });

  test('rejects an executable whose bytes changed after packaging', async () => {
    const fixture = await artifactFixture();
    await writeFile(fixture.artifactPath, 'x'.repeat(fixture.record.size));
    await expect(
      verifyLiveDeploymentPackageOutput(
        JSON.stringify(fixture.receipt),
        fixture.expected,
      ),
    ).rejects.toThrow();
  });

  test('rejects a different native target even when receipt and record agree', async () => {
    const fixture = await artifactFixture();
    await expect(
      verifyLiveDeploymentPackageOutput(JSON.stringify(fixture.receipt), {
        ...fixture.expected,
        nativeTarget: { ...NATIVE_TARGET, architecture: 'x64' },
      }),
    ).rejects.toThrow();
  });

  test('rejects a sidecar from another package version', async () => {
    const fixture = await artifactFixture();
    fixture.record.provenance.builder.version = '0.0.16';
    await writeFile(fixture.recordPath, JSON.stringify(fixture.record));
    await expect(
      verifyLiveDeploymentPackageOutput(
        JSON.stringify(fixture.receipt),
        fixture.expected,
      ),
    ).rejects.toThrow();
  });

  test('rejects symlinked executables and missing execute mode', async () => {
    const fixture = await artifactFixture();
    await chmod(fixture.artifactPath, 0o600);
    await expect(
      verifyLiveDeploymentPackageOutput(
        JSON.stringify(fixture.receipt),
        fixture.expected,
      ),
    ).rejects.toThrow();
    const outside = path.join(await temporaryDirectory(), 'controller');
    await writeFile(outside, await readFile(fixture.artifactPath), {
      mode: 0o700,
    });
    await rm(fixture.artifactPath);
    await symlink(outside, fixture.artifactPath);
    await expect(
      verifyLiveDeploymentPackageOutput(
        JSON.stringify(fixture.receipt),
        fixture.expected,
      ),
    ).rejects.toThrow();
  });
});

describe('live deployment subprocess lifecycle', () => {
  test('sends a bounded document over stdin and requires the child to receive EOF', async () => {
    const cwd = await temporaryDirectory();
    const input = JSON.stringify({ document: 'x'.repeat(128 * 1024) });
    const result = await runLiveDeploymentProcess({
      file: process.execPath,
      args: ['-e', 'process.stdin.pipe(process.stdout)'],
      cwd,
      env: {},
      stdin: input,
      timeoutMs: 5000,
    });
    expect(result.stdout).toBe(input);
    await expect(
      runLiveDeploymentProcess({
        file: process.execPath,
        args: ['-e', 'process.exit(0)'],
        cwd,
        env: {},
        stdin: 'x'.repeat(256 * 1024 + 1),
        timeoutMs: 5000,
      }),
    ).rejects.toThrow('input exceeds its bound');
  });

  test('contains broken stdin pipes without exposing their document', async () => {
    const cwd = await temporaryDirectory();
    const result = await runLiveDeploymentProcess({
      file: process.execPath,
      args: [
        '-e',
        'require("node:fs").closeSync(0); setInterval(() => {}, 1000)',
      ],
      cwd,
      env: {},
      stdin: 'private-document'.repeat(16000),
      timeoutMs: 5000,
    }).catch((error) => error);
    expect(result.diagnostic).toMatchObject({
      stdinError: true,
      timedOut: false,
    });
    expect(JSON.stringify(result)).not.toContain('private-document');
  });

  test('returns bounded successful output without inheriting ambient credentials', async () => {
    const cwd = await temporaryDirectory();
    const result = await runLiveDeploymentProcess({
      file: process.execPath,
      args: ['-e', 'process.stdout.write(JSON.stringify(process.env))'],
      cwd,
      env: { ACCEPTANCE_ONLY: 'yes' },
      timeoutMs: 5000,
    });
    const observed = JSON.parse(result.stdout);
    // macOS libc synthesizes this process-local encoding setting at startup.
    delete observed.__CF_USER_TEXT_ENCODING;
    expect(observed).toEqual({ ACCEPTANCE_ONLY: 'yes' });
    expect(result.status).toBe(0);
  });

  test('retains failed phase and exit code without secret stderr or arguments', async () => {
    const cwd = await temporaryDirectory();
    const failure = await runLiveDeploymentProcess({
      file: process.execPath,
      args: ['-e', 'console.error("secret-fixture"); process.exitCode = 7'],
      cwd,
      env: {},
      timeoutMs: 5000,
      phase: 'package-fresh-install',
    }).catch((error) => error);
    expect(failure.diagnostic).toMatchObject({
      phase: 'package-fresh-install',
      status: 7,
      timedOut: false,
      aborted: false,
    });
    expect(String(failure)).not.toContain('secret-fixture');
    expect(JSON.stringify(failure)).not.toContain('secret-fixture');
  });

  test('bounds output and kills an overflowing process', async () => {
    const cwd = await temporaryDirectory();
    await expect(
      runLiveDeploymentProcess({
        file: process.execPath,
        args: [
          '-e',
          'process.stdout.write(Buffer.alloc(5 * 1024 * 1024)); setInterval(() => {}, 1000)',
        ],
        cwd,
        env: {},
        timeoutMs: 5000,
      }),
    ).rejects.toMatchObject({ diagnostic: { outputLimitExceeded: true } });
  });

  test('reaps a descendant that holds the command pipes open at the deadline', async () => {
    const cwd = await temporaryDirectory();
    const result = runLiveDeploymentProcess({
      file: process.execPath,
      args: [
        '-e',
        `require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'inherit'});`,
      ],
      cwd,
      env: {},
      timeoutMs: 200,
    });
    await expect(result).rejects.toMatchObject({
      diagnostic: { timedOut: true, signal: 'SIGKILL' },
    });
  });

  test('aborts running commands and rejects already-aborted starts', async () => {
    const cwd = await temporaryDirectory();
    const controller = new AbortController();
    const options = {
      file: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd,
      env: {},
      timeoutMs: 5000,
      signal: controller.signal,
    };
    const running = runLiveDeploymentProcess(options);
    controller.abort();
    await expect(running).rejects.toMatchObject({
      diagnostic: { aborted: true },
    });
    await expect(runLiveDeploymentProcess(options)).rejects.toMatchObject({
      diagnostic: { aborted: true, status: null },
    });
  });
});
