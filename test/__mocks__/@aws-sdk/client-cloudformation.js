'use strict';
const AWS = jest.requireActual('@aws-sdk/client-cloudformation');
const { mockClient } = require('aws-sdk-client-mock');

let CloudFormation, CloudFormationMock;
if (process.env.AWS_MOCKS) {
  CloudFormation = require('./cloudformation');
} else {
  CloudFormation = AWS.CloudFormation;
  CloudFormationMock = mockClient(AWS.CloudFormation);
}

module.exports = Object.assign(
  {},
  { ...AWS, CloudFormation, CloudFormationMock }
);
