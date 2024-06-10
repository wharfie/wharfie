'use strict';

const logging = require('../../lib/logging');
const Glue = require('../../lib/glue');
const STS = require('../../lib/sts');
const S3 = require('../../lib/s3');

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {import('../../typedefs').ResourceRecord} resource -
 * @param {Glue} glue -
 * @param {S3} s3 -
 * @param {import("@aws-sdk/client-glue").Table} migrateTable -
 * @param {import("@aws-sdk/client-glue").Table} destinationtable -
 */
async function swap_partitions(
  event,
  context,
  resource,
  glue,
  s3,
  migrateTable,
  destinationtable
) {
  const event_log = logging.getEventLogger(event, context);
  event_log.info("MIGRATE_SWAP_RESOURCE: updating table's partitions");
  const migrationTablePartitionKeys = migrateTable.PartitionKeys || [];
  const migratePartitions = await glue.getPartitions({
    DatabaseName: migrateTable.DatabaseName,
    TableName: migrateTable.Name,
  });
  event_log.info(`migration table: ${JSON.stringify(migrateTable)}`);
  event_log.info(`existing table: ${JSON.stringify(destinationtable)}`);
  event_log.info(`migration partitions: ${migratePartitions.length}`);
  const existingPartitions = await glue.getPartitions({
    DatabaseName: resource.destination_properties.databaseName,
    TableName: resource.destination_properties.name,
  });
  event_log.info(`existing partitions: ${existingPartitions.length}`);
  if (!destinationtable?.StorageDescriptor?.Location)
    throw new Error('Table has no storage location');
  const { bucket: destinationBucket, prefix: destinationPrefix } =
    s3.parseS3Uri(destinationtable.StorageDescriptor.Location);

  /** @type {import("@aws-sdk/client-glue").PartitionInput[]} */
  const partitionCreateOps = [];
  /** @type {import("@aws-sdk/client-s3").CopyObjectCommandInput[]} */
  const partitionCreateReferenceOps = [];
  /** @type {import("@aws-sdk/client-glue").BatchUpdatePartitionRequestEntry[]} */
  const partitionUpdateOps = [];
  /** @type {import("@aws-sdk/client-s3").CopyObjectCommandInput[]} */
  const partitionUpdateReferenceOps = [];
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
      partitionUpdateReferenceOps.push({
        CopySource: `${migrateTable.StorageDescriptor?.Location}${partitionLookup}/files`,
        Bucket: destinationBucket,
        Key: `${destinationPrefix}${partitionLookup}/files`,
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
      partitionUpdateReferenceOps.push({
        CopySource: `${migrateTable.StorageDescriptor?.Location}${partitionLookup}/files`,
        Bucket: destinationBucket,
        Key: `${destinationPrefix}${partitionLookup}/files`,
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
  /** @type {import("@aws-sdk/client-s3").ObjectIdentifier[]} */
  const partitionDeleteObjects = Object.values(existingPartitionsLookup).map(
    (p) => {
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
      return {
        Key: `${migrateTable.StorageDescriptor?.Location}${partitionLookup}/files`,
      };
    }
  );

  event_log.info(
    `MIGRATE_SWAP_RESOURCE: creating ${partitionCreateOps.length} partitions`
  );

  event_log.info(
    `MIGRATE_SWAP_RESOURCE: updating ${partitionUpdateOps.length} partitions`
  );

  event_log.info(
    `MIGRATE_SWAP_RESOURCE: deleting ${partitionDeleteOps.length} partitions`
  );

  await Promise.all([
    glue.batchCreatePartition({
      DatabaseName: resource.destination_properties.databaseName,
      TableName: resource.destination_properties.name,
      PartitionInputList: partitionCreateOps,
    }),
    glue.batchUpdatePartition({
      DatabaseName: resource.destination_properties.databaseName,
      TableName: resource.destination_properties.name,
      Entries: partitionUpdateOps,
    }),
    glue.batchDeletePartition({
      DatabaseName: resource.destination_properties.databaseName,
      TableName: resource.destination_properties.name,
      PartitionsToDelete: partitionDeleteOps,
    }),
  ]);

  await Promise.all([
    s3.copyObjectsWithMultiPartFallback(partitionUpdateReferenceOps),
    s3.copyObjectsWithMultiPartFallback(partitionCreateReferenceOps),
    s3.deleteObjects({
      Bucket: destinationBucket,
      Delete: {
        Objects: partitionDeleteObjects,
      },
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
  const event_log = logging.getEventLogger(event, context);
  const region = resource.region;

  const sts = new STS({ region });
  const credentials = await sts.getCredentials(resource.daemon_config.Role);
  const glue = new Glue({ region });
  const s3 = new S3({ region, credentials });

  const destinationDatabaseName = resource.destination_properties.databaseName;
  const destinationTableName = resource.destination_properties.name;

  const migrateDatabaseName =
    operation.operation_inputs.migration_resource.destination_properties
      .databaseName;
  const migrateTableName =
    operation.operation_inputs.migration_resource.destination_properties.name;

  const { Table: migrateTable } = await glue.getTable({
    DatabaseName: migrateDatabaseName,
    Name: migrateTableName,
  });
  if (!migrateTable) {
    throw new Error("Table doesn't exist");
  }
  const { Table: destinationTable } = await glue.getTable({
    DatabaseName: destinationDatabaseName,
    Name: destinationTableName,
  });
  if (!destinationTable) {
    throw new Error("Table doesn't exist");
  }

  const migrationTablePartitionKeys = migrateTable.PartitionKeys || [];
  if (migrationTablePartitionKeys.length > 0) {
    await swap_partitions(
      event,
      context,
      resource,
      glue,
      s3,
      migrateTable,
      destinationTable
    );
  }
  event_log.info("MIGRATE_SWAP_RESOURCE: updating table's location");
  await glue.updateTable({
    DatabaseName: destinationDatabaseName,
    TableInput: {
      Name: destinationTableName,
      ...(migrateTable.Description && {
        Description: migrateTable.Description,
      }),
      ...(migrateTable.Owner && { Owner: migrateTable.Owner }),
      ...(migrateTable.Retention && { Retention: migrateTable.Retention }),
      ...(migrateTable.PartitionKeys && {
        PartitionKeys: migrateTable.PartitionKeys,
      }),
      ...(migrateTable.ViewOriginalText && {
        ViewOriginalText: migrateTable.ViewOriginalText,
      }),
      ...(migrateTable.ViewExpandedText && {
        ViewExpandedText: migrateTable.ViewExpandedText,
      }),
      ...(migrateTable.TableType && { TableType: migrateTable.TableType }),
      ...(migrateTable.Parameters && { Parameters: migrateTable.Parameters }),
      ...(migrateTable.TargetTable && {
        TargetTable: migrateTable.TargetTable,
      }),
      StorageDescriptor: migrateTable.StorageDescriptor,
    },
  });

  return {
    status: 'COMPLETED',
  };
}

module.exports = { run };
