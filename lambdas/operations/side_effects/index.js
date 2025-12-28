import cloudwatch from './cloudwatch.js';
import wharfie from './wharfie.js';
import dagster from './dagster.js';
import { Operation, Resource, Action } from '../../lib/graph/index.js';

/**
 * @param {import('../../typedefs.js').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {Resource} resource -
 * @param {Operation} operation -
 * @returns {Promise<import('../../typedefs.js').ActionProcessingOutput>} -
 */
async function finish(event, context, resource, operation) {
  return {
    status: 'COMPLETED',
  };
}

/**
 * @param {import('../../typedefs.js').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {Resource} resource -
 * @param {Operation} operation -
 * @returns {Promise<import('../../typedefs.js').ActionProcessingOutput>} -
 */
async function defineSideEffects(event, context, resource, operation) {
  const finish_id = operation.getActionIdByType(Action.Type.FINISH);
  const finish_action = operation.getAction(finish_id);
  let side_effect_finish_id;
  const side_effects = [];

  side_effects.push(
    operation.createAction({
      type: Action.Type.SIDE_EFFECT__WHARFIE,
      dependsOn: [finish_action],
    }),
  );

  // resource.side_effects.map(side_effect => {
  //   side_effects.push(operation.createAction({
  //     type:
  //   }))
  // })

  try {
    side_effect_finish_id = operation.getActionIdByType(
      Action.Type.SIDE_EFFECTS__FINISH,
    );
  } catch (err) {
    operation.createAction({
      type: Action.Type.SIDE_EFFECTS__FINISH,
      dependsOn: side_effects,
    });
  }
  if (side_effect_finish_id) throw new Error('cannot redefine side effects');

  return {
    status: 'COMPLETED',
  };
}

/**
 * @param {import('../../typedefs.js').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {Resource} resource -
 * @param {Operation} operation -
 * @returns {Promise<import('../../typedefs.js').ActionProcessingOutput>} -
 */
async function routeCustomSideEffect(event, context, resource, operation) {
  return {
    status: 'COMPLETED',
  };
}

export {
  cloudwatch,
  wharfie,
  dagster,
  finish,
  defineSideEffects,
  routeCustomSideEffect,
};
