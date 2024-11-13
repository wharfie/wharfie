const { S3 } = require('@aws-sdk/client-s3');
const { STS } = require('@aws-sdk/client-sts');
const { SQS } = require('@aws-sdk/client-sqs');
const { SNS } = require('@aws-sdk/client-sns');
const { Lambda } = require('@aws-sdk/client-lambda');
const { IAM } = require('@aws-sdk/client-iam');
const { Glue } = require('@aws-sdk/client-glue');
const { Firehose } = require('@aws-sdk/client-firehose');
const { DynamoDB } = require('@aws-sdk/client-dynamodb');
const { CloudWatch } = require('@aws-sdk/client-cloudwatch');
const { CloudWatchEvents } = require('@aws-sdk/client-cloudwatch-events');
const { Athena } = require('@aws-sdk/client-athena');

const dependency_db = require('../lambdas/lib/dynamo/dependency');
const location_db = require('../lambdas/lib/dynamo/location');
const operation_db = require('../lambdas/lib/dynamo/operations');
const scheduler_db = require('../lambdas/lib/dynamo/scheduler');
const semaphore = require('../lambdas/lib/dynamo/semaphore');
const state_db = require('../lambdas/lib/dynamo/state');

const s3 = new S3();
const sts = new STS();
const sqs = new SQS();
const sns = new SNS();
const lambda = new Lambda();
const iam = new IAM();
const glue = new Glue();
const firehose = new Firehose();
const dynamodb = new DynamoDB();
const cloudwatch = new CloudWatch();
const cloudwatchevents = new CloudWatchEvents();
const athena = new Athena();

/**
 *
 */
function resetAWSMocks() {
  if (!process.env.AWS_MOCKS) {
    throw new Error('cannot reset mocks that do not exist');
  }
  s3.__setMockState();
  sts.__setMockState();
  sqs.__setMockState();
  sns.__setMockState();
  lambda.__setMockState();
  iam.__setMockState();
  glue.__setMockState();
  firehose.__setMockState();
  dynamodb.__setMockState();
  cloudwatch.__setMockState();
  cloudwatchevents.__setMockState();
  athena.__setMockState();
}

/**
 *
 */
function resetDBMocks() {
  dependency_db.__setMockState();
  location_db.__setMockState();
  operation_db.__setMockState();
  scheduler_db.__setMockState();
  semaphore.__setMockState();
  state_db.__setMockState();
}

module.exports = {
  resetAWSMocks,
  resetDBMocks,
};
