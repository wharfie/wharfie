'use strict';

exports.command = 'project <init|plan|apply|destroy|cost>';
exports.desc = 'wharfie project commands';
/**
 * @param {import('yargs').Argv} yargs -
 */
exports.builder = function (yargs) {
  yargs.commandDir('project_cmds').demandCommand().showHelpOnFail(true);
};
exports.handler = function () {};
