// const fs = require('fs');
const { Command } = require('commander');
const paths = require('../../../../paths');
// const { displayFailure } = require('../../../../../../cli/output/basic');
// const config = require('../../../../../../cli/config');
// const { checkForNewRelease } = require('../../../../../../cli/upgrade');

/**
 *
 */
async function entrypoint() {
  const argv = process.argv;
  let stdinData = '';
  if (!process.stdin.isTTY) {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      stdinData += chunk;
    });
    process.stdin.on('end', () => {
      process.env.STDIN_DATA = stdinData;
    });
  }
  process.env.CONFIG_DIR = paths.config;
  process.env.CONFIG_FILE_PATH = `${process.env.CONFIG_DIR}/wharfie.config`;
  process.env.LOGGING_FORMAT = 'cli';
  process.env.LOGGING_LEVEL = 'warn';
  const program = new Command();
  program.name('wharfie').description('CLI tool for Wharfie');
  // .version(version);ctor/resources/builds/actor-system.js

  program.addCommand(require('./functions'));
  program.addCommand(require('./infrastructure'));
  program.addCommand(require('./control'));

  program.hook('preAction', async () => {
    await paths.createWharfiePaths();
    // await paths.createWharfiePaths();
    // if (fs.existsSync(process.env.CONFIG_FILE_PATH)) {
    //   try {
    //     config.setConfig(
    //       JSON.parse(fs.readFileSync(process.env.CONFIG_FILE_PATH, 'utf8'))
    //     );
    //     config.setEnvironment();
    //   } catch (err) {
    //     const lastArgs = process.argv.slice(-2);
    //     if (!(lastArgs.includes('config') && lastArgs.includes('wharfie'))) {
    //       displayFailure('Failed to load config. Run "wharfie config" to resolve.');
    //       // eslint-disable-next-line no-process-exit
    //       process.exit(1);
    //     }
    //   }
    // }
    // try {
    //   await config.validate();
    // } catch (err) {
    //   displayFailure(err);
    //   // eslint-disable-next-line no-process-exit
    //   process.exit(1);
    // }
    // await checkForNewRelease();
  });

  // Show help if no command is provided
  if (!argv.slice(2).length) {
    await program.outputHelp();
    return;
  }
  await program.parseAsync(argv);
}
module.exports = entrypoint;
