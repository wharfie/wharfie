import { describe, expect, it } from '@jest/globals';

import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  AwsIamEvidenceConflictError,
  AwsIamEvidenceTransientError,
  AwsIamEvidenceUnknownError,
} from '../../src/core/runtime/deployment-aws-iam-evidence.js';
import {
  AWS_SINGLE_NODE_INSTANCE_PROFILE_TAG_PAGE_SIZE,
  createAwsSingleNodeInstanceProfileOwnershipTags,
  decodeAwsSingleNodeInstanceProfileActualState,
  decodeAwsSingleNodeInstanceProfileCandidateId,
  decodeAwsSingleNodeInstanceProfileInstancePage,
  decodeAwsSingleNodeInstanceProfileResponse,
  decodeAwsSingleNodeInstanceProfileTagPage,
  validateAwsSingleNodeInstanceProfileFencedInstance,
  validateAwsSingleNodeInstanceProfileId,
  validateAwsSingleNodeInstanceProfileTags,
} from '../../src/core/runtime/deployment-aws-instance-profile-evidence.js';
import {
  AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
  getAwsSingleNodeRuntimeInstanceProfileName,
  getAwsSingleNodeRuntimeInstanceProfileStateDigest,
} from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
import { createAwsProviderScope } from '../../src/core/runtime/deployment-provider-scope.js';
import {
  createDeploymentIncarnationId,
  createOwnershipNonce,
} from '../../src/core/runtime/deployment-resource-binding.js';

const INSTANCE_PROFILE_ID = 'AIPA1234567890EXAMPLE';
const OTHER_INSTANCE_PROFILE_ID = 'AIPA0987654321EXAMPLE';
const ROLE_ID = 'AROA1234567890EXAMPLE';
const INSTANCE_ID = 'i-00000000000000001';

/** @param {string} prefix @param {string} domain @param {unknown} value @returns {string} */
function semanticId(prefix, domain, value) {
  return createCanonicalJsonSha256Id({ prefix, domain, value });
}

/** @param {unknown} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

/** @returns {Readonly<Record<string, any>>} */
function authority() {
  return Object.freeze({
    providerScopeId: semanticId(
      'wps1',
      'wharfie:test:instance-profile-evidence-provider-scope:v1',
      {},
    ),
    deploymentInstanceId: semanticId(
      'wdi1',
      'wharfie:test:instance-profile-evidence-deployment:v1',
      {},
    ),
    incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 41)),
  });
}

/** @returns {Readonly<Record<string, any>>} */
function providerScope() {
  return createAwsProviderScope({
    partition: 'aws',
    accountId: '123456789012',
    region: 'us-east-1',
  });
}

/** @param {Readonly<Record<string, any>>} identity */
function instanceProfileName(identity) {
  return getAwsSingleNodeRuntimeInstanceProfileName(identity);
}

/** @param {Readonly<Record<string, any>>} identity */
function profileArn(identity) {
  return `arn:aws:iam::123456789012:instance-profile${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${instanceProfileName(identity)}`;
}

/** @param {Readonly<Record<string, any>>} identity @param {Record<string, any>} [overrides] */
function role(identity, overrides = {}) {
  const RoleName = 'wharfie-runtime-role-v1-0123456789abcdef0123456789abcdef';
  return {
    Path: AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
    RoleName,
    RoleId: ROLE_ID,
    Arn: `arn:aws:iam::123456789012:role${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${RoleName}`,
    ...overrides,
  };
}

/** @param {Readonly<Record<string, any>>} identity @param {Record<string, any>} [overrides] */
function profile(identity, overrides = {}) {
  return {
    Path: AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
    InstanceProfileName: instanceProfileName(identity),
    InstanceProfileId: INSTANCE_PROFILE_ID,
    Arn: profileArn(identity),
    Roles: [],
    ...overrides,
  };
}

/** @param {Readonly<Record<string, any>>} identity @param {Record<string, any>} [overrides] */
function decodeOptions(identity, overrides = {}) {
  return {
    providerScope: providerScope(),
    instanceProfileName: instanceProfileName(identity),
    expectedInstanceProfileId: null,
    ...overrides,
  };
}

/** @param {Readonly<Record<string, any>>} identity */
function ownershipTags(identity) {
  return createAwsSingleNodeInstanceProfileOwnershipTags({
    ...identity,
    createdByActionId: semanticId(
      'wda3',
      'wharfie:test:instance-profile-evidence-action:v1',
      {},
    ),
    ownershipNonce: createOwnershipNonce(Buffer.alloc(32, 42)),
    stateDigest: getAwsSingleNodeRuntimeInstanceProfileStateDigest(identity),
  });
}

describe('AWS single-node instance-profile identity evidence', () => {
  it('decodes immutable identity and returns a normalized deeply frozen record', () => {
    const identity = authority();
    const rawRole = role(identity);
    const rawProfile = profile(identity, {
      CreateDate: new Date(),
      Roles: [rawRole],
    });
    const decoded = decodeAwsSingleNodeInstanceProfileResponse(
      { InstanceProfile: rawProfile },
      decodeOptions(identity, {
        expectedInstanceProfileId: INSTANCE_PROFILE_ID,
      }),
    );

    expect(decoded).toEqual({
      Path: AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
      InstanceProfileName: instanceProfileName(identity),
      InstanceProfileId: INSTANCE_PROFILE_ID,
      Arn: profileArn(identity),
      Roles: [role(identity)],
    });
    expect(decoded).not.toBe(rawProfile);
    expect(decoded.Roles[0]).not.toBe(rawRole);
    expect(decoded).not.toHaveProperty('CreateDate');
    expectDeepFrozen(decoded);
  });

  it('extracts only a strict candidate ID and rejects malformed envelopes', () => {
    const identity = authority();
    expect(
      decodeAwsSingleNodeInstanceProfileCandidateId({
        InstanceProfile: profile(identity),
      }),
    ).toBe(INSTANCE_PROFILE_ID);
    expect(validateAwsSingleNodeInstanceProfileId(INSTANCE_PROFILE_ID)).toBe(
      INSTANCE_PROFILE_ID,
    );
    expect(() =>
      decodeAwsSingleNodeInstanceProfileCandidateId({
        InstanceProfile: profile(identity, {
          InstanceProfileId: 'not-an-instance-profile-id',
        }),
      }),
    ).toThrow(AwsIamEvidenceUnknownError);
    expect(() => validateAwsSingleNodeInstanceProfileId('bad')).toThrow(
      AwsIamEvidenceUnknownError,
    );
  });

  it.each([
    [
      'immutable ID',
      { InstanceProfileId: OTHER_INSTANCE_PROFILE_ID },
      { expectedInstanceProfileId: INSTANCE_PROFILE_ID },
    ],
    ['name', { InstanceProfileName: 'foreign-profile' }, {}],
    ['path', { Path: '/foreign/' }, {}],
    [
      'account ARN',
      { Arn: 'arn:aws:iam::999999999999:instance-profile/x' },
      {},
    ],
    ['role cardinality', { Roles: [role(authority()), role(authority())] }, {}],
    ['role shape', { Roles: [role(authority(), { RoleId: 'bad' })] }, {}],
  ])(
    'classifies contradictory %s evidence as conflict',
    (_label, change, optionChange) => {
      const identity = authority();
      expect(() =>
        decodeAwsSingleNodeInstanceProfileResponse(
          { InstanceProfile: profile(identity, change) },
          decodeOptions(identity, optionChange),
        ),
      ).toThrow(AwsIamEvidenceConflictError);
    },
  );

  it.each([
    ['missing envelope', {}],
    [
      'malformed immutable ID',
      {
        InstanceProfile: profile(authority(), {
          InstanceProfileId: 'bad',
        }),
      },
    ],
    [
      'missing roles',
      {
        InstanceProfile: profile(authority(), { Roles: undefined }),
      },
    ],
  ])('classifies %s as unknown', (_label, response) => {
    const identity = authority();
    expect(() =>
      decodeAwsSingleNodeInstanceProfileResponse(
        response,
        decodeOptions(identity),
      ),
    ).toThrow(AwsIamEvidenceUnknownError);
  });
});

describe('AWS single-node instance-profile tag and state evidence', () => {
  it('constructs all thirteen immutable ownership tags', () => {
    const tags = ownershipTags(authority());

    expect(tags).toHaveLength(13);
    expect(tags).toEqual(
      expect.arrayContaining([
        {
          Key: 'wharfie:resource-kind',
          Value: 'single-node-runtime-instance-profile',
        },
        { Key: 'wharfie:role', Value: 'instance-profile' },
        { Key: 'wharfie:resource-key', Value: 'runtime-identity' },
      ]),
    );
    expectDeepFrozen(tags);
  });

  it('decodes omitted-false and paginated tag pages', () => {
    const tags = ownershipTags(authority());
    expect(decodeAwsSingleNodeInstanceProfileTagPage({ Tags: tags })).toEqual({
      tags,
      marker: null,
    });
    expect(
      decodeAwsSingleNodeInstanceProfileTagPage({
        Tags: tags.slice(0, 1),
        IsTruncated: true,
        Marker: 'page-two',
      }),
    ).toEqual({ tags: tags.slice(0, 1), marker: 'page-two' });
    expect(() =>
      decodeAwsSingleNodeInstanceProfileTagPage({
        Tags: [],
        IsTruncated: true,
      }),
    ).toThrow(AwsIamEvidenceUnknownError);
    expect(() =>
      decodeAwsSingleNodeInstanceProfileTagPage({
        Tags: Array.from(
          { length: AWS_SINGLE_NODE_INSTANCE_PROFILE_TAG_PAGE_SIZE + 1 },
          (_, index) => ({ Key: `key-${index}`, Value: 'value' }),
        ),
      }),
    ).toThrow(AwsIamEvidenceUnknownError);
  });

  it('distinguishes exact, transitional, contradictory, and malformed tags', () => {
    const expected = ownershipTags(authority());
    expect(
      validateAwsSingleNodeInstanceProfileTags(expected, expected, false),
    ).toBeUndefined();
    expect(() =>
      validateAwsSingleNodeInstanceProfileTags(
        expected.slice(0, 4),
        expected,
        true,
      ),
    ).toThrow(AwsIamEvidenceTransientError);
    expect(() =>
      validateAwsSingleNodeInstanceProfileTags(
        [{ ...expected[0], Value: 'foreign' }],
        expected,
        true,
      ),
    ).toThrow(AwsIamEvidenceConflictError);
    expect(() =>
      validateAwsSingleNodeInstanceProfileTags(
        [expected[0], expected[0]],
        expected,
        true,
      ),
    ).toThrow(AwsIamEvidenceConflictError);
    expect(() =>
      validateAwsSingleNodeInstanceProfileTags(
        [{ Key: '', Value: 'bad' }],
        expected,
        true,
      ),
    ).toThrow(AwsIamEvidenceUnknownError);
  });

  it('recomputes actual digest from readable authority and freezes it', () => {
    const identity = authority();
    const actual = decodeAwsSingleNodeInstanceProfileActualState(
      profile(identity),
      identity,
    );

    expect(actual).toEqual({
      providerResourceId: INSTANCE_PROFILE_ID,
      observedDigest:
        getAwsSingleNodeRuntimeInstanceProfileStateDigest(identity),
    });
    expectDeepFrozen(actual);
  });
});

describe('AWS single-node instance-profile regional deletion evidence', () => {
  it('decodes bounded instance pages and validates terminated exact use', () => {
    const identity = authority();
    const instanceProfile = profile(identity);
    const instance = {
      InstanceId: INSTANCE_ID,
      IamInstanceProfile: {
        Id: INSTANCE_PROFILE_ID,
        Arn: profileArn(identity),
      },
      State: { Code: 48, Name: 'terminated' },
    };
    expect(
      decodeAwsSingleNodeInstanceProfileInstancePage({
        Reservations: [{ Instances: [instance] }],
        NextToken: 'page-two',
      }),
    ).toEqual({ instances: [instance], nextToken: 'page-two' });
    expect(() =>
      validateAwsSingleNodeInstanceProfileFencedInstance(
        instance,
        instanceProfile,
        providerScope(),
      ),
    ).not.toThrow();
  });

  it.each([
    [
      'active use',
      {
        State: { Code: 16, Name: 'running' },
      },
      AwsIamEvidenceConflictError,
    ],
    [
      'wrong profile identity',
      {
        IamInstanceProfile: {
          Id: OTHER_INSTANCE_PROFILE_ID,
          Arn: 'arn:aws:iam::123456789012:instance-profile/foreign',
        },
      },
      AwsIamEvidenceConflictError,
    ],
    ['malformed instance', { State: null }, AwsIamEvidenceUnknownError],
  ])(
    'classifies %s without leaking provider detail',
    (_label, change, ErrorType) => {
      const identity = authority();
      const instanceProfile = profile(identity);
      const instance = {
        InstanceId: INSTANCE_ID,
        IamInstanceProfile: {
          Id: INSTANCE_PROFILE_ID,
          Arn: profileArn(identity),
        },
        State: { Code: 48, Name: 'terminated' },
        ...change,
      };
      expect(() =>
        validateAwsSingleNodeInstanceProfileFencedInstance(
          instance,
          instanceProfile,
          providerScope(),
        ),
      ).toThrow(ErrorType);
    },
  );

  it('rejects malformed or over-wide instance pages', () => {
    expect(() =>
      decodeAwsSingleNodeInstanceProfileInstancePage({
        Reservations: [{ Instances: [{}] }],
        NextToken: '',
      }),
    ).toThrow(AwsIamEvidenceUnknownError);
    expect(() =>
      decodeAwsSingleNodeInstanceProfileInstancePage({
        Reservations: [{ Instances: 'not-an-array' }],
      }),
    ).toThrow(AwsIamEvidenceUnknownError);
  });
});
