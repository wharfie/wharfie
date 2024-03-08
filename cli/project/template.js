const { WHARFIE_DEFAULT_ENVIRONMENT } = require('./constants');

const { Role } = require('../../client/resources/role');
const { Resource } = require('../../client/resources/resource');
const {
  S3BucketEventNotification,
} = require('../../client/resources/s3-bucket-event-notification');
const {
  MaterializedView,
} = require('../../client/resources/materialized-view');
const util = require('../../client/util');

/**
 * @param {import('./typedefs').Project} project -
 * @param {import('./typedefs').Environment} environment -
 * @returns {String} -
 */
function getStackName(project, environment) {
  return `${project.name}${
    environment.name === WHARFIE_DEFAULT_ENVIRONMENT
      ? ''
      : `-${environment.name.replac}`
  }`.replace(/_/g, '-');
}

/**
 *
 * @param {import('./typedefs').Project} project -
 * @param {import('./typedefs').Environment} environment -
 * @returns {any} -
 */
function buildProjectCloudformationTemplate(project, environment) {
  const resources = [];
  resources.push(
    util.shortcuts.s3Bucket.build({
      BucketName: util.sub(
        '${AWS::StackName}-${AWS::AccountId}-${AWS::Region}'
      ),
      LifecycleConfiguration: {
        Rules: [
          {
            AbortIncompleteMultipartUpload: {
              DaysAfterInitiation: 1,
            },
            Status: 'Enabled',
          },
        ],
      },
      NotificationConfiguration: {
        QueueConfigurations: [
          {
            Event: 's3:ObjectCreated:*',
            Queue: util.importValue(util.sub('${Deployment}-s3-event-queue')),
          },
          {
            Event: 's3:ObjectRemoved:*',
            Queue: util.importValue(util.sub('${Deployment}-s3-event-queue')),
          },
        ],
      },
    })
  );
  for (const model of project.models) {
    resources.push(
      new MaterializedView({
        LogicalName: model.name.split('_').join(''),
        DatabaseName: util.ref('Database'),
        TableName: model.name,
        Columns: model.columns.map((column) => ({
          Name: column.name,
          Type: column.type,
        })),
        PartitionKeys: (model.partitions || []).map((partition) => ({
          Name: partition.name,
          Type: partition.type,
        })),
        CompactedConfig: {
          Location: util.sub(`s3://\${Bucket}/${model.name}/`),
        },
        OriginalSql: model.sql,
        DaemonConfig: {
          Role: util.getAtt('ProjectRole', 'Arn'),
          Interval: model.service_level_agreement.freshness,
        },
        SqlVariables: {
          db: util.ref('Database'),
        },
        WharfieDeployment: util.ref('Deployment'),
      })
    );
  }
  for (const source of project.sources) {
    resources.push(
      new Resource({
        LogicalName: source.name.split('_').join(''),
        DatabaseName: util.ref('Database'),
        TableName: source.name,
        Columns: source.columns.map((column) => ({
          Name: column.name,
          Type: column.type,
        })),
        PartitionKeys: (source.partitions || []).map((partition) => ({
          Name: partition.name,
          Type: partition.type,
        })),
        Format: source.format === 'custom' ? undefined : source.format,
        CustomFormat: source.custom_format
          ? {
              InputFormat: source.custom_format.input_format,
              OutputFormat: source.custom_format.output_format,
              SerdeInfo: {
                SerializationLibrary:
                  source.custom_format.serde_info.serialization_library,
                Parameters: source.custom_format.serde_info.parameters,
              },
              Compressed: source.custom_format.compressed,
              StoredAsSubDirectories:
                source.custom_format.stored_as_sub_directories,
              NumberOfBuckets: source.custom_format.number_of_buckets,
            }
          : undefined,
        CompactedConfig: {
          Location: util.sub(`s3://\${Bucket}/${source.name}/`),
        },
        InputLocation: source.input_location.path,
        DaemonConfig: {
          Role: util.getAtt('ProjectRole', 'Arn'),
          Schedule: source.service_level_agreement.freshness,
        },
        WharfieDeployment: util.ref('Deployment'),
      })
    );
  }
  // build event notifications for sources
  /** @type {Object<string,string[]>} */
  const source_buckets = {};
  for (const source of project.sources) {
    if (!source_buckets[source.input_location.bucket]) {
      source_buckets[source.input_location.bucket] = [];
    }
    source_buckets[source.input_location.bucket].push(
      source.input_location.path
    );
  }
  for (const source_bucket in Object.keys(source_buckets)) {
    let previousDependsOn = null;
    for (const path in source_buckets[source_bucket]) {
      const dependsOn = previousDependsOn ? [previousDependsOn] : undefined;
      resources.push(
        new S3BucketEventNotification({
          LogicalName: `S3EventNotification-${source_bucket}-${path}`,
          S3URI: `arn:aws:s3:::${source_bucket}/${path}`,
          WharfieDeployment: util.ref('Deployment'),
          DependsOn: dependsOn,
        })
      );
      previousDependsOn = `S3EventNotification-${source_bucket}-${path}`;
    }
  }
  resources.push(
    new Role({
      LogicalName: 'ProjectRole',
      WharfieDeployment: util.ref('Deployment'),
      InputLocations: [
        ...project.sources.map(
          (source) => source.input_location.path.split('/')[2] + '/'
        ),
        util.sub('${Bucket}/'),
      ],
      OutputLocations: [util.sub('${Bucket}/')],
    })
  );
  return util.merge(
    {
      AWSTemplateFormatVersion: '2010-09-09',
      Metadata: {},
      Parameters: {
        Deployment: {
          Type: 'String',
          Description: 'What wharfie deployment to use',
        },
      },
      Mappings: {},
      Conditions: {},
      Resources: {
        Database: {
          Type: 'AWS::Glue::Database',
          Properties: {
            CatalogId: util.accountId,
            DatabaseInput: {
              Name: util.join(
                '_',
                util.split('-', util.sub('${AWS::StackName}'))
              ),
            },
          },
        },
      },
    },
    ...resources
  );
}

module.exports = {
  buildProjectCloudformationTemplate,
  getStackName,
};
