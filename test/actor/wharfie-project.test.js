/* eslint-disable jest/no-large-snapshots */
'use strict';

const path = require('path');

process.env.AWS_MOCKS = true;
jest.requireMock('@aws-sdk/client-s3');

// eslint-disable-next-line jest/no-untyped-mock-factory
jest.mock('../../package.json', () => ({ version: '0.0.1' }));
jest.mock('../../lambdas/lib/env-paths');
const WharfieProject = require('../../lambdas/lib/actor/resources/wharfie-project');
const WharfieDeployment = require('../../lambdas/lib/actor/wharfie-deployment');
const { getResourceOptions } = require('../../cli/project/template-actor');
const { loadProject } = require('../../cli/project/load');
const { deserialize } = require('../../lambdas/lib/actor/deserialize');

const { S3 } = require('@aws-sdk/client-s3');
const s3 = new S3();

describe('wharfie project IaC', () => {
  it('empty project', async () => {
    expect.assertions(4);
    const deployment = new WharfieDeployment({
      name: 'test-deployment',
      properties: {},
    });
    await deployment.reconcile();
    const wharfieProject = new WharfieProject({
      name: 'test-wharife-project',
      deployment,
    });
    await wharfieProject.reconcile();

    const serialized = wharfieProject.serialize();

    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-wharife-project",
        "properties": {
          "actorRoleArns": [
            "arn:aws:iam::123456789012:role/test-deployment-daemon-role",
            "arn:aws:iam::123456789012:role/test-deployment-cleanup-role",
            "arn:aws:iam::123456789012:role/test-deployment-events-role",
            "arn:aws:iam::123456789012:role/test-deployment-monitor-role",
          ],
          "dependencyTable": "test-deployment-dependencies",
          "deployment": {
            "accountId": "",
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
          "deploymentSharedPolicyArn": "arn:aws:iam:::policy/test-deployment-shared-policy",
          "eventsQueueArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-events-queue",
          "locationTable": "test-deployment-locations",
          "project": {
            "name": "test-wharife-project",
          },
          "resourceTable": "test-deployment-resource",
          "scheduleQueueArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-daemon-queue",
          "scheduleRoleArn": "arn:aws:iam::123456789012:role/test-deployment-event-role",
        },
        "resourceType": "WharfieProject",
        "resources": {
          "test-wharife-project": {
            "dependsOn": [],
            "name": "test-wharife-project",
            "properties": {
              "deployment": {
                "accountId": "",
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
              "project": {
                "name": "test-wharife-project",
              },
            },
            "resourceType": "GlueDatabase",
            "status": "STABLE",
          },
          "test-wharife-project-bucket-lz-fc6bi": {
            "dependsOn": [],
            "name": "test-wharife-project-bucket-lz-fc6bi",
            "properties": {
              "arn": "arn:aws:s3:::test-wharife-project-bucket-lz-fc6bi",
              "deployment": {
                "accountId": "",
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
              "lifecycleConfiguration": {
                "Rules": [
                  {
                    "AbortIncompleteMultipartUpload": {
                      "DaysAfterInitiation": 1,
                    },
                    "ID": "abort_incomplete_multipart_uploads",
                    "Prefix": "",
                    "Status": "Enabled",
                  },
                ],
              },
              "notificationConfiguration": {
                "QueueConfigurations": [
                  {
                    "Events": [
                      "s3:ObjectCreated:*",
                    ],
                    "QueueArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-events-queue",
                  },
                  {
                    "Events": [
                      "s3:ObjectRemoved:*",
                    ],
                    "QueueArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-events-queue",
                  },
                ],
              },
              "project": {
                "name": "test-wharife-project",
              },
            },
            "resourceType": "Bucket",
            "status": "STABLE",
          },
          "test-wharife-project-project-role": {
            "dependsOn": [],
            "name": "test-wharife-project-project-role",
            "properties": {
              "arn": "arn:aws:iam::123456789012:role/test-wharife-project-project-role",
              "assumeRolePolicyDocument": {
                "Statement": [
                  {
                    "Action": "sts:AssumeRole",
                    "Effect": "Allow",
                    "Principal": {
                      "AWS": [
                        "arn:aws:iam::123456789012:role/test-deployment-daemon-role",
                        "arn:aws:iam::123456789012:role/test-deployment-cleanup-role",
                        "arn:aws:iam::123456789012:role/test-deployment-events-role",
                        "arn:aws:iam::123456789012:role/test-deployment-monitor-role",
                      ],
                    },
                  },
                ],
                "Version": "2012-10-17",
              },
              "deployment": {
                "accountId": "",
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
              "description": "test-wharife-project project role",
              "managedPolicyArns": [
                "arn:aws:iam:::policy/test-deployment-shared-policy",
              ],
              "project": {
                "name": "test-wharife-project",
              },
              "rolePolicyDocument": undefined,
            },
            "resourceType": "Role",
            "status": "STABLE",
          },
        },
        "status": "STABLE",
      }
    `);

    const deserialized = deserialize(serialized);
    await deserialized.reconcile();
    expect(deserialized.properties).toMatchInlineSnapshot(`
      {
        "actorRoleArns": [
          "arn:aws:iam::123456789012:role/test-deployment-daemon-role",
          "arn:aws:iam::123456789012:role/test-deployment-cleanup-role",
          "arn:aws:iam::123456789012:role/test-deployment-events-role",
          "arn:aws:iam::123456789012:role/test-deployment-monitor-role",
        ],
        "dependencyTable": "test-deployment-dependencies",
        "deployment": {
          "accountId": "",
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
        "deploymentSharedPolicyArn": "arn:aws:iam:::policy/test-deployment-shared-policy",
        "eventsQueueArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-events-queue",
        "locationTable": "test-deployment-locations",
        "project": {
          "name": "test-wharife-project",
        },
        "resourceTable": "test-deployment-resource",
        "scheduleQueueArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-daemon-queue",
        "scheduleRoleArn": "arn:aws:iam::123456789012:role/test-deployment-event-role",
      }
    `);
    expect(deserialized.status).toBe('STABLE');
    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');
  }, 10000);

  it('normal project', async () => {
    expect.assertions(4);
    // setting up buckets for mock
    s3.__setMockState({
      's3://amazon-berkeley-objects/empty.json': '',
      's3://utility-079185815456-us-west-2/empty.json': '',
    });
    const deployment = new WharfieDeployment({
      name: 'test-deployment',
      properties: {},
    });
    await deployment.reconcile();

    const wharfieProject = new WharfieProject({
      name: 'test-wharife-project',
      deployment,
    });

    const project = await loadProject({
      path: path.join(__dirname, '../fixtures/project_fixture'),
    });
    const environment = {
      name: 'test-environment',
      variables: {},
    };

    const resourceOptions = getResourceOptions(environment, project);

    wharfieProject.registerWharfieResources(resourceOptions);

    await wharfieProject.reconcile();

    const serialized = wharfieProject.serialize();

    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-wharife-project",
        "properties": {
          "actorRoleArns": [
            "arn:aws:iam::123456789012:role/test-deployment-daemon-role",
            "arn:aws:iam::123456789012:role/test-deployment-cleanup-role",
            "arn:aws:iam::123456789012:role/test-deployment-events-role",
            "arn:aws:iam::123456789012:role/test-deployment-monitor-role",
          ],
          "dependencyTable": "test-deployment-dependencies",
          "deployment": {
            "accountId": "",
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
          "deploymentSharedPolicyArn": "arn:aws:iam:::policy/test-deployment-shared-policy",
          "eventsQueueArn": undefined,
          "locationTable": "test-deployment-locations",
          "project": {
            "name": "test-wharife-project",
          },
          "resourceTable": "test-deployment-resource",
          "scheduleQueueArn": undefined,
          "scheduleRoleArn": "arn:aws:iam::123456789012:role/test-deployment-event-role",
        },
        "resourceType": "WharfieProject",
        "resources": {
          "amazon_berkely_objects-resource": {
            "dependsOn": [
              "test-wharife-project-project-role",
              "test-wharife-project-bucket-lz-fc6bi",
            ],
            "name": "amazon_berkely_objects-resource",
            "properties": {
              "catalogId": "",
              "columns": [
                {
                  "name": "brand",
                  "type": "array<struct<language_tag:string,value:string>>",
                },
                {
                  "name": "bullet_point",
                  "type": "array<struct<language_tag:string,value:string>>",
                },
                {
                  "name": "color",
                  "type": "array<struct<language_tag:string,value:string>>",
                },
                {
                  "name": "color_code",
                  "type": "array<string>",
                },
                {
                  "name": "country",
                  "type": "string",
                },
                {
                  "name": "domain_name",
                  "type": "string",
                },
                {
                  "name": "fabric_type",
                  "type": "array<struct<language_tag:string,value:string>>",
                },
                {
                  "name": "finish_type",
                  "type": "array<struct<language_tag:string,value:string>>",
                },
                {
                  "name": "item_dimensions",
                  "type": "struct<height:struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>,length:struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>,width:struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>>",
                },
                {
                  "name": "item_id",
                  "type": "string",
                },
                {
                  "name": "item_keywords",
                  "type": "array<struct<language_tag:string,value:string>>",
                },
                {
                  "name": "item_name",
                  "type": "array<struct<language_tag:string,value:string>>",
                },
                {
                  "name": "item_shape",
                  "type": "array<struct<language_tag:string,value:string>>",
                },
                {
                  "name": "item_weight",
                  "type": "array<struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>>",
                },
                {
                  "name": "main_image_id",
                  "type": "string",
                },
                {
                  "name": "marketplace",
                  "type": "string",
                },
                {
                  "name": "material",
                  "type": "array<struct<language_tag:string,value:string>>",
                },
                {
                  "name": "model_name",
                  "type": "array<struct<language_tag:string,value:string>>",
                },
                {
                  "name": "model_number",
                  "type": "array<struct<language_tag:string,value:string>>",
                },
                {
                  "name": "model_year",
                  "type": "array<struct<language_tag:string,value:string>>",
                },
                {
                  "name": "node",
                  "type": "array<struct<node_id:bigint,path:string>>",
                },
                {
                  "name": "other_image_id",
                  "type": "array<string>",
                },
                {
                  "name": "pattern",
                  "type": "array<struct<language_tag:string,value:string>>",
                },
                {
                  "name": "product_description",
                  "type": "array<struct<language_tag:string,value:string>>",
                },
                {
                  "name": "product_type",
                  "type": "array<struct<value:string>>",
                },
                {
                  "name": "spin_id",
                  "type": "string",
                },
                {
                  "name": "style",
                  "type": "array<struct<language_tag:string,value:string>>",
                },
                {
                  "name": "3dmodel_id",
                  "type": "string",
                },
              ],
              "compressed": undefined,
              "databaseName": "test-wharife-project",
              "dependencyTable": "test-deployment-dependencies",
              "deployment": {
                "accountId": "",
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
              "description": "Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html",
              "inputFormat": "org.apache.hadoop.mapred.TextInputFormat",
              "inputLocation": "s3://amazon-berkeley-objects/listings/metadata/",
              "interval": 300,
              "locationTable": "test-deployment-locations",
              "migrationResource": false,
              "numberOfBuckets": 0,
              "outputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
              "outputLocation": "s3://test-wharife-project-bucket-lz-fc6bi/amazon_berkely_objects/",
              "parameters": {
                "EXTERNAL": "true",
              },
              "partitionKeys": undefined,
              "project": {
                "name": "test-wharife-project",
              },
              "projectBucket": "test-wharife-project-bucket-lz-fc6bi",
              "projectName": "test-wharife-project",
              "region": "us-west-2",
              "resourceId": "test-wharife-project.amazon_berkely_objects",
              "resourceName": "amazon_berkely_objects",
              "resourceTable": "test-deployment-resource",
              "roleArn": "arn:aws:iam::123456789012:role/test-wharife-project-project-role",
              "scheduleQueueArn": undefined,
              "scheduleRoleArn": "arn:aws:iam::123456789012:role/test-deployment-event-role",
              "serdeInfo": {
                "Parameters": {
                  "ignore.malformed.json": "true",
                },
                "SerializationLibrary": "org.openx.data.jsonserde.JsonSerDe",
              },
              "storedAsSubDirectories": true,
              "tableType": "EXTERNAL_TABLE",
            },
            "resourceType": "WharfieResource",
            "resources": {
              "amazon_berkely_objects": {
                "dependsOn": [],
                "name": "amazon_berkely_objects",
                "properties": {
                  "arn": "arn:aws:glue:us-west-2::table/test-wharife-project/amazon_berkely_objects",
                  "catalogId": "",
                  "columns": [
                    {
                      "name": "brand",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "bullet_point",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "color",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "color_code",
                      "type": "array<string>",
                    },
                    {
                      "name": "country",
                      "type": "string",
                    },
                    {
                      "name": "domain_name",
                      "type": "string",
                    },
                    {
                      "name": "fabric_type",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "finish_type",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "item_dimensions",
                      "type": "struct<height:struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>,length:struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>,width:struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>>",
                    },
                    {
                      "name": "item_id",
                      "type": "string",
                    },
                    {
                      "name": "item_keywords",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "item_name",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "item_shape",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "item_weight",
                      "type": "array<struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>>",
                    },
                    {
                      "name": "main_image_id",
                      "type": "string",
                    },
                    {
                      "name": "marketplace",
                      "type": "string",
                    },
                    {
                      "name": "material",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "model_name",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "model_number",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "model_year",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "node",
                      "type": "array<struct<node_id:bigint,path:string>>",
                    },
                    {
                      "name": "other_image_id",
                      "type": "array<string>",
                    },
                    {
                      "name": "pattern",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "product_description",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "product_type",
                      "type": "array<struct<value:string>>",
                    },
                    {
                      "name": "spin_id",
                      "type": "string",
                    },
                    {
                      "name": "style",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "3dmodel_id",
                      "type": "string",
                    },
                  ],
                  "compressed": true,
                  "databaseName": "test-wharife-project",
                  "deployment": {
                    "accountId": "",
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
                  "description": "Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html",
                  "inputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
                  "location": "s3://test-wharife-project-bucket-lz-fc6bi/amazon_berkely_objects/references/",
                  "numberOfBuckets": 0,
                  "outputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
                  "parameters": {
                    "EXTERNAL": "TRUE",
                    "parquet.compress": "GZIP",
                  },
                  "partitionKeys": undefined,
                  "region": "us-west-2",
                  "serdeInfo": {
                    "Parameters": {
                      "parquet.compress": "GZIP",
                    },
                    "SerializationLibrary": "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
                  },
                  "storedAsSubDirectories": false,
                  "tableType": "EXTERNAL_TABLE",
                  "tags": [],
                },
                "resourceType": "GlueTable",
                "status": "STABLE",
              },
              "amazon_berkely_objects_raw": {
                "dependsOn": [],
                "name": "amazon_berkely_objects_raw",
                "properties": {
                  "arn": "arn:aws:glue:us-west-2::table/test-wharife-project/amazon_berkely_objects_raw",
                  "catalogId": "",
                  "columns": [
                    {
                      "name": "brand",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "bullet_point",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "color",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "color_code",
                      "type": "array<string>",
                    },
                    {
                      "name": "country",
                      "type": "string",
                    },
                    {
                      "name": "domain_name",
                      "type": "string",
                    },
                    {
                      "name": "fabric_type",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "finish_type",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "item_dimensions",
                      "type": "struct<height:struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>,length:struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>,width:struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>>",
                    },
                    {
                      "name": "item_id",
                      "type": "string",
                    },
                    {
                      "name": "item_keywords",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "item_name",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "item_shape",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "item_weight",
                      "type": "array<struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>>",
                    },
                    {
                      "name": "main_image_id",
                      "type": "string",
                    },
                    {
                      "name": "marketplace",
                      "type": "string",
                    },
                    {
                      "name": "material",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "model_name",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "model_number",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "model_year",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "node",
                      "type": "array<struct<node_id:bigint,path:string>>",
                    },
                    {
                      "name": "other_image_id",
                      "type": "array<string>",
                    },
                    {
                      "name": "pattern",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "product_description",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "product_type",
                      "type": "array<struct<value:string>>",
                    },
                    {
                      "name": "spin_id",
                      "type": "string",
                    },
                    {
                      "name": "style",
                      "type": "array<struct<language_tag:string,value:string>>",
                    },
                    {
                      "name": "3dmodel_id",
                      "type": "string",
                    },
                  ],
                  "compressed": undefined,
                  "databaseName": "test-wharife-project",
                  "deployment": {
                    "accountId": "",
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
                  "description": "Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html",
                  "inputFormat": "org.apache.hadoop.mapred.TextInputFormat",
                  "location": "s3://amazon-berkeley-objects/listings/metadata/",
                  "numberOfBuckets": 0,
                  "outputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                  "parameters": {
                    "EXTERNAL": "true",
                  },
                  "partitionKeys": undefined,
                  "region": "us-west-2",
                  "serdeInfo": {
                    "Parameters": {
                      "ignore.malformed.json": "true",
                    },
                    "SerializationLibrary": "org.openx.data.jsonserde.JsonSerDe",
                  },
                  "storedAsSubDirectories": true,
                  "tableType": "EXTERNAL_TABLE",
                  "tags": [],
                },
                "resourceType": "GlueTable",
                "status": "STABLE",
              },
              "test-deployment-amazon_berkely_objects-workgroup": {
                "dependsOn": [],
                "name": "test-deployment-amazon_berkely_objects-workgroup",
                "properties": {
                  "deployment": {
                    "accountId": "",
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
                  "description": "test-deployment resource amazon_berkely_objects workgroup",
                  "outputLocation": "s3://test-wharife-project-bucket-lz-fc6bi/amazon_berkely_objects/query_metadata/",
                },
                "resourceType": "AthenaWorkGroup",
                "status": "STABLE",
              },
              "test-wharife-project-amazon_berkely_objects-location-record": {
                "dependsOn": [],
                "name": "test-wharife-project-amazon_berkely_objects-location-record",
                "properties": {
                  "data": {
                    "interval": 300,
                  },
                  "deployment": {
                    "accountId": "",
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
                  "keyName": "location",
                  "keyValue": "s3://amazon-berkeley-objects/listings/metadata/",
                  "sortKeyName": "resource_id",
                  "sortKeyValue": "test-wharife-project.amazon_berkely_objects",
                  "tableName": "test-deployment-locations",
                },
                "resourceType": "TableRecord",
                "status": "STABLE",
              },
              "test-wharife-project-amazon_berkely_objects-resource-record": {
                "dependsOn": [],
                "name": "test-wharife-project-amazon_berkely_objects-resource-record",
                "properties": {
                  "data": {
                    "data": {
                      "athena_workgroup": "test-deployment-amazon_berkely_objects-workgroup",
                      "daemon_config": {
                        "Role": "arn:aws:iam::123456789012:role/test-wharife-project-project-role",
                      },
                      "destination_properties": {
                        "arn": "arn:aws:glue:us-west-2::table/test-wharife-project/amazon_berkely_objects",
                        "catalogId": "",
                        "columns": [
                          {
                            "name": "brand",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "bullet_point",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "color",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "color_code",
                            "type": "array<string>",
                          },
                          {
                            "name": "country",
                            "type": "string",
                          },
                          {
                            "name": "domain_name",
                            "type": "string",
                          },
                          {
                            "name": "fabric_type",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "finish_type",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "item_dimensions",
                            "type": "struct<height:struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>,length:struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>,width:struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>>",
                          },
                          {
                            "name": "item_id",
                            "type": "string",
                          },
                          {
                            "name": "item_keywords",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "item_name",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "item_shape",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "item_weight",
                            "type": "array<struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>>",
                          },
                          {
                            "name": "main_image_id",
                            "type": "string",
                          },
                          {
                            "name": "marketplace",
                            "type": "string",
                          },
                          {
                            "name": "material",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "model_name",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "model_number",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "model_year",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "node",
                            "type": "array<struct<node_id:bigint,path:string>>",
                          },
                          {
                            "name": "other_image_id",
                            "type": "array<string>",
                          },
                          {
                            "name": "pattern",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "product_description",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "product_type",
                            "type": "array<struct<value:string>>",
                          },
                          {
                            "name": "spin_id",
                            "type": "string",
                          },
                          {
                            "name": "style",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "3dmodel_id",
                            "type": "string",
                          },
                        ],
                        "compressed": true,
                        "databaseName": "test-wharife-project",
                        "deployment": {
                          "accountId": "",
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
                        "description": "Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html",
                        "inputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
                        "location": "s3://test-wharife-project-bucket-lz-fc6bi/amazon_berkely_objects/references/",
                        "name": "amazon_berkely_objects",
                        "numberOfBuckets": 0,
                        "outputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
                        "parameters": {
                          "EXTERNAL": "TRUE",
                          "parquet.compress": "GZIP",
                        },
                        "partitionKeys": undefined,
                        "region": "us-west-2",
                        "serdeInfo": {
                          "Parameters": {
                            "parquet.compress": "GZIP",
                          },
                          "SerializationLibrary": "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
                        },
                        "storedAsSubDirectories": false,
                        "tableType": "EXTERNAL_TABLE",
                        "tags": [],
                      },
                      "region": "us-west-2",
                      "resource_status": "CREATING",
                      "source_properties": {
                        "arn": "arn:aws:glue:us-west-2::table/test-wharife-project/amazon_berkely_objects_raw",
                        "catalogId": "",
                        "columns": [
                          {
                            "name": "brand",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "bullet_point",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "color",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "color_code",
                            "type": "array<string>",
                          },
                          {
                            "name": "country",
                            "type": "string",
                          },
                          {
                            "name": "domain_name",
                            "type": "string",
                          },
                          {
                            "name": "fabric_type",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "finish_type",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "item_dimensions",
                            "type": "struct<height:struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>,length:struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>,width:struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>>",
                          },
                          {
                            "name": "item_id",
                            "type": "string",
                          },
                          {
                            "name": "item_keywords",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "item_name",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "item_shape",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "item_weight",
                            "type": "array<struct<normalized_value:struct<unit:string,value:float>,value:float,unit:string>>",
                          },
                          {
                            "name": "main_image_id",
                            "type": "string",
                          },
                          {
                            "name": "marketplace",
                            "type": "string",
                          },
                          {
                            "name": "material",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "model_name",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "model_number",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "model_year",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "node",
                            "type": "array<struct<node_id:bigint,path:string>>",
                          },
                          {
                            "name": "other_image_id",
                            "type": "array<string>",
                          },
                          {
                            "name": "pattern",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "product_description",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "product_type",
                            "type": "array<struct<value:string>>",
                          },
                          {
                            "name": "spin_id",
                            "type": "string",
                          },
                          {
                            "name": "style",
                            "type": "array<struct<language_tag:string,value:string>>",
                          },
                          {
                            "name": "3dmodel_id",
                            "type": "string",
                          },
                        ],
                        "compressed": undefined,
                        "databaseName": "test-wharife-project",
                        "deployment": {
                          "accountId": "",
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
                        "description": "Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html",
                        "inputFormat": "org.apache.hadoop.mapred.TextInputFormat",
                        "location": "s3://amazon-berkeley-objects/listings/metadata/",
                        "name": "amazon_berkely_objects_raw",
                        "numberOfBuckets": 0,
                        "outputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                        "parameters": {
                          "EXTERNAL": "true",
                        },
                        "partitionKeys": undefined,
                        "region": "us-west-2",
                        "serdeInfo": {
                          "Parameters": {
                            "ignore.malformed.json": "true",
                          },
                          "SerializationLibrary": "org.openx.data.jsonserde.JsonSerDe",
                        },
                        "storedAsSubDirectories": true,
                        "tableType": "EXTERNAL_TABLE",
                        "tags": [],
                      },
                      "source_region": "us-east-1",
                      "wharfie_version": "0.0.1",
                    },
                  },
                  "deployment": {
                    "accountId": "",
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
                  "keyName": "resource_id",
                  "keyValue": "test-wharife-project.amazon_berkely_objects",
                  "sortKeyName": "sort_key",
                  "sortKeyValue": "test-wharife-project.amazon_berkely_objects",
                  "tableName": "test-deployment-resource",
                },
                "resourceType": "TableRecord",
                "status": "STABLE",
              },
            },
            "status": "STABLE",
          },
          "amazon_berkely_objects_aggregated-resource": {
            "dependsOn": [
              "test-wharife-project-project-role",
              "test-wharife-project-bucket-lz-fc6bi",
            ],
            "name": "amazon_berkely_objects_aggregated-resource",
            "properties": {
              "catalogId": "",
              "columns": [
                {
                  "name": "country",
                  "type": "string",
                },
                {
                  "name": "brands",
                  "type": "string",
                },
                {
                  "name": "count",
                  "type": "bigint",
                },
              ],
              "compressed": false,
              "databaseName": "test-wharife-project",
              "dependencyTable": "test-deployment-dependencies",
              "deployment": {
                "accountId": "",
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
              "description": "Materialized Table",
              "interval": 300,
              "locationTable": "test-deployment-locations",
              "migrationResource": false,
              "numberOfBuckets": 0,
              "outputLocation": "s3://test-wharife-project-bucket-lz-fc6bi/amazon_berkely_objects_aggregated/",
              "parameters": {
                "comment": "Presto View",
                "presto_view": "true",
              },
              "partitionKeys": undefined,
              "project": {
                "name": "test-wharife-project",
              },
              "projectBucket": "test-wharife-project-bucket-lz-fc6bi",
              "projectName": "test-wharife-project",
              "region": "us-west-2",
              "resourceId": "test-wharife-project.amazon_berkely_objects_aggregated",
              "resourceName": "amazon_berkely_objects_aggregated",
              "resourceTable": "test-deployment-resource",
              "roleArn": "arn:aws:iam::123456789012:role/test-wharife-project-project-role",
              "scheduleQueueArn": undefined,
              "scheduleRoleArn": "arn:aws:iam::123456789012:role/test-deployment-event-role",
              "storedAsSubDirectories": false,
              "tableType": "VIRTUAL_VIEW",
              "viewExpandedText": "/* Presto View */",
              "viewOriginalText": "/* Presto View: eyJvcmlnaW5hbFNxbCI6IldJVEggdW5uZXN0ZWRfdGFibGUgQVMgKFxuICBTRUxFQ1QgY291bnRyeSwgYnJhbmRfZWxlbWVudC52YWx1ZSBBUyBicmFuZHNcbiAgRlJPTSBwcm9qZWN0X2ZpeHR1cmUuYW1hem9uX2JlcmtlbHlfb2JqZWN0cyxcbiAgVU5ORVNUKGJyYW5kKSBBUyB0KGJyYW5kX2VsZW1lbnQpXG4pXG5TRUxFQ1QgY291bnRyeSwgYnJhbmRzLCBDT1VOVCgqKSBBUyBjb3VudFxuRlJPTSB1bm5lc3RlZF90YWJsZVxuR1JPVVAgQlkgY291bnRyeSwgYnJhbmRzXG5PUkRFUiBCWSBjb3VudCBERVNDXG4iLCJjYXRhbG9nIjoiYXdzZGF0YWNhdGFsb2ciLCJjb2x1bW5zIjpbeyJuYW1lIjoiY291bnRyeSIsInR5cGUiOiJ2YXJjaGFyIn0seyJuYW1lIjoiYnJhbmRzIiwidHlwZSI6InZhcmNoYXIifSx7Im5hbWUiOiJjb3VudCIsInR5cGUiOiJiaWdpbnQifV19 */",
            },
            "resourceType": "WharfieResource",
            "resources": {
              "amazon_berkely_objects_aggregated": {
                "dependsOn": [],
                "name": "amazon_berkely_objects_aggregated",
                "properties": {
                  "arn": "arn:aws:glue:us-west-2::table/test-wharife-project/amazon_berkely_objects_aggregated",
                  "catalogId": "",
                  "columns": [
                    {
                      "name": "country",
                      "type": "string",
                    },
                    {
                      "name": "brands",
                      "type": "string",
                    },
                    {
                      "name": "count",
                      "type": "bigint",
                    },
                  ],
                  "compressed": true,
                  "databaseName": "test-wharife-project",
                  "deployment": {
                    "accountId": "",
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
                  "description": "Materialized Table",
                  "inputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
                  "location": "s3://test-wharife-project-bucket-lz-fc6bi/amazon_berkely_objects_aggregated/references/",
                  "numberOfBuckets": 0,
                  "outputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
                  "parameters": {
                    "EXTERNAL": "TRUE",
                    "parquet.compress": "GZIP",
                  },
                  "partitionKeys": undefined,
                  "region": "us-west-2",
                  "serdeInfo": {
                    "Parameters": {
                      "parquet.compress": "GZIP",
                    },
                    "SerializationLibrary": "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
                  },
                  "storedAsSubDirectories": false,
                  "tableType": "EXTERNAL_TABLE",
                  "tags": [],
                },
                "resourceType": "GlueTable",
                "status": "STABLE",
              },
              "amazon_berkely_objects_aggregated_raw": {
                "dependsOn": [],
                "name": "amazon_berkely_objects_aggregated_raw",
                "properties": {
                  "arn": "arn:aws:glue:us-west-2::table/test-wharife-project/amazon_berkely_objects_aggregated_raw",
                  "catalogId": "",
                  "columns": [
                    {
                      "name": "country",
                      "type": "string",
                    },
                    {
                      "name": "brands",
                      "type": "string",
                    },
                    {
                      "name": "count",
                      "type": "bigint",
                    },
                  ],
                  "compressed": false,
                  "databaseName": "test-wharife-project",
                  "deployment": {
                    "accountId": "",
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
                  "description": "Materialized Table",
                  "inputFormat": undefined,
                  "location": undefined,
                  "numberOfBuckets": 0,
                  "outputFormat": undefined,
                  "parameters": {
                    "comment": "Presto View",
                    "presto_view": "true",
                  },
                  "partitionKeys": undefined,
                  "region": "us-west-2",
                  "serdeInfo": undefined,
                  "storedAsSubDirectories": false,
                  "tableType": "VIRTUAL_VIEW",
                  "tags": [],
                  "viewExpandedText": "/* Presto View */",
                  "viewOriginalText": "/* Presto View: eyJvcmlnaW5hbFNxbCI6IldJVEggdW5uZXN0ZWRfdGFibGUgQVMgKFxuICBTRUxFQ1QgY291bnRyeSwgYnJhbmRfZWxlbWVudC52YWx1ZSBBUyBicmFuZHNcbiAgRlJPTSBwcm9qZWN0X2ZpeHR1cmUuYW1hem9uX2JlcmtlbHlfb2JqZWN0cyxcbiAgVU5ORVNUKGJyYW5kKSBBUyB0KGJyYW5kX2VsZW1lbnQpXG4pXG5TRUxFQ1QgY291bnRyeSwgYnJhbmRzLCBDT1VOVCgqKSBBUyBjb3VudFxuRlJPTSB1bm5lc3RlZF90YWJsZVxuR1JPVVAgQlkgY291bnRyeSwgYnJhbmRzXG5PUkRFUiBCWSBjb3VudCBERVNDXG4iLCJjYXRhbG9nIjoiYXdzZGF0YWNhdGFsb2ciLCJjb2x1bW5zIjpbeyJuYW1lIjoiY291bnRyeSIsInR5cGUiOiJ2YXJjaGFyIn0seyJuYW1lIjoiYnJhbmRzIiwidHlwZSI6InZhcmNoYXIifSx7Im5hbWUiOiJjb3VudCIsInR5cGUiOiJiaWdpbnQifV19 */",
                },
                "resourceType": "GlueTable",
                "status": "STABLE",
              },
              "test-deployment-amazon_berkely_objects_aggregated-workgroup": {
                "dependsOn": [],
                "name": "test-deployment-amazon_berkely_objects_aggregated-workgroup",
                "properties": {
                  "deployment": {
                    "accountId": "",
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
                  "description": "test-deployment resource amazon_berkely_objects_aggregated workgroup",
                  "outputLocation": "s3://test-wharife-project-bucket-lz-fc6bi/amazon_berkely_objects_aggregated/query_metadata/",
                },
                "resourceType": "AthenaWorkGroup",
                "status": "STABLE",
              },
              "test-wharife-project-amazon_berkely_objects_aggregated-dependency-record-2": {
                "dependsOn": [],
                "name": "test-wharife-project-amazon_berkely_objects_aggregated-dependency-record-2",
                "properties": {
                  "data": {
                    "interval": 300,
                  },
                  "deployment": {
                    "accountId": "",
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
                  "keyName": "dependency",
                  "keyValue": "project_fixture.amazon_berkely_objects",
                  "sortKeyName": "resource_id",
                  "sortKeyValue": "test-wharife-project.amazon_berkely_objects_aggregated",
                  "tableName": "test-deployment-dependencies",
                },
                "resourceType": "TableRecord",
                "status": "STABLE",
              },
              "test-wharife-project-amazon_berkely_objects_aggregated-resource-record": {
                "dependsOn": [],
                "name": "test-wharife-project-amazon_berkely_objects_aggregated-resource-record",
                "properties": {
                  "data": {
                    "data": {
                      "athena_workgroup": "test-deployment-amazon_berkely_objects_aggregated-workgroup",
                      "daemon_config": {
                        "Role": "arn:aws:iam::123456789012:role/test-wharife-project-project-role",
                      },
                      "destination_properties": {
                        "arn": "arn:aws:glue:us-west-2::table/test-wharife-project/amazon_berkely_objects_aggregated",
                        "catalogId": "",
                        "columns": [
                          {
                            "name": "country",
                            "type": "string",
                          },
                          {
                            "name": "brands",
                            "type": "string",
                          },
                          {
                            "name": "count",
                            "type": "bigint",
                          },
                        ],
                        "compressed": true,
                        "databaseName": "test-wharife-project",
                        "deployment": {
                          "accountId": "",
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
                        "description": "Materialized Table",
                        "inputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
                        "location": "s3://test-wharife-project-bucket-lz-fc6bi/amazon_berkely_objects_aggregated/references/",
                        "name": "amazon_berkely_objects_aggregated",
                        "numberOfBuckets": 0,
                        "outputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
                        "parameters": {
                          "EXTERNAL": "TRUE",
                          "parquet.compress": "GZIP",
                        },
                        "partitionKeys": undefined,
                        "region": "us-west-2",
                        "serdeInfo": {
                          "Parameters": {
                            "parquet.compress": "GZIP",
                          },
                          "SerializationLibrary": "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
                        },
                        "storedAsSubDirectories": false,
                        "tableType": "EXTERNAL_TABLE",
                        "tags": [],
                      },
                      "region": "us-west-2",
                      "resource_status": "CREATING",
                      "source_properties": {
                        "arn": "arn:aws:glue:us-west-2::table/test-wharife-project/amazon_berkely_objects_aggregated_raw",
                        "catalogId": "",
                        "columns": [
                          {
                            "name": "country",
                            "type": "string",
                          },
                          {
                            "name": "brands",
                            "type": "string",
                          },
                          {
                            "name": "count",
                            "type": "bigint",
                          },
                        ],
                        "compressed": false,
                        "databaseName": "test-wharife-project",
                        "deployment": {
                          "accountId": "",
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
                        "description": "Materialized Table",
                        "inputFormat": undefined,
                        "location": undefined,
                        "name": "amazon_berkely_objects_aggregated_raw",
                        "numberOfBuckets": 0,
                        "outputFormat": undefined,
                        "parameters": {
                          "comment": "Presto View",
                          "presto_view": "true",
                        },
                        "partitionKeys": undefined,
                        "region": "us-west-2",
                        "serdeInfo": undefined,
                        "storedAsSubDirectories": false,
                        "tableType": "VIRTUAL_VIEW",
                        "tags": [],
                        "viewExpandedText": "/* Presto View */",
                        "viewOriginalText": "/* Presto View: eyJvcmlnaW5hbFNxbCI6IldJVEggdW5uZXN0ZWRfdGFibGUgQVMgKFxuICBTRUxFQ1QgY291bnRyeSwgYnJhbmRfZWxlbWVudC52YWx1ZSBBUyBicmFuZHNcbiAgRlJPTSBwcm9qZWN0X2ZpeHR1cmUuYW1hem9uX2JlcmtlbHlfb2JqZWN0cyxcbiAgVU5ORVNUKGJyYW5kKSBBUyB0KGJyYW5kX2VsZW1lbnQpXG4pXG5TRUxFQ1QgY291bnRyeSwgYnJhbmRzLCBDT1VOVCgqKSBBUyBjb3VudFxuRlJPTSB1bm5lc3RlZF90YWJsZVxuR1JPVVAgQlkgY291bnRyeSwgYnJhbmRzXG5PUkRFUiBCWSBjb3VudCBERVNDXG4iLCJjYXRhbG9nIjoiYXdzZGF0YWNhdGFsb2ciLCJjb2x1bW5zIjpbeyJuYW1lIjoiY291bnRyeSIsInR5cGUiOiJ2YXJjaGFyIn0seyJuYW1lIjoiYnJhbmRzIiwidHlwZSI6InZhcmNoYXIifSx7Im5hbWUiOiJjb3VudCIsInR5cGUiOiJiaWdpbnQifV19 */",
                      },
                      "source_region": undefined,
                      "wharfie_version": "0.0.1",
                    },
                  },
                  "deployment": {
                    "accountId": "",
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
                  "keyName": "resource_id",
                  "keyValue": "test-wharife-project.amazon_berkely_objects_aggregated",
                  "sortKeyName": "sort_key",
                  "sortKeyValue": "test-wharife-project.amazon_berkely_objects_aggregated",
                  "tableName": "test-deployment-resource",
                },
                "resourceType": "TableRecord",
                "status": "STABLE",
              },
            },
            "status": "STABLE",
          },
          "amazon_berkely_objects_images-resource": {
            "dependsOn": [
              "test-wharife-project-project-role",
              "test-wharife-project-bucket-lz-fc6bi",
            ],
            "name": "amazon_berkely_objects_images-resource",
            "properties": {
              "catalogId": "",
              "columns": [
                {
                  "name": "image_id",
                  "type": "string",
                },
                {
                  "name": "height",
                  "type": "bigint",
                },
                {
                  "name": "width",
                  "type": "bigint",
                },
                {
                  "name": "path",
                  "type": "string",
                },
              ],
              "compressed": false,
              "databaseName": "test-wharife-project",
              "dependencyTable": "test-deployment-dependencies",
              "deployment": {
                "accountId": "",
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
              "description": "Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html",
              "inputFormat": "org.apache.hadoop.mapred.TextInputFormat",
              "inputLocation": "s3://amazon-berkeley-objects/images/metadata/",
              "interval": 300,
              "locationTable": "test-deployment-locations",
              "migrationResource": false,
              "numberOfBuckets": 0,
              "outputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
              "outputLocation": "s3://test-wharife-project-bucket-lz-fc6bi/amazon_berkely_objects_images/",
              "parameters": {
                "EXTERNAL": "TRUE",
              },
              "partitionKeys": undefined,
              "project": {
                "name": "test-wharife-project",
              },
              "projectBucket": "test-wharife-project-bucket-lz-fc6bi",
              "projectName": "test-wharife-project",
              "region": "us-west-2",
              "resourceId": "test-wharife-project.amazon_berkely_objects_images",
              "resourceName": "amazon_berkely_objects_images",
              "resourceTable": "test-deployment-resource",
              "roleArn": "arn:aws:iam::123456789012:role/test-wharife-project-project-role",
              "scheduleQueueArn": undefined,
              "scheduleRoleArn": "arn:aws:iam::123456789012:role/test-deployment-event-role",
              "serdeInfo": {
                "Parameters": {
                  "field.delim": ",",
                  "serialization.format": ",",
                  "skip.header.line.count": "1",
                },
                "SerializationLibrary": "org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe",
              },
              "storedAsSubDirectories": true,
              "tableType": "EXTERNAL_TABLE",
            },
            "resourceType": "WharfieResource",
            "resources": {
              "amazon_berkely_objects_images": {
                "dependsOn": [],
                "name": "amazon_berkely_objects_images",
                "properties": {
                  "arn": "arn:aws:glue:us-west-2::table/test-wharife-project/amazon_berkely_objects_images",
                  "catalogId": "",
                  "columns": [
                    {
                      "name": "image_id",
                      "type": "string",
                    },
                    {
                      "name": "height",
                      "type": "bigint",
                    },
                    {
                      "name": "width",
                      "type": "bigint",
                    },
                    {
                      "name": "path",
                      "type": "string",
                    },
                  ],
                  "compressed": true,
                  "databaseName": "test-wharife-project",
                  "deployment": {
                    "accountId": "",
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
                  "description": "Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html",
                  "inputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
                  "location": "s3://test-wharife-project-bucket-lz-fc6bi/amazon_berkely_objects_images/references/",
                  "numberOfBuckets": 0,
                  "outputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
                  "parameters": {
                    "EXTERNAL": "TRUE",
                    "parquet.compress": "GZIP",
                  },
                  "partitionKeys": undefined,
                  "region": "us-west-2",
                  "serdeInfo": {
                    "Parameters": {
                      "parquet.compress": "GZIP",
                    },
                    "SerializationLibrary": "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
                  },
                  "storedAsSubDirectories": false,
                  "tableType": "EXTERNAL_TABLE",
                  "tags": [],
                },
                "resourceType": "GlueTable",
                "status": "STABLE",
              },
              "amazon_berkely_objects_images_raw": {
                "dependsOn": [],
                "name": "amazon_berkely_objects_images_raw",
                "properties": {
                  "arn": "arn:aws:glue:us-west-2::table/test-wharife-project/amazon_berkely_objects_images_raw",
                  "catalogId": "",
                  "columns": [
                    {
                      "name": "image_id",
                      "type": "string",
                    },
                    {
                      "name": "height",
                      "type": "bigint",
                    },
                    {
                      "name": "width",
                      "type": "bigint",
                    },
                    {
                      "name": "path",
                      "type": "string",
                    },
                  ],
                  "compressed": false,
                  "databaseName": "test-wharife-project",
                  "deployment": {
                    "accountId": "",
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
                  "description": "Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html",
                  "inputFormat": "org.apache.hadoop.mapred.TextInputFormat",
                  "location": "s3://amazon-berkeley-objects/images/metadata/",
                  "numberOfBuckets": 0,
                  "outputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                  "parameters": {
                    "EXTERNAL": "TRUE",
                  },
                  "partitionKeys": undefined,
                  "region": "us-west-2",
                  "serdeInfo": {
                    "Parameters": {
                      "field.delim": ",",
                      "serialization.format": ",",
                      "skip.header.line.count": "1",
                    },
                    "SerializationLibrary": "org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe",
                  },
                  "storedAsSubDirectories": true,
                  "tableType": "EXTERNAL_TABLE",
                  "tags": [],
                },
                "resourceType": "GlueTable",
                "status": "STABLE",
              },
              "test-deployment-amazon_berkely_objects_images-workgroup": {
                "dependsOn": [],
                "name": "test-deployment-amazon_berkely_objects_images-workgroup",
                "properties": {
                  "deployment": {
                    "accountId": "",
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
                  "description": "test-deployment resource amazon_berkely_objects_images workgroup",
                  "outputLocation": "s3://test-wharife-project-bucket-lz-fc6bi/amazon_berkely_objects_images/query_metadata/",
                },
                "resourceType": "AthenaWorkGroup",
                "status": "STABLE",
              },
              "test-wharife-project-amazon_berkely_objects_images-location-record": {
                "dependsOn": [],
                "name": "test-wharife-project-amazon_berkely_objects_images-location-record",
                "properties": {
                  "data": {
                    "interval": 300,
                  },
                  "deployment": {
                    "accountId": "",
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
                  "keyName": "location",
                  "keyValue": "s3://amazon-berkeley-objects/images/metadata/",
                  "sortKeyName": "resource_id",
                  "sortKeyValue": "test-wharife-project.amazon_berkely_objects_images",
                  "tableName": "test-deployment-locations",
                },
                "resourceType": "TableRecord",
                "status": "STABLE",
              },
              "test-wharife-project-amazon_berkely_objects_images-resource-record": {
                "dependsOn": [],
                "name": "test-wharife-project-amazon_berkely_objects_images-resource-record",
                "properties": {
                  "data": {
                    "data": {
                      "athena_workgroup": "test-deployment-amazon_berkely_objects_images-workgroup",
                      "daemon_config": {
                        "Role": "arn:aws:iam::123456789012:role/test-wharife-project-project-role",
                      },
                      "destination_properties": {
                        "arn": "arn:aws:glue:us-west-2::table/test-wharife-project/amazon_berkely_objects_images",
                        "catalogId": "",
                        "columns": [
                          {
                            "name": "image_id",
                            "type": "string",
                          },
                          {
                            "name": "height",
                            "type": "bigint",
                          },
                          {
                            "name": "width",
                            "type": "bigint",
                          },
                          {
                            "name": "path",
                            "type": "string",
                          },
                        ],
                        "compressed": true,
                        "databaseName": "test-wharife-project",
                        "deployment": {
                          "accountId": "",
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
                        "description": "Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html",
                        "inputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
                        "location": "s3://test-wharife-project-bucket-lz-fc6bi/amazon_berkely_objects_images/references/",
                        "name": "amazon_berkely_objects_images",
                        "numberOfBuckets": 0,
                        "outputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
                        "parameters": {
                          "EXTERNAL": "TRUE",
                          "parquet.compress": "GZIP",
                        },
                        "partitionKeys": undefined,
                        "region": "us-west-2",
                        "serdeInfo": {
                          "Parameters": {
                            "parquet.compress": "GZIP",
                          },
                          "SerializationLibrary": "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
                        },
                        "storedAsSubDirectories": false,
                        "tableType": "EXTERNAL_TABLE",
                        "tags": [],
                      },
                      "region": "us-west-2",
                      "resource_status": "CREATING",
                      "source_properties": {
                        "arn": "arn:aws:glue:us-west-2::table/test-wharife-project/amazon_berkely_objects_images_raw",
                        "catalogId": "",
                        "columns": [
                          {
                            "name": "image_id",
                            "type": "string",
                          },
                          {
                            "name": "height",
                            "type": "bigint",
                          },
                          {
                            "name": "width",
                            "type": "bigint",
                          },
                          {
                            "name": "path",
                            "type": "string",
                          },
                        ],
                        "compressed": false,
                        "databaseName": "test-wharife-project",
                        "deployment": {
                          "accountId": "",
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
                        "description": "Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html",
                        "inputFormat": "org.apache.hadoop.mapred.TextInputFormat",
                        "location": "s3://amazon-berkeley-objects/images/metadata/",
                        "name": "amazon_berkely_objects_images_raw",
                        "numberOfBuckets": 0,
                        "outputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                        "parameters": {
                          "EXTERNAL": "TRUE",
                        },
                        "partitionKeys": undefined,
                        "region": "us-west-2",
                        "serdeInfo": {
                          "Parameters": {
                            "field.delim": ",",
                            "serialization.format": ",",
                            "skip.header.line.count": "1",
                          },
                          "SerializationLibrary": "org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe",
                        },
                        "storedAsSubDirectories": true,
                        "tableType": "EXTERNAL_TABLE",
                        "tags": [],
                      },
                      "source_region": "us-east-1",
                      "wharfie_version": "0.0.1",
                    },
                  },
                  "deployment": {
                    "accountId": "",
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
                  "keyName": "resource_id",
                  "keyValue": "test-wharife-project.amazon_berkely_objects_images",
                  "sortKeyName": "sort_key",
                  "sortKeyValue": "test-wharife-project.amazon_berkely_objects_images",
                  "tableName": "test-deployment-resource",
                },
                "resourceType": "TableRecord",
                "status": "STABLE",
              },
            },
            "status": "STABLE",
          },
          "amazon_berkely_objects_join-resource": {
            "dependsOn": [
              "test-wharife-project-project-role",
              "test-wharife-project-bucket-lz-fc6bi",
            ],
            "name": "amazon_berkely_objects_join-resource",
            "properties": {
              "catalogId": "",
              "columns": [
                {
                  "name": "item_id",
                  "type": "string",
                },
                {
                  "name": "marketplace",
                  "type": "string",
                },
                {
                  "name": "path",
                  "type": "string",
                },
              ],
              "compressed": false,
              "databaseName": "test-wharife-project",
              "dependencyTable": "test-deployment-dependencies",
              "deployment": {
                "accountId": "",
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
              "description": "Materialized Table",
              "interval": 300,
              "locationTable": "test-deployment-locations",
              "migrationResource": false,
              "numberOfBuckets": 0,
              "outputLocation": "s3://test-wharife-project-bucket-lz-fc6bi/amazon_berkely_objects_join/",
              "parameters": {
                "comment": "Presto View",
                "presto_view": "true",
              },
              "partitionKeys": undefined,
              "project": {
                "name": "test-wharife-project",
              },
              "projectBucket": "test-wharife-project-bucket-lz-fc6bi",
              "projectName": "test-wharife-project",
              "region": "us-west-2",
              "resourceId": "test-wharife-project.amazon_berkely_objects_join",
              "resourceName": "amazon_berkely_objects_join",
              "resourceTable": "test-deployment-resource",
              "roleArn": "arn:aws:iam::123456789012:role/test-wharife-project-project-role",
              "scheduleQueueArn": undefined,
              "scheduleRoleArn": "arn:aws:iam::123456789012:role/test-deployment-event-role",
              "storedAsSubDirectories": false,
              "tableType": "VIRTUAL_VIEW",
              "viewExpandedText": "/* Presto View */",
              "viewOriginalText": "/* Presto View: eyJvcmlnaW5hbFNxbCI6IlNFTEVDVCBvYmplY3RzLml0ZW1faWQsIG9iamVjdHMubWFya2V0cGxhY2UsIGltYWdlcy5wYXRoXG5GUk9NIHByb2plY3RfZml4dHVyZS5hbWF6b25fYmVya2VseV9vYmplY3RzIEFTIG9iamVjdHNcbkxFRlQgSk9JTiBwcm9qZWN0X2ZpeHR1cmUuYW1hem9uX2JlcmtlbHlfb2JqZWN0c19pbWFnZXMgQVMgaW1hZ2VzXG5PTiBvYmplY3RzLm1haW5faW1hZ2VfaWQgPSBpbWFnZXMuaW1hZ2VfaWRcbiIsImNhdGFsb2ciOiJhd3NkYXRhY2F0YWxvZyIsImNvbHVtbnMiOlt7Im5hbWUiOiJpdGVtX2lkIiwidHlwZSI6InZhcmNoYXIifSx7Im5hbWUiOiJtYXJrZXRwbGFjZSIsInR5cGUiOiJ2YXJjaGFyIn0seyJuYW1lIjoicGF0aCIsInR5cGUiOiJ2YXJjaGFyIn1dfQ== */",
            },
            "resourceType": "WharfieResource",
            "resources": {
              "amazon_berkely_objects_join": {
                "dependsOn": [],
                "name": "amazon_berkely_objects_join",
                "properties": {
                  "arn": "arn:aws:glue:us-west-2::table/test-wharife-project/amazon_berkely_objects_join",
                  "catalogId": "",
                  "columns": [
                    {
                      "name": "item_id",
                      "type": "string",
                    },
                    {
                      "name": "marketplace",
                      "type": "string",
                    },
                    {
                      "name": "path",
                      "type": "string",
                    },
                  ],
                  "compressed": true,
                  "databaseName": "test-wharife-project",
                  "deployment": {
                    "accountId": "",
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
                  "description": "Materialized Table",
                  "inputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
                  "location": "s3://test-wharife-project-bucket-lz-fc6bi/amazon_berkely_objects_join/references/",
                  "numberOfBuckets": 0,
                  "outputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
                  "parameters": {
                    "EXTERNAL": "TRUE",
                    "parquet.compress": "GZIP",
                  },
                  "partitionKeys": undefined,
                  "region": "us-west-2",
                  "serdeInfo": {
                    "Parameters": {
                      "parquet.compress": "GZIP",
                    },
                    "SerializationLibrary": "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
                  },
                  "storedAsSubDirectories": false,
                  "tableType": "EXTERNAL_TABLE",
                  "tags": [],
                },
                "resourceType": "GlueTable",
                "status": "STABLE",
              },
              "amazon_berkely_objects_join_raw": {
                "dependsOn": [],
                "name": "amazon_berkely_objects_join_raw",
                "properties": {
                  "arn": "arn:aws:glue:us-west-2::table/test-wharife-project/amazon_berkely_objects_join_raw",
                  "catalogId": "",
                  "columns": [
                    {
                      "name": "item_id",
                      "type": "string",
                    },
                    {
                      "name": "marketplace",
                      "type": "string",
                    },
                    {
                      "name": "path",
                      "type": "string",
                    },
                  ],
                  "compressed": false,
                  "databaseName": "test-wharife-project",
                  "deployment": {
                    "accountId": "",
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
                  "description": "Materialized Table",
                  "inputFormat": undefined,
                  "location": undefined,
                  "numberOfBuckets": 0,
                  "outputFormat": undefined,
                  "parameters": {
                    "comment": "Presto View",
                    "presto_view": "true",
                  },
                  "partitionKeys": undefined,
                  "region": "us-west-2",
                  "serdeInfo": undefined,
                  "storedAsSubDirectories": false,
                  "tableType": "VIRTUAL_VIEW",
                  "tags": [],
                  "viewExpandedText": "/* Presto View */",
                  "viewOriginalText": "/* Presto View: eyJvcmlnaW5hbFNxbCI6IlNFTEVDVCBvYmplY3RzLml0ZW1faWQsIG9iamVjdHMubWFya2V0cGxhY2UsIGltYWdlcy5wYXRoXG5GUk9NIHByb2plY3RfZml4dHVyZS5hbWF6b25fYmVya2VseV9vYmplY3RzIEFTIG9iamVjdHNcbkxFRlQgSk9JTiBwcm9qZWN0X2ZpeHR1cmUuYW1hem9uX2JlcmtlbHlfb2JqZWN0c19pbWFnZXMgQVMgaW1hZ2VzXG5PTiBvYmplY3RzLm1haW5faW1hZ2VfaWQgPSBpbWFnZXMuaW1hZ2VfaWRcbiIsImNhdGFsb2ciOiJhd3NkYXRhY2F0YWxvZyIsImNvbHVtbnMiOlt7Im5hbWUiOiJpdGVtX2lkIiwidHlwZSI6InZhcmNoYXIifSx7Im5hbWUiOiJtYXJrZXRwbGFjZSIsInR5cGUiOiJ2YXJjaGFyIn0seyJuYW1lIjoicGF0aCIsInR5cGUiOiJ2YXJjaGFyIn1dfQ== */",
                },
                "resourceType": "GlueTable",
                "status": "STABLE",
              },
              "test-deployment-amazon_berkely_objects_join-workgroup": {
                "dependsOn": [],
                "name": "test-deployment-amazon_berkely_objects_join-workgroup",
                "properties": {
                  "deployment": {
                    "accountId": "",
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
                  "description": "test-deployment resource amazon_berkely_objects_join workgroup",
                  "outputLocation": "s3://test-wharife-project-bucket-lz-fc6bi/amazon_berkely_objects_join/query_metadata/",
                },
                "resourceType": "AthenaWorkGroup",
                "status": "STABLE",
              },
              "test-wharife-project-amazon_berkely_objects_join-dependency-record-1": {
                "dependsOn": [],
                "name": "test-wharife-project-amazon_berkely_objects_join-dependency-record-1",
                "properties": {
                  "data": {
                    "interval": 300,
                  },
                  "deployment": {
                    "accountId": "",
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
                  "keyName": "dependency",
                  "keyValue": "project_fixture.amazon_berkely_objects_images",
                  "sortKeyName": "resource_id",
                  "sortKeyValue": "test-wharife-project.amazon_berkely_objects_join",
                  "tableName": "test-deployment-dependencies",
                },
                "resourceType": "TableRecord",
                "status": "STABLE",
              },
              "test-wharife-project-amazon_berkely_objects_join-dependency-record-2": {
                "dependsOn": [],
                "name": "test-wharife-project-amazon_berkely_objects_join-dependency-record-2",
                "properties": {
                  "data": {
                    "interval": 300,
                  },
                  "deployment": {
                    "accountId": "",
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
                  "keyName": "dependency",
                  "keyValue": "project_fixture.amazon_berkely_objects",
                  "sortKeyName": "resource_id",
                  "sortKeyValue": "test-wharife-project.amazon_berkely_objects_join",
                  "tableName": "test-deployment-dependencies",
                },
                "resourceType": "TableRecord",
                "status": "STABLE",
              },
              "test-wharife-project-amazon_berkely_objects_join-resource-record": {
                "dependsOn": [],
                "name": "test-wharife-project-amazon_berkely_objects_join-resource-record",
                "properties": {
                  "data": {
                    "data": {
                      "athena_workgroup": "test-deployment-amazon_berkely_objects_join-workgroup",
                      "daemon_config": {
                        "Role": "arn:aws:iam::123456789012:role/test-wharife-project-project-role",
                      },
                      "destination_properties": {
                        "arn": "arn:aws:glue:us-west-2::table/test-wharife-project/amazon_berkely_objects_join",
                        "catalogId": "",
                        "columns": [
                          {
                            "name": "item_id",
                            "type": "string",
                          },
                          {
                            "name": "marketplace",
                            "type": "string",
                          },
                          {
                            "name": "path",
                            "type": "string",
                          },
                        ],
                        "compressed": true,
                        "databaseName": "test-wharife-project",
                        "deployment": {
                          "accountId": "",
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
                        "description": "Materialized Table",
                        "inputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
                        "location": "s3://test-wharife-project-bucket-lz-fc6bi/amazon_berkely_objects_join/references/",
                        "name": "amazon_berkely_objects_join",
                        "numberOfBuckets": 0,
                        "outputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
                        "parameters": {
                          "EXTERNAL": "TRUE",
                          "parquet.compress": "GZIP",
                        },
                        "partitionKeys": undefined,
                        "region": "us-west-2",
                        "serdeInfo": {
                          "Parameters": {
                            "parquet.compress": "GZIP",
                          },
                          "SerializationLibrary": "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
                        },
                        "storedAsSubDirectories": false,
                        "tableType": "EXTERNAL_TABLE",
                        "tags": [],
                      },
                      "region": "us-west-2",
                      "resource_status": "CREATING",
                      "source_properties": {
                        "arn": "arn:aws:glue:us-west-2::table/test-wharife-project/amazon_berkely_objects_join_raw",
                        "catalogId": "",
                        "columns": [
                          {
                            "name": "item_id",
                            "type": "string",
                          },
                          {
                            "name": "marketplace",
                            "type": "string",
                          },
                          {
                            "name": "path",
                            "type": "string",
                          },
                        ],
                        "compressed": false,
                        "databaseName": "test-wharife-project",
                        "deployment": {
                          "accountId": "",
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
                        "description": "Materialized Table",
                        "inputFormat": undefined,
                        "location": undefined,
                        "name": "amazon_berkely_objects_join_raw",
                        "numberOfBuckets": 0,
                        "outputFormat": undefined,
                        "parameters": {
                          "comment": "Presto View",
                          "presto_view": "true",
                        },
                        "partitionKeys": undefined,
                        "region": "us-west-2",
                        "serdeInfo": undefined,
                        "storedAsSubDirectories": false,
                        "tableType": "VIRTUAL_VIEW",
                        "tags": [],
                        "viewExpandedText": "/* Presto View */",
                        "viewOriginalText": "/* Presto View: eyJvcmlnaW5hbFNxbCI6IlNFTEVDVCBvYmplY3RzLml0ZW1faWQsIG9iamVjdHMubWFya2V0cGxhY2UsIGltYWdlcy5wYXRoXG5GUk9NIHByb2plY3RfZml4dHVyZS5hbWF6b25fYmVya2VseV9vYmplY3RzIEFTIG9iamVjdHNcbkxFRlQgSk9JTiBwcm9qZWN0X2ZpeHR1cmUuYW1hem9uX2JlcmtlbHlfb2JqZWN0c19pbWFnZXMgQVMgaW1hZ2VzXG5PTiBvYmplY3RzLm1haW5faW1hZ2VfaWQgPSBpbWFnZXMuaW1hZ2VfaWRcbiIsImNhdGFsb2ciOiJhd3NkYXRhY2F0YWxvZyIsImNvbHVtbnMiOlt7Im5hbWUiOiJpdGVtX2lkIiwidHlwZSI6InZhcmNoYXIifSx7Im5hbWUiOiJtYXJrZXRwbGFjZSIsInR5cGUiOiJ2YXJjaGFyIn0seyJuYW1lIjoicGF0aCIsInR5cGUiOiJ2YXJjaGFyIn1dfQ== */",
                      },
                      "source_region": undefined,
                      "wharfie_version": "0.0.1",
                    },
                  },
                  "deployment": {
                    "accountId": "",
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
                  "keyName": "resource_id",
                  "keyValue": "test-wharife-project.amazon_berkely_objects_join",
                  "sortKeyName": "sort_key",
                  "sortKeyValue": "test-wharife-project.amazon_berkely_objects_join",
                  "tableName": "test-deployment-resource",
                },
                "resourceType": "TableRecord",
                "status": "STABLE",
              },
            },
            "status": "STABLE",
          },
          "inline-resource": {
            "dependsOn": [
              "test-wharife-project-project-role",
              "test-wharife-project-bucket-lz-fc6bi",
            ],
            "name": "inline-resource",
            "properties": {
              "catalogId": "",
              "columns": [
                {
                  "name": "item_id",
                  "type": "string",
                },
                {
                  "name": "marketplace",
                  "type": "string",
                },
                {
                  "name": "path",
                  "type": "string",
                },
              ],
              "compressed": false,
              "databaseName": "test-wharife-project",
              "dependencyTable": "test-deployment-dependencies",
              "deployment": {
                "accountId": "",
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
              "description": "Materialized Table",
              "interval": 300,
              "locationTable": "test-deployment-locations",
              "migrationResource": false,
              "numberOfBuckets": 0,
              "outputLocation": "s3://test-wharife-project-bucket-lz-fc6bi/inline/",
              "parameters": {
                "comment": "Presto View",
                "presto_view": "true",
              },
              "partitionKeys": undefined,
              "project": {
                "name": "test-wharife-project",
              },
              "projectBucket": "test-wharife-project-bucket-lz-fc6bi",
              "projectName": "test-wharife-project",
              "region": "us-west-2",
              "resourceId": "test-wharife-project.inline",
              "resourceName": "inline",
              "resourceTable": "test-deployment-resource",
              "roleArn": "arn:aws:iam::123456789012:role/test-wharife-project-project-role",
              "scheduleQueueArn": undefined,
              "scheduleRoleArn": "arn:aws:iam::123456789012:role/test-deployment-event-role",
              "storedAsSubDirectories": false,
              "tableType": "VIRTUAL_VIEW",
              "viewExpandedText": "/* Presto View */",
              "viewOriginalText": "/* Presto View: eyJvcmlnaW5hbFNxbCI6IlNFTEVDVCBvYmplY3RzLml0ZW1faWQsIG9iamVjdHMubWFya2V0cGxhY2UsIGltYWdlcy5wYXRoIEZST00gcHJvamVjdF9maXh0dXJlLmFtYXpvbl9iZXJrZWx5X29iamVjdHMgQVMgb2JqZWN0cyBMRUZUIEpPSU4gcHJvamVjdF9maXh0dXJlLmFtYXpvbl9iZXJrZWx5X29iamVjdHNfaW1hZ2VzIEFTIGltYWdlcyBPTiBvYmplY3RzLm1haW5faW1hZ2VfaWQgPSBpbWFnZXMuaW1hZ2VfaWQiLCJjYXRhbG9nIjoiYXdzZGF0YWNhdGFsb2ciLCJjb2x1bW5zIjpbeyJuYW1lIjoiaXRlbV9pZCIsInR5cGUiOiJ2YXJjaGFyIn0seyJuYW1lIjoibWFya2V0cGxhY2UiLCJ0eXBlIjoidmFyY2hhciJ9LHsibmFtZSI6InBhdGgiLCJ0eXBlIjoidmFyY2hhciJ9XX0= */",
            },
            "resourceType": "WharfieResource",
            "resources": {
              "inline": {
                "dependsOn": [],
                "name": "inline",
                "properties": {
                  "arn": "arn:aws:glue:us-west-2::table/test-wharife-project/inline",
                  "catalogId": "",
                  "columns": [
                    {
                      "name": "item_id",
                      "type": "string",
                    },
                    {
                      "name": "marketplace",
                      "type": "string",
                    },
                    {
                      "name": "path",
                      "type": "string",
                    },
                  ],
                  "compressed": true,
                  "databaseName": "test-wharife-project",
                  "deployment": {
                    "accountId": "",
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
                  "description": "Materialized Table",
                  "inputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
                  "location": "s3://test-wharife-project-bucket-lz-fc6bi/inline/references/",
                  "numberOfBuckets": 0,
                  "outputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
                  "parameters": {
                    "EXTERNAL": "TRUE",
                    "parquet.compress": "GZIP",
                  },
                  "partitionKeys": undefined,
                  "region": "us-west-2",
                  "serdeInfo": {
                    "Parameters": {
                      "parquet.compress": "GZIP",
                    },
                    "SerializationLibrary": "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
                  },
                  "storedAsSubDirectories": false,
                  "tableType": "EXTERNAL_TABLE",
                  "tags": [],
                },
                "resourceType": "GlueTable",
                "status": "STABLE",
              },
              "inline_raw": {
                "dependsOn": [],
                "name": "inline_raw",
                "properties": {
                  "arn": "arn:aws:glue:us-west-2::table/test-wharife-project/inline_raw",
                  "catalogId": "",
                  "columns": [
                    {
                      "name": "item_id",
                      "type": "string",
                    },
                    {
                      "name": "marketplace",
                      "type": "string",
                    },
                    {
                      "name": "path",
                      "type": "string",
                    },
                  ],
                  "compressed": false,
                  "databaseName": "test-wharife-project",
                  "deployment": {
                    "accountId": "",
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
                  "description": "Materialized Table",
                  "inputFormat": undefined,
                  "location": undefined,
                  "numberOfBuckets": 0,
                  "outputFormat": undefined,
                  "parameters": {
                    "comment": "Presto View",
                    "presto_view": "true",
                  },
                  "partitionKeys": undefined,
                  "region": "us-west-2",
                  "serdeInfo": undefined,
                  "storedAsSubDirectories": false,
                  "tableType": "VIRTUAL_VIEW",
                  "tags": [],
                  "viewExpandedText": "/* Presto View */",
                  "viewOriginalText": "/* Presto View: eyJvcmlnaW5hbFNxbCI6IlNFTEVDVCBvYmplY3RzLml0ZW1faWQsIG9iamVjdHMubWFya2V0cGxhY2UsIGltYWdlcy5wYXRoIEZST00gcHJvamVjdF9maXh0dXJlLmFtYXpvbl9iZXJrZWx5X29iamVjdHMgQVMgb2JqZWN0cyBMRUZUIEpPSU4gcHJvamVjdF9maXh0dXJlLmFtYXpvbl9iZXJrZWx5X29iamVjdHNfaW1hZ2VzIEFTIGltYWdlcyBPTiBvYmplY3RzLm1haW5faW1hZ2VfaWQgPSBpbWFnZXMuaW1hZ2VfaWQiLCJjYXRhbG9nIjoiYXdzZGF0YWNhdGFsb2ciLCJjb2x1bW5zIjpbeyJuYW1lIjoiaXRlbV9pZCIsInR5cGUiOiJ2YXJjaGFyIn0seyJuYW1lIjoibWFya2V0cGxhY2UiLCJ0eXBlIjoidmFyY2hhciJ9LHsibmFtZSI6InBhdGgiLCJ0eXBlIjoidmFyY2hhciJ9XX0= */",
                },
                "resourceType": "GlueTable",
                "status": "STABLE",
              },
              "test-deployment-inline-workgroup": {
                "dependsOn": [],
                "name": "test-deployment-inline-workgroup",
                "properties": {
                  "deployment": {
                    "accountId": "",
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
                  "description": "test-deployment resource inline workgroup",
                  "outputLocation": "s3://test-wharife-project-bucket-lz-fc6bi/inline/query_metadata/",
                },
                "resourceType": "AthenaWorkGroup",
                "status": "STABLE",
              },
              "test-wharife-project-inline-dependency-record-1": {
                "dependsOn": [],
                "name": "test-wharife-project-inline-dependency-record-1",
                "properties": {
                  "data": {
                    "interval": 300,
                  },
                  "deployment": {
                    "accountId": "",
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
                  "keyName": "dependency",
                  "keyValue": "project_fixture.amazon_berkely_objects_images",
                  "sortKeyName": "resource_id",
                  "sortKeyValue": "test-wharife-project.inline",
                  "tableName": "test-deployment-dependencies",
                },
                "resourceType": "TableRecord",
                "status": "STABLE",
              },
              "test-wharife-project-inline-dependency-record-2": {
                "dependsOn": [],
                "name": "test-wharife-project-inline-dependency-record-2",
                "properties": {
                  "data": {
                    "interval": 300,
                  },
                  "deployment": {
                    "accountId": "",
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
                  "keyName": "dependency",
                  "keyValue": "project_fixture.amazon_berkely_objects",
                  "sortKeyName": "resource_id",
                  "sortKeyValue": "test-wharife-project.inline",
                  "tableName": "test-deployment-dependencies",
                },
                "resourceType": "TableRecord",
                "status": "STABLE",
              },
              "test-wharife-project-inline-resource-record": {
                "dependsOn": [],
                "name": "test-wharife-project-inline-resource-record",
                "properties": {
                  "data": {
                    "data": {
                      "athena_workgroup": "test-deployment-inline-workgroup",
                      "daemon_config": {
                        "Role": "arn:aws:iam::123456789012:role/test-wharife-project-project-role",
                      },
                      "destination_properties": {
                        "arn": "arn:aws:glue:us-west-2::table/test-wharife-project/inline",
                        "catalogId": "",
                        "columns": [
                          {
                            "name": "item_id",
                            "type": "string",
                          },
                          {
                            "name": "marketplace",
                            "type": "string",
                          },
                          {
                            "name": "path",
                            "type": "string",
                          },
                        ],
                        "compressed": true,
                        "databaseName": "test-wharife-project",
                        "deployment": {
                          "accountId": "",
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
                        "description": "Materialized Table",
                        "inputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
                        "location": "s3://test-wharife-project-bucket-lz-fc6bi/inline/references/",
                        "name": "inline",
                        "numberOfBuckets": 0,
                        "outputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
                        "parameters": {
                          "EXTERNAL": "TRUE",
                          "parquet.compress": "GZIP",
                        },
                        "partitionKeys": undefined,
                        "region": "us-west-2",
                        "serdeInfo": {
                          "Parameters": {
                            "parquet.compress": "GZIP",
                          },
                          "SerializationLibrary": "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
                        },
                        "storedAsSubDirectories": false,
                        "tableType": "EXTERNAL_TABLE",
                        "tags": [],
                      },
                      "region": "us-west-2",
                      "resource_status": "CREATING",
                      "source_properties": {
                        "arn": "arn:aws:glue:us-west-2::table/test-wharife-project/inline_raw",
                        "catalogId": "",
                        "columns": [
                          {
                            "name": "item_id",
                            "type": "string",
                          },
                          {
                            "name": "marketplace",
                            "type": "string",
                          },
                          {
                            "name": "path",
                            "type": "string",
                          },
                        ],
                        "compressed": false,
                        "databaseName": "test-wharife-project",
                        "deployment": {
                          "accountId": "",
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
                        "description": "Materialized Table",
                        "inputFormat": undefined,
                        "location": undefined,
                        "name": "inline_raw",
                        "numberOfBuckets": 0,
                        "outputFormat": undefined,
                        "parameters": {
                          "comment": "Presto View",
                          "presto_view": "true",
                        },
                        "partitionKeys": undefined,
                        "region": "us-west-2",
                        "serdeInfo": undefined,
                        "storedAsSubDirectories": false,
                        "tableType": "VIRTUAL_VIEW",
                        "tags": [],
                        "viewExpandedText": "/* Presto View */",
                        "viewOriginalText": "/* Presto View: eyJvcmlnaW5hbFNxbCI6IlNFTEVDVCBvYmplY3RzLml0ZW1faWQsIG9iamVjdHMubWFya2V0cGxhY2UsIGltYWdlcy5wYXRoIEZST00gcHJvamVjdF9maXh0dXJlLmFtYXpvbl9iZXJrZWx5X29iamVjdHMgQVMgb2JqZWN0cyBMRUZUIEpPSU4gcHJvamVjdF9maXh0dXJlLmFtYXpvbl9iZXJrZWx5X29iamVjdHNfaW1hZ2VzIEFTIGltYWdlcyBPTiBvYmplY3RzLm1haW5faW1hZ2VfaWQgPSBpbWFnZXMuaW1hZ2VfaWQiLCJjYXRhbG9nIjoiYXdzZGF0YWNhdGFsb2ciLCJjb2x1bW5zIjpbeyJuYW1lIjoiaXRlbV9pZCIsInR5cGUiOiJ2YXJjaGFyIn0seyJuYW1lIjoibWFya2V0cGxhY2UiLCJ0eXBlIjoidmFyY2hhciJ9LHsibmFtZSI6InBhdGgiLCJ0eXBlIjoidmFyY2hhciJ9XX0= */",
                      },
                      "source_region": undefined,
                      "wharfie_version": "0.0.1",
                    },
                  },
                  "deployment": {
                    "accountId": "",
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
                  "keyName": "resource_id",
                  "keyValue": "test-wharife-project.inline",
                  "sortKeyName": "sort_key",
                  "sortKeyValue": "test-wharife-project.inline",
                  "tableName": "test-deployment-resource",
                },
                "resourceType": "TableRecord",
                "status": "STABLE",
              },
            },
            "status": "STABLE",
          },
          "test-resource": {
            "dependsOn": [
              "test-wharife-project-project-role",
              "test-wharife-project-bucket-lz-fc6bi",
            ],
            "name": "test-resource",
            "properties": {
              "catalogId": "",
              "columns": [
                {
                  "name": "name",
                  "type": "string",
                },
                {
                  "name": "count",
                  "type": "bigint",
                },
              ],
              "compressed": undefined,
              "databaseName": "test-wharife-project",
              "dependencyTable": "test-deployment-dependencies",
              "deployment": {
                "accountId": "",
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
              "description": "nice",
              "inputFormat": "org.apache.hadoop.mapred.TextInputFormat",
              "inputLocation": "s3://utility-079185815456-us-west-2/test/",
              "interval": 300,
              "locationTable": "test-deployment-locations",
              "migrationResource": false,
              "numberOfBuckets": 0,
              "outputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
              "outputLocation": "s3://test-wharife-project-bucket-lz-fc6bi/test/",
              "parameters": {
                "EXTERNAL": "true",
              },
              "partitionKeys": undefined,
              "project": {
                "name": "test-wharife-project",
              },
              "projectBucket": "test-wharife-project-bucket-lz-fc6bi",
              "projectName": "test-wharife-project",
              "region": "us-west-2",
              "resourceId": "test-wharife-project.test",
              "resourceName": "test",
              "resourceTable": "test-deployment-resource",
              "roleArn": "arn:aws:iam::123456789012:role/test-wharife-project-project-role",
              "scheduleQueueArn": undefined,
              "scheduleRoleArn": "arn:aws:iam::123456789012:role/test-deployment-event-role",
              "serdeInfo": {
                "Parameters": {
                  "ignore.malformed.json": "true",
                },
                "SerializationLibrary": "org.openx.data.jsonserde.JsonSerDe",
              },
              "storedAsSubDirectories": true,
              "tableType": "EXTERNAL_TABLE",
            },
            "resourceType": "WharfieResource",
            "resources": {
              "test": {
                "dependsOn": [],
                "name": "test",
                "properties": {
                  "arn": "arn:aws:glue:us-west-2::table/test-wharife-project/test",
                  "catalogId": "",
                  "columns": [
                    {
                      "name": "name",
                      "type": "string",
                    },
                    {
                      "name": "count",
                      "type": "bigint",
                    },
                  ],
                  "compressed": true,
                  "databaseName": "test-wharife-project",
                  "deployment": {
                    "accountId": "",
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
                  "description": "nice",
                  "inputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
                  "location": "s3://test-wharife-project-bucket-lz-fc6bi/test/references/",
                  "numberOfBuckets": 0,
                  "outputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
                  "parameters": {
                    "EXTERNAL": "TRUE",
                    "parquet.compress": "GZIP",
                  },
                  "partitionKeys": undefined,
                  "region": "us-west-2",
                  "serdeInfo": {
                    "Parameters": {
                      "parquet.compress": "GZIP",
                    },
                    "SerializationLibrary": "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
                  },
                  "storedAsSubDirectories": false,
                  "tableType": "EXTERNAL_TABLE",
                  "tags": [],
                },
                "resourceType": "GlueTable",
                "status": "STABLE",
              },
              "test-deployment-test-workgroup": {
                "dependsOn": [],
                "name": "test-deployment-test-workgroup",
                "properties": {
                  "deployment": {
                    "accountId": "",
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
                  "description": "test-deployment resource test workgroup",
                  "outputLocation": "s3://test-wharife-project-bucket-lz-fc6bi/test/query_metadata/",
                },
                "resourceType": "AthenaWorkGroup",
                "status": "STABLE",
              },
              "test-wharife-project-test-location-record": {
                "dependsOn": [],
                "name": "test-wharife-project-test-location-record",
                "properties": {
                  "data": {
                    "interval": 300,
                  },
                  "deployment": {
                    "accountId": "",
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
                  "keyName": "location",
                  "keyValue": "s3://utility-079185815456-us-west-2/test/",
                  "sortKeyName": "resource_id",
                  "sortKeyValue": "test-wharife-project.test",
                  "tableName": "test-deployment-locations",
                },
                "resourceType": "TableRecord",
                "status": "STABLE",
              },
              "test-wharife-project-test-resource-record": {
                "dependsOn": [],
                "name": "test-wharife-project-test-resource-record",
                "properties": {
                  "data": {
                    "data": {
                      "athena_workgroup": "test-deployment-test-workgroup",
                      "daemon_config": {
                        "Role": "arn:aws:iam::123456789012:role/test-wharife-project-project-role",
                      },
                      "destination_properties": {
                        "arn": "arn:aws:glue:us-west-2::table/test-wharife-project/test",
                        "catalogId": "",
                        "columns": [
                          {
                            "name": "name",
                            "type": "string",
                          },
                          {
                            "name": "count",
                            "type": "bigint",
                          },
                        ],
                        "compressed": true,
                        "databaseName": "test-wharife-project",
                        "deployment": {
                          "accountId": "",
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
                        "description": "nice",
                        "inputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
                        "location": "s3://test-wharife-project-bucket-lz-fc6bi/test/references/",
                        "name": "test",
                        "numberOfBuckets": 0,
                        "outputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
                        "parameters": {
                          "EXTERNAL": "TRUE",
                          "parquet.compress": "GZIP",
                        },
                        "partitionKeys": undefined,
                        "region": "us-west-2",
                        "serdeInfo": {
                          "Parameters": {
                            "parquet.compress": "GZIP",
                          },
                          "SerializationLibrary": "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
                        },
                        "storedAsSubDirectories": false,
                        "tableType": "EXTERNAL_TABLE",
                        "tags": [],
                      },
                      "region": "us-west-2",
                      "resource_status": "CREATING",
                      "source_properties": {
                        "arn": "arn:aws:glue:us-west-2::table/test-wharife-project/test_raw",
                        "catalogId": "",
                        "columns": [
                          {
                            "name": "name",
                            "type": "string",
                          },
                          {
                            "name": "count",
                            "type": "bigint",
                          },
                        ],
                        "compressed": undefined,
                        "databaseName": "test-wharife-project",
                        "deployment": {
                          "accountId": "",
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
                        "description": "nice",
                        "inputFormat": "org.apache.hadoop.mapred.TextInputFormat",
                        "location": "s3://utility-079185815456-us-west-2/test/",
                        "name": "test_raw",
                        "numberOfBuckets": 0,
                        "outputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                        "parameters": {
                          "EXTERNAL": "true",
                        },
                        "partitionKeys": undefined,
                        "region": "us-west-2",
                        "serdeInfo": {
                          "Parameters": {
                            "ignore.malformed.json": "true",
                          },
                          "SerializationLibrary": "org.openx.data.jsonserde.JsonSerDe",
                        },
                        "storedAsSubDirectories": true,
                        "tableType": "EXTERNAL_TABLE",
                        "tags": [],
                      },
                      "source_region": "us-east-1",
                      "wharfie_version": "0.0.1",
                    },
                  },
                  "deployment": {
                    "accountId": "",
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
                  "keyName": "resource_id",
                  "keyValue": "test-wharife-project.test",
                  "sortKeyName": "sort_key",
                  "sortKeyValue": "test-wharife-project.test",
                  "tableName": "test-deployment-resource",
                },
                "resourceType": "TableRecord",
                "status": "STABLE",
              },
              "test_raw": {
                "dependsOn": [],
                "name": "test_raw",
                "properties": {
                  "arn": "arn:aws:glue:us-west-2::table/test-wharife-project/test_raw",
                  "catalogId": "",
                  "columns": [
                    {
                      "name": "name",
                      "type": "string",
                    },
                    {
                      "name": "count",
                      "type": "bigint",
                    },
                  ],
                  "compressed": undefined,
                  "databaseName": "test-wharife-project",
                  "deployment": {
                    "accountId": "",
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
                  "description": "nice",
                  "inputFormat": "org.apache.hadoop.mapred.TextInputFormat",
                  "location": "s3://utility-079185815456-us-west-2/test/",
                  "numberOfBuckets": 0,
                  "outputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                  "parameters": {
                    "EXTERNAL": "true",
                  },
                  "partitionKeys": undefined,
                  "region": "us-west-2",
                  "serdeInfo": {
                    "Parameters": {
                      "ignore.malformed.json": "true",
                    },
                    "SerializationLibrary": "org.openx.data.jsonserde.JsonSerDe",
                  },
                  "storedAsSubDirectories": true,
                  "tableType": "EXTERNAL_TABLE",
                  "tags": [],
                },
                "resourceType": "GlueTable",
                "status": "STABLE",
              },
            },
            "status": "STABLE",
          },
          "test-wharife-project": {
            "dependsOn": [],
            "name": "test-wharife-project",
            "properties": {
              "deployment": {
                "accountId": "",
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
              "project": {
                "name": "test-wharife-project",
              },
            },
            "resourceType": "GlueDatabase",
            "status": "STABLE",
          },
          "test-wharife-project-bucket-lz-fc6bi": {
            "dependsOn": [],
            "name": "test-wharife-project-bucket-lz-fc6bi",
            "properties": {
              "arn": "arn:aws:s3:::test-wharife-project-bucket-lz-fc6bi",
              "deployment": {
                "accountId": "",
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
              "lifecycleConfiguration": {
                "Rules": [
                  {
                    "AbortIncompleteMultipartUpload": {
                      "DaysAfterInitiation": 1,
                    },
                    "ID": "abort_incomplete_multipart_uploads",
                    "Prefix": "",
                    "Status": "Enabled",
                  },
                ],
              },
              "notificationConfiguration": {
                "QueueConfigurations": [
                  {
                    "Events": [
                      "s3:ObjectCreated:*",
                    ],
                    "QueueArn": undefined,
                  },
                  {
                    "Events": [
                      "s3:ObjectRemoved:*",
                    ],
                    "QueueArn": undefined,
                  },
                ],
              },
              "project": {
                "name": "test-wharife-project",
              },
            },
            "resourceType": "Bucket",
            "status": "STABLE",
          },
          "test-wharife-project-project-role": {
            "dependsOn": [],
            "name": "test-wharife-project-project-role",
            "properties": {
              "arn": "arn:aws:iam::123456789012:role/test-wharife-project-project-role",
              "assumeRolePolicyDocument": {
                "Statement": [
                  {
                    "Action": "sts:AssumeRole",
                    "Effect": "Allow",
                    "Principal": {
                      "AWS": [
                        "arn:aws:iam::123456789012:role/test-deployment-daemon-role",
                        "arn:aws:iam::123456789012:role/test-deployment-cleanup-role",
                        "arn:aws:iam::123456789012:role/test-deployment-events-role",
                        "arn:aws:iam::123456789012:role/test-deployment-monitor-role",
                      ],
                    },
                  },
                ],
                "Version": "2012-10-17",
              },
              "deployment": {
                "accountId": "",
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
              "description": "test-wharife-project project role",
              "managedPolicyArns": [
                "arn:aws:iam:::policy/test-deployment-shared-policy",
              ],
              "project": {
                "name": "test-wharife-project",
              },
              "rolePolicyDocument": {
                "Statement": [
                  {
                    "Action": [
                      "s3:GetBucketLocation",
                      "s3:GetBucketAcl",
                      "s3:ListBucket",
                      "s3:ListBucketMultipartUploads",
                      "s3:AbortMultipartUpload",
                    ],
                    "Effect": "Allow",
                    "Resource": [
                      "arn:aws:s3:::amazon-berkeley-objects",
                      "arn:aws:s3:::amazon-berkeley-objects",
                      "arn:aws:s3:::utility-079185815456-us-west-2",
                      "arn:aws:s3:::test-wharife-project-bucket-lz-fc6bi",
                      "arn:aws:s3:::test-wharife-project-bucket-lz-fc6bi",
                      "arn:aws:s3:::test-wharife-project-bucket-lz-fc6bi",
                      "arn:aws:s3:::test-wharife-project-bucket-lz-fc6bi",
                      "arn:aws:s3:::test-wharife-project-bucket-lz-fc6bi",
                      "arn:aws:s3:::test-wharife-project-bucket-lz-fc6bi",
                    ],
                    "Sid": "Bucket",
                  },
                  {
                    "Action": [
                      "s3:*",
                    ],
                    "Effect": "Allow",
                    "Resource": [
                      "arn:aws:s3:::test-wharife-project-bucket-lz-fc6bi/amazon_berkely_objects_aggregated/*",
                      "arn:aws:s3:::test-wharife-project-bucket-lz-fc6bi/amazon_berkely_objects_join/*",
                      "arn:aws:s3:::test-wharife-project-bucket-lz-fc6bi/inline/*",
                      "arn:aws:s3:::test-wharife-project-bucket-lz-fc6bi/amazon_berkely_objects_images/*",
                      "arn:aws:s3:::test-wharife-project-bucket-lz-fc6bi/amazon_berkely_objects/*",
                      "arn:aws:s3:::test-wharife-project-bucket-lz-fc6bi/test/*",
                    ],
                    "Sid": "OutputWrite",
                  },
                  {
                    "Action": [
                      "s3:GetObject",
                    ],
                    "Effect": "Allow",
                    "Resource": [
                      "arn:aws:s3:::amazon-berkeley-objects/images/metadata/*",
                      "arn:aws:s3:::amazon-berkeley-objects/listings/metadata/*",
                      "arn:aws:s3:::utility-079185815456-us-west-2/test/*",
                    ],
                    "Sid": "InputRead",
                  },
                ],
                "Version": "2012-10-17",
              },
            },
            "resourceType": "Role",
            "status": "STABLE",
          },
        },
        "status": "STABLE",
      }
    `);

    const deserialized = deserialize(serialized);
    await deserialized.reconcile();
    expect(deserialized.properties).toMatchInlineSnapshot(`
      {
        "actorRoleArns": [
          "arn:aws:iam::123456789012:role/test-deployment-daemon-role",
          "arn:aws:iam::123456789012:role/test-deployment-cleanup-role",
          "arn:aws:iam::123456789012:role/test-deployment-events-role",
          "arn:aws:iam::123456789012:role/test-deployment-monitor-role",
        ],
        "dependencyTable": "test-deployment-dependencies",
        "deployment": {
          "accountId": "",
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
        "deploymentSharedPolicyArn": "arn:aws:iam:::policy/test-deployment-shared-policy",
        "eventsQueueArn": undefined,
        "locationTable": "test-deployment-locations",
        "project": {
          "name": "test-wharife-project",
        },
        "resourceTable": "test-deployment-resource",
        "scheduleQueueArn": undefined,
        "scheduleRoleArn": "arn:aws:iam::123456789012:role/test-deployment-event-role",
      }
    `);
    expect(deserialized.status).toBe('STABLE');
    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');
  }, 10000);
});
