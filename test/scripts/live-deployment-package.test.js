import { afterEach, describe, expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  readdir,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import {
  assertLiveDeploymentPackageVersions,
  buildLiveDeploymentCandidate,
  buildLiveDeploymentCandidates,
  createLiveDeploymentBuildEnvironment,
  LIVE_DEPLOYMENT_APP_ID,
  LIVE_DEPLOYMENT_INPUT_BYTES,
  LIVE_DEPLOYMENT_NEXT_TIMER_DELAY_MS,
  LIVE_DEPLOYMENT_TIMER_DELAY_MS,
  prepareLiveDeploymentFixture,
  runLiveDeploymentProcess,
  stageLiveDeploymentReleasePackages,
  verifyLiveDeploymentPackageOutput,
} from '../../scripts/live-deployment-package.js';
import {
  capture,
  verify,
} from '../../scripts/live-deployment-fixture-activities.js';
import { getBuildTargetId } from '../../src/core/runtime/build-target.js';
import { REPO_ROOT } from '../../scripts/package-verification.js';
import packageMetadata from '../../package.json' with { type: 'json' };
import awsMetadata from '../../packages/aws/package.json' with { type: 'json' };

/** @type {string[]} */
const directories = [];
const VERSION = '0.0.15';
const RELEASE_COMMIT = 'a'.repeat(40);
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

/** @param {Record<string, any>} metadata - Candidate package metadata. */
function metadataTarball(metadata) {
  const contents = Buffer.from(JSON.stringify(metadata));
  const header = Buffer.alloc(512);
  header.write('package/package.json');
  for (const [offset, length, value] of [
    [100, 8, 0o644],
    [108, 8, 0],
    [116, 8, 0],
    [124, 12, contents.length],
    [136, 12, 0],
  ]) {
    header.write(
      `${value.toString(8).padStart(length - 1, '0')}\0`,
      offset,
      length,
      'ascii',
    );
  }
  header.fill(0x20, 148, 156);
  header[156] = 48;
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
  return gzipSync(
    Buffer.concat([
      header,
      contents,
      Buffer.alloc((512 - (contents.length % 512)) % 512),
      Buffer.alloc(1024),
    ]),
  );
}

async function releaseFixture() {
  const root = await temporaryDirectory();
  const artifactDir = path.join(root, 'release');
  await mkdir(artifactDir, { mode: 0o700 });
  const standalone = Buffer.from(
    'unexecutable live deployment release fixture',
  );
  const byteDigest = createHash('sha256')
    .update(standalone)
    .digest('base64url');
  const artifactId = `waf1_${byteDigest}`;
  const revisionId = `wrv1_${byteDigest}`;
  const target = {
    nodeVersion: '24.13.1',
    platform: 'linux',
    architecture: 'x64',
    libc: 'glibc',
  };
  const record = {
    schemaVersion: 1,
    kind: 'artifactRecord',
    appId: 'wharfie',
    artifactId,
    revisionId,
    byteDigest: { algorithm: 'sha256', value: byteDigest },
    size: standalone.length,
    target,
    targetId: 'node-v24.13.1-linux-x64-glibc',
    format: { kind: 'node-sea', version: 1 },
    provenance: { fixture: 'live-deployment-package' },
  };
  const files = new Map([
    [`wharfie-wharfie-${VERSION}.tgz`, metadataTarball(packageMetadata)],
    [`wharfie-aws-${VERSION}.tgz`, metadataTarball(awsMetadata)],
    [`wharfie-v${VERSION}-linux-x64`, standalone],
    [
      `wharfie-v${VERSION}-linux-x64.artifact.json`,
      Buffer.from(JSON.stringify(record)),
    ],
  ]);
  /** @type {Record<string, any>[]} */
  const artifacts = [...files].map(([fileName, bytes], index) => ({
    fileName,
    kind: [
      'npm-package',
      'npm-companion-package',
      'standalone-cli',
      'artifact-record',
    ][index],
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
    ...(index < 2
      ? {
          package: index === 0 ? '@wharfie/wharfie' : '@wharfie/aws',
          publication: index === 0 ? 'npm-preview' : 'github-release-only',
          version: VERSION,
          integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
          npmShasum: createHash('sha1').update(bytes).digest('hex'),
        }
      : { artifactId }),
    ...(index === 2 ? { target, revisionId } : {}),
  }));
  const manifest = {
    schemaVersion: 1,
    kind: 'wharfie.preview-release',
    package: '@wharfie/wharfie',
    version: VERSION,
    tag: `v${VERSION}`,
    source: {
      repository: 'https://github.com/wharfie/wharfie',
      commit: RELEASE_COMMIT,
    },
    artifacts,
  };
  files.set('preview-release.json', Buffer.from(JSON.stringify(manifest)));
  files.set(
    'SHA256SUMS',
    Buffer.from(
      [...files]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(
          ([fileName, bytes]) =>
            `${createHash('sha256').update(bytes).digest('hex')}  ${fileName}\n`,
        )
        .join(''),
    ),
  );
  for (const [fileName, bytes] of files) {
    await writeFile(path.join(artifactDir, fileName), bytes, { mode: 0o600 });
  }
  return {
    root,
    artifactDir,
    directory: path.join(root, 'staged'),
    expectedCommit: RELEASE_COMMIT,
    artifacts,
  };
}

describe('live deployment verified release input', () => {
  test.each([
    { artifactDir: '/release' },
    { expectedCommit: RELEASE_COMMIT },
    { artifactDir: 'relative', expectedCommit: RELEASE_COMMIT },
    { artifactDir: '/release', expectedCommit: RELEASE_COMMIT.toUpperCase() },
    { artifactDir: '/release', expectedCommit: RELEASE_COMMIT.slice(0, 8) },
  ])(
    'rejects incomplete or ambiguous release selection before build state %#',
    async (selection) => {
      const workspace = await temporaryDirectory();
      await expect(
        buildLiveDeploymentCandidate({
          workspace,
          provider: 'aws',
          ...selection,
        }),
      ).rejects.toThrow();
      expect(await readdir(workspace)).toEqual([]);
    },
  );

  test.each(['aws', 'hetzner'])(
    'isolates exact %s package bytes and retains source identities',
    async (provider) => {
      const fixture = await releaseFixture();
      const selectedProvider = /** @type {'aws'|'hetzner'} */ (provider);
      const staged = await stageLiveDeploymentReleasePackages({
        ...fixture,
        provider: selectedProvider,
      });
      const selected = fixture.artifacts.slice(0, provider === 'aws' ? 2 : 1);
      expect(staged.packageSource).toEqual({
        kind: 'verified-release-assets',
        version: VERSION,
        tag: `v${VERSION}`,
        sourceCommit: RELEASE_COMMIT,
        packages: selected.map((artifact) => ({
          name: artifact.package,
          version: artifact.version,
          fileName: artifact.fileName,
          sha256: artifact.sha256,
          integrity: artifact.integrity,
          npmShasum: artifact.npmShasum,
          size: artifact.size,
        })),
      });
      expect(staged.packages).toEqual(
        selected.map((artifact) =>
          path.join(fixture.directory, artifact.fileName),
        ),
      );
      expect((await lstat(fixture.directory)).mode & 0o777).toBe(0o700);
      for (const [index, destination] of staged.packages.entries()) {
        const source = path.join(fixture.artifactDir, selected[index].fileName);
        const verifiedBytes = await readFile(source);
        expect(await readFile(destination)).toEqual(verifiedBytes);
        expect((await lstat(destination)).mode & 0o777).toBe(0o600);
        await writeFile(source, 'changed after staging');
        expect(await readFile(destination)).toEqual(verifiedBytes);
      }
    },
  );

  test('rejects another source commit before creating the staging directory', async () => {
    const fixture = await releaseFixture();
    await expect(
      stageLiveDeploymentReleasePackages({
        ...fixture,
        provider: 'aws',
        expectedCommit: 'b'.repeat(40),
      }),
    ).rejects.toThrow();
    await expect(lstat(fixture.directory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('the public builder stages release bytes and reaches only the fresh installer', async () => {
    const fixture = await releaseFixture();
    const controller = new AbortController();
    controller.abort();
    /** @type {Record<string, any>[]} */
    const phases = [];
    await expect(
      buildLiveDeploymentCandidate({
        workspace: fixture.root,
        provider: 'aws',
        artifactDir: fixture.artifactDir,
        expectedCommit: RELEASE_COMMIT,
        signal: controller.signal,
        onPhase: (event) => phases.push(event),
      }),
    ).rejects.toMatchObject({
      diagnostic: { phase: 'package-fresh-install', aborted: true },
    });
    expect(phases).toEqual([
      { phase: 'package-verify-release-assets', state: 'started' },
      { phase: 'package-verify-release-assets', state: 'completed' },
      { phase: 'package-fresh-install', state: 'started' },
    ]);
    const tarballs = path.join(fixture.root, 'package/tarballs');
    expect((await readdir(tarballs)).sort()).toEqual(
      fixture.artifacts
        .slice(0, 2)
        .map((artifact) => artifact.fileName)
        .sort(),
    );
  });

  test('default checkout input retains the original npm pack boundary', async () => {
    const workspace = await temporaryDirectory();
    const controller = new AbortController();
    controller.abort();
    /** @type {Record<string, any>[]} */
    const phases = [];
    await expect(
      buildLiveDeploymentCandidate({
        workspace,
        provider: 'hetzner',
        signal: controller.signal,
        onPhase: (event) => phases.push(event),
      }),
    ).rejects.toMatchObject({
      diagnostic: { phase: 'package-core-tarball', aborted: true },
    });
    expect(phases).toEqual([
      { phase: 'package-core-tarball', state: 'started' },
    ]);
  });

  test.each(['missing-companion', 'changed-tarball', 'symlink', 'extra-file'])(
    'rejects invalid complete release input: %s',
    async (change) => {
      const fixture = await releaseFixture();
      const core = path.join(
        fixture.artifactDir,
        fixture.artifacts[0].fileName,
      );
      if (change === 'missing-companion') {
        await rm(path.join(fixture.artifactDir, fixture.artifacts[1].fileName));
      } else if (change === 'changed-tarball') {
        await writeFile(core, Buffer.alloc(fixture.artifacts[0].size));
      } else if (change === 'symlink') {
        const outside = path.join(fixture.root, 'outside.tgz');
        await copyFile(core, outside);
        await rm(core);
        await symlink(outside, core);
      } else {
        await writeFile(
          path.join(fixture.artifactDir, 'unexpected.txt'),
          'extra',
        );
      }
      await expect(
        stageLiveDeploymentReleasePackages({ ...fixture, provider: 'hetzner' }),
      ).rejects.toThrow();
      await expect(lstat(fixture.directory)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  test.each(['same-size', 'larger'])(
    'rejects %s replacement between release verification and installation',
    async (replacement) => {
      const fixture = await releaseFixture();
      await expect(
        stageLiveDeploymentReleasePackages(
          { ...fixture, provider: 'aws' },
          {
            copyFile: async (source, destination, mode) => {
              const size = (await lstat(source)).size;
              await writeFile(
                source,
                Buffer.alloc(size + (replacement === 'larger' ? 1 : 0)),
              );
              await copyFile(source, destination, mode);
            },
          },
        ),
      ).rejects.toThrow();
    },
  );

  test('refuses an existing staging directory and preserves unrelated contents', async () => {
    const fixture = await releaseFixture();
    await mkdir(fixture.directory);
    const ownedElsewhere = path.join(
      fixture.directory,
      fixture.artifacts[0].fileName,
    );
    await writeFile(ownedElsewhere, 'preserve');
    await expect(
      stageLiveDeploymentReleasePackages({ ...fixture, provider: 'aws' }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(ownedElsewhere, 'utf8')).toBe('preserve');
  });
});

describe('live deployment installed-candidate boundary', () => {
  test('requires an external workspace before any build mutation', async () => {
    await expect(
      buildLiveDeploymentCandidate({ workspace: REPO_ROOT, provider: 'aws' }),
    ).rejects.toThrow('outside the checkout');
    await expect(
      buildLiveDeploymentCandidates({ workspace: REPO_ROOT, provider: 'aws' }),
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
  /** @param {number} [timerDelayMs] @param {'A'|'B'} [revision] */
  async function prepareFixture(
    timerDelayMs = LIVE_DEPLOYMENT_TIMER_DELAY_MS,
    revision = 'A',
  ) {
    const root = await temporaryDirectory();
    const fixtureDirectory = path.join(root, 'app');
    await prepareLiveDeploymentFixture({
      installedDirectory: REPO_ROOT,
      fixtureDirectory,
      nativeTarget: NATIVE_TARGET,
      timerDelayMs,
      revision,
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

  test('revision B is distinguishable while durable input and output remain compatible', async () => {
    const primary = await prepareFixture();
    const next = await prepareFixture(LIVE_DEPLOYMENT_NEXT_TIMER_DELAY_MS, 'B');
    const inputPath = path.join(primary.root, 'input.txt');
    await writeFile(inputPath, LIVE_DEPLOYMENT_INPUT_BYTES);
    const outputs = [];
    const histories = [];
    for (const { root, fixtureDirectory } of [primary, next]) {
      const cliUrl = pathToFileURL(path.join(fixtureDirectory, 'cli.js')).href;
      const output = await fixtureNode(
        root,
        `const {main} = await import(${JSON.stringify(cliUrl)});
         await main(['node', 'fixture', ${JSON.stringify(inputPath)}]);`,
      );
      outputs.push(JSON.parse(output.stdout));
      const history = await fixtureNode(
        root,
        `const {toDurableInput} = await import(${JSON.stringify(cliUrl)});
         const {capture, verify} = await import(${JSON.stringify(pathToFileURL(path.join(fixtureDirectory, 'acceptance-activities.js')).href)});
         const {default: manifest} = await import(${JSON.stringify(pathToFileURL(path.join(fixtureDirectory, 'wharfie.app.js')).href)});
         const input = toDurableInput([${JSON.stringify(inputPath)}]);
         const baseline = await capture(input);
         const output = await verify(baseline);
         process.stdout.write(JSON.stringify({input, baseline, output, manifest}));`,
      );
      histories.push(JSON.parse(history.stdout));
    }
    expect(outputs[0].acceptanceRevision).toBeUndefined();
    expect(outputs[1]).toEqual({ ...outputs[0], acceptanceRevision: 'B' });
    expect(histories[1].input).toEqual(histories[0].input);
    expect(histories[1].baseline).toEqual(histories[0].baseline);
    expect(histories[1].output).toEqual(histories[0].output);
    expect(histories[1].output).toEqual(outputs[0]);
    const primarySteps = histories[0].manifest.workflows['verify-stable'].steps;
    const nextSteps = histories[1].manifest.workflows['verify-stable'].steps;
    expect(primarySteps[1].delayMs).toBe(LIVE_DEPLOYMENT_TIMER_DELAY_MS);
    expect(nextSteps[1].delayMs).toBe(LIVE_DEPLOYMENT_NEXT_TIMER_DELAY_MS);
    nextSteps[1].delayMs = primarySteps[1].delayMs;
    expect(histories[1].manifest).toEqual(histories[0].manifest);
    expect(
      await readFile(path.join(primary.fixtureDirectory, 'cli.js'), 'utf8'),
    ).toBe(
      await readFile(
        path.join(REPO_ROOT, 'examples/steady-file/cli.js'),
        'utf8',
      ),
    );
    expect(
      (await readFile(`${inputPath}.activities.jsonl`, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).activity),
    ).toEqual(['capture', 'verify', 'capture', 'verify']);
  });

  test('rejects an unknown revision before creating the fixture', async () => {
    const root = await temporaryDirectory();
    const fixtureDirectory = path.join(root, 'app');
    await expect(
      prepareLiveDeploymentFixture({
        installedDirectory: REPO_ROOT,
        fixtureDirectory,
        nativeTarget: NATIVE_TARGET,
        revision: /** @type {'A'} */ ('C'),
      }),
    ).rejects.toThrow('Unknown live acceptance revision');
    await expect(lstat(fixtureDirectory)).rejects.toMatchObject({
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
