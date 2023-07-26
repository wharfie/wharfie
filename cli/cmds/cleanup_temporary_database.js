'use strict';

const cliProgress = require('cli-progress');
const progressBar = new cliProgress.Bar();

const { displaySuccess, displayFailure, displayInfo } = require('../output');
const Glue = require('../../lambdas/lib/glue');

const cleanupTemporaryDB = async () => {
  const DatabaseName = `${process.env.WHARFIE_DEPLOYMENT_NAME}_temporary_store`;
  const glue = new Glue();
  displayInfo('fetching tables...');
  const { TableList } = await glue.getTables({
    DatabaseName,
  });

  const tables_to_remove = TableList.filter(
    (table) => table.CreateTime < new Date().getTime() - 1000 * 60 * 60 * 24
  );
  let delete_count = 0;
  displayInfo('deleting stale tables...');
  progressBar.start(tables_to_remove.length, 0);
  while (tables_to_remove.length > 0) {
    const tableChunk = tables_to_remove.splice(0, 10);
    await Promise.all(
      tableChunk.map(async (table) => {
        delete_count = delete_count + 1;
        try {
          await glue.deleteTable({
            DatabaseName,
            Name: table.Name,
          });
        } catch (e) {
          console.log(`ignoring delete failure ${e}`);
        }
      })
    );
    progressBar.update(delete_count);
  }
  progressBar.stop();
  displaySuccess(`${delete_count} expired tables deleted`);
};

exports.command = 'cleanup-glue';
exports.desc = 'remove stale temporary glue tables';
exports.handler = async function () {
  try {
    await cleanupTemporaryDB();
  } catch (err) {
    displayFailure(err);
  }
};
