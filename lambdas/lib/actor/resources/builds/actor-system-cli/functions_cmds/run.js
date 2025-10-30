'use strict';

const { Command } = require('commander');
const Function = require('../../function');

/**
 * @param {string} functionName
 * @param {any} message
 */
async function run(functionName, message) {
  console.log(`running function ${functionName}`);
  Function.run(functionName, message, { context: 'foo' });
  console.log(`function ${functionName} completed`);
}

const runCommand = new Command('run')
  .argument('[function_name]', 'Name of the function to run')
  .argument('[message]', 'message to process')
  .description('run provided funcion')
  .action(async (function_name, message) => {
    await run(function_name, message);
    console.log('hello from run command');
  });

module.exports = runCommand;
