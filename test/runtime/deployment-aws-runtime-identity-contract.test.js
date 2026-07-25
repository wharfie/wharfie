import { describe, expect, it } from '@jest/globals';

import {
  AWS_SINGLE_NODE_RUNTIME_INSTANCE_PROFILE_NAME_PREFIX,
  AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
  AWS_SINGLE_NODE_RUNTIME_POLICY_TEMPLATE_DIGEST,
  AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION,
  AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_SESSION_DURATION,
  AWS_SINGLE_NODE_RUNTIME_ROLE_NAME_PREFIX,
  AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
  assertAwsEc2InstanceId,
  assertAwsIamInstanceProfileId,
  assertAwsIamRoleId,
  createAwsSingleNodeRuntimeIdentityTags,
  createAwsSingleNodeRuntimePolicy,
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimeAssociationProviderResourceId,
  getAwsSingleNodeRuntimeAssociationStateDigest,
  getAwsSingleNodeRuntimeInstanceProfileName,
  getAwsSingleNodeRuntimeInstanceProfileStateDigest,
  getAwsSingleNodeRuntimePolicyProviderResourceId,
  getAwsSingleNodeRuntimePolicyStateDigest,
  getAwsSingleNodeRuntimePolicyTemplateDigest,
  getAwsSingleNodeRuntimeRoleName,
  getAwsSingleNodeRuntimeRoleStateDigest,
  getAwsSingleNodeRuntimeRoleTrustPolicy,
  validateAwsSingleNodeRuntimePolicy,
  validateAwsSingleNodeRuntimeRoleTrustPolicy,
} from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
import {
  createCanonicalJsonSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import {
  DEPLOYMENT_CONTROL_TABLE_NAME,
  getDeploymentControlHeadRecordKey,
  getDeploymentControlHostActivationAuthorityRecordKey,
} from '../../src/core/runtime/deployment-control-table.js';
import { createAwsProviderScope } from '../../src/core/runtime/deployment-provider-scope.js';
import { createDeploymentIncarnationId } from '../../src/core/runtime/deployment-resource-binding.js';

const RUNTIME_ROLE_ID = 'AROA1234567890EXAMPLE';
const INSTANCE_PROFILE_ID = 'AIPA1234567890EXAMPLE';

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

function makeFixture() {
  const providerScope = createAwsProviderScope({
    partition: 'aws',
    accountId: '123456789012',
    region: 'us-east-1',
  });
  const deploymentInstanceId = createCanonicalJsonSha256Id({
    domain: 'wharfie:test:deployment-instance:v1',
    prefix: 'wdi1',
    value: { deployment: 'production' },
  });
  const incarnationId = createDeploymentIncarnationId(Buffer.alloc(32, 7));
  const nameAuthority = {
    providerScopeId: providerScope.providerScopeId,
    deploymentInstanceId,
    incarnationId,
  };
  const policyAuthority = {
    providerScope,
    deploymentInstanceId,
    incarnationId,
  };
  return Object.freeze({
    providerScope,
    deploymentInstanceId,
    incarnationId,
    nameAuthority,
    policyAuthority,
  });
}

describe('AWS single-node runtime identity contract', () => {
  it('pins deterministic account-global role and instance-profile names', () => {
    const fixture = makeFixture();
    const roleName = getAwsSingleNodeRuntimeRoleName(fixture.nameAuthority);
    const profileName = getAwsSingleNodeRuntimeInstanceProfileName(
      fixture.nameAuthority,
    );

    expect(roleName).toMatch(/^wharfie-runtime-role-v1-[0-9a-f]{32}$/);
    expect(profileName).toMatch(/^wharfie-runtime-profile-v1-[0-9a-f]{32}$/);
    expect(roleName).toBe(
      'wharfie-runtime-role-v1-8978541fef473e8e64547a310ed18e38',
    );
    expect(profileName).toBe(
      'wharfie-runtime-profile-v1-dd82eca942450a519ad87efc851a13ab',
    );
    expect(roleName.length).toBeLessThanOrEqual(64);
    expect(profileName.length).toBeLessThanOrEqual(128);
    expect(roleName).toBe(
      getAwsSingleNodeRuntimeRoleName(fixture.nameAuthority),
    );
    expect(profileName).toBe(
      getAwsSingleNodeRuntimeInstanceProfileName(fixture.nameAuthority),
    );
    expect(AWS_SINGLE_NODE_RUNTIME_ROLE_NAME_PREFIX).toBe(
      'wharfie-runtime-role-v1-',
    );
    expect(AWS_SINGLE_NODE_RUNTIME_INSTANCE_PROFILE_NAME_PREFIX).toBe(
      'wharfie-runtime-profile-v1-',
    );

    const nextIncarnation = {
      ...fixture.nameAuthority,
      incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 8)),
    };
    expect(getAwsSingleNodeRuntimeRoleName(nextIncarnation)).not.toBe(roleName);
    expect(
      getAwsSingleNodeRuntimeInstanceProfileName(nextIncarnation),
    ).not.toBe(profileName);
  });

  it('pins the exact EC2-only trust policy and role shape', () => {
    const fixture = makeFixture();
    const trust = getAwsSingleNodeRuntimeRoleTrustPolicy();

    expect(trust).toEqual({
      Statement: [
        {
          Action: 'sts:AssumeRole',
          Effect: 'Allow',
          Principal: { Service: 'ec2.amazonaws.com' },
        },
      ],
      Version: '2012-10-17',
    });
    expect(Object.isFrozen(trust)).toBe(true);
    expect(AWS_SINGLE_NODE_RUNTIME_ROLE_PATH).toBe('/wharfie/runtime/v1/');
    expect(AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION).toBe(
      'Wharfie single-node resident service runtime role.',
    );
    expect(AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_SESSION_DURATION).toBe(3600);
    expect(
      getAwsSingleNodeRuntimeRoleStateDigest(fixture.nameAuthority),
    ).toEqual({
      algorithm: 'sha256',
      value: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
  });

  it('accepts raw or URI-encoded reordered trust JSON and rejects semantic extras', () => {
    const trust = /** @type {Record<string, any>} */ ({
      Statement: [
        {
          Principal: { Service: 'ec2.amazonaws.com' },
          Action: 'sts:AssumeRole',
          Effect: 'Allow',
        },
      ],
      Version: '2012-10-17',
    });
    expect(
      validateAwsSingleNodeRuntimeRoleTrustPolicy(JSON.stringify(trust)),
    ).toBe(getAwsSingleNodeRuntimeRoleTrustPolicy());
    expect(
      validateAwsSingleNodeRuntimeRoleTrustPolicy(
        encodeURIComponent(JSON.stringify(trust)),
      ),
    ).toBe(getAwsSingleNodeRuntimeRoleTrustPolicy());

    trust.Statement[0].Condition = {
      Bool: { 'aws:MultiFactorAuthPresent': true },
    };
    expect(() =>
      validateAwsSingleNodeRuntimeRoleTrustPolicy(JSON.stringify(trust)),
    ).toThrow(/does not match the exact runtime IAM policy/i);
  });

  it('derives the stable managed artifact key without a revision-specific name', () => {
    const fixture = makeFixture();
    const location = getAwsSingleNodeManagedArtifactObjectLocation(
      fixture.policyAuthority,
    );

    expect(location).toEqual({
      bucketName: expect.stringMatching(
        /^wharfie-dc-v1-123456789012-[0-9a-f]{20}$/,
      ),
      key: `artifact/v1/${fixture.deploymentInstanceId}/${fixture.incarnationId}/current`,
      arn: expect.stringMatching(
        /^arn:aws:s3:::wharfie-dc-v1-123456789012-[0-9a-f]{20}\/artifact\/v1\//,
      ),
    });
    expect(location.arn).toBe(
      `arn:aws:s3:::${location.bucketName}/${location.key}`,
    );
    expect(Object.isFrozen(location)).toBe(true);
  });

  it('renders one exact minimal SSM, control-authority, managed-artifact, and health policy', () => {
    const fixture = makeFixture();
    const location = getAwsSingleNodeManagedArtifactObjectLocation(
      fixture.policyAuthority,
    );
    const policy = createAwsSingleNodeRuntimePolicy(fixture.policyAuthority);

    expect(policy.Version).toBe('2012-10-17');
    expect(policy.Statement).toHaveLength(7);
    expect(
      policy.Statement.map(
        (/** @type {Readonly<Record<string, any>>} */ statement) =>
          statement.Sid,
      ),
    ).toEqual([
      'ManageWithSsm',
      'ReadExactManagedArtifact',
      'ReadExactHostActivationAuthority',
      'ReadOwnCurrentHealth',
      'CreateOwnCurrentHealth',
      'ReplaceOwnCurrentHealth',
      'DenyDeletingOwnHealthHistory',
    ]);
    expect(policy.Statement[0]).toEqual({
      Action: [
        'ssm:UpdateInstanceInformation',
        'ssmmessages:CreateControlChannel',
        'ssmmessages:CreateDataChannel',
        'ssmmessages:OpenControlChannel',
        'ssmmessages:OpenDataChannel',
      ],
      Effect: 'Allow',
      Resource: '*',
      Sid: 'ManageWithSsm',
    });
    expect(policy.Statement[1]).toEqual({
      Action: 's3:GetObject',
      Condition: {
        Bool: { 'aws:SecureTransport': 'true' },
        StringEquals: { 's3:ResourceAccount': '123456789012' },
      },
      Effect: 'Allow',
      Resource: location.arn,
      Sid: 'ReadExactManagedArtifact',
    });

    expect(policy.Statement[2]).toEqual({
      Action: 'dynamodb:GetItem',
      Condition: {
        Bool: { 'aws:SecureTransport': 'true' },
        'ForAllValues:StringEquals': {
          'dynamodb:LeadingKeys': [
            getDeploymentControlHostActivationAuthorityRecordKey(
              fixture.deploymentInstanceId,
            ),
            getDeploymentControlHeadRecordKey(fixture.deploymentInstanceId),
          ],
        },
        Null: {
          'dynamodb:EnclosingOperation': 'true',
          'dynamodb:LeadingKeys': 'false',
        },
      },
      Effect: 'Allow',
      Resource: `arn:aws:dynamodb:us-east-1:123456789012:table/${DEPLOYMENT_CONTROL_TABLE_NAME}`,
      Sid: 'ReadExactHostActivationAuthority',
    });

    const healthArn = `arn:aws:s3:::${location.bucketName}/health/v3/\${aws:userid}`;
    expect(policy.Statement[3].Resource).toBe(healthArn);
    expect(policy.Statement[4].Condition).toEqual({
      Bool: { 'aws:SecureTransport': 'true' },
      StringEquals: {
        's3:ResourceAccount': '123456789012',
        's3:if-none-match': '*',
        's3:x-amz-server-side-encryption': 'AES256',
        's3:x-amz-storage-class': 'STANDARD',
      },
    });
    expect(policy.Statement[5].Condition).toEqual({
      Bool: { 'aws:SecureTransport': 'true' },
      Null: { 's3:if-match': 'false' },
      StringEquals: {
        's3:ResourceAccount': '123456789012',
        's3:x-amz-server-side-encryption': 'AES256',
        's3:x-amz-storage-class': 'STANDARD',
      },
    });
    expect(policy.Statement[6]).toEqual({
      Action: ['s3:DeleteObject', 's3:DeleteObjectVersion'],
      Effect: 'Deny',
      Resource: healthArn,
      Sid: 'DenyDeletingOwnHealthHistory',
    });
    expect(JSON.stringify(policy)).not.toMatch(
      /s3:ListBucket|ec2messages|ssm:GetParameter|s3:GetObjectVersion|dynamodb:(?:BatchGetItem|Query|Scan)|dynamodb:PartiQL/,
    );
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.Statement)).toBe(true);
  });

  it('derives the provider-spec digest from the same exact policy shape', () => {
    expect(AWS_SINGLE_NODE_RUNTIME_POLICY_TEMPLATE_DIGEST).toEqual({
      algorithm: 'sha256',
      value: 'cH34BV7sMmvhePjPdM3ra7IJwq5v2rVvI08sPwh2puA',
    });
    expect(getAwsSingleNodeRuntimePolicyTemplateDigest()).toBe(
      AWS_SINGLE_NODE_RUNTIME_POLICY_TEMPLATE_DIGEST,
    );
    expect(
      Object.isFrozen(AWS_SINGLE_NODE_RUNTIME_POLICY_TEMPLATE_DIGEST),
    ).toBe(true);
  });

  it('validates raw and encoded concrete policies without accepting broadening', () => {
    const fixture = makeFixture();
    const policy = createAwsSingleNodeRuntimePolicy(fixture.policyAuthority);
    const reordered = /** @type {Record<string, any>} */ (clone(policy));

    expect(
      validateAwsSingleNodeRuntimePolicy(
        JSON.stringify(reordered),
        fixture.policyAuthority,
      ),
    ).toEqual(policy);
    expect(
      validateAwsSingleNodeRuntimePolicy(
        encodeURIComponent(JSON.stringify(reordered)),
        fixture.policyAuthority,
      ),
    ).toEqual(policy);

    const broad = clone(policy);
    broad.Statement[1].Resource = '*';
    expect(() =>
      validateAwsSingleNodeRuntimePolicy(
        encodeURIComponent(JSON.stringify(broad)),
        fixture.policyAuthority,
      ),
    ).toThrow(/does not match the exact runtime IAM policy/i);
  });

  it('pins state and synthetic provider identities to immutable endpoints', () => {
    const fixture = makeFixture();
    expect(AWS_SINGLE_NODE_RUNTIME_POLICY_NAME).toBe(
      'wharfie-runtime-policy-v1',
    );
    expect(
      getAwsSingleNodeRuntimePolicyProviderResourceId({
        runtimeRoleId: RUNTIME_ROLE_ID,
      }),
    ).toMatch(/^wrp1_[A-Za-z0-9_-]{43}$/);
    expect(
      getAwsSingleNodeRuntimeAssociationProviderResourceId({
        runtimeRoleId: RUNTIME_ROLE_ID,
        instanceProfileId: INSTANCE_PROFILE_ID,
      }),
    ).toMatch(/^wra1_[A-Za-z0-9_-]{43}$/);

    for (const digest of [
      getAwsSingleNodeRuntimeRoleStateDigest(fixture.nameAuthority),
      getAwsSingleNodeRuntimePolicyStateDigest(fixture.policyAuthority),
      getAwsSingleNodeRuntimeInstanceProfileStateDigest(fixture.nameAuthority),
      getAwsSingleNodeRuntimeAssociationStateDigest(fixture.nameAuthority),
    ]) {
      expect(digest).toEqual({
        algorithm: 'sha256',
        value: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      });
      expect(Object.isFrozen(digest)).toBe(true);
    }

    expect(
      getAwsSingleNodeRuntimeAssociationProviderResourceId({
        runtimeRoleId: 'AROA0987654321EXAMPLE',
        instanceProfileId: INSTANCE_PROFILE_ID,
      }),
    ).not.toBe(
      getAwsSingleNodeRuntimeAssociationProviderResourceId({
        runtimeRoleId: RUNTIME_ROLE_ID,
        instanceProfileId: INSTANCE_PROFILE_ID,
      }),
    );
    expect(
      getAwsSingleNodeRuntimeAssociationStateDigest(fixture.nameAuthority),
    ).not.toEqual(
      getAwsSingleNodeRuntimeAssociationStateDigest({
        ...fixture.nameAuthority,
        incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 8)),
      }),
    );
  });

  it('renders the exact thirteen immutable ownership tags', () => {
    const fixture = makeFixture();
    const stateDigest = getAwsSingleNodeRuntimeRoleStateDigest(
      fixture.nameAuthority,
    );
    const actionId = createCanonicalJsonSha256Id({
      domain: 'wharfie:test:deployment-action:v3',
      prefix: 'wda3',
      value: { action: 'runtime-role' },
    });
    const ownershipNonce = Buffer.alloc(32, 9).toString('base64url');
    const tags = createAwsSingleNodeRuntimeIdentityTags({
      resourceKind: 'single-node-runtime-role',
      capabilityKind: 'runtime-identity',
      roleKind: 'role',
      providerScopeId: fixture.providerScope.providerScopeId,
      deploymentInstanceId: fixture.deploymentInstanceId,
      incarnationId: fixture.incarnationId,
      resourceKey: 'runtime-role',
      createdByActionId: actionId,
      ownershipNonce,
      stateDigest,
    });

    expect(tags).toHaveLength(13);
    expect(tags.map((tag) => tag.Key)).toEqual(
      [...tags.map((tag) => tag.Key)].sort(),
    );
    expect(
      Object.fromEntries(tags.map(({ Key, Value }) => [Key, Value])),
    ).toEqual({
      'wharfie:capability': 'runtime-identity',
      'wharfie:created-by-action-id': actionId,
      'wharfie:deployment-instance-id': fixture.deploymentInstanceId,
      'wharfie:incarnation-id': fixture.incarnationId,
      'wharfie:managed-by': 'wharfie',
      'wharfie:ownership-nonce': ownershipNonce,
      'wharfie:provider-scope-id': fixture.providerScope.providerScopeId,
      'wharfie:resource-key': 'runtime-role',
      'wharfie:resource-kind': 'single-node-runtime-role',
      'wharfie:retention': 'purge',
      'wharfie:role': 'role',
      'wharfie:schema-version': '2',
      'wharfie:state-digest': stateDigest.value,
    });
    expect(Object.isFrozen(tags)).toBe(true);
    expect(tags.every(Object.isFrozen)).toBe(true);
  });

  it('rejects malformed immutable identities and incomplete authorities', () => {
    expect(() => assertAwsIamRoleId(RUNTIME_ROLE_ID)).not.toThrow();
    expect(() =>
      assertAwsIamInstanceProfileId(INSTANCE_PROFILE_ID),
    ).not.toThrow();
    expect(() => assertAwsEc2InstanceId('i-0123456789abcdef0')).not.toThrow();
    expect(() => assertAwsIamRoleId('AIPA1234567890EXAMPLE')).toThrow(/RoleId/);
    expect(() =>
      assertAwsIamInstanceProfileId('AROA1234567890EXAMPLE'),
    ).toThrow(/InstanceProfileId/);
    expect(() => assertAwsEc2InstanceId('i-01234567')).toThrow(/long-format/);

    const fixture = makeFixture();
    expect(() =>
      createAwsSingleNodeRuntimePolicy({
        ...fixture.policyAuthority,
        extra: true,
      }),
    ).toThrow(/extra is not supported/);
    expect(() => getDeploymentControlHeadRecordKey('wdi1_invalid')).toThrow(
      /deploymentInstanceId/,
    );
    expect(() =>
      getDeploymentControlHostActivationAuthorityRecordKey(undefined),
    ).toThrow(/deploymentInstanceId/);
    expect(() =>
      getAwsSingleNodeRuntimeRoleName({
        ...fixture.nameAuthority,
        incarnationId: 'wic1_invalid',
      }),
    ).toThrow(/incarnationId/);
    expect(() =>
      getAwsSingleNodeRuntimePolicyProviderResourceId({
        runtimeRoleId: 'role-name',
      }),
    ).toThrow(/RoleId/);
    expect(() =>
      getAwsSingleNodeRuntimeAssociationProviderResourceId({
        runtimeRoleId: RUNTIME_ROLE_ID,
        instanceProfileId: 'profile-name',
      }),
    ).toThrow(/InstanceProfileId/);
    expect(() =>
      validateAwsSingleNodeRuntimePolicy('%not-valid', fixture.policyAuthority),
    ).toThrow(/URI-encoded|valid JSON/i);
  });

  it('keeps digest syntax canonical', () => {
    expect(sha256Base64Url('runtime identity')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
