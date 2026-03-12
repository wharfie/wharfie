// @ts-nocheck
import * as AWS from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import DynamoDBMockClass from './dynamodb.js';

let DynamoDB;
let DynamoDBMock;
if (process.env.AWS_MOCKS) {
  DynamoDB = DynamoDBMockClass;
} else {
  DynamoDB = AWS.DynamoDB;
  DynamoDBMock = mockClient(AWS.DynamoDB);
}

export default { ...AWS, DynamoDB, DynamoDBMock };
