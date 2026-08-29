/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, jest, test } from '@jest/globals';

import {
  DYNAMODB_COORDINATOR_AUTHORITY_TOPOLOGY_KIND,
  DynamoDBCoordinatorAuthorityTopologyError,
  DynamoDBCoordinatorAuthorityTopologyUnknownError,
  assertDynamoDBCoordinatorAuthorityTableTopology,
  validateDynamoDBCoordinatorAuthorityTableTopology,
} from '../../src/core/runtime/dynamodb-coordinator-authority-topology.js';

const TABLE_NAME = 'execution-ledger';
const REGION = 'us-east-2';
const ACCOUNT_ID = '123456789012';

function tableDescription(overrides = {}) {
  return {
    Table: {
      TableName: TABLE_NAME,
      TableArn: `arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${TABLE_NAME}`,
      TableId: '00000000-1111-2222-3333-444444444444',
      TableStatus: 'ACTIVE',
      BillingModeSummary: { BillingMode: 'PAY_PER_REQUEST' },
      KeySchema: [
        { AttributeName: 'run_id', KeyType: 'HASH' },
        { AttributeName: 'sort_key', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'run_id', AttributeType: 'S' },
        { AttributeName: 'sort_key', AttributeType: 'S' },
      ],
      ...overrides,
    },
  };
}

/** @param {unknown} description */
function assertTopology(description) {
  return assertDynamoDBCoordinatorAuthorityTableTopology({
    description,
    tableName: TABLE_NAME,
    region: REGION,
  });
}

describe('DynamoDB coordinator authority table topology', () => {
  test('returns frozen account-bound evidence without raw account identity', () => {
    const evidence = assertTopology(
      tableDescription({
        Replicas: [],
        GlobalTableWitnesses: [],
      }),
    );

    expect(evidence).toEqual({
      schemaVersion: 2,
      kind: DYNAMODB_COORDINATOR_AUTHORITY_TOPOLOGY_KIND,
      tableName: TABLE_NAME,
      region: REGION,
      arnPartition: 'aws',
      tableResourceId: expect.stringMatching(/^wdtr1_[A-Za-z0-9_-]{43}$/u),
      tableStatus: 'ACTIVE',
      keySchema: [
        {
          attributeName: 'run_id',
          attributeType: 'S',
          keyType: 'HASH',
        },
        {
          attributeName: 'sort_key',
          attributeType: 'S',
          keyType: 'RANGE',
        },
      ],
      replicaCount: 0,
      witnessCount: 0,
      globalTable: false,
    });
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.keySchema)).toBe(true);
    expect(Object.isFrozen(evidence.keySchema[0])).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain(ACCOUNT_ID);
  });

  test('distinguishes same-named tables in different AWS accounts', () => {
    const first = assertTopology(tableDescription());
    const second = assertTopology(
      tableDescription({
        TableArn: `arn:aws:dynamodb:${REGION}:210987654321:table/${TABLE_NAME}`,
      }),
    );

    expect(second.tableResourceId).not.toBe(first.tableResourceId);
    expect(JSON.stringify(second)).not.toContain('210987654321');
  });

  test('distinguishes recreated tables with the same ARN', () => {
    const first = assertTopology(tableDescription());
    const second = assertTopology(
      tableDescription({
        TableId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      }),
    );

    expect(second.tableResourceId).not.toBe(first.tableResourceId);
  });

  test('accepts provider schema arrays in either order and canonicalizes evidence', () => {
    const evidence = assertTopology(
      tableDescription({
        KeySchema: [
          { AttributeName: 'sort_key', KeyType: 'RANGE' },
          { AttributeName: 'run_id', KeyType: 'HASH' },
        ],
        AttributeDefinitions: [
          { AttributeName: 'sort_key', AttributeType: 'S' },
          { AttributeName: 'run_id', AttributeType: 'S' },
        ],
      }),
    );

    expect(evidence.keySchema.map((entry) => entry.attributeName)).toEqual([
      'run_id',
      'sort_key',
    ]);
  });

  test.each([
    ['on-demand billing', { BillingMode: 'PAY_PER_REQUEST' }],
    ['provisioned billing', { BillingMode: 'PROVISIONED' }],
    ['an absent billing summary', undefined],
  ])(
    'does not confuse %s with an authority safety property',
    (_label, mode) => {
      const evidence = assertTopology(
        tableDescription({
          BillingModeSummary:
            mode === undefined ? undefined : { BillingMode: mode.BillingMode },
        }),
      );

      expect(evidence).not.toHaveProperty('billingMode');
      expect(evidence.globalTable).toBe(false);
    },
  );

  test('calls only the injected DescribeTable port with the exact frozen table request', async () => {
    const describeTable = jest.fn(async (input) => {
      expect(input).toEqual({ TableName: TABLE_NAME });
      expect(Object.isFrozen(input)).toBe(true);
      return tableDescription();
    });

    await expect(
      validateDynamoDBCoordinatorAuthorityTableTopology({
        describeTable,
        tableName: TABLE_NAME,
        region: REGION,
      }),
    ).resolves.toMatchObject({
      tableName: TABLE_NAME,
      region: REGION,
      globalTable: false,
    });
    expect(describeTable).toHaveBeenCalledTimes(1);
    expect(describeTable).toHaveBeenCalledWith({ TableName: TABLE_NAME });
  });

  test.each([undefined, null, {}, { Table: null }, { Table: [] }])(
    'fails closed when the table description is unavailable: %p',
    (description) => {
      expect(() => assertTopology(description)).toThrow(
        DynamoDBCoordinatorAuthorityTopologyUnknownError,
      );
    },
  );

  test('preserves a failed DescribeTable call as an unknown topology cause', async () => {
    const cause = new Error('provider unavailable');
    const promise = validateDynamoDBCoordinatorAuthorityTableTopology({
      describeTable: async () => {
        throw cause;
      },
      tableName: TABLE_NAME,
      region: REGION,
    });

    await expect(promise).rejects.toMatchObject({
      name: 'DynamoDBCoordinatorAuthorityTopologyUnknownError',
      code: 'WHARFIE_DYNAMODB_COORDINATOR_TOPOLOGY_UNKNOWN',
      tableName: TABLE_NAME,
      region: REGION,
      reason: 'DescribeTable failed',
      cause,
    });
  });

  test.each([
    ['different response name', { TableName: 'other-ledger' }],
    [
      'different ARN Region',
      {
        TableArn: `arn:aws:dynamodb:us-west-2:${ACCOUNT_ID}:table/${TABLE_NAME}`,
      },
    ],
    [
      'different ARN resource',
      {
        TableArn: `arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/other-ledger`,
      },
    ],
    ['malformed ARN', { TableArn: 'not-an-arn' }],
    ['a missing table ID', { TableId: undefined }],
    ['a malformed table ID', { TableId: 'not a table id' }],
  ])('rejects a table with %s', (_label, overrides) => {
    expect(() => assertTopology(tableDescription(overrides))).toThrow(
      DynamoDBCoordinatorAuthorityTopologyError,
    );
  });

  test.each([
    ['a non-ACTIVE state', { TableStatus: 'UPDATING' }],
    [
      'the wrong partition key',
      {
        KeySchema: [
          { AttributeName: 'other_id', KeyType: 'HASH' },
          { AttributeName: 'sort_key', KeyType: 'RANGE' },
        ],
      },
    ],
    [
      'the wrong sort-key type',
      {
        AttributeDefinitions: [
          { AttributeName: 'run_id', AttributeType: 'S' },
          { AttributeName: 'sort_key', AttributeType: 'N' },
        ],
      },
    ],
    [
      'an extra key definition',
      {
        AttributeDefinitions: [
          { AttributeName: 'run_id', AttributeType: 'S' },
          { AttributeName: 'sort_key', AttributeType: 'S' },
          { AttributeName: 'other_id', AttributeType: 'S' },
        ],
      },
    ],
  ])('rejects %s', (_label, overrides) => {
    expect(() => assertTopology(tableDescription(overrides))).toThrow(
      DynamoDBCoordinatorAuthorityTopologyError,
    );
  });

  test.each([
    ['a replica', { Replicas: [{ RegionName: 'us-west-2' }] }],
    ['malformed replica metadata', { Replicas: {} }],
    ['a global table version', { GlobalTableVersion: '2019.11.21' }],
    [
      'a global table witness',
      { GlobalTableWitnesses: [{ RegionName: 'us-west-2' }] },
    ],
    ['malformed witness metadata', { GlobalTableWitnesses: {} }],
    ['multi-Region consistency', { MultiRegionConsistency: 'STRONG' }],
  ])('rejects global-table evidence from %s', (_label, overrides) => {
    expect(() => assertTopology(tableDescription(overrides))).toThrow(
      DynamoDBCoordinatorAuthorityTopologyError,
    );
  });

  test.each([
    ['non-object assertion options', null],
    [
      'unsupported assertion fields',
      {
        description: tableDescription(),
        tableName: TABLE_NAME,
        region: REGION,
        accountId: ACCOUNT_ID,
      },
    ],
    [
      'an inexact table name',
      {
        description: tableDescription(),
        tableName: ` ${TABLE_NAME}`,
        region: REGION,
      },
    ],
    [
      'an inexact Region',
      {
        description: tableDescription(),
        tableName: TABLE_NAME,
        region: `${REGION} `,
      },
    ],
  ])('rejects %s before inspecting topology', (_label, options) => {
    expect(() =>
      assertDynamoDBCoordinatorAuthorityTableTopology(
        /** @type {any} */ (options),
      ),
    ).toThrow(TypeError);
  });

  test('rejects invalid validation options before calling the provider', async () => {
    const describeTable = jest.fn(async () => tableDescription());

    await expect(
      validateDynamoDBCoordinatorAuthorityTableTopology(
        /** @type {any} */ ({
          describeTable,
          tableName: TABLE_NAME,
          region: REGION,
          accountId: ACCOUNT_ID,
        }),
      ),
    ).rejects.toThrow(TypeError);
    expect(describeTable).not.toHaveBeenCalled();
  });
});
