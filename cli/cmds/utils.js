'use strict';

exports.command = 'utils';
exports.desc = 'wharfie utility commands';
exports.builder = function (yargs) {
  return yargs.commandDir('utils_cmds').demandCommand().showHelpOnFail(true);
};
exports.handler = function () {};
