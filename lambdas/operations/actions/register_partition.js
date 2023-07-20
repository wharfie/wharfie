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
 * @param {import('../../typedefs').OperationRecord} operation -
 * @returns {Promise<import('../../typedefs').ActionProcessingOutput>} -
 */
async function run(event, context, resource, operation) {
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
    return {
      status: 'COMPLETED',
    };
  }

  const isView =
    resource.source_properties.TableInput.TableType === 'VIRTUAL_VIEW';

  const isPartitioned =
    resource.destination_properties.TableInput.PartitionKeys &&
    resource.destination_properties.TableInput.PartitionKeys.length > 0;
  if (!isView && isPartitioned) {
    event_log.warn(
      `registering partition ${JSON.stringify(
        operation.operation_inputs.partition
      )}`
    );
    event_log.debug(
      `registering partition in location ${operation.operation_inputs.partition.location}`
    );
    await partition.registerPartition({
      partition: operation.operation_inputs.partition,
      databaseName: resource.source_properties.DatabaseName,
      tableName: resource.source_properties.TableInput.Name,
    });
  }

  return {
    status: 'COMPLETED',
  };
}

module.exports = { run };
