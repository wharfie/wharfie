'use strict';

exports.command = 'new <deployment|project>';
exports.desc = 'new';
exports.builder = function (yargs) {
  return yargs.commandDir('new_cmds').demandCommand().showHelpOnFail(true);
};
exports.handler = function () {};
