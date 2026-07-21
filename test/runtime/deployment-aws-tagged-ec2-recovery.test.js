import { describe, expect, it, jest } from '@jest/globals';

import {
  AwsTaggedEc2RecoveryConflictError,
  AwsTaggedEc2RecoveryTransientError,
  AwsTaggedEc2RecoveryUnknownError,
  createAwsTaggedEc2RecoveryKernel,
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

/** @param {any} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

/** @param {{ownershipNonce?: string, priorBinding?: AnyRecord|null}} [options] @returns {AnyRecord} */
function makeAuthority(options = {}) {
  return {
    action: {
      actionId: 'waa1_action',
      capability: { kind: 'networking', version: 1 },
      resourceKey: 'network-vpc',
      role: { kind: 'vpc', version: 1 },
    },
    ownershipNonce: options.ownershipNonce ?? 'won1_nonce',
    plan: {
      deploymentInstanceId: 'wdi1_deployment',
      incarnationId: 'wic1_incarnation',
      providerScope: { providerScopeId: 'wps1_scope' },
    },
    priorBinding: options.priorBinding ?? null,
    stateDigest: { algorithm: 'sha256', value: 'state-digest' },
  };
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
 * @returns {ReturnType<typeof createAwsTaggedEc2RecoveryKernel>}
 */
function makeKernel(overrides = {}) {
  return createAwsTaggedEc2RecoveryKernel({
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

describe('AWS tagged EC2 recovery kernel tags', () => {
  it('builds the fixed schema-2 tags and frozen eight-filter locator', async () => {
    const authority = makeAuthority({
      priorBinding: {
        createdByActionId: 'waa1_original',
        providerResourceId: VPC_IDS.primary,
      },
    });
    const readDiscoveryPage = jest.fn(
      async (/** @type {AnyRecord} */ _request) => ({
        records: [],
        nextToken: null,
      }),
    );
    const kernel = makeKernel({ readDiscoveryPage });

    const required = kernel.requiredTags(authority);
    const sorted = kernel.sortedTags(required);
    await kernel.readIdentityEvidence(authority, { useDiscoveredId: false });

    expect(required).toEqual({
      ...BASE_TAGS,
      'wharfie:capability': 'networking',
      'wharfie:role': 'vpc',
      'wharfie:provider-scope-id': 'wps1_scope',
      'wharfie:deployment-instance-id': 'wdi1_deployment',
      'wharfie:incarnation-id': 'wic1_incarnation',
      'wharfie:resource-key': 'network-vpc',
      'wharfie:created-by-action-id': 'waa1_original',
      'wharfie:ownership-nonce': 'won1_nonce',
      'wharfie:state-digest': 'state-digest',
    });
    expect(sorted.map((/** @type {AnyRecord} */ tag) => tag.Key)).toEqual(
      Object.keys(required).sort(),
    );
    const request = readDiscoveryPage.mock.calls[0][0];
    expect(request).toMatchObject({ MaxResults: 100 });
    expect(request.Filters).toHaveLength(8);
    expect(request.Filters).toEqual(
      expect.arrayContaining([
        {
          Name: 'tag:wharfie:resource-key',
          Values: ['network-vpc'],
        },
        {
          Name: 'tag:wharfie:incarnation-id',
          Values: ['wic1_incarnation'],
        },
      ]),
    );
    expect(request.Filters).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ Name: 'tag:wharfie:ownership-nonce' }),
        expect.objectContaining({ Name: 'tag:wharfie:state-digest' }),
      ]),
    );
    expectDeepFrozen(required);
    expectDeepFrozen(sorted);
    expectDeepFrozen(request);
  });

  it('classifies complete, propagating, conflicting, and malformed tags', () => {
    const kernel = makeKernel();
    const expected = kernel.requiredTags(makeAuthority());
    const complete = [...kernel.sortedTags(expected)];

    expect(() =>
      kernel.validateTags(
        [...complete, { Key: 'operator-note', Value: 'allowed' }],
        expected,
        false,
      ),
    ).not.toThrow();
    expect(() => kernel.validateTags(undefined, expected, true)).toThrow(
      AwsTaggedEc2RecoveryTransientError,
    );
    expect(() => kernel.validateTags(null, expected, false)).toThrow(
      AwsTaggedEc2RecoveryConflictError,
    );
    expect(() => kernel.validateTags([], expected, true)).toThrow(
      AwsTaggedEc2RecoveryTransientError,
    );

    const wrong = complete.map((tag) => ({ ...tag }));
    wrong.find((tag) => tag.Key === 'wharfie:state-digest').Value = 'wrong';
    expect(() => kernel.validateTags(wrong, expected, true)).toThrow(
      AwsTaggedEc2RecoveryConflictError,
    );
    expect(() =>
      kernel.validateTags(
        [...complete, { Key: 'wharfie:unexpected', Value: 'owned?' }],
        expected,
        false,
      ),
    ).toThrow(AwsTaggedEc2RecoveryConflictError);
    expect(() =>
      kernel.validateTags([...complete, complete[0]], expected, false),
    ).toThrow(AwsTaggedEc2RecoveryConflictError);
    expect(() =>
      kernel.validateTags(
        [
          ...complete,
          ...Array.from({ length: 38 }, (_, index) => ({
            Key: `operator-${index}`,
            Value: 'value',
          })),
        ],
        expected,
        false,
      ),
    ).toThrow(AwsTaggedEc2RecoveryConflictError);
    expect(() =>
      kernel.validateTags(
        [{ Key: 'wharfie:managed-by', Value: { provider: 'secret' } }],
        expected,
        false,
      ),
    ).toThrow(AwsTaggedEc2RecoveryUnknownError);
  });

  it('rejects a loose or non-schema-2 factory contract', () => {
    expect(() =>
      createAwsTaggedEc2RecoveryKernel({
        baseTags: { ...BASE_TAGS, 'wharfie:schema-version': '1' },
        discoveryMaxResults: 100,
        idKey: 'VpcId',
        idPattern: /^vpc-/,
        maxDiscoveryPages: 16,
        maxTags: 50,
        readDiscoveryPage: async () => ({ records: [], nextToken: null }),
        readExact: async () => null,
      }),
    ).toThrow(TypeError);
    expect(() => makeKernel({ idPattern: /vpc-/g })).toThrow(TypeError);
    expect(() =>
      makeKernel(
        /** @type {any} */ ({
          unsupported: true,
        }),
      ),
    ).toThrow(TypeError);
  });
});

describe('AWS tagged EC2 recovery kernel identity reads', () => {
  it('follows frozen bounded pages and corroborates a discovered identity', async () => {
    const record = { VpcId: VPC_IDS.primary, OwnerId: '123456789012' };
    let page = 0;
    const readDiscoveryPage = jest.fn(
      async (/** @type {AnyRecord} */ _request) => {
        page += 1;
        return page === 1
          ? { records: [], nextToken: 'next' }
          : { records: [record], nextToken: null };
      },
    );
    const readExact = jest.fn(async (/** @type {string} */ _id) => record);
    const kernel = makeKernel({ readDiscoveryPage, readExact });

    const evidence = await kernel.readIdentityEvidence(makeAuthority(), {
      useDiscoveredId: true,
    });

    expect(evidence).toEqual({
      discovered: record,
      exact: record,
      exactId: VPC_IDS.primary,
    });
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(readDiscoveryPage).toHaveBeenCalledTimes(2);
    expect(readDiscoveryPage.mock.calls[1][0]).toMatchObject({
      MaxResults: 100,
      NextToken: 'next',
    });
    expectDeepFrozen(readDiscoveryPage.mock.calls[1][0]);
    expect(readExact).toHaveBeenCalledTimes(1);
    expect(readExact).toHaveBeenCalledWith(VPC_IDS.primary);
  });

  it('leaves discovery uncorroborated when the caller does not select its ID', async () => {
    const record = { VpcId: VPC_IDS.primary };
    const readExact = jest.fn(async () => record);
    const kernel = makeKernel({
      readDiscoveryPage: async () => ({
        records: [record],
        nextToken: null,
      }),
      readExact,
    });

    await expect(
      kernel.readIdentityEvidence(makeAuthority(), {
        useDiscoveredId: false,
      }),
    ).resolves.toEqual({ discovered: record, exact: null, exactId: null });
    expect(readExact).not.toHaveBeenCalled();
  });

  it('rejects duplicate, multiple, and mismatched logical identities', async () => {
    const primary = { VpcId: VPC_IDS.primary };
    const duplicate = { VpcId: VPC_IDS.duplicate };
    const multipleRead = jest.fn(async (/** @type {AnyRecord} */ request) => {
      if (request.NextToken === undefined) {
        return {
          records: [primary, duplicate],
          nextToken: 'unneeded',
        };
      }
      throw new Error('later-page-secret');
    });
    let kernel = makeKernel({
      readDiscoveryPage: multipleRead,
    });
    await expect(
      kernel.readIdentityEvidence(makeAuthority(), { useDiscoveredId: true }),
    ).rejects.toBeInstanceOf(AwsTaggedEc2RecoveryConflictError);
    expect(multipleRead).toHaveBeenCalledTimes(1);

    let page = 0;
    kernel = makeKernel({
      readDiscoveryPage: async () => {
        page += 1;
        return page === 1
          ? { records: [primary], nextToken: 'next' }
          : { records: [primary], nextToken: null };
      },
    });
    await expect(
      kernel.readIdentityEvidence(makeAuthority(), { useDiscoveredId: true }),
    ).rejects.toBeInstanceOf(AwsTaggedEc2RecoveryConflictError);

    const readExact = jest.fn(async () => primary);
    kernel = makeKernel({
      readDiscoveryPage: async () => ({
        records: [duplicate],
        nextToken: null,
      }),
      readExact,
    });
    await expect(
      kernel.readIdentityEvidence(
        makeAuthority({
          priorBinding: {
            createdByActionId: 'waa1_original',
            providerResourceId: VPC_IDS.primary,
          },
        }),
        { useDiscoveredId: false },
      ),
    ).rejects.toBeInstanceOf(AwsTaggedEc2RecoveryConflictError);
    expect(readExact).not.toHaveBeenCalled();
  });

  it('rejects malformed, cyclic, and over-bound discovery', async () => {
    let kernel = makeKernel({
      readDiscoveryPage: async () => ({ records: [], nextToken: '' }),
    });
    await expect(
      kernel.readIdentityEvidence(makeAuthority(), { useDiscoveredId: false }),
    ).rejects.toBeInstanceOf(AwsTaggedEc2RecoveryUnknownError);

    kernel = makeKernel({
      readDiscoveryPage: async () => ({ records: [{}], nextToken: null }),
    });
    await expect(
      kernel.readIdentityEvidence(makeAuthority(), { useDiscoveredId: false }),
    ).rejects.toBeInstanceOf(AwsTaggedEc2RecoveryUnknownError);

    kernel = makeKernel({
      readDiscoveryPage: async () => ({
        records: [],
        nextToken: 'same',
      }),
    });
    await expect(
      kernel.readIdentityEvidence(makeAuthority(), { useDiscoveredId: false }),
    ).rejects.toBeInstanceOf(AwsTaggedEc2RecoveryUnknownError);

    const boundedRead = jest.fn(async () => ({
      records: [],
      nextToken: 'continue',
    }));
    kernel = makeKernel({
      maxDiscoveryPages: 1,
      readDiscoveryPage: boundedRead,
    });
    await expect(
      kernel.readIdentityEvidence(makeAuthority(), { useDiscoveredId: false }),
    ).rejects.toBeInstanceOf(AwsTaggedEc2RecoveryUnknownError);
    expect(boundedRead).toHaveBeenCalledTimes(1);
  });

  it('accepts exact typed absence from the adapter and sanitizes other failures', async () => {
    const record = { VpcId: VPC_IDS.primary };
    const discovery = async () => ({ records: [record], nextToken: null });
    let kernel = makeKernel({
      readDiscoveryPage: discovery,
      readExact: async () => null,
    });
    await expect(
      kernel.readIdentityEvidence(makeAuthority(), { useDiscoveredId: true }),
    ).resolves.toEqual({
      discovered: record,
      exact: null,
      exactId: VPC_IDS.primary,
    });

    kernel = makeKernel({
      readDiscoveryPage: discovery,
      readExact: async () => ({ VpcId: VPC_IDS.duplicate }),
    });
    await expect(
      kernel.readIdentityEvidence(makeAuthority(), { useDiscoveredId: true }),
    ).rejects.toBeInstanceOf(AwsTaggedEc2RecoveryConflictError);

    kernel = makeKernel({
      readDiscoveryPage: async () => {
        throw new Error('provider-secret');
      },
    });
    const observed = await kernel
      .readIdentityEvidence(makeAuthority(), { useDiscoveredId: false })
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(AwsTaggedEc2RecoveryUnknownError);
    expect(JSON.stringify(observed)).not.toContain('provider-secret');

    const conflict = new AwsTaggedEc2RecoveryConflictError();
    /** @type {AnyRecord} */ (conflict).providerSecret = 'do-not-preserve';
    kernel = makeKernel({
      readDiscoveryPage: async () => {
        throw conflict;
      },
    });
    const sanitized = await kernel
      .readIdentityEvidence(makeAuthority(), { useDiscoveredId: false })
      .catch((/** @type {unknown} */ error) => error);
    expect(sanitized).toBeInstanceOf(AwsTaggedEc2RecoveryConflictError);
    expect(sanitized).not.toBe(conflict);
    expect(JSON.stringify(sanitized)).not.toContain('do-not-preserve');
  });
});

describe('AWS tagged EC2 recovery kernel create fence', () => {
  it('keys attempted effects and candidates by action ID plus ownership nonce', async () => {
    const authority = makeAuthority();
    const advanced = makeAuthority({ ownershipNonce: 'won1_advanced' });
    const readExact = jest.fn(async (id) => ({ VpcId: id }));
    const kernel = makeKernel({ readExact });

    expect(kernel.claimCreateAttempt(authority)).toBe(true);
    expect(kernel.claimCreateAttempt(authority)).toBe(false);
    expect(kernel.claimCreateAttempt(advanced)).toBe(true);
    kernel.rememberCandidate(authority, VPC_IDS.primary);
    await expect(
      kernel.readIdentityEvidence(authority, { useDiscoveredId: false }),
    ).resolves.toEqual({
      discovered: null,
      exact: { VpcId: VPC_IDS.primary },
      exactId: VPC_IDS.primary,
    });
    expect(readExact).toHaveBeenCalledWith(VPC_IDS.primary);
    expect(() =>
      kernel.rememberCandidate(authority, VPC_IDS.duplicate),
    ).toThrow(AwsTaggedEc2RecoveryConflictError);

    kernel.clearCandidate(authority);
    await expect(
      kernel.readIdentityEvidence(authority, { useDiscoveredId: false }),
    ).resolves.toEqual({ discovered: null, exact: null, exactId: null });
    expect(kernel.claimCreateAttempt(authority)).toBe(false);
  });

  it('requires a claimed boundary and a valid candidate locator', () => {
    const authority = makeAuthority();
    const kernel = makeKernel();

    expect(() => kernel.rememberCandidate(authority, VPC_IDS.primary)).toThrow(
      TypeError,
    );
    expect(kernel.claimCreateAttempt(authority)).toBe(true);
    expect(() =>
      kernel.rememberCandidate(authority, 'provider-secret'),
    ).toThrow(AwsTaggedEc2RecoveryUnknownError);
    expect(
      JSON.stringify(new AwsTaggedEc2RecoveryUnknownError()),
    ).not.toContain('provider-secret');
    expect(Object.isFrozen(kernel)).toBe(true);
  });
});
