import { describe, expect, it } from '@jest/globals';

import { createApplicationRevision } from '../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../src/core/runtime/artifact-record.js';
import { sha256Base64Url } from '../../src/core/runtime/content-id.js';
import {
  createSingleNodeDeploymentDesired,
  validateSingleNodeDeploymentDesired,
} from '../../src/core/runtime/single-node-deployment-desired.js';
import {
  SINGLE_NODE_DEPLOYMENT_MODE,
  SINGLE_NODE_MACHINE,
  createSingleNodeDeploymentIntent,
} from '../../src/core/runtime/single-node-deployment-intent.js';

const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @param {string|Buffer} value */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @param {string} [appId] */
function makeRevision(appId = 'hello-app') {
  return createApplicationRevision({
    contract: {
      schemaVersion: 4,
      app: { id: appId },
      cli: {
        entrypoint: {
          kind: 'node',
          path: 'src/cli.js',
          export: 'main',
        },
      },
      activities: {
        greet: {
          entrypoint: {
            kind: 'node',
            path: 'src/greet.js',
            export: 'greet',
          },
        },
      },
    },
    inputs: {
      source: {
        format: 'wharfie-source-tree-v1',
        digest: digest('source'),
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

/**
 * @param {ReturnType<typeof makeRevision>} revision
 * @param {Readonly<Record<string, any>>} [target]
 */
function makeProvenance(revision, target = TARGET) {
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
    dependencies: {
      lock: clone(revision.inputs.dependencies),
      digest: digest('target-dependency-closure'),
    },
    signing: { mode: 'unsigned' },
  };
}

/** @param {Record<string, any>} [overrides] */
function makeIntent(overrides = {}) {
  return createSingleNodeDeploymentIntent({
    deployment: { id: 'hello-production' },
    appId: 'hello-app',
    target: TARGET,
    mode: SINGLE_NODE_DEPLOYMENT_MODE,
    machine: SINGLE_NODE_MACHINE,
    access: {
      kind: 'public-ssh',
      allowedIpv4: ['203.0.113.7/32'],
    },
    provider: { kind: 'hetzner', location: 'fsn1' },
    ...overrides,
  });
}

/** @param {Record<string, any>} [overrides] */
function makeFixture(overrides = {}) {
  const bytes = overrides.bytes || Buffer.from('exact Linux SEA bytes');
  const revision = overrides.revision || makeRevision();
  const target = overrides.target || TARGET;
  const record = createArtifactRecord({
    bytes,
    revision,
    target,
    provenance: makeProvenance(revision, target),
  });
  return {
    intent: overrides.intent || makeIntent(),
    revision,
    artifactRecord: record,
    observation: {
      artifactId: record.artifactId,
      byteDigest: record.byteDigest,
      size: record.size,
    },
  };
}

describe('single-node deployment desired state', () => {
  it('binds exact intent, application revision, and held Linux SEA bytes', () => {
    const fixture = makeFixture();
    const desired = createSingleNodeDeploymentDesired(fixture);

    expect(desired).toEqual({
      artifact: {
        artifactId: fixture.artifactRecord.artifactId,
        byteDigest: fixture.artifactRecord.byteDigest,
        revisionId: fixture.revision.revisionId,
        size: fixture.artifactRecord.size,
      },
      deploymentInstanceId: expect.stringMatching(/^wsnd1_[A-Za-z0-9_-]{43}$/),
      desiredRevisionId: expect.stringMatching(/^wsnr1_[A-Za-z0-9_-]{43}$/),
      intent: fixture.intent,
      kind: 'singleNodeDeploymentDesired',
      schemaVersion: 1,
    });
    expect(Object.isFrozen(desired)).toBe(true);
    expect(Object.isFrozen(desired.artifact.byteDigest)).toBe(true);
  });

  it('validates, independently clones, and freezes serialized desired state', () => {
    const serialized = clone(createSingleNodeDeploymentDesired(makeFixture()));
    const validated = validateSingleNodeDeploymentDesired(serialized);

    expect(validated).toEqual(serialized);
    expect(validated).not.toBe(serialized);
    serialized.intent.access.allowedIpv4[0] = '198.51.100.4/32';
    expect(validated.intent.access.allowedIpv4).toEqual(['203.0.113.7/32']);
  });

  it.each([
    [
      'application',
      () =>
        makeFixture({
          intent: makeIntent({ appId: 'another-app' }),
        }),
      /intended application revision/i,
    ],
    [
      'target',
      () => {
        const target = {
          nodeVersion: '24.14.0',
          platform: 'linux',
          architecture: 'x64',
          libc: 'glibc',
        };
        return makeFixture({ target });
      },
      /target must exactly match/i,
    ],
    [
      'byte observation',
      () => {
        const fixture = makeFixture();
        fixture.observation.size += 1;
        return fixture;
      },
      /size does not match/i,
    ],
  ])('rejects a mismatched %s', (_name, createFixture, pattern) => {
    expect(() => createSingleNodeDeploymentDesired(createFixture())).toThrow(
      pattern,
    );
  });

  it.each([
    [
      'instance',
      (/** @type {any} */ value) =>
        (value.deploymentInstanceId = value.deploymentInstanceId.replace(
          /^wsnd1_/,
          'wsnd2_',
        )),
      /canonical wsnd1_/i,
    ],
    [
      'artifact digest',
      (/** @type {any} */ value) =>
        (value.artifact.byteDigest.value =
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
      /artifactId must name the exact byteDigest/i,
    ],
    [
      'desired identity',
      (/** @type {any} */ value) => (value.artifact.size += 1),
      /desiredRevisionId does not match/i,
    ],
  ])(
    'rejects serialized desired state with changed %s',
    (_name, mutate, pattern) => {
      const desired = clone(createSingleNodeDeploymentDesired(makeFixture()));
      mutate(desired);
      expect(() => validateSingleNodeDeploymentDesired(desired)).toThrow(
        pattern,
      );
    },
  );

  it('rejects and never echoes unknown credential material', () => {
    const sentinel = 'secret-sentinel-token';
    const fixture = makeFixture();
    /** @type {any} */ (fixture).token = sentinel;
    let thrown;
    try {
      createSingleNodeDeploymentDesired(fixture);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).not.toContain(sentinel);
  });
});
