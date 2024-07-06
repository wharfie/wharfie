'use strict';
const AWS = jest.requireActual('@aws-sdk/client-dynamodb');
const { mockClient } = require('aws-sdk-client-mock');

let DynamoDB, DynamoDBMock;
if (process.env.AWS_MOCKS) {
  DynamoDB = require('./dynamodb');
} else {
  DynamoDB = AWS.DynamoDB;
  DynamoDBMock = mockClient(AWS.DynamoDB);
}

module.exports = Object.assign({}, { ...AWS, DynamoDB, DynamoDBMock });
