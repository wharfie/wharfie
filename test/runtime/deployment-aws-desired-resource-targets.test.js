import { describe, expect, it } from '@jest/globals';

import { compareCanonicalStrings } from '../../src/core/runtime/canonical-order.js';
import {
  createCanonicalJsonSha256Id,
  createSha256Id,
} from '../../src/core/runtime/content-id.js';
import {
  getAwsSingleNodeDefaultIpv4RouteProviderResourceId,
  getAwsSingleNodeDefaultIpv4RouteStateDigest,
} from '../../src/core/runtime/deployment-aws-default-ipv4-route-resource.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from '../../src/core/runtime/deployment-aws-desired-resource-targets.js';
import {
  getAwsSingleNodeInternetGatewayAttachmentProviderResourceId,
  getAwsSingleNodeInternetGatewayAttachmentStateDigest,
} from '../../src/core/runtime/deployment-aws-internet-gateway-attachment-resource.js';
import { getAwsSingleNodeInternetGatewayStateDigest } from '../../src/core/runtime/deployment-aws-internet-gateway-resource.js';
import { getAwsSingleNodeManagedArtifactStateDigest } from '../../src/core/runtime/deployment-aws-managed-artifact-resource.js';
import { getAwsSingleNodeNodeStateDigest } from '../../src/core/runtime/deployment-aws-node-resource.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import { getAwsSingleNodeRouteTableStateDigest } from '../../src/core/runtime/deployment-aws-route-table-resource.js';
import {
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimeAssociationProviderResourceId,
  getAwsSingleNodeRuntimeAssociationStateDigest,
  getAwsSingleNodeRuntimeInstanceProfileStateDigest,
  getAwsSingleNodeRuntimePolicyProviderResourceId,
  getAwsSingleNodeRuntimePolicyStateDigest,
  getAwsSingleNodeRuntimeRoleStateDigest,
} from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
import { getAwsSingleNodeSecurityGroupStateDigest } from '../../src/core/runtime/deployment-aws-security-group-resource.js';
import {
  getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId,
  getAwsSingleNodeSubnetRouteTableAssociationStateDigest,
} from '../../src/core/runtime/deployment-aws-subnet-route-table-association-resource.js';
import { getAwsSingleNodeSubnetStateDigest } from '../../src/core/runtime/deployment-aws-subnet-resource.js';
import {
  getAwsSingleNodeVolumeAttachmentProviderResourceId,
  getAwsSingleNodeVolumeAttachmentStateDigest,
} from '../../src/core/runtime/deployment-aws-volume-attachment-resource.js';
import { getAwsSingleNodeVolumeStateDigest } from '../../src/core/runtime/deployment-aws-volume-resource.js';
import { getAwsSingleNodeVpcStateDigest } from '../../src/core/runtime/deployment-aws-vpc-resource.js';
import { createDeploymentHead } from '../../src/core/runtime/deployment-head.js';
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
import { AWS_SINGLE_NODE_RESOURCE_GRAPH } from '../../src/core/runtime/deployment-resource-graph.js';
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

/** @param {any} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

/** @param {Readonly<AnyRecord>} base @returns {Readonly<AnyRecord>} */
function nameAuthority(base) {
  return Object.freeze({
    providerScopeId: base.providerScope.providerScopeId,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
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

/** @returns {Readonly<AnyRecord>} */
function makeBase() {
  const profile = createDeploymentProfile({
    profile: { id: 'production' },
    appId: 'desired-resource-targets-test',
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
    appId: profile.appId,
    revisionId: semanticId(
      'wrv1',
      'wharfie:test:desired-resource-targets-revision:v1',
      { revision: 1 },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'desired resource targets artifact',
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
  const deploymentInstanceId = getDeploymentInstanceId({
    deploymentRevision,
    providerScope,
  });
  return Object.freeze({
    profile,
    deploymentRevision,
    providerScope,
    providerSpec,
    deploymentInstanceId,
    incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 77)),
  });
}

/** @param {Readonly<AnyRecord>} base @param {string} resourceKey @returns {Readonly<AnyRecord>} */
function desiredDigest(base, resourceKey) {
  switch (resourceKey) {
    case 'artifact':
      return getAwsSingleNodeManagedArtifactStateDigest({
        deploymentRevision: base.deploymentRevision,
        profile: base.profile,
        providerScope: base.providerScope,
        providerSpec: base.providerSpec,
        deploymentInstanceId: base.deploymentInstanceId,
        incarnationId: base.incarnationId,
      });
    case 'application-state':
    case 'control-state':
      return getAwsSingleNodeVolumeStateDigest(base.providerSpec, resourceKey);
    case 'network-vpc':
      return getAwsSingleNodeVpcStateDigest(base.providerSpec);
    case 'network-internet-gateway':
      return getAwsSingleNodeInternetGatewayStateDigest(base.providerSpec);
    case 'network-internet-gateway-attachment':
      return getAwsSingleNodeInternetGatewayAttachmentStateDigest(
        base.providerSpec,
      );
    case 'network-subnet':
      return getAwsSingleNodeSubnetStateDigest(base.providerSpec);
    case 'network-route-table':
      return getAwsSingleNodeRouteTableStateDigest(base.providerSpec);
    case 'network-default-ipv4-route':
      return getAwsSingleNodeDefaultIpv4RouteStateDigest(base.providerSpec);
    case 'network-subnet-route-table-association':
      return getAwsSingleNodeSubnetRouteTableAssociationStateDigest(
        base.providerSpec,
      );
    case 'network-security-group':
      return getAwsSingleNodeSecurityGroupStateDigest(base.providerSpec);
    case 'runtime-role':
      return getAwsSingleNodeRuntimeRoleStateDigest(nameAuthority(base));
    case 'runtime-role-policy':
      return getAwsSingleNodeRuntimePolicyStateDigest(policyAuthority(base));
    case 'runtime-identity':
      return getAwsSingleNodeRuntimeInstanceProfileStateDigest(
        nameAuthority(base),
      );
    case 'runtime-identity-role-association':
      return getAwsSingleNodeRuntimeAssociationStateDigest(nameAuthority(base));
    case 'substrate':
      return getAwsSingleNodeNodeStateDigest(
        base.providerSpec,
        nameAuthority(base),
      );
    case 'application-state-attachment':
      return getAwsSingleNodeVolumeAttachmentStateDigest(
        base.providerSpec,
        'application-state',
      );
    case 'control-state-attachment':
      return getAwsSingleNodeVolumeAttachmentStateDigest(
        base.providerSpec,
        'control-state',
      );
    default:
      throw new Error(`Unsupported desired digest '${resourceKey}'.`);
  }
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
      throw new Error(`Unsupported provider resource '${resourceKey}'.`);
  }
}

/**
 * @param {Readonly<AnyRecord>} base
 * @param {{omit?: ReadonlySet<string>, overrides?: Readonly<Record<string, Readonly<AnyRecord>>>}} [options]
 * @returns {Readonly<AnyRecord>[]}
 */
function makeBindings(base, options = {}) {
  const omit = options.omit ?? new Set();
  const overrides = options.overrides ?? {};
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
    const override = overrides[definition.resourceKey] ?? {};
    const dependencyKeys = override.dependencyKeys ?? definition.dependsOn;
    const dependencyBindings = dependencyKeys
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
    const management = override.management ?? 'managed';
    const binding = createDeploymentResourceBinding({
      schemaVersion: 2,
      kind: 'deploymentResourceBinding',
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
      resourceKey: definition.resourceKey,
      capability: override.capability ?? definition.capability,
      role: override.role ?? definition.role,
      management,
      ownershipMode:
        override.ownershipMode ??
        (management === 'managed' ? definition.ownershipMode : 'external'),
      onDestroy: override.onDestroy ?? definition.onDestroy,
      dependencyBindings: management === 'managed' ? dependencyBindings : [],
      providerType: override.providerType ?? definition.providerType,
      providerResourceId:
        override.providerResourceId ??
        providerResourceId(base, definition.resourceKey),
      providerScopeId: base.providerScope.providerScopeId,
      ...(management === 'managed'
        ? {
            ownershipNonce: nonce(index + 1),
            createdByActionId: semanticId(
              'wda3',
              'wharfie:test:desired-resource-target-binding-action:v1',
              { resourceKey: definition.resourceKey },
            ),
          }
        : {}),
    });
    bindingByKey.set(definition.resourceKey, binding);
    bindings.push(binding);
  }
  return bindings;
}

/** @param {Readonly<AnyRecord>} base @param {Readonly<AnyRecord>[]} bindings @param {Readonly<AnyRecord>} [overrides] */
function makeReadyHead(base, bindings, overrides = {}) {
  const managed = bindings.filter(
    (binding) => binding.management === 'managed',
  );
  return createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: 7,
    phase: 'READY',
    settledDeploymentRevisionId:
      overrides.deploymentRevisionId ??
      base.deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId:
      overrides.deploymentRevisionId ??
      base.deploymentRevision.deploymentRevisionId,
    resourceBindings: bindings,
    activeOperation: null,
    lastOperation: {
      kind: 'create',
      planId: semanticId(
        'wpl3',
        'wharfie:test:desired-resource-target-head-plan:v1',
        { bindingIds: managed.map((binding) => binding.bindingId) },
      ),
      intents: managed.map((binding) => ({
        actionId: binding.createdByActionId,
        status: 'settled',
        ownershipNonce: binding.ownershipNonce,
      })),
    },
  });
}

/**
 * @param {Readonly<AnyRecord>} base
 * @param {Readonly<AnyRecord>[]} bindings
 * @param {{settledDeploymentRevisionId: string, targetDeploymentRevisionId: string}} revisions
 */
function makeConvergingHead(base, bindings, revisions) {
  const managed = bindings.filter(
    (binding) => binding.management === 'managed',
  );
  return createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: 8,
    phase: 'CONVERGING',
    settledDeploymentRevisionId: revisions.settledDeploymentRevisionId,
    targetDeploymentRevisionId: revisions.targetDeploymentRevisionId,
    resourceBindings: bindings,
    activeOperation: {
      kind: 'update',
      planId: semanticId(
        'wpl3',
        'wharfie:test:desired-resource-target-converging-plan:v1',
        revisions,
      ),
      status: 'running',
      nextActionIndex: 0,
      intents: [
        {
          actionId: semanticId(
            'wda3',
            'wharfie:test:desired-resource-target-converging-action:v1',
            revisions,
          ),
          status: 'pending',
          ownershipNonce: null,
        },
      ],
    },
    lastOperation: {
      kind: 'create',
      planId: semanticId(
        'wpl3',
        'wharfie:test:desired-resource-target-head-plan:v1',
        { bindingIds: managed.map((binding) => binding.bindingId) },
      ),
      intents: managed.map((binding) => ({
        actionId: binding.createdByActionId,
        status: 'settled',
        ownershipNonce: binding.ownershipNonce,
      })),
    },
  });
}

/**
 * @param {Readonly<AnyRecord>} base
 * @param {Readonly<AnyRecord>[]} bindings
 * @param {string} settledDeploymentRevisionId
 */
function makeDestroyingHead(base, bindings, settledDeploymentRevisionId) {
  const managed = bindings.filter(
    (binding) => binding.management === 'managed',
  );
  return createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: 9,
    phase: 'DESTROYING',
    settledDeploymentRevisionId,
    targetDeploymentRevisionId: null,
    resourceBindings: bindings,
    activeOperation: {
      kind: 'destroy',
      planId: semanticId(
        'wpl3',
        'wharfie:test:desired-resource-target-destroying-plan:v1',
        { settledDeploymentRevisionId },
      ),
      status: 'running',
      nextActionIndex: 0,
      intents: [
        {
          actionId: semanticId(
            'wda3',
            'wharfie:test:desired-resource-target-destroying-action:v1',
            { settledDeploymentRevisionId },
          ),
          status: 'pending',
          ownershipNonce: null,
        },
      ],
    },
    lastOperation: {
      kind: 'create',
      planId: semanticId(
        'wpl3',
        'wharfie:test:desired-resource-target-head-plan:v1',
        { bindingIds: managed.map((binding) => binding.bindingId) },
      ),
      intents: managed.map((binding) => ({
        actionId: binding.createdByActionId,
        status: 'settled',
        ownershipNonce: binding.ownershipNonce,
      })),
    },
  });
}

/** @param {Readonly<AnyRecord>} base @param {Readonly<AnyRecord>|null} head @param {Readonly<AnyRecord>} [overrides] */
function catalogOptions(base, head, overrides = {}) {
  return {
    deploymentRevision: base.deploymentRevision,
    profile: base.profile,
    providerScope: base.providerScope,
    providerSpec: base.providerSpec,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    head,
    ...overrides,
  };
}

/** @param {Readonly<AnyRecord>} base @param {Readonly<AnyRecord>[]} [bindings] */
function makeDestroyedHead(base, bindings = []) {
  return createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: 9,
    phase: 'DESTROYED',
    settledDeploymentRevisionId: null,
    targetDeploymentRevisionId: null,
    resourceBindings: bindings,
    activeOperation: null,
    lastOperation: {
      kind: 'destroy',
      planId: semanticId(
        'wpl3',
        'wharfie:test:desired-resource-target-destroy-plan:v1',
        { incarnationId: base.incarnationId, bindings: bindings.length },
      ),
      intents: [
        {
          actionId: semanticId(
            'wda3',
            'wharfie:test:desired-resource-target-destroy-action:v1',
            { incarnationId: base.incarnationId },
          ),
          status: 'settled',
          ownershipNonce: nonce(250),
        },
      ],
    },
  });
}

/** @param {string} value @returns {string} */
function differentSemanticId(value) {
  const final = value.at(-1);
  return `${value.slice(0, -1)}${final === 'A' ? 'B' : 'A'}`;
}

/** @param {ReadonlyArray<Readonly<AnyRecord>>} catalog @param {string} resourceKey @returns {Readonly<AnyRecord>} */
function catalogEntry(catalog, resourceKey) {
  const entry = catalog.find(
    (candidate) => candidate.resourceKey === resourceKey,
  );
  if (entry === undefined) {
    throw new Error(`Missing fixture catalog entry '${resourceKey}'.`);
  }
  return entry;
}

describe('AWS single-node desired resource targets', () => {
  it('creates one exact deeply frozen apply-order catalog with byte-deterministic targets', () => {
    const base = makeBase();
    const head = makeReadyHead(base, makeBindings(base));
    const first = createAwsSingleNodeDesiredResourceTargetCatalog(
      catalogOptions(base, head),
    );
    const second = createAwsSingleNodeDesiredResourceTargetCatalog(
      clone(catalogOptions(base, head)),
    );

    expect(first).toHaveLength(18);
    expect(first).toEqual(
      AWS_SINGLE_NODE_RESOURCE_GRAPH.resources.map(
        (/** @type {Readonly<AnyRecord>} */ definition) => ({
          resourceKey: definition.resourceKey,
          capability: definition.capability,
          role: definition.role,
          management: 'managed',
          ownershipMode: definition.ownershipMode,
          dependsOn: definition.dependsOn,
          onDestroy: definition.onDestroy,
          target: {
            providerType: definition.providerType,
            providerResourceId: providerResourceId(
              base,
              definition.resourceKey,
            ),
            stateDigest: desiredDigest(base, definition.resourceKey),
          },
        }),
      ),
    );
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expectDeepFrozen(first);
  });

  it('uses the deterministic managed artifact ARN and no speculative provider IDs without a head', () => {
    const base = makeBase();
    const catalog = createAwsSingleNodeDesiredResourceTargetCatalog(
      catalogOptions(base, null),
    );

    expect(catalog[0].target.providerResourceId).toBe(
      getAwsSingleNodeManagedArtifactObjectLocation(policyAuthority(base)).arn,
    );
    expect(
      catalog.slice(1).map((entry) => entry.target.providerResourceId),
    ).toEqual(Array(17).fill(null));
  });

  it('does not synthesize a missing derived binding from bound dependencies', () => {
    const base = makeBase();
    const bindings = makeBindings(base, {
      omit: new Set(['application-state-attachment']),
    });
    const catalog = createAwsSingleNodeDesiredResourceTargetCatalog(
      catalogOptions(base, makeReadyHead(base, bindings)),
    );

    expect(
      catalogEntry(catalog, 'application-state-attachment').target
        .providerResourceId,
    ).toBeNull();
    expect(
      catalogEntry(catalog, 'application-state').target.providerResourceId,
    ).toBe(IDS.applicationVolume);
    expect(catalogEntry(catalog, 'substrate').target.providerResourceId).toBe(
      IDS.substrate,
    );
  });

  it('projects same and fresh incarnations from an empty destroyed tombstone but blocks fresh projection over retained bindings', () => {
    const oldBase = makeBase();
    const nextBase = Object.freeze({
      ...oldBase,
      incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 78)),
    });
    const emptyDestroyed = makeDestroyedHead(oldBase);

    expect(
      createAwsSingleNodeDesiredResourceTargetCatalog(
        catalogOptions(oldBase, emptyDestroyed),
      ).map((entry) => entry.target.providerResourceId),
    ).toEqual([
      getAwsSingleNodeManagedArtifactObjectLocation(policyAuthority(oldBase))
        .arn,
      ...Array(17).fill(null),
    ]);

    expect(
      createAwsSingleNodeDesiredResourceTargetCatalog(
        catalogOptions(nextBase, emptyDestroyed),
      ).map((entry) => entry.target.providerResourceId),
    ).toEqual([
      getAwsSingleNodeManagedArtifactObjectLocation(policyAuthority(nextBase))
        .arn,
      ...Array(17).fill(null),
    ]);

    const ready = makeReadyHead(oldBase, makeBindings(oldBase));
    expect(() =>
      createAwsSingleNodeDesiredResourceTargetCatalog(
        catalogOptions(nextBase, ready),
      ),
    ).toThrow(/incarnation/i);

    const retained = makeBindings(oldBase).filter(
      (binding) => binding.onDestroy === 'retain',
    );
    expect(() =>
      createAwsSingleNodeDesiredResourceTargetCatalog(
        catalogOptions(nextBase, makeDestroyedHead(oldBase, retained)),
      ),
    ).toThrow(/incarnation|empty|binding/i);
  });

  it('uses the target revision as CONVERGING authority', () => {
    const base = makeBase();
    const bindings = makeBindings(base);
    const currentRevisionId = base.deploymentRevision.deploymentRevisionId;
    const otherRevisionId = semanticId(
      'wdr1',
      'wharfie:test:other-converging-deployment-revision:v1',
      { revision: 2 },
    );

    const currentTarget = makeConvergingHead(base, bindings, {
      settledDeploymentRevisionId: otherRevisionId,
      targetDeploymentRevisionId: currentRevisionId,
    });
    expect(
      createAwsSingleNodeDesiredResourceTargetCatalog(
        catalogOptions(base, currentTarget),
      ),
    ).toHaveLength(18);

    const otherTarget = makeConvergingHead(base, bindings, {
      settledDeploymentRevisionId: currentRevisionId,
      targetDeploymentRevisionId: otherRevisionId,
    });
    expect(() =>
      createAwsSingleNodeDesiredResourceTargetCatalog(
        catalogOptions(base, otherTarget),
      ),
    ).toThrow(/revision/i);
  });

  it('uses the settled revision as DESTROYING authority', () => {
    const base = makeBase();
    const bindings = makeBindings(base);
    const currentRevisionId = base.deploymentRevision.deploymentRevisionId;
    const otherRevisionId = semanticId(
      'wdr1',
      'wharfie:test:other-destroying-deployment-revision:v1',
      { revision: 2 },
    );

    expect(
      createAwsSingleNodeDesiredResourceTargetCatalog(
        catalogOptions(
          base,
          makeDestroyingHead(base, bindings, currentRevisionId),
        ),
      ),
    ).toHaveLength(18);
    expect(() =>
      createAwsSingleNodeDesiredResourceTargetCatalog(
        catalogOptions(
          base,
          makeDestroyingHead(base, bindings, otherRevisionId),
        ),
      ),
    ).toThrow(/revision/i);
  });

  it('rejects mismatched deployment contexts', () => {
    const base = makeBase();
    const head = makeReadyHead(base, makeBindings(base));
    const mismatches = [
      {
        profile: createDeploymentProfile({
          profile: { id: 'production' },
          appId: base.profile.appId,
          target: {
            nodeVersion: '24.14.0',
            platform: 'linux',
            architecture: 'x64',
            libc: 'glibc',
          },
          mode: { kind: 'single-node-systemd-user', version: 1 },
          provider: createAwsSingleNodeProvider('us-east-1'),
        }),
      },
      {
        providerScope: createAwsProviderScope({
          partition: 'aws',
          accountId: '123456789012',
          region: 'us-west-2',
        }),
      },
      {
        deploymentInstanceId: getDeploymentInstanceId({
          deploymentRevision: base.deploymentRevision,
          providerScope: createAwsProviderScope({
            partition: 'aws',
            accountId: '123456789012',
            region: 'us-west-2',
          }),
        }),
      },
    ];
    for (const mismatch of mismatches) {
      expect(() =>
        createAwsSingleNodeDesiredResourceTargetCatalog(
          catalogOptions(base, head, mismatch),
        ),
      ).toThrow();
    }
  });

  it('rejects a head revision mismatch', () => {
    const base = makeBase();
    const otherRevisionId = semanticId(
      'wdr1',
      'wharfie:test:other-deployment-revision:v1',
      { revision: 2 },
    );
    const head = makeReadyHead(base, makeBindings(base), {
      deploymentRevisionId: otherRevisionId,
    });
    expect(() =>
      createAwsSingleNodeDesiredResourceTargetCatalog(
        catalogOptions(base, head),
      ),
    ).toThrow(/revision/i);
  });

  it.each([
    [
      'graph capability',
      'artifact',
      { capability: { kind: 'networking', version: 1 } },
    ],
    ['graph role', 'artifact', { role: { kind: 'wrong-role', version: 1 } }],
    ['graph provider type', 'network-vpc', { providerType: 'ec2-subnet' }],
    ['management', 'application-state', { management: 'external' }],
    [
      'ownership mode',
      'network-internet-gateway-attachment',
      { ownershipMode: 'direct' },
    ],
    ['destroy policy', 'artifact', { onDestroy: 'retain' }],
    ['dependency lineage', 'network-subnet', { dependencyKeys: [] }],
  ])('rejects a %s mismatch', (_label, resourceKey, override) => {
    const base = makeBase();
    const bindings = makeBindings(base, {
      overrides: { [resourceKey]: override },
    });
    expect(() =>
      createAwsSingleNodeDesiredResourceTargetCatalog(
        catalogOptions(base, makeReadyHead(base, bindings)),
      ),
    ).toThrow();
  });

  it.each([
    ['artifact ARN', 'artifact', 'not-an-s3-arn'],
    ['EBS volume', 'application-state', 'vol-NOTLOWERCASE'],
    ['VPC', 'network-vpc', 'vpc-NOTLOWERCASE'],
    ['internet gateway', 'network-internet-gateway', 'igw-NOTLOWERCASE'],
    ['subnet', 'network-subnet', 'subnet-NOTLOWERCASE'],
    ['route table', 'network-route-table', 'rtb-NOTLOWERCASE'],
    ['security group', 'network-security-group', 'sg-NOTLOWERCASE'],
    ['IAM role', 'runtime-role', 'AROAinvalid'],
    ['instance profile', 'runtime-identity', 'AIPAinvalid'],
    ['EC2 instance', 'substrate', 'i-short'],
  ])(
    'rejects invalid %s direct provider identity syntax',
    (_family, resourceKey, invalidId) => {
      const base = makeBase();
      const bindings = makeBindings(base, {
        overrides: { [resourceKey]: { providerResourceId: invalidId } },
      });
      expect(() =>
        createAwsSingleNodeDesiredResourceTargetCatalog(
          catalogOptions(base, makeReadyHead(base, bindings)),
        ),
      ).toThrow();
    },
  );

  it.each([
    'network-internet-gateway-attachment',
    'network-default-ipv4-route',
    'network-subnet-route-table-association',
    'runtime-role-policy',
    'runtime-identity-role-association',
    'application-state-attachment',
    'control-state-attachment',
  ])(
    'rejects a revalidated %s derived provider identity mismatch',
    (resourceKey) => {
      const base = makeBase();
      const bindings = makeBindings(base, {
        overrides: {
          [resourceKey]: {
            providerResourceId: differentSemanticId(
              providerResourceId(base, resourceKey),
            ),
          },
        },
      });
      expect(() =>
        createAwsSingleNodeDesiredResourceTargetCatalog(
          catalogOptions(base, makeReadyHead(base, bindings)),
        ),
      ).toThrow(/provider|identity|match/i);
    },
  );

  it.each([
    [
      'internet-gateway attachment gateway ID',
      () =>
        getAwsSingleNodeInternetGatewayAttachmentProviderResourceId(
          'wrong',
          IDS.vpc,
        ),
    ],
    [
      'internet-gateway attachment VPC ID',
      () =>
        getAwsSingleNodeInternetGatewayAttachmentProviderResourceId(
          IDS.internetGateway,
          'wrong',
        ),
    ],
    [
      'default-route destination',
      () =>
        getAwsSingleNodeDefaultIpv4RouteProviderResourceId(
          '10.0.0.0/8',
          IDS.internetGateway,
          IDS.routeTable,
        ),
    ],
    [
      'default-route gateway ID',
      () =>
        getAwsSingleNodeDefaultIpv4RouteProviderResourceId(
          '0.0.0.0/0',
          'wrong',
          IDS.routeTable,
        ),
    ],
    [
      'default-route route-table ID',
      () =>
        getAwsSingleNodeDefaultIpv4RouteProviderResourceId(
          '0.0.0.0/0',
          IDS.internetGateway,
          'wrong',
        ),
    ],
    [
      'subnet association route-table ID',
      () =>
        getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId(
          'wrong',
          IDS.subnet,
        ),
    ],
    [
      'subnet association subnet ID',
      () =>
        getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId(
          IDS.routeTable,
          'wrong',
        ),
    ],
  ])(
    'rejects an invalid %s at the exported relationship-ID boundary',
    (_label, call) => {
      expect(call).toThrow(TypeError);
    },
  );

  it.each(['extra', 'observation', 'pendingBinding'])(
    'rejects unsupported %s input',
    (field) => {
      const base = makeBase();
      expect(() =>
        createAwsSingleNodeDesiredResourceTargetCatalog({
          ...catalogOptions(base, null),
          [field]: null,
        }),
      ).toThrow(/not supported/i);
    },
  );
});
