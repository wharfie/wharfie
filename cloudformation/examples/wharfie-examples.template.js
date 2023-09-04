'use strict';

const wharfie = require('../../client');

const AmazonBerkeleyObjects = require('./amazon-berkeley-objects');
const AmazonBerkeleyObjectImages = require('./amazon-berkeley-object-images');
const AmazonBerkeleyObjectsAggregated = require('./amazon-berkeley-objects-aggregated');
// const AmazonBerkeleyObjectsUDFJoin = require('./examples/amazon-berkeley-objects-udf-join');
const FirehoseExample = require('./firehose');
// const UDF = require('./udf');
const Bucket = require('./bucket');

const Parameters = {
  Deployment: {
    Type: 'String',
    Description: 'What wharfie environment to deploy into',
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
  InputLocations: ['amazon-berkeley-objects/', wharfie.util.sub('${Bucket}/')],
  OutputLocations: [wharfie.util.sub('${Bucket}/')],
});

module.exports = wharfie.util.merge(
  { Parameters, Resources },
  WharfieExamplesRole,
  AmazonBerkeleyObjects,
  AmazonBerkeleyObjectImages,
  AmazonBerkeleyObjectsAggregated,
  // AmazonBerkeleyObjectsUDFJoin,
  FirehoseExample,
  Bucket
  // UDF
);
