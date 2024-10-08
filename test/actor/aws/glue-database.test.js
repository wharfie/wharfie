/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = true;
const { Glue } = jest.requireMock('@aws-sdk/client-glue');

const { GlueDatabase } = require('../../../lambdas/lib/actor/resources/aws/');
const { getMockDeploymentProperties } = require('../util');

describe('glue database IaC', () => {
  it('basic', async () => {
    expect.assertions(4);
    const glue = new Glue({});
    const database = new GlueDatabase({
      name: 'test-database',
      properties: {
        deployment: getMockDeploymentProperties(),
      },
    });
    await database.reconcile();

    const serialized = database.serialize();
    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-database",
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
        },
        "resourceType": "GlueDatabase",
        "status": "STABLE",
      }
    `);

    const res = await glue.getDatabase({
      Name: database.name,
    });

    expect(res).toMatchInlineSnapshot(`
      {
        "Database": {
          "_tables": {},
        },
      }
    `);
    await database.destroy();
    expect(database.status).toBe('DESTROYED');
    await expect(
      glue.getDatabase({ Name: database.name })
    ).rejects.toThrowErrorMatchingInlineSnapshot(`"Database not found"`);
  });
});
