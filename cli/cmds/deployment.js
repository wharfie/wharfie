'use strict';

exports.command = 'deployment <create|upgrade|delete>';
exports.desc = 'manage the wharfie service deployment';
exports.builder = function (yargs) {
  return yargs
    .commandDir('deployment_cmds')
    .demandCommand()
    .showHelpOnFail(true);
};
exports.handler = function () {};
