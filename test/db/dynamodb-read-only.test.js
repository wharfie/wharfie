/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it, jest } from '@jest/globals';

import { createAwsProviderModule } from '../helpers/aws-provider.js';
import { createFakeDocClient } from '../helpers/db-adapters.js';

describe('dynamodb read-only observer mode', () => {
  it('allows control-store reads but rejects every mutation primitive', async () => {
    expect.hasAssertions();

    jest.resetModules();
    const fakeDocClient = createFakeDocClient();
    await fakeDocClient.put({
      TableName: 'runs',
      Item: { pk: 'service', sk: 'run/a', status: 'ready' },
    });
    await fakeDocClient.put({
      TableName: 'runs',
      Item: { pk: 'service', sk: 'run/b', status: 'ready' },
    });
    const DynamoDBDocument = Object.assign(jest.fn(), {
      from: () => fakeDocClient,
    });
    jest.unstable_mockModule('@aws-sdk/lib-dynamodb', () => ({
      DynamoDBDocument,
    }));

    const { registerAwsProviderModule } =
      await import('../../src/core/runtime/aws-provider-module.js');
    registerAwsProviderModule(
      createAwsProviderModule({ libDynamoDB: { DynamoDBDocument } }),
    );
    const { createControlDBClient } =
      await import('../../src/core/lib/config/db.js');
    const db = await createControlDBClient('dynamodb', { readOnly: true });

    try {
      await expect(
        db.get({
          tableName: 'runs',
          keyName: 'pk',
          keyValue: 'service',
          sortKeyName: 'sk',
          sortKeyValue: 'run/a',
        }),
      ).resolves.toStrictEqual({ pk: 'service', sk: 'run/a', status: 'ready' });
      await expect(
        db.query({
          tableName: 'runs',
          consistentRead: true,
          keyConditions: [
            {
              keyType: 'PRIMARY',
              conditionType: 'EQUALS',
              propertyName: 'pk',
              propertyValue: 'service',
            },
            {
              keyType: 'SORT',
              conditionType: 'BEGINS_WITH',
              propertyName: 'sk',
              propertyValue: 'run/',
            },
          ],
        }),
      ).resolves.toStrictEqual([
        { pk: 'service', sk: 'run/a', status: 'ready' },
        { pk: 'service', sk: 'run/b', status: 'ready' },
      ]);
      await expect(
        db.queryPage({
          tableName: 'runs',
          consistentRead: true,
          keyConditions: [
            {
              keyType: 'PRIMARY',
              conditionType: 'EQUALS',
              propertyName: 'pk',
              propertyValue: 'service',
            },
            {
              keyType: 'SORT',
              conditionType: 'BEGINS_WITH',
              propertyName: 'sk',
              propertyValue: 'run/',
            },
          ],
          limit: 1,
        }),
      ).resolves.toStrictEqual({
        items: [{ pk: 'service', sk: 'run/a', status: 'ready' }],
        nextStartAfter: 'run/a',
      });

      const mutations = [
        db.put({
          tableName: 'runs',
          keyName: 'pk',
          sortKeyName: 'sk',
          record: { pk: 'service', sk: 'run/a', status: 'overwritten' },
        }),
        db.update({
          tableName: 'runs',
          keyName: 'pk',
          keyValue: 'service',
          sortKeyName: 'sk',
          sortKeyValue: 'run/a',
          updates: [{ property: ['status'], propertyValue: 'updated' }],
        }),
        db.remove({
          tableName: 'runs',
          keyName: 'pk',
          keyValue: 'service',
          sortKeyName: 'sk',
          sortKeyValue: 'run/a',
        }),
        db.batchWrite({
          tableName: 'runs',
          deleteRequests: [
            {
              keyName: 'pk',
              keyValue: 'service',
              sortKeyName: 'sk',
              sortKeyValue: 'run/a',
            },
          ],
          putRequests: [
            {
              keyName: 'pk',
              sortKeyName: 'sk',
              record: { pk: 'service', sk: 'run/c', status: 'new' },
            },
          ],
        }),
        db.transactionWrite({
          tableName: 'runs',
          putRequests: [
            {
              keyName: 'pk',
              sortKeyName: 'sk',
              record: { pk: 'service', sk: 'run/d', status: 'new' },
            },
          ],
        }),
      ];
      await Promise.all(
        mutations.map((mutation) =>
          expect(mutation).rejects.toThrow('DynamoDB client is read-only.'),
        ),
      );

      await expect(
        db.query({
          tableName: 'runs',
          consistentRead: true,
          keyConditions: [
            {
              keyType: 'PRIMARY',
              conditionType: 'EQUALS',
              propertyName: 'pk',
              propertyValue: 'service',
            },
            {
              keyType: 'SORT',
              conditionType: 'BEGINS_WITH',
              propertyName: 'sk',
              propertyValue: 'run/',
            },
          ],
        }),
      ).resolves.toStrictEqual([
        { pk: 'service', sk: 'run/a', status: 'ready' },
        { pk: 'service', sk: 'run/b', status: 'ready' },
      ]);
    } finally {
      await db.close();
    }

    expect(fakeDocClient.__calls).toStrictEqual({
      batchWrite: 0,
      transactWrite: 0,
    });
  });
});
