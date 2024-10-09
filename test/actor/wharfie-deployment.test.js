/* eslint-disable jest/no-hooks */
/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = '1';
jest.mock('crypto');

// eslint-disable-next-line jest/no-untyped-mock-factory
jest.mock('../../package.json', () => ({ version: '0.0.1' }));
jest.mock('../../lambdas/lib/env-paths');

const crypto = require('crypto');

const WharfieDeployment = require('../../lambdas/lib/actor/wharfie-deployment');
const Reconcilable = require('../../lambdas/lib/actor/resources/reconcilable');
const { load } = require('../../lambdas/lib/actor/deserialize');

const AWS = require('@aws-sdk/lib-dynamodb');
let query, _delete, put, update;

describe('deployment IaC', () => {
  beforeAll(() => {
    const mockUpdate = jest.fn().mockReturnThis();
    const mockDigest = jest.fn().mockReturnValue('mockedHash');
    // @ts-ignore
    crypto.createHash.mockReturnValue({
      update: mockUpdate,
      digest: mockDigest,
    });
    put = AWS.spyOn('DynamoDBDocument', 'put');
    query = AWS.spyOn('DynamoDBDocument', 'query');
    _delete = AWS.spyOn('DynamoDBDocument', 'delete');
    update = AWS.spyOn('DynamoDBDocument', 'update');
  });
  afterAll(() => {
    jest.restoreAllMocks();
    AWS.clearAllMocks();
  });
  it('basic', async () => {
    expect.assertions(10);
    const deployment = new WharfieDeployment({
      name: 'test-deployment',
      properties: {
        createdAt: 123456789,
      },
    });
    await deployment.reconcile();

    const reconcilingStatusUpdate = update.mock.calls;

    const stableStatusUpdate = put.mock.calls
      .filter(([{ Item }]) => Item.status === Reconcilable.Status.STABLE)
      .map(([{ Item }]) => Item);

    expect(reconcilingStatusUpdate).toHaveLength(55);
    update.mock.calls = [];
    // this is higher b/c deployment-state and deployment are bootstraped before the table exists
    expect(stableStatusUpdate).toHaveLength(57);

    const serialized = deployment.serialize();
    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-deployment",
        "parent": "",
        "properties": {
          "_INTERNAL_STATE_RESOURCE": true,
          "accountId": "123456789012",
          "createdAt": 123456789,
          "deployment": {
            "accountId": "123456789012",
            "envPaths": {
              "cache": "mock",
              "config": "mock",
              "data": "mock",
              "log": "mock",
              "temp": "mock",
            },
            "name": "test-deployment",
            "region": "us-west-2",
            "stateTable": "test-deployment-state",
            "version": "0.0.1",
          },
          "globalQueryConcurrency": 10,
          "loggingLevel": "info",
          "maxQueriesPerAction": 10000,
          "region": "us-west-2",
          "resourceQueryConcurrency": 10,
        },
        "resourceType": "WharfieDeployment",
        "resources": [
          "daemon",
          "cleanup",
          "events",
          "monitor",
          "test-deployment-deployment-resources",
          "test-deployment-state",
          "test-deployment-log-notification-bucket-notification-configuration",
        ],
        "status": "STABLE",
      }
    `);

    query.mockResolvedValueOnce({
      Items: put.mock.calls
        .filter(([{ Item }]) => Item.status === Reconcilable.Status.STABLE)
        .map((call) => call[0].Item),
    });
    const deserialized = await load({
      deploymentName: 'test-deployment',
      resourceKey: 'test-deployment',
    });
    await deserialized.reconcile();
    expect(deserialized.resolveProperties()).toMatchInlineSnapshot(`
      {
        "_INTERNAL_STATE_RESOURCE": true,
        "accountId": "123456789012",
        "createdAt": 123456789,
        "deployment": {
          "accountId": "123456789012",
          "envPaths": {
            "cache": "mock",
            "config": "mock",
            "data": "mock",
            "log": "mock",
            "temp": "mock",
          },
          "name": "test-deployment",
          "region": "us-west-2",
          "stateTable": "test-deployment-state",
          "version": "0.0.1",
        },
        "globalQueryConcurrency": 10,
        "loggingLevel": "info",
        "maxQueriesPerAction": 10000,
        "region": "us-west-2",
        "resourceQueryConcurrency": 10,
      }
    `);
    expect(deserialized.status).toBe('STABLE');
    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');
    const destroyingStatusUpdate = update.mock.calls;

    const destroyedStatusUpdate = put.mock.calls
      .filter(([{ Item }]) => Item.status === Reconcilable.Status.DESTROYED)
      .map(([{ Item }]) => Item);

    // one less because the state table can't delete its own record
    expect(destroyingStatusUpdate).toHaveLength(56);
    expect(destroyedStatusUpdate).toHaveLength(0);

    expect(put).toHaveBeenCalledTimes(60);
    // one less because the state table can't delete its own record
    expect(_delete).toHaveBeenCalledTimes(56);
  }, 25000);
});
