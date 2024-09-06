'use strict';
const { Resource } = require('../../lib/graph/');

const logging = require('../../lib/logging');
const Glue = require('../../lib/glue');
const S3 = require('../../lib/s3');
const Partition = require('./lib/partition');
const STS = require('../../lib/sts');
/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {Resource} resource -
 * @returns {Promise<import('../../typedefs').ActionProcessingOutput>} -
 */
async function run(event, context, resource) {
  const event_log = logging.getEventLogger(event, context);
  const region = resource.region;
  const sts = new STS({ region });
  const credentials = await sts.getCredentials(resource.daemon_config.Role);

  let s3;
  if (resource.source_region) {
    event_log.info(`using source region ${resource.source_region}`);
    s3 = new S3({
      region: resource.source_region,
      credentials,
      followRegionRedirects: true,
    });
  } else {
    s3 = new S3({ region, credentials });
  }
  const glue = new Glue({ region, credentials });
  const partition = new Partition({ s3, glue });

  if (
    !resource.source_properties.partitionKeys ||
    resource.source_properties.partitionKeys.length === 0
  ) {
    event_log.info('REGISTER_MISSING_PARTITIONS: no partitions to register');
    await partition.followTableSymlink({
      uri: resource.destination_properties.location || '',
      partitionKeys: resource.destination_properties.partitionKeys || [],
      databaseName: resource.destination_properties.databaseName,
      tableName: resource.destination_properties.name,
    });
    return {
      status: 'COMPLETED',
    };
  }

  const isView = resource.source_properties.tableType === 'VIRTUAL_VIEW';

  await Promise.all([
    !isView
      ? partition.registerMissing({
          uri: resource.source_properties.location || '',
          partitionKeys: resource.source_properties.partitionKeys,
          databaseName: resource.source_properties.databaseName,
          tableName: resource.source_properties.name,
        })
      : Promise.resolve(),
    partition.registerMissing({
      uri: resource.destination_properties.location || '',
      partitionKeys: resource.destination_properties.partitionKeys || [],
      databaseName: resource.destination_properties.databaseName,
      tableName: resource.destination_properties.name,
    }),
  ]);

  return {
    status: 'COMPLETED',
  };
}

module.exports = { run };
