import { describe, expect, it, jest } from '@jest/globals';

import {
  createCanonicalJsonSha256Id,
  createSha256Id,
} from '../../src/core/runtime/content-id.js';
import { compareCanonicalStrings } from '../../src/core/runtime/canonical-order.js';
import { getAwsSingleNodeDefaultIpv4RouteProviderResourceId } from '../../src/core/runtime/deployment-aws-default-ipv4-route-resource.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from '../../src/core/runtime/deployment-aws-desired-resource-targets.js';
import { createAwsSingleNodeDeploymentInspectionProvider } from '../../src/core/runtime/deployment-aws-inspection.js';
import { getAwsSingleNodeInternetGatewayAttachmentProviderResourceId } from '../../src/core/runtime/deployment-aws-internet-gateway-attachment-resource.js';
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
  getAwsSingleNodeResourceApplyOrder,
  getAwsSingleNodeResourceDestroyOrder,
} from '../../src/core/runtime/deployment-resource-graph.js';
import { validateDeploymentRevision } from '../../src/core/runtime/deployment-revision.js';
import {
  DeploymentServiceHealthConflictError,
  DeploymentServiceHealthMissingError,
} from '../../src/core/runtime/deployment-service-health-s3.js';

/** @typedef {Record<string, any>} AnyRecord */

const NOW = 1_900_000_000_000;
const APPLICATION_VOLUME_ID = 'vol-00000000000000001';
const CONTROL_VOLUME_ID = 'vol-00000000000000002';
const VPC_ID = 'vpc-00000000000000001';
const INTERNET_GATEWAY_ID = 'igw-00000000000000001';
const SUBNET_ID = 'subnet-00000000000000001';
const ROUTE_TABLE_ID = 'rtb-00000000000000001';
const SECURITY_GROUP_ID = 'sg-00000000000000001';
const RUNTIME_ROLE_ID = 'AROA1234567890EXAMPLE';
const RUNTIME_IDENTITY_ID = 'AIPA1234567890EXAMPLE';
const SUBSTRATE_ID = 'i-00000000000000001';

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

/** @returns {Readonly<AnyRecord>} */
function makeBase() {
  const appId = 'aws-inspection-test';
  const profile = createDeploymentProfile({
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
  const revisionPayload = {
    schemaVersion: 1,
    kind: 'deploymentRevision',
    deployment: { id: 'production' },
    appId,
    revisionId: semanticId('wrv1', 'wharfie:test:aws-inspection-revision:v1', {
      appId,
    }),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'aws inspection test artifact',
    }),
    profileRevisionId: profile.profileRevisionId,
  };
  const deploymentRevision = validateDeploymentRevision({
    ...revisionPayload,
    deploymentRevisionId: semanticId(
      'wdr1',
      'wharfie:deployment-revision:v1',
      revisionPayload,
    ),
  });
  const providerScope = createAwsProviderScope({
    partition: 'aws',
    accountId: '123456789012',
    region: 'us-east-1',
  });
  const providerSpec = createAwsSingleNodeProviderSpec({
    profile,
    providerScope,
    machineImage: {
      sourceParameter: {
        name: AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS.x86_64,
        version: 42,
      },
      imageId: 'ami-0123456789abcdef1',
      ownerAccountId: '137112412989',
      architecture: 'x86_64',
      imageType: 'machine',
      rootDeviceType: 'ebs',
      virtualizationType: 'hvm',
      enaSupport: true,
      rootDeviceName: '/dev/xvda',
      rootBlockDevice: {
        snapshotId: 'snap-0123456789abcdef1',
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
  return Object.freeze({
    profile,
    deploymentRevision,
    providerScope,
    providerSpec,
    deploymentInstanceId: getDeploymentInstanceId({
      deploymentRevision,
      providerScope,
    }),
    incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 73)),
  });
}

/** @param {Readonly<AnyRecord>} base @returns {ReadonlyArray<Readonly<AnyRecord>>} */
function makeTargets(base) {
  return createAwsSingleNodeDesiredResourceTargetCatalog({
    deploymentRevision: base.deploymentRevision,
    profile: base.profile,
    providerScope: base.providerScope,
    providerSpec: base.providerSpec,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    head: null,
  });
}

/** @param {Readonly<AnyRecord>} base @returns {Readonly<AnyRecord>} */
function makeCreatePlan(base) {
  const targets = makeTargets(base);
  return createDeploymentPlan(
    {
      operation: 'apply',
      deploymentRevision: base.deploymentRevision,
      providerScope: base.providerScope,
      providerSpec: base.providerSpec,
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
      basis: {
        headGeneration: 0,
        settledDeploymentRevisionId: null,
        inspectionId: semanticId(
          'win6',
          'wharfie:test:aws-inspection-basis:v1',
          base.deploymentInstanceId,
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
        after: target.target,
      })),
    },
    { profile: base.profile },
  );
}

/**
 * @param {Readonly<AnyRecord>} base
 * @param {{frontier?: number, currentStatus?: 'pending'|'intended'}} [options]
 * @returns {{plan: Readonly<AnyRecord>, head: Readonly<AnyRecord>}}
 */
function makeActiveCreate(base, options = {}) {
  const plan = makeCreatePlan(base);
  const frontier = options.frontier ?? 0;
  const currentStatus = options.currentStatus ?? 'pending';
  const intents = plan.actions.map(
    (
      /** @type {Readonly<AnyRecord>} */ action,
      /** @type {number} */ index,
    ) => ({
      actionId: action.actionId,
      status:
        index < frontier
          ? 'settled'
          : index === frontier
            ? currentStatus
            : 'pending',
      ownershipNonce: nonce(100 + index),
    }),
  );
  const targets = makeTargets(base);
  const bindings =
    frontier === 0
      ? []
      : [
          createDeploymentResourceBinding({
            schemaVersion: 2,
            kind: 'deploymentResourceBinding',
            deploymentInstanceId: base.deploymentInstanceId,
            incarnationId: base.incarnationId,
            resourceKey: targets[0].resourceKey,
            capability: targets[0].capability,
            role: targets[0].role,
            management: 'managed',
            ownershipMode: targets[0].ownershipMode,
            onDestroy: targets[0].onDestroy,
            dependencyBindings: [],
            providerType: targets[0].target.providerType,
            providerResourceId: targets[0].target.providerResourceId,
            providerScopeId: base.providerScope.providerScopeId,
            ownershipNonce: intents[0].ownershipNonce,
            createdByActionId: plan.actions[0].actionId,
          }),
        ];
  const generation = 1 + frontier * 2 + (currentStatus === 'intended' ? 1 : 0);
  const head = createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation,
    phase: 'CONVERGING',
    settledDeploymentRevisionId: null,
    targetDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    resourceBindings: bindings,
    activeOperation: {
      kind: 'create',
      planId: plan.planId,
      status: 'running',
      nextActionIndex: frontier,
      intents,
    },
    lastOperation: null,
  });
  return { plan, head };
}

/** @param {Readonly<AnyRecord>} base @param {string} resourceKey @returns {string} */
function providerResourceId(base, resourceKey) {
  if (resourceKey === 'artifact') {
    return getAwsSingleNodeManagedArtifactObjectLocation({
      providerScope: base.providerScope,
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
    }).arn;
  }
  if (resourceKey === 'application-state') return APPLICATION_VOLUME_ID;
  if (resourceKey === 'control-state') return CONTROL_VOLUME_ID;
  if (resourceKey === 'network-vpc') return VPC_ID;
  if (resourceKey === 'network-internet-gateway') {
    return INTERNET_GATEWAY_ID;
  }
  if (resourceKey === 'network-internet-gateway-attachment') {
    return getAwsSingleNodeInternetGatewayAttachmentProviderResourceId(
      INTERNET_GATEWAY_ID,
      VPC_ID,
    );
  }
  if (resourceKey === 'network-subnet') return SUBNET_ID;
  if (resourceKey === 'network-route-table') return ROUTE_TABLE_ID;
  if (resourceKey === 'network-default-ipv4-route') {
    return getAwsSingleNodeDefaultIpv4RouteProviderResourceId(
      base.providerSpec.capabilities.networking.egressCidr,
      INTERNET_GATEWAY_ID,
      ROUTE_TABLE_ID,
    );
  }
  if (resourceKey === 'network-subnet-route-table-association') {
    return getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId(
      ROUTE_TABLE_ID,
      SUBNET_ID,
    );
  }
  if (resourceKey === 'network-security-group') return SECURITY_GROUP_ID;
  if (resourceKey === 'runtime-role') return RUNTIME_ROLE_ID;
  if (resourceKey === 'runtime-role-policy') {
    return getAwsSingleNodeRuntimePolicyProviderResourceId({
      runtimeRoleId: RUNTIME_ROLE_ID,
    });
  }
  if (resourceKey === 'runtime-identity') return RUNTIME_IDENTITY_ID;
  if (resourceKey === 'runtime-identity-role-association') {
    return getAwsSingleNodeRuntimeAssociationProviderResourceId({
      runtimeRoleId: RUNTIME_ROLE_ID,
      instanceProfileId: RUNTIME_IDENTITY_ID,
    });
  }
  if (resourceKey === 'substrate') return SUBSTRATE_ID;
  if (resourceKey === 'application-state-attachment') {
    return getAwsSingleNodeVolumeAttachmentProviderResourceId(
      base.providerSpec,
      'application-state',
      SUBSTRATE_ID,
      APPLICATION_VOLUME_ID,
    );
  }
  if (resourceKey === 'control-state-attachment') {
    return getAwsSingleNodeVolumeAttachmentProviderResourceId(
      base.providerSpec,
      'control-state',
      SUBSTRATE_ID,
      CONTROL_VOLUME_ID,
    );
  }
  throw new Error(`Unsupported test resource '${resourceKey}'.`);
}

/** @param {Readonly<AnyRecord>} base @param {Readonly<AnyRecord>} plan @param {ReadonlyArray<Readonly<AnyRecord>>} intents @returns {ReadonlyArray<Readonly<AnyRecord>>} */
function makeAllBindings(base, plan, intents) {
  const bindingByKey = new Map();
  return makeTargets(base).map((target, index) => {
    const dependencyBindings = target.dependsOn
      .map((/** @type {string} */ resourceKey) => {
        const dependency = bindingByKey.get(resourceKey);
        if (dependency === undefined) {
          throw new Error(`Missing test dependency '${resourceKey}'.`);
        }
        return { resourceKey, bindingId: dependency.bindingId };
      })
      .sort(
        (
          /** @type {{resourceKey: string}} */ left,
          /** @type {{resourceKey: string}} */ right,
        ) => compareCanonicalStrings(left.resourceKey, right.resourceKey),
      );
    const binding = createDeploymentResourceBinding({
      schemaVersion: 2,
      kind: 'deploymentResourceBinding',
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
      resourceKey: target.resourceKey,
      capability: target.capability,
      role: target.role,
      management: 'managed',
      ownershipMode: target.ownershipMode,
      onDestroy: target.onDestroy,
      dependencyBindings,
      providerType: target.target.providerType,
      providerResourceId: providerResourceId(base, target.resourceKey),
      providerScopeId: base.providerScope.providerScopeId,
      ownershipNonce: intents[index].ownershipNonce,
      createdByActionId: plan.actions[index].actionId,
    });
    bindingByKey.set(target.resourceKey, binding);
    return binding;
  });
}

/** @param {Readonly<AnyRecord>} base @returns {{plan: Readonly<AnyRecord>, head: Readonly<AnyRecord>, bindings: ReadonlyArray<Readonly<AnyRecord>>}} */
function makeReadyCreate(base) {
  const plan = makeCreatePlan(base);
  const intents = plan.actions.map(
    (
      /** @type {Readonly<AnyRecord>} */ action,
      /** @type {number} */ index,
    ) => ({
      actionId: action.actionId,
      status: 'settled',
      ownershipNonce: nonce(100 + index),
    }),
  );
  const bindings = makeAllBindings(base, plan, intents);
  const head = createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: 38,
    phase: 'READY',
    settledDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    resourceBindings: bindings,
    activeOperation: null,
    lastOperation: {
      kind: 'create',
      planId: plan.planId,
      intents,
    },
  });
  return { plan, head, bindings };
}

/** @param {Readonly<AnyRecord>} base @param {ReturnType<typeof makeReadyCreate>} ready @returns {{plan: Readonly<AnyRecord>, head: Readonly<AnyRecord>}} */
function makeSettledDestroy(base, ready) {
  const targets = createAwsSingleNodeDesiredResourceTargetCatalog({
    deploymentRevision: base.deploymentRevision,
    profile: base.profile,
    providerScope: base.providerScope,
    providerSpec: base.providerSpec,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    head: ready.head,
  });
  const targetByKey = new Map(
    targets.map((target) => [target.resourceKey, target]),
  );
  const bindingByKey = new Map(
    ready.bindings.map((binding) => [binding.resourceKey, binding]),
  );
  const plan = createDeploymentPlan(
    {
      operation: 'destroy',
      deploymentRevision: base.deploymentRevision,
      providerScope: base.providerScope,
      providerSpec: base.providerSpec,
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
      basis: {
        headGeneration: ready.head.generation,
        settledDeploymentRevisionId:
          base.deploymentRevision.deploymentRevisionId,
        inspectionId: semanticId(
          'win6',
          'wharfie:test:aws-inspection-destroy-basis:v1',
          ready.head.headId,
        ),
      },
      actions: getAwsSingleNodeResourceDestroyOrder().map((resourceKey) => {
        const target = targetByKey.get(resourceKey);
        const binding = bindingByKey.get(resourceKey);
        if (target === undefined || binding === undefined) {
          throw new Error(`Missing destroy test resource '${resourceKey}'.`);
        }
        const before = {
          providerType: target.target.providerType,
          providerResourceId: binding.providerResourceId,
          stateDigest: target.target.stateDigest,
        };
        const retained = target.onDestroy === 'retain';
        return {
          resourceKey,
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
  const intents = plan.actions.map(
    (/** @type {Readonly<AnyRecord>} */ action) => {
      const binding = bindingByKey.get(action.resourceKey);
      if (binding === undefined) {
        throw new Error(
          `Missing destroy intent binding '${action.resourceKey}'.`,
        );
      }
      return {
        actionId: action.actionId,
        status: 'settled',
        ownershipNonce: binding.ownershipNonce,
      };
    },
  );
  const retainedBindings = ready.bindings.filter(
    (binding) => binding.onDestroy === 'retain',
  );
  const head = createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: ready.head.generation + 37,
    phase: 'DESTROYING',
    settledDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId: null,
    resourceBindings: retainedBindings,
    activeOperation: {
      kind: 'destroy',
      planId: plan.planId,
      status: 'running',
      nextActionIndex: plan.actions.length,
      intents,
    },
    lastOperation: ready.head.lastOperation,
  });
  return { plan, head };
}

/** @param {Readonly<AnyRecord>} base @param {Readonly<AnyRecord>|null} head @param {Readonly<AnyRecord>|null} plan @param {Readonly<AnyRecord>|null} [pendingBinding] @returns {AnyRecord} */
function inspectionContext(base, head, plan, pendingBinding = null) {
  return {
    operation: 'apply',
    deploymentRevision: base.deploymentRevision,
    profile: base.profile,
    providerScope: base.providerScope,
    providerSpec: base.providerSpec,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    head,
    plan,
    settledPlan: null,
    pendingBinding,
  };
}

/** @param {string} resourceKey @returns {AnyRecord} */
function absentObservation(resourceKey) {
  return {
    resourceKey,
    presence: 'absent',
    ownership: 'missing',
    providerIdentity: null,
    observedDigest: null,
    health: 'absent',
    execution: 'none',
  };
}

/** @param {Readonly<AnyRecord>} authority @returns {AnyRecord} */
function conflictObservation(authority) {
  return {
    resourceKey: authority.target.resourceKey,
    presence: 'present',
    ownership: 'conflict',
    providerIdentity: {
      providerType: authority.target.target.providerType,
      providerResourceId:
        authority.target.target.providerResourceId ??
        'provider-resource-conflict',
    },
    observedDigest: null,
    health:
      authority.target.resourceKey === 'substrate'
        ? 'unknown'
        : 'not-applicable',
    execution: 'none',
  };
}

/** @param {Readonly<AnyRecord>} authority @returns {AnyRecord} */
function exactPresentObservation(authority) {
  const binding = authority.binding;
  if (binding === null) {
    throw new Error(
      `Missing exact test binding '${authority.target.resourceKey}'.`,
    );
  }
  return {
    resourceKey: authority.target.resourceKey,
    presence: 'present',
    ownership:
      authority.target.management === 'managed' ? 'verified' : 'external',
    providerIdentity: {
      providerType: binding.providerType,
      providerResourceId: binding.providerResourceId,
    },
    observedDigest: authority.target.target.stateDigest,
    health:
      authority.target.resourceKey === 'substrate'
        ? 'degraded'
        : 'not-applicable',
    execution: 'none',
  };
}

/** @param {Readonly<AnyRecord>} inspection @param {string} resourceKey @returns {Readonly<AnyRecord>} */
function inspectionResource(inspection, resourceKey) {
  const resource = inspection.resources.find(
    (/** @type {Readonly<AnyRecord>} */ candidate) =>
      candidate.resourceKey === resourceKey,
  );
  if (resource === undefined) {
    throw new Error(`Missing inspection resource '${resourceKey}'.`);
  }
  return resource;
}

/** @param {ReadonlyArray<Readonly<AnyRecord>>} bindings @param {string} resourceKey @returns {Readonly<AnyRecord>} */
function bindingFor(bindings, resourceKey) {
  const binding = bindings.find(
    (candidate) => candidate.resourceKey === resourceKey,
  );
  if (binding === undefined) {
    throw new Error(`Missing test binding '${resourceKey}'.`);
  }
  return binding;
}

/** @param {Readonly<AnyRecord>} base @param {(authority: Readonly<AnyRecord>) => AnyRecord|Promise<AnyRecord>} observe @param {(context: Readonly<AnyRecord>) => AnyRecord|Promise<AnyRecord>} [inspectServiceHealth] */
function makeProvider(
  base,
  observe,
  inspectServiceHealth = async (context) => {
    if (context === null) {
      throw new TypeError('test service-health context must be non-null');
    }
    throw new DeploymentServiceHealthMissingError();
  },
) {
  const observeResource = jest.fn(observe);
  const inspectHealth = jest.fn(inspectServiceHealth);
  const now = jest.fn(() => NOW);
  const provider = createAwsSingleNodeDeploymentInspectionProvider({
    resourceObservationRouter: { observeResource },
    serviceHealth: { inspect: inspectHealth },
    now,
  });
  return { provider, observeResource, inspectHealth, now, base };
}

/** @param {Readonly<AnyRecord>} base @param {Readonly<AnyRecord>} state @returns {Readonly<AnyRecord>} */
function makeApplicationPendingBinding(base, state) {
  const target = makeTargets(base)[1];
  const action = state.plan.actions[1];
  const intent = state.head.activeOperation.intents[1];
  return createDeploymentResourceBinding({
    schemaVersion: 2,
    kind: 'deploymentResourceBinding',
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    resourceKey: target.resourceKey,
    capability: target.capability,
    role: target.role,
    management: 'managed',
    ownershipMode: target.ownershipMode,
    onDestroy: target.onDestroy,
    dependencyBindings: [],
    providerType: target.target.providerType,
    providerResourceId: APPLICATION_VOLUME_ID,
    providerScopeId: base.providerScope.providerScopeId,
    ownershipNonce: intent.ownershipNonce,
    createdByActionId: action.actionId,
  });
}

describe('AWS single-node aggregate InspectionV6 provider', () => {
  it('preserves the original receiver for delegated read ports', async () => {
    const base = makeBase();
    const state = makeReadyCreate(base);
    let observationCalls = 0;
    let healthCalls = 0;
    /** @type {AnyRecord} */
    const resourceObservationRouter = {
      observeResource(/** @type {Readonly<AnyRecord>} */ authority) {
        if (this !== resourceObservationRouter) {
          throw new Error('resource observation receiver changed');
        }
        observationCalls += 1;
        return exactPresentObservation(authority);
      },
    };
    /** @type {AnyRecord} */
    const serviceHealth = {
      inspect() {
        if (this !== serviceHealth) {
          throw new Error('service health receiver changed');
        }
        healthCalls += 1;
        throw new DeploymentServiceHealthMissingError();
      },
    };
    const provider = createAwsSingleNodeDeploymentInspectionProvider({
      resourceObservationRouter,
      serviceHealth,
      now: () => NOW,
    });

    await provider.inspect({
      ...inspectionContext(base, state.head, null),
      settledPlan: state.plan,
    });

    expect(observationCalls).toBe(18);
    expect(healthCalls).toBe(1);
    expect(Object.isFrozen(provider)).toBe(true);
  });

  it('returns authoritative absence for a null head without provider I/O', async () => {
    const base = makeBase();
    const harness = makeProvider(base, (authority) =>
      absentObservation(authority.target.resourceKey),
    );

    const inspection = await harness.provider.inspect(
      inspectionContext(base, null, null),
    );

    expect(inspection).toMatchObject({
      schemaVersion: 6,
      kind: 'deploymentInspection',
      controlState: {
        status: 'absent',
        evidence: 'authoritative-not-found',
      },
      incarnationId: null,
      headGeneration: 0,
      status: 'absent',
      resources: [],
    });
    expect(harness.observeResource).not.toHaveBeenCalled();
    expect(harness.inspectHealth).not.toHaveBeenCalled();
  });

  it('fences and routes all 18 resources exactly once in apply order', async () => {
    const base = makeBase();
    const state = makeActiveCreate(base);
    const harness = makeProvider(base, (authority) =>
      absentObservation(authority.target.resourceKey),
    );

    const inspection = await harness.provider.inspect(
      inspectionContext(base, state.head, state.plan),
    );

    expect(harness.observeResource).toHaveBeenCalledTimes(18);
    expect(
      harness.observeResource.mock.calls.map(
        ([authority]) => authority.target.resourceKey,
      ),
    ).toEqual(getAwsSingleNodeResourceApplyOrder());
    expect(
      inspection.resources.map(
        (/** @type {Readonly<AnyRecord>} */ resource) => resource.resourceKey,
      ),
    ).toEqual(getAwsSingleNodeResourceApplyOrder());
    expect(
      inspection.resources.every(
        (/** @type {Readonly<AnyRecord>} */ resource) =>
          resource.execution === 'none',
      ),
    ).toBe(true);
    expect(inspection.status).toBe('in-flight');
    expect(harness.inspectHealth).not.toHaveBeenCalled();
  });

  it('keeps a non-final active frontier in-flight when a future role is unknown', async () => {
    const base = makeBase();
    const state = makeActiveCreate(base);
    const harness = makeProvider(base, (authority) =>
      authority.target.resourceKey === 'substrate'
        ? {
            ...absentObservation('substrate'),
            presence: 'unknown',
            ownership: 'unknown',
            health: 'unknown',
          }
        : absentObservation(authority.target.resourceKey),
    );

    const inspection = await harness.provider.inspect(
      inspectionContext(base, state.head, state.plan),
    );

    expect(inspection.status).toBe('in-flight');
    expect(inspectionResource(inspection, 'artifact')).toMatchObject({
      presence: 'absent',
      ownership: 'missing',
    });
    expect(inspectionResource(inspection, 'substrate')).toMatchObject({
      presence: 'unknown',
      ownership: 'unknown',
    });
  });

  it('maps resident health conflict to unknown health without inventing ownership conflict', async () => {
    const base = makeBase();
    const ready = makeReadyCreate(base);
    const harness = makeProvider(base, exactPresentObservation, async () => {
      throw new DeploymentServiceHealthConflictError();
    });
    const context = {
      ...inspectionContext(base, ready.head, null),
      settledPlan: ready.plan,
    };

    const inspection = await harness.provider.inspect(context);
    const substrate = inspectionResource(inspection, 'substrate');

    expect(harness.inspectHealth).toHaveBeenCalledTimes(1);
    expect(Object.keys(harness.inspectHealth.mock.calls[0][0])).toEqual([
      'deploymentRevision',
      'profile',
      'providerScope',
      'providerSpec',
      'head',
    ]);
    expect(substrate).toMatchObject({
      presence: 'present',
      ownership: 'verified',
      bindingId: bindingFor(ready.bindings, 'substrate').bindingId,
      health: 'unknown',
      service: null,
    });
    expect(inspection.status).toBe('in-flight');
  });

  it('does not read resident health without exact projected runtime-role evidence', async () => {
    const base = makeBase();
    const ready = makeReadyCreate(base);
    const harness = makeProvider(base, (authority) =>
      authority.target.resourceKey === 'runtime-role'
        ? conflictObservation(authority)
        : exactPresentObservation(authority),
    );
    const context = {
      ...inspectionContext(base, ready.head, null),
      settledPlan: ready.plan,
    };

    const inspection = await harness.provider.inspect(context);

    expect(inspection.status).toBe('conflict');
    expect(harness.inspectHealth).not.toHaveBeenCalled();
  });

  it.each(['stopped', 'failed'])(
    'lets current substrate lifecycle %s dominate any older service receipt',
    async (health) => {
      const base = makeBase();
      const ready = makeReadyCreate(base);
      const harness = makeProvider(
        base,
        (authority) => {
          const observation = exactPresentObservation(authority);
          return authority.target.resourceKey === 'substrate'
            ? { ...observation, health }
            : observation;
        },
        async () => {
          throw new Error('service health must not be read');
        },
      );
      const context = {
        ...inspectionContext(base, ready.head, null),
        settledPlan: ready.plan,
      };

      const inspection = await harness.provider.inspect(context);

      expect(inspection.status).toBe('degraded');
      expect(inspectionResource(inspection, 'substrate').health).toBe(health);
      expect(harness.inspectHealth).not.toHaveBeenCalled();
    },
  );

  it('derives destroyed from a fully settled active destroy frontier', async () => {
    const base = makeBase();
    const ready = makeReadyCreate(base);
    const destroyed = makeSettledDestroy(base, ready);
    const harness = makeProvider(base, (authority) =>
      authority.target.onDestroy === 'retain'
        ? exactPresentObservation(authority)
        : absentObservation(authority.target.resourceKey),
    );
    const context = {
      ...inspectionContext(base, destroyed.head, destroyed.plan),
      operation: 'destroy',
      settledPlan: ready.plan,
    };

    const inspection = await harness.provider.inspect(context);

    expect(inspection.status).toBe('destroyed');
    expect(
      inspection.resources
        .filter(
          (/** @type {Readonly<AnyRecord>} */ resource) =>
            resource.onDestroy === 'retain',
        )
        .every(
          (/** @type {Readonly<AnyRecord>} */ resource) =>
            resource.presence === 'present' &&
            resource.ownership === 'verified' &&
            resource.bindingId !== null,
        ),
    ).toBe(true);
    expect(
      inspection.resources
        .filter(
          (/** @type {Readonly<AnyRecord>} */ resource) =>
            resource.onDestroy === 'purge',
        )
        .every(
          (/** @type {Readonly<AnyRecord>} */ resource) =>
            resource.presence === 'absent' &&
            resource.ownership === 'missing' &&
            resource.bindingId === null,
        ),
    ).toBe(true);
    expect(harness.inspectHealth).not.toHaveBeenCalled();
  });

  it('preserves exact current stable-token create replay advice', async () => {
    const base = makeBase();
    const state = makeActiveCreate(base, {
      frontier: 1,
      currentStatus: 'intended',
    });
    const harness = makeProvider(base, (authority) =>
      authority.target.resourceKey === 'application-state'
        ? {
            ...absentObservation('application-state'),
            presence: 'unknown',
            ownership: 'unknown',
            health: 'unknown',
            execution: 'replay-safe-create',
          }
        : absentObservation(authority.target.resourceKey),
    );

    const inspection = await harness.provider.inspect(
      inspectionContext(base, state.head, state.plan),
    );

    expect(inspection.status).toBe('in-flight');
    expect(inspectionResource(inspection, 'application-state').execution).toBe(
      'replay-safe-create',
    );
  });

  it('lets conflict dominate and suppress every replay recommendation', async () => {
    const base = makeBase();
    const state = makeActiveCreate(base, {
      frontier: 1,
      currentStatus: 'intended',
    });
    const harness = makeProvider(base, (authority) => {
      if (authority.target.resourceKey === 'artifact') {
        return conflictObservation(authority);
      }
      if (authority.target.resourceKey === 'application-state') {
        return {
          ...absentObservation('application-state'),
          presence: 'unknown',
          ownership: 'unknown',
          health: 'unknown',
          execution: 'replay-safe-create',
        };
      }
      return absentObservation(authority.target.resourceKey);
    });

    const inspection = await harness.provider.inspect(
      inspectionContext(base, state.head, state.plan),
    );

    expect(inspection.status).toBe('conflict');
    expect(
      inspection.resources.every(
        (/** @type {Readonly<AnyRecord>} */ resource) =>
          resource.execution === 'none',
      ),
    ).toBe(true);
  });

  it('projects one exact nonserialized pending binding into observed lineage', async () => {
    const base = makeBase();
    const state = makeActiveCreate(base, {
      frontier: 1,
      currentStatus: 'intended',
    });
    const pendingBinding = makeApplicationPendingBinding(base, state);
    const harness = makeProvider(base, (authority) => {
      if (authority.target.resourceKey !== 'application-state') {
        return absentObservation(authority.target.resourceKey);
      }
      return {
        resourceKey: 'application-state',
        presence: 'present',
        ownership: 'verified',
        providerIdentity: {
          providerType: 'ebs-volume',
          providerResourceId: APPLICATION_VOLUME_ID,
        },
        observedDigest: authority.target.target.stateDigest,
        health: 'not-applicable',
        execution: 'none',
      };
    });

    const inspection = await harness.provider.inspect(
      inspectionContext(base, state.head, state.plan, pendingBinding),
    );
    const applicationState = inspectionResource(
      inspection,
      'application-state',
    );

    expect(applicationState).toMatchObject({
      ownership: 'verified',
      bindingId: pendingBinding.bindingId,
      dependencyBindings: [],
    });
  });

  it('suppresses replay advice after a pending binding exists', async () => {
    const base = makeBase();
    const state = makeActiveCreate(base, {
      frontier: 1,
      currentStatus: 'intended',
    });
    const pendingBinding = makeApplicationPendingBinding(base, state);
    const harness = makeProvider(base, (authority) =>
      authority.target.resourceKey === 'application-state'
        ? {
            ...absentObservation('application-state'),
            presence: 'unknown',
            ownership: 'unknown',
            health: 'unknown',
            execution: 'replay-safe-create',
          }
        : absentObservation(authority.target.resourceKey),
    );

    const inspection = await harness.provider.inspect(
      inspectionContext(base, state.head, state.plan, pendingBinding),
    );

    expect(
      inspection.resources.every(
        (/** @type {Readonly<AnyRecord>} */ resource) =>
          resource.execution === 'none',
      ),
    ).toBe(true);
  });

  it('rejects malformed context before clock or provider side effects', async () => {
    const base = makeBase();
    const state = makeActiveCreate(base);
    const harness = makeProvider(base, (authority) =>
      absentObservation(authority.target.resourceKey),
    );
    const malformed = {
      ...inspectionContext(base, state.head, state.plan),
      unexpected: true,
    };

    await expect(harness.provider.inspect(malformed)).rejects.toThrow(
      'unexpected is not supported',
    );
    expect(harness.now).not.toHaveBeenCalled();
    expect(harness.observeResource).not.toHaveBeenCalled();
    expect(harness.inspectHealth).not.toHaveBeenCalled();
  });

  it('revalidates every routed raw observation against its exact target', async () => {
    const base = makeBase();
    const state = makeActiveCreate(base);
    const harness = makeProvider(base, () =>
      absentObservation('control-state'),
    );

    await expect(
      harness.provider.inspect(inspectionContext(base, state.head, state.plan)),
    ).rejects.toThrow(
      'resourceKey does not match its exact routed resource key',
    );
  });

  it('is deterministic for identical authority and provider evidence', async () => {
    const base = makeBase();
    const state = makeActiveCreate(base);
    const harness = makeProvider(base, (authority) =>
      absentObservation(authority.target.resourceKey),
    );
    const context = inspectionContext(base, state.head, state.plan);

    const first = await harness.provider.inspect(context);
    const second = await harness.provider.inspect(clone(context));

    expect(second).toEqual(first);
    expect(second.inspectionId).toBe(first.inspectionId);
  });
});
