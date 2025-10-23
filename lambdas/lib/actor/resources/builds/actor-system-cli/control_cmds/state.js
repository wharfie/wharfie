'use strict';

const { Command } = require('commander');

const stateCommand = new Command('state')
  .description('<<>>')
  .action(async () => {
    console.log('hello from state command');
  });

module.exports = stateCommand;
