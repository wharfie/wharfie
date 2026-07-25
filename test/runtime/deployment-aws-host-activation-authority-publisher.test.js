import { describe, expect, it, jest } from '@jest/globals';

import {
  AwsSingleNodeHostActivationAuthorityPublisherConflictError,
  AwsSingleNodeHostActivationAuthorityPublisherUnknownError,
  createAwsSingleNodeHostActivationAuthorityPublisher,
} from '../../src/core/runtime/deployment-aws-host-activation-authority-publisher.js';
import { createAwsSingleNodeHostActivationRequest } from '../../src/core/runtime/deployment-aws-host-agent-contract.js';
import { AwsSingleNodeManagedArtifactEvidenceUnknownError } from '../../src/core/runtime/deployment-aws-managed-artifact-evidence.js';
import { createDeploymentHead } from '../../src/core/runtime/deployment-head.js';
import {
  clone,
  makeFixture,
  makeReconcileFixture,
  semanticId,
} from './fixtures/deployment-aws-host-activation.js';

/** @param {Readonly<Record<string, any>>} fixture @param {Record<string, any>} [overrides] @returns {Record<string, any>} */
function managedArtifactHeadResponse(fixture, overrides = {}) {
  return {
    VersionId: fixture.managedArtifact.versionId,
    ETag: fixture.managedArtifact.etag,
    ContentLength: fixture.managedArtifact.contentLength,
    ChecksumSHA256: Buffer.from(
      fixture.deploymentRevision.artifactId.slice('waf1_'.length),
      'base64url',
    ).toString('base64'),
    ServerSideEncryption: 'AES256',
    StorageClass: 'STANDARD',
    ContentType: 'application/octet-stream',
    CacheControl: 'no-store',
    Metadata: clone(fixture.managedArtifact.metadata),
    ...overrides,
  };
}

/** @param {Readonly<Record<string, any>>} fixture @param {'running'|'blocked'} [status] */
function makeHigherActiveHead(fixture, status = 'running') {
  return createDeploymentHead({
    deploymentInstanceId: fixture.head.deploymentInstanceId,
    providerScope: fixture.head.providerScope,
    incarnationId: fixture.head.incarnationId,
    generation: fixture.head.generation + 1,
    phase: 'CONVERGING',
    settledDeploymentRevisionId: fixture.head.settledDeploymentRevisionId,
    targetDeploymentRevisionId: fixture.head.targetDeploymentRevisionId,
    resourceBindings: fixture.head.resourceBindings,
    activeOperation: {
      kind: fixture.head.activeOperation.kind,
      planId: fixture.head.activeOperation.planId,
      status,
      nextActionIndex: fixture.head.activeOperation.nextActionIndex,
      intents: fixture.head.activeOperation.intents,
    },
    lastOperation: fixture.head.lastOperation,
  });
}

/** @param {Readonly<Record<string, any>>} fixture @returns {Readonly<Record<string, any>>} */
function publicationContext(fixture) {
  return Object.freeze({
    plan: fixture.requestContext.plan,
    settledPlan: fixture.requestContext.settledPlan,
    profile: fixture.requestContext.profile,
    head: fixture.requestContext.head,
  });
}

/** @param {unknown} error @param {string} secret @returns {void} */
function expectFixedRedacted(error, secret) {
  expect(error).toBeInstanceOf(Error);
  if (!(error instanceof Error)) {
    throw new Error('Expected a redacted Error instance.');
  }
  expect(error.message).not.toContain(secret);
  expect(error).not.toHaveProperty('cause');
  expect(JSON.stringify(error)).not.toContain(secret);
}

describe('AWS single-node host-activation authority publisher', () => {
  it('reads fresh current managed evidence before atomically publishing one canonical V65 request', async () => {
    const fixture = makeFixture();
    /** @type {string[]} */
    const events = [];
    /** @type {Readonly<Record<string, any>>|null} */
    let authority = null;
    /** @type {Record<string, any>|null} */
    let casInput = null;
    const client = {
      headObject: jest.fn(async (input) => {
        events.push('head-object');
        expect(Object.isFrozen(input)).toBe(true);
        return managedArtifactHeadResponse(fixture);
      }),
    };
    const store = {
      async readHostActivationAuthority(
        /** @type {string} */ deploymentInstanceId,
      ) {
        events.push('authority-read');
        expect(deploymentInstanceId).toBe(fixture.deploymentInstanceId);
        return authority === null ? null : clone(authority);
      },
      async compareAndSetHostActivationAuthority(
        /** @type {Record<string, any>} */ input,
      ) {
        events.push('authority-cas');
        casInput = input;
        authority = clone(input.nextRequest);
        return true;
      },
      async readHead() {
        events.push('head-read');
        return clone(fixture.head);
      },
    };
    const publisher = createAwsSingleNodeHostActivationAuthorityPublisher({
      client,
      store,
    });

    const request = await publisher.publish({
      plan: fixture.plan,
      settledPlan: null,
      profile: fixture.profile,
      head: fixture.head,
    });

    expect(request).toEqual(
      createAwsSingleNodeHostActivationRequest(fixture.requestContext),
    );
    expect(events).toEqual(['head-object', 'authority-read', 'authority-cas']);
    expect(client.headObject).toHaveBeenCalledWith({
      Bucket: request.artifact.bucketName,
      Key: request.artifact.key,
      ChecksumMode: 'ENABLED',
      ExpectedBucketOwner: fixture.providerScope.accountId,
    });
    expect(casInput).toEqual({
      expectedRequest: null,
      nextRequest: request,
      authorizedHead: fixture.head,
    });
    expect(Object.isFrozen(casInput)).toBe(true);
  });

  it('freshly rechecks HeadObject before reusing a stable same-operation request across a recovery generation', async () => {
    const fixture = makeFixture();
    const existing = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const head = makeHigherActiveHead(fixture);
    /** @type {string[]} */
    const events = [];
    const client = {
      async headObject() {
        events.push('head-object');
        return managedArtifactHeadResponse(fixture);
      },
    };
    const store = {
      async readHostActivationAuthority() {
        events.push('authority-read');
        return clone(existing);
      },
      compareAndSetHostActivationAuthority: jest.fn(),
      async readHead() {
        events.push('head-read');
        return clone(head);
      },
    };
    const publisher = createAwsSingleNodeHostActivationAuthorityPublisher({
      client,
      store,
    });

    const request = await publisher.publish({
      plan: fixture.plan,
      settledPlan: null,
      profile: fixture.profile,
      head,
    });

    expect(request).toEqual(existing);
    expect(request.authorizedHeadId).toBe(fixture.head.headId);
    expect(head.headId).not.toBe(fixture.head.headId);
    expect(events).toEqual([
      'head-object',
      'authority-read',
      'authority-read',
      'head-read',
    ]);
    expect(store.compareAndSetHostActivationAuthority).not.toHaveBeenCalled();
  });

  it('rejects changed current object evidence for the same operation instead of replacing its stable authority', async () => {
    const fixture = makeFixture();
    const existing = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const head = makeHigherActiveHead(fixture);
    const client = {
      headObject: jest.fn(async () =>
        managedArtifactHeadResponse(fixture, {
          VersionId: 'changed-current-version',
        }),
      ),
    };
    const store = {
      readHostActivationAuthority: jest.fn(async () => clone(existing)),
      compareAndSetHostActivationAuthority: jest.fn(),
      readHead: jest.fn(),
    };
    const publisher = createAwsSingleNodeHostActivationAuthorityPublisher({
      client,
      store,
    });

    await expect(
      publisher.publish({
        plan: fixture.plan,
        settledPlan: null,
        profile: fixture.profile,
        head,
      }),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeHostActivationAuthorityPublisherConflictError,
    );
    expect(client.headObject).toHaveBeenCalledTimes(1);
    expect(store.readHostActivationAuthority).toHaveBeenCalledTimes(1);
    expect(store.compareAndSetHostActivationAuthority).not.toHaveBeenCalled();
  });

  it('rejects reuse when the final strong head read observes a concurrent destroy', async () => {
    const fixture = makeFixture();
    const existing = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const staleHead = makeHigherActiveHead(fixture);
    const destroyingHead = createDeploymentHead({
      deploymentInstanceId: fixture.readyHead.deploymentInstanceId,
      providerScope: fixture.readyHead.providerScope,
      incarnationId: fixture.readyHead.incarnationId,
      generation: fixture.readyHead.generation + 1,
      phase: 'DESTROYING',
      settledDeploymentRevisionId:
        fixture.readyHead.settledDeploymentRevisionId,
      targetDeploymentRevisionId: null,
      resourceBindings: fixture.readyHead.resourceBindings,
      activeOperation: {
        kind: 'destroy',
        planId: semanticId('wpl3', 'wharfie:test:publisher-destroy-plan:v1', {
          seed: 1,
        }),
        status: 'running',
        nextActionIndex: 0,
        intents: [
          {
            actionId: semanticId(
              'wda3',
              'wharfie:test:publisher-destroy-action:v1',
              { seed: 1 },
            ),
            status: 'pending',
            ownershipNonce: null,
          },
        ],
      },
      lastOperation: fixture.readyHead.lastOperation,
    });
    /** @type {string[]} */
    const events = [];
    const client = {
      async headObject() {
        events.push('head-object');
        return managedArtifactHeadResponse(fixture);
      },
    };
    const store = {
      async readHostActivationAuthority() {
        events.push('authority-read');
        return clone(existing);
      },
      compareAndSetHostActivationAuthority: jest.fn(),
      async readHead() {
        events.push('head-read');
        return clone(destroyingHead);
      },
    };
    const publisher = createAwsSingleNodeHostActivationAuthorityPublisher({
      client,
      store,
    });

    await expect(
      publisher.publish({
        plan: fixture.plan,
        settledPlan: null,
        profile: fixture.profile,
        head: staleHead,
      }),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeHostActivationAuthorityPublisherConflictError,
    );
    expect(events).toEqual([
      'head-object',
      'authority-read',
      'authority-read',
      'head-read',
    ]);
    expect(store.compareAndSetHostActivationAuthority).not.toHaveBeenCalled();
  });

  it('replaces only a prior operation after minting the fresh current request', async () => {
    const fixture = makeFixture();
    const reconcile = makeReconcileFixture(fixture);
    const existing = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    /** @type {Record<string, any>|null} */
    let casInput = null;
    const client = {
      async headObject() {
        return managedArtifactHeadResponse(fixture);
      },
    };
    const store = {
      async readHostActivationAuthority() {
        return clone(existing);
      },
      async compareAndSetHostActivationAuthority(
        /** @type {Record<string, any>} */ input,
      ) {
        casInput = input;
        return true;
      },
      readHead: jest.fn(),
    };
    const publisher = createAwsSingleNodeHostActivationAuthorityPublisher({
      client,
      store,
    });

    const request = await publisher.publish(publicationContext(reconcile));

    expect(request.planId).toBe(reconcile.plan.planId);
    expect(request.deploymentOperationId).toBe(
      reconcile.head.activeOperation.operationId,
    );
    expect(casInput).toEqual({
      expectedRequest: existing,
      nextRequest: request,
      authorizedHead: reconcile.head,
    });
  });

  it('recovers a lost commit response by reading authority first and current head last', async () => {
    const fixture = makeFixture();
    const secret = 'Bearer dynamodb-response-loss-secret';
    /** @type {string[]} */
    const events = [];
    /** @type {Readonly<Record<string, any>>|null} */
    let authority = null;
    const client = {
      async headObject() {
        events.push('head-object');
        return managedArtifactHeadResponse(fixture);
      },
    };
    let authorityReads = 0;
    const store = {
      async readHostActivationAuthority() {
        events.push('authority-read');
        authorityReads += 1;
        return authority === null ? null : clone(authority);
      },
      async compareAndSetHostActivationAuthority(
        /** @type {Record<string, any>} */ input,
      ) {
        events.push('authority-cas');
        authority = clone(input.nextRequest);
        throw new Error(secret);
      },
      async readHead() {
        events.push('head-read');
        return clone(fixture.head);
      },
    };
    const publisher = createAwsSingleNodeHostActivationAuthorityPublisher({
      client,
      store,
    });

    const request = await publisher.publish(publicationContext(fixture));

    expect(request).toEqual(authority);
    expect(authorityReads).toBe(2);
    expect(events).toEqual([
      'head-object',
      'authority-read',
      'authority-cas',
      'authority-read',
      'head-read',
    ]);
  });

  it('accepts an exact concurrent winner after conditional loss and a READY successor head-last read', async () => {
    const fixture = makeFixture();
    /** @type {string[]} */
    const events = [];
    /** @type {Readonly<Record<string, any>>|null} */
    let authority = null;
    const client = {
      async headObject() {
        events.push('head-object');
        return managedArtifactHeadResponse(fixture);
      },
    };
    const store = {
      async readHostActivationAuthority() {
        events.push('authority-read');
        return authority === null ? null : clone(authority);
      },
      async compareAndSetHostActivationAuthority(
        /** @type {Record<string, any>} */ input,
      ) {
        events.push('authority-cas');
        authority = clone(input.nextRequest);
        return false;
      },
      async readHead() {
        events.push('head-read');
        return clone(fixture.readyHead);
      },
    };
    const publisher = createAwsSingleNodeHostActivationAuthorityPublisher({
      client,
      store,
    });

    const request = await publisher.publish(publicationContext(fixture));

    expect(request).toEqual(authority);
    expect(events).toEqual([
      'head-object',
      'authority-read',
      'authority-cas',
      'authority-read',
      'head-read',
    ]);
    expect(fixture.readyHead.lastOperation.operationId).toBe(
      request.deploymentOperationId,
    );
  });

  it('redacts provider and store failures without exposing raw causes', async () => {
    const fixture = makeFixture();
    const secret = 'Bearer publisher-transport-secret';
    const baseStore = {
      async readHostActivationAuthority() {
        return null;
      },
      async compareAndSetHostActivationAuthority() {
        return true;
      },
      async readHead() {
        return clone(fixture.head);
      },
    };
    const s3Publisher = createAwsSingleNodeHostActivationAuthorityPublisher({
      client: {
        async headObject() {
          throw new Error(secret);
        },
      },
      store: baseStore,
    });
    let s3Error;
    try {
      await s3Publisher.publish(publicationContext(fixture));
    } catch (error) {
      s3Error = error;
    }
    expect(s3Error).toBeInstanceOf(
      AwsSingleNodeManagedArtifactEvidenceUnknownError,
    );
    expectFixedRedacted(s3Error, secret);

    const storePublisher = createAwsSingleNodeHostActivationAuthorityPublisher({
      client: {
        async headObject() {
          return managedArtifactHeadResponse(fixture);
        },
      },
      store: {
        ...baseStore,
        async readHostActivationAuthority() {
          throw new Error(secret);
        },
      },
    });
    let storeError;
    try {
      await storePublisher.publish(publicationContext(fixture));
    } catch (error) {
      storeError = error;
    }
    expect(storeError).toBeInstanceOf(
      AwsSingleNodeHostActivationAuthorityPublisherUnknownError,
    );
    expectFixedRedacted(storeError, secret);

    const ambiguousPublisher =
      createAwsSingleNodeHostActivationAuthorityPublisher({
        client: {
          async headObject() {
            return managedArtifactHeadResponse(fixture);
          },
        },
        store: {
          async readHostActivationAuthority() {
            return null;
          },
          async compareAndSetHostActivationAuthority() {
            throw new Error(secret);
          },
          async readHead() {
            return clone(fixture.head);
          },
        },
      });
    let ambiguousError;
    try {
      await ambiguousPublisher.publish(publicationContext(fixture));
    } catch (error) {
      ambiguousError = error;
    }
    expect(ambiguousError).toBeInstanceOf(
      AwsSingleNodeHostActivationAuthorityPublisherUnknownError,
    );
    expectFixedRedacted(ambiguousError, secret);
  });
});
