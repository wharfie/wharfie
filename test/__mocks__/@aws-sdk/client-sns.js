import { jest } from '@jest/globals';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const AWS = jest.requireActual('@aws-sdk/client-sns');
const { mockClient } = require('aws-sdk-client-mock');

let SNS, SNSMock;
if (process.env.AWS_MOCKS) {
  SNS = require('./sns');
} else {
  SNS = AWS.SNS;
  SNSMock = mockClient(AWS.SNS);
}

module.exports = Object.assign({}, { ...AWS, SNS, SNSMock });
