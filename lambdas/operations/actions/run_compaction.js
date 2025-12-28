import { Operation, Resource } from '../../lib/graph/index.js';
import { createId } from '../../lib/id.js';
import * as logging from '../../lib/logging/index.js';
import Athena from '../../lib/athena/index.js';
import Glue from '../../lib/glue.js';
import Compaction from './lib/compaction.js';
import STS from '../../lib/sts.js';
import * as resource_db from '../../lib/dynamo/operations.js';
import * as query from '../query/index.js';

const TEMPORARY_GLUE_DATABASE = process.env.TEMPORARY_GLUE_DATABASE || '';
const MAX_QUERIES_PER_ACTION = process.env.MAX_QUERIES_PER_ACTION || 0;

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
  const athena = new Athena({ region, credentials });
  const glue = new Glue({ region, credentials });

  const compaction = new Compaction({
    glue,
    athena,
  });
  const sourceDatabaseName = resource.source_properties.databaseName;
  const sourceTableName = resource.source_properties.name;
  const temporaryDatabaseName = TEMPORARY_GLUE_DATABASE;
  const storage_id = createId();
  const temporaryTableName = `${resource.id}-${storage_id}`.replace('-', '_');

  event_log.info('RUN_TEMP_COMPACTION:cloning_destination_table');
  await glue.cloneDestinationTable(
    resource,
    {
      Name: resource.destination_properties.name,
      DatabaseName: resource.destination_properties.databaseName,
    },
    temporaryDatabaseName,
    temporaryTableName,
    storage_id,
  );

  event_log.info('RUN_TEMP_COMPACTION:fetching_compaction_partitions');
  const actionId = operation.getActionIdByType('FIND_COMPACTION_PARTITIONS');
  const partition_queries = await resource_db.getQueries(
    resource.id,
    operation.id,
    actionId,
  );
  if (operation.type === Operation.Type.MIGRATE) {
    resource = Resource.fromRecord(
      operation.operation_inputs.migration_resource,
    );
  }

  (partition_queries || []).length > 0 &&
    event_log.info(
      `RUN_TEMP_COMPACTION:loading results of ${
        (partition_queries || []).length
      } partition queries`,
    );
  const partitions = [];
  while ((partition_queries || []).length > 0) {
    const partition_query = (partition_queries || []).pop();
    if (!partition_query || !partition_query.execution_id) continue;

    const results = await athena.getQueryResults({
      QueryExecutionId: partition_query.execution_id,
    });

    for await (const result of results) {
      /** @type {import('../../typedefs.js').Partition} */
      const partition = {
        // view partions have no s3 location
        location: '',
        // @ts-ignore
        partitionValues: result,
      };
      partitions.push(partition);
    }
  }
  if (partitions.length > Number(MAX_QUERIES_PER_ACTION)) {
    throw new Error(
      `too many partitions targeted by action (${partitions.length}), consider reducing MaxDelay/Duration or modify the partitioning scheme`,
    );
  }
  if (
    partitions.length === 0 &&
    resource.source_properties.partitionKeys &&
    resource.source_properties.partitionKeys.length > 0
  ) {
    event_log.info(
      `RUN_TEMP_COMPACTION: no compactions to run, table has no partitions`,
    );
    return {
      status: 'COMPLETED',
      outputs: {
        temporaryDatabaseName,
        temporaryTableName,
      },
    };
  }

  const queries = await compaction.getCompactionQueries({
    resource,
    partitions,
    sourceDatabaseName,
    sourceTableName,
    temporaryDatabaseName,
    temporaryTableName,
  });

  event_log.info(
    `RUN_TEMP_COMPACTION:submitting ${queries.length} compaction queries`,
  );

  await query.enqueue(event, context, queries);

  return {
    status: 'COMPLETED',
    outputs: {
      temporaryDatabaseName,
      temporaryTableName,
    },
    inflightQuery: true,
  };
}

export default { run };
