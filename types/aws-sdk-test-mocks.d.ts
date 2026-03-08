import '@aws-sdk/client-athena';
import '@aws-sdk/client-cloudwatch';
import '@aws-sdk/client-cloudwatch-events';
import '@aws-sdk/client-dynamodb';
import '@aws-sdk/client-firehose';
import '@aws-sdk/client-glue';
import '@aws-sdk/client-iam';
import '@aws-sdk/client-lambda';
import '@aws-sdk/client-s3';
import '@aws-sdk/client-sns';
import '@aws-sdk/client-sqs';
import '@aws-sdk/client-sts';

export {};

declare module '@aws-sdk/client-s3' {
  interface S3 {
    __setMockState(state?: unknown): void;
  }
}

declare module '@aws-sdk/client-sts' {
  interface STS {
    __setMockState(state?: unknown): void;
  }
}

declare module '@aws-sdk/client-sqs' {
  interface SQS {
    __setMockState(state?: unknown): void;
  }
}

declare module '@aws-sdk/client-sns' {
  interface SNS {
    __setMockState(state?: unknown): void;
  }
}

declare module '@aws-sdk/client-lambda' {
  interface Lambda {
    __setMockState(state?: unknown): void;
  }
}

declare module '@aws-sdk/client-iam' {
  interface IAM {
    __setMockState(state?: unknown): void;
  }
}

declare module '@aws-sdk/client-glue' {
  interface Glue {
    __setMockState(state?: unknown): void;
  }
}

declare module '@aws-sdk/client-firehose' {
  interface Firehose {
    __setMockState(state?: unknown): void;
  }
}

declare module '@aws-sdk/client-dynamodb' {
  interface DynamoDB {
    __setMockState(state?: unknown): void;
  }
}

declare module '@aws-sdk/client-cloudwatch' {
  interface CloudWatch {
    __setMockState(state?: unknown): void;
  }
}

declare module '@aws-sdk/client-cloudwatch-events' {
  interface CloudWatchEvents {
    __setMockState(state?: unknown): void;
  }
}

declare module '@aws-sdk/client-athena' {
  interface Athena {
    __setMockState(state?: unknown): void;
  }
}
