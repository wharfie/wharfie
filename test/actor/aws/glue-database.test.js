/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = true;
const { Glue } = jest.requireMock('@aws-sdk/client-glue');

const { GlueDatabase } = require('../../../lambdas/lib/actor/resources/aws/');
const { deserialize } = require('../../../lambdas/lib/actor/deserialize');

describe('glue database IaC', () => {
  it('basic', async () => {
    expect.assertions(6);
    const glue = new Glue({});
    const database = new GlueDatabase({
      name: 'test-database',
      properties: {},
    });
    await database.reconcile();

    const serialized = database.serialize();
    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-database",
        "properties": {},
        "resourceType": "GlueDatabase",
        "status": "STABLE",
      }
    `);

    const deserialized = deserialize(serialized);
    await deserialized.reconcile();
    expect(deserialized).toMatchInlineSnapshot(`
      GlueDatabase {
        "_MAX_RETRIES": 10,
        "_MAX_RETRY_TIMEOUT_SECONDS": 10,
        "_destroyErrors": [],
        "_reconcileErrors": [],
        "dependsOn": [],
        "glue": Glue {
          "glue": GlueMock {},
        },
        "name": "test-database",
        "properties": {},
        "resourceType": "GlueDatabase",
        "status": "STABLE",
      }
    `);
    expect(deserialized.status).toBe('STABLE');

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
    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');
    await expect(
      glue.getDatabase({ Name: database.name })
    ).rejects.toThrowErrorMatchingInlineSnapshot(`"Database not found"`);
  });
});
