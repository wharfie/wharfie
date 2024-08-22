'use strict';

const chalk = require('chalk');
const monitorProjectApplyReconcilables = require('./project/apply');
const monitorProjectDestroyReconcilables = require('./project/destroy');
const monitorDeploymentCreateReconcilables = require('./deployment/create');
const monitorDeploymentDestroyReconcilables = require('./deployment/destroy');
const { displayValidationError } = require('./error');

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

exports.monitorProjectApplyReconcilables = monitorProjectApplyReconcilables;
exports.monitorProjectDestroyReconcilables = monitorProjectDestroyReconcilables;
exports.monitorDeploymentCreateReconcilables =
  monitorDeploymentCreateReconcilables;
exports.monitorDeploymentDestroyReconcilables =
  monitorDeploymentDestroyReconcilables;
exports.displayValidationError = displayValidationError;
