'use strict';
const AWS = jest.requireActual('@aws-sdk/client-sts');
const { mockClient } = require('aws-sdk-client-mock');

let STS, STSMock;
if (process.env.AWS_MOCKS) {
  STS = require('./sts');
} else {
  STS = AWS.STS;
  STSMock = mockClient(AWS.STS);
}

module.exports = Object.assign({}, { ...AWS, STS, STSMock });
