'use strict';

const wharfie = require('../../client');
const fs = require('fs');
const path = require('path');

const Columns = [
  {
    Name: 'name',
    Type: 'string',
  },
  {
    Name: 'time',
    Type: 'string',
  },
];

const Resources = {};

Resources.FirehoseExampleTestDataLambdaSchedule = {
  Type: 'AWS::Events::Rule',
  Properties: {
    Name: 'FirehoseExampleTestDataLambda',
    Description: {
      'Fn::Sub':
        'Schedule for FirehoseExampleTestDataLambda in ${AWS::StackName} stack',
    },
    State: 'ENABLED',
    ScheduleExpression: 'rate(1 minute)',
    Targets: [
      {
        Id: 'FirehoseExampleTestDataLambda',
        Arn: {
          'Fn::GetAtt': ['FirehoseExampleTestDataLambda', 'Arn'],
        },
      },
    ],
  },
};

Resources.FirehoseExampleTestDataLambdaPermission = {
  Type: 'AWS::Lambda::Permission',
  Properties: {
    Action: 'lambda:InvokeFunction',
    FunctionName: {
      'Fn::GetAtt': ['FirehoseExampleTestDataLambda', 'Arn'],
    },
    Principal: {
      'Fn::Sub': 'events.${AWS::URLSuffix}',
    },
    SourceArn: {
      'Fn::GetAtt': [`FirehoseExampleTestDataLambdaSchedule`, 'Arn'],
    },
  },
};

const firehoseExampleDataGeneratorLambda = new wharfie.util.shortcuts.Lambda({
  LogicalName: 'FirehoseExampleTestDataLambda',
  FunctionName: wharfie.util.sub(
    '${AWS::StackName}-FirehoseExampleDataGeneratorLambda'
  ),
  Code: {
    ZipFile: wharfie.util.sub(
      fs.readFileSync(path.join(__dirname, 'firehose-lambda.js'), 'utf8')
    ),
  },
  Handler: 'index.handler',
  Statement: [
    {
      Effect: 'Allow',
      Action: ['firehose:PutRecordBatch'],
      Resource: [wharfie.util.getAtt('FirehoseExampleFirehose', 'Arn')],
    },
  ],
  MemorySize: 128,
  Timeout: 20,
});

const firehose = new wharfie.Firehose({
  LogicalName: 'FirehoseExample',
  DatabaseName: wharfie.util.ref('Database'),
  TableName: 'firehose_table',
  Description: 'firehose example',
  Columns,
  DestinationBucket: wharfie.util.ref('Bucket'),
  DestinationPrefix: 'firehose_example/',
  FirehoseLoggingEnabled: true,
  WharfieDeployment: wharfie.util.ref('Deployment'),
  BufferInterval: 60,
});

module.exports = wharfie.util.merge(
  { Resources },
  firehose,
  firehoseExampleDataGeneratorLambda
);
