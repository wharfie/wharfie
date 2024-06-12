const BaseResourceGroup = require('./base-resource-group');
const AutoScalingTable = require('./aws/autoscaling-table');
const Bucket = require('./aws/bucket');
const Firehose = require('./aws/firehose');
const Role = require('./aws/role');
const Policy = require('./aws/policy');
const Database = require('./aws/glue-database');

/**
 * @typedef WharfieDeploymentResourcesOptions
 * @property {string} name -
 * @property {import('./reconcilable').Status} [status] -
 * @property {import('../typedefs').SharedDeploymentProperties} properties -
 * @property {Object<string, import('./base-resource') | BaseResourceGroup>} [resources] -
 * @property {import('./reconcilable')[]} [dependsOn] -
 */

class WharfieDeploymentResources extends BaseResourceGroup {
  /**
   * @param {WharfieDeploymentResourcesOptions} options -
   */
  constructor({ name, status, properties, dependsOn, resources }) {
    super({
      name,
      status,
      properties,
      resources,
      dependsOn,
    });
  }

  /**
   * @returns {(import('./base-resource') | BaseResourceGroup)[]} -
   */
  _defineGroupResources() {
    const systemBucket = new Bucket({
      name: `${this.get('deployment').name}-bucket`,
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
    const resourceTable = new AutoScalingTable({
      name: `${this.get('deployment').name}-resource-autoscaling-table`,
      properties: {
        deployment: () => this.get('deployment'),
        tableName: `${this.get('deployment').name}-resource`,
        minReadCapacity: 1,
        maxReadCapacity: 50,
        minWriteCapacity: 1,
        maxWriteCapacity: 50,
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
        provisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5,
        },
      },
    });
    const locationTable = new AutoScalingTable({
      name: `${this.get('deployment').name}-locations-autoscaling-table`,
      properties: {
        deployment: () => this.get('deployment'),
        tableName: `${this.get('deployment').name}-locations`,
        minReadCapacity: 1,
        maxReadCapacity: 50,
        minWriteCapacity: 1,
        maxWriteCapacity: 50,
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
        provisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5,
        },
      },
    });
    const semaphoreTable = new AutoScalingTable({
      name: `${this.get('deployment').name}-semaphore-autoscaling-table`,
      properties: {
        deployment: () => this.get('deployment'),
        tableName: `${this.get('deployment').name}-semaphore`,
        minReadCapacity: 1,
        maxReadCapacity: 50,
        minWriteCapacity: 1,
        maxWriteCapacity: 50,
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
        provisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5,
        },
      },
    });
    const eventTable = new AutoScalingTable({
      name: `${this.get('deployment').name}-events-autoscaling-table`,
      properties: {
        deployment: () => this.get('deployment'),
        tableName: `${this.get('deployment').name}-events`,
        minReadCapacity: 1,
        maxReadCapacity: 50,
        minWriteCapacity: 1,
        maxWriteCapacity: 50,
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
        provisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5,
        },
        timeToLiveSpecification: {
          AttributeName: 'ttl',
          Enabled: true,
        },
      },
    });
    const dependencyTable = new AutoScalingTable({
      name: `${this.get('deployment').name}-dependencies-autoscaling-table`,
      properties: {
        deployment: () => this.get('deployment'),
        tableName: `${this.get('deployment').name}-dependencies`,
        minReadCapacity: 1,
        maxReadCapacity: 50,
        minWriteCapacity: 1,
        maxWriteCapacity: 50,
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
        provisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5,
        },
      },
    });
    const systemFirehoseRole = new Role({
      name: `${this.get('deployment').name}-firehose-role`,
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
    const temporaryDatabase = new Database({
      name: `${this.get('deployment').name}-temporary-database`,
      properties: {
        deployment: () => this.get('deployment'),
      },
    });

    const actorPolicy = new Policy({
      name: `${this.get('deployment').name}-actor-policy`,
      dependsOn: [
        resourceTable,
        locationTable,
        semaphoreTable,
        eventTable,
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
            {
              Effect: 'Allow',
              Action: 'cloudwatch:*',
              Resource: ['*'],
            },
            {
              Effect: 'Allow',
              Action: 'logs:*',
              Resource: ['*'],
            },
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
                resourceTable.getTable().get('arn'),
                locationTable.getTable().get('arn'),
                eventTable.getTable().get('arn'),
                semaphoreTable.getTable().get('arn'),
                dependencyTable.getTable().get('arn'),
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

    return [
      systemBucket,
      resourceTable,
      locationTable,
      semaphoreTable,
      eventTable,
      dependencyTable,
      systemFirehoseRole,
      systemFirehose,
      sharedPolicy,
      eventRole,
      temporaryDatabase,
      actorPolicy,
    ];
  }

  getBucket() {
    return this.getResource(`${this.get('deployment').name}-bucket`);
  }

  getActorPolicyArn() {
    return this.getResource(`${this.get('deployment').name}-actor-policy`).get(
      'arn'
    );
  }

  getTemporaryDatabase() {
    return this.getResource(
      `${this.get('deployment').name}-temporary-database`
    );
  }
}

module.exports = WharfieDeploymentResources;
