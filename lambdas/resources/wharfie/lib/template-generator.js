'use strict';

const { parse } = require('@sandfox/arn');
const { version } = require('../../../../package.json');

const get_dashboard = require('./dashboard');
const { generateSchedule } = require('./cron');

const STACK_NAME = process.env.STACK_NAME || '';

/**
 * @typedef Column
 * @property {string} Name -
 * @property {string} Type -
 */

/**
 * @typedef CloudformationTemplate
 * @property {string} AWSTemplateFormatVersion -
 * @property {any} Metadata -
 * @property {any} Parameters -
 * @property {any} Mappings -
 * @property {any} Resources -
 * @property {any} Outputs -
 * @param {import('../../../typedefs').CloudformationEvent} event -
 * @returns {CloudformationTemplate} -
 */
function Wharfie(event) {
  const {
    LogicalResourceId,
    StackId,
    ResourceProperties: {
      Tags,
      TableInput,
      CatalogId,
      DatabaseName,
      CompactedConfig: { Location },
      DaemonConfig,
      Backfill,
    },
  } = event;
  const { Schedule } = DaemonConfig;
  const originalStack = parse(StackId).resource.split('/')[1];

  const Metadata = {
    WharfieVersion: version,
    DaemonConfig,
    Backfill,
  };

  const template = {
    AWSTemplateFormatVersion: '2010-09-09',
    Metadata,
    Parameters: {
      MigrationResource: {
        Type: 'String',
        Default: 'false',
        AllowedValues: ['true', 'false'],
      },
    },
    Mappings: {},
    Conditions: {
      isMigrationResource: {
        'Fn::Equals': [{ Ref: 'isMigrationResource' }, 'true'],
      },
    },
    Resources: {
      Workgroup: {
        Type: 'AWS::Athena::WorkGroup',
        Properties: {
          Tags,
          Name: {
            'Fn::Sub': ['${AWS::StackName}', {}],
          },
          Description: `Workgroup for the ${LogicalResourceId} Wharfie Resource in the ${originalStack} stack`,
          State: 'ENABLED',
          RecursiveDeleteOption: true,
          WorkGroupConfiguration: {
            EngineVersion: {
              SelectedEngineVersion: 'Athena engine version 3',
            },
            PublishCloudWatchMetricsEnabled: true,
            EnforceWorkGroupConfiguration: true,
            ResultConfiguration: {
              EncryptionConfiguration: {
                EncryptionOption: 'SSE_S3',
              },
              OutputLocation: `${Location}query_metadata/`,
            },
          },
          WorkGroupConfigurationUpdates: {
            EngineVersion: {
              SelectedEngineVersion: 'Athena engine version 3',
            },
            PublishCloudWatchMetricsEnabled: true,
            EnforceWorkGroupConfiguration: true,
            ResultConfigurationUpdates: {
              EncryptionConfiguration: {
                EncryptionOption: 'SSE_S3',
              },
              OutputLocation: `${Location}query_metadata/`,
            },
          },
        },
      },
      Source: {
        Type: 'AWS::Glue::Table',
        Properties: {
          DatabaseName,
          CatalogId,
          TableInput: {
            ...TableInput,
            Name: `${TableInput.Name}_raw`,
          },
        },
      },
      Compacted: {
        Type: 'AWS::Glue::Table',
        Properties: {
          DatabaseName,
          CatalogId,
          TableInput: {
            Name: `${TableInput.Name}`,
            Description: TableInput.Description,
            TableType: 'EXTERNAL_TABLE',
            Parameters: { 'parquet.compress': 'GZIP', EXTERNAL: 'TRUE' },
            PartitionKeys: TableInput.PartitionKeys || [],
            StorageDescriptor: {
              Location: {
                'Fn::If': [
                  'isMigrationResource',
                  `${Location}migrate-references/`,
                  `${Location}references/`,
                ],
              },
              Columns: TableInput.StorageDescriptor.Columns,
              InputFormat:
                'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
              OutputFormat:
                'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
              Compressed: true,
              SerdeInfo: {
                SerializationLibrary:
                  'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
                Parameters: { 'parquet.compress': 'GZIP' },
              },
              StoredAsSubDirectories: false,
              NumberOfBuckets: 0,
            },
          },
        },
      },
      Dashboard: {
        Type: 'AWS::CloudWatch::Dashboard',
        Properties: {
          DashboardName: {
            'Fn::Sub': [
              '${originalStack}_${LogicalResourceId}',
              { originalStack, LogicalResourceId },
            ],
          },
          DashboardBody: {
            'Fn::Sub': [
              JSON.stringify(
                get_dashboard(LogicalResourceId, originalStack, Metadata)
              ),
              {
                WharfieStack: STACK_NAME,
                Region: { Ref: 'AWS::Region' },
              },
            ],
          },
        },
      },
      Schedule: {
        Type: 'AWS::Events::Rule',
        Properties: {
          Name: {
            'Fn::Sub': ['${AWS::StackName}', {}],
          },
          Description: {
            'Fn::Sub': [
              'Schedule for ${table} in ${AWS::StackName} stack maintained by ${stack}',
              { table: TableInput.Name, stack: process.env.STACK_NAME },
            ],
          },
          State: Schedule ? 'ENABLED' : 'DISABLED',
          ScheduleExpression: generateSchedule(Schedule),
          RoleArn: process.env.DAEMON_EVENT_ROLE,
          Targets: [
            {
              Id: {
                'Fn::Sub': ['${AWS::StackName}', {}],
              },
              Arn: process.env.DAEMON_QUEUE_ARN,
              InputTransformer: {
                InputPathsMap: {
                  time: '$.time',
                },
                InputTemplate: {
                  'Fn::Sub': [
                    '{"operation_started_at":<time>, "operation_type":"MAINTAIN", "action_type":"START", "resource_id":"${AWS::StackName}"}',
                    {},
                  ],
                },
              },
            },
          ],
        },
      },
    },
    Outputs: {},
  };

  return template;
}

module.exports = {
  Wharfie,
};
