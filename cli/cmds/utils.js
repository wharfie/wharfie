'use strict';

exports.command = 'utils';
exports.desc = 'wharfie utility commands';
/**
 * @param {import('yargs').Argv} yargs -
 */
exports.builder = function (yargs) {
  yargs.commandDir('utils_cmds').demandCommand().showHelpOnFail(true);
};
exports.handler = function () {};
