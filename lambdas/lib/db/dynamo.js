import { ResourceNotFoundException } from '@aws-sdk/client-dynamodb';
import { parse } from '../../../lambdas/lib/arn.js';

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
      case 'ListTagsOfResourceCommand':
        return await this.listTags(command.input);
      case 'TagResourceCommand':
        return await this.tagResource(command.input);
      case 'UntagResourceCommand':
        return await this.untagResource(command.input);
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

  async listTags(params) {
    const { resource } = parse(params.ResourceArn);
    const [type, tableName] = resource.split('/');
    if (type !== 'table') {
      throw new Error(`type ${type} not supported`);
    }
    if (!DynamoDBMock.__state[tableName])
      throw new ResourceNotFoundException({
        message: 'Requested resource not found',
      });
    return {
      Tags: DynamoDBMock.__state[tableName].Tags || [],
    };
  }

  async tagResource(params) {
    const { resource } = parse(params.ResourceArn);
    const [type, tableName] = resource.split('/');
    if (type !== 'table') {
      throw new Error(`type ${type} not supported`);
    }
    if (!DynamoDBMock.__state[tableName])
      throw new ResourceNotFoundException({
        message: 'Requested resource not found',
      });
    DynamoDBMock.__state[tableName].Tags = [
      ...DynamoDBMock.__state[tableName].Tags,
      ...params.Tags,
    ];
  }

  async untagResource(params) {
    const { resource } = parse(params.ResourceArn);
    const [type, tableName] = resource.split('/');
    if (type !== 'table') {
      throw new Error(`type ${type} not supported`);
    }
    if (!DynamoDBMock.__state[tableName])
      throw new ResourceNotFoundException({
        message: 'Requested resource not found',
      });
    DynamoDBMock.__state[tableName].Tags = DynamoDBMock.__state[
      tableName
    ].Tags.filter((tag) => !params.TagKeys.includes(tag.Key));
  }
}

DynamoDBMock.__state = {};

export default DynamoDBMock;
