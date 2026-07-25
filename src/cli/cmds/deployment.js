import {
  applyAwsSelectedSea,
  prepareAwsSelectedSeaPlan,
} from '../app/aws-source-deployment.js';
import {
  applyAwsPreparedStagedPlan,
  destroyAwsDeployment,
  inspectAwsDeployment,
  reconcileAwsStagedDeployment,
} from '../../core/runtime/deployment-aws-lifecycle.js';
import {
  createDeploymentCommand,
  snapshotDeploymentOperationOverrides,
} from '../../core/runtime/operator/deployment-command.js';

/**
 * Adapt the shared command selection to the source-only selected-SEA
 * authority boundary.
 * @param {Record<string, any>} input - Validated direct command selection.
 * @returns {Record<string, any>} - Exact V62 source deployment request.
 */
function createSelectedSeaRequest(input) {
  return {
    packageRequest: {
      dir: input.dir,
      ...(input.outputDir === undefined ? {} : { outputDir: input.outputDir }),
      target: input.profile.target,
    },
    deployment: input.deployment,
    profile: input.profile,
    controlPolicy: input.controlPolicy,
  };
}

/**
 * Create a fresh source deployment parent.
 * @param {{operations?: Partial<Record<'prepare'|'apply'|'applyPrepared'|'inspect'|'reconcile'|'destroy', Function>>, output?: Partial<import('../../core/runtime/operator/deployment-command.js').DeploymentCommandOutput>, processRef?: import('../../core/runtime/operator/deployment-command.js').DeploymentCommandProcess, readJsonObjectFile?: typeof import('../../core/runtime/operator/json-document-file.js').readOperatorJsonObjectFile}} [options] - Test and host seams.
 * @returns {import('commander').Command} - Source deployment command.
 */
export function createSourceDeploymentCommand(options = {}) {
  const supplied = snapshotDeploymentOperationOverrides(options.operations);
  return createDeploymentCommand({
    includeSourceOptions: true,
    operations: {
      prepare:
        supplied.prepare ??
        ((/** @type {Record<string, any>} */ input) =>
          prepareAwsSelectedSeaPlan(createSelectedSeaRequest(input))),
      apply:
        supplied.apply ??
        ((/** @type {Record<string, any>} */ input) =>
          applyAwsSelectedSea(createSelectedSeaRequest(input))),
      applyPrepared: supplied.applyPrepared ?? applyAwsPreparedStagedPlan,
      inspect: supplied.inspect ?? inspectAwsDeployment,
      reconcile: supplied.reconcile ?? reconcileAwsStagedDeployment,
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

export default createSourceDeploymentCommand;
