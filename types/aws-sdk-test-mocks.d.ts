import '@aws-sdk/client-application-auto-scaling';
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
import '@aws-sdk/lib-dynamodb';

export {};

type AwsLikeSend = (command: any) => Promise<any>;

declare module '@aws-sdk/lib-dynamodb' {
  interface DynamoDBDocument {
    send: AwsLikeSend;
  }
}

declare module '@aws-sdk/client-application-auto-scaling' {
  interface ApplicationAutoScaling {
    send: AwsLikeSend;
    config: any;
    __setMockState(state?: unknown): void;
  }
}

declare module '@aws-sdk/client-athena' {
  interface Athena {
    send: AwsLikeSend;
    config: any;
    __setMockState(state?: unknown): void;
  }

  interface AthenaClient {
    send: AwsLikeSend;
    config: any;
  }
}

declare module '@aws-sdk/client-cloudwatch' {
  interface CloudWatch {
    send: AwsLikeSend;
    config: any;
    __setMockState(state?: unknown): void;
  }
}

declare module '@aws-sdk/client-cloudwatch-events' {
  interface CloudWatchEvents {
    send: AwsLikeSend;
    config: any;
    __setMockState(state?: unknown): void;
  }
}

declare module '@aws-sdk/client-dynamodb' {
  interface DynamoDB {
    send: AwsLikeSend;
    config: any;
    __setMockState(state?: unknown): void;
  }
}

declare module '@aws-sdk/client-firehose' {
  interface Firehose {
    send: AwsLikeSend;
    config: any;
    __setMockState(state?: unknown): void;
  }
}

declare module '@aws-sdk/client-glue' {
  interface Glue {
    send: AwsLikeSend;
    config: any;
    __setMockState(state?: unknown): void;
  }
}

declare module '@aws-sdk/client-iam' {
  interface IAM {
    send: AwsLikeSend;
    config: any;
    __setMockState(state?: unknown): void;
  }
}

declare module '@aws-sdk/client-lambda' {
  interface Lambda {
    send: AwsLikeSend;
    config: any;
    __setMockState(state?: unknown): void;
  }
}

declare module '@aws-sdk/client-s3' {
  interface S3 {
    send: AwsLikeSend;
    config: S3ClientResolvedConfig;
    __setMockState(state?: unknown): void;
  }

  interface S3ClientConfig {
    region?: any;
    endpoint?: any;
    credentials?: any;
    forcePathStyle?: boolean;
    extensions?: any[];
  }

  interface S3ClientResolvedConfig {
    region?: any;
    endpoint?: any;
    credentials?: any;
    forcePathStyle?: boolean;
  }
}

declare module '@aws-sdk/client-sns' {
  interface SNS {
    send: AwsLikeSend;
    config: any;
    __setMockState(state?: unknown): void;
  }
}

declare module '@aws-sdk/client-sqs' {
  interface SQS {
    send: AwsLikeSend;
    config: any;
    __setMockState(state?: unknown): void;
  }

  interface SQSClientConfig {
    region?: any;
  }
}

declare module '@aws-sdk/client-sts' {
  interface STS {
    send: AwsLikeSend;
    config: any;
    __setMockState(state?: unknown): void;
  }
}
