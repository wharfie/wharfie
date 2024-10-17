'use strict';
const { ResourceNotFoundException } = jest.requireActual(
  '@aws-sdk/client-lambda'
);

const { createId } = require('../../../lambdas/lib/id');
const { parse } = require('../../../lambdas/lib/arn');

class LambdaMock {
  __setMockState(
    lambdaState = {
      functions: {},
      mappings: {},
    }
  ) {
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
      case 'ListTagsCommand':
        return await this.listTags(command.input);
      case 'UntagResourceCommand':
        return await this.untagResource(command.input);
      case 'CreateFunctionCommand':
        return await this.createFunction(command.input);
      case 'DeleteFunctionCommand':
        return await this.deleteFunction(command.input);
      case 'GetEventSourceMappingCommand':
        return await this.getEventSourceMapping(command.input);
      case 'ListEventSourceMappingsCommand':
        return await this.listEventSourceMappings(command.input);
      case 'CreateEventSourceMappingCommand':
        return await this.createEventSourceMapping(command.input);
      case 'DeleteEventSourceMappingCommand':
        return await this.deleteEventSourceMapping(command.input);
      case 'UpdateEventSourceMappingCommand':
        return await this.updateEventSourceMapping(command.input);
      default:
        throw new Error(`Unsupported command: ${command.constructor.name}`);
    }
  }

  async getFunction(params) {
    if (!LambdaMock.__state.functions[params.FunctionName]) {
      throw new ResourceNotFoundException({
        message: `Function not found: ${params.FunctionName}`,
      });
    }
    return {
      Configuration: LambdaMock.__state.functions[params.FunctionName],
      Tags: LambdaMock.__state.functions[params.FunctionName].Tags || {},
    };
  }

  async updateFunctionConfiguration(params) {
    if (!LambdaMock.__state.functions[params.FunctionName]) {
      throw new ResourceNotFoundException({
        message: `Function not found: ${params.FunctionName}`,
      });
    }
    LambdaMock.__state.functions[params.FunctionName] = {
      ...LambdaMock.__state.functions[params.FunctionName],
      ...params,
    };
  }

  async updateFunctionCode(params) {
    if (!LambdaMock.__state.functions[params.FunctionName]) {
      throw new ResourceNotFoundException({
        message: `Function not found: ${params.FunctionName}`,
      });
    }
    LambdaMock.__state.functions[params.FunctionName] = {
      ...LambdaMock.__state.functions[params.FunctionName],
      ...params,
    };
  }

  async tagResource(params) {
    const { resource } = parse(params.Resource);

    const [resourceType, resourceName] = resource.split(':');
    if (resourceType === 'function') {
      if (!LambdaMock.__state.functions[resourceName]) {
        throw new ResourceNotFoundException({
          message: `Function not found: ${resourceName}`,
        });
      }
      LambdaMock.__state.functions[resourceName] = {
        ...LambdaMock.__state.functions[resourceName],
        Tags: {
          ...(LambdaMock.__state.functions[resourceName].Tags || {}),
          ...params.Tags,
        },
      };
    } else if (resourceType === 'event-source-mapping') {
      if (!LambdaMock.__state.mappings[resourceName]) {
        throw new ResourceNotFoundException({
          message: `Mapping not found: ${resourceName}`,
        });
      }
      LambdaMock.__state.mappings[resourceName] = {
        ...LambdaMock.__state.mappings[resourceName],
        Tags: {
          ...(LambdaMock.__state.mappings[resourceName].Tags || {}),
          ...params.Tags,
        },
      };
    } else {
      throw new Error(
        `mocks don't support taggging this resource type ${resourceType}`
      );
    }
  }

  async untagResource(params) {
    const { resource } = parse(params.Resource);

    const [resourceType, resourceName] = resource.split(':');
    if (resourceType === 'function') {
      if (!LambdaMock.__state.functions[resourceName]) {
        throw new ResourceNotFoundException({
          message: `Function not found: ${resourceName}`,
        });
      }
      LambdaMock.__state.functions[resourceName].Tags = Object.fromEntries(
        Object.entries(
          LambdaMock.__state.functions[resourceName].Tags || {}
        ).filter(([key]) => !params.TagKeys.includes(key))
      );
    } else if (resourceType === 'event-source-mapping') {
      if (!LambdaMock.__state.mappings[resourceName]) {
        throw new ResourceNotFoundException({
          message: `Mapping not found: ${resourceName}`,
        });
      }
      LambdaMock.__state.mappings[resourceName].Tags = Object.fromEntries(
        Object.entries(
          LambdaMock.__state.mappings[resourceName].Tags || {}
        ).filter(([key]) => !params.TagKeys.includes(key))
      );
    } else {
      throw new Error(
        `mocks don't support taggging this resource type ${resourceType}`
      );
    }
  }

  async listTags(params) {
    const { resource } = parse(params.Resource);
    const [resourceType, resourceName] = resource.split(':');
    if (resourceType === 'function') {
      if (!LambdaMock.__state.functions[resourceName]) {
        throw new ResourceNotFoundException({
          message: `Function not found: ${resourceName}`,
        });
      }
      return {
        Tags: LambdaMock.__state.functions[resourceName].Tags || {},
      };
    } else if (resourceType === 'event-source-mapping') {
      return {
        Tags: LambdaMock.__state.mappings[resourceName].Tags || {},
      };
    } else {
      throw new Error(
        `mocks don't support taggging this resource type ${resourceType}`
      );
    }
  }

  async createFunction(params) {
    if (LambdaMock.__state.functions[params.FunctionName]) {
      throw new Error(`Function already exists: ${params.FunctionName}`);
    }
    LambdaMock.__state.functions[params.FunctionName] = {
      ...params,
      FunctionArn: `arn:aws:lambda:us-west-2:123456789012:function:${params.FunctionName}`,
    };
    return LambdaMock.__state.functions[params.FunctionName];
  }

  async deleteFunction(params) {
    if (!LambdaMock.__state.functions[params.FunctionName]) {
      throw new ResourceNotFoundException({
        message: `Function not found: ${params.FunctionName}`,
      });
    }
    delete LambdaMock.__state.functions[params.FunctionName];
  }

  async listEventSourceMappings(params) {
    const functionName = params.FunctionName;
    const eventSourceMappings = Object.values(
      LambdaMock.__state.mappings
    ).filter((mapping) => mapping.FunctionName === functionName);
    return { EventSourceMappings: eventSourceMappings };
  }

  async getEventSourceMapping(params) {
    return LambdaMock.__state.mappings[params.UUID];
  }

  async createEventSourceMapping(params) {
    const uuid = createId();
    const eventSourceMapping = {
      ...params,
      UUID: uuid,
      State: params.Enabled ? 'Enabled' : 'Disabled',
    };
    LambdaMock.__state.mappings[uuid] = eventSourceMapping;
    return eventSourceMapping;
  }

  async updateEventSourceMapping(params) {
    const uuid = params.UUID;
    if (!LambdaMock.__state.mappings[uuid]) {
      throw new ResourceNotFoundException({
        message: `mapping not found: ${uuid}`,
      });
    }
    LambdaMock.__state.mappings[uuid] = {
      ...LambdaMock.__state.mappings[uuid],
      ...params,
      State: params.Enabled ? 'Enabled' : 'Disabled',
    };
  }

  async deleteEventSourceMapping(params) {
    const uuid = params.UUID;
    if (!LambdaMock.__state.mappings[uuid]) {
      throw new ResourceNotFoundException({
        message: `mapping not found: ${uuid}`,
      });
    }
    delete LambdaMock.__state.mappings[uuid];
  }
}

LambdaMock.__state = {
  functions: {},
  mappings: {},
};

module.exports = LambdaMock;
