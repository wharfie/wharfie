import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { Command } = require('commander');
const cliProgress = require('cli-progress');
const {
  displaySuccess,
  displayFailure,
  displayInfo,
} = require('../../output/basic');
const Glue = require('../../../lambdas/lib/glue').default;

const cleanupTemporaryDB = async () => {
  const DatabaseName = `${process.env.WHARFIE_DEPLOYMENT_NAME}_temporary_store`;
  const glue = new Glue({});

  displayInfo('Fetching tables...');
  const { TableList } = await glue.getTables({ DatabaseName });
  if (!TableList || TableList.length === 0) {
    throw new Error('No tables found');
  }

  const tablesToRemove = TableList.filter(
    (table) =>
      table.CreateTime &&
      table.CreateTime.getTime() < new Date().getTime() - 1000 * 60 * 60 * 24,
  );

  if (tablesToRemove.length === 0) {
    displayInfo('No stale tables to delete.');
    return;
  }

  let deleteCount = 0;
  displayInfo('Deleting stale tables...');
  const progressBar = new cliProgress.Bar(
    {},
    cliProgress.Presets.shades_classic,
  );
  progressBar.start(tablesToRemove.length, 0);

  while (tablesToRemove.length > 0) {
    const tableChunk = tablesToRemove.splice(0, 10);
    await Promise.all(
      tableChunk.map(async (table) => {
        try {
          await glue.deleteTable({
            DatabaseName,
            Name: table.Name,
          });
          deleteCount++;
        } catch (err) {
          console.log(`Ignoring delete failure: ${err}`);
        }
      }),
    );
    progressBar.update(deleteCount);
  }

  progressBar.stop();
  displaySuccess(`${deleteCount} expired tables deleted`);
};

const cleanupGlueCommand = new Command('cleanup-glue')
  .description('Remove stale temporary Glue tables')
  .action(async () => {
    try {
      await cleanupTemporaryDB();
    } catch (err) {
      displayFailure(err);
    }
  });

module.exports = cleanupGlueCommand;
