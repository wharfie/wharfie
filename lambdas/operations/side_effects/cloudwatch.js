const CloudWatch = require('../../lib/cloudwatch');
const cloudwatchClient = new CloudWatch({
  region: process.env.AWS_REGION,
});
const STACK_NAME = process.env.STACK_NAME || '';

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {import('../../typedefs').ResourceRecord} resource -
 * @param {import('../../typedefs').OperationRecord} operation -
 * @returns {Promise<import('../../typedefs').ActionProcessingOutput>} -
 */
async function cloudwatch(event, context, resource, operation) {
  const { completed_at } = event.action_inputs;
  if (!completed_at) throw new Error('missing required action inputs');

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
            Value: resource.resource_id,
          },
          {
            Name: 'operation_type',
            Value: operation.operation_type,
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
            Value: operation.operation_type,
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

module.exports = cloudwatch;
