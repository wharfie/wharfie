'use strict';
const { ResourceNotFoundException } = jest.requireActual(
  '@aws-sdk/client-lambda'
);

class LambdaMock {
  __setMockState(lambdaState = {}) {
    LambdaMock.__state = lambdaState;
  }

  __getMockState() {
    return LambdaMock.__state;
  }

  async send(command) {
    switch (command.constructor.name) {
      case 'GetFunctionCommand':
        return await this.getFunction(command.input);
      case 'UpdateFunctionConfigurationCommand':
        return await this.updateFunctionConfiguration(command.input);
      case 'UpdateFunctionCodeCommand':
        return await this.updateFunctionCode(command.input);
      case 'TagResourceCommand':
        return await this.tagResource(command.input);
      case 'CreateFunctionCommand':
        return await this.createFunction(command.input);
      case 'DeleteFunctionCommand':
        return await this.deleteFunction(command.input);
    }
  }

  async getFunction(params) {
    if (!LambdaMock.__state[params.FunctionName]) {
      throw new ResourceNotFoundException({
        message: `Function not found: ${params.FunctionName}`,
      });
    }
    return {
      Configuration: LambdaMock.__state[params.FunctionName],
      Tags: LambdaMock.__state[params.FunctionName].Tags || {},
    };
  }

  async updateFunctionConfiguration(params) {
    if (!LambdaMock.__state[params.FunctionName]) {
      throw new ResourceNotFoundException({
        message: `Function not found: ${params.FunctionName}`,
      });
    }
    LambdaMock.__state[params.FunctionName] = {
      ...LambdaMock.__state[params.FunctionName],
      ...params,
    };
  }

  async updateFunctionCode(params) {
    if (!LambdaMock.__state[params.FunctionName]) {
      throw new ResourceNotFoundException({
        message: `Function not found: ${params.FunctionName}`,
      });
    }
    LambdaMock.__state[params.FunctionName] = {
      ...LambdaMock.__state[params.FunctionName],
      ...params,
    };
  }

  async tagResource(params) {
    if (!LambdaMock.__state[params.Resource]) {
      throw new ResourceNotFoundException({
        message: `Function not found: ${params.Resource}`,
      });
    }
    LambdaMock.__state[params.Resource] = {
      ...LambdaMock.__state[params.Resource],
      Tags: {
        ...(LambdaMock.__state[params.Resource].Tags || {}),
        ...params.Tags,
      },
    };
  }

  async createFunction(params) {
    if (LambdaMock.__state[params.FunctionName]) {
      throw new Error(`Function already exists: ${params.FunctionName}`);
    }
    LambdaMock.__state[params.FunctionName] = {
      ...params,
      FunctionArn: `arn:aws:lambda:us-west-2:123456789012:function:${params.FunctionName}`,
    };
    return LambdaMock.__state[params.FunctionName];
  }

  async deleteFunction(params) {
    if (!LambdaMock.__state[params.FunctionName]) {
      throw new ResourceNotFoundException({
        message: `Function not found: ${params.FunctionName}`,
      });
    }
    delete LambdaMock.__state[params.FunctionName];
  }
}

LambdaMock.__state = {};

module.exports = LambdaMock;
