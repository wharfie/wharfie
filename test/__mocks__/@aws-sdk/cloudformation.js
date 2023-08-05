'use strict';

class CloudFormationMock {
  __setMockState(cloudformationState) {
    CloudFormationMock.__state = {
      stacks: {},
    };
    if (cloudformationState) {
      CloudFormationMock.__state = cloudformationState;
    }
  }

  __getMockState() {
    return CloudFormationMock.__state;
  }

  async send(command) {
    switch (command.constructor.name) {
      case 'CreateStackCommand':
        return await this.createStack(command.input);
      case 'DeleteStackCommand':
        return await this.deleteStack(command.input);
      case 'DescribeStacksCommand':
        return await this.describeStacks(command.input);
    }
  }

  async describeStacks(params) {
    let stacks = [];
    if (params.StackName) {
      stacks = [CloudFormationMock.__state.stacks[params.StackName]];
    } else {
      stacks = Object.values(CloudFormationMock.__state.stacks);
    }
    return {
      Stacks: stacks,
    };
  }

  async deleteStack(params) {
    CloudFormationMock.__state.stacks[params.StackName] = {
      StackName: params.StackName,
      StackStatus: 'DELETE_COMPLETE',
    };
  }

  async createStack(params) {
    CloudFormationMock.__state.stacks[params.StackName] = {
      StackName: params.StackName,
      StackStatus: 'CREATE_COMPLETE',
    };
    return {
      StackId: params.StackName,
    };
  }
}

CloudFormationMock.__state = {
  stacks: {},
};

module.exports = CloudFormationMock;
