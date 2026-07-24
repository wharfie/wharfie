import { describe, expect, it } from '@jest/globals';

import {
  AwsIamEvidenceConflictError,
  AwsIamEvidenceTransientError,
  AwsIamEvidenceUnknownError,
} from '../../src/core/runtime/deployment-aws-iam-evidence.js';
import {
  corroborateAwsSingleNodeInstanceProfileRoleAssociationViews,
  decodeAwsSingleNodeInstanceProfileRoleAssociationProfileView,
  decodeAwsSingleNodeInstanceProfileRoleAssociationRoleView,
} from '../../src/core/runtime/deployment-aws-instance-profile-role-association-evidence.js';
import { AWS_SINGLE_NODE_RUNTIME_ROLE_PATH } from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
import { createAwsProviderScope } from '../../src/core/runtime/deployment-provider-scope.js';

const ROLE_NAME = 'wharfie-runtime-role-v1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ROLE_ID = 'AROA1234567890EXAMPLE';
const PROFILE_NAME =
  'wharfie-runtime-profile-v1-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const PROFILE_ID = 'AIPA1234567890EXAMPLE';

/** @returns {Readonly<Record<string, any>>} */
function authority() {
  return Object.freeze({
    providerScope: createAwsProviderScope({
      partition: 'aws',
      accountId: '123456789012',
      region: 'us-east-1',
    }),
    roleName: ROLE_NAME,
    runtimeRoleId: ROLE_ID,
    instanceProfileName: PROFILE_NAME,
    instanceProfileId: PROFILE_ID,
  });
}

/** @param {Record<string, any>} [overrides] */
function roleReference(overrides = {}) {
  return {
    Path: AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
    RoleName: ROLE_NAME,
    RoleId: ROLE_ID,
    Arn: `arn:aws:iam::123456789012:role${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${ROLE_NAME}`,
    ...overrides,
  };
}

/** @param {Record<string, any>} [overrides] */
function profileReference(overrides = {}) {
  return {
    path: AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
    instanceProfileName: PROFILE_NAME,
    instanceProfileId: PROFILE_ID,
    arn: `arn:aws:iam::123456789012:instance-profile${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${PROFILE_NAME}`,
    ...overrides,
  };
}

/** @param {unknown} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

describe('AWS single-node instance-profile/role association evidence', () => {
  it('decodes exact present and absent profile membership', () => {
    const present =
      decodeAwsSingleNodeInstanceProfileRoleAssociationProfileView(
        { Roles: [roleReference()] },
        authority(),
      );
    const absent = decodeAwsSingleNodeInstanceProfileRoleAssociationProfileView(
      { Roles: [] },
      authority(),
    );

    expect(present).toEqual({ membership: 'present' });
    expect(absent).toEqual({ membership: 'absent' });
    expectDeepFrozen(present);
    expectDeepFrozen(absent);
  });

  it('decodes exact present and absent role membership', () => {
    const present = decodeAwsSingleNodeInstanceProfileRoleAssociationRoleView(
      [profileReference()],
      authority(),
    );
    const absent = decodeAwsSingleNodeInstanceProfileRoleAssociationRoleView(
      [],
      authority(),
    );

    expect(present).toEqual({ membership: 'present' });
    expect(absent).toEqual({ membership: 'absent' });
    expectDeepFrozen(present);
    expectDeepFrozen(absent);
  });

  it('rejects foreign endpoints and impossible membership cardinality', () => {
    expect(() =>
      decodeAwsSingleNodeInstanceProfileRoleAssociationProfileView(
        {
          Roles: [
            roleReference({
              RoleId: 'AROA0987654321EXAMPLE',
            }),
          ],
        },
        authority(),
      ),
    ).toThrow(AwsIamEvidenceConflictError);
    expect(() =>
      decodeAwsSingleNodeInstanceProfileRoleAssociationRoleView(
        [
          profileReference(),
          profileReference({
            instanceProfileId: 'AIPA0987654321EXAMPLE',
          }),
        ],
        authority(),
      ),
    ).toThrow(AwsIamEvidenceConflictError);
  });

  it('classifies malformed endpoint references as unknown', () => {
    expect(() =>
      decodeAwsSingleNodeInstanceProfileRoleAssociationProfileView(
        { Roles: [{ ...roleReference(), Arn: null }] },
        authority(),
      ),
    ).toThrow(AwsIamEvidenceUnknownError);
    expect(() =>
      decodeAwsSingleNodeInstanceProfileRoleAssociationRoleView(
        [{ ...profileReference(), instanceProfileId: 'not-an-id' }],
        authority(),
      ),
    ).toThrow(AwsIamEvidenceUnknownError);
    expect(() =>
      decodeAwsSingleNodeInstanceProfileRoleAssociationProfileView(
        { Roles: [roleReference(), { malformed: true }] },
        authority(),
      ),
    ).toThrow(AwsIamEvidenceUnknownError);
  });

  it('requires both membership projections to converge', () => {
    expect(() =>
      corroborateAwsSingleNodeInstanceProfileRoleAssociationViews({
        profileView: { membership: 'present' },
        roleView: { membership: 'absent' },
      }),
    ).toThrow(AwsIamEvidenceTransientError);

    const present = corroborateAwsSingleNodeInstanceProfileRoleAssociationViews(
      {
        profileView: { membership: 'present' },
        roleView: { membership: 'present' },
      },
    );
    const absent = corroborateAwsSingleNodeInstanceProfileRoleAssociationViews({
      profileView: { membership: 'absent' },
      roleView: { membership: 'absent' },
    });

    expect(present).toEqual({ presence: 'present' });
    expect(absent).toEqual({ presence: 'absent' });
    expectDeepFrozen(present);
    expectDeepFrozen(absent);
  });

  it('rejects malformed corroboration shapes before provider classification', () => {
    expect(() =>
      corroborateAwsSingleNodeInstanceProfileRoleAssociationViews({
        profileView: { membership: 'present', extra: true },
        roleView: { membership: 'present' },
      }),
    ).toThrow(TypeError);
  });
});
