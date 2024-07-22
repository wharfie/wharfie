'use strict';

const chalk = require('chalk');

const Reconcilable = require('../../lambdas/lib/actor/resources/reconcilable');

exports.displaySuccess = (...m) => console.log(chalk.green.bold('OK'), ...m);
exports.displayInfo = (...m) => console.log(chalk.white(...m));
exports.displayWarning = (...m) => console.warn(chalk.orange(...m));
exports.displayFailure = (...m) => console.error(chalk.red(...m));
exports.displayInstruction = (...m) => console.log(chalk.blue(...m));

/**
 *
 */
function monitorReconcilables() {
  const childMap = {};
  const progressBars = {};
  Reconcilable.Emitter.on(Reconcilable.Events.WHARFIE_STATUS, (event) => {
    const { constructor, name, status, resources } = event;
    if (resources) {
      resources.forEach((resourceKey) => {
        childMap[resourceKey] = name;
      });
    }

    const nestingPath = new Set();
    let currentName = name;

    // Prevent infinite loops by keeping track of seen names
    while (currentName && !nestingPath.has(currentName)) {
      nestingPath.add(currentName);
      currentName = childMap[currentName];
    }

    // Convert the Set to an array and reverse to get the correct order
    const pathArray = Array.from(nestingPath).reverse();

    // Populate progressBars using the path array
    let currentLevel = progressBars;
    pathArray.forEach((key, index) => {
      if (!currentLevel.resources) {
        currentLevel.resources = {};
      }
      if (!currentLevel.resources[key]) {
        currentLevel.resources[key] =
          index === pathArray.length - 1
            ? { constructor, name: key, status, resources: {} }
            : { resources: {} };
      }
      currentLevel = currentLevel.resources[key];
    });

    const progressBar = pathArray.reduce(
      (acc, key) => acc && acc.resources[key],
      progressBars
    );

    console.log(progressBar);
    // Clear the console and print the updated progressBars
    console.clear();
    console.log(JSON.stringify(progressBars, null, 2));
  });

  //   Reconcilable.Emitter.on('error', (event) => {
  //     console.clear();
  //     console.trace(event.error);
  //   });
}

exports.monitorReconcilables = monitorReconcilables;
