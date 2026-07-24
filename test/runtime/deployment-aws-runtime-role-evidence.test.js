import { describe, expect, it } from '@jest/globals';

import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  AwsIamEvidenceConflictError,
  AwsIamEvidenceUnknownError,
} from '../../src/core/runtime/deployment-aws-iam-evidence.js';
import {
  decodeAwsSingleNodeRuntimeRoleEvidence,
  decodeAwsSingleNodeRuntimeRoleInstanceProfiles,
  decodeAwsSingleNodeRuntimeRoleResponse,
  getAwsSingleNodeRuntimeRoleOwnershipTags,
  validateAwsSingleNodeRuntimeRoleId,
} from '../../src/core/runtime/deployment-aws-runtime-role-evidence.js';
import {
  createAwsProviderScope,
  validateProviderScope,
} from '../../src/core/runtime/deployment-provider-scope.js';
import {
  AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION,
  AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_SESSION_DURATION,
  AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
  getAwsSingleNodeRuntimeRoleName,
  getAwsSingleNodeRuntimeRoleStateDigest,
  getAwsSingleNodeRuntimeRoleTrustPolicy,
} from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
import {
  createDeploymentIncarnationId,
  createOwnershipNonce,
} from '../../src/core/runtime/deployment-resource-binding.js';

const ROLE_ID = 'AROA1234567890EXAMPLE';
const OTHER_ROLE_ID = 'AROA0987654321EXAMPLE';
const PROFILE_ID = 'AIPA1234567890EXAMPLE';

/** @param {string} prefix @param {string} domain @param {unknown} value @returns {string} */
function semanticId(prefix, domain, value) {
  return createCanonicalJsonSha256Id({ prefix, domain, value });
}

/** @param {any} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

function makeAuthority() {
  const providerScope = validateProviderScope(
    createAwsProviderScope({
      partition: 'aws',
      accountId: '123456789012',
      region: 'us-east-1',
    }),
  );
  const nameAuthority = Object.freeze({
    providerScopeId: providerScope.providerScopeId,
    deploymentInstanceId: semanticId(
      'wdi1',
      'wharfie:test:runtime-role-evidence:deployment:v1',
      {},
    ),
    incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 7)),
  });
  return Object.freeze({
    providerScope,
    nameAuthority,
    roleName: getAwsSingleNodeRuntimeRoleName(nameAuthority),
  });
}

/** @param {ReturnType<typeof makeAuthority>} authority @param {Record<string, any>} [overrides] @returns {Record<string, any>} */
function makeRole(authority, overrides = {}) {
  return {
    Path: AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
    RoleName: authority.roleName,
    RoleId: ROLE_ID,
    Arn: `arn:aws:iam::123456789012:role${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${authority.roleName}`,
    Description: AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION,
    MaxSessionDuration: AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_SESSION_DURATION,
    AssumeRolePolicyDocument: encodeURIComponent(
      JSON.stringify(getAwsSingleNodeRuntimeRoleTrustPolicy()),
    ),
    ...overrides,
  };
}

describe('AWS single-node runtime role evidence', () => {
  it('normalizes a GetRole envelope without retaining provider mutability', () => {
    const authority = makeAuthority();
    const providerRole = makeRole(authority);
    const role = decodeAwsSingleNodeRuntimeRoleResponse(
      { Role: providerRole },
      authority.roleName,
    );
    expect(role).not.toBe(providerRole);
    expect(role).toEqual({ ...providerRole, PermissionsBoundary: undefined });
    expectDeepFrozen(role);
    expect(() => {
      providerRole.Description = 'changed later';
    }).not.toThrow();
    expect(role.Description).toBe(AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION);
  });

  it('returns the exact desired digest for raw or URI-encoded trust JSON', () => {
    const authority = makeAuthority();
    for (const AssumeRolePolicyDocument of [
      JSON.stringify(getAwsSingleNodeRuntimeRoleTrustPolicy()),
      encodeURIComponent(
        JSON.stringify(getAwsSingleNodeRuntimeRoleTrustPolicy()),
      ),
    ]) {
      const evidence = decodeAwsSingleNodeRuntimeRoleEvidence(
        makeRole(authority, { AssumeRolePolicyDocument }),
        {
          providerScope: authority.providerScope,
          roleName: authority.roleName,
          providerResourceId: ROLE_ID,
        },
      );
      expect(evidence.providerResourceId).toBe(ROLE_ID);
      expect(evidence.observedDigest).toEqual(
        getAwsSingleNodeRuntimeRoleStateDigest(authority.nameAuthority),
      );
      expectDeepFrozen(evidence);
    }
  });

  it.each([
    ['path', { Path: '/foreign/' }],
    ['name', { RoleName: 'foreign-role' }],
    [
      'ARN account',
      {
        Arn: 'arn:aws:iam::999999999999:role/wharfie/runtime/v1/foreign',
      },
    ],
    ['bound RoleId', { RoleId: OTHER_ROLE_ID }],
  ])('classifies immutable %s mismatch as conflict', (_name, overrides) => {
    const authority = makeAuthority();
    expect(() =>
      decodeAwsSingleNodeRuntimeRoleEvidence(makeRole(authority, overrides), {
        providerScope: authority.providerScope,
        roleName: authority.roleName,
        providerResourceId: ROLE_ID,
      }),
    ).toThrow(AwsIamEvidenceConflictError);
  });

  it.each([
    ['description', { Description: 'drifted' }],
    ['missing description', { Description: undefined }],
    ['session duration', { MaxSessionDuration: 7200 }],
    [
      'trust policy',
      {
        AssumeRolePolicyDocument: JSON.stringify({
          Version: '2012-10-17',
          Statement: [],
        }),
      },
    ],
    [
      'permissions boundary',
      {
        PermissionsBoundary: {
          PermissionsBoundaryType: 'PermissionsBoundaryPolicy',
          PermissionsBoundaryArn:
            'arn:aws:iam::123456789012:policy/foreign-boundary',
        },
      },
    ],
  ])('preserves readable %s drift in the actual digest', (_name, overrides) => {
    const authority = makeAuthority();
    const evidence = decodeAwsSingleNodeRuntimeRoleEvidence(
      makeRole(authority, overrides),
      {
        providerScope: authority.providerScope,
        roleName: authority.roleName,
        providerResourceId: ROLE_ID,
      },
    );
    expect(evidence.observedDigest).not.toEqual(
      getAwsSingleNodeRuntimeRoleStateDigest(authority.nameAuthority),
    );
  });

  it.each([
    [{ Role: null }],
    [{ Role: {} }],
    [{ Role: { RoleName: 'foreign-role' } }],
  ])('rejects malformed or contradictory GetRole envelopes', (response) => {
    const authority = makeAuthority();
    const expectedError =
      response.Role !== null &&
      'RoleName' in response.Role &&
      response.Role.RoleName === 'foreign-role'
        ? AwsIamEvidenceConflictError
        : AwsIamEvidenceUnknownError;
    expect(() =>
      decodeAwsSingleNodeRuntimeRoleResponse(response, authority.roleName),
    ).toThrow(expectedError);
  });

  it.each([['bad-id'], ['AROA123'], [null]])(
    'rejects malformed RoleId evidence',
    (value) => {
      expect(() => validateAwsSingleNodeRuntimeRoleId(value)).toThrow(
        AwsIamEvidenceUnknownError,
      );
    },
  );

  it('renders the exact sorted immutable role ownership tags', () => {
    const authority = makeAuthority();
    const tags = getAwsSingleNodeRuntimeRoleOwnershipTags({
      capabilityKind: 'runtime-identity',
      roleKind: 'role',
      providerScopeId: authority.providerScope.providerScopeId,
      deploymentInstanceId: authority.nameAuthority.deploymentInstanceId,
      incarnationId: authority.nameAuthority.incarnationId,
      resourceKey: 'runtime-role',
      createdByActionId: semanticId(
        'wda3',
        'wharfie:test:runtime-role-evidence:action:v1',
        {},
      ),
      ownershipNonce: createOwnershipNonce(Buffer.alloc(32, 8)),
      stateDigest: getAwsSingleNodeRuntimeRoleStateDigest(
        authority.nameAuthority,
      ),
    });
    expect(tags).toHaveLength(13);
    expect(tags.map((tag) => tag.Key)).toEqual(
      [...tags.map((tag) => tag.Key)].sort(),
    );
    expectDeepFrozen(tags);
  });

  it('normalizes exact profile descendants including path evidence', () => {
    const profiles = decodeAwsSingleNodeRuntimeRoleInstanceProfiles([
      {
        InstanceProfileId: PROFILE_ID,
        InstanceProfileName: 'profile',
        Path: AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
        Arn: `arn:aws:iam::123456789012:instance-profile${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}profile`,
      },
    ]);
    expect(profiles).toEqual([
      {
        instanceProfileId: PROFILE_ID,
        instanceProfileName: 'profile',
        path: AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
        arn: `arn:aws:iam::123456789012:instance-profile${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}profile`,
      },
    ]);
    expectDeepFrozen(profiles);
    expect(() =>
      decodeAwsSingleNodeRuntimeRoleInstanceProfiles([
        {
          InstanceProfileId: PROFILE_ID,
          InstanceProfileName: 'profile',
          Arn: 'arn:missing-path',
        },
      ]),
    ).toThrow(AwsIamEvidenceUnknownError);
  });
});
