'use strict';
const { displayFailure, displaySuccess } = require('../output/basic');

const {
  getRecords,
  getAllResources,
} = require('../../lambdas/lib/dynamo/operations');

/**
 * @param {string} [resource_id] -
 * @param {string} [operation_id] -
 */
const list = async (resource_id, operation_id) => {
  if (!resource_id) {
    const resources = await getAllResources();
    console.table(
      resources.map(({ id }) => ({
        resource_id: id,
      }))
    );
  } else if (!operation_id) {
    const records = await getRecords(resource_id);
    records.operations.sort((a, b) => b.started_at - a.started_at);
    console.table(
      records.operations.map(({ operation_config, resource_id, ...x }) => ({
        ...x,
        started_at: new Date(Number(x.started_at || 0) * 1000).toISOString(),
        last_updated_at: new Date(
          Number(x.last_updated_at || 0) * 1000
        ).toISOString(),
      }))
    );
  } else {
    const records = await getRecords(resource_id, operation_id);
    if (records.operations.length === 0) {
      displaySuccess(`No operation found`);
      return;
    }
    const actions = records.operations[0].getSequentialActionOrder();
    records.queries.sort((a, b) => {
      if (a.status < b.status) {
        return -1;
      }
      if (a.status > b.status) {
        return 1;
      }
      return 0;
    });
    console.table(
      actions.map((action) => ({
        action_id: action.id,
        action_type: action.type,
        action_status: action.status,
      }))
    );
    console.table(
      records.queries.map((query) => ({
        query_id: query.id,
        query_status: query.status,
        query_execution_id: query.execution_id,
      }))
    );
  }
};

exports.command = [
  'list [resource_id] [operation_id]',
  'ls [resource_id] [operation_id]',
];
exports.desc = 'list wharfie records';
/**
 * @param {import('yargs').Argv} yargs -
 */
exports.builder = (yargs) => {
  yargs
    .positional('resource_id', {
      type: 'string',
      describe: 'the wharfie resource id',
      optional: true,
    })
    .positional('operation_id', {
      type: 'string',
      describe: 'the wharfie operation id',
      optional: true,
    });
};
/**
 * @typedef listCLIParams
 * @property {string} [resource_id] -
 * @property {string} [operation_id] -
 * @param {listCLIParams} params -
 */
exports.handler = async function ({ resource_id, operation_id }) {
  try {
    await list(resource_id, operation_id);
  } catch (err) {
    console.trace(err);
    displayFailure(err);
  }
};
