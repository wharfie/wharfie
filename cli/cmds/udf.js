'use strict';

exports.command = 'udf <build>';
exports.desc = 'wharfie udf commands';
exports.builder = function (yargs) {
  return yargs.commandDir('udf_cmds').demandCommand().showHelpOnFail(true);
};
exports.handler = function () {};
