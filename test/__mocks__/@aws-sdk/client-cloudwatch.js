'use strict';
const AWS = jest.requireActual('@aws-sdk/client-cloudwatch');
const { mockClient } = require('aws-sdk-client-mock');

let CloudWatch, CloudWatchMock;
if (process.env.AWS_MOCKS) {
  CloudWatch = require('./cloudwatch');
} else {
  CloudWatch = AWS.CloudWatch;
  CloudWatchMock = mockClient(AWS.CloudWatch);
}

module.exports = Object.assign({}, { ...AWS, CloudWatch, CloudWatchMock });
