import { describe, expect, it, jest } from '@jest/globals';

import {
  AWS_SINGLE_NODE_ROUTE_TABLE_STATE_DIGEST_DOMAIN,
  createAwsSingleNodeRouteTableEvidenceKernel,
  createAwsSingleNodeRouteTableStateDigest,
  decodeAwsSingleNodeCreateRouteTableCandidateId,
  decodeAwsSingleNodeExactRouteTableResponse,
  decodeAwsSingleNodeRouteTableActualState,
  decodeAwsSingleNodeRouteTableDiscoveryPage,
  decodeAwsSingleNodeRouteTableIdentity,
  decodeAwsSingleNodeRouteTableRecordState,
} from '../../src/core/runtime/deployment-aws-route-table-evidence.js';
import {
  AwsTaggedEc2EvidenceConflictError,
  AwsTaggedEc2EvidenceTransientError,
  AwsTaggedEc2EvidenceUnknownError,
} from '../../src/core/runtime/deployment-aws-tagged-ec2-evidence.js';

const ROUTE_TABLE_ID = 'rtb-00000000000000001';
const OTHER_ROUTE_TABLE_ID = 'rtb-00000000000000002';
const VPC_ID = 'vpc-00000000000000001';
const ASSOCIATION_ID = 'rtbassoc-00000000000000001';
const SUBNET_ID = 'subnet-00000000000000001';
const INTERNET_GATEWAY_ID = 'igw-00000000000000001';
const CLIENT_TOKEN = 'a'.repeat(64);

/** @returns {Readonly<Record<string, any>>} */
function localRoute() {
  return Object.freeze({
    DestinationCidrBlock: '10.42.0.0/16',
    GatewayId: 'local',
    Origin: 'CreateRouteTable',
    State: 'active',
  });
}

/** @returns {Readonly<Record<string, any>>} */
function defaultRoute() {
  return Object.freeze({
    DestinationCidrBlock: '0.0.0.0/0',
    GatewayId: INTERNET_GATEWAY_ID,
    Origin: 'CreateRoute',
    State: 'active',
  });
}

/** @returns {Readonly<Record<string, any>>} */
function subnetAssociation() {
  return Object.freeze({
    AssociationState: { State: 'associated' },
    Main: false,
    RouteTableAssociationId: ASSOCIATION_ID,
    RouteTableId: ROUTE_TABLE_ID,
    SubnetId: SUBNET_ID,
  });
}

/** @param {Record<string, any>} [overrides] @returns {Readonly<Record<string, any>>} */
function routeTable(overrides = {}) {
  return Object.freeze({
    Associations: [],
    OwnerId: '123456789012',
    PropagatingVgws: [],
    RouteTableId: ROUTE_TABLE_ID,
    Routes: [localRoute()],
    Tags: [],
    VpcId: VPC_ID,
    ...overrides,
  });
}

/** @param {string[]} propagatingVirtualGateways */
function stateDescriptor(propagatingVirtualGateways = []) {
  return {
    localIpv4Route: {
      destinationCidrBlock: '10.42.0.0/16',
      gatewayId: 'local',
      origin: 'CreateRouteTable',
      state: 'active',
    },
    main: false,
    propagatingVirtualGateways,
    onDestroy: 'purge',
  };
}

describe('AWS single-node route-table digest evidence', () => {
  it('locks the desired descriptor domain and digest bytes', () => {
    expect(AWS_SINGLE_NODE_ROUTE_TABLE_STATE_DIGEST_DOMAIN).toBe(
      'wharfie:aws-single-node-ec2-route-table-state:v1',
    );
    expect(createAwsSingleNodeRouteTableStateDigest(stateDescriptor())).toEqual(
      {
        algorithm: 'sha256',
        value: 'NJXSJlDCL_-8klOoGtJakMrNRej1xYkGwo5UnfGaFCA',
      },
    );
  });

  it('canonicalizes propagation order and rejects duplicate gateways', () => {
    const first = createAwsSingleNodeRouteTableStateDigest(
      stateDescriptor(['vgw-00000000000000002', 'vgw-00000000000000001']),
    );
    const second = createAwsSingleNodeRouteTableStateDigest(
      stateDescriptor(['vgw-00000000000000001', 'vgw-00000000000000002']),
    );

    expect(first).toEqual(second);
    expect(() =>
      createAwsSingleNodeRouteTableStateDigest(
        stateDescriptor(['vgw-00000000000000001', 'vgw-00000000000000001']),
      ),
    ).toThrow(TypeError);
  });
});

describe('AWS single-node route-table envelope evidence', () => {
  it('requires the exact create token echo and a strict candidate ID', () => {
    expect(
      decodeAwsSingleNodeCreateRouteTableCandidateId(
        {
          ClientToken: CLIENT_TOKEN,
          RouteTable: { RouteTableId: ROUTE_TABLE_ID },
        },
        CLIENT_TOKEN,
      ),
    ).toBe(ROUTE_TABLE_ID);
    expect(() =>
      decodeAwsSingleNodeCreateRouteTableCandidateId(
        { RouteTable: { RouteTableId: ROUTE_TABLE_ID } },
        CLIENT_TOKEN,
      ),
    ).toThrow(AwsTaggedEc2EvidenceUnknownError);
    expect(() =>
      decodeAwsSingleNodeCreateRouteTableCandidateId(
        {
          ClientToken: 'b'.repeat(64),
          RouteTable: { RouteTableId: ROUTE_TABLE_ID },
        },
        CLIENT_TOKEN,
      ),
    ).toThrow(AwsTaggedEc2EvidenceConflictError);
    expect(() =>
      decodeAwsSingleNodeCreateRouteTableCandidateId(
        {
          ClientToken: CLIENT_TOKEN,
          RouteTable: { RouteTableId: 'rtb-malformed' },
        },
        CLIENT_TOKEN,
      ),
    ).toThrow(AwsTaggedEc2EvidenceUnknownError);
  });

  it('strictly decodes exact cardinality, identity, and pagination', () => {
    const record = routeTable();
    expect(
      decodeAwsSingleNodeExactRouteTableResponse(
        { RouteTables: [record] },
        ROUTE_TABLE_ID,
      ),
    ).toBe(record);
    expect(() =>
      decodeAwsSingleNodeExactRouteTableResponse(
        { RouteTables: [] },
        ROUTE_TABLE_ID,
      ),
    ).toThrow(AwsTaggedEc2EvidenceUnknownError);
    expect(() =>
      decodeAwsSingleNodeExactRouteTableResponse(
        { RouteTables: [record, record] },
        ROUTE_TABLE_ID,
      ),
    ).toThrow(AwsTaggedEc2EvidenceConflictError);
    expect(() =>
      decodeAwsSingleNodeExactRouteTableResponse(
        { RouteTables: [record], NextToken: 'impossible' },
        ROUTE_TABLE_ID,
      ),
    ).toThrow(AwsTaggedEc2EvidenceConflictError);
    expect(() =>
      decodeAwsSingleNodeExactRouteTableResponse(
        {
          RouteTables: [routeTable({ RouteTableId: OTHER_ROUTE_TABLE_ID })],
        },
        ROUTE_TABLE_ID,
      ),
    ).toThrow(AwsTaggedEc2EvidenceConflictError);
  });

  it('strictly decodes discovery pages and rejects duplicate IDs', () => {
    const record = routeTable();
    expect(
      decodeAwsSingleNodeRouteTableDiscoveryPage({
        RouteTables: [record],
        NextToken: 'page-2',
      }),
    ).toEqual({ records: [record], nextToken: 'page-2' });
    expect(() =>
      decodeAwsSingleNodeRouteTableDiscoveryPage({
        RouteTables: [record],
        NextToken: '',
      }),
    ).toThrow(AwsTaggedEc2EvidenceUnknownError);
    expect(() =>
      decodeAwsSingleNodeRouteTableDiscoveryPage({
        RouteTables: [record, record],
      }),
    ).toThrow(AwsTaggedEc2EvidenceConflictError);
    expect(() =>
      decodeAwsSingleNodeRouteTableDiscoveryPage({
        RouteTables: [{ RouteTableId: 'rtb-malformed' }],
      }),
    ).toThrow(AwsTaggedEc2EvidenceUnknownError);
  });

  it('binds the shared locator and ownership-tag evidence kernel', () => {
    const kernel = createAwsSingleNodeRouteTableEvidenceKernel({
      readDiscoveryPage: jest.fn(),
      readExact: jest.fn(),
    });
    const locator = {
      capabilityKind: 'networking',
      roleKind: 'route-table',
      providerScopeId: 'wps1-provider-scope',
      deploymentInstanceId: 'wdi1-deployment-instance',
      incarnationId: 'wic1-incarnation',
      resourceKey: 'network-route-table',
    };

    expect(kernel.locatorTags(locator)).toEqual(
      expect.objectContaining({
        'wharfie:managed-by': 'wharfie',
        'wharfie:resource-kind': 'single-node-route-table',
        'wharfie:role': 'route-table',
      }),
    );
    expect(
      kernel.ownershipTags({
        ...locator,
        createdByActionId: 'wda1-action',
        ownershipNonce: 'won1-nonce',
        stateDigestValue: 'digest',
      }),
    ).toEqual(
      expect.objectContaining({
        'wharfie:created-by-action-id': 'wda1-action',
        'wharfie:ownership-nonce': 'won1-nonce',
        'wharfie:state-digest': 'digest',
      }),
    );
  });
});

describe('AWS single-node route-table physical evidence', () => {
  it('requires a syntactically exact twelve-digit owner account', () => {
    expect(decodeAwsSingleNodeRouteTableIdentity(routeTable())).toEqual({
      providerResourceId: ROUTE_TABLE_ID,
      ownerId: '123456789012',
      vpcId: VPC_ID,
    });
    for (const OwnerId of [
      '12345678901',
      '1234567890123',
      'abcdefghijkl',
      123456789012,
    ]) {
      expect(() =>
        decodeAwsSingleNodeRouteTableIdentity(routeTable({ OwnerId })),
      ).toThrow(AwsTaggedEc2EvidenceUnknownError);
    }
  });

  it('classifies and excludes only the supported child slots', () => {
    const pristine = routeTable();
    const withChildren = routeTable({
      Associations: [subnetAssociation()],
      Routes: [localRoute(), defaultRoute()],
    });
    const classified = decodeAwsSingleNodeRouteTableRecordState(withChildren);

    expect(classified.subnetAssociations).toHaveLength(1);
    expect(classified.defaultIpv4Routes).toHaveLength(1);
    expect(classified.otherAssociations).toHaveLength(0);
    expect(classified.otherRoutes).toHaveLength(0);
    expect(
      decodeAwsSingleNodeRouteTableActualState(withChildren, {
        allowDescendants: true,
      }).observedDigest,
    ).toEqual(
      decodeAwsSingleNodeRouteTableActualState(pristine, {
        allowDescendants: true,
      }).observedDigest,
    );
    expect(() =>
      decodeAwsSingleNodeRouteTableActualState(withChildren, {
        allowDescendants: false,
      }),
    ).toThrow(AwsTaggedEc2EvidenceConflictError);
  });

  it('gives conclusive non-pristine create evidence precedence over a missing local route', () => {
    const contradictory = [
      routeTable({ Routes: [defaultRoute()] }),
      routeTable({
        Associations: [subnetAssociation()],
        Routes: [],
      }),
      routeTable({
        PropagatingVgws: [{ GatewayId: 'vgw-00000000000000001' }],
        Routes: [],
      }),
      routeTable({
        Associations: [
          {
            AssociationState: { State: 'associated' },
            Main: true,
            RouteTableAssociationId: ASSOCIATION_ID,
            RouteTableId: ROUTE_TABLE_ID,
          },
        ],
        Routes: [],
      }),
    ];
    for (const record of contradictory) {
      expect(() =>
        decodeAwsSingleNodeRouteTableActualState(record, {
          allowDescendants: false,
        }),
      ).toThrow(AwsTaggedEc2EvidenceConflictError);
    }
    expect(() =>
      decodeAwsSingleNodeRouteTableActualState(routeTable({ Routes: [] }), {
        allowDescendants: false,
      }),
    ).toThrow(AwsTaggedEc2EvidenceTransientError);
  });

  it('hashes readable base drift while rejecting unsupported extra children', () => {
    const desired = decodeAwsSingleNodeRouteTableActualState(routeTable(), {
      allowDescendants: true,
    });
    const propagated = decodeAwsSingleNodeRouteTableActualState(
      routeTable({
        PropagatingVgws: [{ GatewayId: 'vgw-00000000000000001' }],
      }),
      { allowDescendants: true },
    );
    expect(propagated.observedDigest).not.toEqual(desired.observedDigest);
    expect(() =>
      decodeAwsSingleNodeRouteTableActualState(
        routeTable({
          Routes: [
            localRoute(),
            {
              DestinationCidrBlock: '10.99.0.0/16',
              NatGatewayId: 'nat-00000000000000001',
              Origin: 'CreateRoute',
              State: 'active',
            },
          ],
        }),
        { allowDescendants: true },
      ),
    ).toThrow(AwsTaggedEc2EvidenceConflictError);
  });
});
