import { jest } from '@jest/globals';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const AWS = jest.createMockFromModule('@aws-sdk/lib-dynamodb');

const DynamoDBDocumentMock = {
  query: jest.fn().mockImplementation(),
  batchWrite: jest.fn().mockImplementation(),
  update: jest.fn().mockImplementation(),
  put: jest.fn().mockImplementation(),
  get: jest.fn().mockImplementation(),
  delete: jest.fn().mockImplementation(),
};

const ModuleMock = {
  from: jest.fn().mockImplementation(() => {
    return DynamoDBDocumentMock;
  }),
};

const clients = {
  DynamoDBDocument: ModuleMock,
};

clients.get = (service) => {
  return clients[service];
};

AWS.spyOn = (service, method) => {
  if (service === 'DynamoDBDocument') {
    return DynamoDBDocumentMock[method];
  }
  throw new Error(`${service} is not supported by this mock`);
};

AWS.clearAllMocks = () => {
  ModuleMock.from.mockClear();
  Object.keys(DynamoDBDocumentMock).forEach((key) => {
    DynamoDBDocumentMock[key].mockClear();
  });
};

AWS.DynamoDBDocument = ModuleMock;

module.exports = AWS;
