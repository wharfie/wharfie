/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import {
  assertCandidatePackage,
  assertRegistryAuditProvenance,
  assertRegistryLock,
  assertRegistryReleaseManifest,
  assertStarterMetadata,
  PACKAGE_NAME,
  parsePreviewConsumerArgs,
  PROOF_PREFIX,
  REQUIRED_STARTER_FILES,
  SUPPORTED_NODE_RANGE,
} from '../../scripts/verify-preview-consumer.js';

const COMMIT = 'a'.repeat(40);
const SLSA_PROVENANCE_V1 = 'https://slsa.dev/provenance/v1';
const INTEGRITY = `sha512-${Buffer.alloc(64, 0xa5).toString('base64')}`;

const PACKAGE_METADATA = Object.freeze({
  name: PACKAGE_NAME,
  version: '0.0.15',
  engines: { node: SUPPORTED_NODE_RANGE },
});

function makeStarterMetadata(overrides = {}) {
  return {
    name: 'wharfie-hello-world-demo',
    version: '0.0.0',
    private: true,
    type: 'module',
    engines: { node: SUPPORTED_NODE_RANGE },
    scripts: { demo: 'node ./scripts/demo.js' },
    devDependencies: { [PACKAGE_NAME]: PACKAGE_METADATA.version },
    ...overrides,
  };
}

function makeCandidate(overrides = {}) {
  return {
    name: PACKAGE_NAME,
    version: PACKAGE_METADATA.version,
    integrity: INTEGRITY,
    files: REQUIRED_STARTER_FILES.map((relativePath) => ({
      path: `examples/hello-world/${relativePath}`,
    })),
    ...overrides,
  };
}

/**
 * @param {Record<string, any>} [overrides]
 * @returns {Record<string, any>}
 */
function makeRegistryManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'wharfie.preview-release',
    package: PACKAGE_NAME,
    version: PACKAGE_METADATA.version,
    tag: `v${PACKAGE_METADATA.version}`,
    source: {
      repository: 'https://github.com/wharfie/wharfie',
      commit: COMMIT,
    },
    artifacts: [
      {
        kind: 'npm-package',
        package: PACKAGE_NAME,
        version: PACKAGE_METADATA.version,
        publication: 'npm-preview',
        integrity: INTEGRITY,
        npmShasum: 'a'.repeat(40),
      },
    ],
    ...overrides,
  };
}

/**
 * @param {Record<string, any>} [manifest]
 * @returns {Record<string, any>}
 */
function makeProvenanceStatement(manifest = makeRegistryManifest()) {
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [
      {
        name: `pkg:npm/%40wharfie/wharfie@${manifest.version}`,
        digest: {
          sha512: Buffer.from(
            manifest.artifacts[0].integrity.slice('sha512-'.length),
            'base64',
          ).toString('hex'),
        },
      },
    ],
    predicateType: SLSA_PROVENANCE_V1,
    predicate: {
      buildDefinition: {
        buildType:
          'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
        externalParameters: {
          workflow: {
            ref: `refs/tags/${manifest.tag}`,
            repository: manifest.source.repository,
            path: '.github/workflows/release-preview.yml',
          },
        },
        internalParameters: {
          github: {
            event_name: 'push',
            repository_id: '123',
            repository_owner_id: '456',
          },
        },
        resolvedDependencies: [
          {
            uri: `git+${manifest.source.repository}@refs/tags/${manifest.tag}`,
            digest: { gitCommit: manifest.source.commit },
          },
        ],
      },
      runDetails: {
        builder: {
          id: 'https://github.com/actions/runner/github-hosted',
        },
        metadata: {
          invocationId:
            'https://github.com/wharfie/wharfie/actions/runs/123/attempts/1',
        },
      },
    },
  };
}

/**
 * @param {{
 *   manifest?: Record<string, any>,
 *   mutateStatement?: (statement: Record<string, any>) => void,
 *   payload?: string,
 * }} [options]
 * @returns {Record<string, any>}
 */
function makeSignatureAudit(options = {}) {
  const manifest = options.manifest || makeRegistryManifest();
  const statement = makeProvenanceStatement(manifest);
  options.mutateStatement?.(statement);
  const payload =
    options.payload === undefined
      ? Buffer.from(JSON.stringify(statement)).toString('base64')
      : options.payload;
  return {
    invalid: [],
    missing: [],
    verified: [
      {
        name: PACKAGE_NAME,
        version: manifest.version,
        location: `node_modules/${PACKAGE_NAME}`,
        registry: 'https://registry.npmjs.org/',
        attestations: {
          url: `https://registry.npmjs.org/-/npm/v1/attestations/${encodeURIComponent(PACKAGE_NAME)}@${manifest.version}`,
          provenance: { predicateType: SLSA_PROVENANCE_V1 },
        },
        attestationBundles: [
          {
            predicateType: SLSA_PROVENANCE_V1,
            bundle: {
              mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
              dsseEnvelope: {
                payloadType: 'application/vnd.in-toto+json',
                payload,
                signatures: [{ keyid: '', sig: 'verified-signature' }],
              },
              verificationMaterial: {
                certificate: { rawBytes: 'verified-certificate' },
                tlogEntries: [{ integratedTime: '1' }],
              },
            },
          },
        ],
      },
    ],
  };
}

describe('preview consumer contract', () => {
  it('requires one clean candidate tarball path', () => {
    expect(
      parsePreviewConsumerArgs(['--candidate-tarball', '/tmp/candidate.tgz']),
    ).toEqual({ candidateTarball: '/tmp/candidate.tgz' });
    expect(
      parsePreviewConsumerArgs([
        '--registry-manifest',
        '/tmp/preview-release.json',
      ]),
    ).toEqual({ registryManifest: '/tmp/preview-release.json' });
    expect(() => parsePreviewConsumerArgs([])).toThrow(/--candidate-tarball/u);
    expect(() => parsePreviewConsumerArgs(['--candidate-tarball', ''])).toThrow(
      /--candidate-tarball/u,
    );
  });

  it('binds a registry install and generated lock to manifest integrity', () => {
    const integrity = makeCandidate().integrity;
    const manifest = makeRegistryManifest();
    const artifact = assertRegistryReleaseManifest(manifest, PACKAGE_METADATA);
    expect(artifact.integrity).toBe(integrity);
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': {
          devDependencies: { [PACKAGE_NAME]: PACKAGE_METADATA.version },
        },
        [`node_modules/${PACKAGE_NAME}`]: {
          version: PACKAGE_METADATA.version,
          integrity,
          resolved:
            'https://registry.npmjs.org/@wharfie/wharfie/-/wharfie-0.0.15.tgz',
        },
      },
    };
    expect(() =>
      assertRegistryLock(lock, PACKAGE_METADATA.version, integrity),
    ).not.toThrow();
    lock.packages[`node_modules/${PACKAGE_NAME}`].integrity = makeCandidate({
      integrity: 'sha512-other',
    }).integrity;
    expect(() =>
      assertRegistryLock(lock, PACKAGE_METADATA.version, integrity),
    ).toThrow(/generated consumer lock/u);

    lock.packages[`node_modules/${PACKAGE_NAME}`].integrity = integrity;
    lock.packages[`node_modules/${PACKAGE_NAME}`].resolved =
      'https://registry.example.test/wharfie.tgz';
    expect(() =>
      assertRegistryLock(lock, PACKAGE_METADATA.version, integrity),
    ).toThrow(/outside the canonical npm registry/u);
  });

  it('requires the authoritative repository and a full lowercase source commit', () => {
    const wrongRepository = makeRegistryManifest({
      source: {
        repository: 'https://github.com/example/wharfie',
        commit: COMMIT,
      },
    });
    expect(() =>
      assertRegistryReleaseManifest(wrongRepository, PACKAGE_METADATA),
    ).toThrow(/repository must be authoritative/u);

    for (const commit of ['a'.repeat(39), 'A'.repeat(40), `${COMMIT}0`]) {
      const wrongCommit = makeRegistryManifest({
        source: {
          repository: 'https://github.com/wharfie/wharfie',
          commit,
        },
      });
      expect(() =>
        assertRegistryReleaseManifest(wrongCommit, PACKAGE_METADATA),
      ).toThrow(/full lowercase Git commit ID/u);
    }
  });

  it('accepts npm-verified SLSA provenance bound to the release manifest', () => {
    const manifest = makeRegistryManifest();
    const artifact = assertRegistryReleaseManifest(manifest, PACKAGE_METADATA);
    const statement = assertRegistryAuditProvenance(
      makeSignatureAudit({ manifest }),
      manifest,
      artifact,
    );

    expect(statement.subject[0].name).toBe(
      `pkg:npm/%40wharfie/wharfie@${manifest.version}`,
    );
    expect(
      statement.predicate.buildDefinition.resolvedDependencies[0].digest
        .gitCommit,
    ).toBe(COMMIT);
  });

  /** @type {Array<[string, (statement: Record<string, any>) => void]>} */
  const provenanceMismatches = [
    [
      'package name',
      (statement) => {
        statement.subject[0].name = `pkg:npm/%40example/wharfie@${PACKAGE_METADATA.version}`;
      },
    ],
    [
      'package version',
      (statement) => {
        statement.subject[0].name = 'pkg:npm/%40wharfie/wharfie@0.0.14';
      },
    ],
    [
      'package SHA-512',
      (statement) => {
        statement.subject[0].digest.sha512 = 'b'.repeat(128);
      },
    ],
    [
      'source repository',
      (statement) => {
        statement.predicate.buildDefinition.externalParameters.workflow.repository =
          'https://github.com/example/wharfie';
      },
    ],
    [
      'source commit',
      (statement) => {
        statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit =
          'b'.repeat(40);
      },
    ],
    [
      'tag ref',
      (statement) => {
        statement.predicate.buildDefinition.externalParameters.workflow.ref =
          'refs/tags/v0.0.14';
      },
    ],
    [
      'resolved tag source',
      (statement) => {
        statement.predicate.buildDefinition.resolvedDependencies[0].uri =
          'git+https://github.com/wharfie/wharfie@refs/tags/v0.0.14';
      },
    ],
    [
      'release workflow',
      (statement) => {
        statement.predicate.buildDefinition.externalParameters.workflow.path =
          '.github/workflows/other.yml';
      },
    ],
    [
      'unexpected external parameter',
      (statement) => {
        statement.predicate.buildDefinition.externalParameters.untrusted = true;
      },
    ],
    [
      'GitHub event',
      (statement) => {
        statement.predicate.buildDefinition.internalParameters.github.event_name =
          'workflow_dispatch';
      },
    ],
    [
      'builder identity',
      (statement) => {
        statement.predicate.runDetails.builder.id =
          'https://github.com/actions/runner/self-hosted';
      },
    ],
  ];
  it.each(provenanceMismatches)(
    'rejects npm provenance with a mismatched %s',
    (_label, mutate) => {
      const manifest = makeRegistryManifest();
      const artifact = assertRegistryReleaseManifest(
        manifest,
        PACKAGE_METADATA,
      );
      expect(() =>
        assertRegistryAuditProvenance(
          makeSignatureAudit({ manifest, mutateStatement: mutate }),
          manifest,
          artifact,
        ),
      ).toThrow();
    },
  );

  it('rejects ambiguous or mismatched npm verified entries', () => {
    const manifest = makeRegistryManifest();
    const artifact = assertRegistryReleaseManifest(manifest, PACKAGE_METADATA);
    const duplicate = makeSignatureAudit({ manifest });
    duplicate.verified.push(structuredClone(duplicate.verified[0]));
    expect(() =>
      assertRegistryAuditProvenance(duplicate, manifest, artifact),
    ).toThrow(/one verified/u);

    const wrongRegistry = makeSignatureAudit({ manifest });
    wrongRegistry.verified[0].registry = 'https://registry.example.test/';
    expect(() =>
      assertRegistryAuditProvenance(wrongRegistry, manifest, artifact),
    ).toThrow(/canonical npm registry/u);

    const missing = makeSignatureAudit({ manifest });
    missing.missing.push(`${PACKAGE_NAME}@${manifest.version}`);
    expect(() =>
      assertRegistryAuditProvenance(missing, manifest, artifact),
    ).toThrow(/missing signatures/u);
  });

  it('strictly bounds and decodes the verified DSSE payload', () => {
    const manifest = makeRegistryManifest();
    const artifact = assertRegistryReleaseManifest(manifest, PACKAGE_METADATA);
    /** @param {string} payload */
    const verifyPayload = (payload) =>
      assertRegistryAuditProvenance(
        makeSignatureAudit({ manifest, payload }),
        manifest,
        artifact,
      );

    const noncanonical = makeSignatureAudit({ manifest });
    const canonicalPayload =
      noncanonical.verified[0].attestationBundles[0].bundle.dsseEnvelope
        .payload;
    expect(() => verifyPayload(`${canonicalPayload}\n`)).toThrow(
      /canonical base64/u,
    );
    expect(() =>
      verifyPayload(Buffer.alloc(64 * 1024 + 1).toString('base64')),
    ).toThrow(/bounded canonical base64/u);
    expect(() =>
      verifyPayload(Buffer.from([0xc3, 0x28]).toString('base64')),
    ).toThrow(/canonical UTF-8/u);
    expect(() =>
      verifyPayload(
        Buffer.from(
          JSON.stringify(makeProvenanceStatement(manifest), null, 2),
        ).toString('base64'),
      ),
    ).toThrow(/compact unambiguous JSON/u);
  });

  it('accepts the complete versioned starter in the candidate tarball', () => {
    expect(PROOF_PREFIX).toBe('wharfie-magnetic-first-run-');
    expect(() =>
      assertCandidatePackage(makeCandidate(), PACKAGE_METADATA),
    ).not.toThrow();
    expect(() =>
      assertStarterMetadata(makeStarterMetadata(), PACKAGE_METADATA),
    ).not.toThrow();
  });

  it('rejects a candidate missing any starter file', () => {
    const candidate = makeCandidate();
    candidate.files.pop();
    expect(() => assertCandidatePackage(candidate, PACKAGE_METADATA)).toThrow(
      /missing hello-world starter file/u,
    );
  });

  it.each([
    ['an exact npm patch', { packageManager: 'npm@11.12.0' }],
    [
      'an npm engine',
      { engines: { node: SUPPORTED_NODE_RANGE, npm: '11.12.0' } },
    ],
    ['an exact Node patch', { engines: { node: '24.13.1' } }],
    [
      'a source tarball',
      { devDependencies: { [PACKAGE_NAME]: 'file:toolchain.tgz' } },
    ],
  ])('rejects a starter with %s', (_label, override) => {
    expect(() =>
      assertStarterMetadata(makeStarterMetadata(override), PACKAGE_METADATA),
    ).toThrow();
  });
});
