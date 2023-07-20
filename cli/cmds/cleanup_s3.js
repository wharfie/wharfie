'use strict';

const {
  displaySuccess,
  displayFailure,
  displayInfo,
  displayInstruction,
} = require('../output');
const config = require('../config');
const { region, deployment_name } = config.getConfig();
process.env.AWS_REGION = region;
process.env.RESOURCE_TABLE = deployment_name;
const {
  getAllResources,
  getResource,
} = require('../../lambdas/lib/dynamo/resource');
const Glue = require('../../lambdas/lib/glue');
const S3 = require('../../lambdas/lib/s3');
const Clean = require('../../lambdas/operations/actions/lib/clean');
const glue = new Glue({
  region,
});
const s3 = new S3({
  region,
});
const clean = new Clean({
  s3,
  glue,
});

const cleanup_s3 = async (resource_id) => {
  let resources = [];
  if (resource_id) {
    const resource = await getResource(resource_id);
    if (!resource)
      throw new Error(
        `Resource with ID, ${resource_id} , does not exist in wharfie deployment, ${deployment_name}`
      );
    resources = [resource];
  } else {
    resources = await getAllResources();
  }
  displayInfo(`cleaning s3 for ${resources.length} resources`);

  await Promise.all(resources.map((r) => clean.cleanAll(r)));

  displaySuccess(`s3 cleanup successful`);
};

exports.command = 'cleanup-s3 [resource_id]';
exports.desc = 'remove stale s3 data';
exports.builder = (yargs) => {
  yargs
    .positional('resource_id', {
      type: 'string',
      describe: 'the wharfie resource id',
    })
    .option('all', {
      alias: 'a',
      type: 'boolean',
      describe: 'DANGER! runs cleanup-s3 on all wharfie resources',
    });
};
exports.handler = async function ({ resource_id, all }) {
  if (!resource_id && !all) {
    displayInstruction("Param 'resource_id' Missing 🙁");
    return;
  }
  try {
    await cleanup_s3(resource_id);
  } catch (err) {
    displayFailure(err);
  }
};
