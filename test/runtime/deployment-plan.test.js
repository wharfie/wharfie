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
} from '../../src/core/runtime/deployment-provider-scope.js';
import { createDeploymentIncarnationId } from '../../src/core/runtime/deployment-resource-binding.js';

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
    bootstrapDigest: digest('bootstrap-v1'),
    runtimeIdentityPolicyDigest: digest('runtime-policy-v1'),
  });
}

function makeActions() {
  return [
    ['node', 'resident-node', 'ec2-instance'],
    ['application-state', 'application-state', 'ebs-volume'],
    ['control-state', 'control-state', 'ebs-volume'],
    ['artifact', 'artifact-storage', 's3-object'],
    ['runtime-identity', 'runtime-identity', 'instance-profile'],
    ['network', 'networking', 'vpc'],
  ].map(([resourceKey, capability, providerType]) => ({
    resourceKey,
    capability: { kind: capability, version: 1 },
    management: 'managed',
    action: 'create',
    destructive: false,
    reason: 'missing',
    before: null,
    after: {
      providerType,
      providerResourceId: null,
      stateDigest: digest(`${resourceKey} desired`),
    },
  }));
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
        'win3',
        'wharfie:test:deployment-inspection:v3',
        { absent: true },
      ),
    },
    actions: makeActions(),
  };
}

describe('deployment plan v2', () => {
  it('embeds and context-checks the exact provider specification', () => {
    const fixture = makeFixture();
    const plan = createDeploymentPlan(makePlanInput(fixture), {
      profile: fixture.profile,
    });

    expect(plan.schemaVersion).toBe(2);
    expect(plan.planId).toMatch(/^wpl2_[A-Za-z0-9_-]{43}$/);
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
});

describe('deployment inspection v3', () => {
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

    expect(inspection.schemaVersion).toBe(3);
    expect(inspection.inspectionId).toMatch(/^win3_[A-Za-z0-9_-]{43}$/);
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
});
