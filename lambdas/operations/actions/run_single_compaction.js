'use strict';

const { Operation, Resource } = require('../../lib/graph/');
const { createId } = require('../../lib/id');
const logging = require('../../lib/logging');
const Athena = require('../../lib/athena');
const Glue = require('../../lib/glue');
const Compaction = require('./lib/compaction');
const STS = require('../../lib/sts');
const query = require('../query');

const TEMPORARY_GLUE_DATABASE = process.env.TEMPORARY_GLUE_DATABASE || '';

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {Resource} resource -
 * @param {Operation} operation -
 * @returns {Promise<import('../../typedefs').ActionProcessingOutput>} -
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
    storage_id
  );

  const queries = await compaction.getCompactionQueries({
    resource,
    partitions: operation.operation_inputs.partition
      ? [operation.operation_inputs.partition]
      : [],
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
    outputs: {
      temporaryDatabaseName,
      temporaryTableName,
    },
    inflightQuery: true,
  };
}

module.exports = { run };
