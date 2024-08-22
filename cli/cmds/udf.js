'use strict';

exports.command = 'udf <build>';
exports.desc = 'wharfie udf commands';
/**
 * @param {import('yargs').Argv} yargs -
 */
exports.builder = function (yargs) {
  yargs.commandDir('udf_cmds').demandCommand().showHelpOnFail(true);
};
exports.handler = function () {};
