'use strict';
const AWS = jest.requireActual('@aws-sdk/client-cloudwatch');
const { mockClient } = require('aws-sdk-client-mock');

const CloudWatch = AWS.CloudWatch;
const CloudWatchMock = mockClient(AWS.CloudWatch);

module.exports = Object.assign({}, { ...AWS, CloudWatch, CloudWatchMock });
