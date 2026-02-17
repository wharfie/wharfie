import { Command } from 'commander';
import Function from '../../function.js';

/**
 * @param {string} functionName - functionName.
 * @param {any} message - message.
 */
async function run(functionName, message) {
  console.log(`running function ${functionName}`);
  await Function.run(functionName, message, { context: 'foo' });
  console.log(`function ${functionName} completed`);
}

const runCommand = new Command('run')
  .argument('[function_name]', 'Name of the function to run')
  .argument('[message]', 'message to process')
  .description('run provided funcion')
  .action(async (function_name, message) => {
    await run(function_name, message);
  });

export default runCommand;
