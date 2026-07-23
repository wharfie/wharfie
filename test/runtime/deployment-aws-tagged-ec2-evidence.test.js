import { describe, expect, it, jest } from '@jest/globals';

import {
  AwsTaggedEc2EvidenceConflictError,
  AwsTaggedEc2EvidenceTransientError,
  AwsTaggedEc2EvidenceUnknownError,
  createAwsTaggedEc2EvidenceKernel,
} from '../../src/core/runtime/deployment-aws-tagged-ec2-evidence.js';
import {
  AwsTaggedEc2RecoveryConflictError,
  AwsTaggedEc2RecoveryTransientError,
  AwsTaggedEc2RecoveryUnknownError,
} from '../../src/core/runtime/deployment-aws-tagged-ec2-recovery.js';

/** @typedef {Record<string, any>} AnyRecord */

const VPC_IDS = Object.freeze({
  primary: 'vpc-00000000000000001',
  duplicate: 'vpc-00000000000000002',
});
const BASE_TAGS = Object.freeze({
  'wharfie:managed-by': 'wharfie',
  'wharfie:resource-kind': 'single-node-vpc',
  'wharfie:retention': 'purge',
  'wharfie:schema-version': '2',
});
const LOCATOR = Object.freeze({
  capabilityKind: 'networking',
  roleKind: 'vpc',
  providerScopeId: 'wps1_scope',
  deploymentInstanceId: 'wdi1_deployment',
  incarnationId: 'wic1_incarnation',
  resourceKey: 'network-vpc',
});
const OWNERSHIP = Object.freeze({
  ...LOCATOR,
  createdByActionId: 'waa1_action',
  ownershipNonce: 'won1_nonce',
  stateDigestValue: 'state-digest',
});

/** @param {any} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

/**
 * @param {Partial<{
 *   baseTags: AnyRecord,
 *   discoveryMaxResults: number,
 *   idKey: string,
 *   idPattern: RegExp,
 *   maxDiscoveryPages: number,
 *   maxTags: number,
 *   readDiscoveryPage: (request: AnyRecord) => Promise<unknown>,
 *   readExact: (id: string) => Promise<unknown>,
 * }>} [overrides]
 * @returns {ReturnType<typeof createAwsTaggedEc2EvidenceKernel>}
 */
function makeKernel(overrides = {}) {
  return createAwsTaggedEc2EvidenceKernel({
    baseTags: BASE_TAGS,
    discoveryMaxResults: 100,
    idKey: 'VpcId',
    idPattern: /^vpc-[0-9a-f]{8,32}$/,
    maxDiscoveryPages: 16,
    maxTags: 50,
    readDiscoveryPage: async () => ({ records: [], nextToken: null }),
    readExact: async () => null,
    ...overrides,
  });
}

describe('AWS tagged EC2 evidence kernel contract', () => {
  it('exposes only frozen stateless evidence operations and legacy error aliases', () => {
    const kernel = makeKernel();

    expect(Object.keys(kernel).sort()).toEqual(
      [
        'discoverMany',
        'discoveryFilters',
        'locatorTags',
        'ownershipTags',
        'readExactSafely',
        'resourceId',
        'sortedTags',
        'validateCollisionTags',
        'validateTags',
      ].sort(),
    );
    expect(Object.isFrozen(kernel)).toBe(true);
    expect(AwsTaggedEc2RecoveryConflictError).toBe(
      AwsTaggedEc2EvidenceConflictError,
    );
    expect(AwsTaggedEc2RecoveryTransientError).toBe(
      AwsTaggedEc2EvidenceTransientError,
    );
    expect(AwsTaggedEc2RecoveryUnknownError).toBe(
      AwsTaggedEc2EvidenceUnknownError,
    );
    expect(new AwsTaggedEc2EvidenceUnknownError()).toMatchObject({
      name: 'AwsTaggedEc2EvidenceUnknownError',
      code: 'AWS_TAGGED_EC2_EVIDENCE_UNKNOWN',
    });
  });

  it('derives exact frozen locator, ownership, sorted-tag, and filter values', () => {
    const kernel = makeKernel();
    const locatorTags = kernel.locatorTags(LOCATOR);
    const ownershipTags = kernel.ownershipTags(OWNERSHIP);
    const sortedTags = kernel.sortedTags(ownershipTags);
    const filters = kernel.discoveryFilters(LOCATOR);

    expect(locatorTags).toEqual({
      ...BASE_TAGS,
      'wharfie:capability': 'networking',
      'wharfie:role': 'vpc',
      'wharfie:provider-scope-id': 'wps1_scope',
      'wharfie:deployment-instance-id': 'wdi1_deployment',
      'wharfie:incarnation-id': 'wic1_incarnation',
      'wharfie:resource-key': 'network-vpc',
    });
    expect(ownershipTags).toEqual({
      ...locatorTags,
      'wharfie:created-by-action-id': 'waa1_action',
      'wharfie:ownership-nonce': 'won1_nonce',
      'wharfie:state-digest': 'state-digest',
    });
    expect(sortedTags.map((/** @type {AnyRecord} */ tag) => tag.Key)).toEqual(
      Object.keys(ownershipTags).sort(),
    );
    expect(filters).toHaveLength(8);
    expect(filters).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ Name: 'tag:wharfie:ownership-nonce' }),
        expect.objectContaining({ Name: 'tag:wharfie:state-digest' }),
      ]),
    );
    expectDeepFrozen(locatorTags);
    expectDeepFrozen(ownershipTags);
    expectDeepFrozen(sortedTags);
    expectDeepFrozen(filters);
    expect(kernel.resourceId({ VpcId: VPC_IDS.primary })).toBe(VPC_IDS.primary);
    expect(() =>
      kernel.locatorTags(
        /** @type {any} */ ({ ...LOCATOR, action: { actionId: 'forged' } }),
      ),
    ).toThrow(TypeError);
  });
});

describe('AWS tagged EC2 collision evidence', () => {
  it('accepts complete locator evidence with receipt and operator tags', () => {
    const kernel = makeKernel();
    const expected = kernel.locatorTags(LOCATOR);
    const observed = [
      ...kernel.sortedTags(expected),
      { Key: 'wharfie:created-by-action-id', Value: 'waa1_other' },
      { Key: 'wharfie:ownership-nonce', Value: 'won1_other' },
      { Key: 'wharfie:state-digest', Value: 'other-digest' },
      { Key: 'operator-note', Value: 'allowed' },
    ];

    expect(() =>
      kernel.validateCollisionTags(observed, expected),
    ).not.toThrow();
  });

  it('separates unknown incomplete evidence from contradictory evidence', () => {
    const kernel = makeKernel();
    const expected = kernel.locatorTags(LOCATOR);
    const complete = [...kernel.sortedTags(expected)];
    const incomplete = complete.filter(
      (tag) => tag.Key !== 'wharfie:resource-key',
    );

    expect(() => kernel.validateCollisionTags(undefined, expected)).toThrow(
      AwsTaggedEc2EvidenceUnknownError,
    );
    expect(() =>
      kernel.validateCollisionTags(
        [{ Key: 'wharfie:managed-by', Value: /** @type {any} */ ({}) }],
        expected,
      ),
    ).toThrow(AwsTaggedEc2EvidenceUnknownError);
    expect(() => kernel.validateCollisionTags(incomplete, expected)).toThrow(
      AwsTaggedEc2EvidenceUnknownError,
    );
    expect(() =>
      kernel.validateCollisionTags([...complete, complete[0]], expected),
    ).toThrow(AwsTaggedEc2EvidenceConflictError);

    const wrong = complete.map((tag) => ({ ...tag }));
    wrong.find((tag) => tag.Key === 'wharfie:resource-key').Value = 'wrong';
    expect(() => kernel.validateCollisionTags(wrong, expected)).toThrow(
      AwsTaggedEc2EvidenceConflictError,
    );
    expect(() =>
      kernel.validateCollisionTags(
        [...complete, { Key: 'wharfie:unexpected', Value: 'owned?' }],
        expected,
      ),
    ).toThrow(AwsTaggedEc2EvidenceConflictError);
  });
});

describe('AWS tagged EC2 bounded reads', () => {
  it('returns plural identities across frozen pages without mutation state', async () => {
    const primary = { VpcId: VPC_IDS.primary };
    const duplicate = { VpcId: VPC_IDS.duplicate };
    let page = 0;
    const readDiscoveryPage = jest.fn(
      async (/** @type {AnyRecord} */ _request) => {
        page += 1;
        return page === 1
          ? { records: [primary], nextToken: 'next' }
          : { records: [duplicate], nextToken: 'unneeded' };
      },
    );
    const kernel = makeKernel({ readDiscoveryPage });

    const records = await kernel.discoverMany(LOCATOR);

    expect(records).toEqual([primary, duplicate]);
    expect(Object.isFrozen(records)).toBe(true);
    expect(readDiscoveryPage).toHaveBeenCalledTimes(2);
    expect(readDiscoveryPage.mock.calls[0][0]).toMatchObject({
      MaxResults: 100,
    });
    expect(readDiscoveryPage.mock.calls[1][0]).toMatchObject({
      MaxResults: 100,
      NextToken: 'next',
    });
    expectDeepFrozen(readDiscoveryPage.mock.calls[0][0]);
    expectDeepFrozen(readDiscoveryPage.mock.calls[1][0]);
  });

  it('rejects duplicate IDs and unsafe pagination', async () => {
    const record = { VpcId: VPC_IDS.primary };
    let page = 0;
    let kernel = makeKernel({
      readDiscoveryPage: async () => {
        page += 1;
        return page === 1
          ? { records: [record], nextToken: 'next' }
          : { records: [record], nextToken: null };
      },
    });
    await expect(kernel.discoverMany(LOCATOR)).rejects.toBeInstanceOf(
      AwsTaggedEc2EvidenceConflictError,
    );

    kernel = makeKernel({
      readDiscoveryPage: async () => ({
        records: [],
        nextToken: 'same',
      }),
    });
    await expect(kernel.discoverMany(LOCATOR)).rejects.toBeInstanceOf(
      AwsTaggedEc2EvidenceUnknownError,
    );
  });

  it('accepts exact absence and sanitizes mismatches and adapter failures', async () => {
    const readExact = jest.fn(async (/** @type {string} */ _id) => null);
    let kernel = makeKernel({ readExact });

    await expect(kernel.readExactSafely(VPC_IDS.primary)).resolves.toBeNull();
    expect(readExact).toHaveBeenCalledWith(VPC_IDS.primary);

    kernel = makeKernel({
      readExact: async () => ({ VpcId: VPC_IDS.duplicate }),
    });
    await expect(
      kernel.readExactSafely(VPC_IDS.primary),
    ).rejects.toBeInstanceOf(AwsTaggedEc2EvidenceConflictError);

    const providerError = new Error('provider-secret');
    /** @type {AnyRecord} */ (providerError).response = {
      credential: 'do-not-preserve',
    };
    kernel = makeKernel({
      readExact: async () => {
        throw providerError;
      },
    });
    const sanitized = await kernel
      .readExactSafely(VPC_IDS.primary)
      .catch((/** @type {unknown} */ error) => error);
    expect(sanitized).toBeInstanceOf(AwsTaggedEc2EvidenceUnknownError);
    expect(JSON.stringify(sanitized)).not.toContain('provider-secret');
    expect(JSON.stringify(sanitized)).not.toContain('do-not-preserve');
  });
});
