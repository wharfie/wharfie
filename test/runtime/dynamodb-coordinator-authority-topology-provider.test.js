/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, jest, test } from '@jest/globals';

import { assertDynamoDBCoordinatorAuthorityTableTopology } from '../../src/core/runtime/dynamodb-coordinator-authority-topology.js';
import { validateAwsDynamoDBCoordinatorAuthorityTableTopology } from '../../src/core/runtime/dynamodb-coordinator-authority-topology-provider.js';

const REGION = 'us-east-2';
const TABLE_NAME = 'execution-ledger';

function description() {
  return {
    Table: {
      TableName: TABLE_NAME,
      TableArn: `arn:aws:dynamodb:${REGION}:123456789012:table/${TABLE_NAME}`,
      TableId: '00000000-1111-2222-3333-444444444444',
      TableStatus: 'ACTIVE',
      KeySchema: [
        { AttributeName: 'run_id', KeyType: 'HASH' },
        { AttributeName: 'sort_key', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'run_id', AttributeType: 'S' },
        { AttributeName: 'sort_key', AttributeType: 'S' },
      ],
    },
  };
}

function tableResourceId() {
  return assertDynamoDBCoordinatorAuthorityTableTopology({
    description: description(),
    tableName: TABLE_NAME,
    region: REGION,
  }).tableResourceId;
}

describe('AWS DynamoDB coordinator authority topology provider', () => {
  test('describes topology through the exact already-open data client', async () => {
    const db = Object.freeze({ kind: 'exact-data-client' });
    const exactDescription = description();
    const describeTableForClient = jest.fn(async (candidate, input) => {
      expect(candidate).toBe(db);
      expect(input).toEqual({ TableName: TABLE_NAME });
      expect(Object.isFrozen(input)).toBe(true);
      return exactDescription;
    });
    const pinDescribedTableForClient = jest.fn(
      async (candidate, input, described) => {
        expect(candidate).toBe(db);
        expect(input).toEqual({ TableName: TABLE_NAME });
        expect(Object.isFrozen(input)).toBe(true);
        expect(described).toBe(exactDescription);
      },
    );

    await expect(
      validateAwsDynamoDBCoordinatorAuthorityTableTopology(
        /** @type {any} */ ({
          db,
          tableName: TABLE_NAME,
          region: REGION,
          expectedTableResourceId: tableResourceId(),
        }),
        { describeTableForClient, pinDescribedTableForClient },
      ),
    ).resolves.toMatchObject({
      tableName: TABLE_NAME,
      region: REGION,
      globalTable: false,
    });

    expect(describeTableForClient).toHaveBeenCalledTimes(1);
    expect(pinDescribedTableForClient).toHaveBeenCalledTimes(1);
  });

  test('rejects a different shared resource identity before pinning', async () => {
    const describeTableForClient = jest.fn(async () => description());
    const pinDescribedTableForClient = jest.fn();

    await expect(
      validateAwsDynamoDBCoordinatorAuthorityTableTopology(
        {
          db: /** @type {any} */ ({}),
          tableName: TABLE_NAME,
          region: REGION,
          expectedTableResourceId: `wdtr1_${'E'.repeat(43)}`,
        },
        { describeTableForClient, pinDescribedTableForClient },
      ),
    ).rejects.toMatchObject({
      code: 'WHARFIE_DYNAMODB_COORDINATOR_TOPOLOGY_INVALID',
    });
    expect(describeTableForClient).toHaveBeenCalledTimes(1);
    expect(pinDescribedTableForClient).not.toHaveBeenCalled();
  });

  test('rejects invalid topology input before using the data client capability', async () => {
    const describeTableForClient = jest.fn(async () => description());
    const pinDescribedTableForClient = jest.fn();

    await expect(
      validateAwsDynamoDBCoordinatorAuthorityTableTopology(
        {
          db: /** @type {any} */ ({}),
          tableName: ` ${TABLE_NAME}`,
          region: REGION,
        },
        { describeTableForClient, pinDescribedTableForClient },
      ),
    ).rejects.toThrow(TypeError);
    expect(describeTableForClient).not.toHaveBeenCalled();
    expect(pinDescribedTableForClient).not.toHaveBeenCalled();
  });

  test('classifies a failed same-client DescribeTable call as unknown topology', async () => {
    const providerFailure = new Error('DescribeTable unavailable');
    const describeTableForClient = jest.fn(async () => {
      throw providerFailure;
    });
    const pinDescribedTableForClient = jest.fn();

    await expect(
      validateAwsDynamoDBCoordinatorAuthorityTableTopology(
        {
          db: /** @type {any} */ ({}),
          tableName: TABLE_NAME,
          region: REGION,
        },
        { describeTableForClient, pinDescribedTableForClient },
      ),
    ).rejects.toMatchObject({
      code: 'WHARFIE_DYNAMODB_COORDINATOR_TOPOLOGY_UNKNOWN',
      cause: providerFailure,
    });
    expect(pinDescribedTableForClient).not.toHaveBeenCalled();
  });

  test.each([
    ['a missing data client', { tableName: TABLE_NAME, region: REGION }],
    [
      'an unsupported option',
      { db: {}, tableName: TABLE_NAME, region: REGION, accountId: 'hidden' },
    ],
  ])('rejects %s', async (_label, options) => {
    await expect(
      validateAwsDynamoDBCoordinatorAuthorityTableTopology(
        /** @type {any} */ (options),
        {
          describeTableForClient: async () => description(),
          pinDescribedTableForClient: async () => undefined,
        },
      ),
    ).rejects.toThrow(/options/u);
  });

  test('rejects unsupported provider dependency fields', async () => {
    await expect(
      validateAwsDynamoDBCoordinatorAuthorityTableTopology(
        {
          db: /** @type {any} */ ({}),
          tableName: TABLE_NAME,
          region: REGION,
        },
        /** @type {any} */ ({
          describeTableForClient: async () => description(),
          extra: true,
        }),
      ),
    ).rejects.toThrow(/dependencies/u);
  });

  test('does not pin a table whose topology is invalid', async () => {
    const pinDescribedTableForClient = jest.fn();
    await expect(
      validateAwsDynamoDBCoordinatorAuthorityTableTopology(
        {
          db: /** @type {any} */ ({}),
          tableName: TABLE_NAME,
          region: REGION,
        },
        {
          describeTableForClient: async () =>
            description().Table
              ? {
                  Table: {
                    ...description().Table,
                    Replicas: [{ RegionName: 'us-west-2' }],
                  },
                }
              : description(),
          pinDescribedTableForClient,
        },
      ),
    ).rejects.toThrow(/topology is invalid/u);
    expect(pinDescribedTableForClient).not.toHaveBeenCalled();
  });
});
