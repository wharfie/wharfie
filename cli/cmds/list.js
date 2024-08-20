'use strict';
const { displayFailure, displaySuccess } = require('../output');
const { OperationActionGraph } = require('../../lambdas/lib/graph/');

const {
  getRecords,
  getAllResources,
} = require('../../lambdas/lib/dynamo/resource');

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 */
const list = async (resource_id, operation_id) => {
  if (!resource_id) {
    const resources = await getAllResources();
    console.table(
      resources.map(({ resource_id }) => ({
        resource_id,
      }))
    );
  } else if (!operation_id) {
    const records = await getRecords(resource_id);
    records.operations.sort((a, b) => b.started_at - a.started_at);
    console.table(
      records.operations.map(
        // eslint-disable-next-line no-unused-vars
        ({ operation_config, action_graph, resource_id, ...x }) => ({
          ...x,
          started_at: new Date(Number(x.started_at || 0) * 1000).toISOString(),
          last_updated_at: new Date(
            Number(x.last_updated_at || 0) * 1000
          ).toISOString(),
        })
      )
    );
  } else {
    const records = await getRecords(resource_id, operation_id);
    if (records.operations.length === 0) {
      displaySuccess(`No operation found`);
      return;
    }
    const graph = OperationActionGraph.deserialize(
      // @ts-ignore
      records.operations[0].action_graph
    );
    const actions = graph.getSequentialActionOrder();
    records.queries.sort((a, b) => {
      if (a.query_status < b.query_status) {
        return -1;
      }
      if (a.query_status > b.query_status) {
        return 1;
      }
      return 0;
    });
    console.table(
      actions.map((action) => ({
        action_id: action.id,
        action_type: action.type,
        action_status: records.actions.find((x) => x.action_id === action.id)
          ?.action_status,
      }))
    );
    console.table(
      records.queries.map((query) => ({
        query_id: query.query_id,
        query_status: query.query_status,
        query_execution_id: query.query_execution_id,
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
exports.handler = async function ({ resource_id, operation_id }) {
  try {
    await list(resource_id, operation_id);
  } catch (err) {
    displayFailure(err);
  }
};
