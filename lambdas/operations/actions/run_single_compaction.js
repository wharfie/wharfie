'use strict';

const { parse } = require('@sandfox/arn');

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
 * @param {import('../../typedefs').ResourceRecord} resource -
 * @param {import('../../typedefs').OperationRecord} operation -
 * @returns {Promise<import('../../typedefs').ActionProcessingOutput>} -
 */
async function run(event, context, resource, operation) {
  const event_log = logging.getEventLogger(event, context);
  const { region } = parse(resource.resource_arn);
  const sts = new STS({ region });
  const credentials = await sts.getCredentials(resource.daemon_config.Role);
  const glue = new Glue({ region });
  const athena = new Athena({ region, credentials });
  const compaction = new Compaction({
    glue,
    athena,
  });
  const sourceDatabaseName = resource.source_properties.DatabaseName;
  const sourceTableName = resource.source_properties.TableInput.Name;
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
      Name: resource.destination_properties.TableInput.Name,
      DatabaseName: resource.destination_properties.DatabaseName,
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
    nextActionInputs: {
      temporaryDatabaseName,
      temporaryTableName,
    },
  };
}

module.exports = { run };
