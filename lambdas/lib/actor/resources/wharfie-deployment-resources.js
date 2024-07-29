const BaseResourceGroup = require('./base-resource-group');
const WharfieResource = require('./wharfie-resource');
const Table = require('./aws/table');
const GlueDatabase = require('./aws/glue-database');
const Bucket = require('./aws/bucket');
const Firehose = require('./aws/firehose');
const Role = require('./aws/role');
const Policy = require('./aws/policy');
const Database = require('./aws/glue-database');

/**
 * @typedef WharfieDeploymentResourcesOptions
 * @property {string} name -
 * @property {import('./reconcilable').Status} [status] -
 * @property {import('../typedefs').SharedProperties} properties -
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
    const resourceTable = new Table({
      name: `${this.get('deployment').name}-resource`,
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
    const eventTable = new Table({
      name: `${this.get('deployment').name}-events`,
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
                resourceTable.get('arn'),
                locationTable.get('arn'),
                eventTable.get('arn'),
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
    const loggingResourceRole = new Role({
      name: `${this.name}-logging-resource-role`,
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
                Resource: [`arn:aws:s3:::${systemBucket.name}`],
              },
              {
                Sid: 'OutputWrite',
                Effect: 'Allow',
                Action: ['s3:*'],
                Resource: `arn:aws:s3:::${systemBucket.name}/logs/processed/*`,
              },
              {
                Sid: 'InputRead',
                Effect: 'Allow',
                Action: ['s3:GetObject'],
                Resource: `arn:aws:s3:::${systemBucket.name}/logs/raw/*`,
              },
            ],
          };
        },
      },
    });
    const systemGlueDatabase = new GlueDatabase({
      name: this.get('deployment').name,
      properties: {
        deployment: () => this.get('deployment'),
      },
    });
    const loggingResource = new WharfieResource({
      name: `${this.name}-log-resource`,
      dependsOn: [
        systemGlueDatabase,
        loggingResourceRole,
        resourceTable,
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
        inputLocation: `s3://${systemBucket.name}/logs/raw/`,
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
        outputLocation: `s3://${systemBucket.name}/logs/processed/`,
        deploymentBucket: systemBucket.name,
        region: () => this.get('deployment').region,
        catalogId: () => this.get('deployment').accountId,
        roleArn: () => loggingResourceRole.get('arn'),
        resourceTable: `${this.get('deployment').name}-resource`,
        dependencyTable: `${this.get('deployment').name}-dependencies`,
        locationTable: `${this.get('deployment').name}-locations`,
        tags: [],
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
      systemGlueDatabase,
      loggingResource,
      loggingResourceRole,
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
