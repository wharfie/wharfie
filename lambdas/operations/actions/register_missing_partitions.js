'use strict';

const { parse } = require('@sandfox/arn');

const logging = require('../../lib/logging');
const Glue = require('../../lib/glue');
const S3 = require('../../lib/s3');
const Partition = require('./lib/partition');
const STS = require('../../lib/sts');
/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {import('../../typedefs').ResourceRecord} resource -
 * @returns {Promise<import('../../typedefs').ActionProcessingOutput>} -
 */
async function run(event, context, resource) {
  const event_log = logging.getEventLogger(event, context);
  const { region } = parse(resource.resource_arn);
  const sts = new STS({ region });
  const credentials = await sts.getCredentials(resource.daemon_config.Role);
  const s3 = new S3({ region, credentials });
  const glue = new Glue({ region });
  const partition = new Partition({ s3, glue });

  if (
    !resource.source_properties.TableInput.PartitionKeys ||
    resource.source_properties.TableInput.PartitionKeys.length === 0
  ) {
    event_log.info('REGISTER_MISSING_PARTITIONS: no partitions to register');
    await partition.followTableSymlink({
      uri: resource.destination_properties.TableInput.StorageDescriptor
        .Location,
      partitionKeys: resource.destination_properties.TableInput.PartitionKeys,
      databaseName: resource.destination_properties.DatabaseName,
      tableName: resource.destination_properties.TableInput.Name,
    });
    return {
      status: 'COMPLETED',
    };
  }

  const isView =
    resource.source_properties.TableInput.TableType === 'VIRTUAL_VIEW';

  await Promise.all([
    !isView
      ? partition.registerMissing({
          uri: resource.source_properties.TableInput.StorageDescriptor.Location,
          partitionKeys: resource.source_properties.TableInput.PartitionKeys,
          databaseName: resource.source_properties.DatabaseName,
          tableName: resource.source_properties.TableInput.Name,
        })
      : Promise.resolve(),
    partition.registerMissing({
      uri: resource.destination_properties.TableInput.StorageDescriptor
        .Location,
      partitionKeys: resource.destination_properties.TableInput.PartitionKeys,
      databaseName: resource.destination_properties.DatabaseName,
      tableName: resource.destination_properties.TableInput.Name,
    }),
  ]);

  return {
    status: 'COMPLETED',
  };
}

module.exports = { run };
