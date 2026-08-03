import { describe, expect, it } from '@jest/globals';

import {
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_STATE_DIGEST_DOMAIN,
  AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError,
  AwsSingleNodeInternetGatewayAttachmentEvidenceTransientError,
  AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError,
  createAwsSingleNodeInternetGatewayAttachmentStateDigest,
  decodeAwsSingleNodeBroadInternetGatewayAttachmentState,
  decodeAwsSingleNodeExactInternetGatewayAttachmentResponse,
  decodeAwsSingleNodeExactInternetGatewayAttachmentState,
  decodeAwsSingleNodeInternetGatewayAttachmentDiscoveryPage,
  decodeAwsSingleNodeInternetGatewayAttachmentRecord,
  getAwsSingleNodeInternetGatewayAttachmentProviderResourceId,
  getAwsSingleNodeInternetGatewayAttachmentStrongestEvidenceError,
} from '../../src/core/runtime/deployment-aws-internet-gateway-attachment-evidence.js';
import {
  getAwsSingleNodeInternetGatewayAttachmentProviderResourceId as getMutationProviderResourceId,
  getAwsSingleNodeInternetGatewayAttachmentStateDigest as getMutationStateDigest,
} from '../../src/core/runtime/deployment-aws-internet-gateway-attachment-resource.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import {
  createAwsSingleNodeProvider,
  createDeploymentProfile,
} from '../../src/core/runtime/deployment-profile.js';
import { createAwsProviderScope } from '../../src/core/runtime/deployment-provider-scope.js';

const IDS = Object.freeze({
  internetGateway: 'igw-00000000000000001',
  otherInternetGateway: 'igw-00000000000000002',
  vpc: 'vpc-00000000000000001',
  otherVpc: 'vpc-00000000000000002',
});
const ACCOUNT_ID = '123456789012';

/** @returns {Readonly<Record<string, any>>} */
function providerSpec() {
  const profile = createDeploymentProfile({
    profile: { id: 'production' },
    appId: 'internet-gateway-attachment-evidence-test',
    target: {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
    mode: { kind: 'single-node-systemd-user', version: 1 },
    provider: createAwsSingleNodeProvider('us-east-1'),
  });
  const scope = createAwsProviderScope({
    partition: 'aws',
    accountId: ACCOUNT_ID,
    region: 'us-east-1',
  });
  return createAwsSingleNodeProviderSpec({
    profile,
    providerScope: scope,
    machineImage: {
      sourceParameter: {
        name: AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS.x86_64,
        version: 42,
      },
      imageId: 'ami-0123456789abcdef0',
      ownerAccountId: '137112412989',
      architecture: 'x86_64',
      imageType: 'machine',
      rootDeviceType: 'ebs',
      virtualizationType: 'hvm',
      enaSupport: true,
      rootDeviceName: '/dev/xvda',
      rootBlockDevice: {
        snapshotId: 'snap-0123456789abcdef0',
        volumeType: 'gp3',
        volumeSizeGiB: 8,
        encrypted: false,
        deleteOnTermination: true,
      },
    },
    placement: { availabilityZoneId: 'use1-az1' },
    storage: {
      ebsKmsKeyArn:
        'arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555',
    },
  });
}

/**
 * @param {{id?: string, ownerId?: string, vpcId?: string, state?: string, attachments?: unknown}} [options]
 */
function rawGateway(options = {}) {
  return {
    InternetGatewayId: options.id ?? IDS.internetGateway,
    OwnerId: options.ownerId ?? ACCOUNT_ID,
    Attachments: options.attachments ?? [
      {
        State: options.state ?? 'available',
        VpcId: options.vpcId ?? IDS.vpc,
      },
    ],
  };
}

describe('AWS single-node internet-gateway-attachment evidence', () => {
  it('preserves the existing digest and semantic provider identity domains', () => {
    const spec = providerSpec();
    const digest = createAwsSingleNodeInternetGatewayAttachmentStateDigest({
      state: 'available',
      onDestroy: 'purge',
    });

    expect(digest).toEqual(getMutationStateDigest(spec));
    expect(
      getAwsSingleNodeInternetGatewayAttachmentProviderResourceId(
        IDS.internetGateway,
        IDS.vpc,
      ),
    ).toBe(getMutationProviderResourceId(IDS.internetGateway, IDS.vpc));
    expect(
      AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_STATE_DIGEST_DOMAIN,
    ).toBe('wharfie:aws-single-node-ec2-internet-gateway-attachment-state:v1');
    expect(
      AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN,
    ).toBe('wharfie:aws-single-node-ec2-internet-gateway-attachment:v1');
    expect(
      AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
    ).toBe('wia1');
    expect(Object.isFrozen(digest)).toBe(true);
  });

  it('strictly decodes one exact response and its account identity', () => {
    const decoded = decodeAwsSingleNodeExactInternetGatewayAttachmentResponse(
      { InternetGateways: [rawGateway()] },
      IDS.internetGateway,
    );

    expect(decoded).toMatchObject({
      internetGatewayId: IDS.internetGateway,
      ownerId: ACCOUNT_ID,
      attachments: [{ state: 'available', vpcId: IDS.vpc }],
    });
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(() =>
      decodeAwsSingleNodeInternetGatewayAttachmentRecord(
        rawGateway({ ownerId: '123' }),
      ),
    ).toThrow(AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError);
  });

  it.each([
    [{ InternetGateways: [] }, 'unknown'],
    [
      {
        InternetGateways: [rawGateway()],
        NextToken: 'unexpected',
      },
      'conflict',
    ],
    [
      {
        InternetGateways: [
          rawGateway(),
          rawGateway({ id: IDS.otherInternetGateway }),
        ],
      },
      'conflict',
    ],
    [
      {
        InternetGateways: [rawGateway({ id: IDS.otherInternetGateway })],
      },
      'conflict',
    ],
  ])('fences exact response shape as %s evidence', (response, kind) => {
    const action = () =>
      decodeAwsSingleNodeExactInternetGatewayAttachmentResponse(
        response,
        IDS.internetGateway,
      );
    expect(action).toThrow(
      kind === 'conflict'
        ? AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError
        : AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError,
    );
  });

  it('decodes pagination while rejecting duplicate records', () => {
    expect(
      decodeAwsSingleNodeInternetGatewayAttachmentDiscoveryPage({
        InternetGateways: [rawGateway()],
        NextToken: 'next',
      }),
    ).toMatchObject({
      records: [{ internetGatewayId: IDS.internetGateway }],
      nextToken: 'next',
    });
    expect(() =>
      decodeAwsSingleNodeInternetGatewayAttachmentDiscoveryPage({
        InternetGateways: [rawGateway(), rawGateway()],
      }),
    ).toThrow(AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError);
  });

  it('classifies exact relationship state without treating transitions as settled', () => {
    const available =
      decodeAwsSingleNodeInternetGatewayAttachmentRecord(rawGateway());
    const free = decodeAwsSingleNodeInternetGatewayAttachmentRecord(
      rawGateway({ attachments: [] }),
    );
    const attaching = decodeAwsSingleNodeInternetGatewayAttachmentRecord(
      rawGateway({ state: 'attaching' }),
    );

    expect(
      decodeAwsSingleNodeExactInternetGatewayAttachmentState(
        available,
        ACCOUNT_ID,
        IDS.vpc,
      ),
    ).toBe('present');
    expect(
      decodeAwsSingleNodeExactInternetGatewayAttachmentState(
        free,
        ACCOUNT_ID,
        IDS.vpc,
      ),
    ).toBe('absent');
    expect(
      decodeAwsSingleNodeExactInternetGatewayAttachmentState(
        attaching,
        ACCOUNT_ID,
        IDS.vpc,
      ),
    ).toBe('transient');
  });

  it.each([
    ['another VPC', rawGateway({ vpcId: IDS.otherVpc }), ACCOUNT_ID],
    ['another owner', rawGateway(), '999999999999'],
  ])('rejects exact attachment to %s as conflict', (_label, raw, ownerId) => {
    const record = decodeAwsSingleNodeInternetGatewayAttachmentRecord(raw);
    expect(() =>
      decodeAwsSingleNodeExactInternetGatewayAttachmentState(
        record,
        ownerId,
        IDS.vpc,
      ),
    ).toThrow(AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError);
  });

  it('classifies the broad VPC occupancy view conservatively', () => {
    const present =
      decodeAwsSingleNodeInternetGatewayAttachmentRecord(rawGateway());
    const filteredButFree = decodeAwsSingleNodeInternetGatewayAttachmentRecord(
      rawGateway({ attachments: [] }),
    );

    expect(
      decodeAwsSingleNodeBroadInternetGatewayAttachmentState(
        [],
        IDS.internetGateway,
        ACCOUNT_ID,
        IDS.vpc,
      ),
    ).toBe('absent');
    expect(
      decodeAwsSingleNodeBroadInternetGatewayAttachmentState(
        [present],
        IDS.internetGateway,
        ACCOUNT_ID,
        IDS.vpc,
      ),
    ).toBe('present');
    expect(
      decodeAwsSingleNodeBroadInternetGatewayAttachmentState(
        [filteredButFree],
        IDS.internetGateway,
        ACCOUNT_ID,
        IDS.vpc,
      ),
    ).toBe('transient');
  });

  it.each([
    [
      'another gateway',
      [
        decodeAwsSingleNodeInternetGatewayAttachmentRecord(
          rawGateway({ id: IDS.otherInternetGateway }),
        ),
      ],
    ],
    [
      'multiple gateways',
      [
        decodeAwsSingleNodeInternetGatewayAttachmentRecord(rawGateway()),
        decodeAwsSingleNodeInternetGatewayAttachmentRecord(
          rawGateway({ id: IDS.otherInternetGateway }),
        ),
      ],
    ],
  ])('rejects broad occupancy by %s as conflict', (_label, records) => {
    expect(() =>
      decodeAwsSingleNodeBroadInternetGatewayAttachmentState(
        records,
        IDS.internetGateway,
        ACCOUNT_ID,
        IDS.vpc,
      ),
    ).toThrow(AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError);
  });

  it('gives conflict precedence over unknown and transient evidence', () => {
    expect(
      getAwsSingleNodeInternetGatewayAttachmentStrongestEvidenceError([
        new AwsSingleNodeInternetGatewayAttachmentEvidenceTransientError(),
        new AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError(),
        new AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError(),
      ]),
    ).toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError,
    );
    expect(
      getAwsSingleNodeInternetGatewayAttachmentStrongestEvidenceError([]),
    ).toBeNull();
  });
});
