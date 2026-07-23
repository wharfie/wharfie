import { describe, expect, it, jest } from '@jest/globals';

import { sortCanonicalJsonValue } from '../../src/core/runtime/canonical-order.js';
import { sha256Base64Url } from '../../src/core/runtime/content-id.js';
import {
  AWS_SINGLE_NODE_SECURITY_GROUP_BASE_TAGS,
  AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
  AWS_SINGLE_NODE_SECURITY_GROUP_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_SECURITY_GROUP_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_SECURITY_GROUP_NAME,
  AWS_SINGLE_NODE_SECURITY_GROUP_STATE_DIGEST_DOMAIN,
  createAwsSingleNodeSecurityGroupEvidenceKernel,
  createAwsSingleNodeSecurityGroupStateDigest,
  decodeAwsSingleNodeExactSecurityGroupResponse,
  decodeAwsSingleNodeSecurityGroupActualState,
  decodeAwsSingleNodeSecurityGroupDiscoveryPage,
  decodeAwsSingleNodeSecurityGroupIdentity,
  getAwsSingleNodeSecurityGroupStateDigest,
} from '../../src/core/runtime/deployment-aws-security-group-evidence.js';
import { getAwsSingleNodeSecurityGroupStateDigest as getResourceSecurityGroupStateDigest } from '../../src/core/runtime/deployment-aws-security-group-resource.js';
import {
  AwsTaggedEc2EvidenceConflictError,
  AwsTaggedEc2EvidenceTransientError,
  AwsTaggedEc2EvidenceUnknownError,
} from '../../src/core/runtime/deployment-aws-tagged-ec2-evidence.js';

/** @typedef {Record<string, any>} AnyRecord */

const ACCOUNT_ID = '123456789012';
const OTHER_ACCOUNT_ID = '999999999999';
const SECURITY_GROUP_IDS = Object.freeze({
  primary: 'sg-00000000000000001',
  other: 'sg-00000000000000002',
});
const VPC_IDS = Object.freeze({
  primary: 'vpc-00000000000000001',
  other: 'vpc-00000000000000002',
});
const EGRESS_CIDR = '0.0.0.0/0';
const PROVIDER_SCOPE = Object.freeze({
  schemaVersion: 1,
  kind: 'providerScope',
  partition: 'aws',
  accountId: ACCOUNT_ID,
  provider: Object.freeze({ kind: 'aws', version: 1 }),
  region: 'us-east-1',
  providerScopeId: 'wps1_security_group_evidence',
});
const ACTUAL_STATE_OPTIONS = Object.freeze({
  providerScope: PROVIDER_SCOPE,
  vpcId: VPC_IDS.primary,
  egressCidr: EGRESS_CIDR,
  allowPropagation: false,
});
const DESIRED_STATE = Object.freeze({
  groupName: AWS_SINGLE_NODE_SECURITY_GROUP_NAME,
  description: AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
  ingressRules: Object.freeze([]),
  egressRules: Object.freeze([
    Object.freeze({
      protocol: 'all',
      ports: 'all',
      destination: Object.freeze({
        kind: 'ipv4-cidr',
        value: EGRESS_CIDR,
      }),
    }),
  ]),
  onDestroy: 'purge',
});

/** @returns {AnyRecord} */
function defaultEgressRule() {
  return {
    IpProtocol: '-1',
    IpRanges: [{ CidrIp: EGRESS_CIDR }],
    Ipv6Ranges: [],
    PrefixListIds: [],
    UserIdGroupPairs: [],
  };
}

/** @param {AnyRecord} [overrides] @returns {AnyRecord} */
function makeSecurityGroup(overrides = {}) {
  return {
    Description: AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
    GroupId: SECURITY_GROUP_IDS.primary,
    GroupName: AWS_SINGLE_NODE_SECURITY_GROUP_NAME,
    IpPermissions: [],
    IpPermissionsEgress: [defaultEgressRule()],
    OwnerId: ACCOUNT_ID,
    SecurityGroupArn: `arn:aws:ec2:us-east-1:${ACCOUNT_ID}:security-group/${SECURITY_GROUP_IDS.primary}`,
    Tags: [],
    VpcId: VPC_IDS.primary,
    ...overrides,
  };
}

/** @param {any} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

/**
 * @param {Partial<{
 *   readDiscoveryPage: (request: AnyRecord) => Promise<unknown>,
 *   readExact: (id: string) => Promise<unknown>,
 * }>} [overrides]
 */
function makeKernel(overrides = {}) {
  return createAwsSingleNodeSecurityGroupEvidenceKernel({
    readDiscoveryPage: async () => ({ records: [], nextToken: null }),
    readExact: async () => null,
    ...overrides,
  });
}

/** @param {AnyRecord} [overrides] */
function decodeActual(overrides = {}) {
  return decodeAwsSingleNodeSecurityGroupActualState(
    makeSecurityGroup(overrides),
    ACTUAL_STATE_OPTIONS,
  );
}

describe('AWS single-node security-group evidence contract', () => {
  it('reuses the resource desired-state export and preserves exact digest bytes', () => {
    const digest = createAwsSingleNodeSecurityGroupStateDigest(DESIRED_STATE);
    const descriptor = sortCanonicalJsonValue({
      schemaVersion: 1,
      kind: 'awsSingleNodeEc2SecurityGroupState',
      ...DESIRED_STATE,
    });

    expect(getAwsSingleNodeSecurityGroupStateDigest).toBe(
      getResourceSecurityGroupStateDigest,
    );
    expect(digest).toEqual({
      algorithm: 'sha256',
      value: sha256Base64Url(
        `${AWS_SINGLE_NODE_SECURITY_GROUP_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
          descriptor,
        )}`,
      ),
    });
    expectDeepFrozen(digest);
  });

  it('canonicalizes direct rule sets and rejects malformed nested state', () => {
    const ingress = [
      {
        protocol: 'tcp',
        ports: { from: 443, to: 443 },
        destinations: [
          { kind: 'ipv6-cidr', value: '2001:db8::/64' },
          { kind: 'ipv4-cidr', value: '10.0.0.0/24' },
        ],
      },
      {
        protocol: 'tcp',
        ports: { from: 80, to: 80 },
        destinations: [{ kind: 'ipv4-cidr', value: '10.0.1.0/24' }],
      },
    ];
    const state = {
      groupName: AWS_SINGLE_NODE_SECURITY_GROUP_NAME,
      description: AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
      ingressRules: ingress,
      egressRules: [],
      onDestroy: 'purge',
    };
    const reordered = {
      ...state,
      ingressRules: [
        ingress[1],
        {
          ...ingress[0],
          destinations: [...ingress[0].destinations].reverse(),
        },
      ],
    };

    expect(createAwsSingleNodeSecurityGroupStateDigest(state)).toEqual(
      createAwsSingleNodeSecurityGroupStateDigest(reordered),
    );
    expect(() =>
      createAwsSingleNodeSecurityGroupStateDigest({
        ...state,
        ingressRules: [
          {
            protocol: 'tcp',
            ports: { from: 443, to: 443 },
            destinations: [{ kind: 'ipv4-cidr', value: undefined }],
          },
        ],
      }),
    ).toThrow(TypeError);
    expect(() =>
      createAwsSingleNodeSecurityGroupStateDigest({
        ...state,
        ingressRules: [ingress[0], ingress[0]],
      }),
    ).toThrow(/duplicate rule/i);
  });

  it('exposes one frozen stateless kernel over the generic evidence operations', () => {
    const kernel = makeKernel();

    expect(Object.keys(kernel).sort()).toEqual(
      [
        'discoverMany',
        'discoverNaturalSlot',
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
    expect(Object.isFrozen(AWS_SINGLE_NODE_SECURITY_GROUP_BASE_TAGS)).toBe(
      true,
    );
    expect(AWS_SINGLE_NODE_SECURITY_GROUP_BASE_TAGS).toEqual({
      'wharfie:managed-by': 'wharfie',
      'wharfie:resource-kind': 'single-node-security-group',
      'wharfie:retention': 'purge',
      'wharfie:schema-version': '2',
    });
  });

  it('rejects incomplete, unsupported, and wrong-type factories', () => {
    expect(() => createAwsSingleNodeSecurityGroupEvidenceKernel(null)).toThrow(
      TypeError,
    );
    expect(() =>
      createAwsSingleNodeSecurityGroupEvidenceKernel({
        readDiscoveryPage: async () => ({ records: [], nextToken: null }),
      }),
    ).toThrow(TypeError);
    expect(() =>
      createAwsSingleNodeSecurityGroupEvidenceKernel({
        readDiscoveryPage: async () => ({ records: [], nextToken: null }),
        readExact: async () => null,
        mutationPort: jest.fn(),
      }),
    ).toThrow(TypeError);
    expect(() =>
      createAwsSingleNodeSecurityGroupEvidenceKernel({
        readDiscoveryPage: null,
        readExact: async () => null,
      }),
    ).toThrow(TypeError);
  });

  it('returns deeply frozen identity and actual-state projections', () => {
    const identity = decodeAwsSingleNodeSecurityGroupIdentity(
      makeSecurityGroup(),
      PROVIDER_SCOPE,
      VPC_IDS.primary,
    );
    const actual = decodeActual();

    expect(identity).toEqual({
      providerResourceId: SECURITY_GROUP_IDS.primary,
      ownerId: ACCOUNT_ID,
      vpcId: VPC_IDS.primary,
      groupName: AWS_SINGLE_NODE_SECURITY_GROUP_NAME,
      description: AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
    });
    expect(actual).toEqual({
      ...identity,
      observedDigest:
        createAwsSingleNodeSecurityGroupStateDigest(DESIRED_STATE),
    });
    expectDeepFrozen(identity);
    expectDeepFrozen(actual);
  });
});

describe('AWS single-node security-group response envelopes', () => {
  it('decodes exactly one corroborated exact-ID record', () => {
    const securityGroup = makeSecurityGroup();

    expect(
      decodeAwsSingleNodeExactSecurityGroupResponse(
        { SecurityGroups: [securityGroup], NextToken: null },
        SECURITY_GROUP_IDS.primary,
      ),
    ).toBe(securityGroup);
  });

  it.each([
    ['a non-object envelope', null],
    ['a missing collection', {}],
    ['a wrong-type collection', { SecurityGroups: {} }],
    ['an empty exact result', { SecurityGroups: [] }],
    ['a malformed record', { SecurityGroups: [null] }],
  ])('maps %s to unknown', (_name, response) => {
    expect(() =>
      decodeAwsSingleNodeExactSecurityGroupResponse(
        response,
        SECURITY_GROUP_IDS.primary,
      ),
    ).toThrow(AwsTaggedEc2EvidenceUnknownError);
  });

  it.each([
    [
      'multiple exact records',
      {
        SecurityGroups: [
          makeSecurityGroup(),
          makeSecurityGroup({ GroupId: SECURITY_GROUP_IDS.other }),
        ],
      },
    ],
    [
      'a mismatched exact ID',
      {
        SecurityGroups: [
          makeSecurityGroup({ GroupId: SECURITY_GROUP_IDS.other }),
        ],
      },
    ],
    [
      'pagination on an exact read',
      { SecurityGroups: [makeSecurityGroup()], NextToken: 'unexpected' },
    ],
  ])('maps %s to conflict', (_name, response) => {
    expect(() =>
      decodeAwsSingleNodeExactSecurityGroupResponse(
        response,
        SECURITY_GROUP_IDS.primary,
      ),
    ).toThrow(AwsTaggedEc2EvidenceConflictError);
  });

  it('normalizes a strict discovery page without interpreting its records', () => {
    const securityGroup = makeSecurityGroup();

    expect(
      decodeAwsSingleNodeSecurityGroupDiscoveryPage({
        SecurityGroups: [securityGroup],
        NextToken: 'next-page',
      }),
    ).toEqual({
      records: [securityGroup],
      nextToken: 'next-page',
    });
    expect(
      decodeAwsSingleNodeSecurityGroupDiscoveryPage({
        SecurityGroups: [],
      }),
    ).toEqual({ records: [], nextToken: null });
  });

  it.each([
    ['a non-object envelope', null],
    ['a missing collection', {}],
    ['a wrong-type collection', { SecurityGroups: null }],
    ['a malformed record', { SecurityGroups: [null] }],
    [
      'a malformed provider ID',
      { SecurityGroups: [{ GroupId: 'sg-invalid' }] },
    ],
    ['an empty token', { SecurityGroups: [], NextToken: '' }],
    ['a non-string token', { SecurityGroups: [], NextToken: 1 }],
  ])('rejects %s as unknown discovery evidence', (_name, response) => {
    expect(() =>
      decodeAwsSingleNodeSecurityGroupDiscoveryPage(response),
    ).toThrow(AwsTaggedEc2EvidenceUnknownError);
  });
});

describe('AWS single-node security-group natural-slot evidence', () => {
  it('scans the whole VPC, paginates, and matches the natural name case-insensitively', async () => {
    const unrelated = makeSecurityGroup({
      GroupId: SECURITY_GROUP_IDS.other,
      GroupName: 'unrelated-application',
    });
    const occupant = makeSecurityGroup({
      GroupName: AWS_SINGLE_NODE_SECURITY_GROUP_NAME.toUpperCase(),
    });
    let page = 0;
    const readDiscoveryPage = jest.fn(
      async (/** @type {AnyRecord} */ _request) => {
        page += 1;
        return page === 1
          ? { records: [unrelated], nextToken: 'next-page' }
          : { records: [occupant], nextToken: null };
      },
    );
    const kernel = makeKernel({ readDiscoveryPage });

    await expect(
      kernel.discoverNaturalSlot({
        expectedOwnerId: ACCOUNT_ID,
        vpcId: VPC_IDS.primary,
      }),
    ).resolves.toBe(occupant);

    expect(readDiscoveryPage).toHaveBeenCalledTimes(2);
    expect(readDiscoveryPage.mock.calls[0][0]).toEqual({
      Filters: [{ Name: 'vpc-id', Values: [VPC_IDS.primary] }],
      MaxResults: AWS_SINGLE_NODE_SECURITY_GROUP_DISCOVERY_MAX_RESULTS,
    });
    expect(readDiscoveryPage.mock.calls[1][0]).toEqual({
      Filters: [{ Name: 'vpc-id', Values: [VPC_IDS.primary] }],
      MaxResults: AWS_SINGLE_NODE_SECURITY_GROUP_DISCOVERY_MAX_RESULTS,
      NextToken: 'next-page',
    });
    expect(
      readDiscoveryPage.mock.calls[0][0].Filters.map(
        (/** @type {AnyRecord} */ filter) => filter.Name,
      ),
    ).not.toContain('group-name');
    expectDeepFrozen(readDiscoveryPage.mock.calls[0][0]);
    expectDeepFrozen(readDiscoveryPage.mock.calls[1][0]);
  });

  it('returns null only after a complete empty natural-name scan', async () => {
    const readDiscoveryPage = jest.fn(async () => ({
      records: [
        makeSecurityGroup({
          GroupId: SECURITY_GROUP_IDS.other,
          GroupName: 'unrelated-application',
        }),
      ],
      nextToken: null,
    }));

    await expect(
      makeKernel({ readDiscoveryPage }).discoverNaturalSlot({
        expectedOwnerId: ACCOUNT_ID,
        vpcId: VPC_IDS.primary,
      }),
    ).resolves.toBeNull();
  });

  it.each([
    [
      'a foreign owner',
      [
        makeSecurityGroup({
          GroupName: 'unrelated-application',
          OwnerId: OTHER_ACCOUNT_ID,
        }),
      ],
    ],
    [
      'a different VPC',
      [
        makeSecurityGroup({
          GroupName: 'unrelated-application',
          VpcId: VPC_IDS.other,
        }),
      ],
    ],
    [
      'two case-folded occupants',
      [
        makeSecurityGroup(),
        makeSecurityGroup({
          GroupId: SECURITY_GROUP_IDS.other,
          GroupName: AWS_SINGLE_NODE_SECURITY_GROUP_NAME.toUpperCase(),
        }),
      ],
    ],
    ['a repeated provider ID', [makeSecurityGroup(), makeSecurityGroup()]],
  ])('conflicts on %s', async (_name, records) => {
    const kernel = makeKernel({
      readDiscoveryPage: async () => ({ records, nextToken: null }),
    });

    await expect(
      kernel.discoverNaturalSlot({
        expectedOwnerId: ACCOUNT_ID,
        vpcId: VPC_IDS.primary,
      }),
    ).rejects.toBeInstanceOf(AwsTaggedEc2EvidenceConflictError);
  });

  it('conflicts when a provider ID repeats across pages', async () => {
    const record = makeSecurityGroup({ GroupName: 'unrelated-application' });
    let page = 0;
    const kernel = makeKernel({
      readDiscoveryPage: async () => {
        page += 1;
        return page === 1
          ? { records: [record], nextToken: 'next' }
          : { records: [{ ...record }], nextToken: null };
      },
    });

    await expect(
      kernel.discoverNaturalSlot({
        expectedOwnerId: ACCOUNT_ID,
        vpcId: VPC_IDS.primary,
      }),
    ).rejects.toBeInstanceOf(AwsTaggedEc2EvidenceConflictError);
  });

  it('rejects repeated, malformed, and unbounded continuation tokens', async () => {
    let kernel = makeKernel({
      readDiscoveryPage: async () => ({
        records: [],
        nextToken: 'repeat',
      }),
    });
    await expect(
      kernel.discoverNaturalSlot({
        expectedOwnerId: ACCOUNT_ID,
        vpcId: VPC_IDS.primary,
      }),
    ).rejects.toBeInstanceOf(AwsTaggedEc2EvidenceUnknownError);

    kernel = makeKernel({
      readDiscoveryPage: async () => ({ records: [], nextToken: '' }),
    });
    await expect(
      kernel.discoverNaturalSlot({
        expectedOwnerId: ACCOUNT_ID,
        vpcId: VPC_IDS.primary,
      }),
    ).rejects.toBeInstanceOf(AwsTaggedEc2EvidenceUnknownError);

    let page = 0;
    const readDiscoveryPage = jest.fn(async () => {
      page += 1;
      return { records: [], nextToken: `page-${page}` };
    });
    kernel = makeKernel({ readDiscoveryPage });
    await expect(
      kernel.discoverNaturalSlot({
        expectedOwnerId: ACCOUNT_ID,
        vpcId: VPC_IDS.primary,
      }),
    ).rejects.toBeInstanceOf(AwsTaggedEc2EvidenceUnknownError);
    expect(readDiscoveryPage).toHaveBeenCalledTimes(
      AWS_SINGLE_NODE_SECURITY_GROUP_MAX_DISCOVERY_PAGES,
    );
  });

  it('sanitizes adapter failures while preserving evidence classes', async () => {
    const providerError = new Error('provider-secret');
    /** @type {AnyRecord} */ (providerError).credential = 'do-not-preserve';
    let kernel = makeKernel({
      readDiscoveryPage: async () => {
        throw providerError;
      },
    });
    const unknown = await kernel
      .discoverNaturalSlot({
        expectedOwnerId: ACCOUNT_ID,
        vpcId: VPC_IDS.primary,
      })
      .catch((/** @type {unknown} */ error) => error);
    expect(unknown).toBeInstanceOf(AwsTaggedEc2EvidenceUnknownError);
    expect(JSON.stringify(unknown)).not.toMatch(
      /provider-secret|do-not-preserve/u,
    );

    const conflict = new AwsTaggedEc2EvidenceConflictError();
    kernel = makeKernel({
      readDiscoveryPage: async () => {
        throw conflict;
      },
    });
    const sanitized = await kernel
      .discoverNaturalSlot({
        expectedOwnerId: ACCOUNT_ID,
        vpcId: VPC_IDS.primary,
      })
      .catch((/** @type {unknown} */ error) => error);
    expect(sanitized).toBeInstanceOf(AwsTaggedEc2EvidenceConflictError);
    expect(sanitized).not.toBe(conflict);
  });
});

describe('AWS single-node security-group actual state', () => {
  it('maps exact desired evidence to the desired digest', () => {
    const observed = decodeActual();

    expect(observed.observedDigest).toEqual(
      createAwsSingleNodeSecurityGroupStateDigest(DESIRED_STATE),
    );
    expect(observed.observedDigest.value).toHaveLength(43);
  });

  it('produces deterministic drift digests independent of provider array order', () => {
    const ingressRules = [
      {
        IpProtocol: 'tcp',
        FromPort: 22,
        ToPort: 22,
        IpRanges: [
          { CidrIp: '192.168.0.0/16', Description: 'office' },
          { CidrIp: '10.0.0.0/8' },
        ],
        Ipv6Ranges: [{ CidrIpv6: '2001:db8::/32' }],
        PrefixListIds: [
          { PrefixListId: 'pl-00000000000000001', Description: 'service' },
        ],
        UserIdGroupPairs: [
          {
            GroupId: SECURITY_GROUP_IDS.other,
            UserId: ACCOUNT_ID,
            VpcId: VPC_IDS.primary,
          },
        ],
      },
      {
        IpProtocol: 'udp',
        FromPort: 53,
        ToPort: 53,
        IpRanges: [{ CidrIp: '10.0.0.0/8' }],
      },
    ];
    const egressRules = [
      defaultEgressRule(),
      {
        IpProtocol: 'tcp',
        FromPort: 443,
        ToPort: 443,
        IpRanges: [{ CidrIp: '10.0.0.0/8' }],
      },
    ];
    const reorderedIngress = [...ingressRules].reverse().map((rule) => ({
      ...rule,
      ...(rule.IpRanges === undefined
        ? {}
        : { IpRanges: [...rule.IpRanges].reverse() }),
      ...(rule.Ipv6Ranges === undefined
        ? {}
        : { Ipv6Ranges: [...rule.Ipv6Ranges].reverse() }),
      ...(rule.PrefixListIds === undefined
        ? {}
        : { PrefixListIds: [...rule.PrefixListIds].reverse() }),
      ...(rule.UserIdGroupPairs === undefined
        ? {}
        : { UserIdGroupPairs: [...rule.UserIdGroupPairs].reverse() }),
    }));
    const first = decodeActual({
      IpPermissions: ingressRules,
      IpPermissionsEgress: egressRules,
    });
    const second = decodeActual({
      IpPermissions: reorderedIngress,
      IpPermissionsEgress: [...egressRules].reverse(),
    });

    expect(first.observedDigest).toEqual(second.observedDigest);
    expect(first.observedDigest).not.toEqual(
      createAwsSingleNodeSecurityGroupStateDigest(DESIRED_STATE),
    );
  });

  it.each([
    ['name', { GroupName: 'operator-security-group' }],
    ['description', { Description: 'Operator-edited description.' }],
    [
      'ingress rules',
      {
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: 22,
            ToPort: 22,
            IpRanges: [{ CidrIp: '10.0.0.0/8' }],
          },
        ],
      },
    ],
    [
      'egress rules',
      {
        IpPermissionsEgress: [
          {
            IpProtocol: 'tcp',
            FromPort: 443,
            ToPort: 443,
            IpRanges: [{ CidrIp: '10.0.0.0/8' }],
          },
        ],
      },
    ],
  ])('retains readable %s drift as a distinct digest', (_name, overrides) => {
    const edit = /** @type {AnyRecord} */ (overrides);
    const observed = decodeActual(overrides);

    expect(observed.observedDigest).not.toEqual(
      createAwsSingleNodeSecurityGroupStateDigest(DESIRED_STATE),
    );
    expect(observed.groupName).toBe(
      edit.GroupName ?? AWS_SINGLE_NODE_SECURITY_GROUP_NAME,
    );
    expect(observed.description).toBe(
      edit.Description ?? AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
    );
  });

  it('separates create-time empty-egress propagation from durable empty-egress drift', () => {
    const securityGroup = makeSecurityGroup({ IpPermissionsEgress: [] });

    expect(() =>
      decodeAwsSingleNodeSecurityGroupActualState(securityGroup, {
        ...ACTUAL_STATE_OPTIONS,
        allowPropagation: true,
      }),
    ).toThrow(AwsTaggedEc2EvidenceTransientError);

    const durable = decodeAwsSingleNodeSecurityGroupActualState(
      securityGroup,
      ACTUAL_STATE_OPTIONS,
    );
    expect(durable.observedDigest).not.toEqual(
      createAwsSingleNodeSecurityGroupStateDigest(DESIRED_STATE),
    );
    expectDeepFrozen(durable);
  });

  it.each([
    [
      'a non-network IPv4 CIDR',
      {
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: 22,
            ToPort: 22,
            IpRanges: [{ CidrIp: '10.0.0.1/24' }],
          },
        ],
      },
    ],
    [
      'a non-network IPv6 CIDR',
      {
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: 22,
            ToPort: 22,
            Ipv6Ranges: [{ CidrIpv6: '2001:db8::1/64' }],
          },
        ],
      },
    ],
    [
      'a missing protocol',
      {
        IpPermissions: [
          {
            FromPort: 22,
            ToPort: 22,
            IpRanges: [{ CidrIp: '10.0.0.0/8' }],
          },
        ],
      },
    ],
    [
      'a half-specified port range',
      {
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: 22,
            IpRanges: [{ CidrIp: '10.0.0.0/8' }],
          },
        ],
      },
    ],
    [
      'a reversed port range',
      {
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: 443,
            ToPort: 80,
            IpRanges: [{ CidrIp: '10.0.0.0/8' }],
          },
        ],
      },
    ],
    [
      'an unsupported rule field',
      {
        IpPermissions: [
          {
            IpProtocol: '-1',
            IpRanges: [],
            Unsupported: true,
          },
        ],
      },
    ],
    [
      'a malformed prefix-list ID',
      {
        IpPermissions: [
          {
            IpProtocol: '-1',
            PrefixListIds: [{ PrefixListId: 'pl-invalid' }],
          },
        ],
      },
    ],
    [
      'an empty security-group reference',
      {
        IpPermissions: [
          {
            IpProtocol: '-1',
            UserIdGroupPairs: [{}],
          },
        ],
      },
    ],
  ])('maps %s to unknown', (_name, overrides) => {
    expect(() => decodeActual(overrides)).toThrow(
      AwsTaggedEc2EvidenceUnknownError,
    );
  });

  it('maps malformed ARNs to unknown and valid contradictory ARNs to conflict', () => {
    expect(() => decodeActual({ SecurityGroupArn: 'not-an-arn' })).toThrow(
      AwsTaggedEc2EvidenceUnknownError,
    );
    expect(() => decodeActual({ SecurityGroupArn: 42 })).toThrow(
      AwsTaggedEc2EvidenceUnknownError,
    );

    expect(() =>
      decodeActual({
        SecurityGroupArn: `arn:aws:ec2:us-east-1:${OTHER_ACCOUNT_ID}:security-group/${SECURITY_GROUP_IDS.primary}`,
      }),
    ).toThrow(AwsTaggedEc2EvidenceConflictError);
    expect(() =>
      decodeActual({
        SecurityGroupArn: `arn:aws:ec2:us-east-1:${ACCOUNT_ID}:security-group/${SECURITY_GROUP_IDS.other}`,
      }),
    ).toThrow(AwsTaggedEc2EvidenceConflictError);
  });

  it.each([
    ['a foreign owner', { OwnerId: OTHER_ACCOUNT_ID }],
    ['a different VPC', { VpcId: VPC_IDS.other }],
  ])('maps %s to conflict', (_name, overrides) => {
    expect(() => decodeActual(overrides)).toThrow(
      AwsTaggedEc2EvidenceConflictError,
    );
  });

  it.each([
    ['a malformed group ID', { GroupId: 'sg-invalid' }],
    ['a malformed owner', { OwnerId: null }],
    ['a malformed VPC ID', { VpcId: 'vpc-invalid' }],
    ['a malformed name', { GroupName: null }],
    ['a malformed description', { Description: null }],
    ['a malformed ingress collection', { IpPermissions: null }],
    ['a malformed egress collection', { IpPermissionsEgress: null }],
  ])('maps %s to unknown', (_name, overrides) => {
    expect(() => decodeActual(overrides)).toThrow(
      AwsTaggedEc2EvidenceUnknownError,
    );
  });

  it('conflicts on duplicate normalized permissions and destinations', () => {
    const duplicateRule = {
      IpProtocol: 'tcp',
      FromPort: 22,
      ToPort: 22,
      IpRanges: [{ CidrIp: '10.0.0.0/8' }],
    };
    expect(() =>
      decodeActual({ IpPermissions: [duplicateRule, { ...duplicateRule }] }),
    ).toThrow(AwsTaggedEc2EvidenceConflictError);
    expect(() =>
      decodeActual({
        IpPermissions: [
          {
            ...duplicateRule,
            IpRanges: [{ CidrIp: '10.0.0.0/8' }, { CidrIp: '10.0.0.0/8' }],
          },
        ],
      }),
    ).toThrow(AwsTaggedEc2EvidenceConflictError);
  });

  it('requires exact actual-state options without mutating provider evidence', () => {
    const securityGroup = makeSecurityGroup();
    const before = structuredClone(securityGroup);

    expect(() =>
      decodeAwsSingleNodeSecurityGroupActualState(securityGroup, {
        ...ACTUAL_STATE_OPTIONS,
        extra: true,
      }),
    ).toThrow(TypeError);
    expect(() =>
      decodeAwsSingleNodeSecurityGroupActualState(securityGroup, {
        ...ACTUAL_STATE_OPTIONS,
        allowPropagation: 'yes',
      }),
    ).toThrow(TypeError);
    expect(() =>
      decodeAwsSingleNodeSecurityGroupActualState(securityGroup, {
        ...ACTUAL_STATE_OPTIONS,
        egressCidr: '10.0.0.1/24',
      }),
    ).toThrow(AwsTaggedEc2EvidenceUnknownError);
    expect(securityGroup).toEqual(before);
  });
});
