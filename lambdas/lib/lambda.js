import {
  Lambda as _Lambda,
  CreateEventSourceMappingCommand,
  UpdateEventSourceMappingCommand,
  DeleteEventSourceMappingCommand,
  GetEventSourceMappingCommand,
  ListEventSourceMappingsCommand,
  CreateFunctionCommand,
  UpdateFunctionConfigurationCommand,
  UpdateFunctionCodeCommand,
  DeleteFunctionCommand,
  GetFunctionCommand,
  TagResourceCommand,
  UntagResourceCommand,
  ListTagsCommand,
  ListFunctionsCommand,
} from '@aws-sdk/client-lambda';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

import BaseAWS from './base.js';

class Lambda {
  /**
   * @param {import("@aws-sdk/client-lambda").LambdaClientConfig} options - lambda sdk options
   */
  constructor(options) {
    const credentials = fromNodeProviderChain();
    this.lambda = new _Lambda({
      ...BaseAWS.config(),
      credentials,
      ...options,
    });
  }

  /**
   * @param {import("@aws-sdk/client-lambda").CreateEventSourceMappingCommandInput} params - lambda createEventSourceMapping params
   * @returns {Promise<import("@aws-sdk/client-lambda").CreateEventSourceMappingCommandOutput>} - lambda createEventSourceMapping result
   */
  async createEventSourceMapping(params) {
    const command = new CreateEventSourceMappingCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").UpdateEventSourceMappingCommandInput} params - lambda updateEventSourceMapping params
   * @returns {Promise<import("@aws-sdk/client-lambda").UpdateEventSourceMappingCommandOutput>} - lambda updateEventSourceMapping result
   */
  async updateEventSourceMapping(params) {
    const command = new UpdateEventSourceMappingCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").DeleteEventSourceMappingCommandInput} params - lambda deleteEventSourceMapping params
   * @returns {Promise<import("@aws-sdk/client-lambda").DeleteEventSourceMappingCommandOutput>} - lambda deleteEventSourceMapping result
   */
  async deleteEventSourceMapping(params) {
    const command = new DeleteEventSourceMappingCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").GetEventSourceMappingCommandInput} params - lambda getEventSourceMapping params
   * @returns {Promise<import("@aws-sdk/client-lambda").GetEventSourceMappingCommandOutput>} - lambda getEventSourceMapping result
   */
  async getEventSourceMapping(params) {
    const command = new GetEventSourceMappingCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").ListEventSourceMappingsCommandInput} params - lambda listEventSourceMappings params
   * @returns {Promise<import("@aws-sdk/client-lambda").ListEventSourceMappingsCommandOutput>} - lambda listEventSourceMappings result
   */
  async listEventSourceMappings(params) {
    const command = new ListEventSourceMappingsCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").CreateFunctionCommandInput} params - lambda createFunction params
   * @returns {Promise<import("@aws-sdk/client-lambda").CreateFunctionCommandOutput>} - lambda createFunction result
   */
  async createFunction(params) {
    const command = new CreateFunctionCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").UpdateFunctionConfigurationCommandInput} params - lambda updateFunctionConfiguration params
   * @returns {Promise<import("@aws-sdk/client-lambda").UpdateFunctionConfigurationCommandOutput>} - lambda updateFunctionConfiguration result
   */
  async updateFunctionConfiguration(params) {
    const command = new UpdateFunctionConfigurationCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").UpdateFunctionCodeCommandInput} params - lambda updateFunctionCode params
   * @returns {Promise<import("@aws-sdk/client-lambda").UpdateFunctionCodeCommandOutput>} - lambda updateFunctionCode result
   */
  async updateFunctionCode(params) {
    const command = new UpdateFunctionCodeCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").DeleteFunctionCommandInput} params - lambda createFunction params
   * @returns {Promise<import("@aws-sdk/client-lambda").DeleteFunctionCommandOutput>} - lambda createFunction result
   */
  async deleteFunction(params) {
    const command = new DeleteFunctionCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").GetFunctionCommandInput} params - lambda getFunction params
   * @returns {Promise<import("@aws-sdk/client-lambda").GetFunctionCommandOutput>} - lambda getFunction result
   */
  async getFunction(params) {
    const command = new GetFunctionCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").TagResourceCommandInput} params - lambda tagResource params
   * @returns {Promise<import("@aws-sdk/client-lambda").TagResourceCommandOutput>} - lambda tagResource result
   */
  async tagResource(params) {
    const command = new TagResourceCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").UntagResourceCommandInput} params - lambda untagResource params
   * @returns {Promise<import("@aws-sdk/client-lambda").UntagResourceCommandOutput>} - lambda untagResource result
   */
  async untagResource(params) {
    const command = new UntagResourceCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").ListTagsCommandInput} params - lambda listTags params
   * @returns {Promise<import("@aws-sdk/client-lambda").ListTagsCommandOutput>} - lambda listTags result
   */
  async listTags(params) {
    const command = new ListTagsCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").ListFunctionsCommandInput} params - lambda listFunctions params
   * @returns {Promise<import("@aws-sdk/client-lambda").ListFunctionsCommandOutput>} - lambda listFunctions result
   */
  async listFunctions(params) {
    const allFunctions = [];
    const { Functions, NextMarker } = await this.lambda.send(
      new ListFunctionsCommand(params)
    );
    allFunctions.push(...(Functions || []));
    let Marker = NextMarker;
    while (Marker) {
      const { Functions, NextMarker } = await this.lambda.send(
        new ListFunctionsCommand({
          ...params,
          Marker,
        })
      );
      allFunctions.push(...(Functions || []));
      Marker = NextMarker;
    }
    return {
      $metadata: {},
      Functions: allFunctions,
    };
  }
}

export default Lambda;
