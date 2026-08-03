import { describe, expect, it } from '@jest/globals';

import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  AwsIamEvidenceConflictError,
  AwsIamEvidenceTransientError,
  AwsIamEvidenceUnknownError,
} from '../../src/core/runtime/deployment-aws-iam-evidence.js';
import {
  corroborateAwsSingleNodeRuntimeRolePolicyEvidence,
  createAwsSingleNodeRuntimeRolePolicyObservedStateDigest,
  decodeAwsSingleNodeRuntimeRolePolicyInventory,
  decodeAwsSingleNodeRuntimeRolePolicyResponse,
} from '../../src/core/runtime/deployment-aws-runtime-role-policy-evidence.js';
import {
  AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
  createAwsSingleNodeRuntimePolicy,
  getAwsSingleNodeRuntimePolicyStateDigest,
} from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
import { createAwsProviderScope } from '../../src/core/runtime/deployment-provider-scope.js';
import { createDeploymentIncarnationId } from '../../src/core/runtime/deployment-resource-binding.js';

const ROLE_NAME = 'wharfie-runtime-role-v1-aaaaaaaaaaaaaaaaaaaaaaaaaa';

/** @returns {Readonly<Record<string, any>>} */
function policyAuthority() {
  return Object.freeze({
    providerScope: createAwsProviderScope({
      partition: 'aws',
      accountId: '123456789012',
      region: 'us-east-1',
    }),
    deploymentInstanceId: createCanonicalJsonSha256Id({
      prefix: 'wdi1',
      domain: 'wharfie:test:runtime-role-policy-evidence-instance:v1',
      value: {},
    }),
    incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 54)),
  });
}

/** @param {unknown} policyDocument @param {Record<string, any>} [overrides] */
function response(policyDocument, overrides = {}) {
  return {
    RoleName: ROLE_NAME,
    PolicyName: AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
    PolicyDocument: policyDocument,
    ...overrides,
  };
}

/** @param {unknown} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

describe('AWS single-node runtime role policy evidence', () => {
  it.each(['raw canonical JSON', 'URI-encoded JSON'])(
    'decodes %s and derives the exact desired digest',
    (encoding) => {
      const authority = policyAuthority();
      const document = createAwsSingleNodeRuntimePolicy(authority);
      const encoded =
        encoding === 'URI-encoded JSON'
          ? encodeURIComponent(JSON.stringify(document))
          : JSON.stringify(document);

      const evidence = decodeAwsSingleNodeRuntimeRolePolicyResponse(
        response(encoded),
        { roleName: ROLE_NAME, policyAuthority: authority },
      );

      expect(evidence).toEqual({
        roleName: ROLE_NAME,
        policyName: AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
        policyDocument: document,
        desired: true,
        observedDigest: getAwsSingleNodeRuntimePolicyStateDigest(authority),
      });
      expectDeepFrozen(evidence);
    },
  );

  it('normalizes a readable drifted document into an actual observed digest', () => {
    const authority = policyAuthority();
    const drifted = {
      Statement: [],
      Version: '2012-10-17',
    };

    const evidence = decodeAwsSingleNodeRuntimeRolePolicyResponse(
      response(JSON.stringify(drifted)),
      { roleName: ROLE_NAME, policyAuthority: authority },
    );

    expect(evidence.desired).toBe(false);
    expect(evidence.observedDigest).toEqual(
      createAwsSingleNodeRuntimeRolePolicyObservedStateDigest({
        policyDocument: drifted,
      }),
    );
    expect(evidence.observedDigest).not.toEqual(
      getAwsSingleNodeRuntimePolicyStateDigest(authority),
    );
  });

  it('classifies exact response identity contradictions separately from unreadable documents', () => {
    const authority = policyAuthority();
    const document = JSON.stringify(
      createAwsSingleNodeRuntimePolicy(authority),
    );

    expect(() =>
      decodeAwsSingleNodeRuntimeRolePolicyResponse(
        response(document, { RoleName: `${ROLE_NAME}-other` }),
        { roleName: ROLE_NAME, policyAuthority: authority },
      ),
    ).toThrow(AwsIamEvidenceConflictError);
    expect(() =>
      decodeAwsSingleNodeRuntimeRolePolicyResponse(response('%not-json'), {
        roleName: ROLE_NAME,
        policyAuthority: authority,
      }),
    ).toThrow(AwsIamEvidenceUnknownError);
  });

  it('decodes the complete natural slot inventory', () => {
    expect(decodeAwsSingleNodeRuntimeRolePolicyInventory([], [])).toEqual({
      listed: 'absent',
    });
    expect(
      decodeAwsSingleNodeRuntimeRolePolicyInventory(
        [AWS_SINGLE_NODE_RUNTIME_POLICY_NAME],
        [],
      ),
    ).toEqual({ listed: 'present' });
  });

  it.each([
    [['foreign-policy'], []],
    [[AWS_SINGLE_NODE_RUNTIME_POLICY_NAME, 'foreign-policy'], []],
    [
      [AWS_SINGLE_NODE_RUNTIME_POLICY_NAME],
      [
        {
          PolicyName: 'managed-policy',
          PolicyArn: 'arn:aws:iam::aws:policy/ReadOnlyAccess',
        },
      ],
    ],
  ])(
    'rejects an occupied contradictory role policy inventory',
    (inline, attached) => {
      expect(() =>
        decodeAwsSingleNodeRuntimeRolePolicyInventory(inline, attached),
      ).toThrow(AwsIamEvidenceConflictError);
    },
  );

  it('treats malformed inventory evidence as unknown', () => {
    expect(() =>
      decodeAwsSingleNodeRuntimeRolePolicyInventory(
        [AWS_SINGLE_NODE_RUNTIME_POLICY_NAME, 42],
        [],
      ),
    ).toThrow(AwsIamEvidenceUnknownError);
  });

  it('requires GetRolePolicy and ListRolePolicies to agree', () => {
    const inventory = decodeAwsSingleNodeRuntimeRolePolicyInventory([], []);
    expect(() =>
      corroborateAwsSingleNodeRuntimeRolePolicyEvidence(inventory, {
        desired: true,
        observedDigest: {
          algorithm: 'sha256',
          value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      }),
    ).toThrow(AwsIamEvidenceTransientError);
  });

  it('returns frozen present and absent corroborated evidence', () => {
    const authority = policyAuthority();
    const policy = decodeAwsSingleNodeRuntimeRolePolicyResponse(
      response(JSON.stringify(createAwsSingleNodeRuntimePolicy(authority))),
      { roleName: ROLE_NAME, policyAuthority: authority },
    );

    const present = corroborateAwsSingleNodeRuntimeRolePolicyEvidence(
      decodeAwsSingleNodeRuntimeRolePolicyInventory(
        [AWS_SINGLE_NODE_RUNTIME_POLICY_NAME],
        [],
      ),
      policy,
    );
    const absent = corroborateAwsSingleNodeRuntimeRolePolicyEvidence(
      decodeAwsSingleNodeRuntimeRolePolicyInventory([], []),
      null,
    );

    expect(present).toEqual({
      presence: 'present',
      observedDigest: policy.observedDigest,
      desired: true,
    });
    expect(absent).toEqual({
      presence: 'absent',
      observedDigest: null,
      desired: false,
    });
    expectDeepFrozen(present);
    expectDeepFrozen(absent);
  });
});
