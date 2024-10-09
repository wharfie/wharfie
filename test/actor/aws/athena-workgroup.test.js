/* eslint-disable jest/no-large-snapshots */
/* eslint-disable jest/no-hooks */
'use strict';

process.env.AWS_MOCKS = '1';
const { Athena } = jest.requireMock('@aws-sdk/client-athena');

const AWS = require('@aws-sdk/lib-dynamodb');
let query, _delete, put;

const {
  AthenaWorkGroup,
} = require('../../../lambdas/lib/actor/resources/aws/');
const { load } = require('../../../lambdas/lib/actor/deserialize');
const { getMockDeploymentProperties } = require('../util');
const Reconcilable = require('../../../lambdas/lib/actor/resources/reconcilable');

describe('athena workgroup IaC', () => {
  beforeAll(() => {
    put = AWS.spyOn('DynamoDBDocument', 'put');
    query = AWS.spyOn('DynamoDBDocument', 'query');
    _delete = AWS.spyOn('DynamoDBDocument', 'delete');
  });

  afterEach(() => {
    AWS.clearAllMocks();
  });
  it('basic', async () => {
    expect.assertions(14);
    const athena = new Athena({});
    const workgroup = new AthenaWorkGroup({
      name: 'test-workgroup',
      properties: {
        deployment: getMockDeploymentProperties(),
        outputLocation: 's3://test-bucket/test-prefix/',
        description: 'test-description',
      },
    });
    await workgroup.reconcile();

    const reconcilingStatusUpdate = put.mock.calls
      .filter(([{ Item }]) => Item.status === Reconcilable.Status.RECONCILING)
      .map(([{ Item }]) => Item);

    const stableStatusUpdate = put.mock.calls
      .filter(([{ Item }]) => Item.status === Reconcilable.Status.STABLE)
      .map(([{ Item }]) => Item);

    expect(reconcilingStatusUpdate).toHaveLength(1);
    expect(stableStatusUpdate).toHaveLength(1);
    expect(stableStatusUpdate).toMatchInlineSnapshot(`
      [
        {
          "deployment": "test-deployment",
          "resource_key": "test-workgroup",
          "serialized": {
            "dependsOn": [],
            "name": "test-workgroup",
            "parent": "",
            "properties": {
              "deployment": {
                "accountId": "123456789012",
                "envPaths": {
                  "cache": "",
                  "config": "",
                  "data": "",
                  "log": "",
                  "temp": "",
                },
                "name": "test-deployment",
                "region": "us-east-1",
                "stateTable": "_testing_state_table",
                "version": "0.0.1test",
              },
              "description": "test-description",
              "outputLocation": "s3://test-bucket/test-prefix/",
            },
            "resourceType": "AthenaWorkGroup",
            "status": "STABLE",
          },
          "status": "STABLE",
          "version": "0.0.1test",
        },
      ]
    `);

    const serialized = workgroup.serialize();
    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-workgroup",
        "parent": "",
        "properties": {
          "deployment": {
            "accountId": "123456789012",
            "envPaths": {
              "cache": "",
              "config": "",
              "data": "",
              "log": "",
              "temp": "",
            },
            "name": "test-deployment",
            "region": "us-east-1",
            "stateTable": "_testing_state_table",
            "version": "0.0.1test",
          },
          "description": "test-description",
          "outputLocation": "s3://test-bucket/test-prefix/",
        },
        "resourceType": "AthenaWorkGroup",
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
      resourceKey: 'test-workgroup',
    });
    await deserialized.reconcile();
    expect(deserialized).toMatchInlineSnapshot(`
      AthenaWorkGroup {
        "_MAX_RETRIES": 10,
        "_MAX_RETRY_TIMEOUT_SECONDS": 10,
        "_destroyErrors": [],
        "_reconcileErrors": [],
        "athena": Athena {
          "athena": AthenaMock {
            "__queryRunner": QueryRunner {
              "glue": GlueMock {},
              "parser": QueryParser {
                "parser": r {},
              },
              "s3": S3Mock {},
              "sqs": SQSMock {},
            },
            "__sqs": SQSMock {},
          },
          "glue": Glue {
            "glue": GlueMock {},
          },
          "parser": QueryParser {
            "parser": r {},
          },
        },
        "dependsOn": [],
        "name": "test-workgroup",
        "parent": "",
        "properties": {
          "deployment": {
            "accountId": "123456789012",
            "envPaths": {
              "cache": "",
              "config": "",
              "data": "",
              "log": "",
              "temp": "",
            },
            "name": "test-deployment",
            "region": "us-east-1",
            "stateTable": "_testing_state_table",
            "version": "0.0.1test",
          },
          "description": "test-description",
          "outputLocation": "s3://test-bucket/test-prefix/",
        },
        "resourceType": "AthenaWorkGroup",
        "status": "STABLE",
      }
    `);
    expect(deserialized.status).toBe('STABLE');

    const res = await athena.getWorkGroup({
      WorkGroup: 'test-workgroup',
    });

    expect(res).toMatchInlineSnapshot(`
      {
        "Configuration": {
          "EnforceWorkGroupConfiguration": true,
          "EngineVersion": {
            "SelectedEngineVersion": "Athena engine version 3",
          },
          "PublishCloudWatchMetricsEnabled": true,
          "ResultConfiguration": {
            "EncryptionConfiguration": {
              "EncryptionOption": "SSE_S3",
            },
            "OutputLocation": "s3://test-bucket/test-prefix/",
          },
        },
        "Description": "test-description",
        "Name": "test-workgroup",
        "Tags": undefined,
        "queries": {},
      }
    `);

    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');
    await expect(
      athena.getWorkGroup({ WorkGroup: 'test-workgroup' })
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"workgroup: test-workgroup does not exist"`
    );

    const destroyingStatusUpdate = put.mock.calls
      .filter(([{ Item }]) => Item.status === Reconcilable.Status.DESTROYING)
      .map(([{ Item }]) => Item);

    const destroyedStatusUpdate = put.mock.calls
      .filter(([{ Item }]) => Item.status === Reconcilable.Status.DESTROYED)
      .map(([{ Item }]) => Item);

    expect(destroyingStatusUpdate).toHaveLength(1);
    expect(destroyedStatusUpdate).toHaveLength(0);

    expect(put).toHaveBeenCalledTimes(3);
    expect(_delete).toHaveBeenCalledTimes(1);
    expect(_delete.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "Key": {
              "deployment": "test-deployment",
              "resource_key": "test-workgroup",
            },
            "TableName": "_testing_state_table",
          },
        ],
      ]
    `);
  });
});
