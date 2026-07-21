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
import { createDeploymentHead } from '../../src/core/runtime/deployment-head.js';
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
  AWS_SINGLE_NODE_RESOURCE_GRAPH,
  getAwsSingleNodeResourceApplyOrder,
} from '../../src/core/runtime/deployment-resource-graph.js';
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

/** @returns {Readonly<Record<string, any>>} */
function makeBase() {
  const profile = makeProfile();
  const deploymentRevision = makeDeploymentRevision(profile);
  const providerScope = createAwsProviderScope({
    partition: 'aws',
    accountId: '123456789012',
    region: 'us-east-1',
  });
  return Object.freeze({
    profile,
    deploymentRevision,
    providerScope,
    providerSpec: makeProviderSpec(profile, providerScope),
    deploymentInstanceId: getDeploymentInstanceId({
      deploymentRevision,
      providerScope,
    }),
    incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 1)),
  });
}

/** @param {string} resourceKey @returns {string} */
function providerResourceId(resourceKey) {
  if (resourceKey === 'substrate') return 'i-0123456789abcdef0';
  if (resourceKey === 'application-state') return 'vol-0123456789abcdef0';
  if (resourceKey === 'control-state') return 'vol-0fedcba9876543210';
  if (resourceKey === 'artifact') {
    return 'arn:aws:s3:::wharfie-artifacts/exact-artifact';
  }
  if (resourceKey === 'runtime-identity') {
    return 'arn:aws:iam::123456789012:instance-profile/wharfie-host';
  }
  return `provider-resource-${resourceKey}`;
}

/** @param {Readonly<Record<string, any>>} resourceDefinition @param {boolean} existing */
function resourceState(resourceDefinition, existing) {
  return {
    providerType: resourceDefinition.providerType,
    providerResourceId: existing
      ? providerResourceId(resourceDefinition.resourceKey)
      : null,
    stateDigest: digest(`${resourceDefinition.resourceKey} desired`),
  };
}

/**
 * @param {'apply'|'reconcile'|'destroy'} [operation]
 * @param {Readonly<Record<string, any>>} [base]
 * @returns {ReturnType<typeof createDeploymentPlan>}
 */
function makePlan(operation = 'apply', base = makeBase()) {
  const definitions =
    operation === 'destroy'
      ? [...AWS_SINGLE_NODE_RESOURCE_GRAPH.resources].reverse()
      : AWS_SINGLE_NODE_RESOURCE_GRAPH.resources;
  const actions = definitions.map(
    (/** @type {Readonly<Record<string, any>>} */ definition) => {
      const contract = {
        resourceKey: definition.resourceKey,
        capability: definition.capability,
        role: definition.role,
        management: 'managed',
        ownershipMode: definition.ownershipMode,
        dependsOn: definition.dependsOn,
        onDestroy: definition.onDestroy,
      };
      const desired = resourceState(definition, false);
      const existing = resourceState(definition, true);
      if (operation === 'apply') {
        return {
          ...contract,
          action: 'create',
          destructive: false,
          reason: 'missing',
          before: null,
          after: desired,
        };
      }
      if (operation === 'reconcile') {
        return {
          ...contract,
          action: 'noop',
          destructive: false,
          reason: 'already-converged',
          before: existing,
          after: existing,
        };
      }
      const retained = definition.onDestroy === 'retain';
      return {
        ...contract,
        action: retained ? 'noop' : 'delete',
        destructive: !retained,
        reason: retained ? 'retained-data' : 'destroy-requested',
        before: existing,
        after: retained ? existing : null,
      };
    },
  );
  return createDeploymentPlan(
    {
      operation,
      deploymentRevision: base.deploymentRevision,
      providerScope: base.providerScope,
      providerSpec: base.providerSpec,
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
      basis: {
        headGeneration: operation === 'apply' ? 0 : 3,
        settledDeploymentRevisionId:
          operation === 'apply'
            ? null
            : base.deploymentRevision.deploymentRevisionId,
        inspectionId: semanticId('win4', 'wharfie:test:inspection:v4', {
          operation,
        }),
      },
      actions,
    },
    { profile: base.profile },
  );
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} plan */
function makeBindings(base, plan) {
  const bindingByResourceKey = new Map();
  for (let index = 0; index < plan.actions.length; index += 1) {
    const action = plan.actions[index];
    const dependencyBindings = action.dependsOn.map(
      (/** @type {string} */ resourceKey) => {
        const dependency = bindingByResourceKey.get(resourceKey);
        if (dependency === undefined) {
          throw new Error(`Missing fixture dependency '${resourceKey}'.`);
        }
        return { resourceKey, bindingId: dependency.bindingId };
      },
    );
    const binding = createDeploymentResourceBinding({
      schemaVersion: 2,
      kind: 'deploymentResourceBinding',
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
      resourceKey: action.resourceKey,
      capability: action.capability,
      role: action.role,
      management: action.management,
      ownershipMode: action.ownershipMode,
      onDestroy: action.onDestroy,
      dependencyBindings,
      providerType: action.after.providerType,
      providerResourceId: providerResourceId(action.resourceKey),
      providerScopeId: base.providerScope.providerScopeId,
      ownershipNonce: createOwnershipNonce(Buffer.alloc(32, index + 2)),
      createdByActionId: action.actionId,
    });
    bindingByResourceKey.set(action.resourceKey, binding);
  }
  return bindingByResourceKey;
}

/** @returns {Readonly<Record<string, any>>} */
function makeReadyAuthority() {
  const base = makeBase();
  const plan = makePlan('apply', base);
  const bindingByResourceKey = makeBindings(base, plan);
  const bindings = [...bindingByResourceKey.values()];
  const head = createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: 3,
    phase: 'READY',
    settledDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    resourceBindings: bindings,
    activeOperation: null,
    lastOperation: {
      kind: 'create',
      planId: plan.planId,
      intents: plan.actions.map(
        (/** @type {Readonly<Record<string, any>>} */ action) => {
          const binding = bindingByResourceKey.get(action.resourceKey);
          if (binding === undefined) {
            throw new Error(`Missing fixture binding '${action.resourceKey}'.`);
          }
          return {
            actionId: action.actionId,
            status: 'settled',
            ownershipNonce: binding.ownershipNonce,
          };
        },
      ),
    },
  });
  return Object.freeze({ ...base, plan, bindingByResourceKey, head });
}

/** @param {Readonly<Record<string, any>>} authority @param {Record<string, any>} [overrides] */
function makeHealthObservation(authority, overrides = {}) {
  const nodeBinding = authority.bindingByResourceKey.get('substrate');
  if (nodeBinding === undefined || authority.head.lastOperation === null) {
    throw new Error('Fixture requires node and completed operation authority.');
  }
  const receipt = createDeploymentServiceHealthReceipt({
    providerScopeId: authority.providerScope.providerScopeId,
    providerSpecId: authority.providerSpec.providerSpecId,
    deploymentInstanceId: authority.deploymentInstanceId,
    incarnationId: authority.incarnationId,
    deploymentOperationId: authority.head.lastOperation.operationId,
    authorizedHeadId: authority.head.headId,
    authorizedHeadGeneration: authority.head.generation,
    nodeBindingId: nodeBinding.bindingId,
    nodeProviderResourceId: nodeBinding.providerResourceId,
    deploymentRevisionId: authority.deploymentRevision.deploymentRevisionId,
    appId: authority.deploymentRevision.appId,
    artifactId: authority.deploymentRevision.artifactId,
    revisionId: authority.deploymentRevision.revisionId,
    serviceId: createLedgerServiceId({
      appId: authority.deploymentRevision.appId,
    }),
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
    authority.providerScope,
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

/**
 * @param {Record<string, any>} [healthReceiptOverrides]
 * @returns {Readonly<Record<string, any>>}
 */
function makeInspectionAuthority(healthReceiptOverrides = {}) {
  const authority = makeReadyAuthority();
  const healthReceipt = makeHealthObservation(
    authority,
    healthReceiptOverrides,
  );
  const resources = AWS_SINGLE_NODE_RESOURCE_GRAPH.resources.map(
    (/** @type {Readonly<Record<string, any>>} */ definition) => {
      const binding = authority.bindingByResourceKey.get(
        definition.resourceKey,
      );
      if (binding === undefined) {
        throw new Error(`Missing fixture binding '${definition.resourceKey}'.`);
      }
      const resident = definition.resourceKey === 'substrate';
      return {
        resourceKey: definition.resourceKey,
        capability: definition.capability,
        role: definition.role,
        management: 'managed',
        ownershipMode: definition.ownershipMode,
        dependsOn: definition.dependsOn,
        onDestroy: definition.onDestroy,
        bindingId: binding.bindingId,
        dependencyBindings: binding.dependencyBindings,
        presence: 'present',
        presenceEvidence: 'exact-read',
        ownership: 'verified',
        providerIdentity: {
          providerType: definition.providerType,
          providerResourceId: binding.providerResourceId,
        },
        desiredDigest: digest(`${definition.resourceKey} desired`),
        observedDigest: digest(`${definition.resourceKey} desired`),
        health: resident ? 'healthy' : 'not-applicable',
        service: resident
          ? {
              health: 'healthy',
              artifactId: authority.deploymentRevision.artifactId,
              revisionId: authority.deploymentRevision.revisionId,
              healthReceipt,
            }
          : null,
      };
    },
  );
  return Object.freeze({ ...authority, resources });
}

/** @param {Record<string, any>} [healthReceiptOverrides] @returns {Array<Record<string, any>>} */
function makeConvergedResources(healthReceiptOverrides = {}) {
  return clone(makeInspectionAuthority(healthReceiptOverrides).resources);
}

/** @param {Array<Record<string, any>>} resources @param {string} resourceKey */
function requireResource(resources, resourceKey) {
  const resource = resources.find(
    (candidate) => candidate.resourceKey === resourceKey,
  );
  if (resource === undefined) {
    throw new Error(`Missing fixture resource '${resourceKey}'.`);
  }
  return resource;
}

/**
 * @param {string} status
 * @param {Array<Record<string, any>>} [resources]
 */
function makeInspection(status, resources) {
  const authority = makeInspectionAuthority();
  const absent = status === 'absent';
  return createDeploymentInspection(
    {
      deploymentRevision: authority.deploymentRevision,
      providerScope: authority.providerScope,
      providerSpecId: authority.providerSpec.providerSpecId,
      deploymentInstanceId: authority.deploymentInstanceId,
      controlState: absent
        ? { status: 'absent', evidence: 'authoritative-not-found' }
        : { status: 'present', evidence: 'provider-head-read' },
      incarnationId: absent ? null : authority.incarnationId,
      headGeneration: absent ? 0 : authority.head.generation,
      status,
      resources: absent ? [] : (resources ?? clone(authority.resources)),
    },
    {
      profile: authority.profile,
      providerSpec: authority.providerSpec,
      ...(absent ? {} : { head: authority.head }),
      now: HEALTH_NOW,
    },
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
    expect(first.planId).toMatch(/^wpl3_[A-Za-z0-9_-]{43}$/);
    expect(first.providerSpec).toMatchObject({
      schemaVersion: 3,
      providerSpecId: expect.stringMatching(/^wap3_[A-Za-z0-9_-]{43}$/),
      resourceGraphId: AWS_SINGLE_NODE_RESOURCE_GRAPH.resourceGraphId,
    });
    expect(first.actions).toHaveLength(15);
    expect(
      first.actions.map(
        (/** @type {Readonly<Record<string, any>>} */ action) =>
          action.resourceKey,
      ),
    ).toEqual(getAwsSingleNodeResourceApplyOrder());
    for (const action of first.actions) {
      expect(action.actionId).toMatch(/^wda3_[A-Za-z0-9_-]{43}$/);
    }
    expect(first.summary).toEqual({
      create: 15,
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
    const actions = /** @type {Array<Record<string, any>>} */ (
      clone(plan.actions)
    );
    for (const action of actions) delete action.actionId;
    actions[0].management = 'external';
    const input = {
      operation: plan.operation,
      deploymentRevision: plan.deploymentRevision,
      providerScope: plan.providerScope,
      providerSpec: plan.providerSpec,
      deploymentInstanceId: plan.deploymentInstanceId,
      incarnationId: plan.incarnationId,
      basis: plan.basis,
      actions,
    };
    expect(() =>
      createDeploymentPlan(input, { profile: makeProfile() }),
    ).toThrow(/cannot mutate an external resource/i);
  });

  it('limits each operation to its safe initial action set', () => {
    const plan = makePlan('destroy');
    const destroyActions = /** @type {Array<Record<string, any>>} */ (
      clone(plan.actions)
    );
    for (const action of destroyActions) delete action.actionId;
    destroyActions[0] = {
      ...destroyActions[0],
      action: 'create',
      destructive: false,
      reason: 'missing',
      before: null,
      after: destroyActions[0].before,
    };
    const destroyCreate = {
      operation: 'destroy',
      deploymentRevision: plan.deploymentRevision,
      providerScope: plan.providerScope,
      providerSpec: plan.providerSpec,
      deploymentInstanceId: plan.deploymentInstanceId,
      incarnationId: plan.incarnationId,
      basis: plan.basis,
      actions: destroyActions,
    };
    expect(() =>
      createDeploymentPlan(destroyCreate, { profile: makeProfile() }),
    ).toThrow(/not allowed during destroy/i);

    const applyPlan = makePlan();
    const duplicateActions = /** @type {Array<Record<string, any>>} */ (
      clone(applyPlan.actions)
    );
    for (const action of duplicateActions) delete action.actionId;
    duplicateActions[1] = clone(duplicateActions[0]);
    const duplicate = {
      operation: 'apply',
      deploymentRevision: applyPlan.deploymentRevision,
      providerScope: applyPlan.providerScope,
      providerSpec: applyPlan.providerSpec,
      deploymentInstanceId: applyPlan.deploymentInstanceId,
      incarnationId: applyPlan.incarnationId,
      basis: applyPlan.basis,
      actions: duplicateActions,
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

  it('rejects missing, duplicate, or swapped graph roles and arbitrary provider types', () => {
    const plan = makePlan();
    const withoutActionIds = () =>
      /** @type {Record<string, any>[]} */ (clone(plan.actions)).map(
        (action) => {
          delete action.actionId;
          return action;
        },
      );

    const missingRole = withoutActionIds();
    delete missingRole[1].role;
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
          actions: missingRole,
        },
        { profile: makeProfile() },
      ),
    ).toThrow(/role is required/i);

    const duplicateRole = withoutActionIds();
    duplicateRole[2].capability = clone(duplicateRole[1].capability);
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
          actions: duplicateRole,
        },
        { profile: makeProfile() },
      ),
    ).toThrow(/exact AWS single-node resource graph role/i);

    const swappedVolumes = withoutActionIds();
    [swappedVolumes[1].capability, swappedVolumes[2].capability] = [
      swappedVolumes[2].capability,
      swappedVolumes[1].capability,
    ];
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
          actions: swappedVolumes,
        },
        { profile: makeProfile() },
      ),
    ).toThrow(/exact AWS single-node resource graph role/i);

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
    ).toThrow(/provider type does not match resource graph role/i);
  });

  it('requires exact delete identity and rejects credential-bearing plan state', () => {
    const destroyPlan = makePlan('destroy');
    const deletion = /** @type {Array<Record<string, any>>} */ (
      clone(destroyPlan.actions)
    );
    for (const action of deletion) delete action.actionId;
    deletion[0].before.providerResourceId = null;
    expect(() =>
      createDeploymentPlan(
        {
          operation: 'destroy',
          deploymentRevision: destroyPlan.deploymentRevision,
          providerScope: destroyPlan.providerScope,
          providerSpec: destroyPlan.providerSpec,
          deploymentInstanceId: destroyPlan.deploymentInstanceId,
          incarnationId: destroyPlan.incarnationId,
          basis: destroyPlan.basis,
          actions: deletion,
        },
        { profile: makeProfile() },
      ),
    ).toThrow(/identify the exact existing provider resource/i);

    const plan = makePlan();
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
  it('creates deterministic exact evidence in canonical graph order', () => {
    const resources = makeConvergedResources();
    const first = makeInspection('converged', resources);
    const second = makeInspection('converged', resources);
    const authority = makeInspectionAuthority();

    expect(second).toEqual(first);
    expect(first.inspectionId).toMatch(/^win4_[A-Za-z0-9_-]{43}$/);
    expect(authority.head.headId).toMatch(/^wdh2_[A-Za-z0-9_-]{43}$/);
    expect(authority.head.lastOperation.operationId).toMatch(
      /^wdo2_[A-Za-z0-9_-]{43}$/,
    );
    expect(
      first.resources.map(
        (/** @type {Record<string, any>} */ resource) => resource.resourceKey,
      ),
    ).toEqual(getAwsSingleNodeResourceApplyOrder());
    for (const resource of first.resources) {
      expect(resource).toMatchObject({
        presenceEvidence: 'exact-read',
        bindingId: expect.stringMatching(/^wrb2_[A-Za-z0-9_-]{43}$/),
        dependencyBindings: expect.any(Array),
      });
    }
    expect(() => makeInspection('converged', [...resources].reverse())).toThrow(
      /topological apply order/i,
    );
    expect(validateDeploymentInspection(clone(first))).toEqual(first);
    expect(
      validateDeploymentInspectionContext(clone(first), {
        profile: authority.profile,
        providerSpec: authority.providerSpec,
        head: authority.head,
        now: HEALTH_NOW,
      }),
    ).toEqual(first);
    expect(() =>
      validateDeploymentInspectionContext(clone(first), {
        profile: authority.profile,
        providerSpec: authority.providerSpec,
        head: authority.head,
        now: HEALTH_NOW + 65_001,
      }),
    ).toThrow(/stale/i);
    expect(() =>
      validateDeploymentInspectionContext(clone(first), {
        profile: authority.profile,
        providerSpec: authority.providerSpec,
        head: authority.head,
        now: HEALTH_NOW - 5_001,
      }),
    ).toThrow(/conflict/i);
    expect(() =>
      validateDeploymentInspectionContext(clone(first), {
        profile: authority.profile,
        providerSpec: authority.providerSpec,
        head: authority.head,
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

  it('requires exact graph-role coverage before claiming convergence', () => {
    const resources = makeConvergedResources();
    resources.pop();
    expect(() => makeInspection('converged', resources)).toThrow(
      /complete AWS single-node resource graph/i,
    );

    const mismatched = makeConvergedResources();
    requireResource(mismatched, 'substrate').observedDigest =
      digest('drifted node');
    expect(() => makeInspection('converged', mismatched)).toThrow(
      /converged status requires exact/i,
    );

    const noServiceProof = makeConvergedResources();
    requireResource(noServiceProof, 'substrate').health = 'not-applicable';
    requireResource(noServiceProof, 'substrate').service = null;
    expect(() => makeInspection('converged', noServiceProof)).toThrow(
      /converged status requires exact/i,
    );

    const missingProviderReceipt = makeConvergedResources();
    requireResource(missingProviderReceipt, 'substrate').service.healthReceipt =
      null;
    expect(() => makeInspection('converged', missingProviderReceipt)).toThrow(
      /healthReceipt is required/i,
    );

    const wrongRelease = makeConvergedResources();
    requireResource(wrongRelease, 'substrate').service.artifactId =
      createSha256Id({
        prefix: 'waf1',
        payload: 'different artifact',
      });
    expect(() => makeInspection('converged', wrongRelease)).toThrow(
      /exact reported health and release|exact deployment artifact and revision/i,
    );
  });

  it('accepts provider health only for the exact S3 location and healthy service state', () => {
    const wrongBucket = makeConvergedResources();
    const wrongBucketNode = requireResource(wrongBucket, 'substrate');
    wrongBucketNode.service.healthReceipt = clone(
      wrongBucketNode.service.healthReceipt,
    );
    wrongBucketNode.service.healthReceipt.object.bucketName =
      'wharfie-dc-v1-210987654321-aaaaaaaaaaaaaaaaaaaa';
    expect(() => makeInspection('converged', wrongBucket)).toThrow(
      /exact inspection authority/i,
    );

    const startingWithProof = makeConvergedResources();
    const startingNode = requireResource(startingWithProof, 'substrate');
    startingNode.health = 'starting';
    startingNode.service.health = 'starting';
    expect(() => makeInspection('in-flight', startingWithProof)).toThrow(
      /can prove only provider-visible healthy status/i,
    );

    startingNode.service.healthReceipt = null;
    expect(makeInspection('in-flight', startingWithProof).status).toBe(
      'in-flight',
    );
  });

  it('does not turn unknown provider evidence into absence or convergence', () => {
    const resources = makeConvergedResources();
    resources[0] = {
      ...resources[0],
      presence: 'unknown',
      presenceEvidence: 'access-failure',
      ownership: 'unknown',
      bindingId: null,
      dependencyBindings: null,
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
      if (resource.onDestroy === 'retain') return resource;
      return {
        ...resource,
        presence: 'absent',
        presenceEvidence: 'authoritative-not-found',
        bindingId: null,
        dependencyBindings: null,
        ownership: 'missing',
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
      ({ resourceKey }) => resourceKey === 'application-state',
    );
    missingRetainedState[retainedIndex] = {
      ...missingRetainedState[retainedIndex],
      presence: 'absent',
      presenceEvidence: 'authoritative-not-found',
      bindingId: null,
      dependencyBindings: null,
      ownership: 'missing',
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
      ({ resourceKey }) => resourceKey === 'application-state',
    );
    unownedRetainedState[unownedIndex] = {
      ...unownedRetainedState[unownedIndex],
      ownership: 'missing',
      bindingId: null,
      dependencyBindings: null,
    };
    expect(() => makeInspection('destroyed', unownedRetainedState)).toThrow(
      /retained capability.*exact ownership evidence/i,
    );
  });

  it('rejects duplicate, missing, and swapped volume role projections', () => {
    const missing = makeConvergedResources();
    delete requireResource(missing, 'application-state').role;
    expect(() => makeInspection('converged', missing)).toThrow(
      /role is required/i,
    );

    const duplicate = makeConvergedResources();
    requireResource(duplicate, 'control-state').capability = clone(
      requireResource(duplicate, 'application-state').capability,
    );
    expect(() => makeInspection('converged', duplicate)).toThrow(
      /exact AWS single-node resource graph role/i,
    );

    const swapped = makeConvergedResources();
    const applicationVolume = requireResource(swapped, 'application-state');
    const controlVolume = requireResource(swapped, 'control-state');
    [applicationVolume.capability, controlVolume.capability] = [
      controlVolume.capability,
      applicationVolume.capability,
    ];
    expect(() => makeInspection('converged', swapped)).toThrow(
      /exact AWS single-node resource graph role/i,
    );
  });

  it('rejects wrong head binding lineage, attachment retention, and service on a non-substrate role', () => {
    const wrongLineage = makeConvergedResources();
    requireResource(wrongLineage, 'application-state').bindingId =
      requireResource(wrongLineage, 'control-state').bindingId;
    expect(() => makeInspection('converged', wrongLineage)).toThrow(
      /binding evidence does not match the exact head/i,
    );

    const retainedAttachment = makeConvergedResources();
    requireResource(
      retainedAttachment,
      'application-state-attachment',
    ).onDestroy = 'retain';
    expect(() => makeInspection('converged', retainedAttachment)).toThrow(
      /exact AWS single-node resource graph role/i,
    );

    const misplacedService = makeConvergedResources();
    requireResource(misplacedService, 'network-vpc').service = clone(
      requireResource(misplacedService, 'substrate').service,
    );
    expect(() => makeInspection('converged', misplacedService)).toThrow(
      /service is supported only for the substrate node/i,
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
    const authority = makeReadyAuthority();
    const binding = authority.bindingByResourceKey.get('substrate');
    const attachment = authority.bindingByResourceKey.get(
      'application-state-attachment',
    );
    if (binding === undefined || attachment === undefined) {
      throw new Error('Fixture requires node and attachment bindings.');
    }

    expect(binding).toMatchObject({
      schemaVersion: 2,
      bindingId: expect.stringMatching(/^wrb2_[A-Za-z0-9_-]{43}$/),
      role: { kind: 'node', version: 1 },
      ownershipMode: 'direct',
      onDestroy: 'purge',
    });
    expect(binding.ownershipNonce).toBe(
      Buffer.alloc(32, 14).toString('base64url'),
    );
    expect(
      binding.dependencyBindings.map(
        (/** @type {Readonly<Record<string, any>>} */ dependency) =>
          dependency.resourceKey,
      ),
    ).toEqual(
      [
        ...requireResource(makeConvergedResources(), 'substrate').dependsOn,
      ].sort(),
    );
    expect(attachment).toMatchObject({
      role: { kind: 'attachment', version: 1 },
      ownershipMode: 'derived',
      onDestroy: 'purge',
      dependencyBindings: [
        {
          resourceKey: 'application-state',
          bindingId: expect.stringMatching(/^wrb2_/),
        },
        {
          resourceKey: 'substrate',
          bindingId: expect.stringMatching(/^wrb2_/),
        },
      ],
    });
    expect(validateDeploymentResourceBinding(clone(binding))).toEqual(binding);
    expect(Object.isFrozen(binding)).toBe(true);
  });

  it('supports read-only external references without manufacturing ownership', () => {
    const plan = makePlan();
    const binding = createDeploymentResourceBinding({
      schemaVersion: 2,
      kind: 'deploymentResourceBinding',
      deploymentInstanceId: plan.deploymentInstanceId,
      incarnationId: plan.incarnationId,
      resourceKey: 'network-vpc',
      capability: { kind: 'networking', version: 1 },
      role: { kind: 'vpc', version: 1 },
      management: 'external',
      ownershipMode: 'external',
      onDestroy: 'purge',
      dependencyBindings: [],
      providerType: 'ec2-vpc',
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
    const networkAction = plan.actions.find(
      (/** @type {Readonly<Record<string, any>>} */ action) =>
        action.resourceKey === 'network-vpc',
    );
    if (networkAction === undefined) {
      throw new Error('Fixture requires network VPC action.');
    }
    const externalClaim = {
      schemaVersion: 2,
      kind: 'deploymentResourceBinding',
      deploymentInstanceId: plan.deploymentInstanceId,
      incarnationId: plan.incarnationId,
      resourceKey: 'network-vpc',
      capability: { kind: 'networking', version: 1 },
      role: { kind: 'vpc', version: 1 },
      management: 'external',
      ownershipMode: 'external',
      onDestroy: 'purge',
      dependencyBindings: [],
      providerType: 'ec2-vpc',
      providerResourceId: 'vpc-0123456789abcdef0',
      providerScopeId: plan.providerScope.providerScopeId,
      ownershipNonce: createOwnershipNonce(Buffer.alloc(32, 3)),
      createdByActionId: networkAction.actionId,
    };
    expect(() => createDeploymentResourceBinding(externalClaim)).toThrow(
      /ownershipNonce is not supported for external/i,
    );

    const managed = {
      ...externalClaim,
      management: 'managed',
      ownershipMode: 'direct',
    };
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
      schemaVersion: 2,
      kind: 'deploymentResourceBinding',
      deploymentInstanceId: plan.deploymentInstanceId,
      incarnationId: plan.incarnationId,
      resourceKey: 'artifact',
      capability: { kind: 'artifact-storage', version: 1 },
      role: { kind: 'object', version: 1 },
      management: 'external',
      ownershipMode: 'external',
      onDestroy: 'purge',
      dependencyBindings: [],
      providerType: 's3-object',
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
