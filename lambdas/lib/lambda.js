'use strict';
const AWS = require('@aws-sdk/client-lambda');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');

const BaseAWS = require('./base');

class Lambda {
  /**
   * @param {import("@aws-sdk/client-lambda").LambdaClientConfig} options - lambda sdk options
   */
  constructor(options) {
    const credentials = fromNodeProviderChain();
    this.lambda = new AWS.Lambda({
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
    const command = new AWS.CreateEventSourceMappingCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").UpdateEventSourceMappingCommandInput} params - lambda updateEventSourceMapping params
   * @returns {Promise<import("@aws-sdk/client-lambda").UpdateEventSourceMappingCommandOutput>} - lambda updateEventSourceMapping result
   */
  async updateEventSourceMapping(params) {
    const command = new AWS.UpdateEventSourceMappingCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").DeleteEventSourceMappingCommandInput} params - lambda deleteEventSourceMapping params
   * @returns {Promise<import("@aws-sdk/client-lambda").DeleteEventSourceMappingCommandOutput>} - lambda deleteEventSourceMapping result
   */
  async deleteEventSourceMapping(params) {
    const command = new AWS.DeleteEventSourceMappingCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").GetEventSourceMappingCommandInput} params - lambda getEventSourceMapping params
   * @returns {Promise<import("@aws-sdk/client-lambda").GetEventSourceMappingCommandOutput>} - lambda getEventSourceMapping result
   */
  async getEventSourceMapping(params) {
    const command = new AWS.GetEventSourceMappingCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").ListEventSourceMappingsCommandInput} params - lambda listEventSourceMappings params
   * @returns {Promise<import("@aws-sdk/client-lambda").ListEventSourceMappingsCommandOutput>} - lambda listEventSourceMappings result
   */
  async listEventSourceMappings(params) {
    const command = new AWS.ListEventSourceMappingsCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").CreateFunctionCommandInput} params - lambda createFunction params
   * @returns {Promise<import("@aws-sdk/client-lambda").CreateFunctionCommandOutput>} - lambda createFunction result
   */
  async createFunction(params) {
    const command = new AWS.CreateFunctionCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").UpdateFunctionConfigurationCommandInput} params - lambda updateFunctionConfiguration params
   * @returns {Promise<import("@aws-sdk/client-lambda").UpdateFunctionConfigurationCommandOutput>} - lambda updateFunctionConfiguration result
   */
  async updateFunctionConfiguration(params) {
    const command = new AWS.UpdateFunctionConfigurationCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").UpdateFunctionCodeCommandInput} params - lambda updateFunctionCode params
   * @returns {Promise<import("@aws-sdk/client-lambda").UpdateFunctionCodeCommandOutput>} - lambda updateFunctionCode result
   */
  async updateFunctionCode(params) {
    const command = new AWS.UpdateFunctionCodeCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").DeleteFunctionCommandInput} params - lambda createFunction params
   * @returns {Promise<import("@aws-sdk/client-lambda").DeleteFunctionCommandOutput>} - lambda createFunction result
   */
  async deleteFunction(params) {
    const command = new AWS.DeleteFunctionCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").GetFunctionCommandInput} params - lambda getFunction params
   * @returns {Promise<import("@aws-sdk/client-lambda").GetFunctionCommandOutput>} - lambda getFunction result
   */
  async getFunction(params) {
    const command = new AWS.GetFunctionCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").TagResourceCommandInput} params - lambda tagResource params
   * @returns {Promise<import("@aws-sdk/client-lambda").TagResourceCommandOutput>} - lambda tagResource result
   */
  async tagResource(params) {
    const command = new AWS.TagResourceCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").ListFunctionsCommandInput} params - lambda listFunctions params
   * @returns {Promise<import("@aws-sdk/client-lambda").ListFunctionsCommandOutput>} - lambda listFunctions result
   */
  async listFunctions(params) {
    const allFunctions = [];
    const { Functions, NextMarker } = await this.lambda.send(
      new AWS.ListFunctionsCommand(params)
    );
    allFunctions.push(...(Functions || []));
    let Marker = NextMarker;
    while (Marker) {
      const { Functions, NextMarker } = await this.lambda.send(
        new AWS.ListFunctionsCommand({
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

module.exports = Lambda;
