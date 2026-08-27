// @ts-nocheck -- The stateful npm/GitHub command double intentionally models loose external JSON.
/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import {
  loadPreviewReleaseCandidate,
  parsePreviewPublicationArgs,
  publishPreviewRelease,
} from '../../scripts/publish-preview-release.js';

const COMMIT = 'a'.repeat(40);
const VERSION = '0.0.15';
const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});
const REVISION_ID = `wrv1_${Buffer.alloc(32, 0x52).toString('base64url')}`;

function hash(contents, algorithm, encoding = 'hex') {
  return createHash(algorithm).update(contents).digest(encoding);
}

function makeCommandFailure(stderr) {
  const error = new Error(stderr);
  Object.assign(error, { stderr, stdout: '' });
  return error;
}

function makeNpmNotFoundFailure() {
  const error = new Error('npm view returned E404');
  Object.assign(error, {
    stdout: JSON.stringify({
      error: {
        code: 'E404',
        summary: 'No match found for version 0.0.15',
      },
    }),
    stderr: '',
  });
  return error;
}

function writeTarNumber(header, offset, length, value) {
  const text = `${value.toString(8).padStart(length - 1, '0')}\0`;
  header.write(text, offset, length, 'ascii');
}

function createTarEntry(name, contents) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  writeTarNumber(header, 100, 8, 0o644);
  writeTarNumber(header, 108, 8, 0);
  writeTarNumber(header, 116, 8, 0);
  writeTarNumber(header, 124, 12, contents.length);
  writeTarNumber(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
  const padding = Buffer.alloc((512 - (contents.length % 512)) % 512);
  return Buffer.concat([header, contents, padding]);
}

function createPackageTarball(metadata) {
  const packageJson = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`);
  return gzipSync(
    Buffer.concat([
      createTarEntry('package/package.json', packageJson),
      Buffer.alloc(1024),
    ]),
  );
}

function corePackageMetadata() {
  return {
    name: '@wharfie/wharfie',
    version: VERSION,
    private: false,
    repository: {
      type: 'git',
      url: 'git+https://github.com/wharfie/wharfie.git',
    },
    engines: { node: '>=24.13.1 <25' },
    peerDependencies: { '@wharfie/aws': VERSION },
    peerDependenciesMeta: { '@wharfie/aws': { optional: true } },
    publishConfig: {
      access: 'public',
      tag: 'preview-candidate',
      provenance: true,
    },
    scripts: { test: 'node --test' },
  };
}

function companionPackageMetadata() {
  return {
    name: '@wharfie/aws',
    version: VERSION,
    private: false,
    repository: {
      type: 'git',
      url: 'git+https://github.com/wharfie/wharfie.git',
      directory: 'packages/aws',
    },
    engines: { node: '>=24.13.1 <25' },
    peerDependencies: { '@wharfie/wharfie': VERSION },
    peerDependenciesMeta: { '@wharfie/wharfie': { optional: true } },
    publishConfig: { access: 'public' },
  };
}

function packLocalPackage(packageRoot) {
  const outputDir = mkdtempSync(
    path.join(os.tmpdir(), 'wharfie-publisher-real-pack-'),
  );
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const stdout = execFileSync(
    command,
    ['pack', '--json', '--ignore-scripts', '--pack-destination', outputDir],
    {
      cwd: packageRoot,
      env: { ...process.env, npm_config_cache: path.join(outputDir, 'cache') },
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      timeout: 120_000,
    },
  );
  const results = JSON.parse(stdout);
  if (!Array.isArray(results) || results.length !== 1) {
    throw new Error('npm pack did not produce one local package.');
  }
  return {
    outputDir,
    bytes: readFileSync(path.join(outputDir, results[0].filename)),
  };
}

function writeCandidate(options = {}) {
  const artifactDir = mkdtempSync(
    path.join(os.tmpdir(), 'wharfie-preview-publication-'),
  );
  const coreMetadata = corePackageMetadata();
  const companionMetadata = companionPackageMetadata();
  options.mutateCorePackage?.(coreMetadata);
  options.mutateCompanionPackage?.(companionMetadata);
  const standalone =
    options.standaloneBytes || Buffer.from('standalone preview bytes');
  const standaloneDigest = hash(standalone, 'sha256', 'base64url');
  const artifactId = `waf1_${standaloneDigest}`;
  const record = {
    schemaVersion: 1,
    kind: 'artifactRecord',
    artifactId,
    byteDigest: { algorithm: 'sha256', value: standaloneDigest },
    size: standalone.length,
    appId: 'wharfie',
    revisionId: REVISION_ID,
    target: { ...TARGET },
    targetId: 'node-v24.13.1-linux-x64-glibc',
    format: { kind: 'node-sea', version: 1 },
    provenance: { fixture: 'publisher-contract' },
  };
  options.mutateRecord?.(record);
  const names = {
    core: `wharfie-wharfie-${VERSION}.tgz`,
    companion: `wharfie-aws-${VERSION}.tgz`,
    standalone: `wharfie-v${VERSION}-linux-x64`,
    record: `wharfie-v${VERSION}-linux-x64.artifact.json`,
    ...options.names,
  };
  const files = new Map([
    [names.core, options.coreTarball || createPackageTarball(coreMetadata)],
    [names.standalone, standalone],
    [names.record, Buffer.from(`${JSON.stringify(record, null, 2)}\n`)],
  ]);
  if (options.companion !== false) {
    files.set(
      names.companion,
      options.companionTarball || createPackageTarball(companionMetadata),
    );
  }
  for (const [name, contents] of files) {
    writeFileSync(path.join(artifactDir, name), contents);
  }
  const tarball = files.get(names.core);
  const artifacts = [
    {
      fileName: names.core,
      integrity: `sha512-${hash(tarball, 'sha512', 'base64')}`,
      kind: 'npm-package',
      package: '@wharfie/wharfie',
      publication: 'npm-preview',
      npmShasum: hash(tarball, 'sha1'),
      sha256: hash(tarball, 'sha256'),
      size: tarball.length,
      version: VERSION,
    },
    {
      fileName: names.standalone,
      kind: 'standalone-cli',
      sha256: hash(files.get(names.standalone), 'sha256'),
      size: files.get(names.standalone).length,
      target: { ...TARGET },
      artifactId,
      revisionId: REVISION_ID,
    },
    {
      fileName: names.record,
      kind: 'artifact-record',
      sha256: hash(files.get(names.record), 'sha256'),
      size: files.get(names.record).length,
      artifactId,
    },
  ];
  if (options.companion !== false) {
    const companion = files.get(names.companion);
    artifacts.push({
      fileName: names.companion,
      integrity: `sha512-${hash(companion, 'sha512', 'base64')}`,
      kind: 'npm-companion-package',
      package: '@wharfie/aws',
      publication: 'github-release-only',
      npmShasum: hash(companion, 'sha1'),
      sha256: hash(companion, 'sha256'),
      size: companion.length,
      version: VERSION,
    });
  }
  const manifest = {
    schemaVersion: 1,
    kind: 'wharfie.preview-release',
    package: '@wharfie/wharfie',
    version: VERSION,
    tag: `v${VERSION}`,
    source: {
      repository: 'https://github.com/wharfie/wharfie',
      commit: COMMIT,
    },
    artifacts,
  };
  options.mutateManifest?.(manifest);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(artifactDir, 'preview-release.json'), manifestBytes);
  const checksums = [
    ...artifacts.map((artifact) => ({
      name: artifact.fileName,
      sha256: artifact.sha256,
    })),
    {
      name: 'preview-release.json',
      sha256: hash(manifestBytes, 'sha256'),
    },
  ]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => `${entry.sha256}  ${entry.name}`)
    .join('\n');
  writeFileSync(path.join(artifactDir, 'SHA256SUMS'), `${checksums}\n`);
  return artifactDir;
}

function remoteAsset(local) {
  return {
    name: local.name,
    state: 'uploaded',
    size: statSync(local.filePath).size,
    digest: `sha256:${hash(readFileSync(local.filePath), 'sha256')}`,
  };
}

function matchingRelease(candidate, options = {}) {
  const assetNames =
    options.assetNames || candidate.assets.map(({ name }) => name);
  return {
    tag_name: candidate.manifest.tag,
    name: candidate.title,
    body: candidate.notes,
    draft: options.draft ?? true,
    prerelease: true,
    assets: candidate.assets
      .filter((asset) => assetNames.includes(asset.name))
      .map((asset) => remoteAsset(asset)),
  };
}

function matchingNpmVersion(candidate) {
  return {
    name: candidate.manifest.package,
    version: candidate.manifest.version,
    dist: {
      integrity: candidate.npmArtifact.integrity,
      shasum: candidate.npmArtifact.npmShasum,
      attestations: {
        url: `https://registry.npmjs.org/-/npm/v1/attestations/${encodeURIComponent(candidate.manifest.package)}@${candidate.manifest.version}`,
        provenance: {
          predicateType: 'https://slsa.dev/provenance/v1',
        },
      },
    },
  };
}

function createFakeCommands(candidate, initial = {}) {
  const initialNpmVersion = initial.npmVersion || null;
  const state = {
    release: initial.release || null,
    npmVersion: initialNpmVersion,
    tags: { ...(initial.tags || {}) },
    previewTagOutput: initial.previewTagOutput,
    quarantineTagOutput: initial.quarantineTagOutput,
    versions:
      initial.versions !== undefined
        ? [...initial.versions]
        : initialNpmVersion
          ? [candidate.manifest.version]
          : ['0.0.14'],
    calls: [],
    failCreateAfterMutation: initial.failCreateAfterMutation === true,
    failUploadAfterMutation: initial.failUploadAfterMutation,
    failPublishAfterMutation: initial.failPublishAfterMutation === true,
    failEditAfterMutation: initial.failEditAfterMutation === true,
    npmViewFailure: initial.npmViewFailure,
    tagCommit: initial.tagCommit || COMMIT,
    masterCommit: initial.masterCommit || 'd'.repeat(40),
    manifestOnMaster: initial.manifestOnMaster !== false,
    fetchedTagCommit: null,
    fetchedMasterCommit: null,
    fetchedManifestOnMaster: true,
    moveTagAfterPublish: initial.moveTagAfterPublish === true,
    moveTagAfterFinalAssetUpload: initial.moveTagAfterFinalAssetUpload === true,
    moveMasterAfterPublish: initial.moveMasterAfterPublish === true,
    moveMasterAfterFinalAssetUpload:
      initial.moveMasterAfterFinalAssetUpload === true,
    authorityFetchCount: 0,
    failAuthorityFetchAt: initial.failAuthorityFetchAt,
    exposeReleaseOnGuardFailure: initial.exposeReleaseOnGuardFailure === true,
    npmViewCount: 0,
    finalizeReleaseOnNpmViewNumber: initial.finalizeReleaseOnNpmViewNumber,
    removeAssetOnNpmViewNumber: initial.removeAssetOnNpmViewNumber,
    finalizeReleaseAfterPublish: initial.finalizeReleaseAfterPublish === true,
  };

  async function runCommand(command, args) {
    state.calls.push({ command, args: [...args] });
    if (command === 'git' && args[0] === 'fetch') {
      state.authorityFetchCount += 1;
      if (state.authorityFetchCount === state.failAuthorityFetchAt) {
        if (state.exposeReleaseOnGuardFailure) {
          state.release = matchingRelease(candidate);
        }
        throw makeCommandFailure('canonical authority unavailable');
      }
      state.fetchedTagCommit = state.tagCommit;
      state.fetchedMasterCommit = state.masterCommit;
      state.fetchedManifestOnMaster = state.manifestOnMaster;
      return { stdout: '', stderr: '' };
    }
    if (command === 'git' && args[0] === 'rev-parse') {
      const ref = args.at(-1);
      return {
        stdout: `${ref.includes('/tag') ? state.fetchedTagCommit : state.fetchedMasterCommit}\n`,
        stderr: '',
      };
    }
    if (command === 'git' && args[0] === 'merge-base') {
      if (!state.fetchedManifestOnMaster) {
        throw makeCommandFailure('not an ancestor');
      }
      return { stdout: '', stderr: '' };
    }
    if (command === 'gh' && args[0] === 'api') {
      return {
        stdout: JSON.stringify([state.release ? [state.release] : []]),
        stderr: '',
      };
    }

    if (command === 'gh' && args[1] === 'create') {
      state.release = matchingRelease(candidate, { assetNames: [] });
      if (state.failCreateAfterMutation) {
        state.failCreateAfterMutation = false;
        throw makeCommandFailure('create response lost');
      }
      return { stdout: 'created\n', stderr: '' };
    }
    if (command === 'gh' && args[1] === 'upload') {
      const filePath = args[3];
      const local = candidate.assets.find(
        (asset) => asset.filePath === filePath,
      );
      state.release.assets.push(remoteAsset(local));
      if (
        state.moveTagAfterFinalAssetUpload &&
        state.release.assets.length === candidate.assets.length
      ) {
        state.tagCommit = 'c'.repeat(40);
      }
      if (
        state.moveMasterAfterFinalAssetUpload &&
        state.release.assets.length === candidate.assets.length
      ) {
        state.masterCommit = 'e'.repeat(40);
        state.manifestOnMaster = false;
      }
      if (state.failUploadAfterMutation === local.name) {
        state.failUploadAfterMutation = undefined;
        throw makeCommandFailure('upload response lost');
      }
      return { stdout: '', stderr: '' };
    }
    if (command === 'gh' && args[1] === 'edit') {
      state.release.draft = false;
      if (state.failEditAfterMutation) {
        state.failEditAfterMutation = false;
        throw makeCommandFailure('edit response lost');
      }
      return { stdout: '', stderr: '' };
    }
    if (command === 'npm' && args[0] === 'view') {
      state.npmViewCount += 1;
      if (state.npmViewCount === state.finalizeReleaseOnNpmViewNumber) {
        state.release.draft = false;
      }
      if (state.npmViewCount === state.removeAssetOnNpmViewNumber) {
        state.release.assets.pop();
      }
      if (args[2]?.startsWith('dist-tags.')) {
        const tag = args[2].slice('dist-tags.'.length);
        const output =
          tag === 'preview'
            ? state.previewTagOutput
            : state.quarantineTagOutput;
        return {
          stdout:
            output !== undefined
              ? output
              : JSON.stringify(state.tags[tag] ?? null),
          stderr: '',
        };
      }
      if (args[2] === 'versions') {
        return { stdout: JSON.stringify(state.versions), stderr: '' };
      }
      if (state.npmViewFailure) throw state.npmViewFailure;
      if (!state.npmVersion) {
        throw makeNpmNotFoundFailure();
      }
      return { stdout: JSON.stringify(state.npmVersion), stderr: '' };
    }

    if (command === 'npm' && args[0] === 'publish') {
      state.npmVersion = matchingNpmVersion(candidate);
      state.tags['preview-candidate'] = candidate.manifest.version;
      state.quarantineTagOutput = undefined;
      if (!state.versions.includes(candidate.manifest.version)) {
        state.versions.push(candidate.manifest.version);
      }
      if (state.moveTagAfterPublish) state.tagCommit = 'c'.repeat(40);
      if (state.moveMasterAfterPublish) {
        state.masterCommit = 'e'.repeat(40);
        state.manifestOnMaster = false;
      }
      if (state.finalizeReleaseAfterPublish) state.release.draft = false;
      if (state.failPublishAfterMutation) {
        state.failPublishAfterMutation = false;
        throw makeCommandFailure('publish response lost');
      }
      return { stdout: '+ @wharfie/wharfie@0.0.15\n', stderr: '' };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  }

  return { state, runCommand };
}

function mutationCalls(state) {
  return state.calls.filter(
    ({ command, args }) =>
      (command === 'npm' && args[0] === 'publish') ||
      (command === 'gh' && args[0] === 'release'),
  );
}

describe('preview publication reconciliation', () => {
  /** @type {string[]} */
  const roots = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  async function fixture() {
    const artifactDir = writeCandidate();
    roots.push(artifactDir);
    const candidate = await loadPreviewReleaseCandidate(artifactDir, {
      expectedCommit: COMMIT,
    });
    return { artifactDir, candidate };
  }

  function publicationDependencies(fake) {
    return {
      authorize: async () => {},
      expectedCommit: COMMIT,
      runCommand: fake.runCommand,
    };
  }

  it('parses only the bounded artifact-directory option', () => {
    expect(() => parsePreviewPublicationArgs([])).toThrow(/exactly one/u);
    expect(() =>
      parsePreviewPublicationArgs(['--artifact-dir', '/tmp/release']),
    ).toThrow(/exactly one/u);
    expect(
      parsePreviewPublicationArgs([
        '--artifact-dir',
        '/tmp/release',
        '--defer-finalize',
      ]),
    ).toEqual({ artifactDir: '/tmp/release', deferFinalize: true });
    expect(parsePreviewPublicationArgs(['--finalize-only'])).toEqual({
      finalizeOnly: true,
    });
    expect(() => parsePreviewPublicationArgs(['--publish'])).toThrow(
      /Unknown preview publication option/u,
    );
    expect(() =>
      parsePreviewPublicationArgs(['--defer-finalize', '--finalize-only']),
    ).toThrow(/exactly one/u);
  });

  it('validates the exact four versioned artifacts and both package archives', async () => {
    const artifactDir = writeCandidate();
    roots.push(artifactDir);

    await expect(
      loadPreviewReleaseCandidate(artifactDir, { expectedCommit: COMMIT }),
    ).resolves.toMatchObject({ npmArtifact: { package: '@wharfie/wharfie' } });
    const candidate = await loadPreviewReleaseCandidate(artifactDir, {
      expectedCommit: COMMIT,
    });
    expect(candidate.manifest.artifacts.map(({ kind }) => kind).sort()).toEqual(
      [
        'artifact-record',
        'npm-companion-package',
        'npm-package',
        'standalone-cli',
      ],
    );
    expect(candidate.assets).toHaveLength(6);
  });

  it('accepts the real npm pack archive format for both workspace packages', async () => {
    const core = packLocalPackage(process.cwd());
    const companion = packLocalPackage(
      path.join(process.cwd(), 'packages', 'aws'),
    );
    roots.push(core.outputDir, companion.outputDir);
    const artifactDir = writeCandidate({
      coreTarball: core.bytes,
      companionTarball: companion.bytes,
    });
    roots.push(artifactDir);

    await expect(
      loadPreviewReleaseCandidate(artifactDir, { expectedCommit: COMMIT }),
    ).resolves.toMatchObject({ npmArtifact: { package: '@wharfie/wharfie' } });
  });

  it('rejects a release candidate without the AWS companion handoff', async () => {
    const artifactDir = writeCandidate({ companion: false });
    roots.push(artifactDir);

    await expect(
      loadPreviewReleaseCandidate(artifactDir, { expectedCommit: COMMIT }),
    ).rejects.toThrow('must contain one npm companion package');
  });

  it('rejects unknown or duplicate kinds and non-versioned filenames', async () => {
    const cases = [
      {
        options: {
          mutateManifest(manifest) {
            manifest.artifacts[2].kind = 'mystery-artifact';
          },
        },
        error: /Unknown preview artifact kind/u,
      },
      {
        options: {
          mutateManifest(manifest) {
            manifest.artifacts[2].kind = 'standalone-cli';
          },
        },
        error: /Duplicate preview artifact kind/u,
      },
      {
        options: { names: { core: 'wharfie-wharfie.tgz' } },
        error: /filename must be exactly wharfie-wharfie-0\.0\.15\.tgz/u,
      },
    ];
    for (const testCase of cases) {
      const artifactDir = writeCandidate(testCase.options);
      roots.push(artifactDir);
      await expect(
        loadPreviewReleaseCandidate(artifactDir, { expectedCommit: COMMIT }),
      ).rejects.toThrow(testCase.error);
    }
  });

  it('rejects noncanonical identities, target drift, and record-to-byte drift', async () => {
    const cases = [
      {
        options: {
          mutateManifest(manifest) {
            manifest.artifacts.find(
              ({ kind }) => kind === 'standalone-cli',
            ).revisionId = 'wrv1_not-canonical';
          },
        },
        error: /canonical wrv1_/u,
      },
      {
        options: {
          mutateManifest(manifest) {
            manifest.artifacts.find(
              ({ kind }) => kind === 'standalone-cli',
            ).target.architecture = 'arm64';
          },
        },
        error: /standalone target does not match/u,
      },
      {
        options: {
          mutateRecord(record) {
            record.size += 1;
          },
        },
        error: /record does not match the exact standalone bytes/u,
      },
      {
        options: {
          mutateRecord(record) {
            record.target.architecture = 'arm64';
          },
        },
        error: /record does not match the exact standalone bytes/u,
      },
    ];
    for (const testCase of cases) {
      const artifactDir = writeCandidate(testCase.options);
      roots.push(artifactDir);
      await expect(
        loadPreviewReleaseCandidate(artifactDir, { expectedCommit: COMMIT }),
      ).rejects.toThrow(testCase.error);
    }
  });

  it('rejects matching outer hashes when packed package identity is wrong', async () => {
    const artifactDir = writeCandidate({
      mutateCorePackage(metadata) {
        metadata.name = '@attacker/not-wharfie';
      },
    });
    roots.push(artifactDir);
    let authorized = false;
    let commandCalled = false;
    const authorize = async () => {
      authorized = true;
    };
    const runCommand = async () => {
      commandCalled = true;
      throw new Error('remote command must remain unreachable');
    };

    await expect(
      publishPreviewRelease(
        { artifactDir, deferFinalize: true },
        { authorize, expectedCommit: COMMIT, runCommand },
      ),
    ).rejects.toThrow(/core package must have the exact public name/u);
    expect(authorized).toBe(false);
    expect(commandCalled).toBe(false);
  });

  it('rejects lifecycle hooks in either packed package before publication', async () => {
    const cases = [
      {
        mutateCorePackage(metadata) {
          metadata.scripts.preinstall = 'node steal-secrets.js';
        },
      },
      {
        mutateCompanionPackage(metadata) {
          metadata.scripts = { prepublishOnly: 'node mutate-release.js' };
        },
      },
    ];
    for (const options of cases) {
      const artifactDir = writeCandidate(options);
      roots.push(artifactDir);
      await expect(
        loadPreviewReleaseCandidate(artifactDir, { expectedCommit: COMMIT }),
      ).rejects.toThrow(/must not contain npm lifecycle hook/u);
    }
  });

  it('rejects packed repository, engine, private, and peer asymmetry', async () => {
    const cases = [
      (metadata) => delete metadata.private,
      (metadata) => (metadata.engines.node = '>=20'),
      (metadata) => (metadata.repository.directory = 'packages/not-aws'),
      (metadata) => (metadata.peerDependencies['@wharfie/wharfie'] = '^0.0.15'),
    ];
    for (const mutateCompanionPackage of cases) {
      const artifactDir = writeCandidate({ mutateCompanionPackage });
      roots.push(artifactDir);
      await expect(
        loadPreviewReleaseCandidate(artifactDir, { expectedCommit: COMMIT }),
      ).rejects.toThrow(/Preview AWS companion|package contract/u);
    }
  });

  it('requires exactly one programmatic publication mode', async () => {
    const { artifactDir, candidate } = await fixture();
    const fake = createFakeCommands(candidate);
    const dependencies = publicationDependencies(fake);

    await expect(
      publishPreviewRelease({ artifactDir }, dependencies),
    ).rejects.toThrow(/exactly one/u);
    await expect(
      publishPreviewRelease(
        { artifactDir, deferFinalize: true, finalizeOnly: true },
        dependencies,
      ),
    ).rejects.toThrow(/exactly one/u);
    await expect(
      publishPreviewRelease(
        { artifactDir, deferFinalize: true, finalizeOnly: 'yes' },
        dependencies,
      ),
    ).rejects.toThrow(/must be a boolean/u);
    expect(fake.state.calls).toEqual([]);
  });

  it('publishes phase one only to preview-candidate and guards every mutation from canonical Git state', async () => {
    const { artifactDir, candidate } = await fixture();
    const fake = createFakeCommands(candidate);

    await expect(
      publishPreviewRelease(
        { artifactDir, deferFinalize: true },
        publicationDependencies(fake),
      ),
    ).resolves.toEqual({
      tag: 'v0.0.15',
      version: '0.0.15',
      published: true,
      finalized: false,
    });
    expect(fake.state.release.draft).toBe(true);
    expect(fake.state.release.assets).toHaveLength(candidate.assets.length);
    expect(fake.state.tags['preview-candidate']).toBe(VERSION);
    expect(fake.state.tags.preview).toBeUndefined();

    const npmCalls = fake.state.calls.filter(
      ({ command }) => command === 'npm',
    );
    expect(
      npmCalls.every(({ args }) =>
        args.includes('--registry=https://registry.npmjs.org'),
      ),
    ).toBe(true);
    const publish = npmCalls.find(({ args }) => args[0] === 'publish');
    expect(publish.args).toEqual([
      'publish',
      path.join(artifactDir, candidate.npmArtifact.fileName),
      '--access=public',
      '--tag=preview-candidate',
      '--provenance',
      '--ignore-scripts',
      '--registry=https://registry.npmjs.org',
    ]);
    expect(
      fake.state.calls.some(
        ({ command, args }) => command === 'gh' && args[1] === 'edit',
      ),
    ).toBe(false);
    expect(npmCalls.some(({ args }) => args[0] === 'dist-tag')).toBe(false);

    const mutationIndexes = fake.state.calls
      .map((call, index) => ({ ...call, index }))
      .filter(
        ({ command, args }) =>
          (command === 'npm' && args[0] === 'publish') ||
          (command === 'gh' && args[0] === 'release'),
      )
      .map(({ index }) => index);
    let previousMutation = -1;
    for (const mutationIndex of mutationIndexes) {
      const guardWindow = fake.state.calls.slice(
        previousMutation + 1,
        mutationIndex,
      );
      const guard = guardWindow.find(
        ({ command, args }) => command === 'git' && args[0] === 'fetch',
      );
      expect(guard.args).toEqual([
        'fetch',
        '--no-tags',
        '--force',
        '--no-write-fetch-head',
        'https://github.com/wharfie/wharfie.git',
        '+refs/tags/v0.0.15:refs/wharfie-preview-authority/tag',
        '+refs/heads/master:refs/wharfie-preview-authority/master',
      ]);
      expect(
        guardWindow.find(
          ({ command, args }) => command === 'git' && args[0] === 'merge-base',
        ).args,
      ).toEqual(['merge-base', '--is-ancestor', COMMIT, 'd'.repeat(40)]);
      previousMutation = mutationIndex;
    }
    expect(
      fake.state.calls
        .filter(({ command }) => command === 'git')
        .some(({ args }) => args.includes('origin')),
    ).toBe(false);
  });

  it('finalizes only after manual preview promotion and recovers a lost edit response', async () => {
    const { artifactDir, candidate } = await fixture();
    const fake = createFakeCommands(candidate);
    await publishPreviewRelease(
      { artifactDir, deferFinalize: true },
      publicationDependencies(fake),
    );
    fake.state.tags.preview = candidate.manifest.version;
    fake.state.failEditAfterMutation = true;
    const beforeFinalize = fake.state.calls.length;

    await expect(
      publishPreviewRelease(
        { artifactDir, finalizeOnly: true },
        publicationDependencies(fake),
      ),
    ).resolves.toMatchObject({ published: true, finalized: true });
    expect(
      mutationCalls({ calls: fake.state.calls.slice(beforeFinalize) }),
    ).toEqual([
      expect.objectContaining({
        command: 'gh',
        args: expect.arrayContaining(['edit']),
      }),
    ]);
    expect(fake.state.release.draft).toBe(false);
    expect(
      fake.state.calls.filter(
        ({ command, args }) => command === 'gh' && args[1] === 'edit',
      ),
    ).toHaveLength(1);
    expect(
      fake.state.calls.some(
        ({ command, args }) => command === 'npm' && args[0] === 'dist-tag',
      ),
    ).toBe(false);
    expect(
      fake.state.calls
        .filter(({ command, args }) => command === 'gh' && args[0] === 'api')
        .every(
          ({ args }) =>
            args.includes('--hostname') && args.includes('github.com'),
        ),
    ).toBe(true);
    expect(
      mutationCalls(fake.state)
        .filter(({ command }) => command === 'gh')
        .every(({ args }) => args.includes('github.com/wharfie/wharfie')),
    ).toBe(true);
  });

  it.each([
    [{ 'preview-candidate': VERSION }],
    [{ preview: VERSION }],
    [{ 'preview-candidate': VERSION, preview: VERSION }],
  ])(
    'recovers exact phase-one state selected by quarantine or preview (%j)',
    async (tags) => {
      const { artifactDir, candidate } = await fixture();
      const fake = createFakeCommands(candidate, {
        release: matchingRelease(candidate),
        npmVersion: matchingNpmVersion(candidate),
        tags,
      });

      await expect(
        publishPreviewRelease(
          { artifactDir, deferFinalize: true },
          publicationDependencies(fake),
        ),
      ).resolves.toMatchObject({ published: true });
      expect(mutationCalls(fake.state)).toEqual([]);
    },
  );

  it('fails closed unless finalize-only observes exact npm, reviewed promotion, and assets', async () => {
    const { artifactDir, candidate } = await fixture();
    const missingNpm = createFakeCommands(candidate, {
      release: matchingRelease(candidate),
      tags: { preview: VERSION },
    });
    await expect(
      publishPreviewRelease(
        { artifactDir, finalizeOnly: true },
        publicationDependencies(missingNpm),
      ),
    ).rejects.toThrow(/requires existing npm/u);
    expect(mutationCalls(missingNpm.state)).toEqual([]);

    const unreviewed = createFakeCommands(candidate, {
      release: matchingRelease(candidate),
      npmVersion: matchingNpmVersion(candidate),
      tags: { 'preview-candidate': VERSION },
    });
    await expect(
      publishPreviewRelease(
        { artifactDir, finalizeOnly: true },
        publicationDependencies(unreviewed),
      ),
    ).rejects.toThrow(/manually promoted npm preview dist-tag/u);
    expect(mutationCalls(unreviewed.state)).toEqual([]);

    const missingAsset = createFakeCommands(candidate, {
      release: matchingRelease(candidate, {
        assetNames: candidate.assets.slice(1).map(({ name }) => name),
      }),
      npmVersion: matchingNpmVersion(candidate),
      tags: { preview: candidate.manifest.version },
    });
    await expect(
      publishPreviewRelease(
        { artifactDir, finalizeOnly: true },
        publicationDependencies(missingAsset),
      ),
    ).rejects.toThrow(/missing assets/u);
    expect(mutationCalls(missingAsset.state)).toEqual([]);
  });

  it('fails before mutation unless a new version outranks tag and registry maximum', async () => {
    const { artifactDir, candidate } = await fixture();
    const staleTag = createFakeCommands(candidate, {
      tags: { preview: candidate.manifest.version },
      versions: ['0.0.14'],
    });
    await expect(
      publishPreviewRelease(
        { artifactDir, deferFinalize: true },
        publicationDependencies(staleTag),
      ),
    ).rejects.toThrow(/strictly newer than current preview dist-tag/u);
    expect(mutationCalls(staleTag.state)).toEqual([]);

    const staleMaximum = createFakeCommands(candidate, {
      tags: { preview: '0.0.14' },
      versions: ['0.0.14', '0.0.16'],
    });
    await expect(
      publishPreviewRelease(
        { artifactDir, deferFinalize: true },
        publicationDependencies(staleMaximum),
      ),
    ).rejects.toThrow(/strictly newer than maximum published version/u);
    expect(mutationCalls(staleMaximum.state)).toEqual([]);

    const absentTag = createFakeCommands(candidate, {
      previewTagOutput: '\n',
      versions: ['0.0.14', '0.0.15-rc.1'],
    });
    await expect(
      publishPreviewRelease(
        { artifactDir, deferFinalize: true },
        publicationDependencies(absentTag),
      ),
    ).resolves.toMatchObject({ published: true, finalized: false });
  });

  it('rejects stale recovery behind either preview or another published version', async () => {
    const { artifactDir, candidate } = await fixture();
    const newerPreview = createFakeCommands(candidate, {
      release: matchingRelease(candidate),
      npmVersion: matchingNpmVersion(candidate),
      tags: { preview: '0.0.16', 'preview-candidate': VERSION },
      versions: [VERSION],
    });
    await expect(
      publishPreviewRelease(
        { artifactDir, deferFinalize: true },
        publicationDependencies(newerPreview),
      ),
    ).rejects.toThrow(/strictly newer than current preview dist-tag/u);
    expect(mutationCalls(newerPreview.state)).toEqual([]);

    const newerVersion = createFakeCommands(candidate, {
      release: matchingRelease(candidate),
      npmVersion: matchingNpmVersion(candidate),
      tags: { 'preview-candidate': VERSION },
      versions: [VERSION, '0.0.16'],
    });
    await expect(
      publishPreviewRelease(
        { artifactDir, deferFinalize: true },
        publicationDependencies(newerVersion),
      ),
    ).rejects.toThrow(/strictly newer than maximum published version/u);
    expect(mutationCalls(newerVersion.state)).toEqual([]);
  });

  it('recovers create, upload, and publish responses lost after mutation', async () => {
    const { artifactDir, candidate } = await fixture();
    const fake = createFakeCommands(candidate, {
      failCreateAfterMutation: true,
      failUploadAfterMutation: candidate.assets[0].name,
      failPublishAfterMutation: true,
    });

    await expect(
      publishPreviewRelease(
        { artifactDir, deferFinalize: true },
        publicationDependencies(fake),
      ),
    ).resolves.toMatchObject({ published: true, finalized: false });
    expect(fake.state.release.draft).toBe(true);
    expect(fake.state.release.assets).toHaveLength(candidate.assets.length);
    expect(fake.state.tags['preview-candidate']).toBe(VERSION);
    expect(
      fake.state.calls.filter(
        ({ command, args }) => command === 'gh' && args[1] === 'create',
      ),
    ).toHaveLength(1);
    expect(
      fake.state.calls.filter(
        ({ command, args }) => command === 'gh' && args[1] === 'upload',
      ),
    ).toHaveLength(candidate.assets.length);
    expect(
      fake.state.calls.filter(
        ({ command, args }) => command === 'npm' && args[0] === 'publish',
      ),
    ).toHaveLength(1);
  });

  it('does not mistake a failed authority precondition for response loss', async () => {
    const { artifactDir, candidate } = await fixture();
    const fake = createFakeCommands(candidate, {
      failAuthorityFetchAt: 1,
      exposeReleaseOnGuardFailure: true,
    });

    await expect(
      publishPreviewRelease(
        { artifactDir, deferFinalize: true },
        publicationDependencies(fake),
      ),
    ).rejects.toThrow(/canonical authority unavailable/u);
    expect(mutationCalls(fake.state)).toEqual([]);
  });

  it('rechecks fresh GitHub draft and asset state immediately before mutation', async () => {
    const { artifactDir, candidate } = await fixture();
    const finalizedBeforePublish = createFakeCommands(candidate, {
      finalizeReleaseOnNpmViewNumber: 9,
    });
    await expect(
      publishPreviewRelease(
        { artifactDir, deferFinalize: true },
        publicationDependencies(finalizedBeforePublish),
      ),
    ).rejects.toThrow(/Final GitHub release.*without its npm version/u);
    expect(
      finalizedBeforePublish.state.calls.filter(
        ({ command, args }) => command === 'npm' && args[0] === 'publish',
      ),
    ).toHaveLength(0);

    const missingBeforeEdit = createFakeCommands(candidate, {
      release: matchingRelease(candidate),
      npmVersion: matchingNpmVersion(candidate),
      tags: { preview: VERSION },
      removeAssetOnNpmViewNumber: 5,
    });
    await expect(
      publishPreviewRelease(
        { artifactDir, finalizeOnly: true },
        publicationDependencies(missingBeforeEdit),
      ),
    ).rejects.toThrow(/missing assets/u);
    expect(
      missingBeforeEdit.state.calls.filter(
        ({ command, args }) => command === 'gh' && args[1] === 'edit',
      ),
    ).toHaveLength(0);
  });

  it('fails closed on a final GitHub release without the immutable npm version', async () => {
    const { artifactDir, candidate } = await fixture();
    const fake = createFakeCommands(candidate, {
      release: matchingRelease(candidate, { draft: false }),
    });

    await expect(
      publishPreviewRelease(
        { artifactDir, deferFinalize: true },
        publicationDependencies(fake),
      ),
    ).rejects.toThrow(/Final GitHub release.*without its npm version/u);
    expect(
      fake.state.calls.filter(
        ({ command, args }) => command === 'npm' && args[0] === 'publish',
      ),
    ).toHaveLength(0);
  });

  it('rejects an unreviewed final GitHub release still only in npm quarantine', async () => {
    const { artifactDir, candidate } = await fixture();
    const fake = createFakeCommands(candidate, {
      release: matchingRelease(candidate, { draft: false }),
      npmVersion: matchingNpmVersion(candidate),
      tags: { 'preview-candidate': VERSION },
    });

    await expect(
      publishPreviewRelease(
        { artifactDir, deferFinalize: true },
        publicationDependencies(fake),
      ),
    ).rejects.toThrow(/manually promoted npm preview dist-tag/u);
    expect(mutationCalls(fake.state)).toEqual([]);
  });

  it('rejects an external draft-to-final transition during quarantine publication', async () => {
    const { artifactDir, candidate } = await fixture();
    const fake = createFakeCommands(candidate, {
      finalizeReleaseAfterPublish: true,
    });

    await expect(
      publishPreviewRelease(
        { artifactDir, deferFinalize: true },
        publicationDependencies(fake),
      ),
    ).rejects.toThrow(/manually promoted npm preview dist-tag/u);
    expect(fake.state.npmVersion).not.toBeNull();
    expect(fake.state.tags.preview).toBeUndefined();
  });

  it('is a read-only finalize success when the exact final state already exists', async () => {
    const { artifactDir, candidate } = await fixture();
    const fake = createFakeCommands(candidate, {
      release: matchingRelease(candidate, { draft: false }),
      npmVersion: matchingNpmVersion(candidate),
      tags: { preview: candidate.manifest.version },
    });

    await publishPreviewRelease(
      { artifactDir, finalizeOnly: true },
      publicationDependencies(fake),
    );
    expect(mutationCalls(fake.state)).toEqual([]);
  });

  it.each([
    [
      'different bytes',
      (npmVersion) => {
        npmVersion.dist.integrity = 'sha512-different';
      },
      /does not match preview-release\.json/u,
    ],
    [
      'missing provenance',
      (npmVersion) => {
        delete npmVersion.dist.attestations;
      },
      /attestation metadata/u,
    ],
    [
      'noncanonical provenance host',
      (npmVersion) => {
        npmVersion.dist.attestations.url =
          'https://example.com/-/npm/v1/attestations/%40wharfie%2Fwharfie@0.0.15';
      },
      /does not match preview-release\.json/u,
    ],
  ])(
    'fails closed on existing npm state with %s',
    async (_label, mutate, error) => {
      const { artifactDir, candidate } = await fixture();
      const npmVersion = matchingNpmVersion(candidate);
      mutate(npmVersion);
      const fake = createFakeCommands(candidate, {
        release: matchingRelease(candidate),
        npmVersion,
        tags: { preview: candidate.manifest.version },
      });

      await expect(
        publishPreviewRelease(
          { artifactDir, finalizeOnly: true },
          publicationDependencies(fake),
        ),
      ).rejects.toThrow(error);
      expect(mutationCalls(fake.state)).toEqual([]);
    },
  );

  it.each([
    ['tag', { moveTagAfterFinalAssetUpload: true }, /not manifest commit/u],
    [
      'master ancestry',
      { moveMasterAfterFinalAssetUpload: true },
      /not an ancestor of canonical current master/u,
    ],
  ])(
    'rechecks canonical %s after asset uploads and before npm mutation',
    async (_label, initial, error) => {
      const { artifactDir, candidate } = await fixture();
      const fake = createFakeCommands(candidate, initial);
      await expect(
        publishPreviewRelease(
          { artifactDir, deferFinalize: true },
          publicationDependencies(fake),
        ),
      ).rejects.toThrow(error);
      expect(
        fake.state.calls.filter(
          ({ command, args }) => command === 'npm' && args[0] === 'publish',
        ),
      ).toHaveLength(0);
    },
  );

  it.each([
    ['tag', { moveTagAfterPublish: true }, /not manifest commit/u],
    [
      'master ancestry',
      { moveMasterAfterPublish: true },
      /not an ancestor of canonical current master/u,
    ],
  ])(
    'rechecks canonical %s after npm publication before phase-one success',
    async (_label, initial, error) => {
      const { artifactDir, candidate } = await fixture();
      const fake = createFakeCommands(candidate, initial);
      await expect(
        publishPreviewRelease(
          { artifactDir, deferFinalize: true },
          publicationDependencies(fake),
        ),
      ).rejects.toThrow(error);
      expect(fake.state.npmVersion).not.toBeNull();
    },
  );

  it.each([
    ['tag', { tagCommit: 'c'.repeat(40) }, /not manifest commit/u],
    [
      'master ancestry',
      { manifestOnMaster: false },
      /not an ancestor of canonical current master/u,
    ],
  ])(
    'rechecks canonical %s before reviewed finalization',
    async (_label, initial, error) => {
      const { artifactDir, candidate } = await fixture();
      const fake = createFakeCommands(candidate, {
        ...initial,
        release: matchingRelease(candidate),
        npmVersion: matchingNpmVersion(candidate),
        tags: { preview: VERSION, 'preview-candidate': VERSION },
      });
      await expect(
        publishPreviewRelease(
          { artifactDir, finalizeOnly: true },
          publicationDependencies(fake),
        ),
      ).rejects.toThrow(error);
      expect(mutationCalls(fake.state)).toEqual([]);
    },
  );

  it('fails closed on an unselected existing version or ambiguous npm read', async () => {
    const { artifactDir, candidate } = await fixture();
    const unselected = createFakeCommands(candidate, {
      release: matchingRelease(candidate),
      npmVersion: matchingNpmVersion(candidate),
    });
    await expect(
      publishPreviewRelease(
        { artifactDir, deferFinalize: true },
        publicationDependencies(unselected),
      ),
    ).rejects.toThrow(/quarantine or an already-promoted preview/u);
    expect(mutationCalls(unselected.state)).toEqual([]);

    const ambiguous = createFakeCommands(candidate, {
      release: matchingRelease(candidate),
      npmViewFailure: makeCommandFailure('network unavailable'),
    });
    await expect(
      publishPreviewRelease(
        { artifactDir, deferFinalize: true },
        publicationDependencies(ambiguous),
      ),
    ).rejects.toThrow(/network unavailable/u);
    expect(mutationCalls(ambiguous.state)).toEqual([]);

    const ambiguous404 = createFakeCommands(candidate, {
      release: matchingRelease(candidate),
      npmViewFailure: makeCommandFailure(
        'proxy E404 while returning an ambiguous 404 response',
      ),
    });
    await expect(
      publishPreviewRelease(
        { artifactDir, deferFinalize: true },
        publicationDependencies(ambiguous404),
      ),
    ).rejects.toThrow(/ambiguous 404/u);
    expect(mutationCalls(ambiguous404.state)).toEqual([]);
  });

  it('rejects a conflicting GitHub asset before any remote mutation', async () => {
    const { artifactDir, candidate } = await fixture();
    const release = matchingRelease(candidate, {
      assetNames: [candidate.assets[0].name],
    });
    release.assets[0].digest = `sha256:${'0'.repeat(64)}`;
    const fake = createFakeCommands(candidate, { release });

    await expect(
      publishPreviewRelease(
        { artifactDir, deferFinalize: true },
        publicationDependencies(fake),
      ),
    ).rejects.toThrow(/does not match local bytes/u);
    expect(mutationCalls(fake.state)).toEqual([]);
  });
});
