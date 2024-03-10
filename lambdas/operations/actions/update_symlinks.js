'use strict';
const { parse } = require('@sandfox/arn');

const { createId } = require('../../lib/id');
const logging = require('../../lib/logging');
const Glue = require('../../lib/glue');
const STS = require('../../lib/sts');
const S3 = require('../../lib/s3');
const SQS = require('../../lib/sqs');
const { Readable } = require('stream');

const resource_db = require('../../lib/dynamo/resource');

const CLEANUP_QUEUE_URL = process.env.CLEANUP_QUEUE_URL || '';

/**
 * @typedef UpdatePartitionReturn
 * @property {import("@aws-sdk/client-glue").PartitionInput[]} create -
 * @property {import("@aws-sdk/client-glue").BatchUpdatePartitionRequestEntry[]} update -
 */

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {import('../../typedefs').ResourceRecord} resource -
 * @param {import("@aws-sdk/client-glue").Table} destinationTable -
 * @param {string} temporaryDatabaseName -
 * @param {string} temporaryTableName -
 * @param {import('../../typedefs').Partition} partition -
 * @param {string[]} references -
 * @returns {Promise<UpdatePartitionReturn>} -
 */
async function update_partition(
  event,
  context,
  resource,
  destinationTable,
  temporaryDatabaseName,
  temporaryTableName,
  partition,
  references
) {
  /** @type {import("@aws-sdk/client-glue").BatchUpdatePartitionRequestEntry[]} */
  const update = [];
  /** @type {import("@aws-sdk/client-glue").PartitionInput[]} */
  const create = [];
  const event_log = logging.getEventLogger(event, context);
  if (!temporaryDatabaseName || !temporaryTableName)
    throw new Error('missing required action inputs');
  if (
    !destinationTable.StorageDescriptor ||
    !destinationTable.StorageDescriptor.Location ||
    !destinationTable.PartitionKeys
  ) {
    // If the compaction was a no-op no partition would be created
    event_log.debug(`No source table for event ${JSON.stringify(event)}`);
    return {
      update,
      create,
    };
  }

  const destinationDatabaseName = resource.destination_properties.DatabaseName;
  const destinationTableName = resource.destination_properties.TableInput.Name;

  const { region } = parse(resource.resource_arn);

  const sts = new STS({ region });
  const credentials = await sts.getCredentials(resource.daemon_config.Role);
  const glue = new Glue({ region });
  const sqs = new SQS({ region });
  const s3 = new S3({ region, credentials });

  const partitionValues = destinationTable.PartitionKeys.map(
    (partitionKey) => `${partition.partitionValues[partitionKey.Name || '']}`
  );

  event_log.debug('SWAP_TEMP_COMPACTION:GET_TEMP_PARTITION');
  const { Partition: tempPartition } = await glue.getPartition({
    DatabaseName: temporaryDatabaseName,
    TableName: temporaryTableName,
    PartitionValues: partitionValues,
  });
  if (
    !tempPartition ||
    !tempPartition.StorageDescriptor ||
    !tempPartition.StorageDescriptor.Location
  ) {
    // If the compaction was a no-op no partition would be created
    event_log.debug(`No partition to swap for event: ${JSON.stringify(event)}`);
    return {
      update,
      create,
    };
  }
  // create partition if it doesn't already exist
  const { Partition: destinationPartition } = await glue.getPartition({
    DatabaseName: destinationDatabaseName,
    TableName: destinationTableName,
    PartitionValues: partitionValues,
  });

  // calculate the current location of the live partition
  const destinationPath = `${
    destinationTable.StorageDescriptor.Location
  }${destinationTable.PartitionKeys.map(
    (key, index) => `${key.Name}=${partitionValues[index]}/`
  ).join('')}`;
  const { bucket, prefix } = s3.parseS3Uri(destinationPath);
  // build glue operations to perform
  if (!destinationPartition) {
    create.push({
      Values: partitionValues,
      StorageDescriptor: {
        ...destinationTable.StorageDescriptor,
        Location: tempPartition.StorageDescriptor.Location,
      },
      Parameters: destinationTable.Parameters,
    });
  } else {
    update.push({
      PartitionValueList: partitionValues,
      PartitionInput: {
        Values: partitionValues,
        StorageDescriptor: {
          ...destinationTable.StorageDescriptor,
          Location: tempPartition.StorageDescriptor.Location,
        },
        Parameters: destinationTable.Parameters,
      },
    });
  }

  // if there already exists a manifest make a copy and pass it to the cleanup lambda
  const manifestCopyKey = `${prefix}files-${createId()}`;
  let runCleanup = true;
  try {
    await s3.copyObjectWithMultiPartFallback({
      Bucket: bucket,
      Key: manifestCopyKey,
      CopySource: `${bucket}/${prefix}files`,
    });
  } catch (error) {
    runCleanup = false;
  }
  if (runCleanup)
    await sqs.sendMessage({
      MessageBody: JSON.stringify({
        resource_id: event.resource_id,
        operation_id: event.operation_id,
        action_id: event.action_id,
        manifest_uri: `s3://${bucket}/${manifestCopyKey}`,
      }),
      QueueUrl: CLEANUP_QUEUE_URL,
    });

  await s3.putObject({
    Bucket: bucket,
    Key: `${prefix}files`,
    Body: Readable.from([references.join('\n')]),
  });

  return {
    update,
    create,
  };
}

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {import('../../typedefs').ResourceRecord} resource -
 * @param {string} temporaryDatabaseName -
 * @param {string} temporaryTableName -
 * @param {import('../../typedefs').Partition[]} partitions -
 * @param {string} query_execution_id -
 */
async function update_partitions(
  event,
  context,
  resource,
  temporaryDatabaseName,
  temporaryTableName,
  partitions,
  query_execution_id
) {
  const event_log = logging.getEventLogger(event, context);
  const { region } = parse(resource.resource_arn);

  const sts = new STS({ region });
  const credentials = await sts.getCredentials(resource.daemon_config.Role);
  const glue = new Glue({ region });
  const s3 = new S3({ region, credentials });

  const destinationDatabaseName = resource.destination_properties.DatabaseName;
  const destinationTableName = resource.destination_properties.TableInput.Name;

  const { Table: destinationTable } = await glue.getTable({
    DatabaseName: destinationDatabaseName,
    Name: destinationTableName,
  });
  if (
    !destinationTable ||
    !destinationTable.StorageDescriptor ||
    !destinationTable.StorageDescriptor.Location ||
    !destinationTable.PartitionKeys
  ) {
    // If the compaction was a no-op no partition would be created
    event_log.debug(`No source table for event ${JSON.stringify(event)}`);
    return;
  }

  const location_segments =
    destinationTable.StorageDescriptor.Location.split('/');
  const base_location = location_segments
    .slice(0, location_segments.length - 2)
    .join('/');
  const queryManifestLocation = `${base_location}/query_metadata/${query_execution_id}-manifest.csv`;
  const { bucket: queryManifestBucket, prefix: queryManifestPrefix } =
    s3.parseS3Uri(queryManifestLocation);
  let body;
  try {
    body = await s3.getObject({
      Bucket: queryManifestBucket,
      Key: queryManifestPrefix,
    });
  } catch (error) {
    // @ts-ignore
    if (error.name === 'NoSuchKey') return;
    throw error;
  }
  const references = (body || '').toString().split('\n');

  event_log.debug(`updating symlinks for ${partitions.length} partitions`);

  const partitionUpdates = [];
  const partitionCreates = [];
  while (partitions.length > 0) {
    const partitionsChunk = partitions.splice(0, 10);
    const work = (
      await Promise.all(
        partitionsChunk.map((partition) => {
          const referencePattern = (destinationTable.PartitionKeys || [])
            .map(
              (key) =>
                `${key.Name}=${partition.partitionValues[key.Name || '']}/`
            )
            .join('');

          const partitionReferences = references.filter((reference) =>
            reference.includes(referencePattern)
          );
          return update_partition(
            event,
            context,
            resource,
            destinationTable,
            temporaryDatabaseName,
            temporaryTableName,
            partition,
            partitionReferences
          );
        })
      )
    ).reduce(
      (acc, w) => {
        acc.update.push(...w.update);
        acc.create.push(...w.create);
        return acc;
      },
      {
        update: [],
        create: [],
      }
    );
    partitionUpdates.push(...work.update);
    partitionCreates.push(...work.create);
  }

  await Promise.all([
    glue.batchCreatePartition({
      DatabaseName: destinationDatabaseName,
      TableName: destinationTableName,
      PartitionInputList: partitionCreates,
    }),
    glue.batchUpdatePartition({
      DatabaseName: destinationDatabaseName,
      TableName: destinationTableName,
      Entries: partitionUpdates,
    }),
  ]);

  // remove manifest-file
  await s3.deleteObjects({
    Bucket: queryManifestBucket,
    Delete: {
      Objects: [{ Key: queryManifestPrefix }],
    },
  });
}

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {import('../../typedefs').ResourceRecord} resource -
 * @param {string} query_execution_id -
 */
async function update_table(event, context, resource, query_execution_id) {
  const event_log = logging.getEventLogger(event, context);
  const { temporaryDatabaseName, temporaryTableName } = event.action_inputs;
  if (!temporaryDatabaseName || !temporaryTableName)
    throw new Error('missing required action inputs');

  const destinationDatabaseName = resource.destination_properties.DatabaseName;
  const destinationTableName = resource.destination_properties.TableInput.Name;

  const { region } = parse(resource.resource_arn);

  const sts = new STS({ region });
  const credentials = await sts.getCredentials(resource.daemon_config.Role);
  const glue = new Glue({ region });
  const sqs = new SQS({ region });
  const s3 = new S3({ region, credentials });

  const { Table: tempTable } = await glue.getTable({
    DatabaseName: temporaryDatabaseName,
    Name: temporaryTableName,
  });
  if (
    !tempTable ||
    !tempTable.StorageDescriptor ||
    !tempTable.StorageDescriptor.Location
  ) {
    // If the compaction was a no-op no partition would be created
    event_log.debug(
      `No temp table to swap for event: ${JSON.stringify(event)}`
    );
    return;
  }
  const { Table: table } = await glue.getTable({
    DatabaseName: destinationDatabaseName,
    Name: destinationTableName,
  });
  if (!table || !table.StorageDescriptor || !table.StorageDescriptor.Location) {
    // If the compaction was a no-op no partition would be created
    event_log.debug(
      `No destination table to swap for event: ${JSON.stringify(event)}`
    );
    return;
  }
  await glue.updateTable({
    DatabaseName: destinationDatabaseName,
    TableInput: {
      Name: destinationTableName,
      ...(table.Description && { Description: table.Description }),
      ...(table.Owner && { Owner: table.Owner }),
      ...(table.Retention && { Retention: table.Retention }),
      ...(table.PartitionKeys && { PartitionKeys: table.PartitionKeys }),
      ...(table.ViewOriginalText && {
        ViewOriginalText: table.ViewOriginalText,
      }),
      ...(table.ViewExpandedText && {
        ViewExpandedText: table.ViewExpandedText,
      }),
      ...(table.TableType && { TableType: table.TableType }),
      ...(table.Parameters && { Parameters: table.Parameters }),
      ...(table.TargetTable && { TargetTable: table.TargetTable }),
      StorageDescriptor: tempTable.StorageDescriptor,
    },
  });
  const { bucket, prefix } = s3.parseS3Uri(
    resource.destination_properties.TableInput.StorageDescriptor.Location
  );
  const { bucket: sourceBucket, prefix: sourcePrefix } = s3.parseS3Uri(
    resource.destination_properties.TableInput.StorageDescriptor.Location.replace(
      '/references/',
      '/'
    ).replace('/migrate-refrences/', '/')
  );
  const manifestCopyKey = `${prefix}files-${createId()}`;
  let runCleanup = true;
  try {
    await s3.copyObjectWithMultiPartFallback({
      Bucket: bucket,
      Key: manifestCopyKey,
      CopySource: `${bucket}/${prefix}files`,
    });
  } catch (error) {
    runCleanup = false;
  }
  if (runCleanup)
    await sqs.sendMessage({
      MessageBody: JSON.stringify({
        resource_id: event.resource_id,
        operation_id: event.operation_id,
        action_id: event.action_id,
        manifest_uri: `s3://${bucket}/${manifestCopyKey}`,
      }),
      QueueUrl: CLEANUP_QUEUE_URL,
    });

  try {
    await s3.headObject({
      Bucket: sourceBucket,
      Key: `${sourcePrefix}query_metadata/${query_execution_id}-manifest.csv`,
    });
  } catch (error) {
    // @ts-ignore
    if (error && error.name === 'NotFound') return;
    // @ts-ignore
    else if (error && error.name === 'NoSuchKey') return;
    else throw error;
  }

  await s3.copyObjectWithMultiPartFallback({
    Bucket: bucket,
    Key: `${prefix}files`,
    CopySource: `${sourceBucket}/${sourcePrefix}query_metadata/${query_execution_id}-manifest.csv`,
  });

  // remove manifest-file
  await s3.deleteObjects({
    Bucket: sourceBucket,
    Delete: {
      Objects: [
        {
          Key: `${sourcePrefix}query_metadata/${query_execution_id}-manifest.csv`,
        },
      ],
    },
  });
}

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {import('../../typedefs').ResourceRecord} resource -
 * @param {import('../../typedefs').OperationRecord} operation -
 */
async function update_symlinks(event, context, resource, operation) {
  const event_log = logging.getEventLogger(event, context);
  if (!resource || !event.action_id) {
    event_log.warn(
      'properties unexpectedly missing, maybe the resource was deleted?'
    );
    return;
  }
  const { temporaryDatabaseName, temporaryTableName } = event.action_inputs;
  if (!temporaryDatabaseName || !temporaryTableName)
    throw new Error('missing required action inputs');

  const update_symlinks_action =
    operation.action_graph.getActionByType('UPDATE_SYMLINKS');
  const compaction_action =
    operation.action_graph.getUpstreamActions(update_symlinks_action) || [];
  if (compaction_action.length === 0)
    throw new Error('could not find previous action');
  const queries = await resource_db.getQueries(
    resource.resource_id,
    operation.operation_id,
    compaction_action[0].id
  );
  event_log.info(
    `registering data and updating symlinks for ${queries.length} queries`
  );

  await Promise.all(
    queries.map((/** @type {import('../../typedefs').QueryRecord} */ query) => {
      if (!query.query_execution_id) return Promise.resolve();
      const partitions = query.query_data.partitions;
      if (!partitions) {
        event_log.debug('UPDATING TABLE');
        return update_table(event, context, resource, query.query_execution_id);
      } else {
        event_log.debug('UPDATING PARTITIONS');
        return update_partitions(
          event,
          context,
          resource,
          temporaryDatabaseName,
          temporaryTableName,
          partitions,
          query.query_execution_id
        );
      }
    })
  );
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
  const { temporaryDatabaseName, temporaryTableName } = event.action_inputs;
  if (!temporaryDatabaseName || !temporaryTableName)
    throw new Error('missing required action inputs');
  const { region } = parse(resource.resource_arn);
  const glue = new Glue({ region });

  await update_symlinks(event, context, resource, operation);

  event_log.debug('UPDATE_SYMLINKS:DELETE_TEMP_TABLE');
  await glue.deleteTable({
    DatabaseName: temporaryDatabaseName,
    Name: temporaryTableName,
  });

  return {
    status: 'COMPLETED',
  };
}

module.exports = { run };
