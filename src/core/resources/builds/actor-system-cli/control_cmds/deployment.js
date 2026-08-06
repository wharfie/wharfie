import {
  applyAwsPreparedRunningSeaPlan,
  applyAwsRunningSea,
  destroyAwsDeployment,
  inspectAwsDeployment,
  prepareAwsRunningSeaPlan,
  reconcileAwsRunningSeaDeployment,
} from '../../../../runtime/deployment-aws-lifecycle.js';
import { requireAwsProvider } from '../../../../runtime/aws-provider-module.js';
import {
  createDeploymentCommand,
  snapshotDeploymentOperationOverrides,
} from '../../../../runtime/operator/deployment-command.js';

/**
 * Require the fixed provider before a packaged AWS operation can mutate state.
 * @param {Function} operation - Existing operation implementation.
 * @returns {(input: Record<string, any>) => Promise<any>} - Guarded operation.
 */
function withAwsProvider(operation) {
  return async (input) => {
    await requireAwsProvider();
    return operation(input);
  };
}

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
      prepare: supplied.prepare ?? withAwsProvider(prepareAwsRunningSeaPlan),
      apply: supplied.apply ?? withAwsProvider(applyAwsRunningSea),
      applyPrepared:
        supplied.applyPrepared ??
        withAwsProvider(applyAwsPreparedRunningSeaPlan),
      inspect: supplied.inspect ?? withAwsProvider(inspectAwsDeployment),
      reconcile:
        supplied.reconcile ?? withAwsProvider(reconcileAwsRunningSeaDeployment),
      destroy: supplied.destroy ?? withAwsProvider(destroyAwsDeployment),
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
