'use strict';
const AWS = jest.requireActual('@aws-sdk/client-iam');
const { mockClient } = require('aws-sdk-client-mock');

let IAM, IAMMock;
if (process.env.AWS_MOCKS) {
  IAM = require('./iam');
} else {
  IAM = AWS.IAM;
  IAMMock = mockClient(AWS.IAM);
}

module.exports = Object.assign({}, { ...AWS, IAM, IAMMock });
