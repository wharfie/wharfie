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
 * @param {Glue} glue
 * @param {import("@aws-sdk/client-glue").Table} migrateTable
 */
async function swap_partitions(event, context resource, glue, migrateTable) {
  const migrationTablePartitionKeys = migrateTable.PartitionKeys || [];
  const migratePartitions = await glue.getPartitions({
    DatabaseName: migrateTable.DatabaseName,
    TableName: migrateTable.Name,
  });
  const existingPartitions = await glue.getPartitions({
    DatabaseName: resource.destination_properties.DatabaseName,
    TableName: resource.destination_properties.TableInput.Name,
  });

  /** @type {import("@aws-sdk/client-glue").PartitionInput[]} */
  const partitionCreateOps = [];
  /** @type {import("@aws-sdk/client-glue").BatchUpdatePartitionRequestEntry[]} */
  const partitionUpdateOps = [];
  /** @type {Object.<string, import('../../typedefs').Partition>} */
  const existingPartitionsLookup = {};
  existingPartitions.forEach((p) => {
    const partitionLookupKey = Object.keys(p.partitionValues).reduce(
      (acc, partitionKey, i) => {
        return (
          acc +
          `${i > 0 ? '/' : ''}${partitionKey}=${
            p.partitionValues[partitionKey]
          }`
        );
      },
      ''
    );
    existingPartitionsLookup[partitionLookupKey] = p;
  });
  migratePartitions.forEach((p) => {
    const partitionLookup = Object.keys(p.partitionValues).reduce(
      (acc, partitionKey, i) => {
        return (
          acc +
          `${i > 0 ? '/' : ''}${partitionKey}=${
            p.partitionValues[partitionKey]
          }`
        );
      },
      ''
    );
    if (!existingPartitionsLookup[partitionLookup]) {
      partitionCreateOps.push({
        Values: migrationTablePartitionKeys.map(
          (key) => `${p.partitionValues[key.Name || '']}`
        ),
        StorageDescriptor: {
          ...migrateTable.StorageDescriptor,
          Location: p.location,
        },
        Parameters: migrateTable.Parameters,
      });
    }
    if (existingPartitionsLookup[partitionLookup].location !== p.location) {
      const partitionValues = migrationTablePartitionKeys.map(
        (partitionKey) => `${p.partitionValues[partitionKey.Name || '']}`
      );
      partitionUpdateOps.push({
        PartitionValueList: partitionValues,
        PartitionInput: {
          Values: partitionValues,
          StorageDescriptor: {
            ...migrateTable.StorageDescriptor,
            Location: p.location,
          },
          Parameters: migrateTable.Parameters,
        },
      });
      delete existingPartitionsLookup[partitionLookup];
    }
  });
  /** @type {import("@aws-sdk/client-glue").PartitionValueList[]} */
  const partitionDeleteOps = Object.values(existingPartitionsLookup).map(
    (p) => ({
      Values: migrationTablePartitionKeys.map(
        (key) => `${p.partitionValues[key.Name || '']}`
      ),
    })
  );

  await Promise.all([
    glue.batchCreatePartition({
      DatabaseName: resource.destination_properties.DatabaseName,
      TableName: resource.destination_properties.TableInput.Name,
      PartitionInputList: partitionCreateOps,
    }),
    glue.batchUpdatePartition({
      DatabaseName: resource.destination_properties.DatabaseName,
      TableName: resource.destination_properties.TableInput.Name,
      Entries: partitionUpdateOps,
    }),
    glue.batchDeletePartition({
      DatabaseName: resource.destination_properties.DatabaseName,
      TableName: resource.destination_properties.TableInput.Name,
      PartitionsToDelete: partitionDeleteOps,
    }),
  ]);
}

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {import('../../typedefs').ResourceRecord} resource -
 * @param {import('../../typedefs').OperationRecord} operation -
 * @returns {Promise<import('../../typedefs').ActionProcessingOutput>} -
 */
async function run(event, context, resource, operation) {
  const { region } = parse(resource.resource_arn);

  const sts = new STS({ region });
  const credentials = await sts.getCredentials(resource.daemon_config.Role);
  const glue = new Glue({ region });
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
  if (!migrateTable) {
    throw new Error("Table doesn't exist");
  }
  const migrationTablePartitionKeys = migrateTable.PartitionKeys || [];
  if (migrationTablePartitionKeys.length === 0) {
    return;
  }
  const migratePartitions = await glue.getPartitions({
    DatabaseName: migrateDatabaseName,
    TableName: migrateTableName,
  });
  const existingPartitions = await glue.getPartitions({
    DatabaseName: resource.destination_properties.DatabaseName,
    TableName: resource.destination_properties.TableInput.Name,
  });

  const { bucket, prefix } = s3.parseS3Uri(
    resource.destination_properties.TableInput.StorageDescriptor.Location
  );
  const { bucket: migratedBucket, prefix: migratedPrefix } = s3.parseS3Uri(
    operation.operation_inputs.migration_resource.destination_properties
      .TableInput.StorageDescriptor.Location
  );

  await Promise.all([]);

  return {
    status: 'COMPLETED',
  };
}

module.exports = { run };
