'use strict';

exports.command = 'deployment <create|upgrade|destroy|config>';
exports.desc = 'manage the wharfie service deployment';
exports.builder = function (yargs) {
  return yargs
    .commandDir('deployment_cmds')
    .demandCommand()
    .showHelpOnFail(true);
};
exports.handler = function () {};
