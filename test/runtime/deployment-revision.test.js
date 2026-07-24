import { describe, expect, it, jest } from '@jest/globals';

import { createApplicationRevision } from '../../src/core/runtime/application-revision.js';
import {
  createSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import {
  createAwsSingleNodeProvider,
  createDeploymentProfile,
} from '../../src/core/runtime/deployment-profile.js';
import {
  DEPLOYMENT_REVISION_ID_DOMAIN,
  DEPLOYMENT_REVISION_ID_PREFIX,
  createRunningDeploymentRevision,
  validateDeploymentRevision,
  validateRunningDeploymentRevisionContext,
} from '../../src/core/runtime/deployment-revision.js';

const target = {
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
};

/** @param {string} value @returns {{algorithm: 'sha256', value: string}} */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @returns {{promise: Promise<any>, resolve: (value: any) => void, reject: (reason: unknown) => void}} */
function deferred() {
  /** @type {(value: any) => void} */
  let settle = () => {
    throw new Error('Deferred promise was not initialized.');
  };
  /** @type {(reason: unknown) => void} */
  let fail = () => {
    throw new Error('Deferred promise was not initialized.');
  };
  const promise = new Promise((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, resolve: settle, reject: fail };
}

/** @param {string} [appId] @returns {ReturnType<typeof createApplicationRevision>} */
function makeRevision(appId = 'deployment-demo') {
  return createApplicationRevision({
    contract: {
      schemaVersion: 2,
      app: { id: appId },
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
        digest: digest(`source-${appId}`),
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

/** @param {string} [region] @param {Record<string, any>} [selectedTarget] @param {string} [appId] */
function makeProfile(
  region = 'us-east-1',
  selectedTarget = target,
  appId = 'deployment-demo',
) {
  return createDeploymentProfile({
    profile: { id: 'production' },
    appId,
    target: selectedTarget,
    mode: { kind: 'single-node-systemd-user', version: 1 },
    provider: createAwsSingleNodeProvider(region),
  });
}

/** @param {{revision?: ReturnType<typeof makeRevision>, runtimeTarget?: Record<string, any>, artifactBytes?: string}} [overrides] */
function makeFixture(overrides = {}) {
  const revision = overrides.revision ?? makeRevision();
  const runtimeTarget = overrides.runtimeTarget ?? target;
  const artifactBytes = overrides.artifactBytes ?? 'exact running SEA bytes';
  const byteDigest = digest(artifactBytes);
  const profile = makeProfile();
  const dependencies = {
    readEmbeddedRevisionRuntimePair: jest.fn(async () => ({
      revision,
      runtime: {
        schemaVersion: 1,
        kind: 'artifactRuntime',
        appId: revision.contract.app.id,
        revisionId: revision.revisionId,
        target: runtimeTarget,
      },
    })),
    inspectRunningArtifact: jest.fn(async () => ({
      artifactId: createSha256Id({
        prefix: 'waf1',
        payload: artifactBytes,
      }),
      byteDigest,
      size: Buffer.byteLength(artifactBytes),
    })),
  };
  return {
    revision,
    profile,
    dependencies,
    input: { deployment: { id: 'production' }, profile },
  };
}

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

describe('deployment revisions', () => {
  it('binds the exact embedded revision, held SEA bytes, and profile identity', async () => {
    const fixture = makeFixture();
    const deployment = await createRunningDeploymentRevision(
      fixture.input,
      fixture.dependencies,
    );

    expect(deployment).toEqual({
      appId: 'deployment-demo',
      artifactId: createSha256Id({
        prefix: 'waf1',
        payload: 'exact running SEA bytes',
      }),
      deployment: { id: 'production' },
      deploymentRevisionId: expect.stringMatching(/^wdr1_[A-Za-z0-9_-]{43}$/),
      kind: 'deploymentRevision',
      profileRevisionId: fixture.profile.profileRevisionId,
      revisionId: fixture.revision.revisionId,
      schemaVersion: 1,
    });
    expect(DEPLOYMENT_REVISION_ID_DOMAIN).toBe(
      'wharfie:deployment-revision:v1',
    );
    expect(DEPLOYMENT_REVISION_ID_PREFIX).toBe('wdr1');
    expect(
      fixture.dependencies.readEmbeddedRevisionRuntimePair,
    ).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.inspectRunningArtifact).toHaveBeenCalledTimes(
      1,
    );
    expect(Object.isFrozen(deployment)).toBe(true);
  });

  it('waits for both running-artifact reads and reports the first canonical failure', async () => {
    const fixture = makeFixture();
    const pendingArtifact = deferred();
    const artifactStarted = deferred();
    const pairFailure = new Error('embedded pair failure');
    const artifactFailure = new Error('artifact inspection failure');
    const dependencies = {
      readEmbeddedRevisionRuntimePair: jest.fn(() =>
        Promise.reject(pairFailure),
      ),
      inspectRunningArtifact: jest.fn(() => {
        artifactStarted.resolve(undefined);
        return pendingArtifact.promise;
      }),
    };

    const observation = createRunningDeploymentRevision(
      fixture.input,
      dependencies,
    );
    await artifactStarted.promise;
    const observed = jest.fn();
    const reported = observation.then(observed, observed);
    await new Promise((resolve) => setImmediate(resolve));

    expect(dependencies.readEmbeddedRevisionRuntimePair).toHaveBeenCalledTimes(
      1,
    );
    expect(dependencies.inspectRunningArtifact).toHaveBeenCalledTimes(1);
    expect(observed).not.toHaveBeenCalled();

    pendingArtifact.reject(artifactFailure);
    await expect(observation).rejects.toBe(pairFailure);
    await reported;
  });

  it('changes identity with deployment name, running bytes, or profile', async () => {
    const first = makeFixture();
    const original = await createRunningDeploymentRevision(
      first.input,
      first.dependencies,
    );

    const renamed = makeFixture();
    renamed.input.deployment.id = 'staging';
    const renamedRevision = await createRunningDeploymentRevision(
      renamed.input,
      renamed.dependencies,
    );

    const newBytes = makeFixture({ artifactBytes: 'next exact SEA bytes' });
    const byteRevision = await createRunningDeploymentRevision(
      newBytes.input,
      newBytes.dependencies,
    );

    const newProfile = makeFixture();
    newProfile.input.profile = makeProfile('us-west-2');
    const profileRevision = await createRunningDeploymentRevision(
      newProfile.input,
      newProfile.dependencies,
    );

    expect(renamedRevision.deploymentRevisionId).not.toBe(
      original.deploymentRevisionId,
    );
    expect(byteRevision.deploymentRevisionId).not.toBe(
      original.deploymentRevisionId,
    );
    expect(profileRevision.deploymentRevisionId).not.toBe(
      original.deploymentRevisionId,
    );
  });

  it('validates serialized references without requiring old artifact bytes', async () => {
    const fixture = makeFixture();
    const deployment = await createRunningDeploymentRevision(
      fixture.input,
      fixture.dependencies,
    );
    const unavailable = jest.fn(async () => {
      throw new Error('old artifact is gone');
    });

    expect(validateDeploymentRevision(clone(deployment))).toEqual(deployment);
    expect(unavailable).not.toHaveBeenCalled();
  });

  it('re-observes this running SEA before apply or reconcile', async () => {
    const fixture = makeFixture();
    const deployment = await createRunningDeploymentRevision(
      fixture.input,
      fixture.dependencies,
    );

    await expect(
      validateRunningDeploymentRevisionContext(
        deployment,
        { profile: fixture.profile },
        fixture.dependencies,
      ),
    ).resolves.toEqual(deployment);

    const replacement = makeFixture({ artifactBytes: 'substituted SEA' });
    await expect(
      validateRunningDeploymentRevisionContext(
        deployment,
        { profile: fixture.profile },
        replacement.dependencies,
      ),
    ).rejects.toThrow(/does not match this running artifact/i);
  });

  it('rejects an embedded runtime that does not match its embedded revision', async () => {
    const fixture = makeFixture();
    const other = makeRevision('other-app');
    fixture.dependencies.readEmbeddedRevisionRuntimePair.mockResolvedValue({
      revision: fixture.revision,
      runtime: {
        schemaVersion: 1,
        kind: 'artifactRuntime',
        appId: other.contract.app.id,
        revisionId: other.revisionId,
        target,
      },
    });

    await expect(
      createRunningDeploymentRevision(fixture.input, fixture.dependencies),
    ).rejects.toThrow(/embedded runtime does not match/i);
  });

  it('rejects a profile target different from the running SEA target', async () => {
    const fixture = makeFixture();
    fixture.input.profile = makeProfile('us-east-1', {
      ...target,
      architecture: 'arm64',
    });
    await expect(
      createRunningDeploymentRevision(fixture.input, fixture.dependencies),
    ).rejects.toThrow(/running artifact target must equal/i);
  });

  it('rejects an observation whose artifact ID does not name its byte digest', async () => {
    const fixture = makeFixture();
    fixture.dependencies.inspectRunningArtifact.mockResolvedValue({
      artifactId: createSha256Id({ prefix: 'waf1', payload: 'first' }),
      byteDigest: digest('second'),
      size: 6,
    });
    await expect(
      createRunningDeploymentRevision(fixture.input, fixture.dependencies),
    ).rejects.toThrow(/artifactId must name the exact observed byteDigest/i);
  });

  it.each([
    [
      'profile revision identity',
      (/** @type {any} */ value) => {
        value.profileRevisionId = value.profileRevisionId.replace(
          /^wpr2_/,
          'wpr1_',
        );
      },
      /canonical wpr2_/i,
    ],
    [
      'deployment identity payload',
      (/** @type {any} */ value) => {
        value.deployment.id = 'staging';
      },
      /deploymentRevisionId does not match/i,
    ],
  ])(
    'rejects serialized documents with a changed %s',
    async (_name, mutate, pattern) => {
      const fixture = makeFixture();
      const document = clone(
        await createRunningDeploymentRevision(
          fixture.input,
          fixture.dependencies,
        ),
      );
      mutate(document);
      expect(() => validateDeploymentRevision(document)).toThrow(pattern);
    },
  );
});
