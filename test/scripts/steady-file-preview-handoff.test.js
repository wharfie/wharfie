import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import {
  STEADY_FILE_PREVIEW_HANDOFF_CHECKSUM_FILES,
  STEADY_FILE_PREVIEW_HANDOFF_FILES,
  STEADY_FILE_PREVIEW_STARTER_FILES,
  createSteadyFilePreviewHandoff,
  stringifySteadyFilePreviewHandoff,
  validateSteadyFilePreviewHandoff,
  validateSteadyFilePreviewHandoffDocument,
  writeSteadyFilePreviewHandoff,
} from '../../scripts/steady-file-preview-handoff.js';

const COMMIT = 'ab'.repeat(20);
const MACHINE_ID = '12'.repeat(16);
const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'arm64',
  libc: 'glibc',
});
/** @type {string[]} */
const ownedRoots = [];

/** @param {string | Buffer} value */
function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** @param {string | Buffer} value */
function digest(value) {
  return {
    algorithm: 'sha256',
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

/** @param {string} seed */
function revisionId(seed) {
  return `wrv1_${createHash('sha256').update(seed).digest('base64url')}`;
}

/** @param {unknown} value */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

function createOwnedRoot() {
  const parent = process.env.WHARFIE_TEST_WORKSPACE || os.tmpdir();
  const root = mkdtempSync(path.join(parent, 'steady-file-handoff-'));
  ownedRoots.push(root);
  mkdirSync(path.join(root, 'source'));
  mkdirSync(path.join(root, 'target'));
  return root;
}

/** @param {string} root @param {'source'|'target'} label @param {Buffer} bytes */
function stageArtifact(root, label, bytes) {
  const byteDigest = digest(bytes);
  const artifact = {
    path: `${label}/app`,
    recordPath: `${label}/artifact-record.json`,
    artifactId: `waf1_${byteDigest.value}`,
    revisionId: revisionId(label),
    byteDigest,
    size: bytes.length,
    target: TARGET,
    sha256: sha256Hex(bytes),
  };
  const appPath = path.join(root, label, 'app');
  writeFileSync(appPath, bytes, { mode: 0o700 });
  chmodSync(appPath, 0o700);
  writeFileSync(
    path.join(root, label, 'artifact-record.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        kind: 'artifactRecord',
        artifactId: artifact.artifactId,
        byteDigest: artifact.byteDigest,
        size: artifact.size,
        appId: 'steady-file-demo',
        revisionId: artifact.revisionId,
        target: artifact.target,
        targetId: 'node-v24.13.1-linux-arm64-glibc',
        format: { kind: 'node-sea', version: 1 },
        provenance: {},
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  return artifact;
}

function createFixture() {
  const root = createOwnedRoot();
  const source = stageArtifact(
    root,
    'source',
    Buffer.from('source steady-file SEA\n'),
  );
  const target = stageArtifact(
    root,
    'target',
    Buffer.from('target steady-file SEA\n'),
  );
  const inputBytes = Buffer.from('literal steady-file input\n');
  const inputSha256 = sha256Hex(inputBytes);
  const beforeSource = 'export const DURABLE_STABILITY_WINDOW_MS = 60_000;';
  const afterSource = 'export const DURABLE_STABILITY_WINDOW_MS = 120_000;';
  const beforeSha256 = sha256Hex(beforeSource);
  const starterFiles = Object.fromEntries(
    STEADY_FILE_PREVIEW_STARTER_FILES.map((relativePath) => [
      relativePath,
      relativePath === 'file-stability.js'
        ? beforeSha256
        : sha256Hex(`starter:${relativePath}`),
    ]),
  );
  const fingerprint = {
    bytes: inputBytes.length,
    sha256: inputSha256,
    readStable: true,
  };
  const input = {
    schemaVersion: 1,
    kind: 'wharfie.steady-file-preview.handoff',
    commit: COMMIT,
    builder: {
      machineId: MACHINE_ID,
      toolchain: { node: '24.13.1', npm: '11.12.0' },
    },
    package: {
      name: '@wharfie/wharfie',
      version: '0.0.15',
      tarballSha256: sha256Hex('package tarball'),
      packedFileCount: 293,
      installedStarter: 'examples/steady-file',
    },
    starter: { files: starterFiles },
    mutation: {
      path: 'file-stability.js',
      from: beforeSource,
      to: afterSource,
      beforeSha256,
      afterSha256: sha256Hex(afterSource),
    },
    ordinary: {
      input: { bytes: inputBytes.length, sha256: inputSha256 },
      expected: {
        stable: true,
        baseline: fingerprint,
        current: { ...fingerprint },
      },
      equivalent: true,
    },
    artifacts: { source, target },
  };
  return { root, input };
}

afterEach(() => {
  while (ownedRoots.length > 0) {
    const ownedRoot = ownedRoots.pop();
    if (ownedRoot) {
      rmSync(ownedRoot, { recursive: true, force: true });
    }
  }
});

describe('steady-file developer-preview handoff', () => {
  it('creates, canonicalizes, freezes, and serializes the path-independent document', () => {
    const { input } = createFixture();
    const handoff = createSteadyFilePreviewHandoff(input);

    expect(handoff).toEqual(input);
    expect(handoff).not.toBe(input);
    expectDeepFrozen(handoff);
    expect(handoff.ordinary.expected).not.toHaveProperty('path');
    expect(handoff.artifacts.source.path).toBe('source/app');
    expect(handoff.artifacts.target.recordPath).toBe(
      'target/artifact-record.json',
    );

    const serialized = stringifySteadyFilePreviewHandoff(handoff);
    expect(serialized.endsWith('\n')).toBe(true);
    expect(serialized.indexOf('\n')).toBe(serialized.length - 1);
    expect(
      validateSteadyFilePreviewHandoffDocument(JSON.parse(serialized)),
    ).toEqual(handoff);
  });

  it('writes and independently reopens the exact checksummed handoff', () => {
    const { root, input } = createFixture();
    const written = writeSteadyFilePreviewHandoff(root, input);
    const reopened = validateSteadyFilePreviewHandoff(root);

    expect(reopened).toEqual(written);
    expect(reopened.handoff).toEqual(createSteadyFilePreviewHandoff(input));
    expect(Object.keys(reopened.files).sort()).toEqual(
      [...STEADY_FILE_PREVIEW_HANDOFF_FILES].sort(),
    );
    expectDeepFrozen(reopened);

    const checksumLines = readFileSync(path.join(root, 'SHA256SUMS'), 'utf8')
      .trimEnd()
      .split('\n');
    expect(checksumLines.map((line) => line.slice(66))).toEqual(
      STEADY_FILE_PREVIEW_HANDOFF_CHECKSUM_FILES,
    );
  });

  it('rejects expanded schemas, accessors, and noncanonical handoff paths', () => {
    const { input } = createFixture();
    expect(() =>
      createSteadyFilePreviewHandoff({ ...input, extra: true }),
    ).toThrow(/exact required keys/i);
    expect(() =>
      createSteadyFilePreviewHandoff({
        ...input,
        artifacts: {
          ...input.artifacts,
          source: { ...input.artifacts.source, path: '/tmp/source/app' },
        },
      }),
    ).toThrow(/canonical relative/i);

    let invoked = false;
    const accessor = { ...input };
    Object.defineProperty(accessor, 'builder', {
      enumerable: true,
      get() {
        invoked = true;
        return input.builder;
      },
    });
    expect(() => createSteadyFilePreviewHandoff(accessor)).toThrow(
      /plain JSON property/i,
    );
    expect(invoked).toBe(false);
  });

  it('rejects inconsistent ordinary evidence, mutation, and A/B identity', () => {
    const { input } = createFixture();
    expect(() =>
      createSteadyFilePreviewHandoff({
        ...input,
        ordinary: {
          ...input.ordinary,
          expected: {
            ...input.ordinary.expected,
            current: {
              ...input.ordinary.expected.current,
              sha256: sha256Hex('other input'),
            },
          },
        },
      }),
    ).toThrow(/fingerprints must match/i);
    expect(() =>
      createSteadyFilePreviewHandoff({
        ...input,
        mutation: {
          ...input.mutation,
          afterSha256: input.mutation.beforeSha256,
        },
      }),
    ).toThrow(/changed starter file/i);
    expect(() =>
      createSteadyFilePreviewHandoff({
        ...input,
        artifacts: {
          source: input.artifacts.source,
          target: {
            ...input.artifacts.source,
            path: 'target/app',
            recordPath: 'target/artifact-record.json',
          },
        },
      }),
    ).toThrow(/distinct revisions/i);
  });

  it('rejects artifact tampering and sidecar disagreement', () => {
    const first = createFixture();
    writeSteadyFilePreviewHandoff(first.root, first.input);
    writeFileSync(
      path.join(first.root, 'source', 'app'),
      'tampered source SEA\n',
      { mode: 0o700 },
    );
    expect(() => validateSteadyFilePreviewHandoff(first.root)).toThrow(
      /checksum does not match source\/app/i,
    );

    const second = createFixture();
    writeSteadyFilePreviewHandoff(second.root, second.input);
    const recordPath = path.join(second.root, 'target', 'artifact-record.json');
    const record = JSON.parse(readFileSync(recordPath, 'utf8'));
    record.revisionId = revisionId('different');
    writeFileSync(recordPath, `${JSON.stringify(record)}\n`);
    const checksumPath = path.join(second.root, 'SHA256SUMS');
    const sums = readFileSync(checksumPath, 'utf8').replace(
      /^[0-9a-f]{64} {2}target\/artifact-record\.json$/mu,
      `${sha256Hex(readFileSync(recordPath))}  target/artifact-record.json`,
    );
    writeFileSync(checksumPath, sums);
    expect(() => validateSteadyFilePreviewHandoff(second.root)).toThrow(
      /must match the handoff artifact observation/i,
    );
  });

  it('rejects symlinks and files outside the exact allowlist', () => {
    const symlinkFixture = createFixture();
    writeSteadyFilePreviewHandoff(symlinkFixture.root, symlinkFixture.input);
    const targetRecord = path.join(
      symlinkFixture.root,
      'target',
      'artifact-record.json',
    );
    unlinkSync(targetRecord);
    symlinkSync(
      path.join(symlinkFixture.root, 'source', 'artifact-record.json'),
      targetRecord,
    );
    expect(() => validateSteadyFilePreviewHandoff(symlinkFixture.root)).toThrow(
      /must not be a symlink/i,
    );

    const extraFixture = createFixture();
    writeSteadyFilePreviewHandoff(extraFixture.root, extraFixture.input);
    writeFileSync(path.join(extraFixture.root, 'unexpected.log'), 'x');
    expect(() => validateSteadyFilePreviewHandoff(extraFixture.root)).toThrow(
      /exact allowlist/i,
    );
  });

  it('does not publish metadata when staged artifact bytes are inconsistent', () => {
    const { root, input } = createFixture();
    writeFileSync(path.join(root, 'source', 'app'), 'wrong bytes\n', {
      mode: 0o700,
    });

    expect(() => writeSteadyFilePreviewHandoff(root, input)).toThrow(
      /application bytes do not match/i,
    );
    expect(() => readFileSync(path.join(root, 'handoff.json'))).toThrow(
      /ENOENT/u,
    );
    expect(() => readFileSync(path.join(root, 'SHA256SUMS'))).toThrow(
      /ENOENT/u,
    );
  });
});
