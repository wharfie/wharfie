import SQS from '../../sqs.js';

/**
 * AWS SQS adapter. This is a thin wrapper around the existing SQS helper class
 * at `lambdas/lib/sqs.js`.
 * @param {import("@aws-sdk/client-sqs").SQSClientConfig} [options] - SQS client config.
 * @returns {import('../base.js').QueueClient} -
 */
export default function createSQSQueue(options = {}) {
  const region = options.region || process.env.AWS_REGION;
  return new SQS({
    ...options,
    ...(region ? { region } : {}),
  });
}
