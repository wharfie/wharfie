const chalk = require('chalk');
exports.displaySuccess = (/** @type {any} */ ...m) =>
  console.log(chalk.green.bold('OK'), ...m);
exports.displayInfo = (/** @type {any} */ ...m) =>
  console.log(chalk.white(...m));
exports.displayWarning = (/** @type {any} */ ...m) =>
  console.warn(chalk.yellow(...m));
exports.displayFailure = (/** @type {any} */ ...m) =>
  console.error(chalk.red(...m));
exports.displayInstruction = (/** @type {any} */ ...m) =>
  console.log(chalk.blue(...m));
