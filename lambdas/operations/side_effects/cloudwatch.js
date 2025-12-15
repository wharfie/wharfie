import { Operation, Resource } from '../../lib/graph/index.js';

import CloudWatch from '../../lib/cloudwatch.js';
const cloudwatchClient = new CloudWatch({
  region: process.env.AWS_REGION,
});
const STACK_NAME = process.env.STACK_NAME || '';

/**
 * @param {import('../../typedefs.js').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {Resource} resource -
 * @param {Operation} operation -
 * @returns {Promise<import('../../typedefs.js').ActionProcessingOutput>} -
 */
async function cloudwatch(event, context, resource, operation) {
  const { completed_at } = event.action_inputs;
  if (!completed_at)
    throw new Error(
      'missing required action inputs for cloudwatch side effect'
    );

  await cloudwatchClient.putMetricData({
    MetricData: [
      {
        MetricName: `operations`,
        Dimensions: [
          {
            Name: 'stack',
            Value: STACK_NAME,
          },
          {
            Name: 'resource',
            Value: resource.id,
          },
          {
            Name: 'operation_type',
            Value: operation.type,
          },
        ],
        Unit: 'Seconds',
        Value: completed_at - operation.started_at,
      },
      // summable metrics
      {
        MetricName: 'operations',
        Dimensions: [
          {
            Name: 'stack',
            Value: STACK_NAME,
          },
          {
            Name: 'operation_type',
            Value: operation.type,
          },
        ],
        Unit: 'Count',
        Value: 1,
      },
      {
        MetricName: 'operations',
        Dimensions: [
          {
            Name: 'stack',
            Value: STACK_NAME,
          },
        ],
        Unit: 'Count',
        Value: 1,
      },
    ],
    Namespace: 'Wharfie',
  });

  return {
    status: 'COMPLETED',
  };
}

export default cloudwatch;
