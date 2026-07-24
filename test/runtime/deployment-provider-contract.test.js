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
const RUNTIME_ROLE_ID = 'AROA1234567890EXAMPLE';

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
      rootDeviceName: '/dev/xvda',
      rootBlockDevice: {
        snapshotId: 'snap-0123456789abcdef0',
        volumeType: 'gp3',
        volumeSizeGiB: 8,
        encrypted: false,
        deleteOnTermination: true,
      },
    },
    placement: { availabilityZoneId: 'use1-az1' },
    storage: {
      ebsKmsKeyArn:
        'arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555',
    },
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
  if (resourceKey === 'runtime-role') return RUNTIME_ROLE_ID;
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
        inspectionId: semanticId('win6', 'wharfie:test:inspection:v6', {
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
  const runtimeRoleBinding = authority.bindingByResourceKey.get('runtime-role');
  if (nodeBinding === undefined || authority.head.lastOperation === null) {
    throw new Error('Fixture requires node and completed operation authority.');
  }
  if (runtimeRoleBinding === undefined) {
    throw new Error('Fixture requires runtime role authority.');
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
    runtimeRoleBindingId: runtimeRoleBinding.bindingId,
    runtimeRoleId: runtimeRoleBinding.providerResourceId,
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
        execution: 'none',
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
      head: absent ? null : authority.head,
      plan: null,
      now: HEALTH_NOW,
    },
  );
}

/**
 * @param {number} [actionIndex]
 * @param {'pending'|'intended'} [currentStatus]
 * @param {string|null|undefined} [currentOwnershipNonce]
 * @returns {Readonly<Record<string, any>>}
 */
function makeActiveInspectionAuthority(
  actionIndex = 1,
  currentStatus = 'intended',
  currentOwnershipNonce = undefined,
) {
  const base = makeBase();
  const plan = makePlan('apply', base);
  const bindingByResourceKey = makeBindings(base, plan);
  const currentAction = plan.actions[actionIndex];
  const currentBinding = bindingByResourceKey.get(currentAction.resourceKey);
  if (currentBinding === undefined) {
    throw new Error(`Missing current binding '${currentAction.resourceKey}'.`);
  }
  const resourceBindings = plan.actions
    .slice(0, actionIndex)
    .map((/** @type {Readonly<Record<string, any>>} */ action) =>
      bindingByResourceKey.get(action.resourceKey),
    );
  if (
    resourceBindings.some(
      (/** @type {Readonly<Record<string, any>>|undefined} */ binding) =>
        binding === undefined,
    )
  ) {
    throw new Error('Active fixture is missing a settled resource binding.');
  }
  const intents = plan.actions.map(
    (
      /** @type {Readonly<Record<string, any>>} */ action,
      /** @type {number} */ index,
    ) => {
      const binding = bindingByResourceKey.get(action.resourceKey);
      if (binding === undefined) {
        throw new Error(`Missing intent binding '${action.resourceKey}'.`);
      }
      return {
        actionId: action.actionId,
        status:
          index < actionIndex
            ? 'settled'
            : index === actionIndex
              ? currentStatus
              : 'pending',
        ownershipNonce:
          index === actionIndex && currentOwnershipNonce !== undefined
            ? currentOwnershipNonce
            : binding.ownershipNonce,
      };
    },
  );
  const head = createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: 1,
    phase: 'CONVERGING',
    settledDeploymentRevisionId: null,
    targetDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    resourceBindings,
    activeOperation: {
      kind: 'create',
      planId: plan.planId,
      status: 'running',
      nextActionIndex: actionIndex,
      intents,
    },
    lastOperation: null,
  });
  const resources = plan.actions.map(
    (/** @type {Readonly<Record<string, any>>} */ action) => ({
      resourceKey: action.resourceKey,
      capability: action.capability,
      role: action.role,
      management: action.management,
      ownershipMode: action.ownershipMode,
      dependsOn: action.dependsOn,
      onDestroy: action.onDestroy,
      bindingId: null,
      dependencyBindings: null,
      presence: 'unknown',
      presenceEvidence: 'access-failure',
      ownership: 'unknown',
      providerIdentity: null,
      desiredDigest: action.after?.stateDigest ?? null,
      observedDigest: null,
      health: 'unknown',
      service: null,
      execution: 'none',
    }),
  );
  return Object.freeze({
    ...base,
    plan,
    head,
    resources,
    currentAction,
    pendingBinding: currentBinding,
  });
}

/**
 * @param {ReturnType<typeof makeActiveInspectionAuthority>} authority
 * @param {string[]} [replayResourceKeys]
 * @param {{status?: string, plan?: unknown, pendingBinding?: unknown}} [options]
 */
function makeActiveInspection(
  authority,
  replayResourceKeys = [],
  options = {},
) {
  const resources = clone(authority.resources);
  for (const resourceKey of replayResourceKeys) {
    requireResource(resources, resourceKey).execution = 'replay-safe-create';
  }
  return createDeploymentInspection(
    {
      deploymentRevision: authority.deploymentRevision,
      providerScope: authority.providerScope,
      providerSpecId: authority.providerSpec.providerSpecId,
      deploymentInstanceId: authority.deploymentInstanceId,
      controlState: { status: 'present', evidence: 'provider-head-read' },
      incarnationId: authority.incarnationId,
      headGeneration: authority.head.generation,
      status: options.status ?? 'in-flight',
      resources,
    },
    {
      profile: authority.profile,
      providerSpec: authority.providerSpec,
      head: authority.head,
      plan: Object.prototype.hasOwnProperty.call(options, 'plan')
        ? options.plan
        : authority.plan,
      ...(Object.prototype.hasOwnProperty.call(options, 'pendingBinding')
        ? { pendingBinding: options.pendingBinding }
        : {}),
    },
  );
}

/** @param {Readonly<Record<string, any>>} value @returns {Record<string, any>} */
function reidentifyInspection(value) {
  const payload = /** @type {Record<string, any>} */ (clone(value));
  delete payload.inspectionId;
  return {
    ...payload,
    inspectionId: semanticId(
      'win6',
      'wharfie:deployment-inspection:v6',
      payload,
    ),
  };
}

/**
 * @param {'absent'|'unknown'|'conflict'|'unbound'|'bound'} evidence
 * @param {string} [status]
 * @returns {Record<string, any>}
 */
function makeExternalInspectionEvidence(evidence, status = 'drifted') {
  const inspection = /** @type {Record<string, any>} */ (
    clone(makeInspection('converged'))
  );
  const resource = requireResource(inspection.resources, 'artifact');
  resource.management = 'external';
  resource.execution = 'none';
  if (evidence === 'bound') {
    resource.ownership = 'external';
    return reidentifyInspection(inspection);
  }
  resource.bindingId = null;
  resource.dependencyBindings = null;
  resource.service = null;
  if (evidence === 'absent') {
    resource.presence = 'absent';
    resource.presenceEvidence = 'authoritative-not-found';
    resource.ownership = 'missing';
    resource.providerIdentity = null;
    resource.observedDigest = null;
    resource.health = 'absent';
  } else if (evidence === 'unknown') {
    resource.presence = 'unknown';
    resource.presenceEvidence = 'access-failure';
    resource.ownership = 'unknown';
    resource.providerIdentity = null;
    resource.observedDigest = null;
    resource.health = 'unknown';
  } else if (evidence === 'conflict') {
    resource.ownership = 'conflict';
    resource.observedDigest = null;
  } else {
    resource.ownership = 'external';
  }
  inspection.status =
    evidence === 'unknown'
      ? 'unknown'
      : evidence === 'conflict'
        ? 'conflict'
        : status;
  return reidentifyInspection(inspection);
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
      schemaVersion: 6,
      providerSpecId: expect.stringMatching(/^wap6_[A-Za-z0-9_-]{43}$/),
      resourceGraphId: AWS_SINGLE_NODE_RESOURCE_GRAPH.resourceGraphId,
    });
    expect(first.actions).toHaveLength(18);
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
      create: 18,
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
    expect(first.schemaVersion).toBe(6);
    expect(first.inspectionId).toMatch(/^win6_[A-Za-z0-9_-]{43}$/);
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
        plan: null,
        now: HEALTH_NOW,
      }),
    ).toEqual(first);
    expect(() =>
      validateDeploymentInspectionContext(clone(first), {
        profile: authority.profile,
        providerSpec: authority.providerSpec,
        head: null,
        plan: null,
        now: HEALTH_NOW,
      }),
    ).toThrow(/exact non-null head for present control state/i);
    expect(() =>
      validateDeploymentInspectionContext(clone(first), {
        profile: authority.profile,
        providerSpec: authority.providerSpec,
        plan: null,
        now: HEALTH_NOW,
      }),
    ).toThrow(/context\.head is required/i);
    expect(() =>
      createDeploymentInspection(
        {
          deploymentRevision: first.deploymentRevision,
          providerScope: first.providerScope,
          providerSpecId: first.providerSpecId,
          deploymentInstanceId: first.deploymentInstanceId,
          controlState: first.controlState,
          incarnationId: first.incarnationId,
          headGeneration: first.headGeneration,
          status: first.status,
          resources: first.resources,
        },
        {
          profile: authority.profile,
          providerSpec: authority.providerSpec,
          plan: null,
          now: HEALTH_NOW,
        },
      ),
    ).toThrow(/context\.head is required/i);
    expect(() =>
      validateDeploymentInspectionContext(clone(first), {
        profile: authority.profile,
        providerSpec: authority.providerSpec,
        head: authority.head,
        plan: null,
        now: HEALTH_NOW + 65_001,
      }),
    ).toThrow(/stale/i);
    expect(() =>
      validateDeploymentInspectionContext(clone(first), {
        profile: authority.profile,
        providerSpec: authority.providerSpec,
        head: authority.head,
        plan: null,
        now: HEALTH_NOW - 5_001,
      }),
    ).toThrow(/conflict/i);
    expect(() =>
      validateDeploymentInspectionContext(clone(first), {
        profile: authority.profile,
        providerSpec: authority.providerSpec,
        head: authority.head,
        plan: null,
      }),
    ).toThrow(/freshness context\.now/i);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('content-addresses one structurally safe replay-create advice against the exact current PlanV3 action', () => {
    const authority = makeActiveInspectionAuthority();
    const inspection = makeActiveInspection(authority, ['application-state']);

    expect(inspection).toMatchObject({
      schemaVersion: 6,
      status: 'in-flight',
      inspectionId: expect.stringMatching(/^win6_[A-Za-z0-9_-]{43}$/),
    });
    expect(
      requireResource(inspection.resources, 'application-state').execution,
    ).toBe('replay-safe-create');
    expect(validateDeploymentInspection(clone(inspection))).toEqual(inspection);
    expect(
      validateDeploymentInspectionContext(clone(inspection), {
        profile: authority.profile,
        providerSpec: authority.providerSpec,
        head: authority.head,
        plan: authority.plan,
      }),
    ).toEqual(inspection);

    const changedExecution = clone(inspection);
    requireResource(changedExecution.resources, 'application-state').execution =
      'none';
    expect(() => validateDeploymentInspection(changedExecution)).toThrow(
      /inspectionId does not match/i,
    );
  });

  it('rejects legacy V5 documents and an otherwise well-formed tampered V6 identity', () => {
    const legacy = /** @type {Record<string, any>} */ (
      clone(makeInspection('converged'))
    );
    legacy.schemaVersion = 5;
    legacy.inspectionId = semanticId(
      'win5',
      'wharfie:deployment-inspection:v5',
      { legacy: true },
    );
    expect(() => validateDeploymentInspection(legacy)).toThrow(
      /schemaVersion must be the integer 6/i,
    );

    const tamperedIdentity = /** @type {Record<string, any>} */ (
      clone(makeInspection('converged'))
    );
    tamperedIdentity.inspectionId = semanticId(
      'win6',
      'wharfie:test:tampered-inspection:v6',
      { tampered: true },
    );
    expect(() => validateDeploymentInspection(tamperedIdentity)).toThrow(
      /inspectionId does not match/i,
    );
  });

  it('losslessly represents external absence, access failure, identity conflict, and transient unbound identity', () => {
    const absent = validateDeploymentInspection(
      makeExternalInspectionEvidence('absent'),
    );
    expect(requireResource(absent.resources, 'artifact')).toMatchObject({
      management: 'external',
      presence: 'absent',
      ownership: 'missing',
      bindingId: null,
      dependencyBindings: null,
    });

    const unknown = validateDeploymentInspection(
      makeExternalInspectionEvidence('unknown'),
    );
    expect(requireResource(unknown.resources, 'artifact')).toMatchObject({
      management: 'external',
      presence: 'unknown',
      ownership: 'unknown',
      providerIdentity: null,
    });

    const conflict = validateDeploymentInspection(
      makeExternalInspectionEvidence('conflict'),
    );
    expect(requireResource(conflict.resources, 'artifact')).toMatchObject({
      management: 'external',
      presence: 'present',
      ownership: 'conflict',
      bindingId: null,
      dependencyBindings: null,
    });

    const unbound = validateDeploymentInspection(
      makeExternalInspectionEvidence('unbound'),
    );
    expect(unbound.status).toBe('drifted');
    expect(requireResource(unbound.resources, 'artifact')).toMatchObject({
      management: 'external',
      presence: 'present',
      ownership: 'external',
      bindingId: null,
      dependencyBindings: null,
      providerIdentity: expect.any(Object),
      observedDigest: expect.any(Object),
    });

    expect(
      validateDeploymentInspection(makeExternalInspectionEvidence('bound'))
        .status,
    ).toBe('converged');

    const serviceConflict = /** @type {Record<string, any>} */ (
      clone(makeInspection('converged'))
    );
    const substrate = requireResource(serviceConflict.resources, 'substrate');
    substrate.management = 'external';
    substrate.ownership = 'conflict';
    substrate.bindingId = null;
    substrate.dependencyBindings = null;
    substrate.observedDigest = null;
    substrate.health = 'unknown';
    substrate.service = null;
    serviceConflict.status = 'conflict';
    expect(
      requireResource(
        validateDeploymentInspection(reidentifyInspection(serviceConflict))
          .resources,
        'substrate',
      ),
    ).toMatchObject({
      management: 'external',
      ownership: 'conflict',
      health: 'unknown',
      service: null,
    });
  });

  it('rejects contradictory external ownership, partial lineage, and unbound final evidence', () => {
    const wrongAbsent = makeExternalInspectionEvidence('absent');
    requireResource(wrongAbsent.resources, 'artifact').ownership = 'external';
    expect(() =>
      validateDeploymentInspection(reidentifyInspection(wrongAbsent)),
    ).toThrow(/absent resources must report missing ownership/i);

    const wrongUnknown = makeExternalInspectionEvidence('unknown');
    requireResource(wrongUnknown.resources, 'artifact').ownership = 'external';
    expect(() =>
      validateDeploymentInspection(reidentifyInspection(wrongUnknown)),
    ).toThrow(/unknown resources must report unknown ownership/i);

    const wrongPresent = makeExternalInspectionEvidence('unbound');
    requireResource(wrongPresent.resources, 'artifact').ownership = 'verified';
    expect(() =>
      validateDeploymentInspection(reidentifyInspection(wrongPresent)),
    ).toThrow(/present external resources must report external or conflict/i);

    const partialLineage = makeExternalInspectionEvidence('unbound');
    requireResource(partialLineage.resources, 'artifact').bindingId =
      requireResource(makeConvergedResources(), 'artifact').bindingId;
    expect(() =>
      validateDeploymentInspection(reidentifyInspection(partialLineage)),
    ).toThrow(/complete binding lineage|null lineage/i);

    expect(() =>
      validateDeploymentInspection(
        makeExternalInspectionEvidence('unbound', 'converged'),
      ),
    ).toThrow(/converged status requires exact present, owned, healthy/i);
    expect(() =>
      validateDeploymentInspection(
        makeExternalInspectionEvidence('unbound', 'destroyed'),
      ),
    ).toThrow(/destroyed status cannot rely on unbound external/i);
  });

  it('context-rejects unbound external identity that omits durable authority or is outside a non-final planning/verify phase', () => {
    const authority = makeInspectionAuthority();
    const inFlight = makeExternalInspectionEvidence('unbound', 'in-flight');
    expect(validateDeploymentInspection(inFlight).status).toBe('in-flight');
    expect(() =>
      validateDeploymentInspectionContext(inFlight, {
        profile: authority.profile,
        providerSpec: authority.providerSpec,
        head: authority.head,
        plan: null,
        now: HEALTH_NOW,
      }),
    ).toThrow(
      /exact head with no durable or pending binding|non-final READY-head planning evidence/i,
    );

    const noHead = makeExternalInspectionEvidence('unbound');
    expect(() =>
      validateDeploymentInspectionContext(noHead, {
        profile: authority.profile,
        providerSpec: authority.providerSpec,
        plan: null,
        now: HEALTH_NOW,
      }),
    ).toThrow(/context\.head is required/i);
  });

  it('rejects two replay advices and advice that is not for the exact current action', () => {
    const authority = makeActiveInspectionAuthority();

    expect(() =>
      makeActiveInspection(authority, ['application-state', 'control-state']),
    ).toThrow(/at most one resource/i);
    expect(() => makeActiveInspection(authority, ['control-state'])).toThrow(
      /exact current intended managed direct create action/i,
    );
  });

  it('requires in-flight inspection status and an intended action with a nonnull ownership nonce', () => {
    const authority = makeActiveInspectionAuthority();
    expect(() =>
      makeActiveInspection(authority, ['application-state'], {
        status: 'unknown',
      }),
    ).toThrow(/requires in-flight status/i);

    const pending = makeActiveInspectionAuthority(1, 'pending');
    expect(() => makeActiveInspection(pending, ['application-state'])).toThrow(
      /exact current intended managed direct create action/i,
    );

    const missingNonce = makeActiveInspectionAuthority(1, 'intended', null);
    expect(() =>
      makeActiveInspection(missingNonce, ['application-state']),
    ).toThrow(/ownership nonce|exact current intended/i);
  });

  it('requires the exact nullable active plan and forbids replay advice once a pending binding exists', () => {
    const authority = makeActiveInspectionAuthority();

    expect(() =>
      makeActiveInspection(authority, ['application-state'], { plan: null }),
    ).toThrow(/context\.plan.*exact active plan iff/i);
    expect(
      makeActiveInspection(authority, [], {
        pendingBinding: authority.pendingBinding,
      }).status,
    ).toBe('in-flight');
    expect(() =>
      makeActiveInspection(authority, ['application-state'], {
        pendingBinding: authority.pendingBinding,
      }),
    ).toThrow(/forbidden after an exact pending binding/i);
  });

  it('validates pending binding metadata and provider identity against the exact current create/verify action', () => {
    const authority = makeActiveInspectionAuthority();
    const wrongProviderBinding = clone(authority.pendingBinding);
    delete wrongProviderBinding.bindingId;
    wrongProviderBinding.providerType = 'wrong-provider-type';
    const canonicalWrongBinding =
      createDeploymentResourceBinding(wrongProviderBinding);

    expect(() =>
      makeActiveInspection(authority, [], {
        pendingBinding: canonicalWrongBinding,
      }),
    ).toThrow(/current create\/verify action metadata, provider identity/i);
  });

  it('represents confirmed nonexistence without manufacturing an incarnation', () => {
    const inspection = makeInspection('absent');
    const authority = makeInspectionAuthority();

    expect(inspection).toMatchObject({
      headGeneration: 0,
      incarnationId: null,
      resources: [],
      status: 'absent',
    });
    expect(
      validateDeploymentInspectionContext(clone(inspection), {
        profile: authority.profile,
        providerSpec: authority.providerSpec,
        head: null,
        plan: null,
      }),
    ).toEqual(inspection);
    expect(() =>
      validateDeploymentInspectionContext(clone(inspection), {
        profile: authority.profile,
        providerSpec: authority.providerSpec,
        head: undefined,
        plan: null,
      }),
    ).toThrow(/null only for authoritative absence/i);
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
      { profile, providerSpec, head: undefined, plan: null },
    );

    expect(inspection).toMatchObject({
      controlState: { status: 'unknown', evidence: 'access-failure' },
      headGeneration: 0,
      incarnationId: null,
      status: 'unknown',
    });
    expect(
      validateDeploymentInspectionContext(clone(inspection), {
        profile,
        providerSpec,
        head: undefined,
        plan: null,
      }),
    ).toEqual(inspection);
    expect(() =>
      validateDeploymentInspectionContext(clone(inspection), {
        profile,
        providerSpec,
        head: null,
        plan: null,
      }),
    ).toThrow(/explicit undefined for unknown or conflicting/i);

    const conflict = createDeploymentInspection(
      {
        deploymentRevision,
        providerScope,
        providerSpecId: providerSpec.providerSpecId,
        deploymentInstanceId: getDeploymentInstanceId({
          deploymentRevision,
          providerScope,
        }),
        controlState: { status: 'conflict', evidence: 'identity-conflict' },
        incarnationId: null,
        headGeneration: 0,
        status: 'conflict',
        resources: [],
      },
      { profile, providerSpec, head: undefined, plan: null },
    );
    expect(conflict.controlState.status).toBe('conflict');
    expect(() =>
      validateDeploymentInspectionContext(clone(conflict), {
        profile,
        providerSpec,
        head: null,
        plan: null,
      }),
    ).toThrow(/explicit undefined for unknown or conflicting/i);
    expect(() =>
      createDeploymentInspection(
        {
          ...clone(inspection),
          controlState: {
            status: 'absent',
            evidence: 'authoritative-not-found',
          },
        },
        { profile, providerSpec, head: undefined, plan: null },
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

  it('correlates provider health to the independently inspected runtime role resource', () => {
    const wrongRoleId = makeConvergedResources();
    requireResource(
      wrongRoleId,
      'runtime-role',
    ).providerIdentity.providerResourceId = 'AROA0987654321EXAMPLE';
    expect(() => makeInspection('converged', wrongRoleId)).toThrow(
      /runtimeRoleId.*exact inspection authority|exact inspection authority|binding evidence does not match/i,
    );

    const wrongRoleBinding = makeConvergedResources();
    const substrateBindingId = requireResource(
      wrongRoleBinding,
      'substrate',
    ).bindingId;
    requireResource(wrongRoleBinding, 'runtime-role').bindingId =
      substrateBindingId;
    expect(() => makeInspection('converged', wrongRoleBinding)).toThrow(
      /runtimeRoleBindingId.*exact inspection authority|exact inspection authority|binding evidence does not match/i,
    );

    const wrongNodeBinding = makeConvergedResources();
    const roleBindingId = requireResource(
      wrongNodeBinding,
      'runtime-role',
    ).bindingId;
    requireResource(wrongNodeBinding, 'substrate').bindingId = roleBindingId;
    expect(() => makeInspection('converged', wrongNodeBinding)).toThrow(
      /nodeBindingId.*exact inspection authority|exact inspection authority|binding evidence does not match/i,
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
      Buffer.alloc(
        32,
        getAwsSingleNodeResourceApplyOrder().indexOf('substrate') + 2,
      ).toString('base64url'),
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
