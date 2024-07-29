'use strict';
const AWS = jest.requireActual('@aws-sdk/client-lambda');
const { mockClient } = require('aws-sdk-client-mock');

let Lambda, LambdaMock;
if (process.env.AWS_MOCKS) {
  Lambda = require('./lambda');
} else {
  Lambda = AWS.Lambda;
  LambdaMock = mockClient(AWS.Lambda);
}

module.exports = Object.assign({}, { ...AWS, Lambda, LambdaMock });
