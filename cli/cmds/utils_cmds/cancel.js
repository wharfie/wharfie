'use strict';

const {
  displaySuccess,
  displayFailure,
  displayInstruction,
  displayInfo,
} = require('../../output');
const {
  getRecords,
  deleteOperation,
  getAllResources,
} = require('../../../lambdas/lib/dynamo/resource');

const cancel = async (resource_id, operation_id, operation_type) => {
  const records = await getRecords(resource_id);
  let operations_to_remove = [];

  if (operation_type)
    operations_to_remove = records.operations.filter(
      (x) => x.operation_type === operation_type
    );
  else if (operation_id) {
    operations_to_remove = records.operations.filter(
      (x) => x.operation_id === operation_id
    );
  } else {
    operations_to_remove = records.operations;
  }
  const operations_to_remove_count = operations_to_remove.length;
  while (operations_to_remove.length > 0) {
    const operationChunk = operations_to_remove.splice(0, 10);
    await Promise.all(
      operationChunk.map((operation) =>
        deleteOperation(operation.resource_id, operation.operation_id)
      )
    );
  }
  displaySuccess(`${operations_to_remove_count} operations cancelled`);
};

const cancel_all = async (operation_type) => {
  const resources = await getAllResources();
  displayInfo(`cancelling operations for ${resources.length} resources`);
  while (resources.length > 0) {
    const resource_chunk = resources.splice(0, 10);
    await Promise.all(
      resource_chunk.map((resource) => {
        displayInfo(`cancelling: ${resource.resource_id}`);
        return cancel(
          resource.resource_id,
          undefined,
          operation_type,
          undefined
        );
      })
    );
  }
};

exports.command = 'cancel [resource_id] [operation_id]';
exports.builder = (yargs) => {
  yargs
    .positional('resource_id', {
      type: 'string',
      describe: 'wharfie resource id',
      demand: 'Please provide a resource id',
    })
    .positional('operation_id', {
      type: 'string',
      describe: 'operation id',
    })
    .option('type', {
      type: 'string',
      describe: 'operation type',
      choices: ['MAINTAIN', 'BACKFILL'],
    })
    .option('all', {
      alias: 'a',
      type: 'boolean',
      describe: 'DANGER! runs cancel for all wharfie resources',
    });
};
exports.desc = 'cancel running operations';
exports.handler = async function ({ resource_id, operation_id, type, all }) {
  if (!resource_id && !all) {
    displayInstruction("Param 'resource_id' Missing 🙁");
    return;
  }
  if (type && operation_id) {
    displayInstruction('cannot accept both type and operation_id');
    return;
  }
  try {
    if (all) {
      await cancel_all(type);
    } else {
      await cancel(resource_id, operation_id, type, all);
    }
  } catch (err) {
    displayFailure(err);
  }
};
