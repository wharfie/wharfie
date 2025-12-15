import { S3 } from '@aws-sdk/client-s3';
import { STS } from '@aws-sdk/client-sts';
import { SQS } from '@aws-sdk/client-sqs';
import { SNS } from '@aws-sdk/client-sns';
import { Lambda } from '@aws-sdk/client-lambda';
import { IAM } from '@aws-sdk/client-iam';
import { Glue } from '@aws-sdk/client-glue';
import { Firehose } from '@aws-sdk/client-firehose';
import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { CloudWatch } from '@aws-sdk/client-cloudwatch';
import { CloudWatchEvents } from '@aws-sdk/client-cloudwatch-events';
import { Athena } from '@aws-sdk/client-athena';

import { __setMockState } from '../lambdas/lib/dynamo/dependency';
import { __setMockState as ___setMockState } from '../lambdas/lib/dynamo/location';
import { __setMockState as ____setMockState } from '../lambdas/lib/dynamo/operations';
import { __setMockState as _____setMockState } from '../lambdas/lib/dynamo/scheduler';
import { __setMockState as ______setMockState } from '../lambdas/lib/dynamo/semaphore';
import { __setMockState as _______setMockState } from '../lambdas/lib/db/state/aws';

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
  __setMockState();
  ___setMockState();
  ____setMockState();
  _____setMockState();
  ______setMockState();
  _______setMockState();
}

export { resetAWSMocks, resetDBMocks };
