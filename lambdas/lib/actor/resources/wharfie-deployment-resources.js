import BaseResourceGroup from './base-resource-group.js';
import WharfieResource from './wharfie-resource.js';

import Table from './aws/table.js';
import GlueDatabase from './aws/glue-database.js';
import Bucket from './aws/bucket.js';
import Firehose from './aws/firehose.js';
import Role from './aws/role.js';
import Policy from './aws/policy.js';

/**
 * @typedef WharfieDeploymentResourcesProperties
 * @property {string} loggingLevel -
 * @property {number} [createdAt] -
 */

/**
 * @typedef WharfieDeploymentResourcesOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('./reconcilable.js').default.Status} [status] -
 * @property {WharfieDeploymentResourcesProperties &  import('../typedefs.js').SharedProperties} properties -
 * @property {Object<string, import('./base-resource.js').default | BaseResourceGroup>} [resources] -
 * @property {import('./reconcilable.js').default[]} [dependsOn] -
 */

class WharfieDeploymentResources extends BaseResourceGroup {
  /**
   * @param {WharfieDeploymentResourcesOptions} options -
   */
  constructor({ name, parent, status, properties, dependsOn, resources }) {
    super({
      name,
      parent,
      status,
      properties,
      resources,
      dependsOn,
    });
  }

  /**
   * @param {string} parent -
   * @returns {(import('./base-resource.js').default | BaseResourceGroup)[]} -
   */
  _defineGroupResources(parent) {
    const systemBucket = new Bucket({
      name: `${this.get('deployment').name}-bucket`,
      parent,
      properties: {
        deployment: () => this.get('deployment'),
        lifecycleConfiguration: {
          Rules: [
            {
              ID: 'log_files_expiration',
              Expiration: {
                Days: 1,
              },
              Status: 'Enabled',
              Prefix: '/logs/raw/',
            },
            {
              ID: 'abort_incomplete_multipart_uploads',
              // Prefix is required but not documented https://github.com/boto/boto3/issues/1126#issuecomment-309147443
              Prefix: '',
              AbortIncompleteMultipartUpload: {
                DaysAfterInitiation: 1,
              },
              Status: 'Enabled',
            },
          ],
        },
      },
    });
    const operationTable = new Table({
      name: `${this.get('deployment').name}-operations`,
      parent,
      properties: {
        deployment: () => this.get('deployment'),
        attributeDefinitions: [
          {
            AttributeName: 'resource_id',
            AttributeType: 'S',
          },
          { AttributeName: 'sort_key', AttributeType: 'S' },
        ],
        keySchema: [
          {
            AttributeName: 'resource_id',
            KeyType: 'HASH',
          },
          { AttributeName: 'sort_key', KeyType: 'RANGE' },
        ],
        billingMode: Table.BillingMode.PAY_PER_REQUEST,
      },
    });
    const locationTable = new Table({
      name: `${this.get('deployment').name}-locations`,
      parent,
      properties: {
        deployment: () => this.get('deployment'),
        attributeDefinitions: [
          {
            AttributeName: 'location',
            AttributeType: 'S',
          },
          { AttributeName: 'resource_id', AttributeType: 'S' },
        ],
        keySchema: [
          {
            AttributeName: 'location',
            KeyType: 'HASH',
          },
          { AttributeName: 'resource_id', KeyType: 'RANGE' },
        ],
        billingMode: Table.BillingMode.PAY_PER_REQUEST,
      },
    });
    const semaphoreTable = new Table({
      name: `${this.get('deployment').name}-semaphore`,
      parent,
      properties: {
        deployment: () => this.get('deployment'),
        attributeDefinitions: [
          {
            AttributeName: 'semaphore',
            AttributeType: 'S',
          },
        ],
        keySchema: [
          {
            AttributeName: 'semaphore',
            KeyType: 'HASH',
          },
        ],
        billingMode: Table.BillingMode.PAY_PER_REQUEST,
      },
    });
    const schedulerTable = new Table({
      name: `${this.get('deployment').name}-scheduler`,
      parent,
      properties: {
        deployment: () => this.get('deployment'),
        attributeDefinitions: [
          {
            AttributeName: 'resource_id',
            AttributeType: 'S',
          },
          { AttributeName: 'sort_key', AttributeType: 'S' },
        ],
        keySchema: [
          {
            AttributeName: 'resource_id',
            KeyType: 'HASH',
          },
          { AttributeName: 'sort_key', KeyType: 'RANGE' },
        ],
        billingMode: Table.BillingMode.PAY_PER_REQUEST,
        timeToLiveSpecification: {
          AttributeName: 'ttl',
          Enabled: true,
        },
      },
    });
    const dependencyTable = new Table({
      name: `${this.get('deployment').name}-dependencies`,
      parent,
      properties: {
        deployment: () => this.get('deployment'),
        attributeDefinitions: [
          {
            AttributeName: 'dependency',
            AttributeType: 'S',
          },
          { AttributeName: 'resource_id', AttributeType: 'S' },
        ],
        keySchema: [
          {
            AttributeName: 'dependency',
            KeyType: 'HASH',
          },
          { AttributeName: 'resource_id', KeyType: 'RANGE' },
        ],
        billingMode: Table.BillingMode.PAY_PER_REQUEST,
      },
    });
    const systemFirehoseRole = new Role({
      name: `${this.get('deployment').name}-firehose-role`,
      parent,
      dependsOn: [systemBucket],
      properties: {
        deployment: () => this.get('deployment'),
        description: `${this.get('deployment').name} firehose role`,
        assumeRolePolicyDocument: {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: {
                Service: 'firehose.amazonaws.com',
              },
              Action: 'sts:AssumeRole',
            },
          ],
        },
        rolePolicyDocument: () => ({
          Version: '2012-10-17',
          Statement: [
            {
              Action: ['s3:PutObject', 's3:GetObject'],
              Resource: `${systemBucket.get('arn')}/logs/raw/*`,
              Effect: 'Allow',
            },
            {
              Action: [
                's3:AbortMultipartUpload',
                's3:GetBucketLocation',
                's3:ListBucket',
                's3:ListBucketMultipartUploads',
              ],
              Resource: systemBucket.get('arn'),
              Effect: 'Allow',
            },
          ],
        }),
      },
    });
    const systemFirehose = new Firehose({
      name: `${this.get('deployment').name}-firehose`,
      parent,
      dependsOn: [systemFirehoseRole, systemBucket],
      properties: {
        deployment: () => this.get('deployment'),
        s3DestinationConfiguration: () => ({
          BucketARN: systemBucket.get('arn'),
          RoleARN: systemFirehoseRole.get('arn'),
          Prefix: 'logs/raw/',
          CompressionFormat: 'GZIP',
          BufferingHints: {
            IntervalInSeconds: 60,
            SizeInMBs: 32,
          },
        }),
      },
    });
    const eventRole = new Role({
      name: `${this.get('deployment').name}-event-role`,
      parent,
      properties: {
        deployment: () => this.get('deployment'),
        description: `${this.get('deployment').name} event role`,
        assumeRolePolicyDocument: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                Service: ['events.amazonaws.com', 'sqs.amazonaws.com'],
              },
            },
          ],
        },
      },
    });
    const sharedPolicy = new Policy({
      name: `${this.get('deployment').name}-shared-policy`,
      parent,
      dependsOn: [eventRole, systemBucket],
      properties: {
        deployment: () => this.get('deployment'),
        description: `${this.get('deployment').name} shared policy`,
        document: () => ({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: ['athena:GetQueryExecution', 'athena:*'],
              Resource: '*',
            },
            {
              Effect: 'Allow',
              Action: [
                's3:GetBucketLocation',
                's3:GetObject',
                's3:ListBucket',
                's3:ListBucketMultipartUploads',
                's3:ListMultipartUploadParts',
                's3:AbortMultipartUpload',
                's3:PutObject',
                's3:DeleteObject',
              ],
              Resource: [
                systemBucket.get('arn'),
                `${systemBucket.get('arn')}/*`,
              ],
            },
            {
              Effect: 'Allow',
              Action: [
                'glue:GetPartitions',
                'glue:GetPartition',
                'glue:UpdatePartition',
                'glue:CreatePartition',
                'glue:BatchCreatePartition',
                'glue:BatchDeletePartition',
                'glue:CreateTable',
                'glue:UpdateTable',
                'glue:DeleteTable',
                'glue:GetTable',
                'glue:GetTables',
              ],
              Resource: '*',
            },
            {
              Effect: 'Allow',
              Action: ['iam:PassRole'],
              Resource: [eventRole.get('arn')],
            },
          ],
        }),
      },
    });
    const temporaryDatabase = new GlueDatabase({
      name: `${this.get('deployment').name}-temporary-database`,
      parent,
      properties: {
        deployment: () => this.get('deployment'),
      },
    });

    const actorPolicy = new Policy({
      name: `${this.get('deployment').name}-actor-policy`,
      parent,
      dependsOn: [
        operationTable,
        locationTable,
        semaphoreTable,
        schedulerTable,
        dependencyTable,
      ],
      properties: {
        deployment: () => this.get('deployment'),
        description: `${this.get('deployment').name} actor ${
          this.get('deployment').name
        } policy`,
        document: () => ({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: ['athena:GetQueryExecution'],
              Resource: '*',
            },

            {
              Effect: 'Allow',
              Action: ['cloudwatch:PutMetricData'],
              Resource: '*',
            },
            ...(this.get('loggingLevel') === 'debug'
              ? [
                  {
                    Effect: 'Allow',
                    Action: [
                      'logs:CreateLogGroup',
                      'logs:CreateLogStream',
                      'logs:PutLogEvents',
                    ],
                    Resource: '*',
                  },
                ]
              : []),
            {
              Effect: 'Allow',
              Action: [
                'sqs:DeleteMessage',
                'sqs:ReceiveMessage',
                'sqs:GetQueueAttributes',
                'sqs:SendMessage',
              ],
              Resource: '*',
            },
            {
              Effect: 'Allow',
              Action: ['firehose:PutRecordBatch'],
              Resource: [systemFirehose.get('arn')],
            },
            {
              Effect: 'Allow',
              Action: [
                'dynamodb:PutItem',
                'dynamodb:Query',
                'dynamodb:BatchWriteItem',
                'dynamodb:UpdateItem',
                'dynamodb:GetItem',
                'dynamodb:DeleteItem',
              ],
              Resource: [
                operationTable.get('arn'),
                locationTable.get('arn'),
                schedulerTable.get('arn'),
                semaphoreTable.get('arn'),
                dependencyTable.get('arn'),
              ],
            },
            {
              Effect: 'Allow',
              Action: [
                's3:PutObject',
                's3:PutObjectAcl',
                's3:GetObject',
                's3:ListMultipartUploadParts',
                's3:AbortMultipartUpload',
              ],
              Resource: [`${systemBucket.get('arn')}/*`],
            },
            {
              Effect: 'Allow',
              Action: [
                's3:GetBucketLocation',
                's3:ListBucket',
                's3:ListBucketMultipartUploads',
                's3:AbortMultipartUpload',
              ],
              Resource: [systemBucket.get('arn')],
            },
            {
              Effect: 'Allow',
              Action: [
                'sqs:DeleteMessage',
                'sqs:ReceiveMessage',
                'sqs:GetQueueAttributes',
                'sqs:SendMessage',
              ],
              Resource: ['*'],
            },
          ],
        }),
      },
    });
    const infraPolicy = new Policy({
      name: `${this.get('deployment').name}-infra-policy`,
      parent,
      dependsOn: [operationTable, locationTable, dependencyTable],
      properties: {
        deployment: () => this.get('deployment'),
        description: `${this.get('deployment').name} infra ${
          this.get('deployment').name
        } policy`,
        document: () => ({
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'AthenaWorkgroupIAC',
              Effect: 'Allow',
              Action: [
                'athena:ListTagsForResource',
                'athena:UntagResource',
                'athena:TagResource',
                'athena:GetWorkGroup',
                'athena:UpdateWorkGroup',
                'athena:CreateWorkGroup',
                'athena:DeleteWorkGroup',
              ],
              Resource: '*',
            },
            {
              Sid: 'GlueTableIAC',
              Effect: 'Allow',
              Action: [
                'glue:CreateTable',
                'glue:DeleteTable',
                'glue:GetTable',
                'glue:UpdateTable',
                'glue:GetTags',
                'glue:TagResource',
                'glue:UntagResource',
              ],
              Resource: '*',
            },
            {
              Sid: 'EventsRuleIAC',
              Effect: 'Allow',
              Action: [
                'events:ListTargetsByRule',
                'events:PutTargets',
                'events:RemoveTargets',
                'events:ListTagsForResource',
                'events:UntagResource',
                'events:TagResource',
                'events:DescribeRule',
                'events:EnableRule',
                'events:DisableRule',
                'events:PutRule',
                'events:DeleteRule',
              ],
              Resource: '*',
            },
            {
              Sid: 'WharfieResourceRecordIAC',
              Effect: 'Allow',
              Action: ['dynamodb:PutItem', 'dynamodb:DeleteItem'],
              Resource: [operationTable.get('arn')],
            },
            {
              Sid: 'WharfieResourceRecordS3GetBucketLocation',
              Effect: 'Allow',
              Action: ['s3:GetBucketLocation'],
              Resource: '*',
            },
            {
              Sid: 'LocationRecordIAC',
              Effect: 'Allow',
              Action: ['dynamodb:PutItem', 'dynamodb:DeleteItem'],
              Resource: [locationTable.get('arn')],
            },
            {
              Sid: 'DependencyRecordIAC',
              Effect: 'Allow',
              Action: ['dynamodb:PutItem', 'dynamodb:DeleteItem'],
              Resource: [dependencyTable.get('arn')],
            },
            {
              Sid: 'IACState',
              Effect: 'Allow',
              Action: [
                'dynamodb:PutItem',
                'dynamodb:Query',
                'dynamodb:BatchWriteItem',
                'dynamodb:UpdateItem',
                'dynamodb:GetItem',
                'dynamodb:DeleteItem',
              ],
              Resource: [this.get('deployment').stateTableArn],
            },
          ],
        }),
      },
    });
    const loggingResourceRole = new Role({
      name: `${this.name}-logging-resource-role`,
      parent,
      dependsOn: [sharedPolicy],
      properties: {
        deployment: () => this.get('deployment'),
        description: `${this.name} logging resource role`,
        assumeRolePolicyDocument: () => ({
          Version: '2012-10-17',
          Statement: [
            {
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                AWS: '*',
              },
            },
          ],
        }),
        managedPolicyArns: () => [sharedPolicy.get('arn')],
        rolePolicyDocument: () => {
          return {
            Version: '2012-10-17',
            Statement: [
              {
                Sid: 'Bucket',
                Effect: 'Allow',
                Action: [
                  's3:GetBucketLocation',
                  's3:GetBucketAcl',
                  's3:ListBucket',
                  's3:ListBucketMultipartUploads',
                  's3:AbortMultipartUpload',
                ],
                Resource: [`arn:aws:s3:::${systemBucket.get('bucketName')}`],
              },
              {
                Sid: 'OutputWrite',
                Effect: 'Allow',
                Action: ['s3:*'],
                Resource: `arn:aws:s3:::${systemBucket.get(
                  'bucketName',
                )}/logs/processed/*`,
              },
              {
                Sid: 'InputRead',
                Effect: 'Allow',
                Action: ['s3:GetObject'],
                Resource: `arn:aws:s3:::${systemBucket.get(
                  'bucketName',
                )}/logs/raw/*`,
              },
            ],
          };
        },
      },
    });
    const systemGlueDatabase = new GlueDatabase({
      name: `${this.get('deployment').name}-glue-database`,
      parent,
      properties: {
        deployment: () => this.get('deployment'),
        databaseName: this.get('deployment').name,
      },
    });
    const loggingResource = new WharfieResource({
      name: `${this.name}-log-resource`,
      parent,
      dependsOn: [
        systemGlueDatabase,
        loggingResourceRole,
        operationTable,
        locationTable,
        dependencyTable,
        systemBucket,
      ],
      properties: {
        description: `${this.name} wharfie logs`,
        columns: [
          { name: 'action_id', type: 'string' },
          { name: 'action_type', type: 'string' },
          { name: 'level', type: 'string' },
          { name: 'message', type: 'string' },
          { name: 'operation_id', type: 'string' },
          { name: 'operation_type', type: 'string' },
          { name: 'request_id', type: 'string' },
          { name: 'resource_id', type: 'string' },
          { name: 'service', type: 'string' },
          { name: 'wharfie_version', type: 'string' },
          { name: 'pid', type: 'string' },
          { name: 'hostname', type: 'string' },
          { name: 'timestamp', type: 'string' },
          { name: 'log_type', type: 'string' },
        ],
        partitionKeys: [
          { name: 'year', type: 'string' },
          { name: 'month', type: 'string' },
          { name: 'day', type: 'string' },
          { name: 'hr', type: 'string' },
        ],
        inputLocation: `s3://${systemBucket.get('bucketName')}/logs/raw/`,
        tableType: 'EXTERNAL_TABLE',
        parameters: { EXTERNAL: 'true' },
        inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
        outputFormat:
          'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
        serdeInfo: {
          SerializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
          Parameters: { 'ignore.malformed.json': 'true' },
        },
        // general properties
        deployment: () => this.get('deployment'),
        resourceName: 'logs',
        projectName: this.get('deployment').name,
        databaseName: this.get('deployment').name,
        outputLocation: `s3://${systemBucket.get(
          'bucketName',
        )}/logs/processed/`,
        projectBucket: systemBucket.get('bucketName'),
        region: () => this.get('deployment').region,
        catalogId: () => this.get('deployment').accountId,
        roleArn: () => loggingResourceRole.get('arn'),
        operationTable: `${this.get('deployment').name}-operations`,
        dependencyTable: `${this.get('deployment').name}-dependencies`,
        locationTable: `${this.get('deployment').name}-locations`,
        scheduleQueueArn: () =>
          `arn:aws:sqs:${this.get('deployment').region}:${
            this.get('deployment').accountId
          }:${this.get('deployment').name}-events-queue`,
        scheduleQueueUrl: () =>
          `https://sqs.${this.get('deployment').region}.amazonaws.com/${
            this.get('deployment').accountId
          }/${this.get('deployment').name}-events-queue`,
        daemonQueueUrl: () =>
          `https://sqs.${this.get('deployment').region}.amazonaws.com/${
            this.get('deployment').accountId
          }/${this.get('deployment').name}-daemon-queue`,
        tags: [],
        createdAt: this.get('createdAt'),
      },
    });

    return [
      systemBucket,
      operationTable,
      locationTable,
      semaphoreTable,
      schedulerTable,
      dependencyTable,
      systemFirehoseRole,
      systemFirehose,
      sharedPolicy,
      eventRole,
      temporaryDatabase,
      actorPolicy,
      infraPolicy,
      systemGlueDatabase,
      loggingResource,
      loggingResourceRole,
    ];
  }

  getBucket() {
    return this.getResource(`${this.get('deployment').name}-bucket`);
  }

  getActorPolicy() {
    return this.getResource(`${this.get('deployment').name}-actor-policy`);
  }

  getActorPolicyArn() {
    return this.getResource(`${this.get('deployment').name}-actor-policy`).get(
      'arn',
    );
  }

  getInfraPolicyArn() {
    return this.getResource(`${this.get('deployment').name}-infra-policy`).get(
      'arn',
    );
  }

  getTemporaryDatabase() {
    return this.getResource(
      `${this.get('deployment').name}-temporary-database`,
    );
  }
}

export default WharfieDeploymentResources;
