'use strict';

exports.command = 'examples <create|update|delete>';
exports.desc = 'manage wharfie examples';
exports.builder = function (yargs) {
  return yargs.commandDir('example_cmds');
};
exports.handler = function () {};
