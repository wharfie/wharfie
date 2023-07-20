'use strict';
const AWS = jest.requireActual('@aws-sdk/client-cloudformation');
const { mockClient } = require('aws-sdk-client-mock');

const CloudFormation = AWS.CloudFormation;
const CloudFormationMock = mockClient(AWS.CloudFormation);

module.exports = Object.assign(
  {},
  { ...AWS, CloudFormation, CloudFormationMock }
);
