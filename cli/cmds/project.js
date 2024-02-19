'use strict';

exports.command = 'project <plan|apply|destroy>';
exports.desc = 'wharfie project commands';
exports.builder = function (yargs) {
  return yargs.commandDir('project_cmds').demandCommand().showHelpOnFail(true);
};
exports.handler = function () {};