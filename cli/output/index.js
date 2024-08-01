'use strict';

const chalk = require('chalk');
const monitorProjectApplyReconcilables = require('./project/apply');
const monitorProjectDestroyReconcilables = require('./project/destroy');
const monitorDeploymentCreateReconcilables = require('./deployment/create');
const monitorDeploymentDestroyReconcilables = require('./deployment/destroy');
const displayValidationError = require('./validation-error');

exports.displaySuccess = (...m) => console.log(chalk.green.bold('OK'), ...m);
exports.displayInfo = (...m) => console.log(chalk.white(...m));
exports.displayWarning = (...m) => console.warn(chalk.orange(...m));
exports.displayFailure = (...m) => console.error(chalk.red(...m));
exports.displayInstruction = (...m) => console.log(chalk.blue(...m));

exports.monitorProjectApplyReconcilables = monitorProjectApplyReconcilables;
exports.monitorProjectDestroyReconcilables = monitorProjectDestroyReconcilables;
exports.monitorDeploymentCreateReconcilables =
  monitorDeploymentCreateReconcilables;
exports.monitorDeploymentDestroyReconcilables =
  monitorDeploymentDestroyReconcilables;
exports.displayValidationError = displayValidationError;
