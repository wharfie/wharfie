'use strict';

const Lambda = require('./lambda');

/**
 * A Lambda function that runs in response to messages in an SQS queue.
 * Includes a Log Group, a Role, an Alarm on function errors, and an event source
 * mapping.
 * @param {object} options - Extends the options for [`Lambda`](#lambda) with the following additional attributes:
 * @param {string} options.EventSourceArn - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-eventsourcemapping.html#cfn-lambda-eventsourcemapping-eventsourcearn).
 * @param {number} options.ReservedConcurrentExecutions - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-function.html#cfn-lambda-function-reservedconcurrentexecutions).
 * @param {number} [options.BatchSize=1] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-eventsourcemapping.html#cfn-lambda-eventsourcemapping-batchsize).
 */
class QueueLambda extends Lambda {
  constructor(options) {
    if (!options) throw new Error('Options required');
    super(options);

    const {
      BatchSize = 1,
      EventSourceArn,
      ReservedConcurrentExecutions = 0,
      MaximumBatchingWindowInSeconds = 0,
    } = options;

    const required = [EventSourceArn, ReservedConcurrentExecutions];
    if (required.some((variable) => variable === undefined))
      throw new Error(
        'You must provide an EventSourceArn and ReservedConcurrentExecutions'
      );

    if (ReservedConcurrentExecutions < 0)
      throw new Error(
        'ReservedConcurrentExecutions must be greater than or equal to 0'
      );

    const { Enabled = true } = options;

    this.Resources[`${this.LogicalName}EventSource`] = {
      Type: 'AWS::Lambda::EventSourceMapping',
      Condition: this.Condition,
      Properties: {
        Enabled,
        BatchSize,
        EventSourceArn,
        MaximumBatchingWindowInSeconds,
        FunctionName: { Ref: this.LogicalName },
      },
    };

    const generatedRoleRef = this.Resources[`${this.LogicalName}Role`];
    const sqsStatement = {
      Effect: 'Allow',
      Action: [
        'sqs:DeleteMessage',
        'sqs:ReceiveMessage',
        'sqs:GetQueueAttributes',
      ],
      Resource: [
        EventSourceArn,
        { 'Fn::Sub': ['${arn}/*', { arn: EventSourceArn }] },
      ],
    };

    if (generatedRoleRef && generatedRoleRef.Properties.Policies) {
      generatedRoleRef.Properties.Policies[0].PolicyDocument.Statement.push(
        sqsStatement
      );
    } else if (generatedRoleRef) {
      generatedRoleRef.Properties.Policies = [
        {
          PolicyName: 'SQSAccess',
          PolicyDocument: {
            Version: '2012-10-17',
            Statement: [sqsStatement],
          },
        },
      ];
    }
  }
}

module.exports = QueueLambda;
