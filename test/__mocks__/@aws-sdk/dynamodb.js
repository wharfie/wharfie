'use strict';

const { ResourceNotFoundException } = jest.requireActual(
  '@aws-sdk/client-dynamodb'
);

class DynamoDBMock {
  __setMockState(dynamodbState = {}) {
    DynamoDBMock.__state = dynamodbState;
  }

  __getMockState() {
    return DynamoDBMock.__state;
  }

  async send(command) {
    switch (command.constructor.name) {
      case 'CreateTableCommand':
        return await this.createTable(command.input);
      case 'DeleteTableCommand':
        return await this.deleteTable(command.input);
      case 'DescribeTableCommand':
        return await this.describeTable(command.input);
      case 'UpdateTableCommand':
        return await this.updateTable(command.input);
      case 'DescribeTimeToLiveCommand':
        return await this.describeTimeToLive(command.input);
      case 'UpdateTimeToLiveCommand':
        return await this.updateTimeToLive(command.input);
    }
  }

  async createTable(params) {
    if (DynamoDBMock.__state[params.TableName])
      throw new Error('table already exists');
    DynamoDBMock.__state[params.TableName] = {
      ...params,
      TableArn: `arn:aws:dynamodb:us-east-1:123456789012:table/${params.TableName}`,
      TableStatus: 'ACTIVE',
    };
    return {
      TableDescription: DynamoDBMock.__state[params.TableName],
    };
  }

  async deleteTable(params) {
    if (!DynamoDBMock.__state[params.TableName])
      throw new ResourceNotFoundException({
        message: 'Requested resource not found',
      });
    delete DynamoDBMock.__state[params.TableName];
  }

  async describeTable(params) {
    if (!DynamoDBMock.__state[params.TableName])
      throw new ResourceNotFoundException({
        message: 'Requested resource not found',
      });
    return {
      Table: DynamoDBMock.__state[params.TableName],
    };
  }

  async updateTable(params) {
    if (!DynamoDBMock.__state[params.TableName])
      throw new ResourceNotFoundException({
        message: 'Requested resource not found',
      });
    DynamoDBMock.__state[params.TableName] = {
      ...DynamoDBMock.__state[params.TableName],
      ...params,
    };
  }

  async describeTimeToLive(params) {
    if (!DynamoDBMock.__state[params.TableName])
      throw new ResourceNotFoundException({
        message: 'Requested resource not found',
      });

    return {
      TimeToLiveDescription: {
        TimeToLiveStatus: DynamoDBMock.__state[params.TableName]
          ?.TimeToLiveSpecification?.Enabled
          ? 'ENABLED'
          : 'DISABLED',
        AttributeName: DynamoDBMock.__state[params.TableName]
          .TimeToLiveSpecification
          ? DynamoDBMock.__state[params.TableName].TimeToLiveSpecification
              .AttributeName
          : undefined,
      },
    };
  }

  async updateTimeToLive(params) {
    if (!DynamoDBMock.__state[params.TableName])
      throw new ResourceNotFoundException({
        message: 'Requested resource not found',
      });
    DynamoDBMock.__state[params.TableName] = {
      ...DynamoDBMock.__state[params.TableName],
      TimeToLiveSpecification: params.TimeToLiveSpecification,
    };
  }
}

DynamoDBMock.__state = {};

module.exports = DynamoDBMock;
