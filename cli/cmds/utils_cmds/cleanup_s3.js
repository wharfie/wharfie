import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { Command } = require('commander');
const {
  displaySuccess,
  displayFailure,
  displayInfo,
  displayInstruction,
} = require('../../output/basic');
const { getAllResources, getResource } =
  require('../../../lambdas/lib/dynamo/operations').default;
const Glue = require('../../../lambdas/lib/glue').default;
const S3 = require('../../../lambdas/lib/s3').default;
const Clean = require('../../../lambdas/operations/actions/lib/clean');

const glue = new Glue({});
const s3 = new S3();
const clean = new Clean({ s3, glue });

/**
 * Cleans up stale S3 data for a specific resource or all resources.
 * @param {string} [resource_id] - The ID of the resource to clean up.
 */
const cleanupS3 = async (resource_id) => {
  let resources = [];

  if (resource_id) {
    const resource = await getResource(resource_id);
    if (!resource) {
      throw new Error(
        `Resource with ID "${resource_id}" does not exist in Wharfie deployment "${process.env.WHARFIE_DEPLOYMENT_NAME}".`,
      );
    }
    resources = [resource];
  } else {
    resources = await getAllResources();
  }

  displayInfo(`Cleaning S3 for ${resources.length} resource(s)...`);

  await Promise.all(resources.map((r) => clean.cleanAll(r)));

  displaySuccess('S3 cleanup successful');
};

const cleanupS3Command = new Command('cleanup-s3')
  .description('Remove stale S3 data')
  .argument('[resource_id]', 'The Wharfie resource ID')
  .action(async (resource_id) => {
    if (!resource_id) {
      displayInstruction("Param 'resource_id' Missing 🙁");
      return;
    }
    try {
      await cleanupS3(resource_id);
    } catch (err) {
      displayFailure(err);
    }
  });

module.exports = cleanupS3Command;
