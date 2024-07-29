'use strict';
const AWS = jest.requireActual('@aws-sdk/client-application-auto-scaling');
const { mockClient } = require('aws-sdk-client-mock');

let ApplicationAutoScaling, ApplicationAutoScalingMock;
if (process.env.AWS_MOCKS) {
  ApplicationAutoScaling = require('./application-auto-scaling');
} else {
  ApplicationAutoScaling = AWS.ApplicationAutoScaling;
  ApplicationAutoScalingMock = mockClient(AWS.ApplicationAutoScaling);
}

module.exports = Object.assign(
  {},
  { ...AWS, ApplicationAutoScaling, ApplicationAutoScalingMock }
);
