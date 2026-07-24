import { describe, expect, it } from '@jest/globals';

import {
  AwsSingleNodeDefaultIpv4RouteMissingLocalEvidenceError,
  createAwsSingleNodeDefaultIpv4RouteStateDigest,
  decodeAwsSingleNodeDefaultIpv4RouteEvidence,
  decodeAwsSingleNodeDefaultIpv4RouteGatewayEvidence,
} from '../../src/core/runtime/deployment-aws-default-ipv4-route-evidence.js';
import {
  AwsTaggedEc2EvidenceConflictError,
  AwsTaggedEc2EvidenceUnknownError,
} from '../../src/core/runtime/deployment-aws-tagged-ec2-evidence.js';

const IDS = Object.freeze({
  routeTable: 'rtb-00000000000000001',
  gateway: 'igw-00000000000000001',
  vpc: 'vpc-00000000000000001',
  subnet: 'subnet-00000000000000001',
  association: 'rtbassoc-00000000000000001',
});

/** @param {Record<string, any>} [changes] */
function routeTable(changes = {}) {
  return {
    RouteTableId: IDS.routeTable,
    OwnerId: '123456789012',
    VpcId: IDS.vpc,
    Routes: [
      {
        DestinationCidrBlock: '10.42.0.0/16',
        GatewayId: 'local',
        Origin: 'CreateRouteTable',
        State: 'active',
      },
      {
        DestinationCidrBlock: '0.0.0.0/0',
        GatewayId: IDS.gateway,
        Origin: 'CreateRoute',
        State: 'active',
      },
    ],
    Associations: [],
    PropagatingVgws: [],
    ...changes,
  };
}

/** @param {Record<string, any>} [changes] */
function gateway(changes = {}) {
  return {
    InternetGatewayId: IDS.gateway,
    OwnerId: '123456789012',
    Attachments: [{ VpcId: IDS.vpc, State: 'available' }],
    ...changes,
  };
}

const routeOptions = Object.freeze({
  destinationCidrBlock: '0.0.0.0/0',
  internetGatewayId: IDS.gateway,
  routeTableId: IDS.routeTable,
  vpcCidr: '10.42.0.0/16',
  allowSubnetAssociation: true,
});
const gatewayOptions = Object.freeze({
  internetGatewayId: IDS.gateway,
  ownerId: '123456789012',
  vpcId: IDS.vpc,
});

describe('AWS single-node default IPv4 route evidence', () => {
  it('hashes exact active and blackhole provider state', () => {
    const active = createAwsSingleNodeDefaultIpv4RouteStateDigest({
      destinationCidrBlock: '0.0.0.0/0',
      targetKind: 'internet-gateway',
      origin: 'CreateRoute',
      state: 'active',
      onDestroy: 'purge',
    });
    const blackhole = createAwsSingleNodeDefaultIpv4RouteStateDigest({
      destinationCidrBlock: '0.0.0.0/0',
      targetKind: 'internet-gateway',
      origin: 'CreateRoute',
      state: 'blackhole',
      onDestroy: 'purge',
    });

    expect(active).not.toEqual(blackhole);
    expect(Object.isFrozen(active)).toBe(true);
    expect(() =>
      createAwsSingleNodeDefaultIpv4RouteStateDigest({
        destinationCidrBlock: '0.0.0.0/0',
        targetKind: 'nat-gateway',
        origin: 'CreateRoute',
        state: 'active',
        onDestroy: 'purge',
      }),
    ).toThrow(/supported provider-observable route/);
  });

  it('decodes active and readable blackhole natural-slot presence', () => {
    const active = decodeAwsSingleNodeDefaultIpv4RouteEvidence(
      routeTable(),
      routeOptions,
    );
    const blackhole = decodeAwsSingleNodeDefaultIpv4RouteEvidence(
      routeTable({
        Routes: [
          routeTable().Routes[0],
          { ...routeTable().Routes[1], State: 'blackhole' },
        ],
      }),
      routeOptions,
    );

    expect(active.presence).toBe('present');
    expect(blackhole.presence).toBe('present');
    expect(active.observedDigest).not.toEqual(blackhole.observedDigest);
  });

  it('decodes one exact empty natural slot as absent', () => {
    expect(
      decodeAwsSingleNodeDefaultIpv4RouteEvidence(
        routeTable({ Routes: [routeTable().Routes[0]] }),
        routeOptions,
      ),
    ).toEqual({
      presence: 'absent',
      providerResourceId: IDS.routeTable,
      observedDigest: null,
    });
  });

  it.each([
    [
      'gateway target',
      {
        Routes: [
          routeTable().Routes[0],
          { ...routeTable().Routes[1], GatewayId: 'igw-00000000000000002' },
        ],
      },
    ],
    [
      'route origin',
      {
        Routes: [
          routeTable().Routes[0],
          { ...routeTable().Routes[1], Origin: 'Advertisement' },
        ],
      },
    ],
    [
      'propagation',
      { PropagatingVgws: [{ GatewayId: 'vgw-00000000000000001' }] },
    ],
  ])('rejects a contradictory %s', (_label, changes) => {
    expect(() =>
      decodeAwsSingleNodeDefaultIpv4RouteEvidence(
        routeTable(changes),
        routeOptions,
      ),
    ).toThrow(AwsTaggedEc2EvidenceConflictError);
  });

  it('distinguishes missing local propagation from malformed route state', () => {
    expect(() =>
      decodeAwsSingleNodeDefaultIpv4RouteEvidence(
        routeTable({ Routes: [routeTable().Routes[1]] }),
        routeOptions,
      ),
    ).toThrow(AwsSingleNodeDefaultIpv4RouteMissingLocalEvidenceError);
    expect(() =>
      decodeAwsSingleNodeDefaultIpv4RouteEvidence(
        routeTable({ Routes: [{}] }),
        routeOptions,
      ),
    ).toThrow(AwsTaggedEc2EvidenceUnknownError);
  });

  it('accepts one descendant association only when explicitly allowed', () => {
    const record = routeTable({
      Associations: [
        {
          Main: false,
          RouteTableAssociationId: IDS.association,
          RouteTableId: IDS.routeTable,
          SubnetId: IDS.subnet,
          AssociationState: { State: 'associated' },
        },
      ],
    });
    expect(
      decodeAwsSingleNodeDefaultIpv4RouteEvidence(record, routeOptions)
        .presence,
    ).toBe('present');
    expect(() =>
      decodeAwsSingleNodeDefaultIpv4RouteEvidence(record, {
        ...routeOptions,
        allowSubnetAssociation: false,
      }),
    ).toThrow(AwsTaggedEc2EvidenceConflictError);
  });

  it('decodes gateway attachment availability without hiding transition', () => {
    expect(
      decodeAwsSingleNodeDefaultIpv4RouteGatewayEvidence(
        gateway(),
        gatewayOptions,
      ),
    ).toEqual({
      providerResourceId: IDS.gateway,
      attachment: 'available',
    });
    expect(
      decodeAwsSingleNodeDefaultIpv4RouteGatewayEvidence(
        gateway({
          Attachments: [{ VpcId: IDS.vpc, State: 'detaching' }],
        }),
        gatewayOptions,
      ).attachment,
    ).toBe('transitional');
    expect(
      decodeAwsSingleNodeDefaultIpv4RouteGatewayEvidence(
        gateway({ Attachments: [] }),
        gatewayOptions,
      ).attachment,
    ).toBe('absent');
  });

  it('rejects foreign or ambiguous gateway attachment topology', () => {
    expect(() =>
      decodeAwsSingleNodeDefaultIpv4RouteGatewayEvidence(
        gateway({
          Attachments: [{ VpcId: 'vpc-00000000000000002', State: 'available' }],
        }),
        gatewayOptions,
      ),
    ).toThrow(AwsTaggedEc2EvidenceConflictError);
    expect(() =>
      decodeAwsSingleNodeDefaultIpv4RouteGatewayEvidence(
        gateway({
          Attachments: [
            { VpcId: IDS.vpc, State: 'available' },
            { VpcId: IDS.vpc, State: 'available' },
          ],
        }),
        gatewayOptions,
      ),
    ).toThrow(AwsTaggedEc2EvidenceConflictError);
  });
});
