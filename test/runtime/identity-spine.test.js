/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';

import {
  APPLICATION_REVISION_ID_DOMAIN,
  APPLICATION_REVISION_ID_PREFIX,
  createApplicationRevision,
  getApplicationRevisionId,
  validateApplicationRevision,
} from '../../src/core/runtime/application-revision.js';
import {
  ARTIFACT_ID_PREFIX,
  createArtifactRecord,
  validateArtifactRecord,
} from '../../src/core/runtime/artifact-record.js';
import {
  getBuildTargetId,
  validateBuildTarget,
} from '../../src/core/runtime/build-target.js';
import {
  assertDomainSeparatedSha256Id,
  assertSha256Base64Url,
  createCanonicalJsonSha256Id,
  createDomainSeparatedSha256Id,
  createSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';

const linuxTarget = {
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
};

const darwinTarget = {
  nodeVersion: '24.13.1',
  platform: 'darwin',
  architecture: 'arm64',
};

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/**
 * @param {string | Buffer | Uint8Array | ArrayBuffer} value
 * @returns {{algorithm: 'sha256', value: string}}
 */
function digest(value) {
  return {
    algorithm: 'sha256',
    value: sha256Base64Url(value),
  };
}

function makeContract() {
  return {
    schemaVersion: 2,
    app: { id: 'identity-demo' },
    cli: {
      entrypoint: {
        kind: 'node',
        path: 'src/cli.js',
        export: 'main',
      },
    },
    resources: {
      db: { adapter: 'vanilla', options: { path: '.wharfie/state' } },
    },
    activities: {
      start: {
        entrypoint: {
          kind: 'node',
          path: 'src/start.js',
          export: 'start',
        },
      },
    },
  };
}

/**
 * Mutable input fixture used by negative-path tests.
 *
 * @returns {Record<string, any>}
 */
function makeInputs() {
  return {
    source: {
      format: 'wharfie-source-tree-v1',
      digest: digest('source-tree'),
    },
    dependencies: {
      format: 'npm-package-lock-v3',
      digest: digest('dependency-lock'),
    },
    runtime: {
      format: 'wharfie-runtime-v1',
      digest: digest('runtime-input'),
    },
    assets: [
      { name: 'model', digest: digest('model-asset') },
      { name: 'prompt', digest: digest('prompt-asset') },
    ],
  };
}

function makeRevision() {
  return createApplicationRevision({
    contract: makeContract(),
    inputs: makeInputs(),
  });
}

/**
 * @param {ReturnType<typeof makeRevision>} revision
 * @param {{nodeVersion: string, platform: string, architecture: string, libc?: string}} [target=linuxTarget]
 * @returns {any}
 */
function makeProvenance(revision, target = linuxTarget) {
  return {
    schemaVersion: 1,
    builder: {
      name: '@wharfie/wharfie',
      version: '0.0.15',
      runtimeDigest: clone(revision.inputs.runtime.digest),
      toolchainDigest: digest('toolchain'),
    },
    node: {
      version: target.nodeVersion,
      archive: {
        fileName: `node-v${target.nodeVersion}-${target.platform}-${target.architecture}.tar.gz`,
        digest: digest('node-archive'),
      },
      binary: { digest: digest('node-binary') },
    },
    dependencies: { digest: digest('target-dependency-closure') },
    signing: { mode: 'unsigned' },
  };
}

describe('content identities', () => {
  it('addresses exact bytes with unpadded base64url SHA-256', () => {
    const bytes = Buffer.from('final artifact bytes\0', 'utf8');
    const expectedDigest = createHash('sha256')
      .update(bytes)
      .digest('base64url');

    expect(sha256Base64Url(bytes)).toBe(expectedDigest);
    expect(createSha256Id({ prefix: ARTIFACT_ID_PREFIX, payload: bytes })).toBe(
      `waf1_${expectedDigest}`,
    );
    expect(() => assertSha256Base64Url(expectedDigest)).not.toThrow();
    expect(() => assertSha256Base64Url(`${expectedDigest}=`)).toThrow(
      /unpadded base64url/i,
    );
  });

  it('rejects noncanonical base64url aliases with non-zero trailing pad bits', () => {
    const digestValue = sha256Base64Url('canonical digest');
    const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const finalCharacterIndex = alphabet.indexOf(
      digestValue[digestValue.length - 1],
    );
    const trailingAlias = alphabet[finalCharacterIndex + 1];
    const aliasedDigest = `${digestValue.slice(0, -1)}${trailingAlias}`;

    expect(finalCharacterIndex % 4).toBe(0);
    expect(Buffer.from(aliasedDigest, 'base64url')).toEqual(
      Buffer.from(digestValue, 'base64url'),
    );
    expect(() => assertSha256Base64Url(aliasedDigest)).toThrow(
      /unpadded base64url/i,
    );
    expect(() =>
      assertDomainSeparatedSha256Id(`wts1_${aliasedDigest}`, 'wts1'),
    ).toThrow(/canonical.*base64url SHA-256/i);
  });

  it('domain-separates semantic identities and canonicalizes JSON keys', () => {
    const first = createDomainSeparatedSha256Id({
      domain: 'wharfie:test:first:v1',
      prefix: 'wts1',
      payload: 'same payload',
    });
    const second = createDomainSeparatedSha256Id({
      domain: 'wharfie:test:second:v1',
      prefix: 'wts1',
      payload: 'same payload',
    });
    expect(first).not.toBe(second);
    expect(first).toMatch(/^wts1_[A-Za-z0-9_-]{43}$/);
    expect(() => assertDomainSeparatedSha256Id(first, 'wts1')).not.toThrow();

    expect(
      createCanonicalJsonSha256Id({
        domain: 'wharfie:test:json:v1',
        prefix: 'wjs1',
        value: { z: 1, a: { d: 2, b: 3 } },
      }),
    ).toBe(
      createCanonicalJsonSha256Id({
        domain: 'wharfie:test:json:v1',
        prefix: 'wjs1',
        value: { a: { b: 3, d: 2 }, z: 1 },
      }),
    );
  });
});

describe('canonical build targets', () => {
  it('validates and independently clones exact targets', () => {
    const input = clone(linuxTarget);
    const target = validateBuildTarget(input);

    expect(target).toEqual(linuxTarget);
    expect(getBuildTargetId(target)).toBe('node-v24.13.1-linux-x64-glibc');
    input.nodeVersion = '0.0.0';
    expect(target.nodeVersion).toBe('24.13.1');
    expect(getBuildTargetId(darwinTarget)).toBe('node-v24.13.1-darwin-arm64');
  });

  it.each([
    [
      { ...linuxTarget, nodeVersion: '24' },
      /exact canonical semantic version/i,
    ],
    [
      { ...linuxTarget, nodeVersion: '24.13.1-alpha.1' },
      /exact canonical semantic version/i,
    ],
    [
      { ...linuxTarget, nodeVersion: '24.13.1+custom' },
      /exact canonical semantic version/i,
    ],
    [{ ...linuxTarget, platform: 'freebsd' }, /platform must be/i],
    [{ ...linuxTarget, architecture: 'amd64' }, /architecture must be/i],
    [
      { ...linuxTarget, platform: 'darwin' },
      /libc is supported only for Linux/i,
    ],
    [
      { ...linuxTarget, libc: undefined },
      /unsupported undefined|libc must be 'glibc'/i,
    ],
    [{ ...linuxTarget, extra: true }, /target\.extra is not supported/i],
  ])('rejects a noncanonical target %#', (target, expected) => {
    expect(() => validateBuildTarget(target)).toThrow(expected);
  });
});

describe('ApplicationRevisionV1', () => {
  it('creates and validates a recomputed target-independent revision', () => {
    const revision = makeRevision();
    expect(revision.revisionId).toMatch(/^wrv1_[A-Za-z0-9_-]{43}$/);
    expect(revision.revisionId).toBe(
      getApplicationRevisionId({
        contract: revision.contract,
        inputs: revision.inputs,
      }),
    );
    expect(() =>
      assertDomainSeparatedSha256Id(
        revision.revisionId,
        APPLICATION_REVISION_ID_PREFIX,
      ),
    ).not.toThrow();
    expect(validateApplicationRevision(revision)).toEqual(revision);
    expect(Object.isFrozen(revision)).toBe(true);
    expect(Object.isFrozen(revision.inputs.source.digest)).toBe(true);

    const expected = createHash('sha256')
      .update(APPLICATION_REVISION_ID_DOMAIN, 'utf8')
      .update('\0', 'utf8');
    expect(expected).toBeDefined();
  });

  it('is stable across JSON object order and artifact target additions', () => {
    const first = makeRevision();
    const reorderedContract = {
      activities: clone(first.contract.activities),
      resources: clone(first.contract.resources),
      cli: clone(first.contract.cli),
      app: clone(first.contract.app),
      schemaVersion: 2,
    };
    const second = createApplicationRevision({
      contract: reorderedContract,
      inputs: {
        assets: clone(first.inputs.assets),
        runtime: clone(first.inputs.runtime),
        dependencies: clone(first.inputs.dependencies),
        source: clone(first.inputs.source),
      },
    });

    expect(second.revisionId).toBe(first.revisionId);
    expect(
      createArtifactRecord({
        bytes: Buffer.from('linux artifact'),
        revision: first,
        target: linuxTarget,
        provenance: makeProvenance(first, linuxTarget),
      }).revisionId,
    ).toBe(first.revisionId);
    expect(
      createArtifactRecord({
        bytes: Buffer.from('darwin artifact'),
        revision: first,
        target: darwinTarget,
        provenance: makeProvenance(first, darwinTarget),
      }).revisionId,
    ).toBe(first.revisionId);
  });

  it.each([
    ['source', 'changed source'],
    ['dependencies', 'changed dependency lock'],
    ['runtime', 'changed runtime'],
  ])('changes identity when the locked %s digest changes', (name, changed) => {
    const baseline = makeRevision();
    const inputs = makeInputs();
    inputs[name].digest = digest(changed);
    const changedRevision = createApplicationRevision({
      contract: makeContract(),
      inputs,
    });
    expect(changedRevision.revisionId).not.toBe(baseline.revisionId);
  });

  it('changes identity when a behavior-bearing asset changes', () => {
    const baseline = makeRevision();
    const inputs = makeInputs();
    inputs.assets[0].digest = digest('changed model');
    const changed = createApplicationRevision({
      contract: makeContract(),
      inputs,
    });
    expect(changed.revisionId).not.toBe(baseline.revisionId);
  });

  it('rejects target-bearing contracts and noncanonical input locks', () => {
    expect(() =>
      createApplicationRevision({
        contract: { ...makeContract(), targets: [linuxTarget] },
        inputs: makeInputs(),
      }),
    ).toThrow(/targets is not part of a logical application revision/i);

    const unsortedInputs = makeInputs();
    unsortedInputs.assets.reverse();
    expect(() =>
      createApplicationRevision({
        contract: makeContract(),
        inputs: unsortedInputs,
      }),
    ).toThrow(/assets must contain unique assets sorted by name/i);

    const wrongAlgorithm = makeInputs();
    wrongAlgorithm.source.digest.algorithm = 'sha512';
    expect(() =>
      createApplicationRevision({
        contract: makeContract(),
        inputs: wrongAlgorithm,
      }),
    ).toThrow(/algorithm must be 'sha256'/i);
  });

  it('fails closed when a serialized identity or body is changed', () => {
    const revision = makeRevision();
    const wrongId = clone(revision);
    wrongId.revisionId = createDomainSeparatedSha256Id({
      domain: 'wharfie:revision:v1',
      prefix: 'wrv1',
      payload: 'different revision',
    });
    expect(() => validateApplicationRevision(wrongId)).toThrow(
      /does not match the canonical contract and locked inputs/i,
    );

    const extraField = { ...clone(revision), createdAt: 'now' };
    expect(() => validateApplicationRevision(extraField)).toThrow(
      /createdAt is not supported/i,
    );
  });
});

describe('ArtifactRecordV1', () => {
  it('binds exact final bytes to one revision, app, target, and provenance', () => {
    const revision = makeRevision();
    const bytes = Buffer.from('signed final SEA bytes\0', 'utf8');
    const provenance = makeProvenance(revision);
    const record = createArtifactRecord({
      bytes,
      revision,
      target: linuxTarget,
      provenance,
    });

    const expectedDigest = createHash('sha256')
      .update(bytes)
      .digest('base64url');
    expect(record).toMatchObject({
      schemaVersion: 1,
      kind: 'artifactRecord',
      artifactId: `waf1_${expectedDigest}`,
      byteDigest: { algorithm: 'sha256', value: expectedDigest },
      size: bytes.length,
      appId: 'identity-demo',
      revisionId: revision.revisionId,
      target: linuxTarget,
      targetId: 'node-v24.13.1-linux-x64-glibc',
      format: { kind: 'node-sea', version: 1 },
    });
    expect(validateArtifactRecord(record, { bytes, revision })).toEqual(record);
  });

  it('uses only final bytes for artifactId while retaining strict provenance', () => {
    const revision = makeRevision();
    const bytes = Buffer.from('same final bytes');
    const first = createArtifactRecord({
      bytes,
      revision,
      target: linuxTarget,
      provenance: makeProvenance(revision),
    });
    const alternateProvenance = makeProvenance(revision);
    alternateProvenance.builder.toolchainDigest = digest('other toolchain');
    const second = createArtifactRecord({
      bytes,
      revision,
      target: linuxTarget,
      provenance: alternateProvenance,
    });

    expect(second.artifactId).toBe(first.artifactId);
    expect(second.provenance).not.toEqual(first.provenance);
  });

  it('rejects byte, revision, app, target, and digest mismatches', () => {
    const revision = makeRevision();
    const bytes = Buffer.from('artifact bytes');
    const record = createArtifactRecord({
      bytes,
      revision,
      target: linuxTarget,
      provenance: makeProvenance(revision),
    });

    expect(() =>
      validateArtifactRecord(record, {
        bytes: Buffer.from('tampered artifact bytes'),
        revision,
      }),
    ).toThrow(/artifactId does not match its trusted inputs/i);

    const wrongApp = { ...clone(record), appId: 'other-app' };
    expect(() => validateArtifactRecord(wrongApp, { bytes, revision })).toThrow(
      /appId does not match its trusted inputs/i,
    );

    const wrongTarget = { ...clone(record), targetId: 'wrong-target' };
    expect(() =>
      validateArtifactRecord(wrongTarget, { bytes, revision }),
    ).toThrow(/targetId does not match the canonical target/i);

    const wrongDigest = clone(record);
    wrongDigest.byteDigest = digest('not the artifact');
    expect(() =>
      validateArtifactRecord(wrongDigest, { bytes, revision }),
    ).toThrow(/byteDigest does not match the exact artifact bytes/i);
  });

  it('cross-checks runtime and Node provenance and rejects unknown fields', () => {
    const revision = makeRevision();
    const bytes = Buffer.from('artifact bytes');

    const wrongRuntime = makeProvenance(revision);
    wrongRuntime.builder.runtimeDigest = digest('other runtime');
    expect(() =>
      createArtifactRecord({
        bytes,
        revision,
        target: linuxTarget,
        provenance: wrongRuntime,
      }),
    ).toThrow(/runtimeDigest must match the owning revision/i);

    const wrongNode = makeProvenance(revision);
    wrongNode.node.version = '24.13.0';
    expect(() =>
      createArtifactRecord({
        bytes,
        revision,
        target: linuxTarget,
        provenance: wrongNode,
      }),
    ).toThrow(/node\.version must equal target\.nodeVersion/i);

    const extra = makeProvenance(revision);
    extra.signing = { mode: 'unsigned', certificate: 'not-allowed' };
    expect(() =>
      createArtifactRecord({
        bytes,
        revision,
        target: linuxTarget,
        provenance: extra,
      }),
    ).toThrow(/signing\.certificate is not supported/i);
  });

  it('supports non-secret identity signing provenance', () => {
    const revision = makeRevision();
    const provenance = makeProvenance(revision);
    provenance.signing = {
      mode: 'identity',
      signer: 'Developer ID Application: Example Org',
    };
    const record = createArtifactRecord({
      bytes: Buffer.from('signed bytes'),
      revision,
      target: darwinTarget,
      provenance: {
        ...provenance,
        node: {
          ...provenance.node,
          version: darwinTarget.nodeVersion,
        },
      },
    });

    expect(record.provenance.signing).toEqual(provenance.signing);
  });

  it('records a verified local Node binary without inventing an archive', () => {
    const revision = makeRevision();
    const provenance = makeProvenance(revision);
    delete provenance.node.archive;

    const record = createArtifactRecord({
      bytes: Buffer.from('local node artifact'),
      revision,
      target: linuxTarget,
      provenance,
    });

    expect(record.provenance.node).toEqual({
      version: linuxTarget.nodeVersion,
      binary: { digest: provenance.node.binary.digest },
    });
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.provenance.node)).toBe(true);
  });

  it('does not coerce a string into artifact bytes', () => {
    const revision = makeRevision();
    expect(() =>
      createArtifactRecord({
        bytes: 'not an exact byte container',
        revision,
        target: linuxTarget,
        provenance: makeProvenance(revision),
      }),
    ).toThrow(/Buffer, Uint8Array, or ArrayBuffer/i);
  });
});
