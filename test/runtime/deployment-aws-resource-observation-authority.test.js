import { describe, expect, it } from '@jest/globals';

import { compareCanonicalStrings } from '../../src/core/runtime/canonical-order.js';
import {
  createCanonicalJsonSha256Id,
  createSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import { getAwsSingleNodeDefaultIpv4RouteProviderResourceId } from '../../src/core/runtime/deployment-aws-default-ipv4-route-resource.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from '../../src/core/runtime/deployment-aws-desired-resource-targets.js';
import { getAwsSingleNodeInternetGatewayAttachmentProviderResourceId } from '../../src/core/runtime/deployment-aws-internet-gateway-attachment-resource.js';
import {
  AWS_SINGLE_NODE_RESOURCE_OBSERVATION_AUTHORITY_UNSUPPORTED,
  AwsSingleNodeResourceObservationAuthorityUnsupportedError,
  createAwsSingleNodeResourceObservationAuthority,
} from '../../src/core/runtime/deployment-aws-resource-observation-authority.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import {
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimeAssociationProviderResourceId,
  getAwsSingleNodeRuntimePolicyProviderResourceId,
} from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
import { getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId } from '../../src/core/runtime/deployment-aws-subnet-route-table-association-resource.js';
import { getAwsSingleNodeVolumeAttachmentProviderResourceId } from '../../src/core/runtime/deployment-aws-volume-attachment-resource.js';
import { createDeploymentHead } from '../../src/core/runtime/deployment-head.js';
import { createDeploymentPlan } from '../../src/core/runtime/deployment-plan.js';
import {
  createAwsSingleNodeProvider,
  createDeploymentProfile,
} from '../../src/core/runtime/deployment-profile.js';
import {
  createAwsProviderScope,
  getDeploymentInstanceId,
} from '../../src/core/runtime/deployment-provider-scope.js';
import {
  createDeploymentIncarnationId,
  createDeploymentResourceBinding,
  createOwnershipNonce,
} from '../../src/core/runtime/deployment-resource-binding.js';
import {
  AWS_SINGLE_NODE_RESOURCE_GRAPH,
  getAwsSingleNodeResourceDestroyOrder,
} from '../../src/core/runtime/deployment-resource-graph.js';
import { validateDeploymentRevision } from '../../src/core/runtime/deployment-revision.js';

/** @typedef {Record<string, any>} AnyRecord */

const IDS = Object.freeze({
  applicationVolume: 'vol-00000000000000001',
  controlVolume: 'vol-00000000000000002',
  vpc: 'vpc-00000000000000001',
  internetGateway: 'igw-00000000000000001',
  subnet: 'subnet-00000000000000001',
  routeTable: 'rtb-00000000000000001',
  securityGroup: 'sg-00000000000000001',
  runtimeRole: 'AROA1234567890EXAMPLE',
  runtimeIdentity: 'AIPA1234567890EXAMPLE',
  substrate: 'i-00000000000000001',
});

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @param {string} prefix @param {string} domain @param {unknown} value @returns {string} */
function semanticId(prefix, domain, value) {
  return createCanonicalJsonSha256Id({ prefix, domain, value });
}

/** @param {number} byte @returns {string} */
function nonce(byte) {
  return createOwnershipNonce(Buffer.alloc(32, byte));
}

/** @param {string} label @returns {{algorithm: 'sha256', value: string}} */
function digest(label) {
  return { algorithm: 'sha256', value: sha256Base64Url(label) };
}

/** @param {unknown} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

/** @param {() => unknown} callback @returns {void} */
function expectUnsupported(callback) {
  /** @type {any} */
  let failure;
  try {
    callback();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(
    AwsSingleNodeResourceObservationAuthorityUnsupportedError,
  );
  expect(failure).toMatchObject({
    name: 'AwsSingleNodeResourceObservationAuthorityUnsupportedError',
    code: AWS_SINGLE_NODE_RESOURCE_OBSERVATION_AUTHORITY_UNSUPPORTED,
    message: 'AWS single-node resource observation authority is unsupported.',
  });
}

/** @param {string} appId @returns {Readonly<AnyRecord>} */
function makeProfile(appId) {
  return createDeploymentProfile({
    profile: { id: 'production' },
    appId,
    target: {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
    mode: { kind: 'single-node-systemd-user', version: 1 },
    provider: createAwsSingleNodeProvider('us-east-1'),
  });
}

/** @param {Readonly<AnyRecord>} profile @param {number} revision @returns {Readonly<AnyRecord>} */
function makeDeploymentRevision(profile, revision) {
  const payload = {
    schemaVersion: 1,
    kind: 'deploymentRevision',
    deployment: { id: 'production' },
    appId: profile.appId,
    revisionId: semanticId(
      'wrv1',
      'wharfie:test:resource-observation-authority-revision:v1',
      { appId: profile.appId, revision },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: `resource observation authority artifact ${profile.appId} ${revision}`,
    }),
    profileRevisionId: profile.profileRevisionId,
  };
  return validateDeploymentRevision({
    ...payload,
    deploymentRevisionId: semanticId(
      'wdr1',
      'wharfie:deployment-revision:v1',
      payload,
    ),
  });
}

/**
 * @param {Readonly<AnyRecord>} profile
 * @param {Readonly<AnyRecord>} providerScope
 * @param {number} variant
 * @returns {Readonly<AnyRecord>}
 */
function makeProviderSpec(profile, providerScope, variant) {
  const suffix = variant.toString(16);
  return createAwsSingleNodeProviderSpec({
    profile,
    providerScope,
    machineImage: {
      sourceParameter: {
        name: AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS.x86_64,
        version: 41 + variant,
      },
      imageId: `ami-0123456789abcde${suffix}`,
      ownerAccountId: '137112412989',
      architecture: 'x86_64',
      imageType: 'machine',
      rootDeviceType: 'ebs',
      virtualizationType: 'hvm',
      enaSupport: true,
      rootDeviceName: '/dev/xvda',
      rootBlockDevice: {
        snapshotId: `snap-0123456789abcde${suffix}`,
        volumeType: 'gp3',
        volumeSizeGiB: 8,
        encrypted: false,
        deleteOnTermination: true,
      },
    },
    placement: { availabilityZoneId: 'use1-az1' },
    storage: {
      ebsKmsKeyArn: `arn:aws:kms:us-east-1:${providerScope.accountId}:key/11111111-2222-3333-4444-555555555555`,
    },
  });
}

/**
 * @param {{revision?: number, appId?: string, accountId?: string, incarnationByte?: number, specVariant?: number}} [options]
 * @returns {Readonly<AnyRecord>}
 */
function makeBase(options = {}) {
  const revision = options.revision ?? 1;
  const appId = options.appId ?? 'resource-observation-authority-test';
  const accountId = options.accountId ?? '123456789012';
  const profile = makeProfile(appId);
  const deploymentRevision = makeDeploymentRevision(profile, revision);
  const providerScope = createAwsProviderScope({
    partition: 'aws',
    accountId,
    region: 'us-east-1',
  });
  const providerSpec = makeProviderSpec(
    profile,
    providerScope,
    options.specVariant ?? 1,
  );
  return Object.freeze({
    profile,
    deploymentRevision,
    providerScope,
    providerSpec,
    deploymentInstanceId: getDeploymentInstanceId({
      deploymentRevision,
      providerScope,
    }),
    incarnationId: createDeploymentIncarnationId(
      Buffer.alloc(32, options.incarnationByte ?? 77),
    ),
  });
}

/** @param {Readonly<AnyRecord>} base @returns {Readonly<AnyRecord>} */
function policyAuthority(base) {
  return Object.freeze({
    providerScope: base.providerScope,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
  });
}

/** @param {Readonly<AnyRecord>} base @param {string} resourceKey @returns {string} */
function providerResourceId(base, resourceKey) {
  switch (resourceKey) {
    case 'artifact':
      return getAwsSingleNodeManagedArtifactObjectLocation(
        policyAuthority(base),
      ).arn;
    case 'application-state':
      return IDS.applicationVolume;
    case 'control-state':
      return IDS.controlVolume;
    case 'network-vpc':
      return IDS.vpc;
    case 'network-internet-gateway':
      return IDS.internetGateway;
    case 'network-internet-gateway-attachment':
      return getAwsSingleNodeInternetGatewayAttachmentProviderResourceId(
        IDS.internetGateway,
        IDS.vpc,
      );
    case 'network-subnet':
      return IDS.subnet;
    case 'network-route-table':
      return IDS.routeTable;
    case 'network-default-ipv4-route':
      return getAwsSingleNodeDefaultIpv4RouteProviderResourceId(
        base.providerSpec.capabilities.networking.egressCidr,
        IDS.internetGateway,
        IDS.routeTable,
      );
    case 'network-subnet-route-table-association':
      return getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId(
        IDS.routeTable,
        IDS.subnet,
      );
    case 'network-security-group':
      return IDS.securityGroup;
    case 'runtime-role':
      return IDS.runtimeRole;
    case 'runtime-role-policy':
      return getAwsSingleNodeRuntimePolicyProviderResourceId({
        runtimeRoleId: IDS.runtimeRole,
      });
    case 'runtime-identity':
      return IDS.runtimeIdentity;
    case 'runtime-identity-role-association':
      return getAwsSingleNodeRuntimeAssociationProviderResourceId({
        runtimeRoleId: IDS.runtimeRole,
        instanceProfileId: IDS.runtimeIdentity,
      });
    case 'substrate':
      return IDS.substrate;
    case 'application-state-attachment':
      return getAwsSingleNodeVolumeAttachmentProviderResourceId(
        base.providerSpec,
        'application-state',
        IDS.substrate,
        IDS.applicationVolume,
      );
    case 'control-state-attachment':
      return getAwsSingleNodeVolumeAttachmentProviderResourceId(
        base.providerSpec,
        'control-state',
        IDS.substrate,
        IDS.controlVolume,
      );
    default:
      throw new Error(`Unsupported fixture resource '${resourceKey}'.`);
  }
}

/**
 * @param {Readonly<AnyRecord>} base
 * @param {{omit?: ReadonlySet<string>, plan?: Readonly<AnyRecord>, intents?: ReadonlyArray<Readonly<AnyRecord>>, createdByActionIds?: ReadonlyMap<string, string>, ownershipNonces?: ReadonlyMap<string, string>}} [options]
 * @returns {ReadonlyArray<Readonly<AnyRecord>>}
 */
function makeBindings(base, options = {}) {
  const omit = options.omit ?? new Set();
  const actionByKey = new Map(
    (options.plan?.actions ?? []).map(
      (/** @type {Readonly<AnyRecord>} */ action) => [
        action.resourceKey,
        action,
      ],
    ),
  );
  const intentByAction = new Map(
    (options.intents ?? []).map((intent) => [intent.actionId, intent]),
  );
  /** @type {Readonly<AnyRecord>[]} */
  const bindings = [];
  const bindingByKey = new Map();
  for (
    let index = 0;
    index < AWS_SINGLE_NODE_RESOURCE_GRAPH.resources.length;
    index += 1
  ) {
    const definition = AWS_SINGLE_NODE_RESOURCE_GRAPH.resources[index];
    if (omit.has(definition.resourceKey)) continue;
    const dependencyBindings = definition.dependsOn
      .map((/** @type {string} */ resourceKey) => {
        const dependency = bindingByKey.get(resourceKey);
        if (dependency === undefined) {
          throw new Error(`Missing fixture dependency '${resourceKey}'.`);
        }
        return { resourceKey, bindingId: dependency.bindingId };
      })
      .sort(
        (
          /** @type {{resourceKey: string}} */ left,
          /** @type {{resourceKey: string}} */ right,
        ) => compareCanonicalStrings(left.resourceKey, right.resourceKey),
      );
    const action = actionByKey.get(definition.resourceKey);
    const createdByActionId =
      options.createdByActionIds?.get(definition.resourceKey) ??
      action?.actionId ??
      semanticId(
        'wda3',
        'wharfie:test:resource-observation-authority-binding-action:v1',
        { resourceKey: definition.resourceKey },
      );
    const binding = createDeploymentResourceBinding({
      schemaVersion: 2,
      kind: 'deploymentResourceBinding',
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
      resourceKey: definition.resourceKey,
      capability: definition.capability,
      role: definition.role,
      management: 'managed',
      ownershipMode: definition.ownershipMode,
      onDestroy: definition.onDestroy,
      dependencyBindings,
      providerType: definition.providerType,
      providerResourceId: providerResourceId(base, definition.resourceKey),
      providerScopeId: base.providerScope.providerScopeId,
      ownershipNonce:
        options.ownershipNonces?.get(definition.resourceKey) ??
        intentByAction.get(createdByActionId)?.ownershipNonce ??
        nonce(index + 1),
      createdByActionId,
    });
    bindingByKey.set(definition.resourceKey, binding);
    bindings.push(binding);
  }
  return bindings;
}

/** @param {Readonly<AnyRecord>} plan @returns {'create'|'update'|'reconcile'|'destroy'} */
function operationKindForPlan(plan) {
  if (plan.operation === 'destroy') return 'destroy';
  if (plan.basis.settledDeploymentRevisionId === null) return 'create';
  return plan.basis.settledDeploymentRevisionId ===
    plan.deploymentRevision.deploymentRevisionId
    ? 'reconcile'
    : 'update';
}

/**
 * @param {Readonly<AnyRecord>} plan
 * @param {ReadonlyArray<Readonly<AnyRecord>>} intents
 * @param {{kind?: 'create'|'update'|'reconcile'|'destroy', planId?: string, actionIds?: ReadonlyArray<string>, intentCount?: number}} [options]
 * @returns {Readonly<AnyRecord>}
 */
function settledOperation(plan, intents, options = {}) {
  const actionIds =
    options.actionIds ??
    plan.actions.map(
      (/** @type {Readonly<AnyRecord>} */ action) => action.actionId,
    );
  const intentCount = options.intentCount ?? actionIds.length;
  return {
    kind: options.kind ?? operationKindForPlan(plan),
    planId: options.planId ?? plan.planId,
    intents: actionIds
      .slice(0, intentCount)
      .map((/** @type {string} */ actionId, /** @type {number} */ index) => ({
        actionId,
        status: 'settled',
        ownershipNonce: intents[index]?.ownershipNonce ?? nonce(200 + index),
      })),
  };
}

/**
 * @param {Readonly<AnyRecord>} base
 * @param {Readonly<AnyRecord>} plan
 * @param {ReadonlyArray<Readonly<AnyRecord>>} bindings
 * @param {ReadonlyArray<Readonly<AnyRecord>>} intents
 * @param {{deploymentRevisionId?: string, generation?: number, operationKind?: 'create'|'update'|'reconcile'|'destroy', planId?: string, actionIds?: ReadonlyArray<string>, intentCount?: number}} [options]
 * @returns {Readonly<AnyRecord>}
 */
function makeReadyHead(base, plan, bindings, intents, options = {}) {
  const deploymentRevisionId =
    options.deploymentRevisionId ??
    base.deploymentRevision.deploymentRevisionId;
  return createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation:
      options.generation ??
      plan.basis.headGeneration + plan.actions.length * 2 + 2,
    phase: 'READY',
    settledDeploymentRevisionId: deploymentRevisionId,
    targetDeploymentRevisionId: deploymentRevisionId,
    resourceBindings: bindings,
    activeOperation: null,
    lastOperation: settledOperation(plan, intents, {
      kind: options.operationKind,
      planId: options.planId,
      actionIds: options.actionIds,
      intentCount: options.intentCount,
    }),
  });
}

/**
 * Build the minimum controller-reachable READY result of settling and
 * finalizing one complete create plan.
 * @param {Readonly<AnyRecord>} base
 * @param {{plan?: Readonly<AnyRecord>, intents?: ReadonlyArray<Readonly<AnyRecord>>, bindings?: ReadonlyArray<Readonly<AnyRecord>>, head?: {deploymentRevisionId?: string, generation?: number, operationKind?: 'create'|'update'|'reconcile'|'destroy', planId?: string, actionIds?: ReadonlyArray<string>, intentCount?: number}}} [options]
 * @returns {{plan: Readonly<AnyRecord>, intents: ReadonlyArray<Readonly<AnyRecord>>, bindings: ReadonlyArray<Readonly<AnyRecord>>, head: Readonly<AnyRecord>}}
 */
function makeReadyState(base, options = {}) {
  const plan = options.plan ?? makeCreatePlan(base);
  const intents =
    options.intents ??
    makePlanIntents(plan).map((intent) => ({
      ...intent,
      status: 'settled',
    }));
  const bindings = options.bindings ?? makeBindings(base, { plan, intents });
  return {
    plan,
    intents,
    bindings,
    head: makeReadyHead(base, plan, bindings, intents, options.head),
  };
}

/** @param {Readonly<AnyRecord>} base @returns {Readonly<AnyRecord>} */
function makeDestroyedHead(base) {
  return createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: 9,
    phase: 'DESTROYED',
    settledDeploymentRevisionId: null,
    targetDeploymentRevisionId: null,
    resourceBindings: [],
    activeOperation: null,
    lastOperation: {
      kind: 'destroy',
      planId: semanticId(
        'wpl3',
        'wharfie:test:resource-observation-authority-destroy-plan:v1',
        { incarnationId: base.incarnationId },
      ),
      intents: [
        {
          actionId: semanticId(
            'wda3',
            'wharfie:test:resource-observation-authority-destroy-action:v1',
            { incarnationId: base.incarnationId },
          ),
          status: 'settled',
          ownershipNonce: nonce(250),
        },
      ],
    },
  });
}

/** @param {Readonly<AnyRecord>} base @param {Readonly<AnyRecord>|null} head @returns {ReadonlyArray<Readonly<AnyRecord>>} */
function makeTargets(base, head) {
  return createAwsSingleNodeDesiredResourceTargetCatalog({
    deploymentRevision: base.deploymentRevision,
    profile: base.profile,
    providerScope: base.providerScope,
    providerSpec: base.providerSpec,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    head,
  });
}

/** @param {ReadonlyArray<Readonly<AnyRecord>>} targets @param {string} resourceKey @returns {Readonly<AnyRecord>} */
function targetFor(targets, resourceKey) {
  const target = targets.find((entry) => entry.resourceKey === resourceKey);
  if (target === undefined) {
    throw new Error(`Missing fixture target '${resourceKey}'.`);
  }
  return target;
}

/**
 * @param {Readonly<AnyRecord>} base
 * @param {{operation?: 'apply'|'reconcile', headGeneration?: number, settledDeploymentRevisionId?: string|null}} [options]
 * @returns {Readonly<AnyRecord>}
 */
function makeCreatePlan(base, options = {}) {
  const operation = options.operation ?? 'apply';
  const targets = makeTargets(base, null);
  return createDeploymentPlan(
    {
      operation,
      deploymentRevision: base.deploymentRevision,
      providerScope: base.providerScope,
      providerSpec: base.providerSpec,
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
      basis: {
        headGeneration: options.headGeneration ?? 0,
        settledDeploymentRevisionId:
          options.settledDeploymentRevisionId ?? null,
        inspectionId: semanticId(
          'win5',
          'wharfie:test:resource-observation-authority-inspection:v1',
          {
            operation,
            revision: base.deploymentRevision.deploymentRevisionId,
            headGeneration: options.headGeneration ?? 0,
          },
        ),
      },
      actions: targets.map((target) => ({
        resourceKey: target.resourceKey,
        capability: target.capability,
        role: target.role,
        management: target.management,
        ownershipMode: target.ownershipMode,
        dependsOn: target.dependsOn,
        onDestroy: target.onDestroy,
        action: 'create',
        destructive: false,
        reason: 'missing',
        before: null,
        after: {
          providerType: target.target.providerType,
          providerResourceId: target.target.providerResourceId,
          stateDigest: target.target.stateDigest,
        },
      })),
    },
    { profile: base.profile },
  );
}

/** @param {Readonly<AnyRecord>} target @param {Readonly<AnyRecord>} binding @param {Readonly<AnyRecord>} [stateDigest] @returns {Readonly<AnyRecord>} */
function boundState(target, binding, stateDigest = target.target.stateDigest) {
  return {
    providerType: target.target.providerType,
    providerResourceId: binding.providerResourceId,
    stateDigest,
  };
}

/** @param {string} operation @param {Readonly<AnyRecord>} base @param {Readonly<AnyRecord>} head @returns {string} */
function activeInspectionId(operation, base, head) {
  return semanticId(
    'win5',
    'wharfie:test:resource-observation-authority-active-inspection:v1',
    {
      operation,
      deploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
      headId: head.headId,
    },
  );
}

/** @param {Readonly<AnyRecord>} base @param {Readonly<AnyRecord>} head @returns {Readonly<AnyRecord>} */
function makeReconcilePlan(base, head) {
  const bindingByKey = bindingsByKey(head);
  const targets = makeTargets(base, head);
  return createDeploymentPlan(
    {
      operation: 'reconcile',
      deploymentRevision: base.deploymentRevision,
      providerScope: base.providerScope,
      providerSpec: base.providerSpec,
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
      basis: {
        headGeneration: head.generation,
        settledDeploymentRevisionId: head.settledDeploymentRevisionId,
        inspectionId: activeInspectionId('reconcile', base, head),
      },
      actions: targets.map((target) => {
        const binding = bindingByKey.get(target.resourceKey);
        if (binding === undefined) {
          throw new Error(`Missing reconcile binding '${target.resourceKey}'.`);
        }
        const state = boundState(target, binding);
        return {
          resourceKey: target.resourceKey,
          capability: target.capability,
          role: target.role,
          management: target.management,
          ownershipMode: target.ownershipMode,
          dependsOn: target.dependsOn,
          onDestroy: target.onDestroy,
          action: 'noop',
          destructive: false,
          reason: 'already-converged',
          before: state,
          after: state,
        };
      }),
    },
    { profile: base.profile },
  );
}

/**
 * @param {Readonly<AnyRecord>} settled
 * @param {Readonly<AnyRecord>} desired
 * @param {Readonly<AnyRecord>} head
 * @returns {Readonly<AnyRecord>}
 */
function makeUpdatePlan(settled, desired, head) {
  const bindingByKey = bindingsByKey(head);
  const beforeByKey = new Map(
    makeTargets(settled, head).map((target) => [target.resourceKey, target]),
  );
  const desiredTargets = makeTargets(desired, head);
  return createDeploymentPlan(
    {
      operation: 'apply',
      deploymentRevision: desired.deploymentRevision,
      providerScope: desired.providerScope,
      providerSpec: desired.providerSpec,
      deploymentInstanceId: desired.deploymentInstanceId,
      incarnationId: desired.incarnationId,
      basis: {
        headGeneration: head.generation,
        settledDeploymentRevisionId: head.settledDeploymentRevisionId,
        inspectionId: activeInspectionId('update', desired, head),
      },
      actions: desiredTargets.map((target) => {
        const binding = bindingByKey.get(target.resourceKey);
        const prior = beforeByKey.get(target.resourceKey);
        if (binding === undefined || prior === undefined) {
          throw new Error(`Missing update authority '${target.resourceKey}'.`);
        }
        const before = boundState(prior, binding, prior.target.stateDigest);
        const after = boundState(target, binding);
        const changed = JSON.stringify(before) !== JSON.stringify(after);
        return {
          resourceKey: target.resourceKey,
          capability: target.capability,
          role: target.role,
          management: target.management,
          ownershipMode: target.ownershipMode,
          dependsOn: target.dependsOn,
          onDestroy: target.onDestroy,
          action: changed ? 'update' : 'noop',
          destructive: false,
          reason: changed ? 'deployment-change' : 'already-converged',
          before,
          after,
        };
      }),
    },
    { profile: desired.profile },
  );
}

/** @param {Readonly<AnyRecord>} base @param {Readonly<AnyRecord>} head @returns {Readonly<AnyRecord>} */
function makeDestroyPlan(base, head) {
  const bindingByKey = bindingsByKey(head);
  const targetByKey = new Map(
    makeTargets(base, head).map((target) => [target.resourceKey, target]),
  );
  return createDeploymentPlan(
    {
      operation: 'destroy',
      deploymentRevision: base.deploymentRevision,
      providerScope: base.providerScope,
      providerSpec: base.providerSpec,
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
      basis: {
        headGeneration: head.generation,
        settledDeploymentRevisionId: head.settledDeploymentRevisionId,
        inspectionId: activeInspectionId('destroy', base, head),
      },
      actions: getAwsSingleNodeResourceDestroyOrder().map((resourceKey) => {
        const target = targetByKey.get(resourceKey);
        const binding = bindingByKey.get(resourceKey);
        if (target === undefined || binding === undefined) {
          throw new Error(`Missing destroy authority '${resourceKey}'.`);
        }
        const before = boundState(target, binding);
        const retained = target.onDestroy === 'retain';
        return {
          resourceKey: target.resourceKey,
          capability: target.capability,
          role: target.role,
          management: target.management,
          ownershipMode: target.ownershipMode,
          dependsOn: target.dependsOn,
          onDestroy: target.onDestroy,
          action: retained ? 'noop' : 'delete',
          destructive: !retained,
          reason: retained ? 'retained-data' : 'destroy-requested',
          before,
          after: retained ? before : null,
        };
      }),
    },
    { profile: base.profile },
  );
}

/**
 * @param {Readonly<AnyRecord>} plan
 * @param {Readonly<AnyRecord>|null} [head]
 * @param {{ownershipNonces?: ReadonlyMap<number, string|null>}} [options]
 * @returns {ReadonlyArray<Readonly<AnyRecord>>}
 */
function makePlanIntents(plan, head = null, options = {}) {
  const bindingByKey = new Map(
    (head?.resourceBindings ?? []).map(
      (/** @type {Readonly<AnyRecord>} */ binding) => [
        binding.resourceKey,
        binding,
      ],
    ),
  );
  return plan.actions.map(
    (
      /** @type {Readonly<AnyRecord>} */ action,
      /** @type {number} */ index,
    ) => {
      const explicitNonce = options.ownershipNonces?.get(index);
      if (explicitNonce !== undefined || options.ownershipNonces?.has(index)) {
        return {
          actionId: action.actionId,
          status: 'pending',
          ownershipNonce: explicitNonce ?? null,
        };
      }
      if (action.management === 'external') {
        return {
          actionId: action.actionId,
          status: 'pending',
          ownershipNonce: null,
        };
      }
      if (action.action === 'create') {
        return {
          actionId: action.actionId,
          status: 'pending',
          ownershipNonce: nonce(100 + index),
        };
      }
      const binding = bindingByKey.get(action.resourceKey);
      if (binding === undefined) {
        throw new Error(
          `Missing managed noncreate intent binding '${action.resourceKey}'.`,
        );
      }
      return {
        actionId: action.actionId,
        status: 'pending',
        ownershipNonce: binding.ownershipNonce,
      };
    },
  );
}

/**
 * @param {Readonly<AnyRecord>} base
 * @param {Readonly<AnyRecord>} plan
 * @param {{frontier?: number, currentStatus?: 'pending'|'intended', operationStatus?: 'running'|'blocked', planId?: string, firstActionId?: string, intentCount?: number, allBindings?: boolean, resourceBindings?: ReadonlyArray<Readonly<AnyRecord>>, ownershipNonces?: ReadonlyMap<number, string|null>, generation?: number}} [options]
 * @returns {Readonly<AnyRecord>}
 */
function makeActiveCreateHead(base, plan, options = {}) {
  const intentCount = options.intentCount ?? plan.actions.length;
  const frontier = options.frontier ?? 0;
  const intents = makePlanIntents(plan, null, {
    ownershipNonces: options.ownershipNonces,
  })
    .slice(0, intentCount)
    .map((intent, index) => ({
      ...intent,
      actionId:
        index === 0 && options.firstActionId !== undefined
          ? options.firstActionId
          : intent.actionId,
      status:
        index < frontier
          ? 'settled'
          : index === frontier && frontier < intentCount
            ? (options.currentStatus ?? 'intended')
            : 'pending',
    }));
  const settledKeys = new Set(
    plan.actions
      .slice(0, frontier)
      .map((/** @type {Readonly<AnyRecord>} */ action) => action.resourceKey),
  );
  const omittedKeys = new Set(
    AWS_SINGLE_NODE_RESOURCE_GRAPH.resources
      .map(
        (/** @type {Readonly<AnyRecord>} */ definition) =>
          definition.resourceKey,
      )
      .filter(
        (/** @type {string} */ resourceKey) => !settledKeys.has(resourceKey),
      ),
  );
  const bindings =
    options.resourceBindings ??
    (options.allBindings
      ? makeBindings(base, { plan, intents })
      : makeBindings(base, { omit: omittedKeys, plan, intents }));
  const currentStatus =
    frontier < intentCount ? (options.currentStatus ?? 'intended') : null;
  const generation =
    plan.basis.headGeneration +
    1 +
    frontier * 2 +
    (currentStatus === 'intended' ? 1 : 0) +
    ((options.operationStatus ?? 'running') === 'blocked' ? 1 : 0);
  return createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: options.generation ?? generation,
    phase: 'CONVERGING',
    settledDeploymentRevisionId: null,
    targetDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    resourceBindings: bindings,
    activeOperation: {
      kind: 'create',
      planId: options.planId ?? plan.planId,
      status: options.operationStatus ?? 'running',
      nextActionIndex: frontier,
      intents,
    },
    lastOperation: null,
  });
}

/**
 * @param {Readonly<AnyRecord>} base
 * @param {Readonly<AnyRecord>} plan
 * @param {Readonly<AnyRecord>} readyHead
 * @param {'reconcile'|'update'|'destroy'} kind
 * @param {{frontier?: number, currentStatus?: 'pending'|'intended', operationStatus?: 'running'|'blocked', resourceBindings?: ReadonlyArray<Readonly<AnyRecord>>, ownershipNonces?: ReadonlyMap<number, string|null>, generation?: number}} [options]
 * @returns {Readonly<AnyRecord>}
 */
function makeActiveResidentHead(base, plan, readyHead, kind, options = {}) {
  const frontier = options.frontier ?? 0;
  const intents = makePlanIntents(plan, readyHead, {
    ownershipNonces: options.ownershipNonces,
  }).map((intent, index) => ({
    ...intent,
    status:
      index < frontier
        ? 'settled'
        : index === frontier && frontier < plan.actions.length
          ? (options.currentStatus ?? 'intended')
          : 'pending',
  }));
  const currentStatus =
    frontier < plan.actions.length
      ? (options.currentStatus ?? 'intended')
      : null;
  const generation =
    readyHead.generation +
    1 +
    frontier * 2 +
    (currentStatus === 'intended' ? 1 : 0) +
    ((options.operationStatus ?? 'running') === 'blocked' ? 1 : 0);
  const removedResourceKeys = new Set(
    plan.actions
      .slice(0, frontier)
      .filter(
        (/** @type {Readonly<AnyRecord>} */ action) => action.after === null,
      )
      .map((/** @type {Readonly<AnyRecord>} */ action) => action.resourceKey),
  );
  const resourceBindings =
    options.resourceBindings ??
    readyHead.resourceBindings.filter(
      (/** @type {Readonly<AnyRecord>} */ binding) =>
        !removedResourceKeys.has(binding.resourceKey),
    );
  return createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: options.generation ?? generation,
    phase: kind === 'destroy' ? 'DESTROYING' : 'CONVERGING',
    settledDeploymentRevisionId: readyHead.settledDeploymentRevisionId,
    targetDeploymentRevisionId:
      kind === 'destroy' ? null : base.deploymentRevision.deploymentRevisionId,
    resourceBindings,
    activeOperation: {
      kind,
      planId: plan.planId,
      status: options.operationStatus ?? 'running',
      nextActionIndex: frontier,
      intents,
    },
    lastOperation: readyHead.lastOperation,
  });
}

/**
 * @param {Readonly<AnyRecord>} base
 * @param {string} operation
 * @param {Readonly<AnyRecord>|null} head
 * @param {Readonly<AnyRecord>|null} plan
 * @param {Readonly<AnyRecord>} target
 * @param {Readonly<AnyRecord>} [overrides] - May supply the resident settledPlan.
 * @returns {AnyRecord}
 */
function authorityInput(base, operation, head, plan, target, overrides = {}) {
  return {
    operation,
    deploymentRevision: base.deploymentRevision,
    profile: base.profile,
    providerScope: base.providerScope,
    providerSpec: base.providerSpec,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    head,
    plan,
    settledPlan: null,
    target,
    ...overrides,
  };
}

/** @param {Readonly<AnyRecord>} head @returns {Map<string, Readonly<AnyRecord>>} */
function bindingsByKey(head) {
  return new Map(
    head.resourceBindings.map((/** @type {Readonly<AnyRecord>} */ binding) => [
      binding.resourceKey,
      binding,
    ]),
  );
}

/**
 * Recompute one structurally valid PlanV3 after an adversarial semantic change.
 * @param {Readonly<AnyRecord>} plan
 * @param {Readonly<AnyRecord>} profile
 * @param {Readonly<AnyRecord>} [overrides]
 * @returns {Readonly<AnyRecord>}
 */
function recreatePlan(plan, profile, overrides = {}) {
  const actions = (overrides.actions ?? plan.actions).map(
    (/** @type {Readonly<AnyRecord>} */ action) => {
      const { actionId: _actionId, ...input } = action;
      return input;
    },
  );
  return createDeploymentPlan(
    {
      operation: overrides.operation ?? plan.operation,
      deploymentRevision:
        overrides.deploymentRevision ?? plan.deploymentRevision,
      providerScope: overrides.providerScope ?? plan.providerScope,
      providerSpec: overrides.providerSpec ?? plan.providerSpec,
      deploymentInstanceId:
        overrides.deploymentInstanceId ?? plan.deploymentInstanceId,
      incarnationId: overrides.incarnationId ?? plan.incarnationId,
      basis: overrides.basis ?? plan.basis,
      actions,
    },
    { profile },
  );
}

describe('AWS single-node resource observation authority', () => {
  it('canonicalizes exactly eleven input fields, derives two fields, stays deterministic, and never mutates input', () => {
    const base = makeBase();
    const ready = makeReadyState(base);
    const head = ready.head;
    const target = targetFor(makeTargets(base, head), 'artifact');
    const input = authorityInput(base, 'apply', head, null, target, {
      settledPlan: ready.plan,
    });
    const snapshot = clone(input);

    const first = createAwsSingleNodeResourceObservationAuthority(input);
    const second = createAwsSingleNodeResourceObservationAuthority(
      clone(input),
    );

    expect(Object.keys(input).sort()).toEqual([
      'deploymentInstanceId',
      'deploymentRevision',
      'head',
      'incarnationId',
      'operation',
      'plan',
      'profile',
      'providerScope',
      'providerSpec',
      'settledPlan',
      'target',
    ]);
    expect(Object.keys(first).sort()).toEqual(
      ['binding', 'currentAction', ...Object.keys(input)].sort(),
    );
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(input).toEqual(snapshot);
    expect(first.operation).toBe('apply');
    expect(first.deploymentRevision).toEqual(base.deploymentRevision);
    expect(first.profile).toEqual(base.profile);
    expect(first.providerScope).toEqual(base.providerScope);
    expect(first.providerSpec).toEqual(base.providerSpec);
    expect(first.deploymentInstanceId).toBe(base.deploymentInstanceId);
    expect(first.incarnationId).toBe(base.incarnationId);
    expect(first.head).toEqual(head);
    expect(first.plan).toBeNull();
    expect(first.settledPlan).toEqual(ready.plan);
    expect(first.target).toEqual(target);
    expect(first.currentAction).toBeNull();
    expectDeepFrozen(first);
  });

  it.each(['apply', 'reconcile', 'destroy'])(
    'accepts READY %s authority only with its exact settled plan',
    (operation) => {
      const base = makeBase();
      const ready = makeReadyState(base);
      const head = ready.head;
      const target = targetFor(makeTargets(base, head), 'substrate');
      const authority = createAwsSingleNodeResourceObservationAuthority(
        authorityInput(base, operation, head, null, target, {
          settledPlan: ready.plan,
        }),
      );

      expect(authority.operation).toBe(operation);
      expect(authority.plan).toBeNull();
      expect(authority.settledPlan).toEqual(ready.plan);
      expect(authority.currentAction).toBeNull();
    },
  );

  it('permits a prospective READY revision only for apply', () => {
    const settled = makeBase({ revision: 1 });
    const desired = makeBase({ revision: 2 });
    const ready = makeReadyState(settled);
    const head = ready.head;
    const target = targetFor(makeTargets(desired, head), 'artifact');

    const authority = createAwsSingleNodeResourceObservationAuthority(
      authorityInput(desired, 'apply', head, null, target, {
        settledPlan: ready.plan,
      }),
    );

    expect(authority.deploymentRevision).toEqual(desired.deploymentRevision);
    expect(authority.head.settledDeploymentRevisionId).toBe(
      settled.deploymentRevision.deploymentRevisionId,
    );
    expect(authority.target).toEqual(target);

    for (const operation of ['reconcile', 'destroy']) {
      expect(() =>
        createAwsSingleNodeResourceObservationAuthority(
          authorityInput(desired, operation, head, null, target, {
            settledPlan: ready.plan,
          }),
        ),
      ).toThrow(/does not match its exact deployment context/i);
    }
  });

  it('pins READY ProviderSpec and completed-operation lineage to the exact settled plan', () => {
    const base = makeBase();
    const ready = makeReadyState(base);
    const target = targetFor(makeTargets(base, ready.head), 'artifact');
    const alternate = makeBase({ specVariant: 2 });
    const alternateReady = makeReadyState(base, {
      plan: makeCreatePlan(alternate),
    });
    expect(() =>
      createAwsSingleNodeResourceObservationAuthority(
        authorityInput(base, 'apply', alternateReady.head, null, target, {
          settledPlan: alternateReady.plan,
        }),
      ),
    ).toThrow(/plan does not match the exact active operation/i);

    const wrongPlanId = makeReadyState(base, {
      head: {
        planId: semanticId(
          'wpl3',
          'wharfie:test:resource-observation-authority-wrong-settled-plan:v1',
          {},
        ),
      },
    });
    const wrongKind = makeReadyState(base, {
      head: { operationKind: 'reconcile' },
    });
    const nonOlderPlan = recreatePlan(ready.plan, base.profile, {
      basis: {
        ...ready.plan.basis,
        headGeneration: ready.head.generation,
      },
    });
    const nonOlder = makeReadyState(base, {
      plan: nonOlderPlan,
      head: { generation: ready.head.generation },
    });

    for (const state of [wrongPlanId, wrongKind, nonOlder]) {
      const stateTarget = targetFor(makeTargets(base, state.head), 'artifact');
      expect(() =>
        createAwsSingleNodeResourceObservationAuthority(
          authorityInput(base, 'apply', state.head, null, stateTarget, {
            settledPlan: state.plan,
          }),
        ),
      ).toThrow(/plan does not match the exact active operation/i);
    }
  });

  it('derives the exact durable binding for every target and null for an unbound target', () => {
    const base = makeBase();
    const ready = makeReadyState(base);
    const head = ready.head;
    const bindingByKey = bindingsByKey(head);

    for (const target of makeTargets(base, head)) {
      const authority = createAwsSingleNodeResourceObservationAuthority(
        authorityInput(base, 'apply', head, null, target, {
          settledPlan: ready.plan,
        }),
      );
      expect(authority.binding).toEqual(bindingByKey.get(target.resourceKey));
      expect(authority.binding).not.toBe(bindingByKey.get(target.resourceKey));
    }

    const omitted = 'control-state-attachment';
    const partialBindings = ready.bindings.filter(
      (binding) => binding.resourceKey !== omitted,
    );
    const partialHead = makeReadyHead(
      base,
      ready.plan,
      partialBindings,
      ready.intents,
    );
    const unbound = createAwsSingleNodeResourceObservationAuthority(
      authorityInput(
        base,
        'apply',
        partialHead,
        null,
        targetFor(makeTargets(base, partialHead), omitted),
        { settledPlan: ready.plan },
      ),
    );
    expect(unbound.binding).toBeNull();
  });

  it('derives one exact target-local intended action and ownership nonce', () => {
    const base = makeBase();
    const plan = makeCreatePlan(base);
    const head = makeActiveCreateHead(base, plan, {
      currentStatus: 'intended',
    });
    const targets = makeTargets(base, head);
    const currentIndex = head.activeOperation.nextActionIndex;
    const currentIntent = head.activeOperation.intents[currentIndex];
    const currentPlanAction = plan.actions[currentIndex];

    for (const target of targets) {
      const authority = createAwsSingleNodeResourceObservationAuthority(
        authorityInput(base, 'apply', head, plan, target),
      );
      if (target.resourceKey === currentPlanAction.resourceKey) {
        expect(authority.currentAction).toEqual({
          actionIndex: currentIndex,
          action: currentPlanAction,
          ownershipNonce: currentIntent.ownershipNonce,
        });
        expect(authority.currentAction.action).not.toBe(currentPlanAction);
      } else {
        expect(authority.currentAction).toBeNull();
      }
      expect(authority.binding).toBeNull();
    }
  });

  it('keeps a blocked intended operation observable only for its exact target', () => {
    const base = makeBase();
    const plan = makeCreatePlan(base);
    const head = makeActiveCreateHead(base, plan, {
      currentStatus: 'intended',
      operationStatus: 'blocked',
    });
    const targets = makeTargets(base, head);
    const actionIndex = head.activeOperation.nextActionIndex;
    const action = plan.actions[actionIndex];
    const intent = head.activeOperation.intents[actionIndex];
    const target = targetFor(targets, action.resourceKey);
    const otherTarget = targets.find(
      (candidate) => candidate.resourceKey !== action.resourceKey,
    );
    if (otherTarget === undefined) {
      throw new Error('Expected another target for blocked authority proof.');
    }

    const authority = createAwsSingleNodeResourceObservationAuthority(
      authorityInput(base, 'apply', head, plan, target),
    );
    const otherAuthority = createAwsSingleNodeResourceObservationAuthority(
      authorityInput(base, 'apply', head, plan, otherTarget),
    );

    expect(authority.head.activeOperation.status).toBe('blocked');
    expect(authority.currentAction).toEqual({
      actionIndex,
      action,
      ownershipNonce: intent.ownershipNonce,
    });
    expect(otherAuthority.head.activeOperation.status).toBe('blocked');
    expect(otherAuthority.currentAction).toBeNull();
  });

  it('rejects unreachable managed create nonce, binding, and desired-state authority', () => {
    const base = makeBase();
    const plan = makeCreatePlan(base);
    const action = plan.actions[0];
    const nullNonceHead = makeActiveCreateHead(base, plan, {
      ownershipNonces: new Map([[0, null]]),
    });
    const omitted = new Set(
      AWS_SINGLE_NODE_RESOURCE_GRAPH.resources
        .map(
          (/** @type {Readonly<AnyRecord>} */ definition) =>
            definition.resourceKey,
        )
        .filter(
          (/** @type {string} */ resourceKey) =>
            resourceKey !== action.resourceKey,
        ),
    );
    const existingBindingHead = makeActiveCreateHead(base, plan, {
      resourceBindings: makeBindings(base, { omit: omitted }),
    });
    const forgedActions = plan.actions.map(
      (
        /** @type {Readonly<AnyRecord>} */ candidate,
        /** @type {number} */ index,
      ) =>
        index === 0
          ? {
              ...clone(candidate),
              after: {
                ...clone(candidate.after),
                stateDigest: digest('forged current create state'),
              },
            }
          : candidate,
    );
    const forgedPlan = recreatePlan(plan, base.profile, {
      actions: forgedActions,
    });
    const forgedHead = makeActiveCreateHead(base, forgedPlan);

    for (const [candidatePlan, head] of [
      [plan, nullNonceHead],
      [plan, existingBindingHead],
      [forgedPlan, forgedHead],
    ]) {
      const candidateAction =
        candidatePlan.actions[head.activeOperation.nextActionIndex];
      const target = targetFor(
        makeTargets(base, head),
        candidateAction.resourceKey,
      );
      expect(() =>
        createAwsSingleNodeResourceObservationAuthority(
          authorityInput(base, 'apply', head, candidatePlan, target),
        ),
      ).toThrow(/plan does not match the exact active operation/i);
    }
  });

  it('accepts a dependency-backed create frontier and rejects a forged dependency receipt', () => {
    const base = makeBase();
    const plan = makeCreatePlan(base);
    const actionIndex = plan.actions.findIndex(
      (/** @type {Readonly<AnyRecord>} */ action) =>
        action.dependsOn.length > 0,
    );
    expect(actionIndex).toBeGreaterThan(0);
    const head = makeActiveCreateHead(base, plan, {
      frontier: actionIndex,
    });
    const action = plan.actions[actionIndex];
    const target = targetFor(makeTargets(base, head), action.resourceKey);
    const authority = createAwsSingleNodeResourceObservationAuthority(
      authorityInput(base, 'apply', head, plan, target),
    );
    expect(authority.currentAction.actionIndex).toBe(actionIndex);

    const settledKeys = new Set(
      plan.actions
        .slice(0, actionIndex)
        .map(
          (/** @type {Readonly<AnyRecord>} */ candidate) =>
            candidate.resourceKey,
        ),
    );
    const omit = new Set(
      AWS_SINGLE_NODE_RESOURCE_GRAPH.resources
        .map(
          (/** @type {Readonly<AnyRecord>} */ definition) =>
            definition.resourceKey,
        )
        .filter(
          (/** @type {string} */ resourceKey) => !settledKeys.has(resourceKey),
        ),
    );
    const forgedDependencyKey = action.dependsOn[0];
    const forgedBindings = makeBindings(base, {
      omit,
      plan,
      intents: head.activeOperation.intents,
      createdByActionIds: new Map([
        [
          forgedDependencyKey,
          semanticId(
            'wda3',
            'wharfie:test:resource-observation-authority-forged-receipt:v1',
            { resourceKey: forgedDependencyKey },
          ),
        ],
      ]),
    });
    const forgedHead = makeActiveCreateHead(base, plan, {
      frontier: actionIndex,
      resourceBindings: forgedBindings,
    });
    const forgedTarget = targetFor(
      makeTargets(base, forgedHead),
      action.resourceKey,
    );
    expect(() =>
      createAwsSingleNodeResourceObservationAuthority(
        authorityInput(base, 'apply', forgedHead, plan, forgedTarget),
      ),
    ).toThrow(/plan does not match the exact active operation/i);
  });

  it('derives exact target-local intended actions for active reconcile, update, and destroy operation kinds', () => {
    const resident = makeBase({ revision: 1 });
    const ready = makeReadyState(resident);
    const readyHead = ready.head;

    const reconcilePlan = makeReconcilePlan(resident, readyHead);
    const reconcileHead = makeActiveResidentHead(
      resident,
      reconcilePlan,
      readyHead,
      'reconcile',
    );

    const desired = makeBase({ revision: 2 });
    const updatePlan = makeUpdatePlan(resident, desired, readyHead);
    const updateHead = makeActiveResidentHead(
      desired,
      updatePlan,
      readyHead,
      'update',
    );

    const destroyPlan = makeDestroyPlan(resident, readyHead);
    const destroyHead = makeActiveResidentHead(
      resident,
      destroyPlan,
      readyHead,
      'destroy',
    );

    const fixtures = [
      {
        base: resident,
        operation: 'reconcile',
        expectedKind: 'reconcile',
        plan: reconcilePlan,
        settledPlan: ready.plan,
        head: reconcileHead,
      },
      {
        base: desired,
        operation: 'apply',
        expectedKind: 'update',
        plan: updatePlan,
        settledPlan: ready.plan,
        head: updateHead,
      },
      {
        base: resident,
        operation: 'destroy',
        expectedKind: 'destroy',
        plan: destroyPlan,
        settledPlan: ready.plan,
        head: destroyHead,
      },
    ];

    for (const fixture of fixtures) {
      const actionIndex = fixture.head.activeOperation.nextActionIndex;
      const action = fixture.plan.actions[actionIndex];
      const target = targetFor(
        makeTargets(fixture.base, fixture.head),
        action.resourceKey,
      );
      const authority = createAwsSingleNodeResourceObservationAuthority(
        authorityInput(
          fixture.base,
          fixture.operation,
          fixture.head,
          fixture.plan,
          target,
          { settledPlan: fixture.settledPlan },
        ),
      );

      expect(authority.head.activeOperation.kind).toBe(fixture.expectedKind);
      const binding = bindingsByKey(fixture.head).get(action.resourceKey);
      if (binding === undefined) {
        throw new Error(`Missing fixture binding '${action.resourceKey}'.`);
      }
      expect(authority.currentAction).toEqual({
        actionIndex,
        action,
        ownershipNonce: binding.ownershipNonce,
      });
      expect(authority.binding).toEqual(binding);
    }
  });

  it('rejects resident nonce or binding forgery and requires settled prior destroy purges to be unbound', () => {
    const base = makeBase();
    const ready = makeReadyState(base);
    const reconcilePlan = makeReconcilePlan(base, ready.head);
    const wrongNonceHead = makeActiveResidentHead(
      base,
      reconcilePlan,
      ready.head,
      'reconcile',
      { ownershipNonces: new Map([[0, nonce(250)]]) },
    );
    const wrongNonceTarget = targetFor(
      makeTargets(base, wrongNonceHead),
      reconcilePlan.actions[0].resourceKey,
    );
    expect(() =>
      createAwsSingleNodeResourceObservationAuthority(
        authorityInput(
          base,
          'reconcile',
          wrongNonceHead,
          reconcilePlan,
          wrongNonceTarget,
          { settledPlan: ready.plan },
        ),
      ),
    ).toThrow(/plan does not match the exact active operation/i);

    const leafIndex = reconcilePlan.actions.length - 1;
    const leafKey = reconcilePlan.actions[leafIndex].resourceKey;
    const missingBindingHead = makeActiveResidentHead(
      base,
      reconcilePlan,
      ready.head,
      'reconcile',
      {
        frontier: leafIndex,
        resourceBindings: ready.bindings.filter(
          (binding) => binding.resourceKey !== leafKey,
        ),
      },
    );
    const missingBindingTarget = targetFor(
      makeTargets(base, missingBindingHead),
      leafKey,
    );
    expect(() =>
      createAwsSingleNodeResourceObservationAuthority(
        authorityInput(
          base,
          'reconcile',
          missingBindingHead,
          reconcilePlan,
          missingBindingTarget,
          { settledPlan: ready.plan },
        ),
      ),
    ).toThrow(/plan does not match the exact active operation/i);

    const destroyPlan = makeDestroyPlan(base, ready.head);
    const destroyHead = makeActiveResidentHead(
      base,
      destroyPlan,
      ready.head,
      'destroy',
      { frontier: 1 },
    );
    const destroyAction = destroyPlan.actions[1];
    const destroyTarget = targetFor(
      makeTargets(base, destroyHead),
      destroyAction.resourceKey,
    );
    const destroyAuthority = createAwsSingleNodeResourceObservationAuthority(
      authorityInput(base, 'destroy', destroyHead, destroyPlan, destroyTarget, {
        settledPlan: ready.plan,
      }),
    );
    expect(destroyAuthority.currentAction.actionIndex).toBe(1);

    const forgedDestroyHead = makeActiveResidentHead(
      base,
      destroyPlan,
      ready.head,
      'destroy',
      { frontier: 1, resourceBindings: ready.bindings },
    );
    const forgedDestroyTarget = targetFor(
      makeTargets(base, forgedDestroyHead),
      destroyAction.resourceKey,
    );
    expect(() =>
      createAwsSingleNodeResourceObservationAuthority(
        authorityInput(
          base,
          'destroy',
          forgedDestroyHead,
          destroyPlan,
          forgedDestroyTarget,
          { settledPlan: ready.plan },
        ),
      ),
    ).toThrow(/plan does not match the exact active operation/i);
  });

  it('accepts a pending current intent but derives currentAction null for every target', () => {
    const base = makeBase();
    const plan = makeCreatePlan(base);
    const head = makeActiveCreateHead(base, plan, {
      currentStatus: 'pending',
    });

    for (const target of makeTargets(base, head)) {
      const authority = createAwsSingleNodeResourceObservationAuthority(
        authorityInput(base, 'apply', head, plan, target),
      );
      expect(authority.currentAction).toBeNull();
    }
  });

  it('accepts an all-settled frontier and derives currentAction null with exact bindings', () => {
    const base = makeBase();
    const plan = makeCreatePlan(base);
    const head = makeActiveCreateHead(base, plan, {
      frontier: plan.actions.length,
      allBindings: true,
    });
    const bindingByKey = bindingsByKey(head);

    expect(head.activeOperation.nextActionIndex).toBe(plan.actions.length);
    for (const target of makeTargets(base, head)) {
      const authority = createAwsSingleNodeResourceObservationAuthority(
        authorityInput(base, 'apply', head, plan, target),
      );
      expect(authority.currentAction).toBeNull();
      expect(authority.binding).toEqual(bindingByKey.get(target.resourceKey));
    }
  });

  it('requires active and settled plans exactly when their durable operations exist', () => {
    const base = makeBase();
    const plan = makeCreatePlan(base);
    const activeHead = makeActiveCreateHead(base, plan);
    const activeTarget = targetFor(makeTargets(base, activeHead), 'artifact');
    expect(() =>
      createAwsSingleNodeResourceObservationAuthority(
        authorityInput(base, 'apply', activeHead, null, activeTarget),
      ),
    ).toThrow(/plan does not match the exact active operation/i);

    const ready = makeReadyState(base);
    expect(() =>
      createAwsSingleNodeResourceObservationAuthority(
        authorityInput(base, 'apply', activeHead, plan, activeTarget, {
          settledPlan: ready.plan,
        }),
      ),
    ).toThrow(/plan does not match the exact active operation/i);

    const readyHead = ready.head;
    const readyTarget = targetFor(makeTargets(base, readyHead), 'artifact');
    expect(() =>
      createAwsSingleNodeResourceObservationAuthority(
        authorityInput(base, 'apply', readyHead, plan, readyTarget, {
          settledPlan: ready.plan,
        }),
      ),
    ).toThrow(/plan does not match the exact active operation/i);
    expect(() =>
      createAwsSingleNodeResourceObservationAuthority(
        authorityInput(base, 'apply', readyHead, null, readyTarget),
      ),
    ).toThrow(/plan does not match the exact active operation/i);

    const reconcilePlan = makeReconcilePlan(base, readyHead);
    const reconcileHead = makeActiveResidentHead(
      base,
      reconcilePlan,
      readyHead,
      'reconcile',
    );
    const reconcileTarget = targetFor(
      makeTargets(base, reconcileHead),
      reconcilePlan.actions[0].resourceKey,
    );
    expect(() =>
      createAwsSingleNodeResourceObservationAuthority(
        authorityInput(
          base,
          'reconcile',
          reconcileHead,
          reconcilePlan,
          reconcileTarget,
        ),
      ),
    ).toThrow(/plan does not match the exact active operation/i);
  });

  it('rejects mismatched desired tuple, profile, scope, specification, instance, incarnation, and head authority', () => {
    const base = makeBase();
    const otherApp = makeBase({ appId: 'other-authority-app' });
    const otherScope = makeBase({ accountId: '210987654321' });
    const otherSpec = makeBase({ specVariant: 2 });
    const otherIncarnation = makeBase({ incarnationByte: 78 });
    const ready = makeReadyState(base);
    const head = ready.head;
    const target = targetFor(makeTargets(base, head), 'substrate');
    const otherHead = makeReadyState(otherScope).head;
    const invalidOverrides = [
      { deploymentRevision: otherApp.deploymentRevision },
      { profile: otherApp.profile },
      { providerScope: otherScope.providerScope },
      { providerSpec: otherSpec.providerSpec },
      { deploymentInstanceId: otherScope.deploymentInstanceId },
      { incarnationId: otherIncarnation.incarnationId },
      { head: otherHead },
    ];

    for (const overrides of invalidOverrides) {
      expect(() =>
        createAwsSingleNodeResourceObservationAuthority(
          authorityInput(base, 'apply', head, null, target, {
            settledPlan: ready.plan,
            ...overrides,
          }),
        ),
      ).toThrow();
    }
    expect(() =>
      createAwsSingleNodeResourceObservationAuthority({
        ...authorityInput(base, 'apply', head, null, target, {
          settledPlan: ready.plan,
        }),
        operation: 'unknown',
      }),
    ).toThrow(/operation is not supported/i);
  });

  it('requires one byte-exact V45 target and rejects tampering, a wrong role key, and another revision target', () => {
    const base = makeBase();
    const ready = makeReadyState(base);
    const head = ready.head;
    const artifact = targetFor(makeTargets(base, head), 'artifact');
    const desired = makeBase({ revision: 2 });
    const otherRevisionTarget = targetFor(
      makeTargets(desired, head),
      'artifact',
    );
    const invalidTargets = [
      { ...clone(artifact), extra: true },
      { ...clone(artifact), resourceKey: 'substrate' },
      { ...clone(artifact), management: 'external' },
      { ...clone(artifact), dependsOn: ['substrate'] },
      {
        ...clone(artifact),
        target: {
          ...clone(artifact.target),
          providerResourceId: 'arn:aws:s3:::wrong/object',
        },
      },
      {
        ...clone(artifact),
        target: {
          ...clone(artifact.target),
          stateDigest: digest('tampered authority target'),
        },
      },
      otherRevisionTarget,
    ];

    for (const invalidTarget of invalidTargets) {
      expect(() =>
        createAwsSingleNodeResourceObservationAuthority(
          authorityInput(base, 'apply', head, null, invalidTarget, {
            settledPlan: ready.plan,
          }),
        ),
      ).toThrow(/target does not match exactly one desired resource target/i);
    }
  });

  it('validates the exact active PlanV3 tuple, operation, basis, head planId, and ordered intents', () => {
    const base = makeBase();
    const plan = makeCreatePlan(base);
    const head = makeActiveCreateHead(base, plan);
    const target = targetFor(makeTargets(base, head), 'artifact');
    const otherRevision = makeBase({ revision: 2 });
    const otherSpec = makeBase({ specVariant: 2 });
    const otherScope = makeBase({ accountId: '210987654321' });
    const otherIncarnation = makeBase({ incarnationByte: 78 });
    const candidates = [
      [
        'input operation',
        authorityInput(base, 'reconcile', head, plan, target),
      ],
      [
        'plan revision',
        authorityInput(
          base,
          'apply',
          head,
          makeCreatePlan(otherRevision),
          target,
        ),
      ],
      [
        'plan provider spec',
        authorityInput(base, 'apply', head, makeCreatePlan(otherSpec), target),
      ],
      [
        'plan provider scope',
        authorityInput(base, 'apply', head, makeCreatePlan(otherScope), target),
      ],
      [
        'plan incarnation',
        authorityInput(
          base,
          'apply',
          head,
          makeCreatePlan(otherIncarnation),
          target,
        ),
      ],
      [
        'plan basis',
        authorityInput(
          base,
          'apply',
          head,
          makeCreatePlan(base, { headGeneration: 1 }),
          target,
        ),
      ],
      [
        'head planId',
        authorityInput(
          base,
          'apply',
          makeActiveCreateHead(base, plan, {
            planId: semanticId(
              'wpl3',
              'wharfie:test:resource-observation-authority-wrong-plan:v1',
              {},
            ),
          }),
          plan,
          target,
        ),
      ],
      [
        'head intent actionId',
        authorityInput(
          base,
          'apply',
          makeActiveCreateHead(base, plan, {
            firstActionId: semanticId(
              'wda3',
              'wharfie:test:resource-observation-authority-wrong-action:v1',
              {},
            ),
          }),
          plan,
          target,
        ),
      ],
      [
        'head intent cardinality',
        authorityInput(
          base,
          'apply',
          makeActiveCreateHead(base, plan, { intentCount: 1 }),
          plan,
          target,
        ),
      ],
    ];

    for (const [, input] of candidates) {
      expect(() =>
        createAwsSingleNodeResourceObservationAuthority(input),
      ).toThrow(
        /deployment context|plan does not match the exact active operation/i,
      );
    }
  });

  it('rejects malformed current and terminal action frontiers', () => {
    const base = makeBase();
    const plan = makeCreatePlan(base);
    const intendedHead = makeActiveCreateHead(base, plan);
    const target = targetFor(makeTargets(base, intendedHead), 'artifact');

    const settledAtCurrent = clone(intendedHead);
    settledAtCurrent.activeOperation.intents[0].status = 'settled';
    const negativeFrontier = clone(intendedHead);
    negativeFrontier.activeOperation.nextActionIndex = -1;
    const beyondFrontier = clone(intendedHead);
    beyondFrontier.activeOperation.nextActionIndex = plan.actions.length + 1;
    const incompleteTerminal = clone(
      makeActiveCreateHead(base, plan, {
        frontier: plan.actions.length,
        allBindings: true,
      }),
    );
    incompleteTerminal.activeOperation.intents.at(-1).status = 'pending';

    for (const head of [
      settledAtCurrent,
      negativeFrontier,
      beyondFrontier,
      incompleteTerminal,
    ]) {
      expect(() =>
        createAwsSingleNodeResourceObservationAuthority(
          authorityInput(base, 'apply', head, plan, target),
        ),
      ).toThrow();
    }
  });

  it('rejects a null head structurally and a DESTROYED head with one fixed non-echoing unsupported error', () => {
    const base = makeBase();
    const nullTarget = targetFor(makeTargets(base, null), 'artifact');
    expect(() =>
      createAwsSingleNodeResourceObservationAuthority(
        authorityInput(base, 'apply', null, null, nullTarget),
      ),
    ).toThrow(/head must be non-null/i);

    const destroyed = makeDestroyedHead(base);
    const destroyedTarget = targetFor(makeTargets(base, destroyed), 'artifact');
    expectUnsupported(() =>
      createAwsSingleNodeResourceObservationAuthority(
        authorityInput(base, 'apply', destroyed, null, destroyedTarget),
      ),
    );
  });

  it('rejects malformed top-level structure and exact-key violations', () => {
    for (const value of [undefined, null, [], 'authority', 48]) {
      expect(() =>
        createAwsSingleNodeResourceObservationAuthority(value),
      ).toThrow(TypeError);
    }

    const base = makeBase();
    const ready = makeReadyState(base);
    const head = ready.head;
    const target = targetFor(makeTargets(base, head), 'artifact');
    const valid = authorityInput(base, 'apply', head, null, target, {
      settledPlan: ready.plan,
    });
    for (const key of Object.keys(valid)) {
      const missing = clone(valid);
      delete missing[key];
      expect(() =>
        createAwsSingleNodeResourceObservationAuthority(missing),
      ).toThrow(new RegExp(`${key} is required`, 'i'));
    }
    expect(() =>
      createAwsSingleNodeResourceObservationAuthority({
        ...valid,
        credentials: 'secret',
      }),
    ).toThrow(/credentials is not supported/i);
  });

  it('rejects structurally malformed nested authority documents', () => {
    const base = makeBase();
    const readyState = makeReadyState(base);
    const readyHead = readyState.head;
    const readyTarget = targetFor(makeTargets(base, readyHead), 'artifact');
    const ready = authorityInput(base, 'apply', readyHead, null, readyTarget, {
      settledPlan: readyState.plan,
    });
    const plan = makeCreatePlan(base);
    const activeHead = makeActiveCreateHead(base, plan);
    const activeTarget = targetFor(makeTargets(base, activeHead), 'artifact');
    const active = authorityInput(
      base,
      'apply',
      activeHead,
      plan,
      activeTarget,
    );
    const malformed = [
      {
        ...ready,
        deploymentRevision: { ...ready.deploymentRevision, extra: true },
      },
      { ...ready, profile: { ...ready.profile, extra: true } },
      { ...ready, providerScope: { ...ready.providerScope, extra: true } },
      { ...ready, providerSpec: { ...ready.providerSpec, extra: true } },
      { ...ready, head: { ...ready.head, extra: true } },
      { ...ready, target: { ...ready.target, extra: true } },
      { ...active, plan: { ...active.plan, extra: true } },
      { ...ready, settledPlan: { ...ready.settledPlan, extra: true } },
      { ...ready, deploymentRevision: [] },
      { ...ready, profile: null },
      { ...ready, providerScope: 'scope' },
      { ...ready, providerSpec: [] },
      { ...ready, head: 'head' },
      { ...active, plan: [] },
      { ...ready, settledPlan: [] },
      { ...ready, target: null },
    ];

    for (const input of malformed) {
      expect(() =>
        createAwsSingleNodeResourceObservationAuthority(input),
      ).toThrow();
    }
  });
});
