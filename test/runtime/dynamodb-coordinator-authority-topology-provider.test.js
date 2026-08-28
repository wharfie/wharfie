/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, jest, test } from '@jest/globals';

import { validateAwsDynamoDBCoordinatorAuthorityTableTopology } from '../../src/core/runtime/dynamodb-coordinator-authority-topology-provider.js';

const REGION = 'us-east-2';
const TABLE_NAME = 'execution-ledger';

function description() {
  return {
    Table: {
      TableName: TABLE_NAME,
      TableArn: `arn:aws:dynamodb:${REGION}:123456789012:table/${TABLE_NAME}`,
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

describe('AWS DynamoDB coordinator authority topology provider', () => {
  test('describes topology through the exact already-open data client', async () => {
    const db = Object.freeze({ kind: 'exact-data-client' });
    const describeTableForClient = jest.fn(async (candidate, input) => {
      expect(candidate).toBe(db);
      expect(input).toEqual({ TableName: TABLE_NAME });
      expect(Object.isFrozen(input)).toBe(true);
      return description();
    });

    await expect(
      validateAwsDynamoDBCoordinatorAuthorityTableTopology(
        /** @type {any} */ ({ db, tableName: TABLE_NAME, region: REGION }),
        { describeTableForClient },
      ),
    ).resolves.toMatchObject({
      tableName: TABLE_NAME,
      region: REGION,
      globalTable: false,
    });

    expect(describeTableForClient).toHaveBeenCalledTimes(1);
  });

  test('rejects invalid topology input before using the data client capability', async () => {
    const describeTableForClient = jest.fn(async () => description());

    await expect(
      validateAwsDynamoDBCoordinatorAuthorityTableTopology(
        {
          db: /** @type {any} */ ({}),
          tableName: ` ${TABLE_NAME}`,
          region: REGION,
        },
        { describeTableForClient },
      ),
    ).rejects.toThrow(TypeError);
    expect(describeTableForClient).not.toHaveBeenCalled();
  });

  test('classifies a failed same-client DescribeTable call as unknown topology', async () => {
    const providerFailure = new Error('DescribeTable unavailable');
    const describeTableForClient = jest.fn(async () => {
      throw providerFailure;
    });

    await expect(
      validateAwsDynamoDBCoordinatorAuthorityTableTopology(
        {
          db: /** @type {any} */ ({}),
          tableName: TABLE_NAME,
          region: REGION,
        },
        { describeTableForClient },
      ),
    ).rejects.toMatchObject({
      code: 'WHARFIE_DYNAMODB_COORDINATOR_TOPOLOGY_UNKNOWN',
      cause: providerFailure,
    });
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
        { describeTableForClient: async () => description() },
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
});
