'use strict';
const AWS = jest.requireActual('@aws-sdk/client-cloudwatch-events');
const { mockClient } = require('aws-sdk-client-mock');

let CloudWatchEvents, CloudWatchEventsMock;
if (process.env.AWS_MOCKS) {
  CloudWatchEvents = require('./cloudwatch-events');
} else {
  CloudWatchEvents = AWS.CloudWatchEvents;
  CloudWatchEventsMock = mockClient(AWS.CloudWatchEvents);
}

module.exports = Object.assign(
  {},
  { ...AWS, CloudWatchEvents, CloudWatchEventsMock }
);
