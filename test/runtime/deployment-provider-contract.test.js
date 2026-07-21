import { describe, expect, it } from '@jest/globals';

import {
  createCanonicalJsonSha256Id,
  createSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import {
  createDeploymentInspection,
  validateDeploymentInspection,
  validateDeploymentInspectionContext,
} from '../../src/core/runtime/deployment-inspection.js';
import {
  createDeploymentServiceHealthReceipt,
  getDeploymentServiceHealthObjectLocation,
} from '../../src/core/runtime/deployment-service-health.js';
import { validateDeploymentServiceHealthObservation } from '../../src/core/runtime/deployment-service-health-s3.js';
import {
  createDeploymentPlan,
  validateDeploymentPlan,
  validateDeploymentPlanContext,
} from '../../src/core/runtime/deployment-plan.js';
import {
  createAwsSingleNodeProvider,
  createDeploymentProfile,
} from '../../src/core/runtime/deployment-profile.js';
import {
  createAwsProviderScope,
  getDeploymentInstanceId,
  validateProviderScope,
} from '../../src/core/runtime/deployment-provider-scope.js';
import {
  createDeploymentIncarnationId,
  createDeploymentResourceBinding,
  createOwnershipNonce,
  validateDeploymentResourceBinding,
  validateOwnershipNonce,
} from '../../src/core/runtime/deployment-resource-binding.js';
import { createLedgerServiceId } from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';

const HEALTH_NOW = 1_700_000_000_000;

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @param {string} value @returns {{algorithm: 'sha256', value: string}} */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @param {string} prefix @param {string} domain @param {unknown} value */
function semanticId(prefix, domain, value) {
  return createCanonicalJsonSha256Id({ prefix, domain, value });
}

/** @param {string} [region] */
function makeProfile(region = 'us-east-1') {
  return createDeploymentProfile({
    profile: { id: 'production' },
    appId: 'provider-demo',
    target: {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
    mode: { kind: 'single-node-systemd-user', version: 1 },
    provider: createAwsSingleNodeProvider(region),
  });
}

/** @param {ReturnType<typeof makeProfile>} [profile] @returns {Readonly<Record<string, any>>} */
function makeDeploymentRevision(profile = makeProfile()) {
  const payload = {
    schemaVersion: 1,
    kind: 'deploymentRevision',
    deployment: { id: 'production' },
    appId: 'provider-demo',
    revisionId: semanticId('wrv1', 'wharfie:test:revision:v1', {
      revision: 1,
    }),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'exact artifact',
    }),
    profileRevisionId: profile.profileRevisionId,
  };
  return Object.freeze({
    ...payload,
    deploymentRevisionId: semanticId(
      'wdr1',
      'wharfie:deployment-revision:v1',
      payload,
    ),
  });
}

/**
 * @param {ReturnType<typeof makeProfile>} profile
 * @param {Readonly<Record<string, any>>} providerScope
 */
function makeProviderSpec(profile, providerScope) {
  return createAwsSingleNodeProviderSpec({
    profile,
    providerScope,
    machineImage: {
      sourceParameter: {
        name: AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS.x86_64,
        version: 42,
      },
      imageId: 'ami-0123456789abcdef0',
      ownerAccountId: '137112412989',
      architecture: 'x86_64',
      imageType: 'machine',
      rootDeviceType: 'ebs',
      virtualizationType: 'hvm',
      enaSupport: true,
    },
    placement: { availabilityZoneId: 'use1-az1' },
    storage: {
      ebsKmsKeyArn:
        'arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555',
    },
    bootstrapDigest: digest('fixed host bootstrap'),
    runtimeIdentityPolicyDigest: digest(
      'host SSM artifact read health write identity',
    ),
  });
}

/** @returns {ReturnType<typeof createDeploymentPlan>} */
function makePlan() {
  const profile = makeProfile();
  const deploymentRevision = makeDeploymentRevision(profile);
  const providerScope = createAwsProviderScope({
    partition: 'aws',
    accountId: '123456789012',
    region: 'us-east-1',
  });
  const deploymentInstanceId = getDeploymentInstanceId({
    deploymentRevision,
    providerScope,
  });
  const providerSpec = makeProviderSpec(profile, providerScope);
  return createDeploymentPlan(
    {
      operation: 'apply',
      deploymentRevision,
      providerScope,
      providerSpec,
      deploymentInstanceId,
      incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 1)),
      basis: {
        headGeneration: 0,
        settledDeploymentRevisionId: null,
        inspectionId: semanticId('win3', 'wharfie:test:inspection:v3', {
          absent: true,
        }),
      },
      actions: [
        {
          resourceKey: 'substrate',
          capability: { kind: 'resident-node', version: 1 },
          management: 'managed',
          action: 'create',
          destructive: false,
          reason: 'missing',
          before: null,
          after: {
            providerType: 'ec2-instance',
            providerResourceId: null,
            stateDigest: digest('desired fixed stack'),
          },
        },
        {
          resourceKey: 'artifact',
          capability: { kind: 'artifact-storage', version: 1 },
          management: 'managed',
          action: 'create',
          destructive: false,
          reason: 'missing',
          before: null,
          after: {
            providerType: 's3-object',
            providerResourceId: null,
            stateDigest: digest('exact artifact object'),
          },
        },
        {
          resourceKey: 'application-state',
          capability: { kind: 'application-state', version: 1 },
          management: 'managed',
          action: 'create',
          destructive: false,
          reason: 'missing',
          before: null,
          after: {
            providerType: 'ebs-volume',
            providerResourceId: null,
            stateDigest: digest('application state volume'),
          },
        },
        {
          resourceKey: 'control-state',
          capability: { kind: 'control-state', version: 1 },
          management: 'managed',
          action: 'create',
          destructive: false,
          reason: 'missing',
          before: null,
          after: {
            providerType: 'ebs-volume',
            providerResourceId: null,
            stateDigest: digest('control state namespace'),
          },
        },
        {
          resourceKey: 'runtime-identity',
          capability: { kind: 'runtime-identity', version: 1 },
          management: 'managed',
          action: 'create',
          destructive: false,
          reason: 'missing',
          before: null,
          after: {
            providerType: 'instance-profile',
            providerResourceId: null,
            stateDigest: digest('host SSM artifact read health write identity'),
          },
        },
        {
          resourceKey: 'network',
          capability: { kind: 'networking', version: 1 },
          management: 'managed',
          action: 'create',
          destructive: false,
          reason: 'missing',
          before: null,
          after: {
            providerType: 'vpc',
            providerResourceId: null,
            stateDigest: digest('public egress no ingress'),
          },
        },
      ],
    },
    { profile },
  );
}

/**
 * @param {Readonly<Record<string, any>>} deploymentRevision
 * @param {Readonly<Record<string, any>>} providerScope
 * @param {Readonly<Record<string, any>>} providerSpec
 * @param {string} incarnationId
 * @param {string} nodeProviderResourceId
 * @param {Record<string, any>} [overrides]
 */
function makeHealthObservation(
  deploymentRevision,
  providerScope,
  providerSpec,
  incarnationId,
  nodeProviderResourceId,
  overrides = {},
) {
  const deploymentInstanceId = getDeploymentInstanceId({
    deploymentRevision,
    providerScope,
  });
  const receipt = createDeploymentServiceHealthReceipt({
    providerScopeId: providerScope.providerScopeId,
    providerSpecId: providerSpec.providerSpecId,
    deploymentInstanceId,
    incarnationId,
    deploymentOperationId: semanticId(
      'wdo1',
      'wharfie:test:health-operation:v1',
      { deploymentInstanceId },
    ),
    authorizedHeadId: semanticId('wdh1', 'wharfie:test:health-head:v1', {
      deploymentInstanceId,
      generation: 3,
    }),
    authorizedHeadGeneration: 3,
    nodeBindingId: semanticId('wrb1', 'wharfie:test:health-binding:v1', {
      deploymentInstanceId,
      nodeProviderResourceId,
    }),
    nodeProviderResourceId,
    deploymentRevisionId: deploymentRevision.deploymentRevisionId,
    appId: deploymentRevision.appId,
    artifactId: deploymentRevision.artifactId,
    revisionId: deploymentRevision.revisionId,
    serviceId: createLedgerServiceId({ appId: deploymentRevision.appId }),
    sessionId: `wss_${Buffer.alloc(32, 5).toString('base64url')}`,
    lifecycleGeneration: 1,
    ownerGeneration: 1,
    activationRecordVersion: 1,
    activationSelectionGeneration: 1,
    processId: 4321,
    sequence: 1,
    health: 'healthy',
    ...overrides,
  });
  const location = getDeploymentServiceHealthObjectLocation(
    providerScope,
    receipt,
  );
  return validateDeploymentServiceHealthObservation({
    receipt,
    object: {
      bucketName: location.bucketName,
      key: location.key,
      versionId: 'health-version-1',
      etag: '"health-etag-1"',
      lastModifiedAt: HEALTH_NOW,
    },
  });
}

/** @param {Record<string, any>} [healthReceiptOverrides] @returns {Array<Record<string, any>>} */
function makeConvergedResources(healthReceiptOverrides = {}) {
  const profile = makeProfile();
  const deploymentRevision = makeDeploymentRevision(profile);
  const providerScope = createAwsProviderScope({
    partition: 'aws',
    accountId: '123456789012',
    region: 'us-east-1',
  });
  const providerSpec = makeProviderSpec(profile, providerScope);
  const incarnationId = createDeploymentIncarnationId(Buffer.alloc(32, 1));
  const nodeProviderResourceId = 'i-0123456789abcdef0';
  const healthReceipt = makeHealthObservation(
    deploymentRevision,
    providerScope,
    providerSpec,
    incarnationId,
    nodeProviderResourceId,
    healthReceiptOverrides,
  );
  return [
    ['substrate', 'resident-node', 'ec2-instance', nodeProviderResourceId],
    [
      'application-state',
      'application-state',
      'ebs-volume',
      'vol-0123456789abcdef0',
    ],
    ['control-state', 'control-state', 'ebs-volume', 'vol-0123456789abcdef0'],
    [
      'artifact',
      'artifact-storage',
      's3-object',
      'arn:aws:s3:::wharfie-artifacts/exact-artifact',
    ],
    [
      'runtime-identity',
      'runtime-identity',
      'instance-profile',
      'arn:aws:iam::123456789012:instance-profile/wharfie-host',
    ],
    ['network', 'networking', 'vpc', 'vpc-0123456789abcdef0'],
  ].map(([resourceKey, capability, providerType, providerResourceId]) => ({
    resourceKey,
    capability: { kind: capability, version: 1 },
    management: 'managed',
    presence: 'present',
    ownership: 'verified',
    providerIdentity: { providerType, providerResourceId },
    desiredDigest: digest(`${resourceKey} desired`),
    observedDigest: digest(`${resourceKey} desired`),
    health: capability === 'resident-node' ? 'healthy' : 'not-applicable',
    service:
      capability === 'resident-node'
        ? {
            health: 'healthy',
            artifactId: deploymentRevision.artifactId,
            revisionId: deploymentRevision.revisionId,
            healthReceipt,
          }
        : null,
  }));
}

/**
 * @param {string} status
 * @param {Array<Record<string, any>>} [resources]
 */
function makeInspection(status, resources = makeConvergedResources()) {
  const profile = makeProfile();
  const deploymentRevision = makeDeploymentRevision(profile);
  const providerScope = createAwsProviderScope({
    partition: 'aws',
    accountId: '123456789012',
    region: 'us-east-1',
  });
  const providerSpec = makeProviderSpec(profile, providerScope);
  return createDeploymentInspection(
    {
      deploymentRevision,
      providerScope,
      providerSpecId: providerSpec.providerSpecId,
      deploymentInstanceId: getDeploymentInstanceId({
        deploymentRevision,
        providerScope,
      }),
      controlState:
        status === 'absent'
          ? { status: 'absent', evidence: 'authoritative-not-found' }
          : { status: 'present', evidence: 'provider-head-read' },
      incarnationId:
        status === 'absent'
          ? null
          : createDeploymentIncarnationId(Buffer.alloc(32, 1)),
      headGeneration: status === 'absent' ? 0 : 3,
      status,
      resources: status === 'absent' ? [] : resources,
    },
    { profile, providerSpec, now: HEALTH_NOW },
  );
}

describe('provider scopes', () => {
  it('binds the resolved AWS account, partition, and region without credentials', () => {
    const scope = createAwsProviderScope({
      partition: 'aws',
      accountId: '123456789012',
      region: 'us-east-1',
    });

    expect(scope).toEqual({
      accountId: '123456789012',
      kind: 'providerScope',
      partition: 'aws',
      provider: 'aws',
      providerScopeId: expect.stringMatching(/^wps1_[A-Za-z0-9_-]{43}$/),
      region: 'us-east-1',
      schemaVersion: 1,
    });
    expect(validateProviderScope(clone(scope))).toEqual(scope);
    expect(Object.isFrozen(scope)).toBe(true);
  });

  it('changes provider and deployment-instance identity across account or region', () => {
    const deploymentRevision = makeDeploymentRevision();
    const first = createAwsProviderScope({
      partition: 'aws',
      accountId: '123456789012',
      region: 'us-east-1',
    });
    const second = createAwsProviderScope({
      partition: 'aws',
      accountId: '210987654321',
      region: 'us-east-1',
    });
    const third = createAwsProviderScope({
      partition: 'aws',
      accountId: '123456789012',
      region: 'us-west-2',
    });

    expect(second.providerScopeId).not.toBe(first.providerScopeId);
    expect(third.providerScopeId).not.toBe(first.providerScopeId);
    expect(
      getDeploymentInstanceId({ deploymentRevision, providerScope: second }),
    ).not.toBe(
      getDeploymentInstanceId({ deploymentRevision, providerScope: first }),
    );
  });

  it.each([
    [
      { partition: 'AWS', accountId: '123456789012', region: 'us-east-1' },
      /canonical AWS partition/i,
    ],
    [
      { partition: 'aws', accountId: '1234', region: 'us-east-1' },
      /12-digit AWS account/i,
    ],
    [
      { partition: 'aws', accountId: '123456789012', region: 'US-EAST-1' },
      /canonical AWS region/i,
    ],
  ])('rejects malformed resolved scope %#', (value, pattern) => {
    expect(() => createAwsProviderScope(value)).toThrow(pattern);
  });
});

describe('deployment plans', () => {
  it('creates a deterministic, exact, timestamp-free mutation preview', () => {
    const first = makePlan();
    const second = makePlan();

    expect(second).toEqual(first);
    expect(first.planId).toMatch(/^wpl2_[A-Za-z0-9_-]{43}$/);
    expect(first.actions).toHaveLength(6);
    for (const action of first.actions) {
      expect(action.actionId).toMatch(/^wda2_[A-Za-z0-9_-]{43}$/);
    }
    expect(first.summary).toEqual({
      create: 6,
      delete: 0,
      destructive: false,
      noop: 0,
      update: 0,
      verify: 0,
    });
    expect(validateDeploymentPlan(clone(first))).toEqual(first);
    expect(
      validateDeploymentPlanContext(clone(first), { profile: makeProfile() }),
    ).toEqual(first);
    expect(JSON.stringify(first)).not.toMatch(/credential|timestamp/i);
  });

  it('binds a plan to the exact provider scope and deployment instance', () => {
    const plan = makePlan();
    const changed = clone(plan);
    changed.providerScope.accountId = '210987654321';

    expect(() => validateDeploymentPlan(changed)).toThrow(
      /providerScopeId does not match|deploymentInstanceId does not match/i,
    );
  });

  it('rejects action or summary tampering', () => {
    const changedAction = clone(makePlan());
    changedAction.actions[0].after.stateDigest = digest('substitution');
    expect(() => validateDeploymentPlan(changedAction)).toThrow(
      /actionId does not match/i,
    );

    const changedSummary = clone(makePlan());
    changedSummary.summary.create = 1;
    expect(() => validateDeploymentPlan(changedSummary)).toThrow(
      /summary does not match/i,
    );
  });

  it('never permits a mutation action against an external resource', () => {
    const plan = makePlan();
    const input = {
      operation: plan.operation,
      deploymentRevision: plan.deploymentRevision,
      providerScope: plan.providerScope,
      providerSpec: plan.providerSpec,
      deploymentInstanceId: plan.deploymentInstanceId,
      incarnationId: plan.incarnationId,
      basis: plan.basis,
      actions: [
        {
          ...clone(plan.actions[0]),
          management: 'external',
        },
      ],
    };
    delete input.actions[0].actionId;
    expect(() =>
      createDeploymentPlan(input, { profile: makeProfile() }),
    ).toThrow(/cannot mutate an external resource/i);
  });

  it('limits each operation to its safe initial action set', () => {
    const plan = makePlan();
    const destroyCreate = {
      operation: 'destroy',
      deploymentRevision: plan.deploymentRevision,
      providerScope: plan.providerScope,
      providerSpec: plan.providerSpec,
      deploymentInstanceId: plan.deploymentInstanceId,
      incarnationId: plan.incarnationId,
      basis: plan.basis,
      actions: [clone(plan.actions[0])],
    };
    delete destroyCreate.actions[0].actionId;
    expect(() =>
      createDeploymentPlan(destroyCreate, { profile: makeProfile() }),
    ).toThrow(/not allowed during destroy/i);

    const duplicate = {
      ...destroyCreate,
      operation: 'apply',
      actions: [
        clone(destroyCreate.actions[0]),
        clone(destroyCreate.actions[0]),
      ],
    };
    expect(() =>
      createDeploymentPlan(duplicate, { profile: makeProfile() }),
    ).toThrow(/each resourceKey at most once/i);
  });

  it('requires exact existing identity and refuses provider resource replacement', () => {
    const plan = makePlan();
    const withoutIds = () =>
      /** @type {Record<string, any>[]} */ (clone(plan.actions)).map(
        (action) => {
          delete action.actionId;
          return action;
        },
      );
    const missingIdentity = withoutIds();
    missingIdentity[0] = {
      ...missingIdentity[0],
      action: 'verify',
      reason: 'already-converged',
    };
    expect(() =>
      createDeploymentPlan(
        {
          operation: plan.operation,
          deploymentRevision: plan.deploymentRevision,
          providerScope: plan.providerScope,
          providerSpec: plan.providerSpec,
          deploymentInstanceId: plan.deploymentInstanceId,
          incarnationId: plan.incarnationId,
          basis: plan.basis,
          actions: missingIdentity,
        },
        { profile: makeProfile() },
      ),
    ).toThrow(/identify the exact existing provider resource/i);

    const replacement = withoutIds();
    replacement[0] = {
      ...replacement[0],
      action: 'update',
      reason: 'drift',
      before: {
        ...replacement[0].after,
        providerResourceId: 'i-0123456789abcdef0',
      },
      after: {
        ...replacement[0].after,
        providerResourceId: 'i-0fedcba9876543210',
      },
    };
    expect(() =>
      createDeploymentPlan(
        {
          operation: plan.operation,
          deploymentRevision: plan.deploymentRevision,
          providerScope: plan.providerScope,
          providerSpec: plan.providerSpec,
          deploymentInstanceId: plan.deploymentInstanceId,
          incarnationId: plan.incarnationId,
          basis: plan.basis,
          actions: replacement,
        },
        { profile: makeProfile() },
      ),
    ).toThrow(/preserve the exact provider resource identity/i);
  });

  it('refuses a resolved provider region different from the exact profile', () => {
    const profile = makeProfile('us-east-1');
    const deploymentRevision = makeDeploymentRevision(profile);
    const providerScope = createAwsProviderScope({
      partition: 'aws',
      accountId: '123456789012',
      region: 'us-west-2',
    });
    const reference = makePlan();
    const actions = /** @type {Record<string, any>[]} */ (
      clone(reference.actions)
    ).map((action) => {
      delete action.actionId;
      return action;
    });
    expect(() =>
      createDeploymentPlan(
        {
          operation: 'apply',
          deploymentRevision,
          providerScope,
          providerSpec: reference.providerSpec,
          deploymentInstanceId: getDeploymentInstanceId({
            deploymentRevision,
            providerScope,
          }),
          incarnationId: reference.incarnationId,
          basis: reference.basis,
          actions,
        },
        { profile },
      ),
    ).toThrow(/providerSpec.*exact provider scope/i);
  });

  it('does not permit duplicate capabilities or arbitrary provider types', () => {
    const plan = makePlan();
    const duplicateCapability = /** @type {Record<string, any>[]} */ (
      clone(plan.actions)
    ).map((action) => {
      delete action.actionId;
      return action;
    });
    duplicateCapability[1].capability = {
      ...duplicateCapability[0].capability,
    };
    duplicateCapability[1].after.providerType = 'ec2-instance';
    expect(() =>
      createDeploymentPlan(
        {
          operation: plan.operation,
          deploymentRevision: plan.deploymentRevision,
          providerScope: plan.providerScope,
          providerSpec: plan.providerSpec,
          deploymentInstanceId: plan.deploymentInstanceId,
          incarnationId: plan.incarnationId,
          basis: plan.basis,
          actions: duplicateCapability,
        },
        { profile: makeProfile() },
      ),
    ).toThrow(/each profile capability exactly once/i);

    const wrongProviderType = /** @type {Record<string, any>[]} */ (
      clone(plan.actions)
    ).map((action) => {
      delete action.actionId;
      return action;
    });
    wrongProviderType[0].after.providerType = 'iam-user';
    expect(() =>
      createDeploymentPlan(
        {
          operation: plan.operation,
          deploymentRevision: plan.deploymentRevision,
          providerScope: plan.providerScope,
          providerSpec: plan.providerSpec,
          deploymentInstanceId: plan.deploymentInstanceId,
          incarnationId: plan.incarnationId,
          basis: plan.basis,
          actions: wrongProviderType,
        },
        { profile: makeProfile() },
      ),
    ).toThrow(/provider type does not implement capability/i);
  });

  it('requires exact delete identity and rejects credential-bearing plan state', () => {
    const plan = makePlan();
    const deletion = clone(plan.actions[0]);
    delete deletion.actionId;
    deletion.action = 'delete';
    deletion.destructive = true;
    deletion.reason = 'destroy-requested';
    deletion.before = deletion.after;
    deletion.after = null;
    expect(() =>
      createDeploymentPlan(
        {
          operation: 'destroy',
          deploymentRevision: plan.deploymentRevision,
          providerScope: plan.providerScope,
          providerSpec: plan.providerSpec,
          deploymentInstanceId: plan.deploymentInstanceId,
          incarnationId: plan.incarnationId,
          basis: plan.basis,
          actions: [deletion],
        },
        { profile: makeProfile() },
      ),
    ).toThrow(/identify the exact existing provider resource/i);

    const secret = 'plan-password-sentinel';
    const credentialState = /** @type {Record<string, any>[]} */ (
      clone(plan.actions)
    ).map((action) => {
      delete action.actionId;
      return action;
    });
    credentialState[0].after.providerResourceId = `https://user:${secret}@example.invalid/substrate`;
    let thrown;
    try {
      createDeploymentPlan(
        {
          operation: plan.operation,
          deploymentRevision: plan.deploymentRevision,
          providerScope: plan.providerScope,
          providerSpec: plan.providerSpec,
          deploymentInstanceId: plan.deploymentInstanceId,
          incarnationId: plan.incarnationId,
          basis: plan.basis,
          actions: credentialState,
        },
        { profile: makeProfile() },
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).toMatch(/credential-bearing URL/i);
    expect(String(thrown)).not.toContain(secret);
  });
});

describe('deployment inspections', () => {
  it('creates deterministic exact evidence and sorts resources', () => {
    const resources = makeConvergedResources().reverse();
    const first = makeInspection('converged', resources);
    const second = makeInspection('converged', resources);

    expect(second).toEqual(first);
    expect(first.inspectionId).toMatch(/^win3_[A-Za-z0-9_-]{43}$/);
    expect(
      first.resources.map(
        (/** @type {Record<string, any>} */ resource) => resource.resourceKey,
      ),
    ).toEqual([
      'application-state',
      'artifact',
      'control-state',
      'network',
      'runtime-identity',
      'substrate',
    ]);
    expect(validateDeploymentInspection(clone(first))).toEqual(first);
    const profile = makeProfile();
    const providerSpec = makeProviderSpec(profile, first.providerScope);
    expect(
      validateDeploymentInspectionContext(clone(first), {
        profile,
        providerSpec,
        now: HEALTH_NOW,
      }),
    ).toEqual(first);
    expect(() =>
      validateDeploymentInspectionContext(clone(first), {
        profile,
        providerSpec,
        now: HEALTH_NOW + 65_001,
      }),
    ).toThrow(/stale/i);
    expect(() =>
      validateDeploymentInspectionContext(clone(first), {
        profile,
        providerSpec,
        now: HEALTH_NOW - 5_001,
      }),
    ).toThrow(/conflict/i);
    expect(() =>
      validateDeploymentInspectionContext(clone(first), {
        profile,
        providerSpec,
      }),
    ).toThrow(/freshness context\.now/i);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('represents confirmed nonexistence without manufacturing an incarnation', () => {
    const inspection = makeInspection('absent');

    expect(inspection).toMatchObject({
      headGeneration: 0,
      incarnationId: null,
      resources: [],
      status: 'absent',
    });
  });

  it('represents head access failure without inventing absence or an incarnation', () => {
    const profile = makeProfile();
    const deploymentRevision = makeDeploymentRevision(profile);
    const providerScope = createAwsProviderScope({
      partition: 'aws',
      accountId: '123456789012',
      region: 'us-east-1',
    });
    const providerSpec = makeProviderSpec(profile, providerScope);
    const inspection = createDeploymentInspection(
      {
        deploymentRevision,
        providerScope,
        providerSpecId: providerSpec.providerSpecId,
        deploymentInstanceId: getDeploymentInstanceId({
          deploymentRevision,
          providerScope,
        }),
        controlState: { status: 'unknown', evidence: 'access-failure' },
        incarnationId: null,
        headGeneration: 0,
        status: 'unknown',
        resources: [],
      },
      { profile, providerSpec },
    );

    expect(inspection).toMatchObject({
      controlState: { status: 'unknown', evidence: 'access-failure' },
      headGeneration: 0,
      incarnationId: null,
      status: 'unknown',
    });
    expect(() =>
      createDeploymentInspection(
        {
          ...clone(inspection),
          controlState: {
            status: 'absent',
            evidence: 'authoritative-not-found',
          },
        },
        { profile, providerSpec },
      ),
    ).toThrow(/not supported|authoritative head absence/i);
  });

  it('requires exact capability coverage before claiming convergence', () => {
    const resources = makeConvergedResources();
    resources.pop();
    expect(() => makeInspection('converged', resources)).toThrow(
      /does not report required capability/i,
    );

    const mismatched = makeConvergedResources();
    mismatched[0].observedDigest = digest('drifted node');
    expect(() => makeInspection('converged', mismatched)).toThrow(
      /converged status requires exact/i,
    );

    const noServiceProof = makeConvergedResources();
    noServiceProof[0].health = 'not-applicable';
    noServiceProof[0].service = null;
    expect(() => makeInspection('converged', noServiceProof)).toThrow(
      /converged status requires exact/i,
    );

    const missingProviderReceipt = makeConvergedResources();
    missingProviderReceipt[0].service.healthReceipt = null;
    expect(() => makeInspection('converged', missingProviderReceipt)).toThrow(
      /healthReceipt is required/i,
    );

    const wrongRelease = makeConvergedResources();
    wrongRelease[0].service.artifactId = createSha256Id({
      prefix: 'waf1',
      payload: 'different artifact',
    });
    expect(() => makeInspection('converged', wrongRelease)).toThrow(
      /exact reported health and release|exact deployment artifact and revision/i,
    );
  });

  it('accepts provider health only for the exact S3 location and healthy service state', () => {
    const wrongBucket = makeConvergedResources();
    wrongBucket[0].service.healthReceipt = clone(
      wrongBucket[0].service.healthReceipt,
    );
    wrongBucket[0].service.healthReceipt.object.bucketName =
      'wharfie-dc-v1-210987654321-aaaaaaaaaaaaaaaaaaaa';
    expect(() => makeInspection('converged', wrongBucket)).toThrow(
      /exact inspection authority/i,
    );

    const startingWithProof = makeConvergedResources();
    startingWithProof[0].health = 'starting';
    startingWithProof[0].service.health = 'starting';
    expect(() => makeInspection('in-flight', startingWithProof)).toThrow(
      /can prove only provider-visible healthy status/i,
    );

    startingWithProof[0].service.healthReceipt = null;
    expect(makeInspection('in-flight', startingWithProof).status).toBe(
      'in-flight',
    );
  });

  it('does not turn unknown provider evidence into absence or convergence', () => {
    const resources = makeConvergedResources();
    resources[0] = {
      ...resources[0],
      presence: 'unknown',
      ownership: 'unknown',
      providerIdentity: null,
      observedDigest: null,
      health: 'unknown',
      service: null,
    };

    expect(() => makeInspection('converged', resources)).toThrow(
      /unknown provider evidence|converged status/i,
    );
    expect(makeInspection('unknown', resources).status).toBe('unknown');
  });

  it('requires concrete evidence for conflict, drift, and degradation', () => {
    expect(() => makeInspection('conflict')).toThrow(
      /requires ownership conflict evidence/i,
    );
    expect(() => makeInspection('drifted')).toThrow(
      /requires concrete drift evidence/i,
    );
    expect(() => makeInspection('degraded')).toThrow(
      /requires unhealthy resource evidence/i,
    );
  });

  it('keeps retained state while proving the remaining deployment is destroyed', () => {
    const resources = makeConvergedResources().map((resource) => {
      if (
        resource.capability.kind === 'application-state' ||
        resource.capability.kind === 'control-state'
      ) {
        return resource;
      }
      return {
        ...resource,
        presence: 'absent',
        providerIdentity: null,
        observedDigest: null,
        health: 'absent',
        service: null,
      };
    });
    const inspection = makeInspection('destroyed', resources);

    expect(inspection.status).toBe('destroyed');
    expect(
      inspection.resources.filter(
        (/** @type {Record<string, any>} */ resource) =>
          resource.presence === 'present',
      ),
    ).toHaveLength(2);

    const missingRetainedState = clone(resources);
    const retainedIndex = missingRetainedState.findIndex(
      ({ capability }) => capability.kind === 'application-state',
    );
    missingRetainedState[retainedIndex] = {
      ...missingRetainedState[retainedIndex],
      presence: 'absent',
      providerIdentity: null,
      observedDigest: null,
      health: 'absent',
      service: null,
    };
    expect(() => makeInspection('destroyed', missingRetainedState)).toThrow(
      /retained capability.*remain present/i,
    );

    const unownedRetainedState = clone(resources);
    const unownedIndex = unownedRetainedState.findIndex(
      ({ capability }) => capability.kind === 'application-state',
    );
    unownedRetainedState[unownedIndex] = {
      ...unownedRetainedState[unownedIndex],
      ownership: 'missing',
    };
    expect(() => makeInspection('destroyed', unownedRetainedState)).toThrow(
      /retained capability.*exact ownership evidence/i,
    );
  });

  it('detects serialized evidence tampering', () => {
    const changed = clone(makeInspection('converged'));
    changed.resources[0].health = 'degraded';

    expect(() => validateDeploymentInspection(changed)).toThrow(
      /inspectionId does not match|converged status requires exact/i,
    );
  });
});

describe('deployment resource bindings', () => {
  it('records immutable provider identity and independently random ownership evidence', () => {
    const plan = makePlan();
    const binding = createDeploymentResourceBinding({
      schemaVersion: 1,
      kind: 'deploymentResourceBinding',
      deploymentInstanceId: plan.deploymentInstanceId,
      incarnationId: plan.incarnationId,
      resourceKey: 'substrate',
      capability: { kind: 'resident-node', version: 1 },
      management: 'managed',
      providerType: 'ec2-instance',
      providerResourceId:
        'arn:aws:cloudformation:us-east-1:123456789012:stack/wharfie-demo/stack-id',
      providerScopeId: plan.providerScope.providerScopeId,
      ownershipNonce: createOwnershipNonce(Buffer.alloc(32, 2)),
      createdByActionId: plan.actions[0].actionId,
    });

    expect(binding.bindingId).toMatch(/^wrb1_[A-Za-z0-9_-]{43}$/);
    expect(binding.ownershipNonce).toBe(
      Buffer.alloc(32, 2).toString('base64url'),
    );
    expect(validateDeploymentResourceBinding(clone(binding))).toEqual(binding);
    expect(Object.isFrozen(binding)).toBe(true);
  });

  it('supports read-only external references without manufacturing ownership', () => {
    const plan = makePlan();
    const binding = createDeploymentResourceBinding({
      schemaVersion: 1,
      kind: 'deploymentResourceBinding',
      deploymentInstanceId: plan.deploymentInstanceId,
      incarnationId: plan.incarnationId,
      resourceKey: 'network',
      capability: { kind: 'networking', version: 1 },
      management: 'external',
      providerType: 'vpc',
      providerResourceId: 'vpc-0123456789abcdef0',
      providerScopeId: plan.providerScope.providerScopeId,
    });

    expect(binding.management).toBe('external');
    expect(binding).not.toHaveProperty('ownershipNonce');
    expect(binding).not.toHaveProperty('createdByActionId');
  });

  it('rejects weak ownership, external ownership claims, and binding tampering', () => {
    expect(() => validateOwnershipNonce('dG9vLXNob3J0')).toThrow(
      /at least 128 bits/i,
    );

    const plan = makePlan();
    const externalClaim = {
      schemaVersion: 1,
      kind: 'deploymentResourceBinding',
      deploymentInstanceId: plan.deploymentInstanceId,
      incarnationId: plan.incarnationId,
      resourceKey: 'network',
      capability: { kind: 'networking', version: 1 },
      management: 'external',
      providerType: 'vpc',
      providerResourceId: 'vpc-0123456789abcdef0',
      providerScopeId: plan.providerScope.providerScopeId,
      ownershipNonce: createOwnershipNonce(Buffer.alloc(32, 3)),
      createdByActionId: plan.actions[0].actionId,
    };
    expect(() => createDeploymentResourceBinding(externalClaim)).toThrow(
      /ownershipNonce is not supported for external/i,
    );

    const managed = { ...externalClaim, management: 'managed' };
    const binding = /** @type {Record<string, any>} */ (
      clone(createDeploymentResourceBinding(managed))
    );
    binding.providerResourceId = 'different-stack-id';
    expect(() => validateDeploymentResourceBinding(binding)).toThrow(
      /bindingId does not match/i,
    );
  });

  it('rejects credential-bearing provider resource URLs without echoing them', () => {
    const plan = makePlan();
    const secret = 'resource-id-password-sentinel';
    const value = {
      schemaVersion: 1,
      kind: 'deploymentResourceBinding',
      deploymentInstanceId: plan.deploymentInstanceId,
      incarnationId: plan.incarnationId,
      resourceKey: 'artifact',
      capability: { kind: 'artifact-storage', version: 1 },
      management: 'external',
      providerType: 'object',
      providerResourceId: `https://user:${secret}@example.invalid/artifact`,
      providerScopeId: plan.providerScope.providerScopeId,
    };
    let thrown;
    try {
      createDeploymentResourceBinding(value);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).toMatch(/credential-bearing URL/i);
    expect(String(thrown)).not.toContain(secret);
  });
});
