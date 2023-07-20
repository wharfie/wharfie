'use strict';

exports.command = 'udf <build>';
exports.desc = 'udf commands';
exports.builder = function (yargs) {
  return yargs.commandDir('udf_cmds');
};
exports.handler = function () {};
