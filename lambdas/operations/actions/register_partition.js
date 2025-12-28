import { Operation, Resource } from '../../lib/graph/index.js';

import * as logging from '../../lib/logging/index.js';
import Glue from '../../lib/glue.js';
import S3 from '../../lib/s3.js';
import Partition from './lib/partition.js';
import STS from '../../lib/sts.js';
/**
 * @param {import('../../typedefs.js').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {Resource} resource -
 * @param {Operation} operation -
 * @returns {Promise<import('../../typedefs.js').ActionProcessingOutput>} -
 */
async function run(event, context, resource, operation) {
  const event_log = logging.getEventLogger(event, context);
  const region = resource.region;
  const sts = new STS({ region });
  const credentials = await sts.getCredentials(resource.daemon_config.Role);
  const s3 = new S3({ region, credentials });
  const glue = new Glue({ region, credentials });
  const partition = new Partition({ s3, glue });

  if (
    !resource.source_properties.partitionKeys ||
    resource.source_properties.partitionKeys.length === 0
  ) {
    return {
      status: 'COMPLETED',
    };
  }

  const isView = resource.source_properties.tableType === 'VIRTUAL_VIEW';

  const isPartitioned =
    resource.destination_properties.partitionKeys &&
    resource.destination_properties.partitionKeys.length > 0;
  if (!isView && isPartitioned) {
    event_log.debug(
      `registering partition in location ${operation.operation_inputs.partition.location}`,
    );
    await partition.registerPartition({
      partition: operation.operation_inputs.partition,
      databaseName: resource.source_properties.databaseName,
      tableName: resource.source_properties.name,
    });
  }

  return {
    status: 'COMPLETED',
  };
}

export default { run };
