'use strict';
const AWS = jest.requireActual('@aws-sdk/client-sqs');
const { mockClient } = require('aws-sdk-client-mock');

let SQS, SQSMock;
if (process.env.AWS_MOCKS) {
  SQS = require('./sqs');
} else {
  SQS = AWS.SQS;
  SQSMock = mockClient(AWS.SQS);
}

module.exports = Object.assign({}, { ...AWS, SQS, SQSMock });
