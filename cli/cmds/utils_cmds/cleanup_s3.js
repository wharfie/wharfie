'use strict';

const {
  displaySuccess,
  displayFailure,
  displayInfo,
  displayInstruction,
} = require('../../output');
const {
  getAllResources,
  getResource,
} = require('../../../lambdas/lib/dynamo/resource');
const Glue = require('../../../lambdas/lib/glue');
const S3 = require('../../../lambdas/lib/s3');
const Clean = require('../../../lambdas/operations/actions/lib/clean');
const glue = new Glue({});
const s3 = new S3();
const clean = new Clean({
  s3,
  glue,
});

/**
 * @param {string} resource_id -
 */
const cleanup_s3 = async (resource_id) => {
  let resources = [];
  if (resource_id) {
    const resource = await getResource(resource_id);
    if (!resource)
      throw new Error(
        `Resource with ID, ${resource_id} , does not exist in wharfie deployment, ${process.env.WHARFIE_DEPLOYMENT_NAME}`
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
/**
 * @param {import('yargs').Argv} yargs -
 */
exports.builder = (yargs) => {
  yargs.positional('resource_id', {
    type: 'string',
    describe: 'the wharfie resource id',
  });
};
/**
 * @typedef utilCleanupS3CLIParams
 * @property {string} resource_id -
 * @param {utilCleanupS3CLIParams} params -
 */
exports.handler = async function ({ resource_id }) {
  if (!resource_id) {
    displayInstruction("Param 'resource_id' Missing 🙁");
    return;
  }
  try {
    await cleanup_s3(resource_id);
  } catch (err) {
    displayFailure(err);
  }
};
