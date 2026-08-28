/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, jest, test } from '@jest/globals';

import createDynamoDB, {
  describeDynamoDBTableForClient,
} from '../../src/core/lib/db/adapters/dynamodb.js';
import { createAwsProviderModule } from '../helpers/aws-provider.js';
import { createFakeDocClient } from '../helpers/db-adapters.js';

const TABLE_NAME = 'execution-ledger';
const REGION = 'us-east-2';

function harness() {
  const response = Object.freeze({
    Table: Object.freeze({ TableName: TABLE_NAME }),
  });
  const describeTable = jest.fn(
    async (/** @type {Readonly<{TableName: string}>} */ _input) => response,
  );
  const rawDestroy = jest.fn();
  const DynamoDB = jest.fn(function DynamoDB(options) {
    this.options = options;
    this.describeTable = describeTable;
    this.destroy = rawDestroy;
  });
  const docClient = createFakeDocClient();
  const from = jest.fn(
    (/** @type {unknown} */ _client, /** @type {unknown} */ _options) =>
      docClient,
  );
  const DynamoDBDocument = Object.assign(jest.fn(), { from });
  const credentials = jest.fn();
  const fromNodeProviderChain = jest.fn(() => credentials);
  const bindings = createAwsProviderModule({
    clientDynamoDB: { DynamoDB },
    credentialProviders: { fromNodeProviderChain },
    libDynamoDB: { DynamoDBDocument },
  }).getAwsSdkBindings();
  const db = createDynamoDB({ region: REGION }, bindings);
  return {
    db,
    response,
    describeTable,
    rawDestroy,
    DynamoDB,
    docClient,
    from,
    credentials,
    fromNodeProviderChain,
  };
}

describe('DynamoDB topology capability', () => {
  test('uses the raw service client underlying the exact DB wrapper', async () => {
    const fixture = harness();
    const input = Object.freeze({ TableName: TABLE_NAME });
    try {
      await expect(
        describeDynamoDBTableForClient(fixture.db, input),
      ).resolves.toBe(fixture.response);

      expect(fixture.DynamoDB).toHaveBeenCalledTimes(1);
      expect(fixture.DynamoDB).toHaveBeenCalledWith(
        expect.objectContaining({
          region: REGION,
          credentials: fixture.credentials,
        }),
      );
      expect(fixture.from).toHaveBeenCalledWith(
        fixture.DynamoDB.mock.instances[0],
        { marshallOptions: { removeUndefinedValues: true } },
      );
      expect(fixture.describeTable).toHaveBeenCalledWith({
        TableName: TABLE_NAME,
      });
    } finally {
      await fixture.db.close();
    }
    expect(fixture.rawDestroy).toHaveBeenCalledTimes(1);
  });

  test('rejects branded copies, unrelated clients, and closed wrappers', async () => {
    const fixture = harness();
    const copied = { ...fixture.db };

    await expect(
      describeDynamoDBTableForClient(/** @type {any} */ (copied), {
        TableName: TABLE_NAME,
      }),
    ).rejects.toThrow(/exact open DynamoDB DB client/u);
    await expect(
      describeDynamoDBTableForClient(/** @type {any} */ ({}), {
        TableName: TABLE_NAME,
      }),
    ).rejects.toThrow(/exact open DynamoDB DB client/u);
    expect(fixture.describeTable).not.toHaveBeenCalled();

    await fixture.db.close();
    expect(fixture.rawDestroy).toHaveBeenCalledTimes(1);
    await expect(
      describeDynamoDBTableForClient(fixture.db, { TableName: TABLE_NAME }),
    ).rejects.toThrow(/exact open DynamoDB DB client/u);
    expect(fixture.describeTable).not.toHaveBeenCalled();
  });

  test('narrows DescribeTable to one exact table name', async () => {
    const fixture = harness();
    try {
      await expect(
        describeDynamoDBTableForClient(
          fixture.db,
          /** @type {any} */ ({
            TableName: TABLE_NAME,
            ConsistentRead: true,
          }),
        ),
      ).rejects.toThrow(/one exact TableName/u);
      await expect(
        describeDynamoDBTableForClient(
          fixture.db,
          /** @type {any} */ ({ TableName: '' }),
        ),
      ).rejects.toThrow(/one exact TableName/u);
      expect(fixture.describeTable).not.toHaveBeenCalled();
    } finally {
      await fixture.db.close();
    }
  });
});
