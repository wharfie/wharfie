'use strict';

const wharfie = require('../../client');

const path = require('path');

const AmazonBerkeleyObjects = require('./amazon-berkeley-objects');
const AmazonBerkeleyObjectImages = require('./amazon-berkeley-object-images');
const AmazonBerkeleyObjectsAggregated = require('./amazon-berkeley-objects-aggregated');
const AmazonBerkeleyObjectsJoin = require('./amazon-berkeley-objects-join');
// const AmazonBerkeleyObjectsUDFJoin = require('./amazon-berkeley-objects-udf-join');
// const FirehoseExample = require('./firehose');
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

const WharfieProject = wharfie.loadProject({
  path: path.join(__dirname, '../project_structure_experiment'),
});

module.exports = wharfie.util.merge(
  { Parameters, Resources },
  WharfieProject,
  WharfieExamplesRole,
  AmazonBerkeleyObjects,
  AmazonBerkeleyObjectImages,
  AmazonBerkeleyObjectsAggregated,
  AmazonBerkeleyObjectsJoin,
  // AmazonBerkeleyObjectsUDFJoin,
  // FirehoseExample,
  Bucket
  // UDF
);
