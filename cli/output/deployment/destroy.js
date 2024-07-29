const chalk = require('chalk');
const cliProgress = require('cli-progress');

const Reconcilable = require('../../../lambdas/lib/actor/resources/reconcilable');
const BaseResourceGroup = require('../../../lambdas/lib/actor/resources/base-resource-group');

/**
 *
 * @param {Reconcilable.StatusEnum} status -
 * @returns {number} -
 */
function statusToProgressReconcile(status) {
  switch (status) {
    case Reconcilable.Status.DESTROYED:
      return 100;
    case Reconcilable.Status.DESTROYING:
      return 50;
    case Reconcilable.Status.STABLE:
    case Reconcilable.Status.DRIFTED:
    case Reconcilable.Status.RECONCILING:
    case Reconcilable.Status.UNPROVISIONED:
      return 0;
    default:
      return 0;
  }
}
/**
 *
 * @param {BaseResourceGroup} group -
 * @param {Map<string,cliProgress.Bar>} barmap -
 * @param {cliProgress.MultiBar} multibar -
 * @param {cliProgress.Bar} [parentBar] -
 */
function traverseResourceGroup(group, barmap, multibar, parentBar = null) {
  if (!barmap.has(group.name)) {
    const bar = multibar.create(group.children, 0, {
      type: group.constructor.name,
      name: group.name,
      status: group.status,
    });
    barmap.set(group.name, bar);
  }
  const bar = barmap.get(group.name);
  let totalProgress = statusToProgressReconcile(group.status);

  for (const resource of Object.values(group.resources)) {
    if (resource instanceof BaseResourceGroup) {
      traverseResourceGroup(resource, barmap, multibar, bar);
      totalProgress += statusToProgressReconcile(resource.status);
    } else {
      // if (!barmap.has(resource.name)) {
      //   const resBar = multibar.create(100, 0, {
      //     type: group.constructor.name,
      //     name: resource.name,
      //     status: resource.status,
      //   });
      //   barmap.set(resource.name, resBar);
      // }
      // const resBar = barmap.get(resource.name);
      // resBar.update(statusToProgressReconcile(resource.status), {
      //   status: resource.status,
      // });
      totalProgress += statusToProgressReconcile(resource.status);
    }
  }

  const childrenCount = Object.keys(group.resources).length;
  totalProgress =
    childrenCount > 0 ? totalProgress / (childrenCount + 1) : totalProgress;
  bar.update(totalProgress, { status: group.status });
}

/**
 * @param {BaseResourceGroup} root -
 * @returns {cliProgress.MultiBar} -
 */
function monitorDeploymentDestroyReconcilables(root) {
  const barmap = new Map();
  const multibar = new cliProgress.MultiBar(
    {
      format:
        '{type}::{name} |' + chalk.cyan('{bar}') + '| {percentage}% | {status}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
      clearOnComplete: true,
      stopOnComplete: true,
    },
    cliProgress.Presets.shades_grey
  );

  Reconcilable.Emitter.on(Reconcilable.Events.WHARFIE_STATUS, (event) => {
    traverseResourceGroup(root, barmap, multibar);
  });
  return multibar;
}

module.exports = monitorDeploymentDestroyReconcilables;
