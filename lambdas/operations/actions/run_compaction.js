'use strict';

const { createId } = require('../../lib/id');
const logging = require('../../lib/logging');
const Athena = require('../../lib/athena');
const Glue = require('../../lib/glue');
const Compaction = require('./lib/compaction');
const STS = require('../../lib/sts');
const resource_db = require('../../lib/dynamo/operations');
const query = require('../query');

const TEMPORARY_GLUE_DATABASE = process.env.TEMPORARY_GLUE_DATABASE || '';
const MAX_QUERIES_PER_ACTION = process.env.MAX_QUERIES_PER_ACTION || 0;

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {import('../../typedefs').ResourceRecord} resource -
 * @param {import('../../typedefs').OperationRecord} operation -
 * @returns {Promise<import('../../typedefs').ActionProcessingOutput>} -
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
  const temporaryTableName = `${resource.resource_id}-${storage_id}`.replace(
    '-',
    '_'
  );

  event_log.info('RUN_TEMP_COMPACTION:cloning_destination_table');
  await glue.cloneDestinationTable(
    resource,
    {
      Name: resource.destination_properties.name,
      DatabaseName: resource.destination_properties.databaseName,
    },
    temporaryDatabaseName,
    temporaryTableName,
    storage_id
  );

  event_log.info('RUN_TEMP_COMPACTION:fetching_compaction_partitions');
  const action = operation.action_graph.getActionByType(
    'FIND_COMPACTION_PARTITIONS'
  );
  const partition_queries = await resource_db.getActionQueries(
    resource.resource_id,
    operation.operation_id,
    action.id
  );

  (partition_queries || []).length > 0 &&
    event_log.info(
      `RUN_TEMP_COMPACTION:loading results of ${
        (partition_queries || []).length
      } partition queries`
    );
  const partitions = [];
  while ((partition_queries || []).length > 0) {
    const partition_query = (partition_queries || []).pop();
    if (!partition_query || !partition_query.query_execution_id) continue;

    const results = await athena.getQueryResults({
      QueryExecutionId: partition_query.query_execution_id,
    });

    for await (const result of results) {
      /** @type {import('../../typedefs').Partition} */
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
      `too many partitions targeted by action (${partitions.length}), consider reducing MaxDelay/Duration or modify the partitioning scheme`
    );
  }
  if (
    partitions.length === 0 &&
    resource.source_properties.partitionKeys &&
    resource.source_properties.partitionKeys.length > 0
  ) {
    event_log.info(
      `RUN_TEMP_COMPACTION: no compactions to run, table has no partitions`
    );
    return {
      status: 'COMPLETED',
      nextActionInputs: {
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
    `RUN_TEMP_COMPACTION:submitting ${queries.length} compaction queries`
  );

  await query.enqueue(event, context, queries);

  return {
    status: 'COMPLETED',
    nextActionInputs: {
      temporaryDatabaseName,
      temporaryTableName,
    },
  };
}

module.exports = { run };
