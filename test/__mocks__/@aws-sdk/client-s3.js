'use strict';
const AWS = jest.requireActual('@aws-sdk/client-s3');
const { mockClient } = require('aws-sdk-client-mock');

let S3, S3Mock;
if (process.env.AWS_MOCKS) {
  S3 = require('./s3');
} else {
  S3 = AWS.S3;
  S3Mock = mockClient(AWS.S3);
}

module.exports = Object.assign({}, { ...AWS, S3, S3Mock });
