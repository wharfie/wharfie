/* eslint-disable jest/no-large-snapshots */
/* eslint-disable jest/no-hooks */
'use strict';

const {
  Resource,
  Operation,
  Action,
  Query,
} = require('../../../lambdas/lib/graph');
const Logger = require('../../../lambdas/lib/logging/logger');
jest.mock('../../../lambdas/lib/dynamo/operations');

const operations = require('../../../lambdas/lib/dynamo/operations');

describe('dynamo resource db', () => {
  beforeAll(() => {
    const mockedDate = new Date(1466424490000);
    jest.useFakeTimers('modern');
    jest.setSystemTime(mockedDate);
  });
  afterEach(() => {
    operations.__setMockState();
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it('putResource', async () => {
    expect.assertions(1);
    await operations.putResource(
      new Resource({
        id: 'StackName',
        status: Resource.Status.ACTIVE,
        region: 'us-east-1',
        athena_workgroup: 'StackName',
        daemon_config: {
          Role: 'RoleArn',
        },
        source_properties: {
          arn: 'SourceArn',
          catalogId: 'SourceCatalogId',
          columns: [],
          compressed: false,
          databaseName: 'SourceDatabaseName',
          description: 'SourceDescription',
          name: 'SourceName',
          parameters: {},
          numberOfBuckets: 0,
          storedAsSubDirectories: false,
          region: 'us-east-1',
          tableType: 'PHYSICAL',
          tags: {},
        },
        destination_properties: {
          arn: 'DestinationArn',
          catalogId: 'SourceCatalogId',
          columns: [],
          compressed: false,
          databaseName: 'SourceDatabaseName',
          description: 'SourceDescription',
          name: 'SourceName',
          parameters: {},
          numberOfBuckets: 0,
          storedAsSubDirectories: false,
          region: 'us-east-1',
          tableType: 'PHYSICAL',
          tags: {},
        },
      })
    );
    expect(operations.__getMockState()).toMatchInlineSnapshot(`
      {
        "StackName": {
          "athena_workgroup": "StackName",
          "created_at": 1466424490000,
          "daemon_config": {
            "Role": "RoleArn",
          },
          "destination_properties": {
            "arn": "DestinationArn",
            "catalogId": "SourceCatalogId",
            "columns": [],
            "compressed": false,
            "databaseName": "SourceDatabaseName",
            "description": "SourceDescription",
            "name": "SourceName",
            "numberOfBuckets": 0,
            "parameters": {},
            "region": "us-east-1",
            "storedAsSubDirectories": false,
            "tableType": "PHYSICAL",
            "tags": {},
          },
          "id": "StackName",
          "last_updated_at": 1466424490000,
          "record_type": "RESOURCE",
          "region": "us-east-1",
          "source_properties": {
            "arn": "SourceArn",
            "catalogId": "SourceCatalogId",
            "columns": [],
            "compressed": false,
            "databaseName": "SourceDatabaseName",
            "description": "SourceDescription",
            "name": "SourceName",
            "numberOfBuckets": 0,
            "parameters": {},
            "region": "us-east-1",
            "storedAsSubDirectories": false,
            "tableType": "PHYSICAL",
            "tags": {},
          },
          "source_region": undefined,
          "status": "ACTIVE",
          "wharfie_version": "0.0.11",
        },
      }
    `);
  });

  it('getResource', async () => {
    expect.assertions(1);
    await operations.putResource(
      new Resource({
        id: 'StackName',
        status: Resource.Status.ACTIVE,
        region: 'us-east-1',
        athena_workgroup: 'StackName',
        daemon_config: {
          Role: 'RoleArn',
        },
        source_properties: {
          arn: 'SourceArn',
          catalogId: 'SourceCatalogId',
          columns: [],
          compressed: false,
          databaseName: 'SourceDatabaseName',
          description: 'SourceDescription',
          name: 'SourceName',
          parameters: {},
          numberOfBuckets: 0,
          storedAsSubDirectories: false,
          region: 'us-east-1',
          tableType: 'PHYSICAL',
          tags: {},
        },
        destination_properties: {
          arn: 'DestinationArn',
          catalogId: 'SourceCatalogId',
          columns: [],
          compressed: false,
          databaseName: 'SourceDatabaseName',
          description: 'SourceDescription',
          name: 'SourceName',
          parameters: {},
          numberOfBuckets: 0,
          storedAsSubDirectories: false,
          region: 'us-east-1',
          tableType: 'PHYSICAL',
          tags: {},
        },
      })
    );
    const result = await operations.getResource('StackName');
    expect(result).toMatchInlineSnapshot(`
      Resource {
        "athena_workgroup": "StackName",
        "created_at": 1466424490000,
        "daemon_config": {
          "Role": "RoleArn",
        },
        "destination_properties": {
          "arn": "DestinationArn",
          "catalogId": "SourceCatalogId",
          "columns": [],
          "compressed": false,
          "databaseName": "SourceDatabaseName",
          "description": "SourceDescription",
          "name": "SourceName",
          "numberOfBuckets": 0,
          "parameters": {},
          "region": "us-east-1",
          "storedAsSubDirectories": false,
          "tableType": "PHYSICAL",
          "tags": {},
        },
        "id": "StackName",
        "last_updated_at": 1466424490000,
        "region": "us-east-1",
        "source_properties": {
          "arn": "SourceArn",
          "catalogId": "SourceCatalogId",
          "columns": [],
          "compressed": false,
          "databaseName": "SourceDatabaseName",
          "description": "SourceDescription",
          "name": "SourceName",
          "numberOfBuckets": 0,
          "parameters": {},
          "region": "us-east-1",
          "storedAsSubDirectories": false,
          "tableType": "PHYSICAL",
          "tags": {},
        },
        "source_region": undefined,
        "status": "ACTIVE",
        "wharfie_version": "0.0.11",
      }
    `);
  });

  it('deleteResource', async () => {
    expect.assertions(1);
    const test_resource = new Resource({
      id: 'StackName',
      status: Resource.Status.ACTIVE,
      region: 'us-east-1',
      athena_workgroup: 'StackName',
      daemon_config: {
        Role: 'RoleArn',
      },
      source_properties: {
        arn: 'SourceArn',
        catalogId: 'SourceCatalogId',
        columns: [],
        compressed: false,
        databaseName: 'SourceDatabaseName',
        description: 'SourceDescription',
        name: 'SourceName',
        parameters: {},
        numberOfBuckets: 0,
        storedAsSubDirectories: false,
        region: 'us-east-1',
        tableType: 'PHYSICAL',
        tags: {},
      },
      destination_properties: {
        arn: 'DestinationArn',
        catalogId: 'SourceCatalogId',
        columns: [],
        compressed: false,
        databaseName: 'SourceDatabaseName',
        description: 'SourceDescription',
        name: 'SourceName',
        parameters: {},
        numberOfBuckets: 0,
        storedAsSubDirectories: false,
        region: 'us-east-1',
        tableType: 'PHYSICAL',
        tags: {},
      },
    });
    await operations.putResource(test_resource);
    await operations.deleteResource(test_resource);
    expect(operations.__getMockState()).toMatchInlineSnapshot(`{}`);
  });

  it('putOperation', async () => {
    expect.assertions(1);
    const test_resource = new Resource({
      id: 'resource_id',
      status: Resource.Status.ACTIVE,
      region: 'us-east-1',
      athena_workgroup: 'StackName',
      daemon_config: {
        Role: 'RoleArn',
      },
      source_properties: {
        arn: 'SourceArn',
        catalogId: 'SourceCatalogId',
        columns: [],
        compressed: false,
        databaseName: 'SourceDatabaseName',
        description: 'SourceDescription',
        name: 'SourceName',
        parameters: {},
        numberOfBuckets: 0,
        storedAsSubDirectories: false,
        region: 'us-east-1',
        tableType: 'PHYSICAL',
        tags: {},
      },
      destination_properties: {
        arn: 'DestinationArn',
        catalogId: 'SourceCatalogId',
        columns: [],
        compressed: false,
        databaseName: 'SourceDatabaseName',
        description: 'SourceDescription',
        name: 'SourceName',
        parameters: {},
        numberOfBuckets: 0,
        storedAsSubDirectories: false,
        region: 'us-east-1',
        tableType: 'PHYSICAL',
        tags: {},
      },
    });
    const test_operation = new Operation({
      resource_id: 'resource_id',
      type: Operation.Type.MAINTAIN,
      id: 'test_operation',
    });
    await operations.putResource(test_resource);
    await operations.putOperation(test_operation);
    expect(operations.__getMockState()).toMatchInlineSnapshot(`
      {
        "resource_id": {
          "athena_workgroup": "StackName",
          "created_at": 1466424490000,
          "daemon_config": {
            "Role": "RoleArn",
          },
          "destination_properties": {
            "arn": "DestinationArn",
            "catalogId": "SourceCatalogId",
            "columns": [],
            "compressed": false,
            "databaseName": "SourceDatabaseName",
            "description": "SourceDescription",
            "name": "SourceName",
            "numberOfBuckets": 0,
            "parameters": {},
            "region": "us-east-1",
            "storedAsSubDirectories": false,
            "tableType": "PHYSICAL",
            "tags": {},
          },
          "id": "resource_id",
          "last_updated_at": 1466424490000,
          "record_type": "RESOURCE",
          "region": "us-east-1",
          "source_properties": {
            "arn": "SourceArn",
            "catalogId": "SourceCatalogId",
            "columns": [],
            "compressed": false,
            "databaseName": "SourceDatabaseName",
            "description": "SourceDescription",
            "name": "SourceName",
            "numberOfBuckets": 0,
            "parameters": {},
            "region": "us-east-1",
            "storedAsSubDirectories": false,
            "tableType": "PHYSICAL",
            "tags": {},
          },
          "source_region": undefined,
          "status": "ACTIVE",
          "wharfie_version": "0.0.11",
        },
        "resource_id#test_operation": {
          "id": "test_operation",
          "last_updated_at": 1466424490000,
          "operation_config": undefined,
          "operation_inputs": undefined,
          "record_type": "OPERATION",
          "resource_id": "resource_id",
          "serialized_action_graph": "{"outgoingEdges":[],"incomingEdges":[],"actionIdsToTypes":[]}",
          "started_at": 1466424490000,
          "status": "PENDING",
          "type": "MAINTAIN",
          "wharfie_version": "0.0.11",
        },
      }
    `);
  });

  it('getOperation', async () => {
    expect.assertions(1);
    const test_resource = new Resource({
      id: 'resource_id',
      status: Resource.Status.ACTIVE,
      region: 'us-east-1',
      athena_workgroup: 'StackName',
      daemon_config: {
        Role: 'RoleArn',
      },
      source_properties: {
        arn: 'SourceArn',
        catalogId: 'SourceCatalogId',
        columns: [],
        compressed: false,
        databaseName: 'SourceDatabaseName',
        description: 'SourceDescription',
        name: 'SourceName',
        parameters: {},
        numberOfBuckets: 0,
        storedAsSubDirectories: false,
        region: 'us-east-1',
        tableType: 'PHYSICAL',
        tags: {},
      },
      destination_properties: {
        arn: 'DestinationArn',
        catalogId: 'SourceCatalogId',
        columns: [],
        compressed: false,
        databaseName: 'SourceDatabaseName',
        description: 'SourceDescription',
        name: 'SourceName',
        parameters: {},
        numberOfBuckets: 0,
        storedAsSubDirectories: false,
        region: 'us-east-1',
        tableType: 'PHYSICAL',
        tags: {},
      },
    });
    const test_operation = new Operation({
      resource_id: 'resource_id',
      id: 'operation_id',
      type: Operation.Type.MAINTAIN,
    });
    await operations.putResource(test_resource);
    await operations.putOperation(test_operation);
    const result = await operations.getOperation('resource_id', 'operation_id');
    expect(result).toMatchInlineSnapshot(`
      Operation {
        "actionIdsToTypes": Map {},
        "actions": Map {},
        "id": "operation_id",
        "incomingEdges": Map {},
        "last_updated_at": 1466424490000,
        "operation_config": undefined,
        "operation_inputs": undefined,
        "outgoingEdges": Map {},
        "resource_id": "resource_id",
        "started_at": 1466424490000,
        "status": "PENDING",
        "type": "MAINTAIN",
        "wharfie_version": "0.0.11",
      }
    `);
  });

  it('getAction', async () => {
    expect.assertions(1);
    const test_resource = new Resource({
      id: 'resource_id',
      status: Resource.Status.ACTIVE,
      region: 'us-east-1',
      athena_workgroup: 'StackName',
      daemon_config: {
        Role: 'RoleArn',
      },
      source_properties: {
        arn: 'SourceArn',
        catalogId: 'SourceCatalogId',
        columns: [],
        compressed: false,
        databaseName: 'SourceDatabaseName',
        description: 'SourceDescription',
        name: 'SourceName',
        parameters: {},
        numberOfBuckets: 0,
        storedAsSubDirectories: false,
        region: 'us-east-1',
        tableType: 'PHYSICAL',
        tags: {},
      },
      destination_properties: {
        arn: 'DestinationArn',
        catalogId: 'SourceCatalogId',
        columns: [],
        compressed: false,
        databaseName: 'SourceDatabaseName',
        description: 'SourceDescription',
        name: 'SourceName',
        parameters: {},
        numberOfBuckets: 0,
        storedAsSubDirectories: false,
        region: 'us-east-1',
        tableType: 'PHYSICAL',
        tags: {},
      },
    });
    const test_operation = new Operation({
      resource_id: 'resource_id',
      id: 'operation_id',
      type: Operation.Type.MAINTAIN,
    });
    test_operation.createAction({
      type: Action.Type.START,
      id: 'start_action',
    });
    await operations.putResource(test_resource);
    await operations.putOperation(test_operation);
    const result = await operations.getAction(
      'resource_id',
      'operation_id',
      test_operation.getActionIdByType(Action.Type.START)
    );
    expect(result).toMatchInlineSnapshot(`
      Action {
        "id": "start_action",
        "last_updated_at": 1466424490000,
        "operation_id": "operation_id",
        "queries": [],
        "resource_id": "resource_id",
        "started_at": 1466424490000,
        "status": "PENDING",
        "type": "START",
        "wharfie_version": "0.0.11",
      }
    `);
  });

  it('getQueries', async () => {
    expect.assertions(2);
    const test_resource = new Resource({
      id: 'resource_id',
      status: Resource.Status.ACTIVE,
      region: 'us-east-1',
      athena_workgroup: 'StackName',
      daemon_config: {
        Role: 'RoleArn',
      },
      source_properties: {
        arn: 'SourceArn',
        catalogId: 'SourceCatalogId',
        columns: [],
        compressed: false,
        databaseName: 'SourceDatabaseName',
        description: 'SourceDescription',
        name: 'SourceName',
        parameters: {},
        numberOfBuckets: 0,
        storedAsSubDirectories: false,
        region: 'us-east-1',
        tableType: 'PHYSICAL',
        tags: {},
      },
      destination_properties: {
        arn: 'DestinationArn',
        catalogId: 'SourceCatalogId',
        columns: [],
        compressed: false,
        databaseName: 'SourceDatabaseName',
        description: 'SourceDescription',
        name: 'SourceName',
        parameters: {},
        numberOfBuckets: 0,
        storedAsSubDirectories: false,
        region: 'us-east-1',
        tableType: 'PHYSICAL',
        tags: {},
      },
    });
    const test_operation = new Operation({
      resource_id: 'resource_id',
      id: 'operation_id',
      type: Operation.Type.MAINTAIN,
    });
    const test_action = test_operation.createAction({
      type: Action.Type.START,
      id: 'action_id',
    });
    await operations.putResource(test_resource);
    await operations.putOperation(test_operation);
    const query = new Query({
      id: 'query_id_1',
      resource_id: test_resource.id,
      operation_id: test_operation.id,
      action_id: test_action.id,
      status: Query.Status.PENDING,
      query_string: 'sql 1',
      query_data: 'query_data 1',
    });
    await operations.putQuery(query);
    const query2 = new Query({
      id: 'query_id_2',
      resource_id: test_resource.id,
      operation_id: test_operation.id,
      action_id: test_action.id,
      status: Query.Status.PENDING,
      query_string: 'sql 2',
      query_data: 'query_data 2',
    });
    await operations.putQuery(query2);

    const result = await operations.getQueries(
      test_resource.id,
      test_operation.id,
      test_action.id
    );
    expect(result).toHaveLength(2);
    expect(result).toMatchInlineSnapshot(`
      [
        Query {
          "action_id": "action_id",
          "execution_id": undefined,
          "id": "query_id_1",
          "last_updated_at": 1466424490000,
          "operation_id": "operation_id",
          "query_data": "query_data 1",
          "query_string": "sql 1",
          "resource_id": "resource_id",
          "started_at": 1466424490000,
          "status": "PENDING",
          "wharfie_version": "0.0.11",
        },
        Query {
          "action_id": "action_id",
          "execution_id": undefined,
          "id": "query_id_2",
          "last_updated_at": 1466424490000,
          "operation_id": "operation_id",
          "query_data": "query_data 2",
          "query_string": "sql 2",
          "resource_id": "resource_id",
          "started_at": 1466424490000,
          "status": "PENDING",
          "wharfie_version": "0.0.11",
        },
      ]
    `);
  });

  it('putAction', async () => {
    expect.assertions(2);
    const test_resource = new Resource({
      id: 'resource_id',
      status: Resource.Status.ACTIVE,
      region: 'us-east-1',
      athena_workgroup: 'StackName',
      daemon_config: {
        Role: 'RoleArn',
      },
      source_properties: {
        arn: 'SourceArn',
        catalogId: 'SourceCatalogId',
        columns: [],
        compressed: false,
        databaseName: 'SourceDatabaseName',
        description: 'SourceDescription',
        name: 'SourceName',
        parameters: {},
        numberOfBuckets: 0,
        storedAsSubDirectories: false,
        region: 'us-east-1',
        tableType: 'PHYSICAL',
        tags: {},
      },
      destination_properties: {
        arn: 'DestinationArn',
        catalogId: 'SourceCatalogId',
        columns: [],
        compressed: false,
        databaseName: 'SourceDatabaseName',
        description: 'SourceDescription',
        name: 'SourceName',
        parameters: {},
        numberOfBuckets: 0,
        storedAsSubDirectories: false,
        region: 'us-east-1',
        tableType: 'PHYSICAL',
        tags: {},
      },
    });
    const test_operation = new Operation({
      resource_id: 'resource_id',
      id: 'operation_id',
      type: Operation.Type.MAINTAIN,
    });
    const action = test_operation.createAction({
      type: Action.Type.START,
      id: 'action_id',
    });
    await operations.putResource(test_resource);
    await operations.putOperation(test_operation);
    action.status = Action.Status.COMPLETED;
    await operations.putAction(action);
    const result = await operations.getAction(
      'resource_id',
      'operation_id',
      'action_id'
    );
    expect(result).toMatchInlineSnapshot(`
      Action {
        "id": "action_id",
        "last_updated_at": 1466424490000,
        "operation_id": "operation_id",
        "queries": [],
        "resource_id": "resource_id",
        "started_at": 1466424490000,
        "status": "COMPLETED",
        "type": "START",
        "wharfie_version": "0.0.11",
      }
    `);
    expect(result?.status).toStrictEqual(Action.Status.COMPLETED);
  });

  it('putQuery', async () => {
    expect.assertions(1);
    const test_resource = new Resource({
      id: 'resource_id',
      status: Resource.Status.ACTIVE,
      region: 'us-east-1',
      athena_workgroup: 'StackName',
      daemon_config: {
        Role: 'RoleArn',
      },
      source_properties: {
        arn: 'SourceArn',
        catalogId: 'SourceCatalogId',
        columns: [],
        compressed: false,
        databaseName: 'SourceDatabaseName',
        description: 'SourceDescription',
        name: 'SourceName',
        parameters: {},
        numberOfBuckets: 0,
        storedAsSubDirectories: false,
        region: 'us-east-1',
        tableType: 'PHYSICAL',
        tags: {},
      },
      destination_properties: {
        arn: 'DestinationArn',
        catalogId: 'SourceCatalogId',
        columns: [],
        compressed: false,
        databaseName: 'SourceDatabaseName',
        description: 'SourceDescription',
        name: 'SourceName',
        parameters: {},
        numberOfBuckets: 0,
        storedAsSubDirectories: false,
        region: 'us-east-1',
        tableType: 'PHYSICAL',
        tags: {},
      },
    });
    const test_operation = new Operation({
      resource_id: 'resource_id',
      id: 'operation_id',
      type: Operation.Type.MAINTAIN,
    });
    test_operation.createAction({
      type: Action.Type.START,
      id: 'action_id',
    });
    await operations.putResource(test_resource);
    await operations.putOperation(test_operation);
    const query = new Query({
      id: 'query_id',
      resource_id: test_resource.id,
      operation_id: test_operation.id,
      action_id: test_operation.getActionIdByType(Action.Type.START),
      status: Query.Status.PENDING,
      query_string: 'sql 1',
      query_data: 'query_data 1',
    });
    await operations.putQuery(query);
    const result = await operations.getQuery(
      'resource_id',
      'operation_id',
      'action_id',
      'query_id'
    );
    expect(result).toMatchInlineSnapshot(`
      Query {
        "action_id": "action_id",
        "execution_id": undefined,
        "id": "query_id",
        "last_updated_at": 1466424490000,
        "operation_id": "operation_id",
        "query_data": "query_data 1",
        "query_string": "sql 1",
        "resource_id": "resource_id",
        "started_at": 1466424490000,
        "status": "PENDING",
        "wharfie_version": "0.0.11",
      }
    `);
  });

  it('putQueries', async () => {
    expect.assertions(1);
    const test_resource = new Resource({
      id: 'resource_id',
      status: Resource.Status.ACTIVE,
      region: 'us-east-1',
      athena_workgroup: 'StackName',
      daemon_config: {
        Role: 'RoleArn',
      },
      source_properties: {
        arn: 'SourceArn',
        catalogId: 'SourceCatalogId',
        columns: [],
        compressed: false,
        databaseName: 'SourceDatabaseName',
        description: 'SourceDescription',
        name: 'SourceName',
        parameters: {},
        numberOfBuckets: 0,
        storedAsSubDirectories: false,
        region: 'us-east-1',
        tableType: 'PHYSICAL',
        tags: {},
      },
      destination_properties: {
        arn: 'DestinationArn',
        catalogId: 'SourceCatalogId',
        columns: [],
        compressed: false,
        databaseName: 'SourceDatabaseName',
        description: 'SourceDescription',
        name: 'SourceName',
        parameters: {},
        numberOfBuckets: 0,
        storedAsSubDirectories: false,
        region: 'us-east-1',
        tableType: 'PHYSICAL',
        tags: {},
      },
    });
    const test_operation = new Operation({
      resource_id: 'resource_id',
      id: 'operation_id',
      type: Operation.Type.MAINTAIN,
    });
    test_operation.createAction({
      type: Action.Type.START,
      id: 'start_action',
    });
    await operations.putResource(test_resource);
    await operations.putOperation(test_operation);
    const query1 = new Query({
      id: 'query_id_1',
      resource_id: test_resource.id,
      operation_id: test_operation.id,
      action_id: test_operation.getActionIdByType(Action.Type.START),
      status: Query.Status.PENDING,
      query_string: 'sql 1',
      query_data: 'query_data 1',
    });
    const query2 = new Query({
      id: 'query_id_2',
      resource_id: test_resource.id,
      operation_id: test_operation.id,
      action_id: test_operation.getActionIdByType(Action.Type.START),
      status: Query.Status.PENDING,
      query_string: 'sql 2',
      query_data: 'query_data 2',
    });
    await operations.putQueries([query1, query2]);
    const result = await operations.getQueries(
      'resource_id',
      'operation_id',
      test_operation.getActionIdByType(Action.Type.START)
    );
    expect(result).toMatchInlineSnapshot(`
      [
        Query {
          "action_id": "start_action",
          "execution_id": undefined,
          "id": "query_id_1",
          "last_updated_at": 1466424490000,
          "operation_id": "operation_id",
          "query_data": "query_data 1",
          "query_string": "sql 1",
          "resource_id": "resource_id",
          "started_at": 1466424490000,
          "status": "PENDING",
          "wharfie_version": "0.0.11",
        },
        Query {
          "action_id": "start_action",
          "execution_id": undefined,
          "id": "query_id_2",
          "last_updated_at": 1466424490000,
          "operation_id": "operation_id",
          "query_data": "query_data 2",
          "query_string": "sql 2",
          "resource_id": "resource_id",
          "started_at": 1466424490000,
          "status": "PENDING",
          "wharfie_version": "0.0.11",
        },
      ]
    `);
  });

  it('checkActionPrerequisites', async () => {
    expect.assertions(1);

    const test_operation = new Operation({
      resource_id: 'resource_id',
      id: 'operation_id',
      type: Operation.Type.MAINTAIN,
    });
    const start_action = test_operation.createAction({
      type: Action.Type.START,
      id: 'start_action',
    });
    test_operation.createAction({
      type: Action.Type.FINISH,
      id: 'finish_action',
      dependsOn: [start_action],
    });
    await operations.putOperation(test_operation);
    start_action.status = Action.Status.COMPLETED;
    await operations.putAction(start_action);

    const operation = await operations.getOperation(
      'resource_id',
      'operation_id'
    );
    if (!operation) throw new Error('failed test');
    const result = await operations.checkActionPrerequisites(
      operation,
      Action.Type.FINISH,
      new Logger()
    );
    expect(result).toBe(true);
  });

  it('checkActionPrerequisites - not ready', async () => {
    expect.assertions(1);

    const test_operation = new Operation({
      resource_id: 'resource_id',
      id: 'operation_id',
      type: Operation.Type.MAINTAIN,
    });
    const start_action = test_operation.createAction({
      type: Action.Type.START,
      id: 'start_action',
    });
    test_operation.createAction({
      type: Action.Type.FINISH,
      dependsOn: [start_action],
      id: 'finish_action',
    });
    await operations.putOperation(test_operation);

    const operation = await operations.getOperation(
      'resource_id',
      'operation_id'
    );
    if (!operation) throw new Error('failed test');
    const result = await operations.checkActionPrerequisites(
      operation,
      Action.Type.FINISH,
      new Logger()
    );
    expect(result).toBe(false);
  });

  it('checkActionPrerequisites - failure', async () => {
    expect.assertions(1);
    const test_operation = new Operation({
      resource_id: 'resource_id',
      id: 'operation_id',
      type: Operation.Type.MAINTAIN,
    });
    const start_action = test_operation.createAction({
      type: Action.Type.START,
      id: 'start_action',
    });
    test_operation.createAction({
      type: Action.Type.FINISH,
      dependsOn: [start_action],
      id: 'finish_action',
    });
    await operations.putOperation(test_operation);
    start_action.status = Action.Status.RUNNING;
    const query1 = new Query({
      resource_id: 'resource_id',
      operation_id: test_operation.id,
      action_id: test_operation.getActionIdByType(Action.Type.START),
      status: Query.Status.RUNNING,
      query_string: 'sql 1',
      query_data: 'query_data 1',
    });
    const query2 = new Query({
      resource_id: 'resource_id',
      operation_id: test_operation.id,
      action_id: test_operation.getActionIdByType(Action.Type.START),
      status: Query.Status.FAILED,
      query_string: 'sql 2',
      query_data: 'query_data 2',
    });
    await operations.putQueries([query1, query2]);

    await operations.putAction(start_action);

    const operation = await operations.getOperation(
      'resource_id',
      'operation_id'
    );
    if (!operation) throw new Error('failed test');

    await expect(async () => {
      await operations.checkActionPrerequisites(
        operation,
        'FINISH',
        new Logger()
      );
    }).rejects.toThrow(Error);
  });

  it('deleteOperation', async () => {
    expect.assertions(1);
    const test_operation = new Operation({
      resource_id: 'resource_id',
      id: 'operation_id',
      type: Operation.Type.MAINTAIN,
    });
    const start_action = test_operation.createAction({
      type: Action.Type.START,
      id: 'start_action',
    });
    test_operation.createAction({
      type: Action.Type.FINISH,
      dependsOn: [start_action],
      id: 'finish_action',
    });
    await operations.putOperation(test_operation);

    await operations.deleteOperation(test_operation);
    const state = operations.__getMockState();
    expect(state).toMatchInlineSnapshot(`{}`);
  });

  it('getRecords', async () => {
    expect.assertions(1);

    const test_operation = new Operation({
      resource_id: 'resource_id',
      id: 'operation_id',
      type: Operation.Type.MAINTAIN,
    });
    const start_action = test_operation.createAction({
      type: Action.Type.START,
      id: 'start_action',
    });
    test_operation.createAction({
      type: Action.Type.FINISH,
      dependsOn: [start_action],
      id: 'finish_action',
    });
    await operations.putOperation(test_operation);
    start_action.status = Action.Status.RUNNING;
    const query1 = new Query({
      id: 'query_id_1',
      resource_id: 'resource_id',
      operation_id: test_operation.id,
      action_id: test_operation.getActionIdByType(Action.Type.START),
      status: Query.Status.RUNNING,
      query_string: 'sql 1',
      query_data: 'query_data 1',
    });
    const query2 = new Query({
      id: 'query_id_2',
      resource_id: 'resource_id',
      operation_id: test_operation.id,
      action_id: test_operation.getActionIdByType(Action.Type.START),
      status: Query.Status.FAILED,
      query_string: 'sql 2',
      query_data: 'query_data 2',
    });
    await operations.putQueries([query1, query2]);

    await operations.putAction(start_action);

    const records = await operations.getRecords('resource_id', 'operation_id');
    expect(records).toMatchInlineSnapshot(`
      {
        "actions": [
          Action {
            "id": "start_action",
            "last_updated_at": 1466424490000,
            "operation_id": "operation_id",
            "queries": [
              Query {
                "action_id": "start_action",
                "execution_id": undefined,
                "id": "query_id_2",
                "last_updated_at": 1466424490000,
                "operation_id": "operation_id",
                "query_data": "query_data 2",
                "query_string": "sql 2",
                "resource_id": "resource_id",
                "started_at": 1466424490000,
                "status": "FAILED",
                "wharfie_version": "0.0.11",
              },
              Query {
                "action_id": "start_action",
                "execution_id": undefined,
                "id": "query_id_1",
                "last_updated_at": 1466424490000,
                "operation_id": "operation_id",
                "query_data": "query_data 1",
                "query_string": "sql 1",
                "resource_id": "resource_id",
                "started_at": 1466424490000,
                "status": "RUNNING",
                "wharfie_version": "0.0.11",
              },
            ],
            "resource_id": "resource_id",
            "started_at": 1466424490000,
            "status": "RUNNING",
            "type": "START",
            "wharfie_version": "0.0.11",
          },
          Action {
            "id": "finish_action",
            "last_updated_at": 1466424490000,
            "operation_id": "operation_id",
            "queries": [],
            "resource_id": "resource_id",
            "started_at": 1466424490000,
            "status": "PENDING",
            "type": "FINISH",
            "wharfie_version": "0.0.11",
          },
        ],
        "operations": [
          Operation {
            "actionIdsToTypes": Map {
              "start_action" => "START",
              "finish_action" => "FINISH",
            },
            "actions": Map {
              "start_action" => Action {
                "id": "start_action",
                "last_updated_at": 1466424490000,
                "operation_id": "operation_id",
                "queries": [
                  Query {
                    "action_id": "start_action",
                    "execution_id": undefined,
                    "id": "query_id_2",
                    "last_updated_at": 1466424490000,
                    "operation_id": "operation_id",
                    "query_data": "query_data 2",
                    "query_string": "sql 2",
                    "resource_id": "resource_id",
                    "started_at": 1466424490000,
                    "status": "FAILED",
                    "wharfie_version": "0.0.11",
                  },
                  Query {
                    "action_id": "start_action",
                    "execution_id": undefined,
                    "id": "query_id_1",
                    "last_updated_at": 1466424490000,
                    "operation_id": "operation_id",
                    "query_data": "query_data 1",
                    "query_string": "sql 1",
                    "resource_id": "resource_id",
                    "started_at": 1466424490000,
                    "status": "RUNNING",
                    "wharfie_version": "0.0.11",
                  },
                ],
                "resource_id": "resource_id",
                "started_at": 1466424490000,
                "status": "RUNNING",
                "type": "START",
                "wharfie_version": "0.0.11",
              },
              "finish_action" => Action {
                "id": "finish_action",
                "last_updated_at": 1466424490000,
                "operation_id": "operation_id",
                "queries": [],
                "resource_id": "resource_id",
                "started_at": 1466424490000,
                "status": "PENDING",
                "type": "FINISH",
                "wharfie_version": "0.0.11",
              },
            },
            "id": "operation_id",
            "incomingEdges": Map {
              "finish_action" => [
                "start_action",
              ],
            },
            "last_updated_at": 1466424490000,
            "operation_config": undefined,
            "operation_inputs": undefined,
            "outgoingEdges": Map {
              "start_action" => [
                "finish_action",
              ],
            },
            "resource_id": "resource_id",
            "started_at": 1466424490000,
            "status": "PENDING",
            "type": "MAINTAIN",
            "wharfie_version": "0.0.11",
          },
        ],
        "queries": [
          Query {
            "action_id": "start_action",
            "execution_id": undefined,
            "id": "query_id_2",
            "last_updated_at": 1466424490000,
            "operation_id": "operation_id",
            "query_data": "query_data 2",
            "query_string": "sql 2",
            "resource_id": "resource_id",
            "started_at": 1466424490000,
            "status": "FAILED",
            "wharfie_version": "0.0.11",
          },
          Query {
            "action_id": "start_action",
            "execution_id": undefined,
            "id": "query_id_1",
            "last_updated_at": 1466424490000,
            "operation_id": "operation_id",
            "query_data": "query_data 1",
            "query_string": "sql 1",
            "resource_id": "resource_id",
            "started_at": 1466424490000,
            "status": "RUNNING",
            "wharfie_version": "0.0.11",
          },
        ],
      }
    `);
  });
});
