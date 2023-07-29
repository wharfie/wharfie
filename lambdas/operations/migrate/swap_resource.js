'use strict';

const { parse } = require('@sandfox/arn');

const cuid = require('cuid');

const logging = require('../../lib/logging');
const Glue = require('../../lib/glue');
const STS = require('../../lib/sts');
const S3 = require('../../lib/s3');
const SQS = require('../../lib/sqs');

const resource_db = require('../../lib/dynamo/resource');

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
  const sqs = new SQS({ region });
  const s3 = new S3({ region, credentials });

  const migrateDatabaseName =
    operation.operation_inputs.migration_resource.destination_properties
      .DatabaseName;
  const migrateTableName =
    operation.operation_inputs.migration_resource.destination_properties
      .TableInput.Name;

  const { Table: migrateTable } = await glue.getTable({
    DatabaseName: migrateDatabaseName,
    Name: migrateTableName,
  });

  const migratePartitions = await this.glue.getPartitions({
    DatabaseName: migrateDatabaseName,
    TableName: migrateTableName,
  });

  const existingPartitions = await this.glue.getPartitions({
    data,
  });

  return {
    status: 'COMPLETED',
  };
}

module.exports = { run };
