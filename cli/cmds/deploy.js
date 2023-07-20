'use strict';

exports.command = 'deploy <create|update|delete>';
exports.desc = 'deploy wharfie';
exports.builder = function (yargs) {
  return yargs.commandDir('deploy_cmds');
};
exports.handler = function () {};
