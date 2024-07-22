/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = true;
const { Athena } = jest.requireMock('@aws-sdk/client-athena');

const {
  AthenaWorkGroup,
} = require('../../../lambdas/lib/actor/resources/aws/');
const { deserialize } = require('../../../lambdas/lib/actor/deserialize');

describe('athena workgroup IaC', () => {
  it('basic', async () => {
    expect.assertions(6);
    const athena = new Athena({});
    const workgroup = new AthenaWorkGroup({
      name: 'test-workgroup',
    });
    await workgroup.reconcile();

    const serialized = workgroup.serialize();
    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-workgroup",
        "properties": {},
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
              "s3": S3Mock {},
              "sqs": SQSMock {},
            },
            "__sqs": SQSMock {},
          },
          "glue": Glue {
            "glue": GlueMock {},
          },
        },
        "dependsOn": [],
        "emit": false,
        "name": "test-workgroup",
        "properties": {},
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
            "OutputLocation": undefined,
          },
        },
        "Description": undefined,
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
