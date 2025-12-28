import AWS from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import DynamoDBMock from './dynamodb.js';

let DynamoDB, DynamoDBMock;
if (process.env.AWS_MOCKS) {
  DynamoDB = DynamoDBMock;
} else {
  DynamoDB = AWS.DynamoDB;
  DynamoDBMock = mockClient(AWS.DynamoDB);
}

export default { ...AWS, DynamoDB, DynamoDBMock };
