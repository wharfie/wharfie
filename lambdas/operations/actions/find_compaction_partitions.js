'use strict';

const Glue = require('../../lib/glue');
const Athena = require('../../lib/athena');
const logging = require('../../lib/logging');
const Compaction = require('./lib/compaction');
const query = require('../query');

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
  const glue = new Glue({ region });
  const athena = new Athena({ region });

  const compaction = new Compaction({
    glue,
    athena,
  });

  let SLA;
  if (operation.operation_type === 'BACKFILL') {
    if (!operation.operation_config)
      throw new Error('Backfill operation missing config');
    SLA = {
      MaxDelay: operation.operation_config.Duration,
      ColumnExpression:
        resource.daemon_config.SLA &&
        resource.daemon_config.SLA.ColumnExpression,
    };
  } else {
    SLA = resource.daemon_config.SLA;
  }

  event_log.info('FIND_COMPACTION_PARTITIONS:generate_queries for table');
  const query_string = await compaction.getCalculatePartitionQueries({
    resource,
    SLA,
    operationTime: operation.started_at,
    sourceDatabaseName: resource.source_properties.databaseName,
    sourceTableName: resource.source_properties.name,
    athenaWorkgroup: resource.athena_workgroup,
  });
  event_log.info(`FIND_COMPACTION_PARTITIONS:submitting query`);
  if (query_string) await query.enqueue(event, context, [{ query_string }]);

  return {
    status: 'COMPLETED',
  };
}

module.exports = { run };
