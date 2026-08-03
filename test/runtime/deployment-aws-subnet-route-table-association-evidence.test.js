import { describe, expect, it } from '@jest/globals';

import {
  AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError,
  AwsSingleNodeSubnetRouteTableAssociationEvidenceTransientError,
  AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError,
  decodeAwsSingleNodeSubnetRouteTableAssociationDiscoveryPage,
  decodeAwsSingleNodeSubnetRouteTableAssociationRouteTableResponse,
  decodeAwsSingleNodeSubnetRouteTableAssociationSubnetResponse,
  reconcileAwsSingleNodeSubnetRouteTableAssociationViews,
} from '../../src/core/runtime/deployment-aws-subnet-route-table-association-evidence.js';

const IDS = Object.freeze({
  association: 'rtbassoc-00000000000000001',
  otherAssociation: 'rtbassoc-00000000000000002',
  routeTable: 'rtb-00000000000000001',
  otherRouteTable: 'rtb-00000000000000002',
  subnet: 'subnet-00000000000000001',
  otherSubnet: 'subnet-00000000000000002',
  vpc: 'vpc-00000000000000001',
});

/** @param {unknown} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

/** @param {Record<string, any>} [overrides] */
function association(overrides = {}) {
  return {
    Main: false,
    RouteTableAssociationId: IDS.association,
    RouteTableId: IDS.routeTable,
    SubnetId: IDS.subnet,
    AssociationState: { State: 'associated' },
    ...overrides,
  };
}

/** @param {Record<string, any>} [overrides] */
function routeTable(overrides = {}) {
  return {
    RouteTableId: IDS.routeTable,
    OwnerId: '123456789012',
    VpcId: IDS.vpc,
    Associations: [association()],
    ...overrides,
  };
}

describe('AWS subnet route-table association evidence', () => {
  it('decodes and freezes one exact subnet endpoint', () => {
    const decoded =
      decodeAwsSingleNodeSubnetRouteTableAssociationSubnetResponse(
        {
          Subnets: [
            {
              SubnetId: IDS.subnet,
              OwnerId: '123456789012',
              VpcId: IDS.vpc,
              State: 'available',
            },
          ],
        },
        IDS.subnet,
      );

    expect(decoded).toEqual({
      ownerId: '123456789012',
      state: 'available',
      subnetId: IDS.subnet,
      vpcId: IDS.vpc,
    });
    expectDeepFrozen(decoded);
  });

  it('distinguishes incomplete exact subnet evidence from contradictions', () => {
    expect(() =>
      decodeAwsSingleNodeSubnetRouteTableAssociationSubnetResponse(
        { Subnets: [] },
        IDS.subnet,
      ),
    ).toThrow(AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError);
    expect(() =>
      decodeAwsSingleNodeSubnetRouteTableAssociationSubnetResponse(
        {
          Subnets: [
            {
              SubnetId: IDS.otherSubnet,
              OwnerId: '123456789012',
              VpcId: IDS.vpc,
              State: 'available',
            },
          ],
        },
        IDS.subnet,
      ),
    ).toThrow(AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError);
  });

  it('retains intended and unrelated explicit associations from the exact table', () => {
    const decoded =
      decodeAwsSingleNodeSubnetRouteTableAssociationRouteTableResponse(
        {
          RouteTables: [
            routeTable({
              Associations: [
                association({
                  RouteTableAssociationId: IDS.otherAssociation,
                  SubnetId: IDS.otherSubnet,
                }),
                association(),
              ],
            }),
          ],
        },
        IDS.routeTable,
        IDS.subnet,
      );

    expect(decoded).toEqual({
      association: {
        associationId: IDS.association,
        gatewayId: null,
        routeTableId: IDS.routeTable,
        state: 'associated',
        subnetId: IDS.subnet,
      },
      otherAssociations: [
        {
          associationId: IDS.otherAssociation,
          gatewayId: null,
          routeTableId: IDS.routeTable,
          state: 'associated',
          subnetId: IDS.otherSubnet,
        },
      ],
      ownerId: '123456789012',
      routeTableId: IDS.routeTable,
      vpcId: IDS.vpc,
    });
    expectDeepFrozen(decoded);
  });

  it('keeps a missing provider-allocated association ID unknown', () => {
    const record = {
      ...association(),
      RouteTableAssociationId: undefined,
    };
    expect(() =>
      decodeAwsSingleNodeSubnetRouteTableAssociationRouteTableResponse(
        {
          RouteTables: [
            routeTable({
              Associations: [record],
            }),
          ],
        },
        IDS.routeTable,
        IDS.subnet,
      ),
    ).toThrow(AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError);
  });

  it('decodes a complete filtered discovery page and preserves its token', () => {
    const decoded = decodeAwsSingleNodeSubnetRouteTableAssociationDiscoveryPage(
      {
        RouteTables: [routeTable()],
        NextToken: 'page-2',
      },
      IDS.subnet,
    );

    expect(decoded).toEqual({
      associations: [
        {
          associationId: IDS.association,
          gatewayId: null,
          ownerId: '123456789012',
          routeTableId: IDS.routeTable,
          state: 'associated',
          subnetId: IDS.subnet,
          vpcId: IDS.vpc,
        },
      ],
      otherAssociations: [],
      nextToken: 'page-2',
    });
    expectDeepFrozen(decoded);
  });

  it('rejects filtered records that do not corroborate the subnet slot', () => {
    expect(() =>
      decodeAwsSingleNodeSubnetRouteTableAssociationDiscoveryPage(
        {
          RouteTables: [
            routeTable({
              Associations: [
                association({
                  RouteTableAssociationId: IDS.otherAssociation,
                  SubnetId: IDS.otherSubnet,
                }),
              ],
            }),
          ],
        },
        IDS.subnet,
      ),
    ).toThrow(AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError);
  });

  it('reconciles only identical associated dual views', () => {
    const exact = {
      associationId: IDS.association,
      routeTableId: IDS.routeTable,
      state: 'associated',
      subnetId: IDS.subnet,
    };
    const present = reconcileAwsSingleNodeSubnetRouteTableAssociationViews({
      exactAssociation: exact,
      slotAssociations: [
        {
          ...exact,
          ownerId: '123456789012',
          vpcId: IDS.vpc,
        },
      ],
      routeTableId: IDS.routeTable,
    });
    const absent = reconcileAwsSingleNodeSubnetRouteTableAssociationViews({
      exactAssociation: null,
      slotAssociations: [],
      routeTableId: IDS.routeTable,
    });

    expect(present).toEqual({ state: 'present', association: exact });
    expect(absent).toEqual({ state: 'absent' });
    expectDeepFrozen(present);
    expectDeepFrozen(absent);
  });

  it('keeps one-sided or differing association IDs transient', () => {
    const exact = {
      associationId: IDS.association,
      routeTableId: IDS.routeTable,
      state: 'associated',
      subnetId: IDS.subnet,
    };
    expect(() =>
      reconcileAwsSingleNodeSubnetRouteTableAssociationViews({
        exactAssociation: exact,
        slotAssociations: [],
        routeTableId: IDS.routeTable,
      }),
    ).toThrow(AwsSingleNodeSubnetRouteTableAssociationEvidenceTransientError);
    expect(() =>
      reconcileAwsSingleNodeSubnetRouteTableAssociationViews({
        exactAssociation: exact,
        slotAssociations: [
          {
            ...exact,
            associationId: IDS.otherAssociation,
          },
        ],
        routeTableId: IDS.routeTable,
      }),
    ).toThrow(AwsSingleNodeSubnetRouteTableAssociationEvidenceTransientError);
  });

  it('rejects an occupied foreign route-table slot or failed state', () => {
    const exact = {
      associationId: IDS.association,
      routeTableId: IDS.routeTable,
      state: 'associated',
      subnetId: IDS.subnet,
    };
    expect(() =>
      reconcileAwsSingleNodeSubnetRouteTableAssociationViews({
        exactAssociation: null,
        slotAssociations: [
          {
            ...exact,
            routeTableId: IDS.otherRouteTable,
          },
        ],
        routeTableId: IDS.routeTable,
      }),
    ).toThrow(AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError);
    expect(() =>
      reconcileAwsSingleNodeSubnetRouteTableAssociationViews({
        exactAssociation: { ...exact, state: 'failed' },
        slotAssociations: [{ ...exact, state: 'failed' }],
        routeTableId: IDS.routeTable,
      }),
    ).toThrow(AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError);
  });
});
