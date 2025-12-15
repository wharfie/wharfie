import { Operation, Resource } from '../../lib/graph/index.js';

import Glue from '../../lib/glue.js';
import Athena from '../../lib/athena/index.js';
import STS from '../../lib/sts.js';
import * as logging from '../../lib/logging/index.js';
import Compaction from './lib/compaction.js';
import * as query from '../query/index.js';

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
  const glue = new Glue({ region, credentials });
  const athena = new Athena({ region, credentials });

  const compaction = new Compaction({
    glue,
    athena,
  });

  const SLA = resource.daemon_config.SLA;
  if (
    operation.type === Operation.Type.BACKFILL &&
    SLA &&
    operation.operation_config.Duration
  ) {
    if (!operation.operation_config)
      throw new Error('Backfill operation missing config');
    SLA.MaxDelay = operation.operation_config.Duration;
  }

  event_log.info('FIND_COMPACTION_PARTITIONS:generate_queries for table');
  const query_string = await compaction.getCalculatePartitionQueries({
    resource,
    SLA,
    operationTime: operation.started_at,
    sourceDatabaseName: resource.source_properties.databaseName,
    sourceTableName: resource.source_properties.name,
    athenaWorkgroup: resource.athena_workgroup,
    event_log,
  });
  event_log.info(`FIND_COMPACTION_PARTITIONS:submitting query`);
  if (query_string) {
    await query.enqueue(event, context, [{ query_string }]);
    return {
      status: 'COMPLETED',
      inflightQuery: true,
    };
  }

  return {
    status: 'COMPLETED',
  };
}

export default { run };
