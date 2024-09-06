/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = '1';
const { Athena } = jest.requireMock('@aws-sdk/client-athena');

const {
  AthenaWorkGroup,
} = require('../../../lambdas/lib/actor/resources/aws/');
const { deserialize } = require('../../../lambdas/lib/actor/deserialize');
const { getMockDeploymentProperties } = require('../util');

describe('athena workgroup IaC', () => {
  it('basic', async () => {
    expect.assertions(6);
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

    const serialized = workgroup.serialize();
    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-workgroup",
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

    const deserialized = deserialize(serialized);
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
  });
});
