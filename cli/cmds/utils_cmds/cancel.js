'use strict';

const {
  displaySuccess,
  displayFailure,
  displayInstruction,
  displayInfo,
} = require('../../output/basic');
const {
  getRecords,
  deleteOperation,
  getAllResources,
} = require('../../../lambdas/lib/dynamo/operations');

/**
 * @param {string} resource_id -
 * @param {string} [operation_id] -
 * @param {string} [operation_type] -
 */
const cancel = async (resource_id, operation_id, operation_type) => {
  const records = await getRecords(resource_id);
  let operations_to_remove = [];

  if (operation_type)
    operations_to_remove = records.operations.filter(
      // @ts-ignore
      (x) => x.operation_type === operation_type
    );
  else if (operation_id) {
    operations_to_remove = records.operations.filter(
      // @ts-ignore
      (x) => x.operation_id === operation_id
    );
  } else {
    operations_to_remove = records.operations;
  }
  const operations_to_remove_count = operations_to_remove.length;
  while (operations_to_remove.length > 0) {
    const operationChunk = operations_to_remove.splice(0, 10);
    await Promise.all(
      // @ts-ignore
      operationChunk.map((operation) => deleteOperation(operation))
    );
  }
  displaySuccess(`${operations_to_remove_count} operations cancelled`);
};

/**
 * @param {string} operation_type -
 */
const cancel_all = async (operation_type) => {
  const resources = await getAllResources();
  displayInfo(`cancelling operations for ${resources.length} resources`);
  while (resources.length > 0) {
    const resource_chunk = resources.splice(0, 10);
    await Promise.all(
      resource_chunk.map((resource) => {
        displayInfo(`cancelling: ${resource.id}`);
        return cancel(resource.id, undefined, operation_type);
      })
    );
  }
};

exports.command = 'cancel [resource_id] [operation_id]';
/**
 * @param {import('yargs').Argv} yargs -
 */
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
      choices: ['LOAD', 'BACKFILL', 'MIGRATE'],
    })
    .option('all', {
      alias: 'a',
      type: 'boolean',
      describe: 'DANGER! runs cancel for all wharfie resources',
    });
};
exports.desc = 'cancel running operations';
/**
 * @typedef utilCancelCLIParams
 * @property {string} resource_id -
 * @property {string} operation_id -
 * @property {string} type -
 * @property {boolean} all -
 * @param {utilCancelCLIParams} params -
 */
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
      await cancel(resource_id, operation_id, type);
    }
  } catch (err) {
    displayFailure(err);
  }
};
