'use strict';

const wharfie = require('../client');

const AmazonBerkeleyObjects = require('./examples/amazon-berkeley-objects');
const AmazonBerkeleyObjectImages = require('./examples/amazon-berkeley-object-images');
const AmazonBerkeleyObjectsAggregated = require('./examples/amazon-berkeley-objects-aggregated');
// const AmazonBerkeleyObjectsUDFJoin = require('./examples/amazon-berkeley-objects-udf-join');
const FirehoseExample = require('./examples/firehose');
const UDF = require('./examples/udf');

const Parameters = {
  GitSha: { Type: 'String' },
  SNSAlarmTopicARN: {
    Type: 'String',
    Description: 'SNS topic to send alarms to',
  },
  Deployment: {
    Type: 'String',
    Description: 'What wharfie environment to deploy into',
  },
  ExamplesBucket: {
    Type: 'String',
    Description: 'S3 bucket to store examples in',
  },
};

const Resources = {
  Database: {
    Type: 'AWS::Glue::Database',
    Properties: {
      CatalogId: wharfie.util.accountId,
      DatabaseInput: {
        Name: wharfie.util.join(
          '_',
          wharfie.util.split('-', wharfie.util.sub('${AWS::StackName}'))
        ),
      },
    },
  },
};

const WharfieExamplesRole = new wharfie.Role({
  LogicalName: 'WharfieExamplesRole',
  WharfieDeployment: wharfie.util.ref('Deployment'),
  InputLocations: [
    'amazon-berkeley-objects/',
    wharfie.util.sub('${ExamplesBucket}/'),
  ],
  OutputLocations: [wharfie.util.sub('${ExamplesBucket}/')],
});

module.exports = wharfie.util.merge(
  { Parameters, Resources },
  WharfieExamplesRole,
  AmazonBerkeleyObjects,
  AmazonBerkeleyObjectImages,
  AmazonBerkeleyObjectsAggregated,
  // AmazonBerkeleyObjectsUDFJoin,
  FirehoseExample,
  UDF
);
