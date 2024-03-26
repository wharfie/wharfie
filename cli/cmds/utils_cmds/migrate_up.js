'use strict';

const {
  displayFailure,
  displayInstruction,
  displaySuccess,
} = require('../../output');
const { createId } = require('../../../lambdas/lib/id');
const { getResource } = require('../../../lambdas/lib/dynamo/resource');
const migration = require('../../../lambdas/migrations');

const migrate_up = async (resource_id) => {
  const resource = await getResource(resource_id);

  const operation_id = `cli-migration-${createId()}`;
  const event = {
    resource_id,
    operation_id,
    action_id: createId(),
    action_type: `up`,
    query_id: '',
  };

  const context = {
    awsRequestId: operation_id,
  };

  try {
    await migration.run(resource, event, context);
  } catch (e) {
    if (e.message !== 'Resource Migrated, Retry started') throw e;
    displaySuccess(`${resource_id} upgraded`);
    return;
  }
  displaySuccess(`${resource_id} already upgraded`);
};

exports.command = 'migrate-up [resource_id]';
exports.desc = 'migrated resource up';
exports.builder = (yargs) => {
  yargs.positional('resource_id', {
    type: 'string',
  });
};
exports.handler = async function ({ resource_id }) {
  if (!resource_id) {
    displayInstruction("Param 'resource_id' Missing 🙁");
    return;
  }
  try {
    await migrate_up(resource_id);
  } catch (err) {
    displayFailure(err);
  }
};
