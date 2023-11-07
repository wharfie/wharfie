'use strict';
const AWS = jest.requireActual('@aws-sdk/client-firehose');
const { mockClient } = require('aws-sdk-client-mock');

let Firehose, FirehoseMock;
if (process.env.AWS_MOCKS) {
  Firehose = require('./firehose');
} else {
  Firehose = AWS.Firehose;
  FirehoseMock = mockClient(AWS.Firehose);
}

module.exports = Object.assign({}, { ...AWS, Firehose, FirehoseMock });
