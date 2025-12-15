import { jest } from '@jest/globals';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const AWS = jest.requireActual('@aws-sdk/client-glue');
const { mockClient } = require('aws-sdk-client-mock');

let Glue, GlueMock;
if (process.env.AWS_MOCKS) {
  Glue = require('./glue');
} else {
  Glue = AWS.Glue;
  GlueMock = mockClient(AWS.Glue);
}

module.exports = Object.assign({}, { ...AWS, Glue, GlueMock });
