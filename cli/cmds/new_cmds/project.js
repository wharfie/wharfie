'use strict';

exports.command = 'project <init|plan|apply|destroy|cost>';
exports.desc = 'wharfie project commands';
exports.builder = function (yargs) {
  return yargs.commandDir('project_cmds').demandCommand().showHelpOnFail(true);
};
exports.handler = function () {};
