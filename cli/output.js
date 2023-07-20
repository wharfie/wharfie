'use strict';

const chalk = require('chalk');

exports.displaySuccess = (...m) => console.log(chalk.green.bold('OK'), ...m);
exports.displayInfo = (...m) => console.log(chalk.grey(...m));
exports.displayWarning = (...m) => console.warn(chalk.orange(...m));
exports.displayFailure = (...m) => console.error(chalk.red(...m));
exports.displayInstruction = (...m) => console.log(chalk.yellow(...m));
