'use strict';

exports.command = 'deployment <create|upgrade|destroy|config>';
exports.desc = 'manage the wharfie service deployment';
/**
 * @param {import('yargs').Argv} yargs -
 */
exports.builder = function (yargs) {
  yargs.commandDir('./deployment_cmds').demandCommand().showHelpOnFail(true);
};
exports.handler = function () {};
