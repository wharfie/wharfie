/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  parsePackageSeaReceipt,
  verifyPackageSeaArtifactHandoff,
} from '../../scripts/package-sea-verification.js';
import { getPackageArtifactFileName } from '../../src/cli/app/package-artifact-file-name.js';
import { createApplicationPackageReceipt } from '../../src/cli/app/package-command-receipt.js';
import { createApplicationRevision } from '../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../src/core/runtime/artifact-record.js';
import { sha256Base64Url } from '../../src/core/runtime/content-id.js';

const APP_ID = 'package-sea-verifier';
const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});
const OUTPUT_DIR = path.resolve(os.tmpdir(), 'wharfie-package-sea-verifier');

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @param {string | Buffer} value */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @param {string} [salt] */
function makeRevision(salt = 'primary') {
  return createApplicationRevision({
    contract: {
      schemaVersion: 3,
      app: { id: APP_ID },
      cli: {
        entrypoint: {
          kind: 'node',
          path: 'src/cli.js',
          export: 'main',
        },
      },
      activities: {
        serve: {
          entrypoint: {
            kind: 'node',
            path: 'src/serve.js',
            export: 'serve',
          },
        },
      },
    },
    inputs: {
      source: {
        format: 'wharfie-source-tree-v1',
        digest: digest(`source-${salt}`),
      },
      dependencies: {
        format: 'wharfie-npm-package-lock-v3-closure-v1',
        digest: digest('dependencies'),
      },
      runtime: {
        format: 'wharfie-runtime-v1',
        digest: digest('runtime'),
      },
    },
  });
}

/** @param {ReturnType<typeof makeRevision>} revision */
function makeFixture(revision = makeRevision()) {
  const bytes = Buffer.from('synthetic relocated SEA bytes', 'utf8');
  const record = createArtifactRecord({
    bytes,
    revision,
    target: TARGET,
    provenance: {
      schemaVersion: 1,
      builder: {
        name: '@wharfie/wharfie',
        version: '0.0.15',
        runtimeDigest: clone(revision.inputs.runtime.digest),
        toolchainDigest: digest('toolchain'),
      },
      node: {
        version: TARGET.nodeVersion,
        binary: { digest: digest('node binary') },
      },
      dependencies: {
        lock: clone(revision.inputs.dependencies),
        digest: digest('dependency closure'),
      },
      signing: { mode: 'unsigned' },
    },
  });
  const fileName = getPackageArtifactFileName({
    appId: APP_ID,
    target: TARGET,
    byteDigest: record.byteDigest,
  });
  const artifactPath = path.join(OUTPUT_DIR, fileName);
  const receipt = createApplicationPackageReceipt({
    app: { id: APP_ID },
    revision,
    targets: [clone(TARGET)],
    outputDir: OUTPUT_DIR,
    artifacts: [
      {
        fileName,
        path: artifactPath,
        recordPath: `${artifactPath}.artifact.json`,
        target: clone(TARGET),
        artifactId: record.artifactId,
        revisionId: record.revisionId,
        byteDigest: clone(record.byteDigest),
        size: record.size,
        record,
      },
    ],
  });
  const manifest = {
    ...clone(revision.contract),
    targets: [clone(TARGET)],
  };
  const metadata = {
    revision: clone(revision),
    runtime: {
      schemaVersion: 1,
      kind: 'artifactRuntime',
      appId: APP_ID,
      revisionId: revision.revisionId,
      target: clone(TARGET),
    },
    artifact: {
      artifactId: record.artifactId,
      byteDigest: clone(record.byteDigest),
      size: record.size,
    },
  };
  return { bytes, record, receipt, manifest, metadata };
}

/** @param {unknown} value */
function expectDeeplyFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child);
}

describe('package SEA verification handoff', () => {
  it('joins public discovery to sidecar, bytes, and embedded authority', () => {
    const fixture = makeFixture();
    const parsed = parsePackageSeaReceipt(
      `${JSON.stringify(fixture.receipt)}\n`,
    );
    const authority = verifyPackageSeaArtifactHandoff({
      receipt: parsed,
      artifactBytes: fixture.bytes,
      artifactRecord: fixture.record,
      embeddedManifest: fixture.manifest,
      embeddedMetadata: fixture.metadata,
    });

    expect(authority.receipt).toEqual(fixture.receipt);
    expect(authority.artifact.artifactId).toBe(fixture.record.artifactId);
    expect(authority.record).toEqual(fixture.record);
    expect(authority.revision.revisionId).toBe(fixture.receipt.revisionId);
    expect(authority.runtime.target).toEqual(TARGET);
    expectDeeplyFrozen(authority);
  });

  it('rejects a sidecar that is not bound to the relocated bytes', () => {
    const fixture = makeFixture();
    expect(() =>
      verifyPackageSeaArtifactHandoff({
        receipt: fixture.receipt,
        artifactBytes: Buffer.from('different relocated bytes', 'utf8'),
        artifactRecord: fixture.record,
        embeddedManifest: fixture.manifest,
        embeddedMetadata: fixture.metadata,
      }),
    ).toThrow(/does not match/i);
  });

  it('rejects embedded metadata from another logical revision', () => {
    const fixture = makeFixture();
    const other = makeRevision('other');
    fixture.metadata.revision = clone(other);
    fixture.metadata.runtime.revisionId = other.revisionId;

    expect(() =>
      verifyPackageSeaArtifactHandoff({
        receipt: fixture.receipt,
        artifactBytes: fixture.bytes,
        artifactRecord: fixture.record,
        embeddedManifest: fixture.manifest,
        embeddedMetadata: fixture.metadata,
      }),
    ).toThrow(/must match|does not match/i);
  });

  it('rejects a syntactically valid alternate receipt revision', () => {
    const fixture = makeFixture();
    const receipt = /** @type {any} */ (clone(fixture.receipt));
    receipt.revisionId = makeRevision('other-receipt').revisionId;

    expect(() =>
      verifyPackageSeaArtifactHandoff({
        receipt,
        artifactBytes: fixture.bytes,
        artifactRecord: fixture.record,
        embeddedManifest: fixture.manifest,
        embeddedMetadata: fixture.metadata,
      }),
    ).toThrow();
  });

  it('rejects a self-consistent alternate receipt artifact identity', () => {
    const fixture = makeFixture();
    const receipt = /** @type {any} */ (clone(fixture.receipt));
    const alternateBytes = Buffer.from('alternate receipt bytes', 'utf8');
    const byteDigest = digest(alternateBytes);
    const artifact = receipt.artifacts[0];
    artifact.artifactId = `waf1_${byteDigest.value}`;
    artifact.byteDigest = byteDigest;
    artifact.size = alternateBytes.byteLength;
    artifact.fileName = getPackageArtifactFileName({
      appId: receipt.appId,
      target: artifact.target,
      byteDigest,
    });
    artifact.path = path.join(receipt.outputDir, artifact.fileName);
    artifact.recordPath = `${artifact.path}.artifact.json`;

    expect(() =>
      verifyPackageSeaArtifactHandoff({
        receipt,
        artifactBytes: fixture.bytes,
        artifactRecord: fixture.record,
        embeddedManifest: fixture.manifest,
        embeddedMetadata: fixture.metadata,
      }),
    ).toThrow();
  });

  it('rejects an altered embedded artifact observation', () => {
    const fixture = makeFixture();
    fixture.metadata.artifact.size += 1;

    expect(() =>
      verifyPackageSeaArtifactHandoff({
        receipt: fixture.receipt,
        artifactBytes: fixture.bytes,
        artifactRecord: fixture.record,
        embeddedManifest: fixture.manifest,
        embeddedMetadata: fixture.metadata,
      }),
    ).toThrow();
  });

  it('rejects altered valid manifest behavior', () => {
    const fixture = makeFixture();
    /** @type {any} */ (fixture.manifest).activities.serve.entrypoint.export =
      'alternateServe';

    expect(() =>
      verifyPackageSeaArtifactHandoff({
        receipt: fixture.receipt,
        artifactBytes: fixture.bytes,
        artifactRecord: fixture.record,
        embeddedManifest: fixture.manifest,
        embeddedMetadata: fixture.metadata,
      }),
    ).toThrow(/behavior must match/i);
  });

  it('rejects runtime and sidecar target disagreement', () => {
    const fixture = makeFixture();
    const alternateTarget = /** @type {any} */ ({
      ...clone(TARGET),
      architecture: 'arm64',
    });
    /** @type {any} */ (fixture.metadata.runtime).target = alternateTarget;
    /** @type {any} */ (fixture.manifest).targets = [clone(alternateTarget)];

    expect(() =>
      verifyPackageSeaArtifactHandoff({
        receipt: fixture.receipt,
        artifactBytes: fixture.bytes,
        artifactRecord: fixture.record,
        embeddedManifest: fixture.manifest,
        embeddedMetadata: fixture.metadata,
      }),
    ).toThrow();
  });

  it('rejects rich package results and stdout contamination', () => {
    const fixture = makeFixture();
    expect(() =>
      parsePackageSeaReceipt(
        JSON.stringify({
          ...fixture.receipt,
          revision: fixture.metadata.revision,
        }),
      ),
    ).toThrow(/must contain exactly/i);
    expect(() =>
      parsePackageSeaReceipt(
        `build diagnostic\n${JSON.stringify(fixture.receipt)}\n`,
      ),
    ).toThrow(/exactly one JSON document/i);
  });

  it('keeps both native consumers on the public receipt boundary', () => {
    const verifierSource = readFileSync(
      new URL('../../scripts/verify-package-sea.js', import.meta.url),
      'utf8',
    );

    expect(verifierSource.match(/parsePackageSeaReceipt\(/g)).toHaveLength(2);
    expect(
      verifierSource.match(/verifyPackageSeaArtifactHandoff\(\{/g),
    ).toHaveLength(2);
    expect(verifierSource).not.toMatch(/packageResult\.revision/);
    expect(verifierSource).not.toMatch(/packagedArtifact\.revisionId/);
    expect(verifierSource).not.toMatch(/packagedArtifact\.record\b/);
  });
});
