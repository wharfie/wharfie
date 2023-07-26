'use strict';

const wharfie = require('../../client');

const AmazonBerkeleyObjects = require('./amazon-berkeley-objects');
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
  Bucket
);
