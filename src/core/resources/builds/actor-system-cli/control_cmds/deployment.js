import {
  applyAwsPreparedRunningSeaPlan,
  applyAwsRunningSea,
  destroyAwsDeployment,
  inspectAwsDeployment,
  prepareAwsRunningSeaPlan,
  reconcileAwsRunningSeaDeployment,
} from '../../../../runtime/deployment-aws-lifecycle.js';
import {
  createDeploymentCommand,
  snapshotDeploymentOperationOverrides,
} from '../../../../runtime/operator/deployment-command.js';

/**
 * Create a fresh deployment parent for the SEA's reserved operator namespace.
 * This adapter has no source directory or arbitrary artifact path: ordinary
 * converge must prove the exact executable running this command.
 * @param {{operations?: Partial<Record<'prepare'|'apply'|'applyPrepared'|'inspect'|'reconcile'|'destroy', Function>>, output?: Partial<import('../../../../runtime/operator/deployment-command.js').DeploymentCommandOutput>, processRef?: import('../../../../runtime/operator/deployment-command.js').DeploymentCommandProcess, readJsonObjectFile?: typeof import('../../../../runtime/operator/json-document-file.js').readOperatorJsonObjectFile}} [options] - Test and host seams.
 * @returns {import('commander').Command} - Packaged deployment command.
 */
export function createPackagedDeploymentCommand(options = {}) {
  const supplied = snapshotDeploymentOperationOverrides(options.operations);
  return createDeploymentCommand({
    operations: {
      prepare: supplied.prepare ?? prepareAwsRunningSeaPlan,
      apply: supplied.apply ?? applyAwsRunningSea,
      applyPrepared: supplied.applyPrepared ?? applyAwsPreparedRunningSeaPlan,
      inspect: supplied.inspect ?? inspectAwsDeployment,
      reconcile: supplied.reconcile ?? reconcileAwsRunningSeaDeployment,
      destroy: supplied.destroy ?? destroyAwsDeployment,
    },
    ...(options.output === undefined ? {} : { output: options.output }),
    ...(options.processRef === undefined
      ? {}
      : { processRef: options.processRef }),
    ...(options.readJsonObjectFile === undefined
      ? {}
      : { readJsonObjectFile: options.readJsonObjectFile }),
  });
}

export default createPackagedDeploymentCommand;
