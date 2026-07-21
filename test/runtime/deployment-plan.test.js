import { describe, expect, it } from '@jest/globals';

import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import {
  createCanonicalJsonSha256Id,
  createSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import {
  createDeploymentInspection,
  validateDeploymentInspection,
  validateDeploymentInspectionContext,
} from '../../src/core/runtime/deployment-inspection.js';
import { createDeploymentHead } from '../../src/core/runtime/deployment-head.js';
import {
  createDeploymentPlan,
  validateDeploymentPlan,
  validateDeploymentPlanContext,
} from '../../src/core/runtime/deployment-plan.js';
import { AWS_SINGLE_NODE_RESOURCE_GRAPH } from '../../src/core/runtime/deployment-resource-graph.js';
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

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @param {string} value */
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

/** @param {ReturnType<typeof makeProfile>} profile */
function makeDeploymentRevision(profile) {
  const payload = {
    schemaVersion: 1,
    kind: 'deploymentRevision',
    deployment: { id: 'production' },
    appId: 'provider-demo',
    revisionId: semanticId('wrv1', 'wharfie:test:revision:v1', {
      revision: 1,
    }),
    artifactId: createSha256Id({ prefix: 'waf1', payload: 'exact artifact' }),
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

/** @param {ReturnType<typeof makeProfile>} profile @param {ReturnType<typeof createAwsProviderScope>} providerScope @param {number} [version] */
function makeProviderSpec(profile, providerScope, version = 17) {
  return createAwsSingleNodeProviderSpec({
    profile,
    providerScope,
    machineImage: {
      sourceParameter: {
        name: AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS.x86_64,
        version,
      },
      imageId:
        version === 17 ? 'ami-0123456789abcdef0' : 'ami-fedcba98765432100',
      ownerAccountId: '137112412989',
      architecture: 'x86_64',
      imageType: 'machine',
      rootDeviceType: 'ebs',
      virtualizationType: 'hvm',
      enaSupport: true,
    },
    placement: { availabilityZoneId: 'use1-az1' },
    storage: {
      ebsKmsKeyArn: `arn:${providerScope.partition}:kms:${providerScope.region}:${providerScope.accountId}:key/11111111-2222-3333-4444-555555555555`,
    },
    bootstrapDigest: digest('bootstrap-v1'),
    runtimeIdentityPolicyDigest: digest('runtime-policy-v1'),
  });
}

function makeActions() {
  return AWS_SINGLE_NODE_RESOURCE_GRAPH.resources.map(
    (/** @type {Readonly<Record<string, any>>} */ resource) => ({
      resourceKey: resource.resourceKey,
      capability: resource.capability,
      role: resource.role,
      management: 'managed',
      ownershipMode: resource.ownershipMode,
      dependsOn: resource.dependsOn,
      onDestroy: resource.onDestroy,
      action: 'create',
      destructive: false,
      reason: 'missing',
      before: null,
      after: {
        providerType: resource.providerType,
        providerResourceId: null,
        stateDigest: digest(`${resource.resourceKey} desired`),
      },
    }),
  );
}

function makeFixture() {
  const profile = makeProfile();
  const providerScope = createAwsProviderScope({
    partition: 'aws',
    accountId: '123456789012',
    region: 'us-east-1',
  });
  const deploymentRevision = makeDeploymentRevision(profile);
  const providerSpec = makeProviderSpec(profile, providerScope);
  const deploymentInstanceId = getDeploymentInstanceId({
    deploymentRevision,
    providerScope,
  });
  return {
    profile,
    providerScope,
    providerSpec,
    deploymentRevision,
    deploymentInstanceId,
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {ReturnType<typeof makeProviderSpec>} [providerSpec] */
function makePlanInput(fixture, providerSpec = fixture.providerSpec) {
  return {
    operation: 'apply',
    deploymentRevision: fixture.deploymentRevision,
    providerScope: fixture.providerScope,
    providerSpec,
    deploymentInstanceId: fixture.deploymentInstanceId,
    incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 1)),
    basis: {
      headGeneration: 0,
      settledDeploymentRevisionId: null,
      inspectionId: semanticId(
        'win4',
        'wharfie:test:deployment-inspection:v4',
        { absent: true },
      ),
    },
    actions: makeActions(),
  };
}

/** @param {string} resourceKey */
function bindingId(resourceKey) {
  return semanticId('wrb2', 'wharfie:test:deployment-binding:v2', {
    resourceKey,
  });
}

/** @param {number} index */
function ownershipNonce(index) {
  return createOwnershipNonce(Buffer.alloc(32, index + 1));
}

/**
 * Build exact durable binding authority for either a fully settled create or
 * the point immediately before one newly-created binding is published.
 * @param {ReturnType<typeof makeFixture>} fixture
 * @param {string|null} [pendingResourceKey]
 */
function makeHeadAuthority(fixture, pendingResourceKey = null) {
  const plan = createDeploymentPlan(makePlanInput(fixture), {
    profile: fixture.profile,
  });
  const pendingIndex =
    pendingResourceKey === null
      ? plan.actions.length
      : plan.actions.findIndex(
          (/** @type {Readonly<Record<string, any>>} */ action) =>
            action.resourceKey === pendingResourceKey,
        );
  if (pendingIndex < 0) throw new Error('Unknown pending resource key.');

  const bindingByResourceKey = new Map();
  let pendingBinding = null;
  for (
    let index = 0;
    index <= pendingIndex && index < plan.actions.length;
    index += 1
  ) {
    const resource = AWS_SINGLE_NODE_RESOURCE_GRAPH.resources[index];
    const binding = createDeploymentResourceBinding({
      schemaVersion: 2,
      kind: 'deploymentResourceBinding',
      deploymentInstanceId: fixture.deploymentInstanceId,
      incarnationId: plan.incarnationId,
      resourceKey: resource.resourceKey,
      capability: resource.capability,
      role: resource.role,
      management: 'managed',
      ownershipMode: resource.ownershipMode,
      onDestroy: resource.onDestroy,
      dependencyBindings: resource.dependsOn.map(
        (/** @type {string} */ resourceKey) => ({
          resourceKey,
          bindingId: bindingByResourceKey.get(resourceKey).bindingId,
        }),
      ),
      providerType: resource.providerType,
      providerResourceId: `provider-${resource.resourceKey}`,
      providerScopeId: fixture.providerScope.providerScopeId,
      ownershipNonce: ownershipNonce(index),
      createdByActionId: plan.actions[index].actionId,
    });
    if (index === pendingIndex && pendingResourceKey !== null) {
      pendingBinding = binding;
    } else {
      bindingByResourceKey.set(resource.resourceKey, binding);
    }
  }
  if (pendingBinding !== null) {
    bindingByResourceKey.set(pendingBinding.resourceKey, pendingBinding);
  }

  const head = createDeploymentHead({
    deploymentInstanceId: fixture.deploymentInstanceId,
    providerScope: fixture.providerScope,
    incarnationId: plan.incarnationId,
    generation: 7,
    phase: 'CONVERGING',
    settledDeploymentRevisionId: null,
    targetDeploymentRevisionId: fixture.deploymentRevision.deploymentRevisionId,
    resourceBindings: [...bindingByResourceKey.values()].filter(
      (binding) => binding !== pendingBinding,
    ),
    activeOperation: {
      kind: 'create',
      planId: plan.planId,
      status: 'running',
      nextActionIndex: pendingIndex,
      intents: plan.actions.map(
        (
          /** @type {Readonly<Record<string, any>>} */ action,
          /** @type {number} */ index,
        ) => ({
          actionId: action.actionId,
          status:
            index < pendingIndex
              ? 'settled'
              : index === pendingIndex && pendingResourceKey !== null
                ? 'intended'
                : 'pending',
          ownershipNonce: ownershipNonce(index),
        }),
      ),
    },
    lastOperation: null,
  });
  return { bindingByResourceKey, head, pendingBinding };
}

/** @param {ReturnType<typeof makeFixture>} fixture */
function makeDestroyedInspectionInput(fixture) {
  return {
    deploymentRevision: fixture.deploymentRevision,
    providerScope: fixture.providerScope,
    providerSpecId: fixture.providerSpec.providerSpecId,
    deploymentInstanceId: fixture.deploymentInstanceId,
    controlState: { status: 'present', evidence: 'provider-head-read' },
    incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 1)),
    headGeneration: 7,
    status: 'destroyed',
    resources: AWS_SINGLE_NODE_RESOURCE_GRAPH.resources.map(
      (/** @type {Readonly<Record<string, any>>} */ resource) => {
        const retained = resource.onDestroy === 'retain';
        return {
          resourceKey: resource.resourceKey,
          capability: resource.capability,
          role: resource.role,
          management: 'managed',
          ownershipMode: resource.ownershipMode,
          dependsOn: resource.dependsOn,
          onDestroy: resource.onDestroy,
          bindingId: retained ? bindingId(resource.resourceKey) : null,
          dependencyBindings: retained
            ? [...resource.dependsOn].sort().map((resourceKey) => ({
                resourceKey,
                bindingId: bindingId(resourceKey),
              }))
            : null,
          presence: retained ? 'present' : 'absent',
          presenceEvidence: retained ? 'exact-read' : 'authoritative-not-found',
          ownership: retained ? 'verified' : 'missing',
          providerIdentity: retained
            ? {
                providerType: resource.providerType,
                providerResourceId: `provider-${resource.resourceKey}`,
              }
            : null,
          desiredDigest: digest(`${resource.resourceKey} desired`),
          observedDigest: retained
            ? digest(`${resource.resourceKey} desired`)
            : null,
          health: retained ? 'not-applicable' : 'absent',
          service: null,
        };
      },
    ),
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Map<string, Readonly<Record<string, any>>>} [bindingByResourceKey] */
function makePresentInspectionInput(fixture, bindingByResourceKey = new Map()) {
  return {
    deploymentRevision: fixture.deploymentRevision,
    providerScope: fixture.providerScope,
    providerSpecId: fixture.providerSpec.providerSpecId,
    deploymentInstanceId: fixture.deploymentInstanceId,
    controlState: { status: 'present', evidence: 'provider-head-read' },
    incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 1)),
    headGeneration: 7,
    status: 'in-flight',
    resources: AWS_SINGLE_NODE_RESOURCE_GRAPH.resources.map(
      (/** @type {Readonly<Record<string, any>>} */ resource) => ({
        resourceKey: resource.resourceKey,
        capability: resource.capability,
        role: resource.role,
        management: 'managed',
        ownershipMode: resource.ownershipMode,
        dependsOn: resource.dependsOn,
        onDestroy: resource.onDestroy,
        bindingId:
          bindingByResourceKey.get(resource.resourceKey)?.bindingId ??
          bindingId(resource.resourceKey),
        dependencyBindings: [...resource.dependsOn]
          .sort()
          .map((/** @type {string} */ resourceKey) => ({
            resourceKey,
            bindingId:
              bindingByResourceKey.get(resourceKey)?.bindingId ??
              bindingId(resourceKey),
          })),
        presence: 'present',
        presenceEvidence: 'exact-read',
        ownership: 'verified',
        providerIdentity: {
          providerType: resource.providerType,
          providerResourceId: `provider-${resource.resourceKey}`,
        },
        desiredDigest: digest(`${resource.resourceKey} desired`),
        observedDigest: digest(`${resource.resourceKey} desired`),
        health:
          resource.resourceKey === 'substrate' ? 'starting' : 'not-applicable',
        service: null,
      }),
    ),
  };
}

describe('deployment plan v3', () => {
  it('embeds and context-checks the exact provider specification', () => {
    const fixture = makeFixture();
    const plan = createDeploymentPlan(makePlanInput(fixture), {
      profile: fixture.profile,
    });

    expect(plan.schemaVersion).toBe(3);
    expect(plan.planId).toMatch(/^wpl3_[A-Za-z0-9_-]{43}$/);
    expect(plan.actions).toHaveLength(15);
    expect(plan.actions[0].resourceKey).toBe('artifact');
    expect(plan.actions.at(-1).resourceKey).toBe('control-state-attachment');
    expect(
      plan.actions.every(
        (/** @type {Readonly<Record<string, any>>} */ action) =>
          /^wda3_/.test(action.actionId),
      ),
    ).toBe(true);
    expect(plan.providerSpec).toEqual(fixture.providerSpec);
    expect(validateDeploymentPlan(clone(plan))).toEqual(plan);
    expect(
      validateDeploymentPlanContext(clone(plan), {
        profile: fixture.profile,
      }),
    ).toEqual(plan);
  });

  it('binds every action identity to the selected provider specification', () => {
    const fixture = makeFixture();
    const first = createDeploymentPlan(makePlanInput(fixture), {
      profile: fixture.profile,
    });
    const replacementSpec = makeProviderSpec(
      fixture.profile,
      fixture.providerScope,
      18,
    );
    const second = createDeploymentPlan(
      makePlanInput(fixture, replacementSpec),
      { profile: fixture.profile },
    );

    expect(second.planId).not.toBe(first.planId);
    expect(
      second.actions.map(
        (/** @type {Readonly<Record<string, any>>} */ action) =>
          action.actionId,
      ),
    ).not.toEqual(
      first.actions.map(
        (/** @type {Readonly<Record<string, any>>} */ action) =>
          action.actionId,
      ),
    );
  });

  it('rejects an internally contradictory provider scope without context', () => {
    const fixture = makeFixture();
    const plan = createDeploymentPlan(makePlanInput(fixture), {
      profile: fixture.profile,
    });
    const otherScope = createAwsProviderScope({
      partition: 'aws',
      accountId: '210987654321',
      region: 'us-east-1',
    });
    const contradictory = {
      ...clone(plan),
      providerSpec: makeProviderSpec(fixture.profile, otherScope),
    };

    expect(() => validateDeploymentPlan(contradictory)).toThrow(
      /providerSpec does not match the exact provider scope/i,
    );
  });

  it('accepts repeated capabilities only through the exact finite graph roles', () => {
    const fixture = makeFixture();
    const plan = createDeploymentPlan(makePlanInput(fixture), {
      profile: fixture.profile,
    });

    expect(
      plan.actions.filter(
        (/** @type {Readonly<Record<string, any>>} */ action) =>
          action.capability.kind === 'networking',
      ),
    ).toHaveLength(8);

    const changedRole = makePlanInput(fixture);
    changedRole.actions[3] = {
      ...changedRole.actions[3],
      role: { kind: 'subnet', version: 1 },
    };
    expect(() =>
      createDeploymentPlan(changedRole, { profile: fixture.profile }),
    ).toThrow(/exact AWS single-node resource graph role/i);

    const changedDependency = makePlanInput(fixture);
    changedDependency.actions[5] = {
      ...changedDependency.actions[5],
      dependsOn: ['network-vpc'],
    };
    expect(() =>
      createDeploymentPlan(changedDependency, { profile: fixture.profile }),
    ).toThrow(/exact AWS single-node resource graph role/i);
  });

  it('requires graph apply order and exact reverse destroy order', () => {
    const fixture = makeFixture();
    const unordered = makePlanInput(fixture);
    [unordered.actions[0], unordered.actions[1]] = [
      unordered.actions[1],
      unordered.actions[0],
    ];
    expect(() =>
      createDeploymentPlan(unordered, { profile: fixture.profile }),
    ).toThrow(/topological apply.*order/i);

    const destroyActions = makeActions()
      .map((/** @type {Record<string, any>} */ action) => {
        const state = {
          ...action.after,
          providerResourceId: `provider-${action.resourceKey}`,
        };
        return action.onDestroy === 'retain'
          ? {
              ...action,
              action: 'noop',
              reason: 'retained-data',
              before: state,
              after: state,
            }
          : {
              ...action,
              action: 'delete',
              destructive: true,
              reason: 'destroy-requested',
              before: state,
              after: null,
            };
      })
      .reverse();
    const input = makePlanInput(fixture);
    const destroyInput = {
      ...input,
      operation: 'destroy',
      basis: {
        ...input.basis,
        settledDeploymentRevisionId:
          fixture.deploymentRevision.deploymentRevisionId,
      },
      actions: destroyActions,
    };
    const destroy = createDeploymentPlan(destroyInput, {
      profile: fixture.profile,
    });

    expect(destroy.actions[0].resourceKey).toBe('control-state-attachment');
    expect(destroy.actions.at(-1).resourceKey).toBe('artifact');

    const deleteRetained = clone(destroyInput);
    const retained = deleteRetained.actions.find(
      (/** @type {Record<string, any>} */ action) =>
        action.resourceKey === 'application-state',
    );
    retained.action = 'delete';
    retained.destructive = true;
    retained.reason = 'destroy-requested';
    retained.after = null;
    expect(() =>
      createDeploymentPlan(deleteRetained, { profile: fixture.profile }),
    ).toThrow(/managed retained resources require noop/i);

    const retainAttachment = clone(destroyInput);
    const attachment = retainAttachment.actions.find(
      (/** @type {Record<string, any>} */ action) =>
        action.resourceKey === 'application-state-attachment',
    );
    attachment.action = 'noop';
    attachment.destructive = false;
    attachment.reason = 'already-converged';
    attachment.after = attachment.before;
    expect(() =>
      createDeploymentPlan(retainAttachment, { profile: fixture.profile }),
    ).toThrow(/managed purge resources require delete/i);
  });

  it('allows exact missing-effect creates during reconcile and rejects v2', () => {
    const fixture = makeFixture();
    const input = makePlanInput(fixture);
    const reconcile = createDeploymentPlan(
      {
        ...input,
        operation: 'reconcile',
        basis: {
          ...input.basis,
          settledDeploymentRevisionId:
            fixture.deploymentRevision.deploymentRevisionId,
        },
      },
      { profile: fixture.profile },
    );
    expect(
      reconcile.actions.every(
        (/** @type {Readonly<Record<string, any>>} */ action) =>
          action.action === 'create',
      ),
    ).toBe(true);

    const oldVersion = /** @type {Record<string, any>} */ (clone(reconcile));
    oldVersion.schemaVersion = 2;
    expect(() => validateDeploymentPlan(oldVersion)).toThrow(
      /schemaVersion must be the integer 3/i,
    );
  });
});

describe('deployment inspection v4', () => {
  it('binds provider evidence to a full context-checked specification', () => {
    const fixture = makeFixture();
    const inspection = createDeploymentInspection(
      {
        deploymentRevision: fixture.deploymentRevision,
        providerScope: fixture.providerScope,
        providerSpecId: fixture.providerSpec.providerSpecId,
        deploymentInstanceId: fixture.deploymentInstanceId,
        controlState: {
          status: 'absent',
          evidence: 'authoritative-not-found',
        },
        incarnationId: null,
        headGeneration: 0,
        status: 'absent',
        resources: [],
      },
      { profile: fixture.profile, providerSpec: fixture.providerSpec },
    );

    expect(inspection.schemaVersion).toBe(4);
    expect(inspection.inspectionId).toMatch(/^win4_[A-Za-z0-9_-]{43}$/);
    expect(inspection.providerSpecId).toBe(fixture.providerSpec.providerSpecId);
    expect(validateDeploymentInspection(clone(inspection))).toEqual(inspection);
    expect(
      validateDeploymentInspectionContext(clone(inspection), {
        profile: fixture.profile,
        providerSpec: fixture.providerSpec,
      }),
    ).toEqual(inspection);

    const otherSpec = makeProviderSpec(
      fixture.profile,
      fixture.providerScope,
      18,
    );
    expect(() =>
      validateDeploymentInspectionContext(inspection, {
        profile: fixture.profile,
        providerSpec: otherSpec,
      }),
    ).toThrow(/providerSpecId does not match/i);
  });

  it('uses per-role destroy policy for retained volumes and purged attachments', () => {
    const fixture = makeFixture();
    const inspection = createDeploymentInspection(
      makeDestroyedInspectionInput(fixture),
      { profile: fixture.profile, providerSpec: fixture.providerSpec },
    );

    expect(
      inspection.resources
        .filter(
          (/** @type {Readonly<Record<string, any>>} */ resource) =>
            resource.presence === 'present',
        )
        .map(
          (/** @type {Readonly<Record<string, any>>} */ resource) =>
            resource.resourceKey,
        ),
    ).toEqual(['application-state', 'control-state']);
    expect(
      inspection.resources.find(
        (/** @type {Readonly<Record<string, any>>} */ resource) =>
          resource.resourceKey === 'application-state-attachment',
      ),
    ).toMatchObject({
      onDestroy: 'purge',
      presence: 'absent',
      presenceEvidence: 'authoritative-not-found',
    });
    expect(validateDeploymentInspection(clone(inspection))).toEqual(inspection);
  });

  it('requires exact derived dependency binding lineage against the head', () => {
    const fixture = makeFixture();
    const authority = makeHeadAuthority(fixture);
    const input = makePresentInspectionInput(
      fixture,
      authority.bindingByResourceKey,
    );
    const inspection = createDeploymentInspection(input, {
      profile: fixture.profile,
      providerSpec: fixture.providerSpec,
      head: authority.head,
    });
    expect(
      inspection.resources.find(
        (/** @type {Readonly<Record<string, any>>} */ resource) =>
          resource.resourceKey === 'application-state-attachment',
      )?.dependencyBindings,
    ).toEqual([
      {
        resourceKey: 'application-state',
        bindingId:
          authority.bindingByResourceKey.get('application-state').bindingId,
      },
      {
        resourceKey: 'substrate',
        bindingId: authority.bindingByResourceKey.get('substrate').bindingId,
      },
    ]);

    const changed = clone(input);
    const derived = changed.resources.find(
      (/** @type {Record<string, any>} */ resource) =>
        resource.resourceKey === 'application-state-attachment',
    );
    derived.dependencyBindings[0].bindingId = bindingId('control-state');
    expect(() =>
      createDeploymentInspection(changed, {
        profile: fixture.profile,
        providerSpec: fixture.providerSpec,
        head: authority.head,
      }),
    ).toThrow(/binding evidence does not match the exact head/i);
  });

  it('requires present provider identity to match the exact referenced binding', () => {
    const fixture = makeFixture();
    const authority = makeHeadAuthority(fixture);
    const input = makePresentInspectionInput(
      fixture,
      authority.bindingByResourceKey,
    );
    const substrate = input.resources.find(
      (/** @type {Record<string, any>} */ resource) =>
        resource.resourceKey === 'substrate',
    );
    substrate.providerIdentity.providerResourceId = 'provider-other-substrate';

    expect(() =>
      createDeploymentInspection(input, {
        profile: fixture.profile,
        providerSpec: fixture.providerSpec,
        head: authority.head,
      }),
    ).toThrow(/binding evidence does not match the exact head/i);
  });

  it('rejects durable bindings outside the exact provider resource graph', () => {
    const fixture = makeFixture();
    const authority = makeHeadAuthority(fixture);
    const extraBinding = createDeploymentResourceBinding({
      schemaVersion: 2,
      kind: 'deploymentResourceBinding',
      deploymentInstanceId: fixture.deploymentInstanceId,
      incarnationId: authority.head.incarnationId,
      resourceKey: 'extra-provider-resource',
      capability: { kind: 'networking', version: 1 },
      role: { kind: 'extra-provider-role', version: 1 },
      management: 'managed',
      ownershipMode: 'direct',
      onDestroy: 'purge',
      dependencyBindings: [],
      providerType: 'extra-provider-type',
      providerResourceId: 'provider-extra',
      providerScopeId: fixture.providerScope.providerScopeId,
      ownershipNonce: ownershipNonce(30),
      createdByActionId: semanticId(
        'wda3',
        'wharfie:test:deployment-action:v3',
        { extra: true },
      ),
    });
    const headInput = /** @type {Record<string, any>} */ (
      clone(authority.head)
    );
    delete headInput.schemaVersion;
    delete headInput.kind;
    delete headInput.headId;
    headInput.resourceBindings.push(extraBinding);
    const head = createDeploymentHead(headInput);

    expect(() =>
      createDeploymentInspection(
        makePresentInspectionInput(fixture, authority.bindingByResourceKey),
        {
          profile: fixture.profile,
          providerSpec: fixture.providerSpec,
          head,
        },
      ),
    ).toThrow(/does not match the exact AWS single-node resource graph/i);
  });

  it('accepts only the current intended create binding as pending authority', () => {
    const fixture = makeFixture();
    const authority = makeHeadAuthority(fixture, 'control-state-attachment');
    if (authority.pendingBinding === null) {
      throw new Error('Expected pending binding authority.');
    }
    const pendingBinding = authority.pendingBinding;
    const input = makePresentInspectionInput(
      fixture,
      authority.bindingByResourceKey,
    );

    const inspection = createDeploymentInspection(input, {
      profile: fixture.profile,
      providerSpec: fixture.providerSpec,
      head: authority.head,
      pendingBinding,
    });
    expect(
      inspection.resources.find(
        (/** @type {Readonly<Record<string, any>>} */ resource) =>
          resource.resourceKey === 'control-state-attachment',
      )?.bindingId,
    ).toBe(pendingBinding.bindingId);

    const wrongNonceInput = /** @type {Record<string, any>} */ (
      clone(pendingBinding)
    );
    delete wrongNonceInput.bindingId;
    wrongNonceInput.ownershipNonce = ownershipNonce(30);
    const wrongNonce = createDeploymentResourceBinding(wrongNonceInput);
    expect(() =>
      createDeploymentInspection(input, {
        profile: fixture.profile,
        providerSpec: fixture.providerSpec,
        head: authority.head,
        pendingBinding: wrongNonce,
      }),
    ).toThrow(/current intent ownership authority/i);

    const unresolvedDependencyInput = /** @type {Record<string, any>} */ (
      clone(pendingBinding)
    );
    delete unresolvedDependencyInput.bindingId;
    unresolvedDependencyInput.dependencyBindings[0].bindingId = bindingId(
      'unresolved-dependency',
    );
    const unresolvedDependency = createDeploymentResourceBinding(
      unresolvedDependencyInput,
    );
    expect(() =>
      createDeploymentInspection(input, {
        profile: fixture.profile,
        providerSpec: fixture.providerSpec,
        head: authority.head,
        pendingBinding: unresolvedDependency,
      }),
    ).toThrow(/does not resolve to the exact durable head binding/i);
  });

  it('rejects noncanonical graph order, presence evidence, service role, and v3', () => {
    const fixture = makeFixture();

    const unordered = makeDestroyedInspectionInput(fixture);
    [unordered.resources[0], unordered.resources[1]] = [
      unordered.resources[1],
      unordered.resources[0],
    ];
    expect(() =>
      createDeploymentInspection(unordered, {
        profile: fixture.profile,
        providerSpec: fixture.providerSpec,
      }),
    ).toThrow(/topological apply order/i);

    const wrongEvidence = makeDestroyedInspectionInput(fixture);
    wrongEvidence.resources[0].presenceEvidence = 'access-failure';
    expect(() =>
      createDeploymentInspection(wrongEvidence, {
        profile: fixture.profile,
        providerSpec: fixture.providerSpec,
      }),
    ).toThrow(/presenceEvidence must be 'authoritative-not-found'/i);

    const contradictoryAbsence = makeDestroyedInspectionInput(fixture);
    contradictoryAbsence.resources[0].ownership = 'verified';
    expect(() =>
      createDeploymentInspection(contradictoryAbsence, {
        profile: fixture.profile,
        providerSpec: fixture.providerSpec,
      }),
    ).toThrow(/absent managed resources must report missing ownership/i);

    const contradictoryUnknown = makePresentInspectionInput(fixture);
    contradictoryUnknown.resources[0] = {
      ...contradictoryUnknown.resources[0],
      bindingId: null,
      dependencyBindings: null,
      presence: 'unknown',
      presenceEvidence: 'access-failure',
      ownership: 'verified',
      providerIdentity: null,
      observedDigest: null,
      health: 'unknown',
    };
    expect(() =>
      createDeploymentInspection(contradictoryUnknown, {
        profile: fixture.profile,
        providerSpec: fixture.providerSpec,
      }),
    ).toThrow(/unknown managed resources must report unknown ownership/i);

    const wrongServiceRole = makePresentInspectionInput(fixture);
    wrongServiceRole.resources[0] = {
      ...wrongServiceRole.resources[0],
      health: 'starting',
      service: {
        health: 'starting',
        artifactId: fixture.deploymentRevision.artifactId,
        revisionId: fixture.deploymentRevision.revisionId,
        healthReceipt: null,
      },
    };
    expect(() =>
      createDeploymentInspection(wrongServiceRole, {
        profile: fixture.profile,
        providerSpec: fixture.providerSpec,
      }),
    ).toThrow(/service is supported only for the substrate node/i);

    const inspection = createDeploymentInspection(
      makeDestroyedInspectionInput(fixture),
      { profile: fixture.profile, providerSpec: fixture.providerSpec },
    );
    const oldVersion = /** @type {Record<string, any>} */ (clone(inspection));
    oldVersion.schemaVersion = 3;
    expect(() => validateDeploymentInspection(oldVersion)).toThrow(
      /schemaVersion must be the integer 4/i,
    );
  });
});
